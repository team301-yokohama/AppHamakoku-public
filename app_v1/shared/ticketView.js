/**
 * 案内券・ダイヤ図を描くための値づくり。
 *
 * サーバ（EJS）とブラウザ（React の島）の両方から使う。計算の中身は
 * services/ と app.js の shapeRouteData() にあり、ここはその結果を
 * 画面に出す形へ直すだけ。外部に依存しない純粋な関数だけを置く。
 */

import { operatorName, operatorShortName } from "../config/providers/operators.js";

// EJS から ticketView 経由で呼べるようにする
export { operatorShortName };

// 乗り物として数える区間（徒歩は乗換に数えない）
export const RIDE_TYPES = ["bus", "train", "sharecycle"];

export function toMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = String(hhmm).split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

export function addMinutes(hhmm, add) {
  const base = toMinutes(hhmm);
  if (base === null) return hhmm;
  const total = (((base + add) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// 日をまたぐ区間があるので、負になったら翌日として足す
export function spanMinutes(from, to) {
  const a = toMinutes(from);
  const b = toMinutes(to);
  if (a === null || b === null) return 0;
  return b >= a ? b - a : b + 1440 - a;
}

// CSS のクラス名は sharecycle ではなく cycle（ADR-0011 の模様）
export function modeOf(type) {
  return type === "sharecycle" ? "cycle" : type;
}

// 券面に並べる路線名。行先表示の系統名・路線名でそろえ、分からなければ
// 事業者名 →「バス」「電車」の順に代わりを出す（ADR-0019, ADR-0026）
export function rideLabel(leg) {
  if (leg.type === "bus") {
    // 系統番号だけではどこのバスか分からないので、事業者を前に付ける（ADR-0026）
    if (leg.shortOperator && leg.busroute) return `${leg.shortOperator}：${leg.busroute}`;
    return leg.busroute || leg.operator || "バス";
  }
  if (leg.type === "train") return leg.ticketLine || leg.line || leg.operator || "電車";
  return "シェアサイクル";
}

export function rideDetail(leg) {
  const route = leg.type === "bus"
    ? (leg.busroute ? `${leg.busroute}系統` : "")
    : (leg.line || "");
  return [leg.operator, route].filter(Boolean).join(" ");
}

/**
 * 区間ごとの「いまの遅れ」を前から積む。
 *
 * 遅れは、次に乗る便の定刻発でいったん吸収される。
 * 例: バスが6分遅れても、乗り継ぐ電車まで8分あれば横浜駅の到着は定刻のまま。
 * それでも途中の地点は遅れて通るので、定刻と見込みの両方を出せるように、
 * 地点ごとの遅れを返す。
 *
 * 間に合わないときは `missed` を立てる。次の便に乗り換えられるかどうかは
 * 余裕時間0分の扱い（ADR-0004）とぶつかるので、ここでは判定だけ返す。
 */
function buildLegDelays(steps) {
  let carry = 0;

  return steps.map((leg, i) => {
    const prev = i > 0 ? steps[i - 1] : null;
    // 定刻どうしの間隔。ここが遅れを吸収できる余裕になる
    const slack = prev ? spanMinutes(prev.arrivaltime, leg.departuretime) : 0;
    const own = Number(leg.delay) > 0 ? Number(leg.delay) : 0;
    const scheduled = leg.type === "bus" || leg.type === "train";

    let departure;
    let missed = false;

    if (scheduled) {
      // 定刻までに着けば定刻発。間に合わなければ、その分だけ遅れて出る
      const late = Math.max(0, carry - slack);
      missed = late > 0;
      departure = late + own;
    } else {
      // 歩き出す・自転車を借りるのは、着いた時点
      departure = carry;
    }

    // 区間の所要そのものは書き換えない（ADR-0012）
    carry = departure;
    return { departure, arrival: departure, missed };
  });
}

/**
 * 経路1件を、案内券1枚とダイヤ図1行に必要な形へ直す。
 *
 * @param {object} route - shapeRouteData() が返す1件（index / fare / totaltime / step[]）
 */
export function buildTicket(route) {
  const steps = route.step || [];
  const rides = steps.filter((leg) => RIDE_TYPES.includes(leg.type));
  const scheduled = steps.some((leg) => leg.type === "bus" || leg.type === "train");

  // 地点ごとの遅れ。到着に効く遅れは、最後の区間まで積んだ値になる。
  // 途中で吸収されれば 0（バスが遅れても乗り継ぐ電車が定刻なら到着は定刻）
  const legDelays = buildLegDelays(steps);
  const lastRideIndex = steps.map((leg) => RIDE_TYPES.includes(leg.type)).lastIndexOf(true);
  const delay = legDelays.length > 0 ? legDelays[legDelays.length - 1].arrival : 0;
  // 途中だけ遅れる経路もあるので、見込みの列を出すかは別に見る
  const hasEstimate = legDelays.some((d) => d.departure > 0 || d.arrival > 0);

  // 手段の帯。区間の所要分に比例した長さで並べ、間が空くところは待ちとして置く
  const bands = [];
  steps.forEach((leg, i) => {
    const minutes = Number(leg.time) > 0
      ? Number(leg.time)
      : spanMinutes(leg.departuretime, leg.arrivaltime);
    bands.push({
      kind: modeOf(leg.type),
      minutes,
      delayed: Number(leg.delay) > 0,
      from: leg.departuretime,
      to: leg.arrivaltime,
    });
    const next = steps[i + 1];
    if (next) {
      const wait = spanMinutes(leg.arrivaltime, next.departuretime);
      if (wait > 0) {
        bands.push({
          kind: "wait",
          minutes: wait,
          delayed: false,
          from: leg.arrivaltime,
          to: next.departuretime,
        });
      }
    }
  });

  const departure = steps.length ? steps[0].departuretime : null;
  const arrival = steps.length ? steps[steps.length - 1].arrivaltime : null;

  return {
    index: route.index,
    fare: route.fare,
    fareCash: route.fareCash,
    totaltime: route.totaltime,
    steps,
    rides,
    rideLabels: rides.map(rideLabel),
    scheduled,
    delay,
    legDelays,
    hasEstimate,
    missedConnection: legDelays.some((d) => d.missed),
    lastRideIndex,
    transfers: Math.max(rides.length - 1, 0),
    departure,
    arrival,
    estimatedArrival: delay > 0 ? addMinutes(arrival, delay) : arrival,
    cycle: steps.find((leg) => leg.type === "sharecycle") || null,
    bands,
    bandTotal: bands.reduce((sum, b) => sum + b.minutes, 0) || 1,
  };
}

/**
 * @abstract 券の見出しに添える、使える事業者の印
 *
 * @detail 貸出ポートにいる事業者を返す。「どのアプリが要るか」を券を開く前に
 *         分かるようにするため。借りられない事業者（0 台・貸出不可）も
 *         usable: false で返し、画面では灰色にする。そのポートで
 *         「このアプリでは借りられない」ことも一目で伝わるようにするため。
 *
 * @param {object|null} cycle - ticket.cycle（sharecycle の区間）
 * @returns {Array<{className:string, name:string, fullName:string, usable:boolean}>}
 */
export function cycleTicketOperators(cycle) {
  if (!cycle) return [];

  return cycleRentalChips(cycle.rentalByOperator)
    .map(({ className, name, fullName, usable }) => ({ className, name, fullName, usable }));
}

/**
 * @abstract ポート名を券面に出す短い形にする
 *
 * @detail フィードの名前は事業者の管理番号と大学名が頭に付いていて長い。
 *         券面の要約は幅が足りないので落とす。詳細ではフィードどおりの名前を出す。
 *           "H-029.横浜国立大学横浜国大橋下駐輪場" → "横浜国大橋下駐輪場"
 *           "005.横浜ベイクォーター"                → "横浜ベイクォーター"
 *         はまこく Map の toDisplayName と同じ考え方。
 *
 * @param {string|null|undefined} name
 * @returns {string}
 */
export function shortPortName(name) {
  if (!name) return "";

  return String(name)
    .replace(/^[A-Za-z]{0,3}-?\d+[.．]\s*/, "")   // "H-029." "005." "KG-003." を落とす
    .replace(/^横浜国立大学(?=.)/, "")
    .replace(/　/g, " ")
    .trim();
}

/**
 * 事業者キー（HelloCycling）を CSS のクラス名（op-hellocycling）にする。
 * はまこく Map と同じ綴りにそろえてあるので、色の定義を共有できる。
 */
const operatorClass = (key) => `op-${String(key).toLowerCase()}`;

/**
 * @abstract 貸出ポートの、事業者ごとの台数チップ
 *
 * @detail 券面の要約とちがい、詳細では 1 事業者だけのポートでも出す。
 *         「どのアプリで借りられるか」が色で分かるようにするため。
 *
 * @param {object|null} byOperator - step の rentalByOperator
 * @returns {Array<{className:string, name:string, count:number, usable:boolean}>}
 */
export function cycleRentalChips(byOperator) {
  if (!byOperator) return [];

  return Object.entries(byOperator).map(([key, raw]) => ({
    className: operatorClass(key),
    name: operatorShortName(key) || key,       // チップに出す短い名前
    fullName: operatorName(key) || key,        // ツールチップに出す正式名
    count: Number(raw?.num_bikes_available) || 0,
    usable: Boolean(raw?.is_renting) && Number(raw?.num_bikes_available) > 0,
  }));
}

/**
 * @abstract 返却ポートのチップ
 *
 * @detail 空きはラックを共用していて 1 つの数しか無いので、**数字は 1 つだけ**出す。
 *         事業者ごとの色は印として並べ、返却を受け付けていない事業者は灰色にする
 *         （その事業者のアプリでは返せない、という意味）。
 *         数は HELLO CYCLING の値をもとにしている（docs/gbfs-port-data.md）。
 *
 * @param {object|null} byOperator - step の returnByOperator
 * @param {number|null} docks - step の returncapacity
 * @param {boolean} capacityUnknown - step の returnCapacityUnknown
 * @returns {{operators:Array<{className:string,name:string,usable:boolean}>, label:string, title:string}|null}
 */
export function cycleReturnChip(byOperator, docks, capacityUnknown) {
  if (!byOperator) return null;

  const operators = Object.entries(byOperator).map(([key, raw]) => ({
    className: operatorClass(key),
    name: operatorName(key) || key,
    usable: Boolean(raw?.is_returning),
  }));

  // 返却枠に制限が無いポートは数字が当てにならないので「空きあり」とだけ出す
  const label = capacityUnknown ? "空きあり" : (Number(docks) > 0 ? `空き${docks}` : "満");

  const title = operators
    .map((op) => `${op.name}: ${op.usable ? "返せる" : "返せない"}`)
    .join("\n");

  return { operators, label, title };
}

/**
 * ダイヤ図の時間軸。6件の中で一番早い出発から、遅れを含めた一番遅い到着まで。
 * 10分単位に丸める（ADR-0021）。
 */
export function buildAxis(tickets) {
  if (tickets.length === 0) return null;

  const base = tickets
    .map((t) => toMinutes(t.departure))
    .filter((m) => m !== null)
    .reduce((min, m) => Math.min(min, m), Infinity);
  if (!Number.isFinite(base)) return null;

  const start = Math.floor(base / 10) * 10;
  const end = tickets.reduce((max, t) => {
    const finish = spanMinutes(minutesToText(start), t.estimatedArrival);
    return Math.max(max, finish);
  }, 0);

  return {
    start,
    startText: minutesToText(start),
    span: Math.max(Math.ceil(end / 10) * 10, 10),
  };
}

export function minutesToText(mins) {
  const total = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// 時間軸の中での位置（%）
export function offsetPercent(axis, hhmm) {
  return (spanMinutes(axis.startText, hhmm) / axis.span) * 100;
}

export function widthPercent(axis, minutes) {
  return (minutes / axis.span) * 100;
}

// --- 報告の欄に自動で入れる文（#122・ADR-0010）-------------------------
// 利用者が説明を書かなくても、こちらで同じ検索を再現できるようにする

const TYPE_LABELS = { walk: "徒歩", bus: "バス", train: "電車", sharecycle: "シェアサイクル" };
const SPEED_LABELS = { slow: "ゆっくり", normal: "ふつう", littlefast: "早歩き", fast: "ダッシュ" };
const MODE_LABELS = { bus: "バス", train: "電車", cycle: "シェアサイクル", walk: "徒歩のみ" };

/**
 * 検索条件を1つの文にする。
 * @param {object} cond - 検索結果の条件（ja_dep / dep / date / time / time_mode / walkspeed / routepattern）
 */
export function reportConditionText(cond = {}) {
  const modes = [].concat(cond.routepattern || []).map((m) => MODE_LABELS[m] || m);
  return [
    `出発地: ${cond.ja_dep || cond.dep || "—"}`,
    `出発: ${cond.date || "—"} ${cond.time || ""}${cond.time_mode === "absolute" ? "（日時を指定）" : ""}`.trim(),
    `歩く速さ: ${SPEED_LABELS[cond.walkspeed] || cond.walkspeed || "—"}`,
    `交通手段: ${modes.length > 0 ? modes.join("・") : "すべて"}`,
  ].join(" / ");
}

/**
 * 経路1件を、区間ごとの行にする。
 * @param {object} route - shapeRouteData() が返す1件
 */
export function reportRouteText(route) {
  const ticket = buildTicket(route);
  const head = `${ticket.index}件目 ${ticket.departure || "—"}発 → ${ticket.arrival || "—"}着`
    + `（所要${ticket.totaltime ?? "—"}分・乗換${ticket.transfers}回・${ticket.fare ?? "—"}円）`
    + (ticket.delay > 0 ? ` 遅れ${ticket.delay}分の見込み` : "");
  const legs = ticket.steps.map((leg, i) => {
    const name = leg.type === "bus" || leg.type === "train" ? ` ${rideDetail(leg)}` : "";
    const dest = leg.destination ? `（${leg.destination}ゆき）` : "";
    const delay = Number(leg.delay) > 0 ? ` 遅れ${leg.delay}分` : "";
    return `${i + 1}. ${TYPE_LABELS[leg.type] || leg.type}${name} ${leg.from || "—"} ${leg.departuretime || ""} → ${leg.to || "—"} ${leg.arrivaltime || ""}${dest}${delay}`
      .replace(/\s+/g, " ").trim();
  });
  return [head, ...legs].join("\n");
}
