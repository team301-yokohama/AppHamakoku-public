// はまこく Map のサーバ側。ページの配信とマップ用の API をまとめた Express の Router を返す。
//
// 常盤祭までは hamakokuex と同じ Node（app_v1）に相乗りする（ADR-0030）。
// あとで別プロセスに切り出せるよう、express や キャッシュ・取得の関数は自分で import せず
// app_v1 から受け取る（このフォルダには node_modules が無いため）。
//
//   app.use('/hamakokumap', createHamakokumapRouter({ express, getCachedValue, fetchJson }));

import { demoBusesBody, demoStatusBody, loadDemoGeometry } from "./demo.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 日付は YYYY-MM-DD で、実在して、決めた範囲の中にあるものだけを受ける。
// 日付がそのままキャッシュのキーになるので、自由な文字列を通すと、キーが無限に増える。
// app_v1/services/mainLogic/searchQuery.js の isServiceDate と同じ規則（このフォルダは app_v1 を import しない）
const DATE_MIN = "2020-01-01";
const DATE_MAX = "2030-12-31";
export function isServiceDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (value < DATE_MIN || value > DATE_MAX) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // 2026-02-30 のような存在しない日付は、繰り上がって別の日になるので弾く
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// このフォルダ（hamakokumap/）。cwd に依存しないよう、このファイルの位置から決める
const MAP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 外に出してよいファイル。update.js などの作業用スクリプトや server/ は配らない
const PUBLIC_FILE = /^\/(index\.html|ports\.js|ports\.json|[\w-]+\.svg|icons\/[\w-]+\.(svg|png|ico|webmanifest))$/;

// はまこく Exp. のワードマーク。brand/hamakoku/ を正とし、コピーを置かない
// （ロゴは確定。別案が出たら #169）
const BRAND_DIR = path.resolve(MAP_DIR, "..", "brand", "hamakoku");
const BRAND_FILE = /^\/brand\/[\w-]+\.svg$/;

// リアルタイムの空き台数。api-public はキー不要
export const STATUS_FEEDS = {
  hellocycling: "https://api-public.odpt.org/api/v4/gbfs/hellocycling/station_status.json",
  docomo: "https://api-public.odpt.org/api/v4/gbfs/docomo-cycle/station_status.json",
};

const DEFAULT_TTL_MS = 60 * 1000;

// 走っているバスの位置。
// ODPT の本番 API はキーが要るので、台数（api-public）と違ってブラウザからは取れない。
// サーバが鍵を持ち、地図に写る範囲のバスだけに絞って返す
const ODPT_BASE = "https://api.odpt.org/api/v4/";
export const BUS_OPERATOR = "odpt.Operator:YokohamaMunicipal";
// odpt:Bus の odpt:frequency が 30 秒なので、それより短くしても位置は動かない
export const BUS_TTL_MS = 30 * 1000;
// 停留所の名前は変わらない。行先の表示にしか使わないので、長めに持つ
const BUSSTOP_TTL_MS = 12 * 60 * 60 * 1000;
// バス停ごとの時刻表。市営バスの便には遅れが載るので、台数と同じ 60 秒で取り直す。
// 時刻表そのものは各 adapter が持っている（getStaticCachedValue）ので、取り直しても重くならない
const TIMETABLE_TTL_MS = 60 * 1000;
// 1台ぶんの時刻表（odpt:BusTimetable、#178）。便のダイヤは変わらないので長めに持つ
const BUS_TIMETABLE_TTL_MS = 12 * 60 * 60 * 1000;
// 横浜駅から出る電車。「次の3本」は時刻で変わり、遅れも載るのでバス停の時刻表と同じ 60 秒
const TRAINS_TTL_MS = 60 * 1000;

// odpt:OccupancyStatus の日本語。空いている順
export const OCCUPANCY_LABEL = {
  Empty: "空いている",
  ManySeatsAvailable: "空いている",
  FewSeatsAvailable: "座席がうまる",
  StandingRoomOnly: "立ち席あり",
  CrushedStandingRoomOnly: "混雑",
  FullRoomOnly: "満員",
  NotAcceptingPassengers: "乗車できません",
};

