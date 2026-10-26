// 検索の入力（GET /api のクエリ、POST /hamakokuex/search の本文）を確かめる。
//
// これまでは、どんな文字列でもそのまま検索結果のキャッシュのキーやファイル名に入っていた。
// 許す値を決めて、外れていたら検索せずに断る（API は 400）。

// 出発地・歩く速さは、徒歩時間の表（db/transit/walking/）のキーと同じ
export const LOCATIONS = ["Library", "Shokudo1", "Shokudo2", "RikoA"];
export const SPEEDS = ["slow", "normal", "littlefast", "fast"];
// 交通手段コード（routeSearch.js の TRANSPORT_ROUTE_MAP のキー）
const ROUTEPATTERNS = ["0", "1", "2", "3", "4", "5", "6", "7"];

// 受け付ける日付の範囲。ここを外れる日付は、時刻表も祝日のデータもなく、検索できない。
// 範囲を決めておくと、日付ごとのキャッシュやファイルが、利用者の入力で無限には増えない
export const DATE_MIN = "2020-01-01";
export const DATE_MAX = "2030-12-31";

/** 「入力なし」とみなす値。空文字は、フォームの未入力として今までどおり既定値に倒す */
const isBlank = (value) => value === undefined || value === null || value === "";

/** YYYY-MM-DD の形で、実在する日付で、範囲の中にあるか */
export function isServiceDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (value < DATE_MIN || value > DATE_MAX) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // 2026-02-30 のような存在しない日付は、繰り上がって別の日になるので弾く
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** H:mm か HH:mm（0:00〜23:59） */
export function isClockTime(value) {
  return typeof value === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(value);
}

/** 入力の誤り。status が 400 なので、エラー処理が 400 で返す */
export class InvalidQueryError extends Error {
  /** @param {{field: string, msg: string}[]} errors */
  constructor(errors) {
    super(`入力が正しくありません: ${errors.map((e) => e.field).join(", ")}`);
    this.name = "InvalidQueryError";
    this.status = 400;
    this.errors = errors;
  }
}

/**
 * 検索の入力を確かめる。値は変えない（直すのは検索の側）。
 * 入力なし（未指定・空）は、今までどおり既定値に倒すので、誤りにしない。
 * @param {{now?: unknown, date?: unknown, location?: unknown, speed?: unknown, routepattern?: unknown, operators?: unknown}} query
 * @returns {{field: string, msg: string}[]} 誤りの一覧（空なら問題なし）
 */
export function validateSearchQuery(query = {}) {
  const errors = [];
  const check = (field, value, ok, msg) => {
    if (!isBlank(value) && !ok(value)) errors.push({ field, msg });
  };

  check("now", query.now, isClockTime, "出発時刻の形式が正しくありません");
  check("date", query.date, isServiceDate, "出発日の形式または範囲が正しくありません");
  check("location", query.location, (v) => LOCATIONS.includes(v), "出発地が正しくありません");
  check("speed", query.speed, (v) => SPEEDS.includes(v), "歩く速さが正しくありません");
  // 数値（0〜7）も受ける。配列やオブジェクトは受けない
  check(
    "routepattern",
    query.routepattern,
    (v) => (typeof v === "string" || typeof v === "number") && ROUTEPATTERNS.includes(String(v)),
    "交通手段の指定が正しくありません",
  );
  // 事業者は、文字列か文字列の配列。中身の絞り込みは normalizeOperatorSelection が許す名前だけにする
  check(
    "operators",
    query.operators,
    (v) => typeof v === "string" || (Array.isArray(v) && v.length <= 32 && v.every((item) => typeof item === "string")),
    "交通事業者の指定が正しくありません",
  );

  return errors;
}

/** 誤りがあれば InvalidQueryError を投げる */
export function assertValidSearchQuery(query) {
  const errors = validateSearchQuery(query);
  if (errors.length > 0) throw new InvalidQueryError(errors);
}
