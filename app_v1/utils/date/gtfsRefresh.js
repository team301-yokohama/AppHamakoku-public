// GTFS カレンダーの更新を、1度に1本だけ走らせ、失敗したら一定の間は試し直さない。
//
// これまでは、カレンダーが古いか無いときに、検索のたびに更新（CKAN の問い合わせと ZIP のダウンロード）を
// やり直していた。上流が落ちていると、リクエストのたびに失敗する取得を繰り返し、
// 取得が止まったまま返ってこないと、GTFS を使う検索がすべて待たされた。

export const GTFS_RETRY_BACKOFF_MS = 15 * 60 * 1000;
export const GTFS_REFRESH_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * @param {object} options
 * @param {() => Promise<unknown>} options.update 更新を実際にやる関数
 * @param {(result: unknown) => void} [options.onSuccess] 更新に成功したときに呼ぶ（キャッシュの掃除など）
 * @returns {() => Promise<unknown>} 更新を頼む関数。同時に頼まれたら同じ更新を待つ。
 *   直前に失敗していたら、間隔が空くまでは、更新せずに、そのときの失敗をそのまま返す
 */
export function createRefresher({
  update, onSuccess, backoffMs = GTFS_RETRY_BACKOFF_MS, timeoutMs = GTFS_REFRESH_TIMEOUT_MS, now = Date.now,
}) {
  let inflight = null;
  let failure = null;

  return function refreshOnce() {
    if (inflight) return inflight;
    if (failure && now() - failure.at < backoffMs) return Promise.reject(failure.error);

    inflight = (async () => {
      let timer;
      try {
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`GTFS の更新が ${Math.round(timeoutMs / 1000)} 秒で終わりませんでした`)), timeoutMs);
        });
        const result = await Promise.race([update(), timeout]);
        failure = null;
        onSuccess?.(result);
        return result;
      } catch (error) {
        failure = { at: now(), error };
        throw error;
      } finally {
        clearTimeout(timer);
        inflight = null;
      }
    })();

    return inflight;
  };
}
