import { convert2kanji, calcTotalMinutes, timeToMinutes, minutesToTime } from "../../utils/utils.js";
import { busLegNames, trainLegNames } from "../../utils/rideNames.js";
import { normalizeTimeValue } from "./pickFastestRoutesToYokohama.js";
import { MIDNIGHT_FARE_RATE } from "../../config/fare/fareBus/indexFareBus.js";

/**
 * 検索結果（フラットな RouteOption の集まり）を、画面が使う「区間（step）」の
 * 並びに整形する。
 *
 * 画面（POST /hamakokuex/search）と `GET /api` の両方から呼ぶ。
 * もとは app.js の中にあり、画面からしか通らなかった。
 *
 * 1件は { index, fare, walktime, totaltime, step[] } で、step は出発から到着まで
 * 順に並ぶ。各区間は type（walk / sharecycle / bus / train）・from / to・
 * departuretime / arrivaltime / time を持ち、バスと電車はさらに事業者・路線・
 * 行先・遅れを持つ。キーの意味は docs/spec.md 7.3 にある。
 *
 * ここは「表示のための整形」だけを受け持つ。候補を選ぶ・並べ替えるのは
 * services/mainLogic/ の仕事で、見た目の判断は shared/ticketView.js が受け持つ。
 *
 * @param {object} rawData - buildRouteSearchResponse() の results
 * @param {object} options
 * @param {string} options.departure - 出発地点のキー（Library / RikoA / ...）
 * @param {string} options.arrival - 到着地の表示名（横浜駅）
 * @param {string} options.routeKey - どのルートの結果を使うか（All / bus / train / ...）
 * @returns {Array} 整形済みの経路の配列
 */
/**
 * 電車の詳細（行先・遅れ・駅）を取り出す。
 *
 * traindata は経路によって形が違う。
 * - 電車だけの経路（Mitsukami2Yokohama など）はオブジェクトで、詳細がそのまま入る
 * - 乗り継ぎ経路（Mitsukami2YokohamaViaBus / *ViaCycle）は接続する電車の配列で、
 *   詳細は traindata[0].traindata_details の中にある
 *
 * 配列のほうを素のまま読むと行先も遅れも undefined になり、遅れていても
 * 「平常どおり」に見えてしまう。
 *
 * @param {object|Array|undefined} traindata
 * @returns {object} 詳細。取れないときは空オブジェクト
 */
function trainDetails(traindata) {
  if (Array.isArray(traindata)) return traindata[0]?.traindata_details ?? {};
  return traindata ?? {};
}

// 行先は ["odpt.Station:..."] の配列で来ることがある
function stationLabel(value) {
  const name = Array.isArray(value) ? value[0] : value;
  return name ? convert2kanji(name) : null;
}

// 乗り換えの徒歩の行き先。バス停と駅が同じ名前なので、駅のほうに「駅」を付けて
// 経路図で「三ツ沢上町 → 三ツ沢上町駅」と読めるようにする
function stationNodeName(name) {
  const label = convert2kanji(name);
  if (!label) return label;
  return label.endsWith("駅") ? label : `${label}駅`;
}

// "HH:MM" に分を足す。日跨ぎは minutesToTime が mod 24 で戻す
function addMinutesToTime(time, minutes) {
  const base = timeToMinutes(time);
  if (!Number.isFinite(base) || !Number.isFinite(Number(minutes))) return null;
  return minutesToTime(base + Number(minutes));
}

