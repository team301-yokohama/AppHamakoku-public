/**
 * @file odptRailway.js
 * @abstract ODPT の鉄道データ（駅の時刻表・走行中の列車・運行情報・駅名・種別名）を引く層
 *
 * はまこく Map の駅タップ（横浜駅から出る電車）のために足した。既存の
 * adapters/sotetsu2Yokohama.js・Mitsukami2Yokohama_dia.js は「ある駅から横浜駅へ着く便」を
 * odpt:TrainTimetable（1列車ぶんのダイヤ）から組むが、ここは逆で「ある駅から出る便」を
 * odpt:StationTimetable（1駅ぶんのダイヤ）から取る。用途が違うので別ファイルにしてある。
 *
 * API の癖（2026-10-18 に確認）:
 * - **駅の時刻表の深夜便は 24 時超え表記を使わない。** 「00:07」のように戻り、配列の並びでは
 *   当日ダイヤの末尾に来る。比べるときは utils.js の timeToMinutesExtended と同じ扱いにする
 * - **owl:sameAs のまとめ引きは10件まで。** 11件以上はカンマでつないでも
 *   `400 too many OR condition in owl:sameAs` になる。駅名はこの単位で引く
 * - 事業者によって、どちらの API に何があるかが違う（config/geo/stations/yokohamaStation.js の表）
 */

import { BASE, CHL_BASE, KEY, CHL_KEY } from "../../config/defaults.js";
import * as Utils from "../../utils/utils.js";
import { getCachedValue, getStaticCachedValue, REALTIME_CACHE_TTL_MS } from "../../utils/cache.js";
import { isValidAt, latestDcDate, noteFetched, noteGenerated, noteValidUntil } from "../../utils/dataTimes.js";
import { createDebugErrorLogger } from "../../utils/debug/debug.js";

const debugError = createDebugErrorLogger("odptRailway");

/** owl:sameAs のまとめ引きの上限。11件以上は 400 になる */
export const SAME_AS_BATCH = 10;

/** 本番とチャレンジの振り分け。`api` は "production" | "challenge" */
function endpoint(api) {
  return api === "production" ? { base: BASE, key: KEY } : { base: CHL_BASE, key: CHL_KEY };
}

/**
 * @abstract この機能に必要なキーが両方そろっているか
 *
 * 駅の時刻表はチャレンジ API（JR・京急・東急・相鉄）と本番 API（地下鉄）の両方を使う。
 * チャレンジの期間が終わったら機能ごと畳む決まりなので、片方でも欠けたら false にする
 */
export function hasRailwayKeys() {
  return Boolean(KEY && CHL_KEY);
}

/**
 * @abstract 駅の時刻表（odpt:StationTimetable）。方向×カレンダーで分かれた配列が返る
 * @param {{api: string, station: string}} line - yokohamaStation.js の1路線
 * @returns {Promise<object[]>}
 */
export function fetchStationTimetable({ api, station }) {
  const { base, key } = endpoint(api);
  // ダイヤ改正までは変わらないので無期限。プロセスを立て直すと取り直す（他の時刻表と同じ扱い）
  return getStaticCachedValue(`odpt:stationTimetable:${api}:${station}`, async () => {
    const timetable = await Utils.fetchJson(Utils.buildUrl(base, "odpt:StationTimetable", {
      "odpt:station": station,
      "acl:consumerKey": key,
    }), { timeout: 25000 });
    noteFetched(`timetable.station.${station}`); // 取得日時を画面に出す
    return timetable;
  });
}

/**
 * @abstract 走行中の列車（odpt:Train）。配信していない路線は空の配列
 * @param {{api: string, railway: string}} line
 * @returns {Promise<object[]>}
 */
export async function fetchTrains({ api, railway }) {
  const { base, key } = endpoint(api);
  const trains = await getCachedValue(`odpt:train:${api}:${railway}`, REALTIME_CACHE_TTL_MS, () =>
    Utils.fetchJson(Utils.buildUrl(base, "odpt:Train", {
      "odpt:railway": railway,
      "acl:consumerKey": key,
    }), { timeout: 15000 }));
  // 有効範囲（dct:valid）を過ぎた位置は使わない（2.1.2）。キャッシュで寝かせているあいだに切れたものも、
  // 取り出すたびに外す。生成時刻（dc:date）を画面に出す（#220。2.1.1）
  const valid = Array.isArray(trains) ? trains.filter((train) => isValidAt(train)) : trains;
  noteGenerated(`train.${railway}`, latestDcDate(valid));
  noteValidUntil(`train.${railway}`, valid);
  return valid;
}

