/**
 * @file trainDepartures.js
 * @abstract 横浜駅から出る電車の「次の3本」
 *
 * はまこく Map の横浜駅の地図で、駅の印をタップしたときに出す。
 * バス停の発車時刻（busDepartures.js、#53）と同じ考えを電車に広げたもので、違いは3つ:
 *
 * - バス停は「横浜駅方面」の片道だが、駅は**横浜駅から出る電車**なので両方向とも出す
 * - 本数が多い（1駅1方向で 110〜330 本）ので、**絞り込みはサーバでやる**。
 *   当日の全便は返さない（バス停の欄のような「当日の全便」は駅には置かない）
 * - 路線ごとに取れるものが違う。遅れが出せるのは JR と地下鉄だけで、運行情報が取れるのは
 *   JR・東急・地下鉄だけ。取れないことを画面で言い分けられるよう、路線ごとに印を返す
 *   （どの路線で何が取れるかは config/geo/stations/yokohamaStation.js の表）
 */

import { getDataTimes } from "../../utils/dataTimes.js";
import { withDemo } from "../../demo/index.js";
import { demoTrainDepartures } from "../../demo/trains.js";
import {
  fetchStationTimetable,
  fetchStationTitles,
  fetchTrainInformation,
  fetchTrainTypeTitles,
  fetchTrains,
} from "../adapters/odptRailway.js";
import { YOKOHAMA_RAIL_LINES, YOKOHAMA_RAIL_OPERATORS } from "../../config/geo/stations/yokohamaStation.js";
import isHolidaySotetsu from "../../utils/date/isHolidaySotetsu.js";
import { timeToMinutesExtended } from "../../utils/utils.js";
import { debugError } from "../../utils/debug/debug.js";

/** 1方向につき何本出すか（#186 で決めた「路線ごとに次の3本」） */
export const UPCOMING_PER_DIRECTION = 3;

/**
 * @abstract odpt の id の末尾を取り出す（方向・カレンダーの判別と、名前が引けなかったときの代わり）
 *
 * コロンの前に種類、後ろに中身が入る。中身の区切りはドットだが、中身が1つしか無いものもある:
 *   odpt.Station:JR-East.Tokaido.Odawara → Odawara
 *   odpt.RailDirection:Inbound          → Inbound
 *   odpt.Calendar:SaturdayHoliday       → SaturdayHoliday
 * ドットだけで切ると後ろ2つが「RailDirection:Inbound」になるので、先にコロンで落とす
 */
function tailOf(id) {
  if (typeof id !== "string") return null;
  const body = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  return body.split(".").pop() || body;
}

/**
 * @abstract Date を「日本の暦日の 0 時」に直す
 *
 * router は `new Date("2026-10-17T00:00:00+09:00")` のような形で日付を渡してくるが、
 * isHolidaySotetsu は getDay() / getDate() を使うので、**動かしている環境のタイムゾーンで
 * 曜日が変わってしまう**。UTC で動かすと上の値は 10-16 の金曜になり、土曜に平日ダイヤを引く。
 * 日本時間の年月日を取り出し、その日の地方時 0 時として組み直せば、どこで動かしても同じ曜日になる
 *
 * @param {Date} date
 * @returns {Date}
 */
export function japanCalendarDate(date) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return new Date(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate());
}

/**
 * @abstract その日が平日ダイヤか土休日ダイヤか
 *
 * 横浜駅に乗り入れる8路線は、どれも odpt.Calendar:Weekday と SaturdayHoliday の2本立て
 * （2026-10-18 に確認）。祝日の判定は相鉄線と同じ内閣府由来のデータを使う
 *
 * @param {Date} serviceDay
 * @returns {"Weekday" | "SaturdayHoliday"}
 */
export function serviceCalendar(serviceDay) {
  return isHolidaySotetsu(japanCalendarDate(serviceDay)) ? "SaturdayHoliday" : "Weekday";
}

