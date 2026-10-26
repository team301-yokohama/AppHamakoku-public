// エラー処理。
//
// これまでは Express の組み込みの処理に任せていて、NODE_ENV が production でないと、
// スタックトレース（サーバーのファイルの絶対パス、EJS のソース）が画面にそのまま出た。
// 詳細はサーバーのログにだけ残し、利用者には短い汎用の文言だけを返す。

// 改行・制御文字を落として、1行にする（ログの行を偽造されないように）
export function sanitizeForLog(value, limit = 200) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "?")
    .slice(0, limit);
}

/** API（JSON）として返す経路か */
function wantsJson(req) {
  return /^\/(hamakokumap\/)?api(\/|$)/.test(req.path) || req.path.endsWith("/report") || req.path.endsWith("/api/report")
    || /\bapplication\/json\b/.test(req.get("accept") || "");
}

/**
 * Express のエラー処理（引数が4つの関数）。ルートの定義の一番最後に置く。
 * @param {{log?: (...args: unknown[]) => void}} [options]
 */
export function createErrorHandler({ log = console.error } = {}) {
  // eslint-disable-next-line no-unused-vars
  return function errorHandler(err, req, res, next) {
    // 途中まで応答を書いていたら、あとは Express に任せて接続を閉じる
    if (res.headersSent) return next(err);

    // body-parser（壊れた JSON・大きすぎる本文）などは、4xx の status を持っている
    const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    log(`[error] ${req.method} ${sanitizeForLog(req.originalUrl)} → ${status}`, err);

    const message = status === 413 ? "送信された内容が大きすぎます。"
      : status >= 400 && status < 500 ? "入力内容が正しくありません。"
        : "サーバーでエラーが発生しました。時間をおいてもう一度お試しください。";

    res.status(status);
    if (wantsJson(req)) {
      const body = { ok: false, error: message };
      // 入力の誤り（InvalidQueryError）は、どの項目かも返す。文言は固定なので、そのまま出してよい
      if (Array.isArray(err?.errors)) body.errors = err.errors.map(({ field, msg }) => ({ field, msg }));
      return res.json(body);
    }
    return res.type("text/plain; charset=utf-8").send(message);
  };
}
