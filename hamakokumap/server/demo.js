// はまこく Map の仮データ（公開用のコピーで、トークンが無くても画面を確かめられるようにする。#276）。
//
// すべて作り物で、実際の台数・バスの位置・遅れではない。切り替え（DEMO_MODE）と帯は app_v1/demo/ にあり、
// このファイルは「作り物の中身」だけを持つ（Map のルーターは app_v1 を import しない。ADR-0030）。

import { readFileSync } from "node:fs";

const pad = (n) => String(n).padStart(2, "0");

// 日本時間の HH:mm
function hhmmJapan(date) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`;
}

/**
 * 台数の仮のフィード（GBFS の station_status の形）。ポートごとに決まった値（0 台・満車・空きありを混ぜる）
 * @param {Iterable<string>|undefined} ids - 作る station_id（ports.json にあるもの）
 */
export function demoStatusBody(ids, now = new Date()) {
  const pattern = [
    { bikes: 5, docks: 7 },
    { bikes: 0, docks: 9 },
    { bikes: 3, docks: 0 },
    { bikes: 8, docks: 4 },
    { bikes: 1, docks: 10 },
    { bikes: 2, docks: 3 },
  ];
  const stations = [...(ids ?? [])].sort().map((id, i) => ({
    station_id: String(id),
    num_bikes_available: pattern[i % pattern.length].bikes,
    num_docks_available: pattern[i % pattern.length].docks,
    is_renting: true,
    is_returning: true,
  }));
  return { last_updated: Math.floor(now.getTime() / 1000), ttl: 60, data: { stations } };
}

/**
 * ports.json から、エリアごとの範囲と、バス停の緯度経度を読む（バスの仮の位置を、バス停の間に置くため）。
 * ports.json のバス停は、地図の座標（x・y）で持っているので、地図の範囲（bbox・viewBox）から緯度経度に戻す
 * @returns {{id: string, bbox: object, stops: {name: string, lat: number, lon: number}[]}[]}
 */
export function loadDemoGeometry(portsJsonPath) {
  try {
    const data = JSON.parse(readFileSync(portsJsonPath, "utf-8"));
    return (data.areas ?? []).filter((a) => a.bbox && a.viewBox).map((area) => ({
      id: area.id,
      bbox: area.bbox,
      stops: (area.busStops ?? []).map((stop) => ({
        name: stop.name,
        lon: area.bbox.lonMin + (stop.x / area.viewBox.width) * (area.bbox.lonMax - area.bbox.lonMin),
        lat: area.bbox.latMax - (stop.y / area.viewBox.height) * (area.bbox.latMax - area.bbox.latMin),
      })),
    }));
  } catch {
    return [];
  }
}

// 構内を回る順（バス停の名前）。実際の運行ではない
const LOOP = ["横浜新道", "岡沢町", "横浜国立大学正門前", "大学会館前", "国大中央", "国大北", "国大西", "国大南門", "常盤台住宅"];
const LOOP_MS = 18 * 60 * 1000; // 1 周の時間
const BUSES = [
  { route: "202", delay: 3, occupancy: "座席がうまる" },
  { route: "208", delay: 0, occupancy: "空いている" },
  { route: "202", delay: 5, occupancy: "立ち席あり" },
  { route: "208", delay: 2, occupancy: "空いている" },
];

// 北を 0、時計回りの向き（度）
function azimuth(from, to) {
  const dx = (to.lon - from.lon) * Math.cos((from.lat * Math.PI) / 180);
  const dy = to.lat - from.lat;
  return Math.round(((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360);
}

/**
 * 走っているバスの仮の応答（/api/buses の形）。構内のバス停の間を、時間とともに回る
 * @param {ReturnType<typeof loadDemoGeometry>} geometry
 */
export function demoBusesBody(geometry, now = new Date()) {
  const areas = Object.fromEntries(geometry.map((a) => [a.id, []]));
  const campus = geometry.find((a) => LOOP.every((name) => a.stops.some((s) => s.name === name)));
  if (campus) {
    const stops = LOOP.map((name) => campus.stops.find((s) => s.name === name));
    // 区間の長さ（度の距離）に比例して、1 周の時間を割る
    const lengths = stops.map((s, i) => Math.hypot(stops[(i + 1) % stops.length].lat - s.lat, (stops[(i + 1) % stops.length].lon - s.lon) * 0.82));
    const total = lengths.reduce((a, b) => a + b, 0);
    BUSES.forEach((spec, k) => {
      const phase = ((now.getTime() / LOOP_MS) + k / BUSES.length) % 1;
      let at = phase * total;
      let i = 0;
      while (at > lengths[i]) { at -= lengths[i]; i = (i + 1) % stops.length; }
      const from = stops[i];
      const to = stops[(i + 1) % stops.length];
      const f = at / lengths[i];
      const minutesPerLength = (LOOP_MS / 60000) / total;
      // この先の到着見込み: 次のバス停・その先のバス停・終点（横浜駅西口）
      const upcoming = [];
      let minutes = (lengths[i] - at) * minutesPerLength;
      for (let j = 1; j <= 2; j++) {
        const stop = stops[(i + j) % stops.length];
        const scheduled = new Date(now.getTime() + minutes * 60000);
        upcoming.push({
          name: stop.name,
          time: hhmmJapan(scheduled),
          expected: hhmmJapan(new Date(scheduled.getTime() + spec.delay * 60000)),
          kind: j === 1 ? "next" : "via",
        });
        minutes += lengths[(i + j) % stops.length] * minutesPerLength;
      }
      const arrive = new Date(now.getTime() + (minutes + 12) * 60000);
      upcoming.push({ name: "横浜駅西口", time: hhmmJapan(arrive), expected: hhmmJapan(new Date(arrive.getTime() + spec.delay * 60000)), kind: "terminal" });
      areas[campus.id].push({
        id: `odpt.Bus:YokohamaMunicipal.Demo.${k}`,
        lat: from.lat + (to.lat - from.lat) * f,
        lon: from.lon + (to.lon - from.lon) * f,
        azimuth: azimuth(from, to),
        route: spec.route,
        terminal: "横浜駅西口",
        next: to.name,
        occupancy: spec.occupancy,
        reportedAt: now.toISOString(),
        // 画面は、次に取り直すまでのあいだ、これを過ぎた位置を外す。実環境と同じく、生成から 36 秒
        validUntil: new Date(now.getTime() + 36 * 1000).toISOString(),
        delay: spec.delay,
        stops: upcoming,
      });
    });
  }
  return { areas, fetchedAt: now.getTime(), reportedAt: now.toISOString() };
}
