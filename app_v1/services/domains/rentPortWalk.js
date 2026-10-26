// 出発地から構内のシェアサイクルポートまでの徒歩時間。
//
// 返却側（横浜駅のポート → 駅）の walkKeyToDestination と対になる仕組み。
// cycleportlist.json の YNU の各ポートに walkKeyFromOrigin（walkspeed_*.json のキー）を持たせ、
// 選んだ歩く速さ・出発地で展開済みの paramJSON から引く。

import stationList from "../../db/transit/cycleport/cycleportlist.json" with { type: "json" };

/**
 * @abstract 出発地から貸出ポートまでの徒歩時間を返す
 * @detail キーが無い・値が無いポートは undefined を返し、呼び出し側で候補から外す。
 *         以前のように別のポート（ファミマ）の値で代用はしない
 * @param {{station_id: string|number}} port - getPortData が返したポート
 * @param {object} paramJSON - 徒歩時間が展開されたパラメータ
 * @returns {number|undefined} 徒歩時間（分）
 */
export function resolveRentWalkTime(port, paramJSON) {
  const entry = stationList.YNU.find((p) => String(p.station_id) === String(port.station_id));
  const walkKey = entry?.walkKeyFromOrigin;
  const walkTime = walkKey ? paramJSON[walkKey] : undefined;
  return Number.isFinite(walkTime) ? walkTime : undefined;
}
