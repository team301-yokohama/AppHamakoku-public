import { getActiveServiceIds } from "./date/gtfsCalendar.js";

/**
 * GTFSのcalendar.txt / calendar_dates.txt由来データから、
 * 指定日に有効な横浜市営バスのservice_idを返す。
 *
 * @param {string|Date|number} targetDate - YYYYMMDD, YYYY-MM-DD, Date
 * @returns {Promise<string[]>}
 */
export async function ServiceIds(targetDate) {
  // 鮮度・カバー範囲の確認は getActiveServiceIds が bus 単体で行う
  return getActiveServiceIds("bus", targetDate);
}
