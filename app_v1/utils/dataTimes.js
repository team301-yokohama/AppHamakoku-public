// データの時刻を覚えておき、画面に出せるようにする（#220。ODPT 開発者ガイドライン 2.1.1・2.2.1）
//
// - 動的データ（遅れ・車両の位置・台数）: API が返すデータ生成時刻（dc:date、GBFS は last_updated）。2.1.1
// - 静的データ（時刻表）: こちらが取得した日時。2.2.1
//
// 時刻は、データ元ごとに共通で（利用者ごとには変わらない）、キャッシュと同じく、プロセスの中で共有する。
// RouteOption のキーの契約（CLAUDE.md の「domain関数の契約」）は変えない。
//
// キー（'cycle.hellocycling'・'bus.municipal'・'timetable.municipalBus' など）は、
// 呼ぶ側が決める。画面での名前は、shared/dataTimesView.js が持つ。

const generated = new Map(); // 動的データ: キー → ISO 文字列（新しいほうを残す）
const fetched = new Map(); // 静的データ: キー → ISO 文字列（新しいほうを残す）
const validUntil = new Map(); // 動的データ: キー → ISO 文字列（直近に使ったデータのうち、最も早く切れる dct:valid）

/** Date・ISO 文字列・ミリ秒・'YYYYMMDD'・'YYYY-MM-DD' を ISO にする。読めなければ null */
export function toIso(value) {
  if (value === null || value === undefined || value === "") return null;
  let date;
  if (value instanceof Date) date = value;
  else if (typeof value === "number") date = new Date(value);
  else if (/^\d{8}$/.test(String(value))) date = new Date(`${String(value).slice(0, 4)}-${String(value).slice(4, 6)}-${String(value).slice(6, 8)}T00:00:00+09:00`);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) date = new Date(`${value}T00:00:00+09:00`);
  else date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function remember(map, key, value) {
  const iso = toIso(value);
  if (!iso) return null;
  const previous = map.get(key);
  if (!previous || iso > previous) map.set(key, iso);
  return iso;
}

/** 動的データの生成時刻（dc:date や last_updated）を覚える */
export function noteGenerated(key, value) {
  return remember(generated, key, value);
}

/** 静的データを取得した日時を覚える。省略すると、いま */
export function noteFetched(key, value = new Date()) {
  return remember(fetched, key, value);
}

/**
 * 動的データのうち、いま使っているものの有効期限（dct:valid）を覚える。キーごとに入れ替える。
 * 使えるデータが 0 件（期限の無いものだけを含む）なら、そのキーの期限は無し。
 * @param {string} key
 * @param {object[]} items dct:valid を持つ項目（すでに isValidAt で絞ったもの）
 */
export function noteValidUntil(key, items) {
  let earliest = null;
  for (const item of Array.isArray(items) ? items : []) {
    const iso = toIso(item?.["dct:valid"]);
    if (iso && (!earliest || iso < earliest)) earliest = iso;
  }
  if (earliest) validUntil.set(key, earliest);
  else validUntil.delete(key);
  return earliest;
}

/**
 * 覚えている有効期限のうち、まだ切れていないものの最も早いもの（ミリ秒）。無ければ null。
 * 検索結果をいつまで使い回せるかの目安。すでに切れたものは、もう読まれていない（使っていない）データなので数えない
 */
export function earliestValidUntil(now = Date.now()) {
  let earliest = null;
  for (const iso of validUntil.values()) {
    const t = Date.parse(iso);
    if (t > now && (earliest === null || t < earliest)) earliest = t;
  }
  return earliest;
}

/** 覚えている時刻。テストと、画面に渡す用 */
export function getDataTimes() {
  return { generated: Object.fromEntries(generated), fetched: Object.fromEntries(fetched), validUntil: Object.fromEntries(validUntil) };
}

/** テスト用 */
export function resetDataTimes() {
  generated.clear();
  fetched.clear();
  validUntil.clear();
}

/**
 * ODPT の応答（配列）の中で、いちばん新しいデータ生成時刻（dc:date）
 * @param {unknown[]} items
 * @returns {string|null} ISO 文字列
 */
export function latestDcDate(items, field = "dc:date") {
  let latest = null;
  for (const item of Array.isArray(items) ? items : []) {
    const iso = toIso(item?.[field]);
    if (iso && (!latest || iso > latest)) latest = iso;
  }
  return latest;
}

/**
 * 有効範囲（dct:valid）を超えていないか（2.1.2）。dct:valid が無い・読めないときは、有効とみなす
 * @param {object} item
 * @param {number} [now]
 */
export function isValidAt(item, now = Date.now()) {
  const until = toIso(item?.["dct:valid"]);
  return !until || Date.parse(until) >= now;
}
