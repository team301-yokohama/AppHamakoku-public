/**
 * @abstract 画面の交通手段チェック（bus / train / cycle / walk）を API コードや表示用のキーに変換する
 * 仕様は docs/spec.md 2.1・3.1 と ADR-0001（何も選ばない = 全ルート、「🚶 徒歩のみ」で徒歩のみ）
 */

// 「🚶 徒歩のみ」のチェックの値。ほかの交通手段と一緒に送られてきても徒歩のみを優先する
// （画面では徒歩のみを選ぶとほかのチェックを外すので、ふつうは一緒には来ない）
const WALK_ONLY = "walk";
const WALK_ONLY_API_CODE = 0;

// 画面のチェックをビットフラグにする（bus=1, train=2, cycle=4）
function toBitFlag(selection) {
  return (selection.includes("bus") ? 1 : 0) + (selection.includes("train") ? 2 : 0) + (selection.includes("cycle") ? 4 : 0);
}

// ビットフラグ → API コード（routeSearch.js の TRANSPORT_ROUTE_MAP のキー）
// 0（何も選ばない）は ADR-0001 により全ルート（1）。徒歩のみ（0）は WALK_ONLY のときだけ
const BITFLAG_TO_API_CODE = {
  0: 1, // 未選択 → 全ルート
  1: 2, // バスのみ
  2: 3, // 電車のみ
  3: 5, // バスと電車
  4: 4, // チャリのみ
  5: 6, // バスとチャリ
  6: 7, // 電車とチャリ
  7: 1, // バスと電車とチャリ
};

// ビットフラグ → shapeRouteData() の keyMap のキー
const BITFLAG_TO_ROUTE_KEY = {
  0: "All", // 未選択 → 全ルート
  1: "bus",
  2: "train",
  3: "busAndTrain",
  4: "cycle",
  5: "busAndCycle",
  6: "trainAndCycle",
  7: "All",
};

/**
 * フォームの routepattern（未送信・文字列・配列のどれでも来る）を配列にそろえる
 */
export function normalizeTransportSelection(raw) {
  if (raw === undefined || raw === null || raw === "") return [];
  return Array.isArray(raw) ? raw : [raw];
}

/**
 * 画面のチェック → API コード（0〜7）
 */
export function toApiRoutepattern(selection) {
  if (normalizeTransportSelection(selection).includes(WALK_ONLY)) return WALK_ONLY_API_CODE;
  return BITFLAG_TO_API_CODE[toBitFlag(normalizeTransportSelection(selection))] ?? 1;
}

/**
 * 画面のチェック → 表示側でどのルートの結果を使うかのキー
 */
export function toRouteKey(selection) {
  if (normalizeTransportSelection(selection).includes(WALK_ONLY)) return "walk";
  return BITFLAG_TO_ROUTE_KEY[toBitFlag(normalizeTransportSelection(selection))] ?? "All";
}

// API コード（0〜7）→ 表示側のキー。
// GET /api はコードで来るので、画面のチェックを経由せずに引けるようにする。
// routeSearch.js の TRANSPORT_ROUTE_MAP と、shapeRouteData の keyMap の対応
const API_CODE_TO_ROUTE_KEY = {
  0: "walk",
  1: "All",
  2: "bus",
  3: "train",
  4: "cycle",
  5: "busAndTrain",
  6: "busAndCycle",
  7: "trainAndCycle",
};

/**
 * API コード（0〜7）→ 表示側でどのルートの結果を使うかのキー
 */
export function apiCodeToRouteKey(code) {
  return API_CODE_TO_ROUTE_KEY[Number(code)] ?? "All";
}
