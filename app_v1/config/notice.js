/**
 * 画面上部のお知らせ（掲示板 / #137）。
 *
 * 1件ずつ足していく。新しい順に並べ替えて、画面には2件まで出す（残りは「ほか N 件」で開く）。
 *   date  : 掲示した日（YYYY-MM-DD）。新しい順に並べる基準
 *   until : この日まで出す（YYYY-MM-DD、任意）。過ぎたら自動で出なくなる
 *   level : "alert" は赤（経路が出ない・使えないなど、いつもと違うこと / ADR-0011）。
 *           省略すると青のふつうのお知らせ
 *   text  : 本文
 *
 * 路線全体の運行情報はここに出さない（ADR-0016）。アプリからのお知らせだけを置く。
 * 1件も無いときは、お知らせの欄ごと出さない。
 */
export const NOTICES = [
  {
    date: "2000-01-01",
    text: "これはアプリはまこくの公開用レポジトリです。実際での動作はhttps://team301.jpをご覧ください。本ページに関するお問い合わせは team301.official@gmail.com にお願いします。",
  },
];

// 画面に最初から見せる件数
export const NOTICE_VISIBLE = 2;

/**
 * 今日出すお知らせを、新しい順に返す。
 *
 * @param {Array} notices - NOTICES の形の配列
 * @param {string} today  - 日本時間の今日（YYYY-MM-DD）
 */
export function activeNotices(notices, today) {
  return notices
    .filter((n) => n && n.text)
    .filter((n) => !n.until || n.until >= today)
    .slice()
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

// 日本時間の今日（YYYY-MM-DD）
// getTime() は UTC なので 9 時間足して、UTC として読む。
// getTimezoneOffset() を足す書き方は、ローカルの getter で読むとき用で、
// toISOString()（UTC）と混ぜると日本時間のサーバで UTC の日付になる
export function todayInJapan(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}
