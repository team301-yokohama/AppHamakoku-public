// 仮データでの表示（デモ）。トークンが無い・取得に失敗したときに、公開用のコピーで検索の画面を確かめられるようにする。
//
// 動作は DEMO_MODE で決める。
//   off      … 使わない（実環境と開発側の既定）
//   fallback … 実データが取れない（トークンが無い・上流の失敗・結果が空）ときだけ、仮データに切り替える
//   always   … いつも仮データ（確認用）
// 公開用のコピーでは、書き出すときに既定を fallback にする（scripts/exportPublic.js）。
//
// 仮データは、時刻表の形を借りた作り物で、実際の時刻・運行ではない。画面には、仮データを使っていることを
// 大きな帯で出す（views/index.ejs）。

import { DEMO_MODE_DEFAULT } from "../config/demo.js";

const WINDOW_MS = 2 * 60 * 1000; // 仮データを最後に使ってから、帯を出し続ける時間（キャッシュに残った仮データがあるため）
let lastUsedAt = 0;

export const demoMode = () => {
  const mode = String(process.env.DEMO_MODE ?? DEMO_MODE_DEFAULT).trim();
  return mode === "fallback" || mode === "always" ? mode : "off";
};

/** 仮データを使ったことを覚える */
export function markDemoUsed() {
  lastUsedAt = Date.now();
}

/** テスト用 */
export function resetDemo() {
  lastUsedAt = 0;
}

/**
 * 画面の上に「仮データで表示しています」の帯を出すか。
 * always なら常に。fallback なら、仮データを最近使ったか、そもそも ODPT のキーが無いとき
 * @param {{hasKey?: boolean}} [opts]
 */
export function demoBannerVisible({ hasKey = true } = {}) {
  const mode = demoMode();
  if (mode === "off") return false;
  if (mode === "always") return true;
  return !hasKey || Date.now() - lastUsedAt < WINDOW_MS;
}

/**
 * 実データの取得を試し、だめなら仮データを返す。
 * @param {string} label ログ用の名前
 * @param {() => Promise<any>} real 実データの取得
 * @param {() => any} demo 仮データ
 * @param {(value: any) => boolean} [isEmpty] 結果が空（取れなかったのと同じ）か
 */
export async function withDemo(label, real, demo, isEmpty = () => false) {
  const mode = demoMode();
  if (mode === "off") return real();
  if (mode === "always") {
    markDemoUsed();
    return demo();
  }
  try {
    const value = await real();
    if (!isEmpty(value)) return value;
    console.warn(`[demo] ${label}: 実データが空だったので、仮データで表示します`);
  } catch (error) {
    console.warn(`[demo] ${label}: 実データを取得できなかったので、仮データで表示します（${error?.message ?? error}）`);
  }
  markDemoUsed();
  return demo();
}
