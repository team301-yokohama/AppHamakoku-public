// team301 のサイト（/ のインデックス、#154）。静的なファイルを配るだけ。
//
// はまこく Map（ADR-0030）と同じく、express は自分で import せず app_v1 から受け取る
// （このフォルダには node_modules が無いため）。app_v1/app.js からは 1 行でつなぐ。
//
//   app.use(createSiteHandler({ express }));

import path from "node:path";
import { fileURLToPath } from "node:url";

// このフォルダ（site/）。cwd に依存しないよう、このファイルの位置から決める
export const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 外に出してよいファイル。README や server/ は配らない。ページを足したらここにも足す（README 参照）
const PUBLIC_FILE = /^\/(index\.html|data\.html|privacy\.html|disclaimer\.html|style\.css|robots\.txt|sitemap\.xml|icons\/[\w-]+\.(svg|png|ico|webmanifest)|img\/[\w-]+\.(png|jpg|svg)|about\/[\w-]+\.html)$/;

// 紹介ページ・データの提供元・プライバシーポリシー・免責事項は拡張子なしで開けるようにする。
// 共有したときの見た目のため
const ABOUT_PAGE = /^\/(about\/[\w-]+|data|privacy|disclaimer)$/;

/**
 * @param {object} deps
 * @param {typeof import("express")} deps.express
 * @param {string} [deps.siteDir] - 配るファイルのあるフォルダ（テスト用）
 * @returns {import("express").RequestHandler}
 */
export function createSiteHandler({ express, siteDir = SITE_DIR }) {
  const serveStatic = express.static(siteDir, { index: "index.html", extensions: ["html"] });
  return (req, res, next) => {
    if (req.path === "/" || PUBLIC_FILE.test(req.path)) return serveStatic(req, res, next);
    // /about/hamakokuex → about/hamakokuex.html。express.static の extensions に任せる
    if (ABOUT_PAGE.test(req.path)) return serveStatic(req, res, next);
    next();
  };
}
