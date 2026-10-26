import "../../config/env.js";
import { earliestValidUntil, getDataTimes } from "../../utils/dataTimes.js";
import * as Utils from "../../utils/utils.js";
import { assertValidSearchQuery } from "./searchQuery.js";
import { clearCacheByPrefix, getCachedValue, ROUTE_SEARCH_TTL_MS, stableStringify } from "../../utils/cache.js";

import { extractSotetsuBusTimetable } from "../adapters/kaikan2Yokohama.js";
import { extractKanachuBusTimetable } from "../adapters/kanachu2Yokohama.js";
import { buildJson as buildJsonMunicipalBus } from "../adapters/YokohamaMunicipalBus2Yokohama.js";
import { buildJson as buildJsonMitsukamiDia } from "../adapters/Mitsukami2Yokohama_dia.js";
import { Kamihoshi2Yokohama } from "../domains/Kamihoshi2Yokohama.js";
import { pickTop10Arrivals } from "./pickFastestRoutesToYokohama.js";
import { normalizeOperatorSelection } from "./operatorSelection.js";
import { buildLastDepartures } from "./lastDepartures.js";

import { YNUYokohamaByBusOnly } from "../domains/YNU2YokohamaByBusOnly.js";
import { Wadamachi2Yokohama } from "../domains/Wadamachi2Yokohama.js";
import { YNU2YokohamaByCycle } from "../domains/YNU2YokohamaByCycleOnly.js";
import { Mitsukami2YokohamaViaBus } from "../domains/Mitsukami2YokohamaViaBus.js";
import { Mitsukami2Yokohama } from "../domains/Mitsukami2Yokohama.js";
import { Mitsukami2YokohamaViaCycle } from "../domains/Mitsukami2YokohamaViaCycle.js";
import { Wadamachi2YokohamaViaCycle } from "../domains/Wadamachi2YokohamaViaCycle.js";
import { YNU2YokohamaOnFoot } from "../domains/YNU2YokohamaOnFoot.js";

import walkspeed_fast from "../../db/transit/walking/walkspeed_fast.json" with { type: "json" };
import walkspeed_littlefast from "../../db/transit/walking/walkspeed_littlefast.json" with { type: "json" };
import walkspeed_normal from "../../db/transit/walking/walkspeed_normal.json" with { type: "json" };
import walkspeed_slow from "../../db/transit/walking/walkspeed_slow.json" with { type: "json" };

const DEBUG_MODE = process.env.DEBUG_MODE === "true";
const ENABLED_ROUTES_ENV = process.env.ENABLED_ROUTES || "FastestRoutes";
const ENABLE_ALL = ENABLED_ROUTES_ENV === "*";
const ENABLED_ROUTES = ENABLE_ALL
  ? null
  : ENABLED_ROUTES_ENV.split(",").map((route) => route.trim());

