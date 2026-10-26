import "../config/env.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { APIDATA_DIR } from "../config/paths.js";

// 上流が止まったまま返ってこなくても、更新が待ち続けないように、時間の上限を付ける
const FETCH_TIMEOUT_MS = 30 * 1000;
const DOWNLOAD_TIMEOUT_MS = 3 * 60 * 1000;
const UNZIP_TIMEOUT_MS = 2 * 60 * 1000;

const DATASETS = [
  {
    id: "yokohama_municipal_bus",
    outputName: "yokohamaMunicipalBus",
    fileName: "Bus.zip",
    odptFilePath: "odpt/YokohamaMunicipal/Bus.zip",
  },
  {
    id: "yokohama_municipal_train",
    outputName: "yokohamaMunicipalTrain",
    fileName: "Train.zip",
    odptFilePath: "odpt/YokohamaMunicipal/Train.zip",
  },
];

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = splitCsvLine(lines[0]);

  return lines.slice(1).filter(Boolean).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [
      header.trim(),
      (values[index] ?? "").trim(),
    ]));
  });
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function extractVersionDate(resource) {
  const candidates = [
    resource?.url,
    resource?.name,
    resource?.description,
    resource?.last_modified,
    resource?.created,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const compact = String(candidate).match(/20\d{6}/);
    if (compact) return compact[0];

    const hyphenated = String(candidate).match(/20\d{2}-\d{2}-\d{2}/);
    if (hyphenated) return hyphenated[0].replaceAll("-", "");
  }

  return null;
}

function findGtfsResource(resources, fileName) {
  const normalizedFile = fileName.toLowerCase();
  const zipResources = resources
    .filter((resource) => {
      const text = `${resource?.url ?? ""} ${resource?.name ?? ""} ${resource?.format ?? ""}`.toLowerCase();
      return text.includes(normalizedFile.toLowerCase()) || text.includes("zip");
    })
    .map((resource) => ({ ...resource, versionDate: extractVersionDate(resource) }))
    .filter((resource) => resource.versionDate)
    .sort((a, b) => b.versionDate.localeCompare(a.versionDate));

  return zipResources[0] ?? null;
}

async function fetchLatestVersionDate(dataset) {
  const url = `https://ckan.odpt.org/api/3/action/package_show?id=${dataset.id}`;
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`CKAN dataset fetch failed: ${response.status} ${response.statusText}`);
  }

  const body = await response.text();
  try {
    const data = JSON.parse(body);
    const resources = data?.result?.resources ?? [];
    const resource = findGtfsResource(resources, dataset.fileName);
    if (resource?.versionDate) {
      return resource.versionDate;
    }
  } catch (error) {
    // CKANがHTMLを返す環境ではデータセットページをスクレイピングする
  }

  const datasetPage = await fetch(`https://ckan.odpt.org/dataset/${dataset.id}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!datasetPage.ok) {
    throw new Error(`CKAN dataset page fetch failed: ${datasetPage.status} ${datasetPage.statusText}`);
  }

  const html = await datasetPage.text();
  const dates = [...html.matchAll(/(?:横浜市営|Yokohama Municipal)[^<]*?-(20\d{6})/g)]
    .map((match) => match[1])
    .sort((a, b) => b.localeCompare(a));

  if (!dates[0]) {
    throw new Error(`GTFS version date was not found in CKAN dataset: ${dataset.id}`);
  }

  return dates[0];
}

async function downloadZip(dataset, versionDate, tempDir) {
  const key = process.env.ODPT_API_KEY?.trim();
  if (!key) {
    throw new Error("ODPT_API_KEY is not set in app_v1/.env");
  }

  const url = new URL(`https://api.odpt.org/api/v4/files/${dataset.odptFilePath}`);
  url.searchParams.set("acl:consumerKey", key);
  url.searchParams.set("date", versionDate);

  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`GTFS download failed: ${response.status} ${response.statusText}`);
  }

  const zipPath = path.join(tempDir, dataset.fileName);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(zipPath, buffer);
  return zipPath;
}

// ZIP 展開に使う OS 標準コマンド。Node には ZIP を展開する標準 API が無く、
// パッケージ追加を避けるため外部コマンドに任せる
function getUnzipCommand(zipPath, extractDir) {
  if (process.platform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-Command", "Expand-Archive", "-LiteralPath", zipPath, "-DestinationPath", extractDir, "-Force"],
    };
  }
  // macOS / Linux は unzip（どちらも標準で入っている）。-o は既存ファイルを確認なしで上書き、-q は一覧を出さない
  return { command: "unzip", args: ["-o", "-q", zipPath, "-d", extractDir] };
}

async function expandZip(zipPath, extractDir) {
  await fs.rm(extractDir, { recursive: true, force: true });
  await fs.mkdir(extractDir, { recursive: true });

  const { command, args } = getUnzipCommand(zipPath, extractDir);

  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, timeout: UNZIP_TIMEOUT_MS });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      // コマンド自体が見つからないときは、何が無いのか分かるメッセージにする
      if (error.code === "ENOENT") {
        reject(new Error(`ZIP の展開に使う ${command} が見つかりません。インストールされているか確認してください`));
      } else {
        reject(error);
      }
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `${command} failed with exit code ${code}`));
    });
  });
}

