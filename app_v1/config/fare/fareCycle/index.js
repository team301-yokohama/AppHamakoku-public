// シェアサイクルの運賃。
//
// 2 社で体系がまったく違う。本アプリで使う範囲（自転車 6〜20 分）では 5 円差だが、
// 刻みが違うので長くなるほど開く（46 分でドコモのほうが安くなる）。
//
// 車種・会員種別までは当てられないので、**既定を 1 つ決めて券面に前提を書く**
// （IC／現金を既定 IC にして切り替えを出した #97・ADR-0003 と同じ考え方）。
//   - HELLO CYCLING … 同一ステーションでも車種で料金が変わると公式に明記があり、
//     フィードからは車種が分からない（vehicle_types は "hellocycling bicycle" の 1 種類だけ）
//   - ドコモ … 1 回会員か月額会員かは利用者ごとで、知りようがない

/**
 * HELLO CYCLING（神奈川県・シティサイクル）
 * 出典: https://www.hellocycling.jp/price/kanagawa （2026-10-10 確認）
 * 同じ表にスポーツタイプ・e-Bike・電動サイクルもあり、e-Bike は 30 分 300 円と倍近い。
 */
export const FARE_HELLOCYCLING = {
  operator: "HelloCycling",
  planLabel: "シティサイクル",
  initialfare: 160,
  initialtime: 30,
  additionalfare: 160,
  additionaltime: 15,
  maxfare: 2500,
  maxtime: 720,        // 12 時間
};

/**
 * ドコモ・バイクシェア（横浜コミュニティサイクル baybike・1 回会員）
 * 出典: https://docomo-cycle.jp/yokohama/price （2026-10-10 確認）
 * 月額会員（3,300 円/月）は最初の 30 分が 0 円。1 日パスは 1,650 円。
 * 上限が無いので maxfare は置かず、maxtime だけ 1 日パスの区切り（23:59）に合わせて 12 時間とする。
 */
export const FARE_DOCOMO = {
  operator: "Docomo",
  planLabel: "1回会員",
  initialfare: 165,
  initialtime: 30,
  additionalfare: 165,
  additionaltime: 30,
  maxfare: null,       // 上限なし
  maxtime: 720,
};

export const CYCLE_FARES = {
  HelloCycling: FARE_HELLOCYCLING,
  Docomo: FARE_DOCOMO,
};

// 運賃に使う事業者を選ぶ順。借りられる事業者のうち、先に見つかったほうの運賃で出す。
// HELLO CYCLING を先にしているのは、本アプリで使う範囲（30 分以内）では安いほうだから。
// 「HELLO を検索から外していればドコモの料金になる」という、利用者から見て
export const CYCLE_FARE_PRIORITY = ["HelloCycling", "Docomo"];

/**
 * @abstract 借りられる事業者から、運賃に使う事業者の運賃表を選ぶ
 * @param {string[]} usableOperators - そのポートで借りられる事業者のキー
 * @returns {object} 運賃表（該当が無ければ HELLO CYCLING）
 */
export function pickCycleFare(usableOperators = []) {
  const key = CYCLE_FARE_PRIORITY.find((candidate) => usableOperators.includes(candidate));
  return CYCLE_FARES[key] ?? FARE_HELLOCYCLING;
}
