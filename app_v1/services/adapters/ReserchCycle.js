/**
 * @abstract ハローサイクルのAPIを叩いて、ローカルのステーション情報とマージして返すAPI
 * キャッシュ機能実装
 */
import { KEY } from "../../config/defaults.js";
import * as Utils from "../../utils/utils.js";
import { FARE_HELLOCYCLING, pickCycleFare } from "../../config/fare/fareCycle/index.js";
import { HELLOCYCLE } from "../../config/providers/hellocycle.js";
import { CYCLE_PROVIDERS, CYCLE_PROVIDER_KEYS, TRUSTED_DOCKS_PROVIDER } from "../../config/providers/cycleProviders.js";
import { getCachedValue, REALTIME_CACHE_TTL_MS } from "../../utils/cache.js";
import { noteGenerated } from "../../utils/dataTimes.js";
import { withDemo } from "../../demo/index.js";
import { demoCycleFeed } from "../../demo/timetables.js";
import cyclePorts from "../../db/transit/cycleport/cycleportlist.json" with { type: "json" };
import { createDebugLogger, createDebugErrorLogger, createDebugWarnLogger } from "../../utils/debug/debug.js";  // デバッグ用
import { EXCLUDE_UNAVAILABLE_PORTS, RETURN_CAPACITY_UNKNOWN_DOCKS, CYCLE_PORT_CLOSING_BUFFER_MIN } from "../../config/constants/cyclePortRules.js";

// Create debug loggers for this module
const debugLog = createDebugLogger('HelloCycle');
const debugError = createDebugErrorLogger('HelloCycle');
const debugWarn = createDebugWarnLogger('HelloCycle');

// キャッシュは utils/cache.js に寄せている。
// 事業者ごとに別のキーで持つ。2つのフィードは更新のタイミングが違い、
// まとめて1つのキャッシュにすると片方が古いまま固定されるため。

/**
 * @abstract 1事業者の station_status を取り、station_id → station の Map にする
 * @detail 60 秒キャッシュ。同じキーへの同時リクエストは getCachedValue が1本にまとめる
 * @param {{key:string, feedKey:string, name:string, config:object}} provider
 * @returns {Promise<Map<string, object>>}
 */
async function fetchProviderStations(provider) {
  return getCachedValue(`cycle:status:${provider.key}`, REALTIME_CACHE_TTL_MS, async () => {
    const { baseUrl, stationStatusPath, timeoutMs } = provider.config;
    const url = `${baseUrl}${stationStatusPath}?acl:consumerKey=${KEY}`;
    // 実データが取れないときは、仮データのフィードに切り替える（公開用のコピー。demo/index.js）
    const response = await withDemo(`シェアサイクル(${provider.name})`, () => Utils.fetchJson(url, { timeout: timeoutMs }),
      () => demoCycleFeed(Object.values(cyclePorts).flat(), provider.feedKey),
      (body) => !Array.isArray(body?.data?.stations) || body.data.stations.length === 0);

    // Validation: APIレスポンスの形式を確認
    const stations = response?.data?.stations;  // dataがNullだとundefinedが返ってくる
    if (!Array.isArray(stations)) {
      throw new Error(`Invalid API response from ${provider.name}: stations is not an array`);
    }

    // GBFS の last_updated は UNIX 秒。画面に「台数は何時時点」と出す
    if (Number.isFinite(response?.last_updated)) noteGenerated(`cycle.${provider.feedKey}`, response.last_updated * 1000);

    // 応答は、メモリの60秒キャッシュにだけ持つ。ディスクには保存しない（本番のサーバーに、データを溜めない。#249）
    return new Map(stations.map((station) => [String(station.station_id), station]));
  });
}

/**
 * @abstract 事業者ごとの station_status をまとめて取る
 * @detail 片方のフィードが落ちても、もう片方は返す（Promise.allSettled）。
 *         全部落ちたときだけ呼び出し側で失敗にする
 * @returns {Promise<{stations: Record<string, Map>, failed: string[]}>}
 */
