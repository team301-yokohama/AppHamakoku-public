// JSONファイルのインポート
import stationList from '../../db/transit/cycleport/cycleportlist.json' with { type: 'json' };
// 外部モジュールの読み込み
import * as Utils from '../../utils/utils.js';  // Utility関数をまとめたmoduleを読み込み
import * as Reserchcycle from '../adapters/ReserchCycle.js';  // サイクルポートを探す系関数をまとめたmoduleを読み込み
import { resolveRentWalkTime } from './rentPortWalk.js';
import { toOperatorFilter } from '../mainLogic/operatorSelection.js';
import { routeAlternativeOperators } from '../../utils/rideNames.js';
import { pickCycleFare } from '../../config/fare/fareCycle/index.js';

/**
 * 横浜国立大学 (YNU) の特定の施設から横浜駅までの、HelloCycleを使用した
 * 自転車ルートの移動時間とコストを計算します。
 *
 * 【処理の流れ】
 * 1. paramJSONのwalkspeedに基づき、歩行時間データと自転車の平均速度データを決定。
 * 2. 貸出・返却ポート（YNU最寄り/横浜駅最寄り）の現在の利用可否を取得。
 * 3. 貸出・返却ポートが利用可能で、かつ歩行データが正常な場合にのみ時間を計算。
 * 4. 移動時間 = (施設から貸出ポートへの徒歩時間) + (自転車移動時間) + (返却ポートから横浜駅への徒歩時間)
 * 5. 現在時刻と計算した移動時間を基に到着時刻を算出します。
 *
 * @param {JSON} paramJSON 環境設定を含むJSONオブジェクト。
 * 必須プロパティ: {string} walkspeed, {string} location
 * @param {Array<object>} portdatalist HelloCycleの持つすべてのポートデータ配列。
 * @returns {object} ルート情報を含むJSONデータ。
 * - arrivetime: 到着時刻 ('HH:MM'形式) または失敗時は -1
 * - is_using: ルートが利用可能か (true/false)
 * - rentportid: 貸出ポートID、失敗時は -1
 * - num_bikes_available: 貸出可能台数、失敗時は -1
 * - fare: 2025年時点での横浜市内の料金 、失敗時は -1
 * @see {@link makeRentalPlaceData}
 * @see {@link getPortData}
 */
/**
 * @abstract 返却ポートから目的地（横浜駅）までの徒歩時間を返す
 * @detail ポートごとの徒歩時間のキーは cycleportlist.json の walkKeyToDestination に持つ。
 *         キーが無いポート（徒歩時間を測っていない）は、警告を出して従来の値で代用する。
 *         ポートの徒歩時間の整備は #90・#93 で行う。
 * @param {string} returnportid - 選ばれた返却ポートの station_id
 * @param {object} paramJSON - 徒歩時間が展開されたパラメータ
 * @returns {number} 徒歩時間（分）
 */
export function resolveReturnWalkTime(returnportid, paramJSON) {
  const port = stationList.YokohamaStation.find((p) => String(p.station_id) === String(returnportid));
  const walkKey = port?.walkKeyToDestination;
  const walkTime = walkKey ? paramJSON[walkKey] : undefined;

  if (Number.isFinite(walkTime)) return walkTime;

  console.warn(
    `[YNU2YokohamaByCycleOnly] 返却ポート ${returnportid}（${port?.name ?? "不明"}）の` +
    `横浜駅までの徒歩時間が未設定のため、横浜銀行横浜駅前支店の値で代用します`,
  );
  return paramJSON.FromHamagin_yokohamaToYokohama;
}

/**
 * @abstract シェアサイクルのみのルートの時刻を組み立てる
 * @detail 返却ポートに着く時刻には、貸出ポートまでの徒歩も含める。
 * @param {object} args
 * @param {string} args.currentTime - 出発時刻 "HH:MM"
 * @param {number} args.toRentPortWalk - 貸出ポートまでの徒歩（分）
 * @param {number} args.bikeDuration - 自転車の所要時間（分）
 * @param {number} args.returnWalkTime - 返却ポートから目的地までの徒歩（分）
 * @returns {{rentportDeparture: string, returnportArrival: string, arrival: string, duration: number}}
 */