// ルート名 → 経路関数の組み合わせ。テストから構成を確かめるため export している
// ルート名 → そのルートを構成する経路関数の配列。
// プロバイダ本体と分けてデータとして持ち、テストから構成を確かめられるようにしている
export const ROUTE_DEFINITIONS = {
  // 経路関数は (paramJSON) => ... で呼ばれるため、アダプタをそのまま登録すると
  // paramJSON が第1引数（バス停ID）に入る（#88 と同じ）
  Kaikan: [(p) => extractSotetsuBusTimetable(undefined, p.currentDate)],
  Wadamachi: [Wadamachi2Yokohama],
  // 経路関数は (paramJSON) => ... の形で呼ばれる。アダプタの第1引数は
  // バス停IDなので、そのまま渡すと paramJSON がバス停IDになる
  Kanachu: [(p) => extractKanachuBusTimetable(undefined, p.currentDate)],
  BlueLine: [(p) => buildJsonMitsukamiDia(p.currentDate)],
  YokohamaMunicipalBus: [(p) => buildJsonMunicipalBus(p.currentDate)],
  Kamihoshi: [Kamihoshi2Yokohama],
  MitsukamiBus: [Mitsukami2YokohamaViaBus],
  Mitsukami: [Mitsukami2Yokohama],
  MitsukamiByCycle: [Mitsukami2YokohamaViaCycle],
  WadamachiByCycle: [Wadamachi2YokohamaViaCycle],
  YNUBusOnly: [YNUYokohamaByBusOnly],
  YNUByCycle: [YNU2YokohamaByCycle],

  TrainRoutes: [
    Wadamachi2Yokohama,
    Kamihoshi2Yokohama,
    // 地下鉄の時刻表そのもの（buildJsonMitsukamiDia）ではなく、徒歩を足して
    // RouteOption の形にする Mitsukami2Yokohama を渡す。時刻表のキーは
    // departureTime / arrivalTime で、pickTop10Arrivals が見る最終到着時刻の
    // キーが無いため、そのまま渡すと全部捨てられる
    Mitsukami2Yokohama,
  ],

  // 🚌＋🚲（コード 6）。バスだけ・シェアサイクルだけ。
  BusAndCycle: [
    YNUYokohamaByBusOnly,
    YNU2YokohamaByCycle,
  ],

  // 🚌＋🚃（コード 5）。「使ってよい手段」なので、バスだけ・電車だけ・
  // バス→地下鉄のすべてを出す（ADR-0002・#95）。
  // 1つのルートにまとめて pickTop10Arrivals に渡し、到着順に並べ直して
  // 上位 6 件にする（別々のルートにすると、それぞれ 6 件ずつつなげるだけで
  // 到着順にならず件数も増える / #94）
  BusAndTrain: [
    YNUYokohamaByBusOnly,
    Wadamachi2Yokohama,
    Kamihoshi2Yokohama,
    Mitsukami2Yokohama,
    Mitsukami2YokohamaViaBus,
  ],

  // 🚃＋🚲（コード 7）。同じく「使ってよい手段」なので、電車だけ・
  // シェアサイクルだけ・自転車→電車のすべてを出す（ADR-0002・#95・#94）
  TrainAndCycle: [
    Wadamachi2Yokohama,
    Kamihoshi2Yokohama,
    Mitsukami2Yokohama,
    YNU2YokohamaByCycle,
    Mitsukami2YokohamaViaCycle,
    Wadamachi2YokohamaViaCycle,
  ],

  FastestRoutes: [
    Kamihoshi2Yokohama,
    Mitsukami2Yokohama,
    Mitsukami2YokohamaViaBus,
    Mitsukami2YokohamaViaCycle,
    Wadamachi2Yokohama,
    Wadamachi2YokohamaViaCycle,
    YNUYokohamaByBusOnly,
    YNU2YokohamaByCycle,
    YNU2YokohamaOnFoot,
  ],
};

export const ROUTE_PROVIDERS = {
  ...Object.fromEntries(
    Object.entries(ROUTE_DEFINITIONS).map(([type, routeFns]) => [
      type,
      (param) => pickTop10Arrivals(param, routeFns).then((data) => ({ type, data })),
    ]),
  ),

  // 徒歩のみは候補が1件なので、並べ替えを通さずそのまま返す
  YNUOnFoot: (param) => YNU2YokohamaOnFoot(param)
    .then((data) => ({ type: "YNUOnFoot", data })),
};

const TRANSPORT_ROUTE_MAP = {
  0: ["YNUOnFoot"],
  1: ["FastestRoutes"],
  2: ["YNUBusOnly"],
  3: ["TrainRoutes"],
  4: ["YNUByCycle"],
  5: ["BusAndTrain"],
  6: ["BusAndCycle"],
  7: ["TrainAndCycle"],
};

function selectWalktimeList(speed) {
  switch (speed) {
    case "fast":
      return walkspeed_fast;
    case "littlefast":
      return walkspeed_littlefast;
    case "slow":
      return walkspeed_slow;
    case "normal":
    default:
      return walkspeed_normal;
  }
}

function selectWalktimeLocation(walktimeList, location) {
  switch (location) {
    case "Shokudo1":
      return walktimeList.Shokudo1;
    case "Shokudo2":
      return walktimeList.Shokudo2;
    case "RikoA":
      return walktimeList.RikoA;
    case "Library":
    default:
      return walktimeList.Library;
  }
}

export function buildRouteQueryParams(query = {}) {
  const now = query.now || Utils.getCurrentTime();
  const speed = query.speed || "normal";
  const location = query.location || "Library";
  const walktimeList = selectWalktimeList(speed);

  return {
    currentTime: now,
    currentDate: query.date,
    location,
    walkspeed: speed,
    // 「徒歩のみ」は 0 なので、|| だと "1"（全ルート）に化ける。?? で null/undefined だけを既定値にする
    routepattern: String(query.routepattern ?? "1"),
    // 使ってよい交通事業者。undefined なら事業者で絞らない。
    // 並びが一定なので、そのまま検索結果のキャッシュキーに入れられる
    operators: normalizeOperatorSelection(query.operators),
    ...selectWalktimeLocation(walktimeList, location),
  };
}