/**
 * @abstract 日本時間の「いま」を、時刻表と同じ分の数え方にする
 *
 * 駅の時刻表の深夜便は 24 時超え表記を使わず「00:07」で来るが、並びは当日ダイヤの末尾。
 * 0:00〜3:59 を 24:00〜27:59 として扱えば、深夜便が「これから」のまま単調に並ぶ
 * （utils.js の timeToMinutesExtended と同じ扱い）
 *
 * @param {Date} now
 * @returns {number}
 */
export function nowExtendedMinutes(now = new Date()) {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const h = jst.getUTCHours();
  return (h < 4 ? h + 24 : h) * 60 + jst.getUTCMinutes();
}

/**
 * @abstract 駅の時刻表を、方向ごとの便の配列にまとめる
 * @param {object[]} timetables - odpt:StationTimetable の配列
 * @param {string} calendar - "Weekday" | "SaturdayHoliday"
 * @returns {Map<string, object[]>} 方向（Inbound など）→ 便
 */
export function groupByDirection(timetables, calendar) {
  const byDirection = new Map();
  for (const table of timetables ?? []) {
    if (tailOf(table["odpt:calendar"]) !== calendar) continue;
    const direction = tailOf(table["odpt:railDirection"]);
    if (!direction) continue;
    const list = byDirection.get(direction) ?? [];
    list.push(...(table["odpt:stationTimetableObject"] ?? []));
    byDirection.set(direction, list);
  }
  for (const list of byDirection.values()) {
    list.sort((a, b) => extended(a["odpt:departureTime"]) - extended(b["odpt:departureTime"]));
  }
  return byDirection;
}

