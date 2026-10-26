/**
 * @abstract 「今日の最終」。夜の検索で、乗り場ごとにその日の最終便と、
 *           それに乗るための出発時刻（出発地点からの徒歩時間を引いた時刻）を出す
 *
 * 最終便は時刻表を読み直さず、検索と同じ経路の計算（domain）を「その日の始まり」
 * （SERVICE_DAY_START）で呼んで、いちばん遅い便を取る。電車・バスのみの domain は
 * 「今から乗れる便」をその日の終わりまで全部返すので、始まりから呼べばその日の全便になる。
 * こうしておくと、通過列車を除く・横浜駅に着く便だけにする・平日／土休日の判定・
 * 歩く速さごとの徒歩時間が、検索の結果とそろう。
 *
 * 乗り継ぎ（バス→地下鉄、自転車→電車）は、接続まで見ないと最終が決まらないので出さない。
 * シェアサイクルは 24 時間借りられるので出さない。
 */
import * as Utils from "../../utils/utils.js";
import { Wadamachi2Yokohama } from "../domains/Wadamachi2Yokohama.js";
import { Kamihoshi2Yokohama } from "../domains/Kamihoshi2Yokohama.js";
import { Mitsukami2Yokohama } from "../domains/Mitsukami2Yokohama.js";
import { YNUYokohamaByBusOnly } from "../domains/YNU2YokohamaByBusOnly.js";
import { busLegNames, routeRequiredOperators, trainLegNames } from "../../utils/rideNames.js";
import { toOperatorFilter } from "./operatorSelection.js";
import { LAST_DEPARTURE_WINDOW_START, SERVICE_DAY_START } from "../../config/constants/timeConstants.js";

// 最終を出す経路。mode は券面と同じ「電車／バス」の区別
export const LAST_DEPARTURE_SOURCES = [
  { mode: "train", fn: Wadamachi2Yokohama },
  { mode: "train", fn: Kamihoshi2Yokohama },
  { mode: "train", fn: Mitsukami2Yokohama },
  { mode: "bus", fn: YNUYokohamaByBusOnly },
];

// 時刻を 0:00〜3:59 を 24:00〜27:59 とみなす分に直す。読めない値は null
function toExtendedMinutes(hhmm) {
  try {
    return Utils.timeToMinutesExtended(hhmm);
  } catch {
    return null;
  }
}

/**
 * 「今日の最終」を出す時間帯（21:00〜翌3:59）の検索か
 * @param {string} currentTime - 検索した時刻 "HH:MM"
 */
export function isLastDepartureTime(currentTime) {
  const now = toExtendedMinutes(currentTime);
  return now !== null && now >= toExtendedMinutes(LAST_DEPARTURE_WINDOW_START);
}

/**
 * 経路の候補1件から、まとめる単位・表示名・乗り場・乗り物の発車時刻・徒歩時間を取り出す。
 * 電車は乗る駅ごと、バスは「事業者：系統」ごとにまとめる（バス停ごとだと多すぎる）
 */
function describeOption(option, mode) {
  if (mode === "train") {
    const names = trainLegNames(option);
    return {
      key: `train:${option.station_name}`,
      label: names.ticketLine || names.line || "電車",
      boarding: option.station_name,
      vehicleTime: option.station_departuretime,
      walkMinutes: Number(option.station_walktime ?? 0),
    };
  }
  const names = busLegNames(option.busdata);
  const label = [names.shortOperator, names.busroute].filter(Boolean).join("：") || "バス";
  return {
    key: `bus:${label}`,
    label,
    boarding: option.busstop_name,
    vehicleTime: option.busstop_departuretime,
    walkMinutes: Number(option.busstop_walktime ?? 0),
  };
}

/**
 * @abstract 「今日の最終」に出す乗り場の名前
 * @param {"train"|"bus"} mode
 * @param {string|null|undefined} boarding - 駅名（「和田町」）かバス停名
 * @returns {string}
 */
export function boardingLabelOf(mode, boarding) {
  const name = String(boarding ?? "").trim();
  if (!name) return "";
  return mode === "train" && !name.endsWith("駅") ? `${name}駅` : name;
}

/**
 * その日の全便から、まとめる単位ごとに最終便を選び、検索した時刻と比べる。
 *
 * @param {object[]} options - domain が返した、その日の全便（RouteOption）
 * @param {"train"|"bus"} mode
 * @param {string} currentTime - 検索した時刻 "HH:MM"
 * @returns {object[]} 最終便ごとの1行
 */
