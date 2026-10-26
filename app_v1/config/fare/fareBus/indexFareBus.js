import { MUNICIPAL_FARE_CONFIG } from "./fareMunicipal.js";
import { KANACHU_FARE_CONFIG } from "./fareKanachu.js";
import { SOTETSU_FARE_CONFIG } from "./fareSotetsuBus.js";

// アプリケーション全体で使う「運賃定数」としてまとめる。
// ic = IC カード運賃、cash = 現金運賃。バスはいずれも同額（2026-10-07 時点）。
const toFare = (config) => ({
    ic: config.icFare ?? config.baseFare,
    cash: config.cashFare ?? config.baseFare,
});

export const BUS_FARES = {
    SOTETSU: toFare(SOTETSU_FARE_CONFIG),
    MUNICIPAL: toFare(MUNICIPAL_FARE_CONFIG),
    KANACHU: toFare(KANACHU_FARE_CONFIG),
};

// 深夜運賃の倍率。
// 始発バス停を 23:00 以降に出発する便は、運賃が2倍になる（IC・現金・回数券とも。
// 定期券は追加なし）。出典: 相鉄バス公式の深夜バス運賃、および
// 「始発停留所を23時以降に出発」という判定基準を明記している阪急バスの案内。
// バスだけの制度で、電車やシェアサイクルには無い。
//
// どの便が深夜便かは ODPT の時刻表の `odpt:isMidnight` で判断するが、
// 横浜市営バスは深夜バス制度があるのにこのフラグが立つ便が1本も無い（2026-10-07 時点）。
// フラグを信じきらず、便の増減を #105 で見張る。
export const MIDNIGHT_FARE_RATE = 2;
