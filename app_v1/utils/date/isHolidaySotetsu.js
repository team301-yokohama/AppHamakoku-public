// 相鉄の平日／土休日ダイヤ判定に使う祝日判定モジュール。
// 祝日データは内閣府の公式CSV由来で db/calendar/holidays.json に持つ。
// データを更新するときは `npm run update:holidays` を実行する（配列の手書きは不要）。

import holidayData from "../../db/calendar/holidays.json" with { type: "json" };

// 判定を O(1) にするため YYYYMMDD の Set にしておく
const holidaySet = new Set(holidayData.holidays.map((holiday) => holiday.date));

const VALID_FROM = holidayData.validFrom;
const VALID_TO = holidayData.validTo;

// 範囲外の警告は毎リクエスト出すとログが埋まるので、プロセスごとに1回だけにする
let hasWarnedOutOfRange = false;

// ヘルパー: Date -> 'YYYYMMDD'
function formatDateYMD(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
}

/**
 * @abstract 与えられた値（文字列・数値・Dateオブジェクト）を安全に Date 型に変換する
 * @param {*} input - Dateオブジェクト、数値、文字列
 * @returns - Date型
 */
function parseToDate(input) {
    if (input instanceof Date) {
        return isNaN(input.getTime()) ? null : input;
    }
    if (typeof input !== 'string' && typeof input !== 'number') return null;
    const s = String(input);
    // 8桁の YYYYMMDD
    if (/^\d{8}$/.test(s)) {
        const y = Number(s.slice(0, 4));
        const m = Number(s.slice(4, 6)) - 1;   // 月は0始まりなので-1
        const d = Number(s.slice(6, 8));
        const dt = new Date(y, m, d);
        if (dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d) return dt;
        return null;
    }
    // YYYY-MM-DD など Date が解釈できる形式
    const dt = new Date(s);
    return isNaN(dt.getTime()) ? null : dt;
}

/**
 * @abstract 祝日データのカバー範囲外なら警告する。範囲外の平日は祝日を取りこぼすため。
 * @param {string} key - YYYYMMDD
 */
function warnIfOutOfRange(key) {
    if (key >= VALID_FROM && key <= VALID_TO) return;
    if (hasWarnedOutOfRange) return;

    hasWarnedOutOfRange = true;
    console.warn(
        `[isHolidaySotetsu] ${key} は祝日データの収録範囲（${VALID_FROM}〜${VALID_TO}）外です。` +
        `祝日が平日ダイヤとして扱われる可能性があります。'npm run update:holidays' を実行してください。`
    );
}

/////////////////////////////////////////////////////////////////////////////////////////
//
//  下の関数がエクスポートしている関数
//
/////////////////////////////////////////////////////////////////////////////////////////

/**
 * @abstract 与えられた日付が休日（または土日）かどうかを判定する
 * @param {string|number|Date} [input=new Date()] - 判定したい日付（省略時は現在日時）
 * @returns {boolean} - 休日なら true, 平日なら false
 */
export function getServiceIdsForDate(dateString) {
    try {
        const date = parseToDate(dateString);
        if (!date) {
            // 無効な日付は安全のため false (平日) を返す（型をbooleanに統一）
            return false;
        }
        const day = date.getDay(); // 0=日曜, 6=土曜
        if (day === 0) return true;
        if (day === 6) return true;

        // 祝日判定
        const key = formatDateYMD(date);
        warnIfOutOfRange(key);
        if (holidaySet.has(key)) return true;
        return false;
    } catch (err) {
        console.error('getServiceIdsForDate error:', err && err.stack ? err.stack : err);
        return false;
    }
}

// default export（従来の「今日が休日か」を返す関数にする）
export default function isHolidaySotetsu(dateInput = new Date()) {
  return getServiceIdsForDate(dateInput);
}
