// 時間関係の定数を定義するファイル

export const MINUTES_PER_DAY = 24 * 60;
export const SECONDS_PER_HOUR = 60 * 60;
export const DAYS_PER_WEEK = 7;

// 「今日の最終」を出す時間帯の始まり。ここから翌 3:59 までの検索で出す。
// 0:00〜3:59 は前日の続き（24:00〜27:59）として扱うので、21:00 以降と1つの範囲になる
export const LAST_DEPARTURE_WINDOW_START = "21:00";

// その日の最終便を探すときに、各経路の計算へ渡す「その日の始まり」。
// 0:00〜3:59 は前日の続きなので、その日でいちばん早い時刻は 4:00 になる
export const SERVICE_DAY_START = "04:00";
