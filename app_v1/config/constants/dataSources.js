// 画面に出す「静的データの取得日」のうち、ファイルから読むもの（#220。ODPT ガイドライン 2.2.1）

// 神奈中バスの時刻表（apidata/kanachu2Yokohama/kanachuLocalTimetable.json）は、
// 取り込んだ日をファイルが持っていないので、ここに書く。
// ファイルを取り直したら、この日付も直す（最後に更新した日。git の履歴: 2026-04-07）
export const KANACHU_TIMETABLE_FETCHED_AT = "2026-04-07";