async function fetchAllProviders() {
  const results = await Promise.allSettled(CYCLE_PROVIDERS.map(fetchProviderStations));

  const stations = {};
  const failed = [];

  CYCLE_PROVIDERS.forEach((provider, index) => {
    const result = results[index];
    if (result.status === "fulfilled") {
      stations[provider.key] = result.value;
    } else {
      failed.push(provider.key);
      debugError(`${provider.name} のフィード取得に失敗:`, result.reason?.message ?? result.reason);
    }
  });

  return { stations, failed };
}

/**
 * @abstract 1ポートについて、事業者ごとの生データを引く
 * @detail 登録のキーは HELLO CYCLING 側の station_id。ほかの事業者での ID は
 *         cycleportlist.json の feedIds に持つ（同じ物理ポートが事業者ごとに別IDのため）
 * @param {object} station - cycleportlist.json の1ポート
 * @param {Record<string, Map>} stationsByProvider
 * @returns {Record<string, object>} 事業者キー → 生データ（フィードに無い事業者は入らない）
 */
export function collectByOperator(station, stationsByProvider) {
  // station_id がどの事業者のフィードの ID かは source で決まる（既定は HELLO CYCLING）。
  // ドコモにしか無いポートは source: "docomo" を付けて登録する
  const source = station.source ?? "hellocycling";
  const feedIds = { [source]: String(station.station_id), ...(station.feedIds ?? {}) };
  const byOperator = {};

  for (const provider of CYCLE_PROVIDERS) {
    const id = feedIds[provider.feedKey];
    if (id === undefined) continue;  // そのポートにこの事業者の登録が無い

    const raw = stationsByProvider[provider.key]?.get(String(id));
    if (raw) byOperator[provider.key] = raw;
  }

  return byOperator;
}

/**
 * @abstract 事業者ごとの生データを1つのポート情報にまとめる
 *
 * @detail 台数は事業者ごとに分かれていて、利用者は自分が使うアプリの分しか借りられない。
 *         そこで合算はせず、内訳（byOperator）を持ったうえで、
 *         「選んだ事業者で借りられる台数」を num_bikes_available に入れる。
 *
 *         空きドックは事情が違う。ドコモのフィードの num_docks_available は
 *         「自社の定員 − 自社の台数」の計算値で、他社の自転車を見ていない
 *         （2026-10-09 に全 5793 ポートで一致を確認）。共用ラックでは実際より多く見えるので、
 *         TRUSTED_DOCKS_PROVIDER（HELLO CYCLING）の値だけを使う。
 *         その事業者がいないポートでは、残った事業者の最小値で代用する。
 *
 * @param {Record<string, object>} byOperator
 * @param {Set<string>|undefined} allowed - 使ってよい事業者（undefined なら絞らない）
 * @returns {{num_bikes_available:number, num_docks_available:number, is_renting:boolean, is_returning:boolean}}
 */
export function summarizeOperators(byOperator, allowed) {
  const usable = Object.entries(byOperator).filter(([key]) => !allowed || allowed.has(key));

  const bikes = usable.reduce((sum, [, raw]) => sum + (Number(raw.num_bikes_available) || 0), 0);
  const isRenting = usable.some(([, raw]) => raw.is_renting && Number(raw.num_bikes_available) > 0);

  // 空きドックは TRUSTED_DOCKS_PROVIDER（HELLO CYCLING）の値だけを使う。
  // その事業者がいないポート（ドコモにしか無いポート）は、空き台数が分からない扱いにする。
  // ドコモの空きは、ラックのあるポートでは正しいがラックの無いポートでは固定値で、
  // どちらの型かフィードから見分けられないため（docs/gbfs-port-data.md）。
  const trusted = byOperator[TRUSTED_DOCKS_PROVIDER];
  const docks = trusted ? Number(trusted.num_docks_available) || 0 : null;

  // 空き台数が当てにならないポート。返せるかどうかの印だけを見る
  //   - 信頼できる事業者がいない（docks === null）
  //   - 返却枠に制限が無い（ラックが無く、十分大きい値が返る）
  const returnCapacityUnknown = docks === null || docks >= RETURN_CAPACITY_UNKNOWN_DOCKS;

  // 返せるかは「選んだ事業者がそのポートで返却を受け付けている」かつ「物理的に空きがある」
  const acceptsReturn = usable.some(([, raw]) => raw.is_returning);
  const isReturning = acceptsReturn && (returnCapacityUnknown || docks > 0);

  return {
    num_bikes_available: bikes,
    num_docks_available: returnCapacityUnknown ? null : docks,
    returnCapacityUnknown,
    is_renting: isRenting,
    is_returning: isReturning,
  };
}

