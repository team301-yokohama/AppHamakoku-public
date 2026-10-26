import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import { REPORT_HONEYPOT, REPORT_KINDS, REPORT_LIMITS } from "../../config/report.js";

// 「間に合わなかった」などの報告を受けて、Google フォームに送る（#122・ADR-0010）

const KIND_LABELS = Object.fromEntries(REPORT_KINDS.map((k) => [k.value, k.label]));

// 改行とタブ以外の制御文字を落とし、前後の空白を取って、上限で切る
function clean(value, limit) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, limit);
}

// シートで数式として読まれないように、= + - @ で始まる値の頭に ' を付ける
export function guardFormula(text) {
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

/**
 * 送られてきた報告を確かめて、送れる形に直す。
 * @param {object} body - リクエストの本文
 * @returns {{ ok: true, report: object } | { ok: false, reason: "bot" | "invalid" }}
 */
export function validateReport(body = {}) {
  // 罠の欄に何か入っていたら機械の送信
  if (clean(body[REPORT_HONEYPOT], 100) !== "") return { ok: false, reason: "bot" };

  const kind = typeof body.kind === "string" ? body.kind : "";
  // constructor や __proto__ のような、継承された名前を種類として通さない
  if (!Object.hasOwn(KIND_LABELS, kind)) return { ok: false, reason: "invalid" };

  const report = {
    kind,
    message: clean(body.message, REPORT_LIMITS.message),
    route: clean(body.route, REPORT_LIMITS.route),
    conditions: clean(body.conditions, REPORT_LIMITS.conditions),
    page: clean(body.page, REPORT_LIMITS.page),
  };

  // 何も手がかりの無い報告は受けない（その他なのに本文が空など）
  if (!report.message && !report.route && !report.conditions) return { ok: false, reason: "invalid" };

  return { ok: true, report };
}

/**
 * 連投の制限。送信元ごとと全体の両方で、一定時間あたりの件数を数える。
 * プロセス内のメモリに持つだけなので、再起動で数え直しになる（軽めの対策）。
 *
 * 断った送信には記録を作らず、古くなった送信元はまとめて消す。
 * 送信元を変えながら大量に送られても、覚える送信元は全体の上限程度に収まる。
 */
export function createRateLimiter({ windowMs, perClient, total }, now = () => Date.now()) {
  const byClient = new Map();
  let all = [];

  const allow = function allow(clientKey) {
    const t = now();
    const recent = (list) => list.filter((at) => t - at < windowMs);

    all = recent(all);
    if (byClient.size > total) {
      for (const [key, list] of byClient) {
        const kept = recent(list);
        if (kept.length === 0) byClient.delete(key);
        else byClient.set(key, kept);
      }
    }

    const mine = recent(byClient.get(clientKey) || []);
    if (all.length >= total || mine.length >= perClient) return false;
    mine.push(t);
    all.push(t);
    byClient.set(clientKey, mine);
    return true;
  };
  // テスト用: 覚えている送信元の数
  allow.size = () => byClient.size;
  return allow;
}

/**
 * 送信元の IP を、制限で数える単位にそろえる。
 * - IPv4 射影の IPv6（::ffff:1.2.3.4）は、IPv4（1.2.3.4）として数える
 * - IPv6 は、先頭の 64 ビット（/64。1つの契約・1つの端末に割り当てられる範囲）で数える。
 *   同じ /64 の中でアドレスを変えながら送っても、同じ送信元として数えるため
 * - 読めなければ "unknown"（全員が1つにまとまるので、制限は厳しい側に倒れる）
 * @param {string|undefined} ip
 * @returns {string}
 */
export function clientKeyOf(ip) {
  const text = String(ip ?? "").trim().replace(/%.*$/, ""); // fe80::1%eth0 のゾーンは落とす
  if (net.isIPv4(text)) return text;
  if (!net.isIPv6(text)) return "unknown";

  // 末尾が IPv4 の形（::ffff:1.2.3.4）なら、16進の2つ組に直してから扱う
  let v6 = text;
  const tail = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const [a, b, c, d] = tail[2].split(".").map(Number);
    v6 = `${tail[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const [head, rest] = v6.split("::");
  const front = head ? head.split(":") : [];
  const back = rest === undefined ? [] : rest ? rest.split(":") : [];
  const groups = rest === undefined ? front : [...front, ...Array(8 - front.length - back.length).fill("0"), ...back];
  const hextets = groups.map((g) => g.padStart(4, "0").toLowerCase());

  // ::ffff:a.b:c.d（IPv4 射影）→ IPv4
  if (hextets.slice(0, 5).every((h) => h === "0000") && hextets[5] === "ffff") {
    const hi = parseInt(hextets[6], 16);
    const lo = parseInt(hextets[7], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return `${hextets.slice(0, 4).join(":")}/64`;
}

/**
 * 1日に受け付ける件数の上限。日本時間の0時で数え直す。
 * プロセス内のメモリに持つので、再起動でも数え直しになる。
 *
 * 全体の上限（limit）のほかに、1つの送信元が使える上限（perClient）を決められる。
 * 1人で全体の枠を使い切って、ほかの人の報告を断らせないため。
 * 大学の Wi-Fi のように、多くの人が同じ IP に見えることもあるので、少なすぎない値にする。
 */
export function createDailyCap(limit, now = () => Date.now(), { perClient = Infinity } = {}) {
  let day = "";
  let count = 0;
  let byClient = new Map();
  const today = () => new Date(now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const sync = () => {
    const d = today();
    if (d !== day) { day = d; count = 0; byClient = new Map(); }
  };
  return {
    // まだ受け付けられるか（数えない）。送信元を渡すと、その送信元の上限も見る
    available(clientKey) { return this.check(clientKey) === "ok"; },
    // "ok"、全体の上限（"total"）、その送信元の上限（"client"）のどれか
    check(clientKey) {
      sync();
      if (count >= limit) return "total";
      if (clientKey !== undefined && (byClient.get(clientKey) ?? 0) >= perClient) return "client";
      return "ok";
    },
    // 1件受け付けたことにする。覚える送信元の数は、全体の上限を超えない
    take(clientKey) {
      sync();
      count += 1;
      if (clientKey !== undefined) byClient.set(clientKey, (byClient.get(clientKey) ?? 0) + 1);
    },
  };
}

/**
 * 同じ内容の警告を、一定の間隔でだけ出す（制限に達したことをログで気づけるようにする。#256）。
 * 荒らされているときに、ログが警告だらけにならないようにする。
 */
export function createWarner({ intervalMs = 10 * 60 * 1000, now = () => Date.now(), log = console.warn, maxKeys = 200 } = {}) {
  const last = new Map();
  return function warn(key, message) {
    const t = now();
    if (t - (last.get(key) ?? -Infinity) < intervalMs) return false;
    if (last.size >= maxKeys) last.clear(); // 覚える数に上限を付ける
    last.set(key, t);
    log(message);
    return true;
  };
}

/**
 * このアプリの画面から送られた報告か。
 * ほかのサイトに仕込まれたフォームから、利用者のブラウザ経由で送らせることを防ぐ。
 * 画面は JSON で送るので JSON 以外は受けない。ブラウザが付ける Sec-Fetch-Site が
 * 別サイトを示していたら受けない（付けない古いブラウザや curl は通す）。
 */
export function isOwnPageRequest({ contentType = "", fetchSite = "" } = {}) {
  if (!/^application\/json\b/i.test(contentType)) return false;
  return fetchSite === "" || fetchSite === "same-origin";
}

/**
 * Google フォームの formResponse に送る本文を作る。
 * entries に無い項目は送らない（フォーム側に欄が無い）。
 */
export function buildFormBody(report, entries) {
  const values = {
    kind: KIND_LABELS[report.kind],
    message: report.message,
    route: report.route,
    conditions: report.conditions,
    page: report.page,
  };
  const body = new URLSearchParams();
  for (const [field, entry] of Object.entries(entries)) {
    if (values[field] === undefined || !String(entry).startsWith("entry.")) continue;
    body.append(entry, guardFormula(values[field]));
  }
  return body;
}

/**
 * 報告を送る。フォームが未設定なら apidata/reports/ に追記する。
 * @returns {Promise<"form" | "file">} どこに残したか
 */
export async function deliverReport(report, form, {
  fetchImpl = fetch,
  reportDir = path.resolve("apidata/reports"),
  receivedAt = new Date().toISOString(),
} = {}) {
  if (form) {
    const res = await fetchImpl(form.action, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: buildFormBody(report, form.entries).toString(),
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    // 送れたときは 200 か、確認ページへの 302 が返る
    if (res.status >= 400) throw new Error(`Google フォームへの送信に失敗しました（${res.status}）`);
    return "form";
  }

  console.warn("[report] REPORT_FORM_ACTION / REPORT_FORM_ENTRIES が未設定のため、apidata/reports/ に保存します");
  await fs.mkdir(reportDir, { recursive: true });
  await fs.appendFile(
    path.join(reportDir, "reports.jsonl"),
    JSON.stringify({ receivedAt, ...report }) + "\n",
    "utf8",
  );
  return "file";
}
