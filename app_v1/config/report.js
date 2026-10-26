// 「間に合わなかった」などの報告の設定（#122・ADR-0010）
//
// 報告はアプリのフォームで受け、サーバーが裏で Google フォームに送る。
// 利用者には Google の画面を見せない。
//
// 送り先は環境変数で渡す（.env.example 参照）。
//   REPORT_FORM_ACTION  … フォームの送信先 https://docs.google.com/forms/d/e/<ID>/formResponse
//   REPORT_FORM_ENTRIES … 項目と entry ID の対応（JSON）
//                          {"kind":"entry.1","message":"entry.2","route":"entry.3","conditions":"entry.4","page":"entry.5"}
// 未設定のときは apidata/reports/ に1行ずつ追記して、警告を出す（報告を捨てない）

// 報告の種類。value はシートに残る文字列、label は画面の選択肢。
// apps は選択肢を出すアプリ（"exp" ＝ はまこく Exp.、"map" ＝ はまこく Map、#204）。
// 受け口はどの種類も受け付ける（どちらのアプリから来ても弾かない）
export const REPORT_KINDS = [
  { value: "missed", label: "乗り換えに間に合わなかった", apps: ["exp"] },
  { value: "no-result", label: "経路が表示されない・少ない", apps: ["exp"] },
  { value: "wrong-time", label: "便・時刻が実際と異なる", apps: ["exp", "map"] },
  { value: "delay", label: "遅延情報の誤り", apps: ["exp", "map"] },
  { value: "count-wrong", label: "台数が実際と異なる", apps: ["map"] },
  { value: "port-info", label: "ポートの位置・情報の誤り", apps: ["map"] },
  { value: "map-display", label: "地図表示の不具合", apps: ["map"] },
  { value: "other", label: "その他・お問い合わせ", apps: ["exp", "map"] },
];

/**
 * そのアプリで出す選択肢だけに絞る
 * @param {"exp" | "map"} app
 */
export function reportKindsFor(app) {
  return REPORT_KINDS.filter((kind) => kind.apps.includes(app));
}

// 文字数の上限。自由記述と、画面が自動で入れる条件・経路の要約
export const REPORT_LIMITS = {
  message: 1000,
  route: 3000,
  conditions: 1000,
  page: 200,
};

// 連投の制限（軽めのいたずら対策）。同じ送信元から10分に3件、全体で10分に60件まで
export const REPORT_RATE = {
  windowMs: 10 * 60 * 1000,
  perClient: 3,
  total: 60,
};

// 1日（日本時間の0時区切り）に受け付ける件数の上限。
export const REPORT_DAILY_LIMIT = 100;

// 1つの送信元（IPv4 のアドレス、または IPv6 の /64）が、1日に使える件数。全体の3割。
// 1人で全体の枠を使い切り、ほかの人の報告を断らせることができないようにする。
// 大学の Wi-Fi のように、多くの人が同じ IP に見えることもあるので、少なすぎない値にする。
// 30件で足りないほど使われるなら、全体の100件のほうを見直す
export const REPORT_DAILY_PER_CLIENT = Math.floor(REPORT_DAILY_LIMIT * 0.3);

// 人には見えない罠の欄の名前。ここに何か入っていたら機械の送信とみなす
export const REPORT_HONEYPOT = "website";

// 報告の欄を出すかどうか。REPORT_ENABLED=false で、画面のボタン・一文・報告の欄を
// すべて消し、受け口も 503 で断る（緊急停止や、やめると決めたとき用。再起動で効く）
export function reportEnabled(env = process.env) {
  return String(env.REPORT_ENABLED ?? "false").trim().toLowerCase() !== "false";
}

export function reportFormConfig(env = process.env) {
  const action = String(env.REPORT_FORM_ACTION || "").trim();
  let entries = null;
  try {
    entries = env.REPORT_FORM_ENTRIES ? JSON.parse(env.REPORT_FORM_ENTRIES) : null;
  } catch {
    entries = null;
  }
  const ok = /^https:\/\/docs\.google\.com\/forms\/d\/e\/[\w-]+\/formResponse$/.test(action)
    && entries && typeof entries === "object" && typeof entries.kind === "string";
  return ok ? { action, entries } : null;
}