/**
 * @abstract stationListとAPIのstation情報をマージして返す
 *
 * 【処理の流れ】
 * 1. 事業者ごとに station_status を取る（60秒キャッシュ、片方が落ちても続行）
 * 2. ポートごとに、事業者ごとの生データを集める（feedIds で引く）
 * 3. 「使ってよい事業者」で絞って、台数と空きをまとめる
 *
 * @param {Array<{station_id: string, name?: string, isNonPriorityPort?: boolean, feedIds?: object}>} stationList
 * @param {{operators?: Set<string>}} [options] - operators は使ってよい事業者（undefined なら絞らない）
 * @returns {Promise<Array>} マージ済みポート情報
 */
export async function getPortData(stationList, { operators } = {}) {
 try {
    const { stations, failed } = await fetchAllProviders();

    if (failed.length === CYCLE_PROVIDERS.length) {
      throw new Error("すべての事業者のフィードが取得できませんでした");
    }

    const portDataArray = [];

    for (const station of stationList) {
      const byOperator = collectByOperator(station, stations);

      // どの事業者のフィードにも無いポートは候補から外す（ADR-0008）
      if (Object.keys(byOperator).length === 0) {
        debugWarn(`Station ID ${station.station_id} not found in any feed.`);
        continue;
      }

      const summary = summarizeOperators(byOperator, operators);

      portDataArray.push({
        // HELLO CYCLING の生データを土台にする（既存の呼び出しが参照するキーを保つため）。
        // フィードに無ければ、残っている事業者のどれかを使う
        ...(byOperator[TRUSTED_DOCKS_PROVIDER] ?? Object.values(byOperator)[0]),
        ...summary,
        station_id: String(station.station_id),
        name: station.name ?? null,
        isNonPriorityPort: station.isNonPriorityPort ?? null,
        openingHours: station.openingHours ?? null,  // 営業時間。無ければ 24 時間営業
        byOperator,  // 事業者ごとの内訳。券面に「HELLO 0台 / ドコモ 7台」と出すのに使う
      });
    }

    return portDataArray;

  } catch (error) {
    debugError(`Failed to fetch station status. Details:`, error.cause || error);
    throw new Error("ポート情報の取得に失敗しました");
  }
}

/**
 * @abstract 1つの事業者の目で見たポートの状態にする
 * @detail 貸出と返却で事業者が食い違うと、借りた自転車を返せないポートに案内してしまう。
 *         事業者をそろえて選ぶために、ポートを「その事業者の目」で見られるようにする。
 *         空きドックは共用ラックの実測値（ポートの代表値）をそのまま使う。
 * @param {object} station - getPortData が返したポート
 * @param {string|undefined} operatorKey - 事業者。未指定なら素通し
 * @returns {object} 台数・可否をその事業者の値に差し替えたポート
 */
function operatorView(station, operatorKey) {
  if (!operatorKey || !station.byOperator) return station;

  const raw = station.byOperator[operatorKey];
  // その事業者がいないポートは、この事業者では使えない
  if (!raw) return { ...station, is_renting: false, is_returning: false, num_bikes_available: 0 };

  return {
    ...station,
    is_renting: Boolean(raw.is_renting),
    is_returning: Boolean(raw.is_returning),
    num_bikes_available: Number(raw.num_bikes_available) || 0,
  };
}

/**
 * @abstract 与えられた返却地ポートデータから、最も空きあるポートのデータを出力
 * 空き無しの場合-1を格納
 * @param {Array<Object>} portDataArray 返却地の返却ポートの情報リスト
 * @returns {Object} 返却用データオブジェクト
 */
