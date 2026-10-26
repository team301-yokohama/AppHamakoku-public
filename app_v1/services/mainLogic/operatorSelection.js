/**
 * @abstract 画面の事業者チェック（相鉄バス・神奈中…）を、検索で使う形にそろえる
 * 仕様は docs/spec.md 2.5 と ADR-0029
 */
import { OPERATOR_KEYS } from "../../config/providers/operators.js";

/**
 * フォーム（name="operators"）や GET /api（?operators=...）の値を、
 * 「使ってよい事業者」のキーの配列にそろえる。
 *
 * - 項目そのものが来ない → `undefined`（= 事業者で絞らない）。
 *   古い画面や `operators` を付けない API 呼び出しを壊さないため
 * - 空（全部オフ）→ `[]`。画面は hidden の空値を必ず送るので、
 *   「全部オフ」と「指定なし」を区別できる
 * - 知らないキーは捨てる。並びは一定にする（検索結果のキャッシュキーに入るため）
 *
 * @param {string|string[]|undefined} raw
 * @returns {string[]|undefined}
 */
export function normalizeOperatorSelection(raw) {
  if (raw === undefined || raw === null) return undefined;

  const list = (Array.isArray(raw) ? raw : [raw])
    // GET /api では ?operators=Kanachu,SotetsuBus のようにカンマ区切りでも書ける
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim());

  const allowed = OPERATOR_KEYS.filter((key) => list.includes(key));
  return allowed;
}

/**
 * 「使ってよい事業者」の配列を、絞り込みに使う Set にする。
 * `undefined`（指定なし）はそのまま返し、呼び出し側で「絞らない」と扱う。
 *
 * @param {string[]|undefined} operators
 * @returns {Set<string>|undefined}
 */
export function toOperatorFilter(operators) {
  return operators === undefined ? undefined : new Set(operators);
}
