// はまこく Map の「横浜駅から出る電車」の仮データ。services/mainLogic/trainDepartures.js の
// getTrainDeparturesAtYokohama が返す形で作る。作り物で、実際の発車・遅れ・運行情報ではない。

import { YOKOHAMA_RAIL_LINES, YOKOHAMA_RAIL_OPERATORS } from "../config/geo/stations/yokohamaStation.js";

const pad = (n) => String(n).padStart(2, "0");
const hhmm = (minutes) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;

// 路線ごとの方向の中身（種別・行先・間隔）。行先と種別は、実際の路線に近い言い方にしてあるが、運行とは関係ない
const LINES = {
  "jr-tokaido": { delay: true, info: { text: "平常どおり運転しています", normal: true }, Inbound: { types: ["普通", "快速"], dests: ["東京", "上野", "高崎"], headway: 7 }, Outbound: { types: ["普通", "快速"], dests: ["小田原", "熱海"], headway: 9 } },
  "jr-yokosuka": { delay: true, info: { text: "一部の列車に遅れが出ています", normal: false }, Inbound: { types: ["普通", "快速"], dests: ["千葉", "成田空港"], headway: 12 }, Outbound: { types: ["普通"], dests: ["久里浜", "逗子"], headway: 12 } },
  "jr-keihintohoku": { delay: true, info: { text: "平常どおり運転しています", normal: true }, Northbound: { types: ["快速", "各駅停車"], dests: ["大宮", "南浦和"], headway: 5 }, Southbound: { types: ["快速", "各駅停車"], dests: ["大船", "桜木町"], headway: 5 } },
  "jr-shonanshinjuku": { delay: true, info: { text: "平常どおり運転しています", normal: true }, Northbound: { types: ["普通"], dests: ["宇都宮", "高崎"], headway: 15 }, Southbound: { types: ["普通"], dests: ["逗子", "小田原"], headway: 15 } },
  "keikyu-main": { delay: false, info: { text: "平常どおり運転しています", normal: true }, Inbound: { types: ["快特", "普通"], dests: ["品川", "羽田空港"], headway: 6 }, Outbound: { types: ["快特", "普通"], dests: ["浦賀", "三崎口"], headway: 6 } },
  "tokyu-toyoko": { delay: false, info: { text: "平常どおり運転しています", normal: true }, Inbound: { types: ["特急", "各停"], dests: ["渋谷", "和光市"], headway: 6 } },
  "sotetsu-main": { delay: false, info: { text: "平常どおり運転しています", normal: true }, Outbound: { types: ["特急", "快速", "各停"], dests: ["海老名", "湘南台"], headway: 9 } },
  "subway-blue": { delay: true, info: { text: "平常どおり運転しています", normal: true }, Inbound: { types: ["普通"], dests: ["あざみ野", "新羽"], headway: 8 }, Outbound: { types: ["普通"], dests: ["湘南台", "踊場"], headway: 8 } },
};

// 遅れ（分）。0 は遅れなし。発車の順に回す
const DELAYS = [0, 3, 0, 2, 0, 4];

/**
 * @param {Date} serviceDay
 * @param {Date} now - 「次の3本」の基準
 * @param {string} calendar - 'Weekday' | 'SaturdayHoliday'（本物と同じ）
 */
export function demoTrainDepartures(serviceDay = new Date(), now = new Date(), calendar = "Weekday") {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const nowMinutes = jst.getUTCHours() * 60 + jst.getUTCMinutes();
  const asOf = now.toISOString();

  const operators = YOKOHAMA_RAIL_OPERATORS.map((operator) => {
    const lines = YOKOHAMA_RAIL_LINES.filter((line) => line.operatorId === operator.id).map((line, lineIndex) => {
      const spec = LINES[line.id] ?? { delay: false, info: { text: "平常どおり運転しています", normal: true } };
      const directions = Object.entries(line.directions ?? {}).map(([id, name], dirIndex) => {
        const d = spec[id] ?? { types: ["普通"], dests: ["終点"], headway: 10 };
        const departures = [0, 1, 2].map((n) => {
          const minutes = nowMinutes + 2 + ((lineIndex * 3 + dirIndex * 2) % d.headway) + n * d.headway;
          return {
            time: hhmm(minutes),
            type: d.types[n % d.types.length],
            delay: spec.delay ? DELAYS[(lineIndex + dirIndex + n) % DELAYS.length] : null,
            destination: d.dests[n % d.dests.length],
            position: spec.delay && n === 0 ? { from: "保土ケ谷", to: "横浜" } : null,
          };
        });
        return { id, name, finished: false, departures };
      });
      return {
        id: line.id,
        name: line.name,
        delayAsOf: spec.delay ? asOf : null,
        infoAsOf: asOf,
        timetableFetchedAt: asOf,
        delayAvailable: Boolean(spec.delay),
        infoAvailable: true,
        info: spec.info,
        directions,
      };
    });
    return { id: operator.id, name: operator.name, lines };
  }).filter((operator) => operator.lines.length);

  return { calendar, operators, errors: [] };
}
