// 横浜市営バスの運賃設定
//
// 出典: ODPT `odpt:BusroutePatternFare`（本番API、2026-10-07 取得。標本1000件すべて 220）と
// 横浜市の運賃ページ（現金・IC とも 220 円）。IC と現金は同額。
// ODPT の市営バスには IC 運賃のフィールドが無い。
//
// ⚠ 2027年1月に 240 円へ値上げの予定（横浜市が上限変更を申請）。
// 応募締切（2027-01-11）とほぼ同時期なので、そのころ確かめ直すこと。#105 参照。

export const MUNICIPAL_FARE_CONFIG = {
    baseFare: 220,
    currency: "JPY",
    paymentType: "flat",
};
