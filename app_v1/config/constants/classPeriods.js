// 横浜国立大学の授業時間（時限）。出発時刻の「〇限終わり」ボタンに使う
//
// 出典: 授業時間割 - 横浜国立大学 https://www.ynu.ac.jp/campus/schedule/class.html
// （2026-10-11 に確認。全学共通の時間割で、学部による違いは書かれていない）
// 時刻が変わったら、ここだけ直せば申込書と券売機の両方に効く
export const CLASS_PERIODS = [
  { period: 1, start: "08:50", end: "10:20" },
  { period: 2, start: "10:30", end: "12:00" },
  { period: 3, start: "13:00", end: "14:30" },
  { period: 4, start: "14:40", end: "16:10" },
  { period: 5, start: "16:15", end: "17:45" },
  { period: 6, start: "17:50", end: "19:20" },
  { period: 7, start: "19:25", end: "20:55" },
];
