// シェアサイクルの事業者ごとのフィード設定。
//
// key は config/providers/operators.js の事業者キーに合わせている（画面の絞り込みと同じ語で扱うため）。
// feedKey は db/transit/cycleport/cycleportlist.json の feedIds で使う短い名前で、
// はまこく Map（hamakokumap/overrides.json）と同じ綴りにそろえてある。

import { HELLOCYCLE } from "./hellocycle.js";
import { DOCOMOCYCLE } from "./docomocycle.js";

export const CYCLE_PROVIDERS = [
  { key: "HelloCycling", feedKey: "hellocycling", name: "HELLO CYCLING", config: HELLOCYCLE },
  { key: "Docomo", feedKey: "docomo", name: "ドコモ・バイクシェア", config: DOCOMOCYCLE },
];

// 空きドック（num_docks_available）をそのまま信じてよい事業者。
//
// HELLO CYCLING を選んでいる根拠（2026-10-09 に確認。詳細は docs/gbfs-port-data.md）:
//   - 定員が 64 分間 15,394 ポートで 1 件も動かない（ドコモは 26.8% 動く）
//   - 台数が動いたとき「台数 + 空き」が 91.7% 保たれる（ドコモは 29.4%）
//   - 「台数 + 空き」が定員を超えることが 1 件も無い
//   - 共用ポートでは他社の自転車の分だけ足りなくなる。つまり HELLO の空きは
//     「両社あわせた実際の空き」を見ている
//
// ドコモの空きは、ラックのあるポートでは正しいが、ラックの無いポートでは固定値で
// 意味を持たない。どちらの型かフィードからは見分けられないので使わない。
export const TRUSTED_DOCKS_PROVIDER = "HelloCycling";

export const CYCLE_PROVIDER_KEYS = CYCLE_PROVIDERS.map((provider) => provider.key);

export function cycleProvider(key) {
  return CYCLE_PROVIDERS.find((provider) => provider.key === key);
}
