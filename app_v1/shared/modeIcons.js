/**
 * 乗り物のアイコン（線画）。経路申込書（EJS）と券売機（React の島）で共用する。
 *
 * 帯の模様（ADR-0011）だけでは初めて見る人に何の乗り物か伝わりにくいので、
 * 乗り物を選ぶ欄ではアイコンを添える。2色刷りに合わせて線はインク1色
 * （stroke="currentColor"）で、塗りは使わない。24×24 の座標で描く。
 */
export const MODE_ICON_PATHS = {
  // バスの正面: 車体・窓の下端・ライト・タイヤ
  bus: "M6 3h12a2 2 0 0 1 2 2v12H4V5a2 2 0 0 1 2-2z M4 11h16 M7 14h1.5 M15.5 14h1.5 M7 17v3 M17 17v3 M9.5 6h5",
  // 電車の正面: 車体・窓の下端・ライト・線路
  train: "M8 3h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z M5 10h14 M8.5 13.5h1 M14.5 13.5h1 M8 17l-3 4 M16 17l3 4 M6.5 19h11",
  // 自転車: 車輪2つ・フレーム・サドル・ハンドル
  cycle: "M2 16.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0 M15 16.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0 M5.5 16.5L9 9h6.5l3 7.5 M9 9l3.5 7.5L15.5 9 M9 9V6.5 M7.5 6.5h3 M15.5 9l-1-3h2.5",
  // 歩く人
  walk: "M12.2 4.5a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0 M13 8l-2 6l-3 7 M11 14l3 3l1 4 M12.6 9L9 11l-1 3 M13 8l2.5 3.5h3",
};

// EJS 用。<%- modeIconSvg('bus') %> で埋め込む（固定の文字列だけを組み立てる）
export function modeIconSvg(mode, className = "mode-icon") {
  const d = MODE_ICON_PATHS[mode];
  if (!d) return "";
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">`
    + `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
