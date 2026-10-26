// 相鉄バスの運賃設定
//
// ODPT には相鉄バスの `odpt:BusroutePatternFare` が無い（本番・チャレンジとも0件）。
// 運賃改定を定期的に拾う仕組みは #105 に書いた。

export const SOTETSU_FARE_CONFIG = {
    baseFare: 240,
    currency: "JPY",
    paymentType: "flat",
};