/**
 * @abstract 運行情報（odpt:TrainInformation）。配信していない路線（京急・相鉄）は空の配列
 * @param {{api: string, railway: string}} line
 * @returns {Promise<object[]>}
 */
export async function fetchTrainInformation({ api, railway }) {
  const { base, key } = endpoint(api);
  const information = await getCachedValue(`odpt:trainInformation:${api}:${railway}`, REALTIME_CACHE_TTL_MS, () =>
    Utils.fetchJson(Utils.buildUrl(base, "odpt:TrainInformation", {
      "odpt:railway": railway,
      "acl:consumerKey": key,
    }), { timeout: 15000 }));
  const valid = Array.isArray(information) ? information.filter((item) => isValidAt(item)) : information;
  noteGenerated(`info.${railway}`, latestDcDate(valid));
  noteValidUntil(`info.${railway}`, valid);
  return valid;
}

/**
 * @abstract 種別の日本語名（odpt:TrainType）。全件でも 71 件・23KB なのでまとめて引く
 * @param {string} api
 * @returns {Promise<Record<string, string>>} 種別 id → 日本語名
 */
export function fetchTrainTypeTitles(api) {
  const { base, key } = endpoint(api);
  return getStaticCachedValue(`odpt:trainType:${api}`, async () => {
    const list = await Utils.fetchJson(Utils.buildUrl(base, "odpt:TrainType", {
      "acl:consumerKey": key,
    }), { timeout: 20000 });
    return Object.fromEntries(list.map((t) => [t["owl:sameAs"], t["dc:title"]]).filter(([, title]) => title));
  });
}

/**
 * @abstract 駅名の日本語（odpt:Station）。10件ずつしか引けないので、まだ知らない駅だけまとめて引く
 *
 * 行先には他社の駅も出る（東横線の保谷＝西武、横須賀線の成田空港＝JR の別路線など）。
 * 事業者ごとに全駅を引くと 16 事業者で 1.2MB になるので、出てきた駅だけを引く。
 * 駅名は変わらないので、一度引いたらプロセスの間ずっと使う
 *
 * @param {string} api
 * @param {string[]} ids - 駅の id（odpt.Station:...）
 * @returns {Promise<Record<string, string>>} 駅 id → 日本語名（引けなかったものは入らない）
 */
export async function fetchStationTitles(api, ids) {
  const { base, key } = endpoint(api);
  const known = stationTitleStore(api);
  const missing = [...new Set(ids)].filter((id) => typeof id === "string" && !known.has(id));

  for (let i = 0; i < missing.length; i += SAME_AS_BATCH) {
    const chunk = missing.slice(i, i + SAME_AS_BATCH);
    try {
      const list = await Utils.fetchJson(Utils.buildUrl(base, "odpt:Station", {
        "owl:sameAs": chunk.join(","),
        "acl:consumerKey": key,
      }), { timeout: 20000 });
      for (const station of list) {
        if (station["owl:sameAs"] && station["dc:title"]) known.set(station["owl:sameAs"], station["dc:title"]);
      }
    } catch (error) {
      // 駅名が引けなくても発車時刻は出せる。呼び出し側が id から仮の名前を作る
      debugError(`駅名を取得できませんでした（${chunk.length}件）: ${error?.message ?? error}`);
    }
  }
  return Object.fromEntries(known);
}

// 駅名の覚え書き。API ごとに分ける（本番とチャレンジで持っている駅が違う）
const stationTitles = new Map();
function stationTitleStore(api) {
  let store = stationTitles.get(api);
  if (!store) stationTitles.set(api, (store = new Map()));
  return store;
}

/** テスト用。覚えた駅名を忘れる */
export function clearStationTitles() {
  stationTitles.clear();
}
