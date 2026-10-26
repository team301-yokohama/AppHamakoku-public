// 検索条件として選べる交通事業者の一覧。
//
// 「定期を持っている事業者を使いたい／持っていない事業者は避けたい」を選べるようにする
// ための一覧。画面の「利用手段」（バス・電車・シェアサイクル / ADR-0002）を見出しにして、
// その下に事業者を並べる入れ子にする（ADR-0029）。
//
// key は ODPT の事業者ID（odpt.Operator:xxx の xxx）とは一致させていない。
// 横浜市営バスと横浜市営地下鉄は ODPT ではどちらも `YokohamaMunicipal` で、
// 定期券は別物なのに区別できないため。key と実データの対応づけは
// utils/rideNames.js が持つ（事業者の判定を1箇所にまとめる / ADR-0026）。
//
// name は画面に出す名前。券面の短い名前（市営バス・相鉄）にそろえている。
// 学生が口にする呼び方のほうが、定期を思い出しながら選びやすい。

export const OPERATORS = [
  { key: "SotetsuBus", name: "相鉄バス", mode: "bus" },
  { key: "Kanachu", name: "神奈中バス", mode: "bus" },
  { key: "MunicipalBus", name: "市営バス", mode: "bus" },
  { key: "Sotetsu", name: "相鉄", mode: "train" },
  { key: "MunicipalSubway", name: "市営地下鉄", mode: "train" },
  // shortName は案内券の詳細に出す小さな印。正式名は幅 375px に収まらない。
  // はまこく Map のチップと同じ綴りにそろえてある
  { key: "HelloCycling", name: "HELLO CYCLING", shortName: "HELLO", mode: "cycle" },
  { key: "Docomo", name: "ドコモ・バイクシェア", shortName: "ドコモ", mode: "cycle" },
];

// 画面のチェック（bus / train / cycle）→ その手段の事業者
export const OPERATORS_BY_MODE = Object.fromEntries(
  ["bus", "train", "cycle"].map((mode) => [mode, OPERATORS.filter((item) => item.mode === mode)]),
);

export const OPERATOR_KEYS = OPERATORS.map((item) => item.key);

export function operatorName(key) {
  return OPERATORS.find((item) => item.key === key)?.name ?? "";
}

// 狭いところに出す短い名前。指定が無ければ正式名を使う
export function operatorShortName(key) {
  const item = OPERATORS.find((entry) => entry.key === key);
  return item?.shortName ?? item?.name ?? "";
}
