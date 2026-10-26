import * as Utils from "../../utils/utils.js";
import { routeRequiredOperators, routeAlternativeOperators } from "../../utils/rideNames.js";
import { toOperatorFilter } from "./operatorSelection.js";

/**
 * Priority list of keys that may represent
 * the "final arrival time" of a route option.
 *
 * The first valid one found will be used.
 */
const FINAL_ARRIVAL_KEYS = [
  "station_dropoff_arrivetime",    // Final arrival after train / transfer
  "busstop_dropoff_arrivetime",     // Bus-only routes (may be an array)
  "arrivetime"                      // Direct walk or fallback
];

/**
 * Normalize a time value into a single "HH:MM" string.
 *
 * Possible input forms:
 *  - "22:45"
 *  - ["22:45"]
 *  - ["21:40", "21:50"]
 *
 * Strategy:
 *  - If an array is given, choose the *latest* time
 *    (safer choice to avoid selecting an unreachable early option).
 *
 * @param {string | string[]} t
 * @returns {string|null} normalized time string
 */
export function normalizeTimeValue(t) {
  if (!t) return null;
  if (Array.isArray(t)) {
    const times = t.filter(Boolean);
    if (times.length === 0) return null;

    // Pick the latest time in the array
    return times.reduce((max, cur) =>
      Utils.timeToMinutes(cur) > Utils.timeToMinutes(max) ? cur : max
    );
  }

  if (typeof t === "string") return t;
  return null;
}

/**
 * Convert a time string into "minutes from base time",
 * correctly handling day rollover (after midnight).
 *
 * Example:
 *   baseMin = 20:14 -> 1214
 *   tStr    = "00:06" -> treated as next day -> 1446
 *
 * @param {string} tStr  - Time string "HH:MM"
 * @param {number} baseMin - Base time in minutes
 * @returns {number} minutes adjusted for next-day rollover
 */
function timeToMinutesFromBase(tStr, baseMin) {
  const m = Utils.timeToMinutes(tStr); // 0..1439
  if (!Number.isFinite(m)) return Number.POSITIVE_INFINITY;

  // If the time appears earlier than the base time,
  // treat it as a next-day arrival (+1440 minutes)
  return (m < baseMin) ? (m + 1440) : m;
}

/**
 * Extract the final arrival time (in minutes) from a route option.
 *
 * This function:
 *  1. Tries keys listed in FINAL_ARRIVAL_KEYS
 *  2. Normalizes array/string values
 *  3. Applies next-day correction if needed
 *
 * @param {Object} option - Route candidate
 * @param {number} baseMin - Current time in minutes
 * @returns {number} final arrival time in minutes
 */
function getFinalArriveMinutes(option, baseMin) {
  for (const key of FINAL_ARRIVAL_KEYS) {
    const raw = option?.[key];
    const tStr = normalizeTimeValue(raw);

    if (tStr) {
      const m = timeToMinutesFromBase(tStr, baseMin);
      if (Number.isFinite(m)) return m;
    }
  }

  // If no valid arrival time is found,
  // treat it as infinitely late
  return Number.POSITIVE_INFINITY;
}

/**
 * 候補が、選ばれた事業者だけで行けるかを判定する。
 *
 * 事業者の絞り込みはここでやる。経路パターン（domain）ごとではなく候補ごとに
 * 見るので、バスだけの経路に3社が混ざっていても分けられる。上位6件を取る前に
 * 落とすため、外した事業者のぶん件数が減ることもない。
 *
 * @param {Object} option - 候補（RouteOption）
 * @param {Set<string>|undefined} allowed - 使ってよい事業者。undefined なら絞らない
 * @returns {boolean}
 */
export function isOperatorAllowed(option, allowed) {
  if (allowed === undefined) return true;

  // バス・電車は「必ずその事業者に乗る」ので、1 つでも外していれば落とす。
  // 徒歩だけの候補は事業者を使わないので、必ず残る
  if (!routeRequiredOperators(option).every((key) => allowed.has(key))) return false;

  // シェアサイクルの共用ポートは「どちらかのアプリがあれば乗れる」。
  // すべて許可されていることを求めると、両方で借りられるポートが
  // 片方だけを選んだ利用者に出なくなる
  const alternatives = routeAlternativeOperators(option);
  return alternatives.length === 0 || alternatives.some((key) => allowed.has(key));
}

/**
 * Merge results from multiple route functions and
 * return the fastest arrival options.
 *
 * Steps:
 *  1. Execute all route functions in parallel
 *  2. Collect only fulfilled results
 *  3. Flatten all route options into one list
 *  4. Sort by final arrival time (earliest first)
 *  5. Return top 6 routes
 *
 * @param {Object} paramJSON
 * @param {Array<Function>} routeFns - (paramJSON) => Promise<RouteOption[]>
 * @returns {Promise<Array<Object>>}
 */
export async function pickTop10Arrivals(paramJSON, routeFns) {
  // Base time for day rollover handling (e.g., "20:14" -> 1214)
  const baseMin = Utils.timeToMinutes(paramJSON.currentTime); 
  const allowedOperators = toOperatorFilter(paramJSON.operators);

  // Execute all route functions safely
  const settled = await Promise.allSettled(routeFns.map(fn => fn(paramJSON)));

  // Collect successful route arrays and flatten them
  const merged = settled
    .filter(r => r.status === "fulfilled" && Array.isArray(r.value))
    .flatMap(r => r.value)
    .filter(opt => Number.isFinite(getFinalArriveMinutes(opt, baseMin)))
    .filter(opt => isOperatorAllowed(opt, allowedOperators));

  // Sort routes by final arrival time
  const sorted = merged.toSorted((a, b) =>
    getFinalArriveMinutes(a, baseMin) - getFinalArriveMinutes(b, baseMin)
  );

  // Return top 6 fastest routes
  return sorted.slice(0, 6);
}