function calculateValidity(calendarRows) {
  const starts = calendarRows.map((row) => row.start_date).filter(Boolean).sort();
  const ends = calendarRows.map((row) => row.end_date).filter(Boolean).sort();

  return {
    validFrom: starts[0] ?? null,
    validTo: ends[ends.length - 1] ?? null,
  };
}

/**
 * @abstract GTFS の shapes.txt から、系統ごとの経路の形を取り出す。
 *
 * はまこく Map は走っているバスを 30 秒ごとの位置でしか知らないので、そのままだと
 * 瞬間移動する。経路の形があれば、2 点の間を道なりに動かせる。
 *
 * route_id（系統番号。odpt:busroute の末尾と同じ）→ shape_id → 点の列、とたどる。
 * 同じ系統でも往復や経由違いで複数の shape があるので、系統ごとに配列で持つ。
 * 絞り込み（どのエリアを通るか）は配る側（hamakokumap/server/router.js）でやる
 */
async function buildShapesJson(versionDate, extractDir) {
  const shapesPath = path.join(extractDir, "shapes.txt");
  const tripsPath = path.join(extractDir, "trips.txt");
  // shapes.txt は任意の項目なので、無いデータもありうる
  const exists = await fs.access(shapesPath).then(() => true, () => false);
  if (!exists) return null;

  const shapes = parseCsv(await fs.readFile(shapesPath, "utf-8"));
  const trips = parseCsv(await fs.readFile(tripsPath, "utf-8"));

  // shape_id → 点の列（shape_pt_sequence の順）
  const points = new Map();
  for (const row of shapes) {
    const id = row.shape_id;
    if (!id) continue;
    if (!points.has(id)) points.set(id, []);
    points.get(id).push({
      seq: Number(row.shape_pt_sequence),
      lat: Number(row.shape_pt_lat),
      lon: Number(row.shape_pt_lon),
    });
  }

  // route_id → その系統が使う shape_id
  const byRoute = new Map();
  for (const row of trips) {
    if (!row.route_id || !row.shape_id) continue;
    if (!byRoute.has(row.route_id)) byRoute.set(row.route_id, new Set());
    byRoute.get(row.route_id).add(row.shape_id);
  }

  const routes = {};
  for (const [routeId, shapeIds] of [...byRoute].sort(([a], [b]) => a.localeCompare(b))) {
    const lines = [];
    for (const shapeId of [...shapeIds].sort()) {
      const pts = (points.get(shapeId) ?? []).sort((a, b) => a.seq - b.seq);
      // 緯度経度は小数5桁（約 1m）で足りる。そのままだと配るには大きい
      if (pts.length >= 2) lines.push(pts.map((p) => [round5(p.lat), round5(p.lon)]));
    }
    if (lines.length) routes[routeId] = lines;
  }

  return { source: "yokohama_municipal_bus", versionDate, routes, updatedAt: new Date().toISOString() };
}

function round5(n) {
  return Math.round(n * 1e5) / 1e5;
}

async function buildCalendarJson(dataset, versionDate, extractDir) {
  const calendarPath = path.join(extractDir, "calendar.txt");
  const calendarDatesPath = path.join(extractDir, "calendar_dates.txt");
  const [calendarText, calendarDatesText] = await Promise.all([
    fs.readFile(calendarPath, "utf-8"),
    fs.readFile(calendarDatesPath, "utf-8").catch(() => "service_id,date,exception_type\n"),
  ]);

  const calendar = parseCsv(calendarText);
  const calendarDates = parseCsv(calendarDatesText);
  const { validFrom, validTo } = calculateValidity(calendar);

  return {
    source: dataset.id,
    versionDate,
    validFrom,
    validTo,
    calendar,
    calendarDates,
    updatedAt: new Date().toISOString(),
  };
}

export async function updateGtfsCalendars() {
  const baseDir = path.join(APIDATA_DIR, "gtfs");
  await fs.mkdir(baseDir, { recursive: true });

  const results = [];
  for (const dataset of DATASETS) {
    const tempDir = path.join(baseDir, ".tmp", dataset.outputName);
    const extractDir = path.join(tempDir, "extract");
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const versionDate = await fetchLatestVersionDate(dataset);
      const zipPath = await downloadZip(dataset, versionDate, tempDir);
      await expandZip(zipPath, extractDir);

      const calendarJson = await buildCalendarJson(dataset, versionDate, extractDir);
      const outputDir = path.join(baseDir, dataset.outputName);
      await fs.mkdir(outputDir, { recursive: true });
      await fs.writeFile(
        path.join(outputDir, "calendar.json"),
        JSON.stringify(calendarJson, null, 2),
        "utf-8"
      );

      // 走っているバスを道なりに動かすための経路の形。バスだけが対象
      if (dataset.outputName === "yokohamaMunicipalBus") {
        const shapesJson = await buildShapesJson(versionDate, extractDir);
        if (shapesJson) {
          await fs.writeFile(path.join(outputDir, "shapes.json"), JSON.stringify(shapesJson), "utf-8");
        }
      }

      results.push({ dataset: dataset.id, versionDate, status: "updated" });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  updateGtfsCalendars()
    .then((results) => {
      for (const result of results) {
        console.log(`${result.dataset}: ${result.status} (${result.versionDate})`);
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
