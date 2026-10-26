import { BUS_FARES } from "../config/fare/fareBus/indexFareBus.js";
import { TRAIN_FARES_BLUE_LINE } from "../config/fare/fareTrain/fareBlueLine.js";
import { TRAIN_FARES_SOTETSU } from "../config/fare/fareTrain/fareSotetsu.js";

// 案内券に出す事業者名・路線名・運賃を、事業者をまたいで同じ規則で決める（ADR-0026）。
// - バスの券面は「事業者：系統」（相鉄バス：浜11 / 神奈中：01 / 市営バス：202）。
//   系統番号だけでは、どこのバスか分からないため
// - 電車の券面は名前だけ（ブルーライン / 相鉄）。その名前で事業者まで伝わるため
// - 事業者名のフルネームは別に持つ（経路図で「横浜市営バス 202系統」のように並べる）
// - 分からない値は空文字にして、表示側で事業者名 →「バス」「電車」の順に代わりを出す

// ODPT の事業者ID（odpt.Operator:xxx の xxx）→ バス事業者名と運賃。
// name は経路図のフルネーム、short は券面で系統名の前に付ける短い名前
// key は検索条件の事業者キー（config/providers/operators.js）。ODPT の事業者ID では
// 市営バスと市営地下鉄が同じ `YokohamaMunicipal` になって区別できないため、別に持つ
const BUS_OPERATORS = {
  YokohamaMunicipal: { key: "MunicipalBus", name: "横浜市営バス", short: "市営バス", fare: BUS_FARES.MUNICIPAL },
  Kanachu: { key: "Kanachu", name: "神奈中バス", short: "神奈中", fare: BUS_FARES.KANACHU },
  SotetsuBus: { key: "SotetsuBus", name: "相鉄バス", short: "相鉄バス", fare: BUS_FARES.SOTETSU },
};

// 系統ID の中の記号 → 行先表示の系統名（相鉄バスの「浜11」など）
const ROUTE_PREFIXES = {
  Hama: "浜",
};

// 乗車駅 → 事業者・路線・運賃。駅IDの接頭辞と駅名の両方で引けるようにする
const TRAIN_LINES = [
  {
    key: "MunicipalSubway",
    stationIdPrefix: "odpt.Station:YokohamaMunicipal.Blue.",
    stationNames: ["三ッ沢上町", "三ツ沢上町"],
    operator: "横浜市営地下鉄",
    line: "ブルーライン",
    // 券面に出す名前。「ブルーライン」で市営地下鉄と伝わるので事業者は付けない
    ticketLine: "ブルーライン",
    fares: { "三ッ沢上町": TRAIN_FARES_BLUE_LINE.MITSUKAMI2YOKOHAMA, "三ツ沢上町": TRAIN_FARES_BLUE_LINE.MITSUKAMI2YOKOHAMA },
  },
  {
    key: "Sotetsu",
    stationIdPrefix: "odpt.Station:Sotetsu.Main.",
    stationNames: ["和田町", "上星川"],
    operator: "相模鉄道",
    line: "相鉄本線",
    // 券面は「相鉄」。「本線」まで出さなくても他と紛れない
    ticketLine: "相鉄",
    fares: { "和田町": TRAIN_FARES_SOTETSU.WADAMACHI2YOKOHAMA, "上星川": TRAIN_FARES_SOTETSU.KAMIHOSHI2YOKOHAMA },
  },
];

// "odpt.Operator:Kanachu" → "Kanachu"
function operatorCode(operatorId) {
  return String(operatorId || "").split(":").pop() || "";
}

/**
 * 系統ID から行先表示の系統名を取り出す。
 * "odpt.BusroutePattern:SotetsuBus.Hama11.502002.2" → "浜11"
 * "odpt.BusroutePattern:Kanachu.01.26202.1" → "01"
 * "YokohamaMunicipal.202" → "202"
 * @param {string} busroute
 * @returns {string} 取り出せないときは空文字
 */
export function busRouteName(busroute) {
  const body = String(busroute || "").split(":").pop();
  const code = body.split(".")[1];
  if (!code) return "";
  const match = code.match(/^([A-Za-z]*)(\d+)$/);
  if (!match) return "";
  const [, prefix, number] = match;
  if (prefix === "") return number;
  return ROUTE_PREFIXES[prefix] ? `${ROUTE_PREFIXES[prefix]}${number}` : "";
}

/**
 * バス区間の事業者名・系統名・運賃。
 * 横浜市営バスの時刻表は事業者を持たないので、系統ID の接頭辞から補う。
 * @param {object} busdata - domain が返す busdata
 * @returns {{ operator: string, shortOperator: string, busroute: string, fare: number|null }}
 */
export function busLegNames(busdata = {}) {
  const operator = busOperatorEntry(busdata);
  return {
    operator: operator?.name ?? "",
    shortOperator: operator?.short ?? "",
    busroute: busRouteName(busdata.busroute),
    // 既定は IC 運賃。現金は画面の切り替えで使う（ADR-0003・#97）
    fare: operator?.fare.ic ?? null,
    fareCash: operator?.fare.cash ?? null,
  };
}