export function makeReturnPlaceData(portDataArray, { excludeUnavailable = EXCLUDE_UNAVAILABLE_PORTS, operatorKey } = {}) {
  let bestPort = null;

  for (const rawStation of portDataArray) {
    const station = operatorView(rawStation, operatorKey);
    // 返却不可ならスキップ。返却を受け付けている印があっても、空きが 0 なら返せない
    // （HELLO CYCLING のアプリで「満」と出るポートを返却先に案内していた #141）。
    // 満でも検索に出す方針にするときは config の EXCLUDE_UNAVAILABLE_PORTS を false にする
    if (!station.is_returning) continue;
    // 返却枠に制限が無いポートは空き台数が当てにならないので、個数では弾かない
    if (excludeUnavailable && !station.returnCapacityUnknown
        && !(Number(station.num_docks_available) > 0)) continue;

    // まだ候補がない場合は無条件でセット
    if (!bestPort) {
      bestPort = station;
      continue;
    }

    // --- 比較ロジック ---
    // isNonPriorityPort で名指ししていたが、同じ事情のポートが 26 か所あるので規則にした
    const isCurrentNonPri = bestPort.isNonPriorityPort === true || bestPort.returnCapacityUnknown === true;
    const isNewNonPri = station.isNonPriorityPort === true || station.returnCapacityUnknown === true;

    // 1. 「現在の候補が非優先」かつ「新しい候補が優先(通常)」なら乗り換える
    if (isCurrentNonPri && !isNewNonPri) {
      bestPort = station;
    }
    // 2. 「優先度が同じ」なら「台数が多い」方を選ぶ
    else if (isCurrentNonPri === isNewNonPri) {
      if ((Number(station.num_docks_available) || 0) > (Number(bestPort.num_docks_available) || 0)) {
        bestPort = station;
      }
    }
  }

  // 結果の返却
  if (bestPort) {
    //debugLog('Best return port selected:', bestPort.station_id, 'Docks available:', bestPort.num_docks_available);
    return {
      is_returning: true, // bestPortがある時点でtrue確定
      returnportid: bestPort.station_id,
      num_docks_available: bestPort.num_docks_available,
      port_name: bestPort.name,
      isNonPriorityPort: bestPort.isNonPriorityPort,
      returnCapacityUnknown: bestPort.returnCapacityUnknown === true,  // 空き台数が当てにならない
      byOperator: bestPort.byOperator ?? null  // 事業者ごとの内訳
    };
  } else {
    // 返却可能なポートがない場合でも候補ポートの情報を返す
    const firstPort = portDataArray?.[0];

    if (firstPort) {
      debugLog('No returning ports available. Using first port as fallback:', firstPort.station_id);
      return {
        is_returning: false,
        returnportid: firstPort.station_id,
        num_docks_available: firstPort.num_docks_available,
        port_name: firstPort.name,  // ← ポート名を含める
        isNonPriorityPort: firstPort.isNonPriorityPort,
        byOperator: firstPort.byOperator ?? null
      };
    }

    //debugLog('No ports available at all');
    return {
      is_returning: false,
      returnportid: -1,
      num_docks_available: -1,
      port_name: null,
      isNonPriorityPort: null
    };
  }
}

/**
 * @abstract 貸出ポートまでの徒歩（rentWalkTime）を比べる
 * @detail 両方が数値のときだけ比べ、どちらかが無ければ 0（差なし）を返す。
 *         徒歩時間を渡さない呼び出し（従来どおり台数だけで選ぶ）を壊さないため
 * @returns {number} a のほうが短ければ負、長ければ正
 */
function walkCompare(a, b) {
  if (!Number.isFinite(a.rentWalkTime) || !Number.isFinite(b.rentWalkTime)) return 0;
  return a.rentWalkTime - b.rentWalkTime;
}

/**
 * 与えられた貸出地ポートデータから、最も台数が多いポートのデータを出力
 * 貸出不可の場合-1を格納
 * @param {Array<Object>} portDataArray 借りる場所のポートの情報リスト
 * @returns {Object} 貸出用データオブジェクト
 */
