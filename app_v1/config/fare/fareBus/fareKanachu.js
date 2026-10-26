// 神奈川中央交通バスの運賃設定
//
// 出典: ODPT `odpt:BusroutePatternFare`（チャレンジAPI、2026-10-07 取得）。
// うちが使う 01系統の停留所（横浜新道 / 三ツ沢上町駅前 / 岡沢町 → 横浜駅西口）は
// すべて 切符 240 / IC 240 だった。IC と現金は同額。
//
// 220 円としていたのは値上げ前の値で、反映できていなかった。
// 運賃改定を定期的に拾う仕組みは #105 に書いた。

export const KANACHU_FARE_CONFIG = {
    baseFare: 240,
    currency: "JPY",
    paymentType: "flat",
};