export function shapeRouteData(rawData, { departure, arrival = "横浜駅", routeKey = "All" } = {}) {
  const shapedData = [];

  const keyMap = {
    All: ['FastestRoutes'],
    bus: ['YNUBusOnly'],
    cycle: ['YNUByCycle'],
    train: ['TrainRoutes'],
    busAndTrain: ['BusAndTrain'],
    busAndCycle: ['BusAndCycle'],
    trainAndCycle: ['TrainAndCycle'],
    walk: ['YNUOnFoot'],
  };

  const resultKeys = keyMap[routeKey] || ['FastestRoutes'];

  // ★修正1: 正しい階層 (FastestRoutes.items) にアクセスする
  // データが存在しない場合に備えてオプショナルチェーン (?.) を使うと安全です
  const items = resultKeys.flatMap((key) => rawData[key]?.items || []);

  items.forEach((element, index) => {
    // fs.appendFileSync('debug_log.txt', JSON.stringify(element) + '\n');

    // ★修正2: データ構造の揺らぎを吸収する処理
    // operatorがない場合(地下鉄)は trainType から判定するなどの工夫が必要
    // ここでは簡易的に存在チェックを行います
    
    // 電車の詳細。乗り継ぎ経路では traindata が配列になる
    const train = trainDetails(element.traindata);

    const step = [
       {  
          type: "walk", 
          from: convert2kanji(departure), 
          
          // 行き先優先順位: 
          // 1. チャリポート → 2. バス停/駅 → 3. どれもなければ最終目的地(横浜駅)
          to: element.isrentable ? element.rentport_name : (element.busstop_name || element.station_name || arrival), 
          
          departuretime: element.departuretime, 
          
          // 到着時刻優先順位:
          // 1. チャリ出発時刻 → 2. バス/駅出発時刻 → 3. なければ全体の到着時刻
          arrivaltime: element.isrentable ? element.rentport_departuretime 
             : (element.busstop_departuretime || element.station_departuretime || element.arrivetime), 
          
          // 時間優先順位:
          // 1. チャリポート徒歩 → 2. 駅徒歩 → 3. なければ全体の所要時間(徒歩直行)
          time: element.isrentable ? element.rentport_walktime 
             : ( element.busstop_walktime || element.station_walktime || element.duration)
       }
    ];
    if(element.isrentable || element.cycledata){
      step.push(
        { 
          type: "sharecycle",
          from: element.rentport_name,   // 貸出ポート名
          to: element.returnport_name,   // 返却ポート名
          time: element.bike_duration, 
          departuretime: element.rentport_departuretime,
          arrivaltime: element.returnport_arrivetime,
          rentalcapacity: element.num_bikes_available,
          returncapacity: element.num_docks_available,
          // 事業者ごとの内訳。券面に「HELLO 0台 / ドコモ 7台」と出すのに使う
          rentalByOperator: element.rentport_byOperator ?? null,
          returnByOperator: element.returnport_byOperator ?? null,
          returnCapacityUnknown: element.returnport_capacityUnknown === true,
          farePlan: element.cyclefare_plan ?? null,  // どの料金で出したか
          fare: element.fare
        }
      );
          // 2. 最後の徒歩ステップ（返却ポート → 横浜駅）
      // ★追加点: ポートから駅まで歩く時間を表示
      if (element.returnport_walktime > 0) {
        const walkDestination = element.traindata ? element.station_name : arrival;
        step.push({
          
          type: "walk",
          from: element.returnport_name, // ポートから
          to: walkDestination,                     // ★駅 or 横浜駅
          departuretime: element.returnport_arrivetime,
          // 電車がある場合は、電車の出発時刻を到着時刻とする（乗り換え待ち含む）
          arrivaltime: element.traindata ? element.station_departuretime : (element.arrivetime || ""),
          time: calcTotalMinutes(element.returnport_arrivetime, element.traindata ? element.station_departuretime : element.arrivetime) ?? element.returnport_walktime
        });

      }
    }
    if(element.busdata){
      step.push(
          { 
          type: "bus",
          // 事業者名・系統名・運賃は事業者をまたいで同じ規則で決める（ADR-0026）
          ...busLegNames(element.busdata),
          from: convert2kanji(element.busstop_name),
          to: convert2kanji(element.busstop_dropoff_name),
          departuretime: element.busstop_departuretime,
          departuretimes: element.busdata.departureTime,
          arrivaltime: normalizeTimeValue(element.busstop_dropoff_arrivetime),
          // 手段の帯は区間の所要分に比例した長さで描く（ADR-0019）
          time: calcTotalMinutes(element.busstop_departuretime, normalizeTimeValue(element.busstop_dropoff_arrivetime)),
          destination: convert2kanji(element.busdata.destinationStopPole),
          delay: element.busdata.delay,
          // 深夜便かどうか。運賃の割り増しはこの区間だけに効く
          isMidnight: element.busdata.isMidnight === true,
          fromStop: element.busdata.fromBusStopPole,
          toStop: element.busdata.toBusStopPole,
          occupancy: convert2kanji(element.busdata.occupancyStatus)
        }
     );
    }
    // バスから駅までの乗り換えの徒歩。区間にしないと、待ち時間と
    // 区別がつかず「待ち8分」の中に歩く4分が埋もれる。
    // 分数は計算側が接続電車を絞るのに使った値と同じものを domain が入れている
    if (element.busdata && element.traindata && Number(element.station_walktime) > 0) {
      const busArrival = normalizeTimeValue(element.busstop_dropoff_arrivetime);
      step.push({
        type: "walk",
        from: convert2kanji(element.busstop_dropoff_name),
        to: stationNodeName(element.station_name),
        departuretime: busArrival,
        arrivaltime: addMinutesToTime(busArrival, element.station_walktime),
        time: Number(element.station_walktime),
      });
    }
    if (element.traindata){
      step.push(
      {
        type: "train", 
        from: convert2kanji(element.station_name), 
        to: convert2kanji(element.station_dropoff_name), 
        // 事業者名・路線名・運賃は乗車駅から引く（ADR-0026）
        ...trainLegNames(element),
        destination: stationLabel(train.destinationStation), 
        departuretime: element.station_departuretime, 
        arrivaltime: element.station_dropoff_arrivetime, 
        // 手段の帯は区間の所要分に比例した長さで描く（ADR-0019）
        time: calcTotalMinutes(element.station_departuretime, element.station_dropoff_arrivetime),
        delay: train.delay ?? null, 
        fromStation: stationLabel(train.fromStation), 
        toStation: stationLabel(train.toStation) 
      }
     );
    }
    // シェアサイクルの料金。element.fare は経路全体の合計なので、そのまま載せると
    // バスや電車の分まで自転車の料金として出てしまう。他の区間を引いて求める
    const cycleStep = step.find((leg) => leg.type === "sharecycle");
    if (cycleStep) {
      const othersFare = step
        .filter((leg) => leg !== cycleStep)
        .reduce((sum, leg) => sum + (Number(leg.fare) > 0 ? Number(leg.fare) : 0), 0);
      cycleStep.fare = Math.max(Number(element.fare || 0) - othersFare, 0);
    }

    // 深夜運賃。23時以降に始発バス停を出る便は運賃が2倍になる。
    // バスだけの制度で、電車やシェアサイクルには無い。
    // 自転車の按分（element.fare からの引き算）より後に割り増す必要がある
    const midnightExtra = step.reduce((extra, leg) => {
      if (leg.type !== "bus" || !leg.isMidnight) return extra;
      const ic = Number(leg.fare) > 0 ? Number(leg.fare) : 0;
      const cash = Number(leg.fareCash) > 0 ? Number(leg.fareCash) : 0;
      leg.fare = ic * MIDNIGHT_FARE_RATE;
      leg.fareCash = cash * MIDNIGHT_FARE_RATE;
      return extra + ic * (MIDNIGHT_FARE_RATE - 1);
    }, 0);

    // 現金で乗ったときの合計。IC との差があるのは相鉄線だけ（+2円/区間）。
    // 経路全体の運賃（element.fare）は IC なので、区間ごとの差だけを足す
    // IC と現金の両方が分かる区間（バス・電車）だけを数える。
    // シェアサイクルや徒歩には現金運賃が無く、引くと合計が壊れる
    const cashDiff = step.reduce((diff, leg) => {
      if (leg.fareCash === undefined || leg.fareCash === null) return diff;
      return diff + (Number(leg.fareCash) - (Number(leg.fare) || 0));
    }, 0);

    let totalWalkTime = (element.station_walktime || 0) + (element.busstop_walktime || 0) + (element.rentport_walktime || 0) + (element.returnport_walktime || 0);
    const depTime = step[0].departuretime;
    const arrTime = step[step.length - 1].arrivaltime;
    const totalMinutes = calcTotalMinutes(depTime, arrTime) ?? element.duration;
    shapedData.push(
      {
        index: index + 1,
        fare: Number(element.fare || 0) + midnightExtra,
        fareCash: Number(element.fare || 0) + midnightExtra + cashDiff,
        walktime: totalWalkTime==0 ? element.duration : totalWalkTime,
        totaltime: totalMinutes,
          step: step
      }
    );
  });
  return shapedData;
}