export function makeRentalPlaceData(portDataArray, { excludeUnavailable = EXCLUDE_UNAVAILABLE_PORTS, operatorKey } = {}) {
  let bestPort = null;

  for (const rawStation of portDataArray) {
    const station = operatorView(rawStation, operatorKey);
    // 貸出不可ならスキップ。貸し出し中の印があっても、自転車が 0 台なら借りられない
    if (!station.is_renting) continue;
    if (excludeUnavailable && !(Number(station.num_bikes_available) > 0)) continue;

    if (!bestPort) {
      bestPort = station;
      continue;
    }

    const isCurrentNonPri = bestPort.isNonPriorityPort === true;
    const isNewNonPri = station.isNonPriorityPort === true;
    if (isCurrentNonPri !== isNewNonPri) {
      // 現在の候補が非優先で新しいのが優先なら乗り換え
      if (isCurrentNonPri) bestPort = station;
      continue;
    }

    // 優先度が同じなら、ポートまでの徒歩が短いほう。徒歩時間を持たないときは比べない
    const walkDiff = walkCompare(station, bestPort);
    if (walkDiff < 0) { bestPort = station; continue; }
    if (walkDiff > 0) continue;

    // 徒歩も同じなら台数が多いほう
    if (station.num_bikes_available > bestPort.num_bikes_available) bestPort = station;
  }

  if (bestPort) {
    //debugLog('Best rental port selected:', bestPort.station_id, 'Bikes available:', bestPort.num_bikes_available);
    return {
      is_renting: true,
      rentportid: bestPort.station_id,
      num_bikes_available: bestPort.num_bikes_available,
      port_name: bestPort.name,
      isNonPriorityPort: bestPort.isNonPriorityPort,
      byOperator: bestPort.byOperator ?? null,  // 事業者ごとの内訳
      rent_walk_time: bestPort.rentWalkTime ?? null  // 出発地からこのポートまでの徒歩（分、#93）
    };
  } else {
    // 貸出可能なポートがない場合でも、候補ポートの情報を返す
    const firstPort = portDataArray?.[0];

    if (firstPort) {
      //debugLog('No rental ports available. Using first port as fallback:', firstPort.station_id);
      return {
        is_renting: false,
        rentportid: firstPort.station_id,
        num_bikes_available: firstPort.num_bikes_available,
        port_name: firstPort.name,  // ← ポート名を含める
        isNonPriorityPort: firstPort.isNonPriorityPort,
        byOperator: firstPort.byOperator ?? null,
        rent_walk_time: firstPort.rentWalkTime ?? null
      };
    }

    debugLog('No rental ports available at all');

    // portDataArrayが空の場合のみnullを返す
    return {
      is_renting: false,
      rentportid: -1,
      num_bikes_available: -1,
      port_name: null,
      isNonPriorityPort: null
    };
  }
}

/**
 * @abstract シェアサイクルの料金を計算する
 *
 * @detail 2 社で体系が違うので、運賃表を受け取って計算する。
 *         上限が無い事業者（ドコモ）もあるので maxfare は null を許す。
 *         借りる時間が maxtime を超えるか、0 以下なら -1 を返す。
 *
 * @param {number} rentaltime 借りる時間（分）
 * @param {object} [fare] 運賃表（config/fare/fareCycle）。既定は HELLO CYCLING
 * @returns {number} 料金。計算できなければ -1
 */
export function makeRentalCost(rentaltime, fare = FARE_HELLOCYCLING) {
  if (!(rentaltime > 0) || rentaltime > fare.maxtime) return -1;

  const hasCap = Number.isFinite(fare.maxfare);
  let cost = fare.initialfare;
  let rest = rentaltime - fare.initialtime;

  while (rest > 0 && (!hasCap || cost < fare.maxfare)) {
    cost += fare.additionalfare;
    rest -= fare.additionaltime;
  }

  if (hasCap && cost > fare.maxfare) cost = fare.maxfare;

  debugLog("Final rental cost:", cost, `(${fare.operator} / ${fare.planLabel})`);
  return cost;
}


/**
 * @abstract ポートがその時刻に開いているかを返す
 *
 * @detail GBFS のフィードに営業時間は入っていないので、アプリか現地で調べた値を
 *         cycleportlist.json の openingHours に手で持つ（"08:00-23:00" の形）。
 *         指定が無いポートは 24 時間営業として扱う。
 *
 *         閉店側だけ余裕を見る。バスや電車が遅れて到着が後ろにずれることがあるため。
 *         開店側に余裕を見ないのは、遅れると開店時刻には近づく（安全側に動く）から。
 *
 *         閉店が 24 時を超える表記（"07:00-24:55"）に対応する。
 *         開店より閉店が早い場合（"22:00-06:00" のような日跨ぎ）は、閉店を翌日とみなす。
 *
 * @param {string|null|undefined} openingHours - "HH:MM-HH:MM"。無ければ 24 時間営業
 * @param {string} timeHHMM - ポートに着く（出る）時刻
 * @param {number} closingBufferMin - 閉店前に見る余裕（分）
 * @returns {boolean}
 */