// 時刻表の時刻を分に。読めない値は後ろに回す
function extended(hhmm) {
  try {
    return timeToMinutesExtended(hhmm);
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

/**
 * @abstract これから出る便を先頭から数本選ぶ
 *
 * 遅れが分かっている便は、遅れを足した見込みで「まだ出ていない」かを見る
 * （バス停の欄と同じ考え。定刻を過ぎていても遅れていればまだ乗れる）
 *
 * @param {object[]} objects - 1方向ぶんの便（時刻順）
 * @param {number} nowMinutes
 * @param {(trainId: string) => number | null} delayOf - 便の遅れ（分）。分からなければ null
 * @param {number} count
 */
export function pickUpcoming(objects, nowMinutes, delayOf = () => null, count = UPCOMING_PER_DIRECTION) {
  const upcoming = [];
  for (const object of objects) {
    const minutes = extended(object["odpt:departureTime"]);
    if (minutes === Number.MAX_SAFE_INTEGER) continue;
    const delay = delayOf(object["odpt:train"]);
    if (minutes + (delay ?? 0) < nowMinutes) continue;
    upcoming.push({ object, minutes, delay });
    if (upcoming.length >= count) break;
  }
  return upcoming;
}

/**
 * @abstract odpt:Train の配列を、列車 id で引ける形にする
 * @param {object[]} trains
 * @returns {Map<string, object>}
 */
export function indexTrains(trains) {
  const byId = new Map();
  for (const train of trains ?? []) {
    if (train["owl:sameAs"]) byId.set(train["owl:sameAs"], train);
  }
  return byId;
}

/**
 * @abstract 走行中の列車から「いまどのあたりか」を作る
 *
 * odpt:Train は緯度経度を持たないので、駅と駅の間でしか言えない。
 * 次の駅（toStation）が null のときは、その駅に停まっているという意味
 *
 * @param {object | undefined} train
 * @returns {{from: string, to: string | null} | null} 駅の id（名前に直すのは呼び出し側）
 */
export function positionOf(train) {
  const from = train?.["odpt:fromStation"];
  if (!from) return null;
  return { from, to: train["odpt:toStation"] ?? null };
}

/** 遅れ（秒）を分に。入っていなければ null */
export function delayMinutes(train) {
  const seconds = train?.["odpt:delay"];
  return typeof seconds === "number" ? Math.round(seconds / 60) : null;
}

/**
 * @abstract 運行情報のテキストを取り出す。「平常」を含むかどうかも返す
 * @param {object[]} information - odpt:TrainInformation の配列
 */
export function trainInformationOf(information) {
  const first = (information ?? [])[0];
  const text = first?.["odpt:trainInformationText"]?.ja ?? first?.["odpt:trainInformationText"]?.en ?? null;
  if (!text) return null;
  // JR「平常運転」/ 東急「東横線は、平常通り運転しています。」/ 地下鉄「平常運行」
  return { text, normal: text.includes("平常") };
}

/**
 * @abstract 1路線ぶんの発車時刻を組む。失敗したら throw（呼び出し側が errors に入れる）
 * @param {object} line - yokohamaStation.js の1路線
 * @param {string} calendar
 * @param {number} nowMinutes
 */
async function buildLine(line, calendar, nowMinutes) {
  const timetables = await fetchStationTimetable(line);
  const byDirection = groupByDirection(timetables, calendar);

  // 便に列車の id が付いていない路線（京急・東急）は、走行中の列車と結びつけられないので取りに行かない
  const hasTrainRef = [...byDirection.values()].some((list) => list.some((object) => object["odpt:train"]));
  const [trainsResult, informationResult, typeTitles] = await Promise.all([
    hasTrainRef ? fetchTrains(line).catch((error) => { debugError(`[trainDepartures] ${line.id} の列車: ${error?.message ?? error}`); return []; }) : [],
    fetchTrainInformation(line).catch((error) => { debugError(`[trainDepartures] ${line.id} の運行情報: ${error?.message ?? error}`); return []; }),
    fetchTrainTypeTitles(line.api).catch(() => ({})),
  ]);

  const trainById = indexTrains(trainsResult);
  const delayOf = (trainId) => delayMinutes(trainById.get(trainId));
  // 遅れを出せるのは「便に列車の id があり、かつ配信に odpt:delay が入っている」路線だけ。
  // 京急は列車は配信されているが id が結びつかず、odpt:delay も入っていない。相鉄は列車自体が 0 件
  const delayAvailable = hasTrainRef && trainsResult.some((train) => typeof train["odpt:delay"] === "number");

  const directions = [];
  const directionNames = line.directions ?? {};
  // 並びは設定の順。設定に無い方向が来たら後ろに足す（黙って消さない）
  const keys = [...Object.keys(directionNames), ...[...byDirection.keys()].filter((key) => !(key in directionNames))];
  for (const key of keys) {
    const objects = byDirection.get(key);
    if (!objects?.length) continue;
    const picked = pickUpcoming(objects, nowMinutes, delayOf);
    directions.push({
      id: key,
      name: directionNames[key] ?? key,
      // 当日ダイヤに便はあるが、これからの便が無い＝終電が出た
      finished: picked.length === 0,
      departures: picked.map(({ object, delay }) => ({
        time: object["odpt:departureTime"],
        type: typeTitles[object["odpt:trainType"]] ?? tailOf(object["odpt:trainType"]),
        // 行先は複数入ることがある（分割する列車）。素直に全部返す
        destinationIds: object["odpt:destinationStation"] ?? [],
        delay,
        position: positionOf(trainById.get(object["odpt:train"])),
      })),
    });
  }

  // 画面に出す時刻（#220。ODPT ガイドライン 2.1.1・2.2.1）
  //  - delayAsOf・infoAsOf: 遅れ（odpt:Train）と運行情報の、データ生成時刻（dc:date）
  //  - timetableFetchedAt: 駅の時刻表を取得した日時
  const { generated, fetched } = getDataTimes();

  return {
    id: line.id,
    name: line.name,
    delayAsOf: delayAvailable ? (generated[`train.${line.railway}`] ?? null) : null,
    infoAsOf: generated[`info.${line.railway}`] ?? null,
    timetableFetchedAt: fetched[`timetable.station.${line.station}`] ?? null,
    delayAvailable,
    infoAvailable: (informationResult ?? []).length > 0,
    info: trainInformationOf(informationResult),
    directions,
  };
}

/**
 * @abstract 横浜駅から出る電車を、事業者ごとにまとめて返す
 *
 * 1路線が落ちても残りは返す（Promise.allSettled）。落ちた路線は errors に入れる。
 *
 * @param {Date} serviceDay - 平日／土休日の判定に使う日
 * @param {Date} now - 「次の3本」の基準。既定はいま
 * @returns {Promise<{calendar: string, operators: object[], errors: string[]}>}
 */
async function getTrainDeparturesAtYokohamaReal(serviceDay = new Date(), now = new Date()) {
  const calendar = serviceCalendar(serviceDay);
  const nowMinutes = nowExtendedMinutes(now);

  const results = await Promise.allSettled(
    YOKOHAMA_RAIL_LINES.map((line) => buildLine(line, calendar, nowMinutes)),
  );

  const errors = [];
  const linesByOperator = new Map();
  results.forEach((result, i) => {
    const line = YOKOHAMA_RAIL_LINES[i];
    if (result.status !== "fulfilled") {
      debugError(`[trainDepartures] ${line.id} の時刻表を取得できませんでした: ${result.reason?.message ?? result.reason}`);
      errors.push(line.id);
      return;
    }
    const list = linesByOperator.get(line.operatorId) ?? [];
    list.push(result.value);
    linesByOperator.set(line.operatorId, list);
  });

  // 行先と「いまどのあたり」の駅名を、出す便のぶんだけまとめて引く（API ごと・10件ずつ）
  const idsByApi = new Map();
  YOKOHAMA_RAIL_LINES.forEach((line) => {
    const built = (linesByOperator.get(line.operatorId) ?? []).find((l) => l.id === line.id);
    if (!built) return;
    const ids = idsByApi.get(line.api) ?? [];
    for (const direction of built.directions) {
      for (const departure of direction.departures) {
        ids.push(...departure.destinationIds);
        if (departure.position) ids.push(departure.position.from, departure.position.to);
      }
    }
    idsByApi.set(line.api, ids);
  });
  const titlesByApi = new Map();
  await Promise.all([...idsByApi.entries()].map(async ([api, ids]) => {
    titlesByApi.set(api, await fetchStationTitles(api, ids.filter(Boolean)));
  }));

  // 駅名を当てて、画面がそのまま出せる形にする
  const operators = YOKOHAMA_RAIL_OPERATORS.map((operator) => {
    const lines = (linesByOperator.get(operator.id) ?? []).map((built) => {
      const api = YOKOHAMA_RAIL_LINES.find((line) => line.id === built.id)?.api;
      const titles = titlesByApi.get(api) ?? {};
      const nameOf = (id) => titles[id] ?? tailOf(id);
      return {
        ...built,
        directions: built.directions.map((direction) => ({
          ...direction,
          departures: direction.departures.map(({ destinationIds, position, ...rest }) => ({
            ...rest,
            destination: destinationIds.map(nameOf).filter(Boolean).join("・") || null,
            position: position ? { from: nameOf(position.from), to: position.to ? nameOf(position.to) : null } : null,
          })),
        })),
      };
    });
    return { id: operator.id, name: operator.name, lines };
  }).filter((operator) => operator.lines.length);

  return { calendar, operators, errors };
}

/**
 * 横浜駅から出る電車。実データが取れないときは、仮データに切り替える（公開用のコピー。demo/index.js）
 */
export function getTrainDeparturesAtYokohama(serviceDay = new Date(), now = new Date()) {
  return withDemo('横浜駅の電車', () => getTrainDeparturesAtYokohamaReal(serviceDay, now), () => demoTrainDepartures(serviceDay, now, serviceCalendar(serviceDay)), (body) => !body?.operators?.length);
}