// バスの事業者を引く。横浜市営バスの時刻表は事業者を持たないので、系統ID の接頭辞から補う
function busOperatorEntry(busdata = {}) {
  const routeBody = String(busdata.busroute || "").split(":").pop();
  return BUS_OPERATORS[operatorCode(busdata.operator)] ?? BUS_OPERATORS[routeBody.split(".")[0]];
}

// traindata は domain によってオブジェクト（直行）と配列（乗り継ぎ）の2通りある
function boardingStationId(traindata) {
  const first = Array.isArray(traindata) ? traindata[0]?.traindata_details : traindata;
  return String(first?.fromStation || "");
}

// 電車の路線を引く。乗車駅のIDがあればその接頭辞で、なければ乗車駅名で引く
function trainLineEntry(element = {}) {
  const stationId = boardingStationId(element.traindata);
  const stationName = String(element.station_name || "");
  return TRAIN_LINES.find((item) => stationId && stationId.startsWith(item.stationIdPrefix))
    ?? TRAIN_LINES.find((item) => item.stationNames.includes(stationName));
}

/**
 * 電車区間の事業者名・路線名・運賃。
 * 乗車駅のIDがあればその接頭辞で、なければ乗車駅名で引く。
 * 運賃は domain が持っている値を優先し、なければ config/fare の値を使う。
 * @param {object} element - domain が返す RouteOption（station_name / traindata）
 * @returns {{ operator: string, line: string, ticketLine: string, fare: number|null }}
 */
export function trainLegNames(element = {}) {
  const stationName = String(element.station_name || "");
  const entry = trainLineEntry(element);

  const table = entry?.fares[stationName] ?? null;
  const domainFare = Array.isArray(element.traindata) ? Number(element.traindata[0]?.train_fare) : NaN;
  // domain が持つ値（乗り継ぎ経路）は IC 運賃。現金との差は対応表からしか引けない
  const fare = Number.isFinite(domainFare) && domainFare > 0 ? domainFare : table?.ic ?? null;
  const fareCash = fare === null
    ? null
    : fare + ((table?.cash ?? 0) - (table?.ic ?? 0));

  return {
    operator: entry?.operator ?? "",
    line: entry?.line ?? "",
    ticketLine: entry?.ticketLine ?? "",
    fare,
    fareCash,
  };
}

/**
 * @abstract シェアサイクルの貸出ポートで、実際に借りられる事業者を返す
 * @detail 同じ物理ポートを HELLO CYCLING とドコモ・バイクシェアで共用していることがあり、
 *         台数は事業者ごとに分かれている（内訳は rentport_byOperator）。
 *         内訳が無い古い形の候補は、従来どおり HELLO CYCLING だけとみなす。
 * @param {object} element - domain が返す RouteOption
 * @returns {string[]}
 */
function cycleOperatorKeys(element) {
  if (!(element.isrentable || element.cycledata)) return [];

  const byOperator = element.rentport_byOperator;
  if (!byOperator) return ["HelloCycling"];

  const usable = Object.entries(byOperator)
    .filter(([, raw]) => raw?.is_renting && Number(raw.num_bikes_available) > 0)
    .map(([key]) => key);

  return usable.length > 0 ? usable : ["HelloCycling"];
}

/**
 * 検索結果1件（RouteOption）が**必ず使う**交通事業者のキーを返す。
 * 事業者での絞り込みは、経路パターン（domain）ごとではなく区間ごとに判定する。
 * バスだけの経路に相鉄バス・神奈中・市営バスが混ざっているため、
 * domain 単位では分けられない。
 *
 * シェアサイクルはここに入れない。共用ポートでは「どちらかのアプリがあれば乗れる」ので、
 * 必ず使う事業者ではない（routeAlternativeOperators を見る）。
 *
 * @param {object} element - domain が返す RouteOption
 * @returns {string[]} 事業者キー。徒歩だけの経路は空配列（事業者を使わない）
 */
export function routeRequiredOperators(element = {}) {
  const keys = new Set();
  if (element.busdata) {
    const key = busOperatorEntry(element.busdata)?.key;
    if (key) keys.add(key);
  }
  if (element.traindata) {
    const key = trainLineEntry(element)?.key;
    if (key) keys.add(key);
  }
  return [...keys];
}

/**
 * 検索結果1件が**どれか1つ使えればよい**交通事業者のキーを返す。
 *
 * シェアサイクルの共用ポートがこれにあたる。HELLO CYCLING とドコモの両方で
 * 借りられるポートなら、どちらか一方のアプリを持っていれば乗れる。
 * 「使う事業者がすべて許可されていること」で判定すると、両方で借りられる
 * ポートが、片方だけを選んだ利用者に出なくなってしまう。
 *
 * @param {object} element - domain が返す RouteOption
 * @returns {string[]} 空配列ならこの条件は無い
 */
export function routeAlternativeOperators(element = {}) {
  return cycleOperatorKeys(element);
}

/**
 * 検索結果1件が関わる交通事業者をすべて返す（必ず使う分と、どれか1つでよい分の和）。
 * 画面に出すときや、事業者の一覧に漏れがないかの確認に使う。
 *
 * @param {object} element - domain が返す RouteOption
 * @returns {string[]}
 */
export function routeOperatorKeys(element = {}) {
  return [...new Set([...routeRequiredOperators(element), ...routeAlternativeOperators(element)])];
}