export function isPortOpenAt(openingHours, timeHHMM, closingBufferMin = CYCLE_PORT_CLOSING_BUFFER_MIN) {
  if (!openingHours) return true;  // 24 時間営業

  const parts = String(openingHours).split("-");
  if (parts.length !== 2) {
    debugWarn(`openingHours の形式が違います: ${openingHours}`);
    return true;  // 読めない指定でルートを消さない
  }

  let open, close, at;
  try {
    open = Utils.timeToMinutesExtended(parts[0].trim());
    close = Utils.timeToMinutesExtended(parts[1].trim());
    at = Utils.timeToMinutesExtended(timeHHMM);
  } catch (error) {
    debugWarn(`営業時間を読めませんでした（${openingHours} / ${timeHHMM}）: ${error.message}`);
    return true;
  }

  if (close <= open) close += 24 * 60;  // "22:00-06:00" のような日跨ぎ

  return at >= open && at <= close - closingBufferMin;
}

/**
 * @abstract その時刻に開いているポートだけに絞る
 * @param {Array<object>} ports - cycleportlist.json のポート（openingHours を持つことがある）
 * @param {string} timeHHMM - ポートに着く（出る）時刻
 * @param {number} [closingBufferMin]
 * @returns {Array<object>}
 */
export function filterPortsOpenAt(ports, timeHHMM, closingBufferMin = CYCLE_PORT_CLOSING_BUFFER_MIN) {
  return ports.filter((port) => {
    const open = isPortOpenAt(port.openingHours, timeHHMM, closingBufferMin);
    if (!open) debugLog(`営業時間外のため候補から外す: ${port.name}（${port.openingHours}、${timeHHMM} 着）`);
    return open;
  });
}

/**
 * @abstract 貸出ポートと返却ポートを、事業者をそろえて選ぶ
 *
 * @detail 借りた自転車は、その事業者が使えるポートにしか返せない。
 *         貸出と返却を別々に選ぶと、「ドコモでしか借りられないポートで借りて、
 *         HELLO CYCLING でしか返せないポートに返す」という案内が出てしまう
 *         （2026-10-09 に実際に発生。国大橋下で借りてコインパーク金港町第2 に返す案内）。
 *
 *         そこで事業者ごとに「借りられるポート」と「返せるポート」の組を作り、
 *         両方そろう事業者の中から選ぶ。複数そろうときは借りられる台数が多いほうを採る。
 *
 * @param {Array<object>} rentalPorts - 貸出候補（getPortData の結果）
 * @param {Array<object>} returnPorts - 返却候補（同上）
 * @param {{operators?: Set<string>, excludeUnavailable?: boolean}} [options]
 * @returns {{rental: object, return: object, operator: string|null}}
 */
export function selectCyclePortPair(rentalPorts, returnPorts, { operators, excludeUnavailable } = {}) {
  const opts = excludeUnavailable === undefined ? {} : { excludeUnavailable };
  const allowed = CYCLE_PROVIDER_KEYS.filter((key) => !operators || operators.has(key));

  let best = null;

  for (const operatorKey of allowed) {
    const rental = makeRentalPlaceData(rentalPorts, { ...opts, operatorKey });
    if (!rental.is_renting) continue;

    const returnPlace = makeReturnPlaceData(returnPorts, { ...opts, operatorKey });
    if (!returnPlace.is_returning) continue;

    // そろう事業者が複数あるときは、借りられる台数が多いほうを選ぶ
    if (!best || rental.num_bikes_available > best.rental.num_bikes_available) {
      best = { rental, return: returnPlace, operator: operatorKey };
    }
  }

  if (best) return best;

  // そろう事業者がない。画面に理由を出せるよう、絞らずに選んだ結果を返す
  // （is_renting / is_returning のどちらかが false になり、ルートは候補から外れる）
  return {
    rental: makeRentalPlaceData(rentalPorts, opts),
    return: makeReturnPlaceData(returnPorts, opts),
    operator: null,
  };
}

