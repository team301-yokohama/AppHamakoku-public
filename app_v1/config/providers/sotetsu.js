// Configuration for Sotetsu Main Line
// sotetsu.js

export const SOTETSU = {
  operator: "odpt.Operator:Sotetsu",
  railway: "odpt.Railway:Sotetsu.Main",
  railDirection: "odpt.RailDirection:Inbound",
  calendar: "odpt.Calendar:",
  refMinutes: 1700,
  timeoutMs: 15000,

  // 時刻表JSONの置き場と命名規則。
  // apidata/<dirName>/<prefix>_<YYYYMMDD>.json の形で置くと、
  // 日付が最も新しい有効なファイルが自動で選ばれる。
  // ダイヤ改正時は新しい日付のファイルを追加するだけでよく、コード修正は不要。
  timetable: {
    dirName: "sotetsu2Yokohama",
    prefixes: {
      Weekday: "WeekdayData",
      Holiday: "SaturdayHolidayData",
    },
  },
};