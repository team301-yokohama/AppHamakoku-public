import { CLASS_PERIODS } from "../config/constants/classPeriods.js";

// 「〇限終わり」ボタンの計算。
// テストから読めるよう React と departure.js（React を読む）には依存させない

// 出すボタンの数。スマホの幅に3つまで並べる
export const PERIOD_BUTTON_COUNT = 3;

const pad = (n) => String(n).padStart(2, "0");

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
};

/**
 * まだ終わっていない時限のうち、直近のものを返す。
 * 終了時刻ちょうどの時限は「もう終わった」扱いにする（その時刻なら「今すぐ」で足りる）。
 * 21 時以降のように残りが無いときは空の配列
 *
 * @param {Date} now - 利用者のブラウザの時計
 * @param {{period:number, start:string, end:string}[]} periods
 * @param {number} count
 */
export function upcomingPeriods(now = new Date(), periods = CLASS_PERIODS, count = PERIOD_BUTTON_COUNT) {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return periods.filter((p) => toMinutes(p.end) > nowMinutes).slice(0, count);
}

/**
 * ボタンを押したときに出発日時へ入れる値。
 * 「日時を指定」に切り替えて、今日の日付とその時限の終了時刻を入れる
 * （終了時刻がそのまま画面に出るので、押した結果を確かめやすい）。
 * 教室を出るまでの数分は足さない。出発地点からの徒歩時間は検索のほうで足している
 *
 * @param {{period:number, end:string}} period
 * @param {Date} now
 */
export function departureForPeriod(period, now = new Date()) {
  return {
    mode: "absolute",
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: period.end,
  };
}

// ボタンの文言（ADR-0018）
export const periodLabel = (period) => `${period.period}限終わり`;
