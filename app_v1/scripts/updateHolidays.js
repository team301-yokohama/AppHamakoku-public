// 内閣府が公開している「国民の祝日」CSVから祝日データを再生成する。
//   npm run update:holidays
// 出力先は db/calendar/holidays.json で、リポジトリにコミットする。
// 実行時にネットワークへ出るのはこのスクリプトだけで、アプリ本体は
// 生成済みJSONだけを読む（起動時に外部依存を持たせないため）。

import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DB_DIR } from "../config/paths.js";

const SOURCE_URL = "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv";

// CSVは1955年から全件入っているが、アプリが遡って検索することはないので
// この年以降だけを残してファイルを小さく保つ
const KEEP_FROM_YEAR = 2024;

const OUTPUT_PATH = path.join(DB_DIR, "calendar", "holidays.json");

/**
 * @abstract 内閣府CSV（Shift_JIS）を取得してUTF-8文字列として返す
 * @returns {Promise<string>} - CSV本文
 */
async function fetchHolidayCsv() {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`祝日CSVの取得に失敗しました: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  // 内閣府CSVはShift_JISで配信されている
  return new TextDecoder("shift_jis").decode(buffer);
}

/**
 * @abstract "2026/1/12" 形式を "20260112" に正規化する
 * @param {string} value - CSVの日付セル
 * @returns {string|null} - YYYYMMDD、解釈できなければ null
 */
function normalizeDate(value) {
  const matched = value.trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!matched) return null;

  const [, year, month, day] = matched;
  return `${year}${month.padStart(2, "0")}${day.padStart(2, "0")}`;
}

/**
 * @abstract CSV本文を { date, name } の配列に変換する
 * @param {string} csvText - CSV本文
 * @returns {{date: string, name: string}[]} - 日付昇順の祝日リスト
 */
function parseHolidays(csvText) {
  const rows = csvText.trim().split(/\r?\n/).slice(1); // 1行目はヘッダ

  const holidays = rows
    .map((row) => {
      const [rawDate, rawName = ""] = row.split(",");
      const date = normalizeDate(rawDate ?? "");
      if (!date) return null;
      if (Number(date.slice(0, 4)) < KEEP_FROM_YEAR) return null;
      return { date, name: rawName.trim() };
    })
    .filter(Boolean);

  holidays.sort((a, b) => a.date.localeCompare(b.date));
  return holidays;
}

export async function updateHolidays() {
  const csvText = await fetchHolidayCsv();
  const holidays = parseHolidays(csvText);

  if (holidays.length === 0) {
    throw new Error("祝日CSVから1件も読み取れませんでした（フォーマット変更の可能性）");
  }

  const payload = {
    source: SOURCE_URL,
    updatedAt: new Date().toISOString(),
    // validTo を過ぎた日付は祝日判定できないため、利用側はこれを見て警告する
    validFrom: holidays[0].date,
    validTo: holidays[holidays.length - 1].date,
    holidays,
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");

  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  updateHolidays()
    .then((payload) => {
      console.log(`祝日データを更新しました: ${payload.holidays.length}件 (${payload.validFrom}〜${payload.validTo})`);
      console.log(`出力先: ${OUTPUT_PATH}`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
