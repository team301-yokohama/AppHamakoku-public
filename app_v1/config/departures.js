// はまこく Exp. の出発地（フォームの departure の値）。
// はまこく Map の出発地の建物から ?from=Library のように渡される。
// 値は hamakokumap/areas.json の departures のキーと同じにする
export const DEPARTURE_IDS = ["Library", "RikoA", "Shokudo1", "Shokudo2"];

/**
 * @abstract クエリの ?from= から、フォームで最初に選んでおく出発地を決める
 * 知らない値・配列（?from=a&from=b）は無視して null（＝フォームの既定のまま）
 * @param {unknown} from - req.query.from
 * @returns {string | null}
 */
export function presetDeparture(from) {
  return typeof from === "string" && DEPARTURE_IDS.includes(from) ? from : null;
}
