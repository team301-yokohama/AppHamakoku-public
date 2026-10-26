// 相鉄関連の運賃定義
//
// 出典: ODPT `odpt:RailwayFare`（チャレンジAPI、2026-10-07 取得）。
// **IC と切符で差がある唯一の区間**（IC 188 / 切符 190）。
// ic = IC カード運賃、cash = 切符（現金）運賃。

export const TRAIN_FARES_SOTETSU = {
  KAMIHOSHI2YOKOHAMA: { ic: 188, cash: 190 }, // 相鉄線: 上星川 -> 横浜
  WADAMACHI2YOKOHAMA: { ic: 188, cash: 190 }, // 相鉄線: 和田町 -> 横浜
};
