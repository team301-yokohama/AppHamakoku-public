// 仮データの時刻表。時刻表のうち、アダプタが返す形（正規化したあとの形）で作る。
// 本物の ODPT の応答ではなく、実際の時刻・運行・遅れでもない。画面に出る形（案内券）をひととおり確かめるための作り物。
//
// 作り方:
//   - 毎日、同じ時刻表（5 時台〜翌 1 時台。24 時を超える分は 24 時台・25 時台で書く）。夜中の検索では、実環境と同じく、電車・バスの案内券が少なくなる
//   - 便は路線ごとに、間隔を少しずつ変えて並べる（市営バス 2 系統・相鉄バス・神奈中バス・地下鉄・相鉄線）
//   - 遅れは、今日の「いま」の前後の便にだけ付ける（市営バスの一部と地下鉄の一部）。検索日が今日でなければ付けない

import { SOTETSU_BUSSTOPPOLES } from "../config/geo/busstopPoles/sotetsuBus.js";

const pad = (n) => String(n).padStart(2, "0");
// 分 → "HH:mm"。24 時を超える分は 24 時台・25 時台で書く（ODPT の時刻表と同じ）
export const hhmm = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** 始発から終発まで、間隔（分）を順に使って並べる */
function times(startMin, endMin, headways) {
  const list = [];
  let t = startMin;
  for (let i = 0; t <= endMin; i++) {
    list.push(t);
    t += headways[i % headways.length];
  }
  return list;
}

// 日本時間の「いま」（分）と日付
function nowInJapan(now = new Date()) {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return { minutes: jst.getUTCHours() * 60 + jst.getUTCMinutes(), ymd: jst.toISOString().slice(0, 10) };
}

/** 検索日（Date | 'YYYY-MM-DD' | 'YYYYMMDD'）が今日か */
function isToday(serviceDay, now = new Date()) {
  const text = serviceDay instanceof Date ? serviceDay.toISOString().slice(0, 10) : String(serviceDay ?? "");
  const ymd = /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : text.slice(0, 10);
  return ymd === nowInJapan(now).ymd;
}

/** 遅れ（分）。いまの前後の便にだけ、3 / 2 / 0 / 4 / 5 / 0 分を順に付ける（0 は遅れなし） */
const DELAY_CYCLE = [3, 2, 0, 4, 5, 0];
function delayFor(departureMin, index, serviceDay, now, { from = -5, to = 45 } = {}) {
  if (!isToday(serviceDay, now)) return null;
  const diff = departureMin - nowInJapan(now).minutes;
  if (diff < from || diff > to) return null;
  return DELAY_CYCLE[index % DELAY_CYCLE.length];
}

const MUNICIPAL = "odpt.Operator:YokohamaMunicipal";
const SOTETSU_BUS = "odpt.Operator:SotetsuBus";
const KANACHU = "odpt.Operator:Kanachu";

/**
 * 横浜市営バス（YokohamaMunicipalBus2Yokohama.buildJson の形）
 *   系統 202: 国大中央・国大北から、三ツ沢上町駅前を通って横浜駅西口へ
 *   系統 208: 横浜新道・岡沢町から、三ツ沢上町駅前を通って横浜駅西口へ
 * 遅れは、市営バスだけが持つ（位置から求める。実環境と同じ）
 */
export function demoMunicipalBus(serviceDay, now = new Date()) {
  const trips = [];
  times(5 * 60 + 30, 25 * 60 + 20, [14, 13, 15]).forEach((dep, i) => {
    trips.push({
      busTimetable: `odpt.BusTimetable:YokohamaMunicipal.Demo202.${i}`,
      busroute: "odpt.BusroutePattern:YokohamaMunicipal.20202.03_1",
      operator: MUNICIPAL,
      departureTime: { 国大北: [hhmm(dep - 2)], 国大中央: [hhmm(dep)] },
      arrivalTime: { 三ツ沢上町駅前: [hhmm(dep + 11)], 横浜駅西口: [hhmm(dep + 21)] },
      poleTimeMap: {},
      isMidnight: dep >= 22 * 60 + 30,
      delay: delayFor(dep, i, serviceDay, now),
      busNumber: null,
      busType: null,
      delayReportedAt: null,
      fromBusstopPole: null,
      toBusstopPole: null,
      destinationBusstopPole: null,
      occupancyStatus: null,
    });
  });
  times(5 * 60 + 45, 25 * 60 + 10, [17, 16, 18]).forEach((dep, i) => {
    trips.push({
      busTimetable: `odpt.BusTimetable:YokohamaMunicipal.Demo208.${i}`,
      busroute: "odpt.BusroutePattern:YokohamaMunicipal.20800.03_1",
      operator: MUNICIPAL,
      departureTime: { 岡沢町: [hhmm(dep - 1)], 横浜新道: [hhmm(dep)] },
      arrivalTime: { 三ツ沢上町駅前: [hhmm(dep + 7)], 横浜駅西口: [hhmm(dep + 15)] },
      poleTimeMap: {},
      isMidnight: dep >= 22 * 60 + 30,
      delay: delayFor(dep, i + 3, serviceDay, now),
      busNumber: null,
      busType: null,
      delayReportedAt: null,
      fromBusstopPole: null,
      toBusstopPole: null,
      destinationBusstopPole: null,
      occupancyStatus: null,
    });
  });
  return trips;
}

