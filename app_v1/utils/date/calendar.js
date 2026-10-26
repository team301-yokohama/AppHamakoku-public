// カレンダー関係のユーティリティ関数群
// 休日か平日かを解決する関数など

import isHolidaySotetsu from "./isHolidaySotetsu.js"; 
import * as Utils from "../utils.js";

/**
 * @abstract 運行事業者と運行日区分から ODPT 用 calendar を返す
 * @param {string} operator - "Sotetsu" | "Kanachu" など
 * @param {boolean} isHoliday - true: 休日 / false: 平日
 * @returns {string} odpt.Calendar 用文字列
 */
export function resolveCalendar(operator, isHoliday) {
  // 相鉄
  if (operator === "Sotetsu") {
    return isHoliday ? "SaturdayHoliday" : "Weekday";
  }

  // 相鉄バス（相鉄線とは別。ODPT の calendar が Weekday / Saturday / Holiday に分かれている）
  if (operator === "SotetsuBus") {
    if (isHoliday === "Saturday") return "Saturday";
    if (isHoliday === "Holiday" || isHoliday === true) return "Holiday";
    return "Weekday";
  }

  // 神奈中
  if (operator === "Kanachu") {
    if (isHoliday === "Saturday") return "Saturday";
    if (isHoliday === "Holiday" || isHoliday === true) return "Holiday";
    return "Weekday";
  }

  // デフォルト
  return "Weekday";
}

/**
 * @abstract 日付から運行日区分を返す（土曜と日祝を分ける事業者向け）
 * @param {string|number|Date} dateInput
 * @returns {"Weekday"|"Saturday"|"Holiday"}
 */
export function classifyServiceDay(dateInput = new Date()) {
  const date = Utils.parseToDate(dateInput);
  if (!date) return "Weekday"; // 無効なら安全側

  const day = date.getDay(); // 0:Sun ... 6:Sat
  if (day === 6) return "Saturday";            // 土曜
  if (day === 0) return "Holiday";             // 日曜は祝日扱い

  // 祝日（平日に来る祝日も Holiday）
  // ここは「祝日判定モジュール」を共通化して呼ぶのが理想
  if (isHolidaySotetsu(date)) return "Holiday";

  return "Weekday";
}
// 旧名。神奈中以外（相鉄バス）からも使うようになったため classifyServiceDay に改名した
export const classifyKanachuServiceDay = classifyServiceDay;