/**
 * @abstract 出発地からの徒歩を見て、貸出ポートと返却ポートを事業者をそろえて選ぶ
 *
 *         選んでいた。構内4ポートの徒歩時間を実測したので、ポートごとの徒歩で選ぶ。
 *
 *         - 徒歩時間が分からないポートは候補にしない（ほかのポートの値で代用しない）
 *         - 営業時間は、それぞれのポートに着く時刻で見る
 *         - 自転車の所要は今はどのポートでも同じなので、「返却ポートに早く着く」は
 *           「貸出ポートまでの徒歩が短い」と同じになる。徒歩が同じなら台数が多いほう
 *         - 返却ポートの営業時間は、選んだ貸出ポートから計算した到着時刻で見る
 *         - 事業者が複数そろうときも、徒歩が短いほう → 台数が多いほうで選ぶ
 *
 * @param {Array<object>} rentalPorts - 貸出候補（getPortData の結果）
 * @param {Array<object>} returnPorts - 返却候補（同上）
 * @param {object} options
 * @param {string} options.currentTime - 出発時刻 "HH:MM"
 * @param {number} options.bikeDuration - 自転車の所要（分）
 * @param {(port: object) => number|undefined} options.walkTimeOf - ポートまでの徒歩（分）
 * @param {Set<string>} [options.operators]
 * @param {boolean} [options.excludeUnavailable]
 * @returns {{rental: object, return: object, operator: string|null}}
 *          rental.rent_walk_time に選んだポートまでの徒歩が入る
 */
export function selectCyclePortPairByWalk(rentalPorts, returnPorts, {
  currentTime, bikeDuration, walkTimeOf, operators, excludeUnavailable,
} = {}) {
  const opts = excludeUnavailable === undefined ? {} : { excludeUnavailable };
  const allowed = CYCLE_PROVIDER_KEYS.filter((key) => !operators || operators.has(key));
  const start = Utils.timeToMinutesExtended(currentTime);

  const withWalk = rentalPorts
    .map((port) => ({ ...port, rentWalkTime: walkTimeOf(port) }))
    .filter((port) => {
      if (Number.isFinite(port.rentWalkTime)) return true;
      debugWarn(`出発地からの徒歩時間が無いため候補から外す: ${port.name}（${port.station_id}）`);
      return false;
    });
  const openRental = withWalk.filter((port) => {
    const arrive = Utils.minutesToTime(start + port.rentWalkTime);
    const open = isPortOpenAt(port.openingHours, arrive);
    if (!open) debugLog(`営業時間外のため候補から外す: ${port.name}（${port.openingHours}、${arrive} 着）`);
    return open;
  });
  const openReturnAfter = (rentWalkTime) =>
    filterPortsOpenAt(returnPorts, Utils.minutesToTime(start + rentWalkTime + bikeDuration));

  let best = null;

  for (const operatorKey of allowed) {
    const rental = makeRentalPlaceData(openRental, { ...opts, operatorKey });
    if (!rental.is_renting) continue;

    const returnPlace = makeReturnPlaceData(openReturnAfter(rental.rent_walk_time), { ...opts, operatorKey });
    if (!returnPlace.is_returning) continue;

    const better = !best
      || rental.rent_walk_time < best.rental.rent_walk_time
      || (rental.rent_walk_time === best.rental.rent_walk_time
        && rental.num_bikes_available > best.rental.num_bikes_available);
    if (better) best = { rental, return: returnPlace, operator: operatorKey };
  }

  if (best) return best;

  // そろう事業者がない。画面に理由を出せるよう、絞らずに選んだ結果を返す
  // （is_renting / is_returning のどちらかが false になり、ルートは候補から外れる）
  const rental = makeRentalPlaceData(openRental, opts);
  return {
    rental,
    return: makeReturnPlaceData(openReturnAfter(rental.rent_walk_time ?? 0), opts),
    operator: null,
  };
}
