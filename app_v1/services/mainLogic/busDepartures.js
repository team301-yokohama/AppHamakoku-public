// バス停ごとの「横浜駅方面の発車時刻」。
//
// はまこく Map の地図でバス停をタップしたときに出す。ルート検索を経由せず、
// 「いまこの停留所から何時に出るか」だけを知りたい用途。
//
// 3事業者の adapter はどれも「1便 = 1オブジェクト、departureTime は停留所名をキーにした時刻」
// という同じ形を返すので、それを停留所ごとに並べ替えるだけでよい。時刻表そのものは
// adapter がキャッシュしており、ここでは持たない（コピーもしない）。
//
// 駅（三ッ沢上町・和田町・羽沢横浜国大）は入れていない。地下鉄・相鉄線の adapter は
// 停留所名で引ける形を返さないため、issue の Step 5 として分けてある。

import { getDataTimes, toIso } from "../../utils/dataTimes.js";
import { extractSotetsuBusTimetable } from "../adapters/kaikan2Yokohama.js";
import { extractKanachuBusTimetable } from "../adapters/kanachu2Yokohama.js";
import { buildJson as buildMunicipalJson } from "../adapters/YokohamaMunicipalBus2Yokohama.js";
import { BUS_STOP_MAP } from "../../config/geo/busstopPoles/stopNameMap.js";
import { timeToMinutesExtended } from "../../utils/utils.js";
import { debugError } from "../../utils/debug/debug.js";

/** 画面に出す事業者の名前。config/providers/operators.js とは用途が違う（ここは地図の表示用） */
export const BUS_OPERATOR_LABELS = {
  sotetsu: "相鉄バス",
  municipal: "市営バス",
  kanachu: "神奈中バス",
};

/**
 * @abstract 1便（adapter の返す形）から、停留所ごとの発車時刻を取り出す
 * @param {object} trip - departureTime が「停留所名 → 時刻 or 時刻の配列」になっているもの
 * @returns {{stop: string, time: string}[]}
 */
function departuresOf(trip) {
  const out = [];
  for (const [stop, value] of Object.entries(trip.departureTime ?? {})) {
    for (const time of Array.isArray(value) ? value : [value]) {
      if (typeof time === "string" && /^\d{1,2}:\d{2}$/.test(time)) out.push({ stop: CANONICAL_STOP[stop] ?? stop, time });
    }
  }
  return out;
}

/**
 * @abstract 同じ停留所の別表記を、地図に描いてある名前にそろえる
 *
 * 市営バスは「横浜新道(新道)」、相鉄バスは「横浜新道」と返すが、地図（OSM 由来）は
 * 「横浜新道」。BUS_STOP_MAP の stopNames の先頭を代表の名前として使う
 */
const CANONICAL_STOP = Object.fromEntries(
  BUS_STOP_MAP.flatMap(({ stopNames }) => stopNames.map((name) => [name, stopNames[0]])),
);

/**
 * @abstract 系統名を短くする。取り出せないときは null（画面では事業者名だけ出す）
 *
 * - odpt.BusroutePattern:SotetsuBus.Hama10.503004.1 → Hama10
 * - odpt.BusroutePattern:Kanachu.01.26202.1 → 01
 * - YokohamaMunicipal.202 → 202（市営バスだけ odpt. が付かない形で来る）
 */
export function shortRouteName(busroute) {
  if (typeof busroute !== "string") return null;
  const parts = busroute.split(".");
  const i = busroute.startsWith("odpt.") ? 2 : 1;
  return parts[i] || null;
}

/**
 * @abstract 3事業者の時刻表を、停留所ごとの発車時刻にまとめる
 *
 * 1事業者が落ちても、残りは返す（Promise.allSettled）。どこで欠けたかは errors に入れる。
 *
 * @param {Date} serviceDay - 検索日。平日／土休日の判定に使う
 * @returns {Promise<{stops: Record<string, object[]>, errors: string[]}>}
 */
export async function getBusDeparturesByStop(serviceDay = new Date()) {
  const sources = [
    ["sotetsu", () => extractSotetsuBusTimetable(undefined, serviceDay)],
    ["kanachu", () => extractKanachuBusTimetable(undefined, serviceDay)],
    ["municipal", () => buildMunicipalJson(serviceDay)],
  ];

  const results = await Promise.allSettled(sources.map(([, load]) => load()));
  const stops = {};
  const errors = [];
  // 遅れの元になった位置の、いちばん新しい生成時刻（dc:date）。画面に出す（#220。ODPT ガイドライン 2.1.1）
  let delayAsOf = null;

  results.forEach((result, i) => {
    const [operator] = sources[i];
    if (result.status !== "fulfilled") {
      debugError(`[busDepartures] ${operator} の時刻表を取得できませんでした: ${result.reason?.message ?? result.reason}`);
      errors.push(operator);
      return;
    }
    for (const trip of result.value ?? []) {
      const reported = toIso(trip.delayReportedAt);
      if (reported && (!delayAsOf || reported > delayAsOf)) delayAsOf = reported;
      for (const { stop, time } of departuresOf(trip)) {
        (stops[stop] ??= []).push({
          time,
          operator,
          route: shortRouteName(trip.busroute),
          // 深夜バスは運賃が変わるので、分かるときは印を付ける
          isMidnight: trip.isMidnight ?? null,
          // いまの遅れ（分）。市営バスだけ、走っている位置から adapter が求める。
          // 相鉄バス・神奈中は位置を配信していないので常に null（＝時刻表どおりとしか言えない）
          delay: Number.isFinite(trip.delay) ? trip.delay : null,
        });
      }
    }
  });

  // 同じ停留所の中は時刻順。24 時超え表記（25:10 など）が後ろに来るよう Extended で比べる
  for (const list of Object.values(stops)) {
    list.sort((a, b) => timeToMinutesExtended(a.time) - timeToMinutesExtended(b.time));
  }

  // 時刻表を取得した日時（事業者ごと）も、画面に出す（2.2.1）
  const { fetched } = getDataTimes();
  const timetableAsOf = {
    sotetsu: fetched["timetable.sotetsuBus"] ?? null,
    kanachu: fetched["timetable.kanachuBus"] ?? null,
    municipal: fetched["timetable.municipalBus"] ?? null,
  };

  return { stops, errors, delayAsOf, timetableAsOf };
}