// マップのページに当てる CSP。helmet は app_v1 側で掛ける（ここでは import しない）
export const HAMAKOKUMAP_CSP_DIRECTIVES = {
  // ページ内の <script> は nonce で許す（'unsafe-inline' は付けない。#210）。
  // nonce は app_v1 が画面ごとに作って res.locals.cspNonce に入れる。ページは下の配信で、<script> に付けて返す
  "script-src": ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
  // 外部の CSS と書体は Google Fonts だけ（既定は https: 全部）
  "style-src": ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
  "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
  // 台数とバスの位置は自分のサーバ（/hamakokumap/api/...）からだけ取る
  "connect-src": ["'self'"],
  // キャンパス図は <object> で読む（SVG 内の prefers-color-scheme を効かせるため）
  "object-src": ["'self'"],
  // hamakokuex と同じく、HTTP のままでも動くようにする（#149 でリダイレクトが入れば外せる）
  "upgrade-insecure-requests": null,
};

/**
 * ports.json に載っているポートの、事業者ごとの station_id を集める。
 * 台数の応答をマップに出すポートだけに絞るのに使う。読めなければ null（絞らない）
 *
 * @param {string} portsJsonPath
 * @returns {Record<string, Set<string>> | null}
 */
export function loadFeedIds(portsJsonPath) {
  try {
    const data = JSON.parse(readFileSync(portsJsonPath, "utf-8"));
    const ids = {};
    for (const area of data.areas ?? []) {
      for (const port of area.ports ?? []) {
        for (const [op, id] of Object.entries(port.feedIds ?? {})) {
          (ids[op] ??= new Set()).add(String(id));
        }
      }
    }
    return ids;
  } catch {
    return null;
  }
}

/**
 * ports.json からエリアの bbox を読む。地図に写る範囲のバスだけに絞るのに使う。
 * 読めなければ空の配列（バスは1台も返らない）
 *
 * @param {string} portsJsonPath
 * @returns {{id: string, bbox: {latMin:number, latMax:number, lonMin:number, lonMax:number}}[]}
 */
export function loadAreaBboxes(portsJsonPath) {
  try {
    const data = JSON.parse(readFileSync(portsJsonPath, "utf-8"));
    return (data.areas ?? []).filter((a) => a.bbox).map((a) => ({ id: a.id, bbox: a.bbox }));
  } catch {
    return [];
  }
}

/**
 * GTFS から焼いた系統ごとの経路の形を読み、地図のエリアに掛かる分だけに絞る。
 *
 * 全国分そのままだと 1.8MB あるが、エリアのまわりだけに切り落とすと 100KB ほどで済む。
 * 画面はこれを使って、30 秒ごとにしか来ないバスの位置を道なりに動かす。
 * 作られていない（`npm run update:gtfs` がまだ）ときは空を返し、画面は直線で動かす
 *
 * @param {string} shapesJsonPath
 * @param {{bbox:object}[]} areas
 * @param {number} pad - エリアの外にどれだけはみ出して残すか（度）。経路が途中で切れないように
 * @returns {Record<string, number[][][]>} 系統番号 → 線（点の列）の配列
 */
export function loadBusShapes(shapesJsonPath, areas, pad = 0.004) {
  if (!areas.length) return {};
  let routes;
  try {
    routes = JSON.parse(readFileSync(shapesJsonPath, "utf-8")).routes ?? {};
  } catch {
    return {};
  }

  const near = (lat, lon) => areas.some(({ bbox }) =>
    lat >= bbox.latMin - pad && lat <= bbox.latMax + pad && lon >= bbox.lonMin - pad && lon <= bbox.lonMax + pad);

  const out = {};
  for (const [routeId, lines] of Object.entries(routes)) {
    const kept = [];
    for (const line of lines) {
      // 範囲に入っている点の連なりだけを残す。出入りを繰り返す経路は複数本に割れる
      let run = [];
      for (const point of line) {
        if (near(point[0], point[1])) run.push(point);
        else { if (run.length >= 2) kept.push(run); run = []; }
      }
      if (run.length >= 2) kept.push(run);
    }
    if (kept.length) out[routeId] = kept;
  }
  return out;
}