// テストから交通手段コード → ルート名の対応を確かめるために export している
export function getRequestedRouteNames(param) {
  const transport = param.routepattern ?? "1";
  // constructor や __proto__ のような継承された名前を引かないよう、自分のキーだけを見る
  return (Object.hasOwn(TRANSPORT_ROUTE_MAP, transport) && TRANSPORT_ROUTE_MAP[transport]) || ["FastestRoutes"];
}

function resolveEnabledRouteNames(param) {
  if (DEBUG_MODE) {
    if (ENABLE_ALL) return Object.keys(ROUTE_PROVIDERS);

    if (ENABLED_ROUTES && ENABLED_ROUTES.length > 0) {
      return ENABLED_ROUTES.filter((routeName) => ROUTE_PROVIDERS[routeName]);
    }
  }

  return getRequestedRouteNames(param)
    .filter((routeName) => ROUTE_PROVIDERS[routeName]);
}

function formatResults(results, enabledRouteNames) {
  const responseData = {};

  results.forEach((result, index) => {
    const routeName = enabledRouteNames[index];

    if (result.status === "fulfilled") {
      const { type, data } = result.value;
      responseData[type] = {
        status: "success",
        count: data?.length || 0,
        items: data || [],
      };
    } else {
      responseData[routeName] = {
        status: "error",
        error: result.reason?.message || "Unknown error",
        items: [],
      };

      if (DEBUG_MODE) {
        console.error(`[Route Error: ${routeName}]`, result.reason);
      }
    }
  });

  return responseData;
}

async function buildRouteSearchResponseUncached(queryParams) {
  // GTFSの鮮度・カバー範囲の確認は、GTFSを実際に読む横浜市営バス／地下鉄の
  // 経路内で行う。ここで一括確認すると、GTFSを使わない相鉄・徒歩・自転車の
  // ルートまで巻き添えで失敗するため。
  const enabledRouteNames = resolveEnabledRouteNames(queryParams);

  if (DEBUG_MODE) {
    console.log("[DEBUG] Query Parameters:", queryParams);
    console.log("[DEBUG] Enabled Routes:", ENABLE_ALL ? "ALL" : ENABLED_ROUTES);
  }

  const activeRoutes = enabledRouteNames.map((routeName) => ROUTE_PROVIDERS[routeName](queryParams));
  // 「今日の最終」は検索と並べて計算する。夜の時間帯の外なら null。
  // 失敗しても検索結果は返したいので、ここで握りつぶして欄を出さないだけにする
  const [results, lastDepartures] = await Promise.all([
    Promise.allSettled(activeRoutes),
    buildLastDepartures(queryParams).catch((error) => {
      console.error("[lastDepartures]", error);
      return null;
    }),
  ]);
  const responseData = formatResults(results, enabledRouteNames);

  const response = {
    meta: {
      requestTime: queryParams.currentTime,
      walkSpeed: queryParams.walkspeed,
      generatedAt: new Date().toISOString(),
      // 動的データの生成時刻と、時刻表の取得日時（#220。ODPT ガイドライン 2.1.1・2.2.1）
      dataTimes: getDataTimes(),
      // この結果に使った動的データのうち、最も早く切れる dct:valid（ミリ秒）。これを過ぎたら使い回さない（2.1.2）
      validUntil: earliestValidUntil(),
    },
    results: responseData,
    lastDepartures,
  };

  if (DEBUG_MODE) {
    response.debug = {
      enabledRoutes: enabledRouteNames,
      totalRoutes: results.length,
      successCount: results.filter((result) => result.status === "fulfilled").length,
      errorCount: results.filter((result) => result.status === "rejected").length,
    };
  }

  return response;
}

export async function buildRouteSearchResponse(query = {}) {
  // 許す値だけを通す。外れていれば InvalidQueryError（400）。キャッシュのキーやファイル名に、利用者の自由な文字列を入れない
  assertValidSearchQuery(query);
  const queryParams = buildRouteQueryParams(query);
  const cacheKey = `route-search:${stableStringify(queryParams)}`;

  const load = () => getCachedValue(cacheKey, ROUTE_SEARCH_TTL_MS, () =>
    buildRouteSearchResponseUncached(queryParams)
  );
  const cached = await load();
  // 寝かせているあいだに、使ったデータの dct:valid を過ぎていたら、作り直す。
  // 作り直しでは、期限切れの位置は外されるので、遅れは出ない（遅延表示対応外と同じ扱い）
  if (cached?.meta?.validUntil && Date.now() >= cached.meta.validUntil) {
    clearCacheByPrefix(cacheKey);
    return load();
  }
  return cached;
}
