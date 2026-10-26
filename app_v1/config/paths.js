import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const APP_ROOT = path.resolve(__dirname, "..");
// API の取得結果やローカルの時刻表を置く場所。
// 結合テストでは、録画した入力だけを置いた一時ディレクトリに差し替える。指定が無ければ今までどおり
export const APIDATA_DIR = process.env.APIDATA_DIR ? path.resolve(process.env.APIDATA_DIR) : path.join(APP_ROOT, "apidata");
export const DB_DIR = path.join(APP_ROOT, "db");
export const ENV_PATH = path.join(APP_ROOT, ".env");