/**
 * バスが地図のどれかのエリアの範囲に入っているか
 * @param {object} bus - odpt:Bus の1件
 * @param {{bbox:object}[]} areas
 */
export function isInAnyArea(bus, areas) {
  const lat = bus["geo:lat"];
  const lon = bus["geo:long"];
  if (typeof lat !== "number" || typeof lon !== "number") return false;
  return areas.some(({ bbox }) => lat >= bbox.latMin && lat <= bbox.latMax && lon >= bbox.lonMin && lon <= bbox.lonMax);
}

// 「HH:mm」を分に。0:00〜3:59 は前日ダイヤの 24:00〜27:59 として扱う（utils.js の timeToMinutesExtended と同じ考え）。
// 24 時を超える表記（25:10）はそのまま足す
function extendedMinutes(hhmm) {
  if (typeof hhmm !== "string" || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return (h < 4 ? h + 24 : h) * 60 + m;
}

// 分を「HH:mm」に戻す（24 時を超えたら 0 時に回す）
function minutesToHhmm(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * 日本時間の「いま」を、時刻表と同じ分の数え方（0:00〜3:59 は 24 時台）にする
 * @param {Date} date
 */
export function japanExtendedMinutes(date) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const h = jst.getUTCHours();
  return (h < 4 ? h + 24 : h) * 60 + jst.getUTCMinutes();
}

/**
 * 走っているバスの遅れと、この先止まるバス停の到着見込みを求める。
 *
 * 遅れは「直前のバス停を通った時刻（odpt:fromBusstopPoleTime）− そのバス停の予定時刻」。
 * 通った時刻が無いときは「次のバス停の予定時刻を、いま過ぎている分」で下から見積もる
 * （まだ着いていないので、少なくともそれだけは遅れている）。早く走っているときは 0 とする。
 * 到着見込みは「予定時刻 ＋ いまの遅れ」。
 *
 * @param {object} bus - odpt:Bus の1件
 * @param {object | null} timetable - そのバスの odpt:BusTimetable
 * @param {Record<string,string>} poleName - 停留所の id → 名前
 * @param {Date} now
 * @returns {{delay: number | null, stops: {name: string, time: string, expected: string, kind: string}[]} | null}
 */
export function busProgress(bus, timetable, poleName = {}, now = new Date()) {
  const objects = [...(timetable?.["odpt:busTimetableObject"] ?? [])]
    .sort((a, b) => (a["odpt:index"] ?? 0) - (b["odpt:index"] ?? 0));
  if (!objects.length) return null;
  const planned = (o) => extendedMinutes(o["odpt:arrivalTime"] ?? o["odpt:departureTime"]);
  const fromIdx = objects.findIndex((o) => o["odpt:busstopPole"] === bus["odpt:fromBusstopPole"]);
  let toIdx = objects.findIndex((o, i) => i > fromIdx && o["odpt:busstopPole"] === bus["odpt:toBusstopPole"]);
  if (toIdx < 0 && fromIdx >= 0 && fromIdx + 1 < objects.length) toIdx = fromIdx + 1;

  let delay = null;
  const passedAt = bus["odpt:fromBusstopPoleTime"] ? new Date(bus["odpt:fromBusstopPoleTime"]) : null;
  const plannedFrom = fromIdx >= 0 ? planned(objects[fromIdx]) : null;
  const plannedTo = toIdx >= 0 ? planned(objects[toIdx]) : null;
  if (passedAt && !isNaN(passedAt) && plannedFrom !== null) {
    delay = Math.max(0, japanExtendedMinutes(passedAt) - plannedFrom);
  } else if (plannedTo !== null) {
    delay = Math.max(0, japanExtendedMinutes(now) - plannedTo);
  }

  // 次に止まるバス停・その次・終点（重なるものは1つにする）
  const last = objects.length - 1;
  const picks = toIdx < 0 ? [] : [...new Set([toIdx, toIdx + 1, last].filter((i) => i >= toIdx && i <= last))];
  const stops = picks.map((i) => {
    const t = planned(objects[i]);
    return {
      name: poleName[objects[i]["odpt:busstopPole"]] ?? null,
      time: t === null ? null : minutesToHhmm(t),
      expected: t === null ? null : minutesToHhmm(t + (delay ?? 0)),
      kind: i === last ? "terminal" : i === toIdx ? "next" : "via",
    };
  }).filter((st) => st.name && st.time);
  return { delay, stops };
}

/**
 * odpt:Bus の応答を、地図に写るバスだけに絞って縮める。
 * 1台が2つのエリアに入ることは無い（bbox が離れている）が、入るなら両方に出す
 *
 * @param {object[]} buses - odpt:Bus の配列
 * @param {{id:string, bbox:object}[]} areas
 * @param {Record<string,string>} poleName - 停留所の id → 名前
 * @param {Map<string, {delay: number|null, stops: object[]}>} [progress] - 車両の id → 遅れと到着見込み
 * @returns {Record<string, object[]>} エリアごとのバス
 */
export function pickBuses(buses, areas, poleName = {}, progress = new Map()) {
  const byArea = {};
  for (const { id, bbox } of areas) {
    byArea[id] = [];
    for (const bus of buses) {
      const lat = bus["geo:lat"];
      const lon = bus["geo:long"];
      if (typeof lat !== "number" || typeof lon !== "number") continue;
      if (lat < bbox.latMin || lat > bbox.latMax || lon < bbox.lonMin || lon > bbox.lonMax) continue;
      const status = bus["odpt:occupancyStatus"]?.split(":").pop();
      // odpt:busNumber は車両の番号。同じ系統が並ぶので、これで見分ける
      const busId = bus["owl:sameAs"] ?? `${bus["odpt:busroute"]}.${bus["odpt:busNumber"]}`;
      const p = progress.get(busId);
      byArea[id].push({
        id: busId,
        lat,
        lon,
        // 0 が北、時計回り。進む向きの矢印に使う
        azimuth: typeof bus["odpt:azimuth"] === "number" ? bus["odpt:azimuth"] : null,
        // odpt.Busroute:YokohamaMunicipal.036 の末尾が系統番号
        route: bus["odpt:busroute"]?.split(".").pop() ?? null,
        terminal: poleName[bus["odpt:terminalBusstopPole"]] ?? null,
        next: poleName[bus["odpt:toBusstopPole"]] ?? null,
        occupancy: status ? (OCCUPANCY_LABEL[status] ?? null) : null,
        reportedAt: bus["dc:date"] ?? null,
        // 有効期限（dct:valid）。画面は次に取り直すまでのあいだ、これを過ぎた位置を外す
        validUntil: bus["dct:valid"] ?? null,
        // 遅れ（分）と、この先のバス停の到着見込み。時刻表が取れなければ null / []
        delay: p?.delay ?? null,
        stops: p?.stops ?? [],
      });
    }
  }
  return byArea;
}

/** dct:valid を過ぎていないか。無い・読めないときは有効とみなす */
function isValidNow(item, nowMs) {
  const until = Date.parse(item?.["dct:valid"]);
  return Number.isNaN(until) || until >= nowMs;
}

/**
 * ODPT の応答のうち、最も新しい dc:date（ISO 8601）を返す。無ければ null
 */
function latestDcDate(items) {
  let latest = null;
  for (const item of items) {
    const t = Date.parse(item?.["dc:date"]);
    if (!Number.isNaN(t) && (latest === null || t > latest)) latest = t;
  }
  return latest === null ? null : new Date(latest).toISOString();
}

/**
 * GBFS の station_status.json の応答を、マップで使う項目だけに縮める
 *
 * @param {object} body - station_status.json の中身
 * @param {Set<string> | undefined} keepIds - 残す station_id（未指定なら全部）
 */
export function pickStatus(body, keepIds) {
  const stations = body?.data?.stations;
  if (!Array.isArray(stations)) throw new Error("station_status の形式が想定と違います");
  return {
    lastUpdated: body.last_updated ?? null,
    stations: stations
      .filter((st) => !keepIds || keepIds.has(String(st.station_id)))
      .map((st) => ({
        station_id: String(st.station_id),
        num_bikes_available: st.num_bikes_available ?? null,
        num_docks_available: st.num_docks_available ?? null,
        is_renting: st.is_renting ?? null,
        is_returning: st.is_returning ?? null,
      })),
  };
}

/**
 * @param {object} deps
 * @param {typeof import("express")} deps.express
 * @param {(key: string, ttlMs: number, loader: () => Promise<any>) => Promise<any>} deps.getCachedValue
 * @param {(url: string, opts?: object) => Promise<any>} deps.fetchJson
 * @param {number} [deps.ttlMs] - 台数のキャッシュ時間
 * @param {string} [deps.odptKey] - ODPT 本番 API のキー。無ければバスの位置は配らない
 * @param {(serviceDay: Date) => Promise<{stops: object, errors: string[]}>} [deps.getBusDepartures]
 *        バス停ごとの発車時刻。渡されなければその口は 503
 * @param {(serviceDay: Date) => Promise<{operators: object[], errors: string[]}>} [deps.getTrainDepartures]
 *        横浜駅から出る電車。チャレンジ API のキーが無いときは渡されず、その口は 503
 * @param {(req: object, res: object) => Promise<void>} [deps.postReport]
 *        報告の受け口。はまこく Exp. と同じものを受け取る。止めているときは渡されない
 * @param {{value: string, label: string}[]} [deps.reportKinds] - 報告の種類（マップで出すぶんだけ）
 * @param {string} [deps.mapDir] - ページのファイルがあるフォルダ（テスト用）
 */
export function createHamakokumapRouter({ express, getCachedValue, fetchJson, ttlMs = DEFAULT_TTL_MS, odptKey, getBusDepartures, getTrainDepartures, postReport, reportKinds = [], mapDir = MAP_DIR, demo = {} }) {
  const router = express.Router();
  // 仮データでの表示。切り替えと帯は app_v1/demo/ が持ち、app.js から渡される。渡されなければ、仮データは使わない。
  // 作り物の中身は ./demo.js
  const demoApi = { enabled: () => false, bannerVisible: () => false, withDemo: (_label, real) => real(), ...demo };
  let demoGeometry = null;
  const getDemoGeometry = () => (demoGeometry ??= loadDemoGeometry(path.join(mapDir, "ports.json")));
  const feedIds = loadFeedIds(path.join(mapDir, "ports.json"));
  const areaBboxes = loadAreaBboxes(path.join(mapDir, "ports.json"));
  // 経路の形は GTFS から焼いた固定のデータなので、起動時に1回だけ読む
  const busShapes = loadBusShapes(path.join(mapDir, "..", "app_v1", "apidata", "gtfs", "yokohamaMunicipalBus", "shapes.json"), areaBboxes);

  // /hamakokumap → /hamakokumap/。末尾の / が無いと、ページ内の相対パス（ports.js など）がずれる
  router.use((req, res, next) => {
    const pathname = req.originalUrl.split("?")[0];
    if (req.path === "/" && !pathname.endsWith("/")) {
      return res.redirect(301, req.baseUrl + "/" + req.originalUrl.slice(pathname.length));
    }
    next();
  });

  // 事業者ごとの空き台数。複数人が同時に開いても、ODPT へは ttlMs に1回だけ取りに行く
  router.get("/api/status", async (req, res) => {
    const ops = Object.keys(STATUS_FEEDS);
    const results = await Promise.allSettled(ops.map((op) =>
      getCachedValue(`hamakokumap:status:${op}`, ttlMs, async () =>
        pickStatus(await demoApi.withDemo(`台数(${op})`, () => fetchJson(STATUS_FEEDS[op], { timeout: 10000 }),
          () => demoStatusBody(feedIds?.[op]), (body) => !Array.isArray(body?.data?.stations) || body.data.stations.length === 0), feedIds?.[op]))
    ));

    const operators = {};
    ops.forEach((op, i) => {
      const r = results[i];
      if (r.status === "fulfilled") {
        operators[op] = r.value;
      } else {
        console.warn(`[hamakokumap] ${op} の台数を取得できませんでした: ${r.reason?.message ?? r.reason}`);
        operators[op] = { error: "取得できませんでした" };
      }
    });

    res.set("Cache-Control", "no-store");
    res.json({ operators, demo: demoApi.bannerVisible() });
  });

  // 走っているバスの位置。キーが要るので、サーバが持っているときだけ答える。
  // 相鉄バスは車両位置を配信していないので、ここに出るのは横浜市営バスだけ
  router.get("/api/buses", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!odptKey && !demoApi.enabled()) return res.status(503).json({ error: "バスの位置は取得できません" });

    // 実データでの応答。キーが無いとき・取得に失敗したときは、仮データに切り替える
    const realBody = async () => {
      if (!odptKey) throw new Error("ODPT のキーがありません");
      const [poleName, buses] = await Promise.all([
        // 停留所の名前（行先の表示用）。2500 件あるので、id → 名前 に縮めてから持つ
        getCachedValue("hamakokumap:busstops", BUSSTOP_TTL_MS, async () => {
          const poles = await fetchJson(busUrl("odpt:BusstopPole"), { timeout: 15000 });
          return Object.fromEntries(poles.map((p) => [p["owl:sameAs"], p["dc:title"]]).filter(([, t]) => t));
        }),
        getCachedValue("hamakokumap:buses", BUS_TTL_MS, () => fetchJson(busUrl("odpt:Bus"), { timeout: 10000 })),
      ]);

      // 地図に写っているバスだけ、1台ずつ時刻表を引いて遅れを出す。
      // まとめ引き（owl:sameAs の繰り返し）は上流がタイムアウトするので使わない。1台が取れなくても他は出す
      const now = new Date();
      // 30 秒キャッシュのあいだに dct:valid（生成から約 36 秒）を過ぎた位置は出さない（ODPT ガイドライン 2.1.2）
      const live = buses.filter((bus) => isValidNow(bus, now.getTime()));
      const shown = live.filter((bus) => bus["odpt:busTimetable"] && isInAnyArea(bus, areaBboxes));
      const progress = new Map();
      await Promise.allSettled(shown.map(async (bus) => {
        const ref = bus["odpt:busTimetable"];
        const list = await getCachedValue(`hamakokumap:bustimetable:${ref}`, BUS_TIMETABLE_TTL_MS, () =>
          fetchJson(`${busUrl("odpt:BusTimetable")}&owl:sameAs=${encodeURIComponent(ref)}`, { timeout: 10000 }));
        const p = busProgress(bus, Array.isArray(list) ? list[0] : null, poleName, now);
        if (p) progress.set(bus["owl:sameAs"] ?? `${bus["odpt:busroute"]}.${bus["odpt:busNumber"]}`, p);
      }));

      // 位置を事業者が観測した時刻（dc:date）のうち最も新しいもの。画面に「何時時点」と出す（ODPT ガイドライン 2.1.1）
      return { areas: pickBuses(live, areaBboxes, poleName, progress), fetchedAt: Date.now(), reportedAt: latestDcDate(shown) };
    };

    try {
      const body = await demoApi.withDemo("バスの位置", realBody, () => demoBusesBody(getDemoGeometry()));
      res.json({ ...body, demo: demoApi.bannerVisible() });
    } catch (error) {
      console.warn(`[hamakokumap] バスの位置を取得できませんでした: ${error?.message ?? error}`);
      res.status(502).json({ error: "取得できませんでした" });
    }
  });

  // 走っているバスを道なりに動かすための、系統ごとの経路の形。
  // GTFS から焼いたものなので変わらない。1回読んで持っておく
  router.get("/api/busShapes", (req, res) => {
    res.set("Cache-Control", "public, max-age=3600");
    res.json({ routes: busShapes });
  });

  // バス停ごとの横浜駅方面の発車時刻。
  // 時刻表はどの事業者もキーが要るので、位置と同じくサーバからしか配れない
  router.get("/api/timetable", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!getBusDepartures) return res.status(503).json({ error: "時刻表は取得できません" });

    // 日付は YYYY-MM-DD だけ受ける。平日／土休日の判定に使うので、変な値は今日に倒さず弾く
    const date = typeof req.query.date === "string" ? req.query.date : "";
    if (date && !isServiceDate(date)) return res.status(400).json({ error: "date は YYYY-MM-DD で指定してください" });
    const serviceDay = date ? new Date(`${date}T00:00:00+09:00`) : new Date();
    const key = date || new Date().toISOString().slice(0, 10);

    try {
      const body = await getCachedValue(`hamakokumap:timetable:${key}`, TIMETABLE_TTL_MS, () => getBusDepartures(serviceDay));
      res.json({ date: key, ...body, demo: demoApi.bannerVisible() });
    } catch (error) {
      console.warn(`[hamakokumap] 時刻表を取得できませんでした: ${error?.message ?? error}`);
      res.status(502).json({ error: "取得できませんでした" });
    }
  });

  // 横浜駅から出る電車の次の3本。
  // 駅の時刻表はチャレンジ API（JR・京急・東急・相鉄）と本番 API（地下鉄）にまたがるので、
  // バス停の時刻表と同じくサーバからしか配れない。キーが無いときは渡されず、ここは 503 になる
  // （チャレンジの期間が終わったら画面から機能ごと消える、という決まり。#100）
  router.get("/api/trains", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!getTrainDepartures) return res.status(503).json({ error: "電車の発車時刻は取得できません" });

    // date は平日／土休日の判定にだけ使う。「次の3本」はいまの時刻で決まる
    const date = typeof req.query.date === "string" ? req.query.date : "";
    if (date && !isServiceDate(date)) return res.status(400).json({ error: "date は YYYY-MM-DD で指定してください" });
    const serviceDay = date ? new Date(`${date}T00:00:00+09:00`) : new Date();
    const key = date || new Date().toISOString().slice(0, 10);

    try {
      // fetchedAt は「この中身を作った時刻」。画面はダイヤの取得時刻として出す。
      // キャッシュ（60 秒）に乗った応答は、その作られた時刻のまま返る
      const body = await getCachedValue(`hamakokumap:trains:${key}`, TRAINS_TTL_MS, async () => ({
        ...(await getTrainDepartures(serviceDay)),
        fetchedAt: Date.now(),
      }));
      res.json({ date: key, ...body, demo: demoApi.bannerVisible() });
    } catch (error) {
      console.warn(`[hamakokumap] 電車の発車時刻を取得できませんでした: ${error?.message ?? error}`);
      res.status(502).json({ error: "取得できませんでした" });
    }
  });

  // 報告の種類。画面はこれを読んで選択肢を作る。止めているときは空で返す
  router.get("/api/report-kinds", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ kinds: postReport ? reportKinds : [] });
  });

  // 報告の受け口。はまこく Exp. と同じ関数を呼ぶので、連投の制限と1日の上限は共通。
  // app_v1 側の express.json() はこの Router より後ろに付いているので、ここで自分で付ける
  if (postReport) router.post("/api/report", express.json({ limit: "64kb" }), postReport);

  function busUrl(type) {
    return `${ODPT_BASE}${type}?odpt:operator=${BUS_OPERATOR}&acl:consumerKey=${encodeURIComponent(odptKey)}`;
  }

  // ページ。決めたファイルだけを配る
  const serveStatic = express.static(mapDir, { index: "index.html" });
  // トップのページ（index.html）は、CSP の nonce を <script> に付けて返す。
  // nonce が無いとき（テストなど、CSP を掛けていない呼び方）は、そのまま配る
  let indexHtml; // 最初に使うときに1回だけ読む
  const serveIndex = (req, res, next) => {
    const nonce = res.locals?.cspNonce;
    if (!nonce) return serveStatic(req, res, next);
    try {
      indexHtml ??= readFileSync(path.join(mapDir, "index.html"), "utf-8");
    } catch {
      return serveStatic(req, res, next); // 読めなければ、いつもの配信（404 など）に任せる
    }
    res.set("Cache-Control", "no-cache"); // nonce が画面ごとに変わるので、使い回さない
    res.type("html").send(indexHtml.replace(/<script>/g, `<script nonce="${nonce}">`));
  };
  const serveBrand = express.static(BRAND_DIR, { index: false });
  router.use((req, res, next) => {
    if (req.path === "/" || req.path === "/index.html") return serveIndex(req, res, next);
    if (PUBLIC_FILE.test(req.path)) return serveStatic(req, res, next);
    // /hamakokumap/brand/wordmark-exp.svg → brand/hamakoku/wordmark-exp.svg
    if (BRAND_FILE.test(req.path)) {
      req.url = req.url.slice("/brand".length);
      return serveBrand(req, res, next);
    }
    next();
  });

  return router;
}