/**
 * 相鉄バス 浜11（kaikan2Yokohama.extractSotetsuBusTimetable の形）。遅れは配信されないので無し
 */
export function demoSotetsuBus() {
  const P = SOTETSU_BUSSTOPPOLES;
  return times(5 * 60 + 40, 25 * 60 + 5, [19, 20, 18]).map((dep, i) => ({
    busroute: "odpt.BusroutePattern:SotetsuBus.Hama11.502002.2",
    operator: SOTETSU_BUS,
    departureTime: {
      [P.KOKUDAI_NISHI.name]: [hhmm(dep - 3)],
      [P.KOKUDAI_CHUO_1.name]: [hhmm(dep)],
      [P.DAIGAKU_KAIKAN_MAE.name]: [hhmm(dep + 2)],
    },
    arrivalTime: { [P.MITSUZAWA_KAMIMACHI.name]: [], [P.YOKOHAMA_NISHIGUCHI.name]: hhmm(dep + 24) },
    isMidnight: dep >= 22 * 60 + 30,
    delay: null,
    trainType: null,
    fromBusstopPole: null,
    toBusstopPole: null,
    destinationBusstopPole: P.YOKOHAMA_NISHIGUCHI.id,
    occupancyStatus: null,
  }));
}

/**
 * 神奈中バス（kanachu2Yokohama.extractKanachuBusTimetable の形）。遅れは配信されないので無し
 */
export function demoKanachuBus() {
  return times(6 * 60, 24 * 60 + 30, [24, 23, 25]).map((dep) => ({
    busroute: "odpt.BusroutePattern:Kanachu.01.26202.1",
    operator: KANACHU,
    departureTime: { 横浜新道: [hhmm(dep)], 岡沢町: [hhmm(dep + 2)] },
    arrivalTime: { 三ツ沢上町: hhmm(dep + 7), 横浜駅西口: hhmm(dep + 17) },
    delay: null,
    trainType: null,
    fromBusstopPole: null,
    toBusstopPole: null,
    destinationBusstopPole: "odpt.BusstopPole:Kanachu.Yokohamaekinishiguchi.12036.14",
    occupancyStatus: null,
  }));
}

/**
 * 横浜市営地下鉄ブルーライン（Mitsukami2Yokohama_dia.buildJson の形）。三ツ沢上町から横浜まで
 * 先頭に { date, currentTime } が入る（実環境と同じ）
 */
export function demoSubway(serviceDay, now = new Date()) {
  const trains = times(5 * 60 + 10, 25 * 60 + 30, [10, 11, 9, 12]).map((dep, i) => ({
    trainNumber: `D${String(100 + i)}K`,
    departureTime: hhmm(dep),
    arrivalTime: hhmm(dep + 4),
    delay: delayFor(dep, i + 1, serviceDay, now, { from: -2, to: 35 }),
    trainType: "odpt.TrainType:YokohamaMunicipal.Local",
    fromStation: null,
    toStation: null,
    originStation: "odpt.Station:YokohamaMunicipal.Blue.Azamino",
    destinationStation: "odpt.Station:YokohamaMunicipal.Blue.Shonandai",
  }));
  const { minutes } = nowInJapan(now);
  return [{ date: String(serviceDay), currentTime: hhmm(minutes) }, ...trains];
}

/**
 * 相鉄線（sotetsu2Yokohama.extractSotetsuTimetable の形）。和田町・上星川から横浜まで。遅れは配信されないので無し
 */
export function demoSotetsuTrain() {
  return times(5 * 60 + 6, 25 * 60 + 25, [14, 13, 15]).map((wada, i) => ({
    trainId: `odpt.Train:Sotetsu.Demo.${i}`,
    trainNumber: `${600 + i}K`,
    operator: "odpt.Operator:Sotetsu",
    departureTime: { 上星川: hhmm(wada - 3), 和田町: hhmm(wada) },
    arrivalTime: hhmm(wada + 11),
    delay: null,
    trainType: "odpt.TrainType:Sotetsu.Local",
    fromstation: null,
    toStation: null,
    destinationStation: "odpt.Station:Sotetsu.Main.Yokohama",
  }));
}

/**
 * シェアサイクルのフィード（GBFS の station_status の形）。cycleportlist.json のポートと同じ ID で作る
 * 台数は、ポートごとに決まった値（0 台・満車・空きありを混ぜる）
 * @param {Array<{station_id: string|number, feedIds?: Record<string, string>}>} ports
 * @param {string} feedKey 'hellocycling' | 'docomo'
 */
export function demoCycleFeed(ports, feedKey, now = new Date()) {
  const pattern = [
    { bikes: 5, docks: 7 },
    { bikes: 0, docks: 9 },
    { bikes: 3, docks: 0 },
    { bikes: 8, docks: 4 },
    { bikes: 1, docks: 10 },
  ];
  const stations = [];
  ports.forEach((port, i) => {
    const id = feedKey === "hellocycling" ? String(port.station_id) : port.feedIds?.[feedKey];
    if (!id) return;
    const p = pattern[(i + (feedKey === "docomo" ? 2 : 0)) % pattern.length];
    stations.push({ station_id: String(id), num_bikes_available: p.bikes, num_docks_available: p.docks, is_renting: true, is_returning: true });
  });
  return { last_updated: Math.floor(now.getTime() / 1000), ttl: 60, data: { stations } };
}
