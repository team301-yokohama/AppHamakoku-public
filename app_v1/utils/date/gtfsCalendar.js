import { promises as fs } from "node:fs";
import path from "node:path";
import { APIDATA_DIR } from "../../config/paths.js";
import { GTFS_REFRESH_INTERVAL_MS, getStaticCachedValue, clearCacheByPrefix } from "../cache.js";
import { updateGtfsCalendars } from "../../scripts/updateGtfs.js";
import { noteFetched } from "../dataTimes.js";
import { createRefresher } from "./gtfsRefresh.js";

const GTFS_DIR = path.join(APIDATA_DIR, "gtfs");

const DATASET_PATHS = {
  bus: path.join(GTFS_DIR, "yokohamaMunicipalBus", "calendar.json"),
  train: path.join(GTFS_DIR, "yokohamaMunicipalTrain", "calendar.json"),
};

function formatDateYYYYMMDD(input = new Date()) {
  if (input instanceof Date) {
    const y = input.getFullYear();
    const m = String(input.getMonth() + 1).padStart(2, "0");
    const d = String(input.getDate()).padStart(2, "0");
    return `${y}${m}${d}`;
  }

  const text = String(input ?? "");
  if (/^\d{8}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.replaceAll("-", "");

  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return formatDateYYYYMMDD(date);
  return null;
}

function getDayColumn(yyyymmdd) {
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6)) - 1;
  const day = Number(yyyymmdd.slice(6, 8));
  const date = new Date(year, month, day);

  return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][date.getDay()];
}

async function readCalendar(datasetType) {
  const filePath = DATASET_PATHS[datasetType];
  if (!filePath) throw new Error(`Unknown GTFS dataset type: ${datasetType}`);

  return getStaticCachedValue(`gtfs:${datasetType}:calendar`, async () => {
    const text = await fs.readFile(filePath, "utf-8");
    return JSON.parse(text);
  });
}

function isStale(calendar) {
  if (!calendar?.updatedAt) return true;
  return Date.now() - new Date(calendar.updatedAt).getTime() > GTFS_REFRESH_INTERVAL_MS;
}

// 更新は1度に1本だけ。失敗したら15分は試し直さない（上流が落ちている間、検索のたびに取りに行かないため）
const refreshGtfsOnce = createRefresher({
  update: updateGtfsCalendars,
  onSuccess: () => clearCacheByPrefix("gtfs:"),
});

function ensureDateCovered(calendar, targetDate, datasetType) {
  if (!calendar?.validFrom || !calendar?.validTo) {
    throw new Error(`GTFS calendar for ${datasetType} is invalid. Run npm run update:gtfs.`);
  }

  if (targetDate < calendar.validFrom || targetDate > calendar.validTo) {
    throw new Error(`GTFS calendar for ${datasetType} does not cover ${targetDate}. Run npm run update:gtfs.`);
  }
}

/**
 * 指定したデータセット1つだけの鮮度と対象日カバー範囲を確認する。
 *
 * データセット単位にしているのは、bus と train を一括で確認すると
 * 片方の失敗がもう片方のルートまで巻き添えにするため。
 * GTFSを読む関数からのみ呼ばれるので、GTFSを使わないルート
 * （相鉄・徒歩・自転車）はこの検証の影響を受けない。
 *
 * @param {"bus"|"train"} datasetType - 対象のGTFSデータセット
 * @param {string|Date|number} targetDateInput - 判定したい日付
 * @returns {Promise<object>} - 検証済みのカレンダー
 */
async function ensureGtfsDatasetFresh(datasetType, targetDateInput = new Date()) {
  const targetDate = formatDateYYYYMMDD(targetDateInput);
  if (!targetDate) throw new Error(`Invalid GTFS target date: ${targetDateInput}`);

  let calendar;
  try {
    calendar = await readCalendar(datasetType);
  } catch (error) {
    // カレンダーファイルが無ければ取得を試みる
    await refreshGtfsOnce();
    calendar = await readCalendar(datasetType);
  }

  if (isStale(calendar)) {
    try {
      await refreshGtfsOnce();
      calendar = await readCalendar(datasetType);
    } catch (error) {
      console.warn(`[GTFS] ${datasetType} の定期更新に失敗しました。既存のカレンダーで続行します: ${error.message}`);
    }
  }

  ensureDateCovered(calendar, targetDate, datasetType);
  // GTFS カレンダーを取得した日時。画面の「データの時点」に出す
  noteFetched("timetable.gtfsCalendar", calendar.updatedAt);
  return calendar;
}

export async function getActiveServiceIds(datasetType, targetDateInput = new Date()) {
  const targetDate = formatDateYYYYMMDD(targetDateInput);
  if (!targetDate) throw new Error(`Invalid GTFS target date: ${targetDateInput}`);

  // 鮮度・カバー範囲の確認はGTFSを実際に読むここで行う
  const calendar = await ensureGtfsDatasetFresh(datasetType, targetDate);

  const dayColumn = getDayColumn(targetDate);
  const activeServices = new Set();

  for (const row of calendar.calendar ?? []) {
    if (
      row.start_date <= targetDate &&
      targetDate <= row.end_date &&
      row[dayColumn] === "1"
    ) {
      activeServices.add(row.service_id);
    }
  }

  for (const row of calendar.calendarDates ?? []) {
    if (row.date !== targetDate) continue;

    if (row.exception_type === "1") {
      activeServices.add(row.service_id);
    } else if (row.exception_type === "2") {
      activeServices.delete(row.service_id);
    }
  }

  return [...activeServices].sort();
}

export async function getTrainCalendarType(targetDateInput = new Date()) {
  const targetDate = formatDateYYYYMMDD(targetDateInput);
  const dayColumn = getDayColumn(targetDate);
  const ids = await getActiveServiceIds("train", targetDateInput);
  const calendar = await readCalendar("train");
  const activeRows = (calendar.calendar ?? []).filter((row) => ids.includes(row.service_id));

  if (dayColumn === "saturday" || dayColumn === "sunday") {
    return "SaturdayHoliday";
  }

  if (activeRows.some((row) => row.saturday === "1" || row.sunday === "1")) {
    return "SaturdayHoliday";
  }

  const joined = ids.join(" ").toLowerCase();

  if (joined.includes("saturday") || joined.includes("holiday") || joined.includes("_2") || joined.includes("_3")) {
    return "SaturdayHoliday";
  }

  return "Weekday";
}

export function formatGtfsDate(input = new Date()) {
  return formatDateYYYYMMDD(input);
}
