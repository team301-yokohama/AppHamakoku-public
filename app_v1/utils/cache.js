// プロセス内のキャッシュ。ディスクには何も書かない（本番のサーバーに、データを溜めない）。
//
// 2種類に分けて持つ。
// - 無期限（ttl が Infinity。getStaticCachedValue）: キーが、コードで決まっていて、利用者の入力で増えないものだけ。
//   （ダイヤの区分3つ、GTFS のカレンダー、駅ごとの時刻表など）。件数の上限は付けない。
//   日付や、利用者の入力が入るキーには、使わない（期限つきを使う）。
// - 期限つき（60秒の検索結果・上流の応答・日ごとの時刻表など）: キーに利用者の入力が入りうるので、
//   件数に上限を付け、期限が切れたものから先に捨てる。上限を超えたら、古い順に捨てる。
const staticStore = new Map();
const responseStore = new Map();
const pendingStore = new Map();

export const REALTIME_CACHE_TTL_MS = 60 * 1000;
// バスの位置は odpt:frequency が 30 秒（2026-10-25 実測）。これより短くは取り直さない。dct:valid は生成から約 36 秒
// 検索結果を使い回す時間。中の動的データ（バス 30 秒・台数 60 秒）の上に重なるので、短くしておく
export const ROUTE_SEARCH_TTL_MS = 30 * 1000;
export const BUS_LOCATION_TTL_MS = 30 * 1000;
export const GTFS_REFRESH_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
// 日付をキーにする時刻表（横浜市営バス・市営地下鉄）の期限。無期限にせず、件数の上限のあるキャッシュに入れる
export const DAILY_TIMETABLE_TTL_MS = 6 * 60 * 60 * 1000;
// 期限つきのキャッシュの件数の上限。検索結果は 1件 約100KB なので、最大で約 50MB
export const RESPONSE_CACHE_MAX_ENTRIES = 500;

/** 期限が切れたものを捨て、まだ上限を超えていれば、古い順（入れた順）に捨てる */
function pruneResponses(now) {
  for (const [key, entry] of responseStore) {
    if (now - entry.createdAt >= entry.ttlMs) responseStore.delete(key);
  }
  while (responseStore.size > RESPONSE_CACHE_MAX_ENTRIES) {
    responseStore.delete(responseStore.keys().next().value);
  }
}

/** テストと確認用。中身の件数 */
export function cacheStats() {
  return { static: staticStore.size, response: responseStore.size, pending: pendingStore.size };
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

export async function getCachedValue(key, ttlMs, loader) {
  const now = Date.now();
  const store = ttlMs === Number.POSITIVE_INFINITY ? staticStore : responseStore;
  const cached = store.get(key);

  if (cached && now - cached.createdAt < ttlMs) {
    return cached.value;
  }

  if (pendingStore.has(key)) {
    return pendingStore.get(key);
  }

  const promise = (async () => {
    try {
      const value = await loader();
      const createdAt = Date.now();
      if (store === responseStore) {
        // 入れ直して、入れた順の並びの最後にする（古い順に捨てるため）
        responseStore.delete(key);
        responseStore.set(key, { value, createdAt, ttlMs });
        pruneResponses(createdAt);
      } else {
        staticStore.set(key, { value, createdAt });
      }
      return value;
    } finally {
      pendingStore.delete(key);
    }
  })();

  pendingStore.set(key, promise);
  return promise;
}

export async function getStaticCachedValue(key, loader) {
  const cached = staticStore.get(key);
  if (cached) return cached.value;

  return getCachedValue(key, Number.POSITIVE_INFINITY, loader);
}

export function clearCacheByPrefix(prefix) {
  for (const store of [staticStore, responseStore]) {
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) store.delete(key);
    }
  }
}