export function pickLastDepartures(options, mode, currentTime) {
  const nowMinutes = toExtendedMinutes(currentTime);
  const lastByKey = new Map();

  for (const option of options) {
    const described = describeOption(option, mode);
    const vehicleMinutes = toExtendedMinutes(described.vehicleTime);
    if (vehicleMinutes === null) continue;
    const previous = lastByKey.get(described.key);
    if (!previous || vehicleMinutes > previous.vehicleMinutes) {
      lastByKey.set(described.key, { ...described, vehicleMinutes, option });
    }
  }

  return [...lastByKey.values()].map(({ key, label, boarding, vehicleMinutes, walkMinutes, option }) => {
    // 乗るために出発地点を出る時刻。0:00 を越える便は 24:xx のまま比べる
    const leaveMinutes = vehicleMinutes - walkMinutes;
    const ended = leaveMinutes < nowMinutes;
    return {
      key,
      mode,
      label,
      boarding,
      // 画面で「和田町駅 23:05発」のように出す乗り場の名前。
      // 駅名は「和田町」の形で来るので、バス停と見分けられるよう「駅」を足す
      boardingLabel: boardingLabelOf(mode, boarding),
      lastDeparture: Utils.minutesToTime(vehicleMinutes),
      leaveBy: Utils.minutesToTime(leaveMinutes),
      leaveMinutes,
      walkMinutes,
      ended,
      minutesLeft: ended ? null : leaveMinutes - nowMinutes,
      operators: routeRequiredOperators(option),
    };
  });
}

/**
 * 並べ方: まだ間に合う乗り場を、出発しなければならない時刻の早い順に。
 * 運行が終わった乗り場はそのあとに（黙って消さない）
 */
export function sortLastDepartures(items) {
  return items.toSorted((a, b) => (Number(a.ended) - Number(b.ended)) || (a.leaveMinutes - b.leaveMinutes));
}

/**
 * 運行を終えた乗り場を、1行に並べるための短い文字列の配列にする。
 * バスは事業者ごとに系統をまとめ（「市営バス：209・208」）、電車は乗る駅を添える（「相鉄（和田町）」）。
 * 昼だけ走る系統も多いので、1件ずつ出すと長くなりすぎるため
 *
 * @param {object[]} items - pickLastDepartures の結果
 * @returns {string[]}
 */
export function summarizeEnded(items) {
  const busRoutesByOperator = new Map();
  const summary = [];
  for (const item of items.filter((entry) => entry.ended)) {
    if (item.mode === "train") {
      summary.push(`${item.label}（${item.boarding}）`);
      continue;
    }
    const [operator, route] = item.label.includes("：") ? item.label.split("：") : [item.label, ""];
    if (!busRoutesByOperator.has(operator)) {
      busRoutesByOperator.set(operator, []);
      // 事業者が最初に出てきた位置に、まとめた1件を置く
      summary.push(operator);
    }
    if (route) busRoutesByOperator.get(operator).push(route);
  }
  return summary.map((entry) => {
    const routes = busRoutesByOperator.get(entry);
    return routes && routes.length > 0 ? `${entry}：${routes.join("・")}` : entry;
  });
}

/**
 * 検索条件から「今日の最終」を作る。時間帯の外なら null（画面に欄を出さない）
 *
 * @param {object} queryParams - buildRouteQueryParams() の結果（徒歩時間が展開されている）
 * @param {{mode:string, fn:Function}[]} [sources] - テストで差し替えられるようにしてある
 * @returns {Promise<{searchedAt:string, items:object[], endedSummary:string[]}|null>}
 */
export async function buildLastDepartures(queryParams, sources = LAST_DEPARTURE_SOURCES) {
  if (!isLastDepartureTime(queryParams.currentTime)) return null;

  // その日の全便を取るため、検索した時刻ではなく「その日の始まり」で呼ぶ
  const dayParams = { ...queryParams, currentTime: SERVICE_DAY_START };
  const settled = await Promise.allSettled(sources.map((source) => source.fn(dayParams)));

  // 検索結果と同じく、オフにした事業者の乗り場は出さない
  const allowed = toOperatorFilter(queryParams.operators);

  const items = settled
    .flatMap((result, i) => (result.status === "fulfilled" && Array.isArray(result.value)
      ? pickLastDepartures(result.value, sources[i].mode, queryParams.currentTime)
      : []))
    .filter((item) => !allowed || item.operators.every((key) => allowed.has(key)));

  const sorted = sortLastDepartures(items);
  return { searchedAt: queryParams.currentTime, items: sorted, endedSummary: summarizeEnded(sorted) };
}