export function calcCycleOnlyTimes({ currentTime, toRentPortWalk, bikeDuration, returnWalkTime }) {
  const start = Utils.timeToMinutesExtended(currentTime);
  const duration = toRentPortWalk + bikeDuration + returnWalkTime;

  return {
    rentportDeparture: Utils.minutesToTime(start + toRentPortWalk),
    returnportArrival: Utils.minutesToTime(start + toRentPortWalk + bikeDuration),
    arrival: Utils.minutesToTime(start + duration),
    duration,
  };
}

export async function YNU2YokohamaByCycle(paramJSON) {
  // 初期化
  let result = [{
        "departuretime":null,
        "arrivetime": null,
        "isrentable": false,
        "duration":-1,
        "bike_duration":-1,

        "rentportid": -1,
        "rentport_name": null,
        "rentport_walktime":-1,
        "rentport_departuretime":null,
        "num_bikes_available": -1,
        "rentport_byOperator": null,   // 事業者ごとの台数の内訳
        "cyclefare_plan": null,        // どの事業者・どの料金で出したか
        
        "returnportid": -1,
        "returnport_name":null,
        "returnport_arrivetime":null,
        "returnport_walktime":-1,
        "num_docks_available": -1,
        "returnport_byOperator": null, // 事業者ごとの空きの内訳
        "returnport_capacityUnknown": false, // 返却枠に制限が無く、空き台数が当てにならない
        
        "fare": -1
    }];

  try {

    // 1. 【重要】非同期でポートデータを取得 (awaitを使用)
    // 並列でリクエストを投げると少し速くなります (Promise.all)
    // 使ってよい事業者で絞る。未指定なら絞らない
    const cycleOptions = { operators: toOperatorFilter(paramJSON.operators) };

    const [rentalPortRaw, returnPortRaw] = await Promise.all([
      Reserchcycle.getPortData(stationList.YNU, cycleOptions),            // 貸出候補(YNU周辺)
      Reserchcycle.getPortData(stationList.YokohamaStation, cycleOptions) // 返却候補(横浜駅周辺)
    ]);

    // デバッグ用ログ出力
    //console.log("rentalPortRaw:", rentalPortRaw);
    //console.log("returnPortRaw:", returnPortRaw);

    // 2. 取得した生データから、最適なポートを選定
    // 貸出ポートは出発地からの徒歩が短いもの。営業時間はそれぞれのポートに着く時刻で見る。
    // 貸出と返却は事業者をそろえて選ぶ。別々に選ぶと、借りた事業者では
    // 返せないポートに案内してしまう
    const { rental: RentalPlaceData, return: ReturnPlaceData } =
      Reserchcycle.selectCyclePortPairByWalk(rentalPortRaw, returnPortRaw, {
        ...cycleOptions,
        currentTime: paramJSON.currentTime,
        bikeDuration: paramJSON.FromFamiYNUToYokohama,
        walkTimeOf: (port) => resolveRentWalkTime(port, paramJSON),
      });
    const rentWalkTime = RentalPlaceData.rent_walk_time;

    // 3. 料金計算
    // 料金は、借りられる事業者で決まる。HELLO CYCLING を検索から外していれば
    // ドコモの料金になる。車種・会員種別までは当てられないので、券面に前提を書く
    const cycleFare = pickCycleFare(routeAlternativeOperators({
      isrentable: RentalPlaceData.is_renting,
      rentport_byOperator: RentalPlaceData.byOperator,
    }).filter((key) => !cycleOptions.operators || cycleOptions.operators.has(key)));
    const cyclecost = Reserchcycle.makeRentalCost(paramJSON.FromFamiYNUToYokohama, cycleFare);

    // デバッグ用ログ出力
    //console.log("Step 4: Checking conditions...");
    //console.log("is_renting:", RentalPlaceData.is_renting);
    //console.log("is_returning:", ReturnPlaceData.is_returning);
    //console.log("cyclecost !== -1:", cyclecost !== -1);

    // 4. 利用可否判定
    // is_renting / is_returning が true かつ、料金計算が成功しているか(-1じゃないか)
    if (RentalPlaceData.is_renting && ReturnPlaceData.is_returning && cyclecost !== -1) {
      
      // 返却ポートから横浜駅までの徒歩は、選ばれたポートによって変わる。
      // 2 分で計算していた
      const returnWalkTime = resolveReturnWalkTime(ReturnPlaceData.returnportid, paramJSON);

      // 時刻の組み立ては calcCycleOnlyTimes にまとめている
      // ※ paramJSONのキー名は呼び出し元と厳密に合わせる必要があります
      const times = calcCycleOnlyTimes({
        currentTime: paramJSON.currentTime,
        toRentPortWalk: rentWalkTime,
        bikeDuration: paramJSON.FromFamiYNUToYokohama,
        returnWalkTime,
      });

      // 結果オブジェクトの更新
      result = [{
        "departuretime":paramJSON.currentTime,
        "arrivetime": times.arrival,
        "isrentable": true,
        "duration":times.duration,
        "bike_duration":paramJSON.FromFamiYNUToYokohama,

        "rentportid": RentalPlaceData.rentportid,
        "rentport_name":RentalPlaceData.port_name,
        "rentport_walktime":rentWalkTime,
        "rentport_departuretime":times.rentportDeparture,
        "num_bikes_available": RentalPlaceData.num_bikes_available,
        "rentport_byOperator": RentalPlaceData.byOperator ?? null,
        "cyclefare_plan": { operator: cycleFare.operator, label: cycleFare.planLabel },
        
        "returnportid": ReturnPlaceData.returnportid,
        "returnport_name":ReturnPlaceData.port_name,
        "returnport_arrivetime":times.returnportArrival,
        "returnport_walktime":returnWalkTime,
        "num_docks_available": ReturnPlaceData.num_docks_available,
        "returnport_byOperator": ReturnPlaceData.byOperator ?? null,
        "returnport_capacityUnknown": ReturnPlaceData.returnCapacityUnknown === true,
        
        "fare": cyclecost
      }];
    } else {
      // 失敗理由を構造化して返す
      const reasons = [];
  
      if (!RentalPlaceData.is_renting) {
        reasons.push({
          type: "NO_BIKES_AVAILABLE",
          message: "貸出ポートに自転車がありません",
          portName: RentalPlaceData.port_name || "不明",
          availableBikes: RentalPlaceData.num_bikes_available
        });
      }
  
      if (!ReturnPlaceData.is_returning) {
        reasons.push({
          type: "NO_DOCKS_AVAILABLE",
          message: "返却ポートに空きがありません",
          portName: ReturnPlaceData.port_name || "不明",
          availableDocks: ReturnPlaceData.num_docks_available
        });
      }
  
      if (cyclecost === -1) {
        reasons.push({
          type: "COST_CALCULATION_FAILED",
          message: "料金計算に失敗しました"
        });
      }
  
      result.reason = reasons.length > 0 ? reasons : [{
        type: "UNKNOWN_ERROR",
        message: "不明なエラーが発生しました"
      }];
    }

    // サーバーログにも出力（開発・運用用）
    if (!result[0].isrentable) {
      console.warn("[Cycle Route] Not available:", result[0].reason);
    }

  } catch (error) {
    console.error("Route calculation error:", error);
    // エラー時は初期値(失敗ステータス)がそのまま返ります
  }

  return result;
}


// 仮の引数
// デバッグ用なので製品化時は削除可能
const paramJSON_temp ={
  "currentTime":Utils.getCurrentTime(),
  "location":"Library",
  "walkspeed":"fast",
  "ToFamiYNU":5,
  "FromFamiYNUToYokohama":23,
  "FromHamagin_yokohamaToYokohama":5
  };