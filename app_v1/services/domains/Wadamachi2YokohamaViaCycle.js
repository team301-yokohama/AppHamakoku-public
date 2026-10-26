// 和田町の駅までチャリで行って、そこから相鉄

import * as Utils from "../../utils/utils.js";
import * as Reserchcycle from '../adapters/ReserchCycle.js';  // サイクルポートを探す系関数をまとめたmoduleを読み込み
import { resolveRentWalkTime } from './rentPortWalk.js';
import { toOperatorFilter } from '../mainLogic/operatorSelection.js';
import { routeAlternativeOperators } from '../../utils/rideNames.js';
import { pickCycleFare } from '../../config/fare/fareCycle/index.js';
import * as WadamachiTrainData from "./Wadamachi2Yokohama.js";
// JSONファイルのインポート
import stationList from '../../db/transit/cycleport/cycleportlist.json' with { type: 'json' };

import { TRANSFER_CONFIG } from "../../config/constants/mitsukami2YokohamaViaBusConfig.js";

export async function Wadamachi2YokohamaViaCycle( paramJSON ){

    // 初期化
  let result = [{
        "departuretime":null,
        "arrivetime": null,
        "isrentable": false,
        "fare":-1,
        "duration":-1,
        "bike_duration":-1,

        "rentportid":null,
        "rentport_name":null,
        "rentport_walktime": -1,
        "rentport_departuretime":null,
        "num_bikes_available": -1,
        "rentport_byOperator": null,   // 事業者ごとの台数の内訳
        "cyclefare_plan": null,        // どの事業者・どの料金で出したか
              
        "returnportid": null ,
        "returnport_name":null,
        "returnport_arrivetime":null,
        "returnport_walktime": -1,
        "num_docks_available": -1,
        "returnport_byOperator": null, // 事業者ごとの空きの内訳
        "returnport_capacityUnknown": false, // 返却枠に制限が無く、空き台数が当てにならない

        "station_name":null,
        "station_departuretime":null,
        "station_dropoff_name":null,
        "station_dropoff_arrivetime":null,
        "traindata": []
   }];

    // 1. 【重要】非同期でポートデータを取得 (awaitを使用)
    // 並列でリクエストを投げると少し速くなります (Promise.all)
    // 使ってよい事業者で絞る。未指定なら絞らない
    const cycleOptions = { operators: toOperatorFilter(paramJSON.operators) };

    const [rentalPortRaw, returnPortRaw , AllTraindata] = await Promise.all([
      Reserchcycle.getPortData(stationList.YNU, cycleOptions),            // 貸出候補(YNU周辺)
      Reserchcycle.getPortData(stationList.Wadamachi, cycleOptions), // 返却候補(横浜駅周辺)
      WadamachiTrainData.Wadamachi2Yokohama({
        "currentTime" : paramJSON.currentTime,
        "ToWadamachi" : 0,
        "currentDate" : paramJSON.currentDate,
        "isholiday" : paramJSON.isholiday,
        "location":paramJSON.location,
        "walkspeed":paramJSON.walkspeed
        })
    ]);
    // 一時デバッグ用ログ
    // console.log("[DEBUG] : Wadamachi2YokohamaViaCycleの取得データ\n", { rentalPortRaw, returnPortRaw});
    
    // 2. 取得した生データから、最適なポートを選定
    // 貸出ポートは出発地からの徒歩が短いもの。営業時間はそれぞれのポートに着く時刻で見る。
    // 貸出と返却は事業者をそろえて選ぶ。別々に選ぶと、借りた事業者では
    // 返せないポートに案内してしまう
    const { rental: RentalPlaceData, return: ReturnPlaceData } =
      Reserchcycle.selectCyclePortPairByWalk(rentalPortRaw, returnPortRaw, {
        ...cycleOptions,
        currentTime: paramJSON.currentTime,
        bikeDuration: paramJSON.FromFamiYNUToWadamachi,
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
    const cyclecost = Reserchcycle.makeRentalCost(paramJSON.FromFamiYNUToWadamachi, cycleFare);

    // 4. 利用可否判定
    // is_renting / is_returning が true かつ、料金計算が成功しているか(-1じゃないか)
    if (RentalPlaceData.is_renting && ReturnPlaceData.is_returning && cyclecost !== -1) {
      
      // 移動時間の合計 (徒歩 + 自転車 + 乗り換え徒歩)
      // ※ paramJSONのキー名は呼び出し元と厳密に合わせる必要があります
      const bikeTotalMoveTime = rentWalkTime + 
                                paramJSON.FromFamiYNUToWadamachi + 
                                paramJSON.FromHamagin_WadamachiToWadamachi;

      // 現在時刻(文字列)を分(数値)に変換して加算
      const currentMinutes = Utils.timeToMinutesExtended(paramJSON.currentTime);
      const WadamachiArrivalMinutes = currentMinutes + bikeTotalMoveTime;

      const tempTrainDataArray = AllTraindata
            // 1. 条件（乗り換えに間に合うか）で絞り込む
            .filter(train => {
              const trainDepMin = Utils.timeToMinutesExtended(train.station_departuretime);
              return trainDepMin >= WadamachiArrivalMinutes;
            })
            // 2. 最大件数で切る
            .slice(0, TRANSFER_CONFIG.MAX_TRAIN_CONNECTIONS)
            // 3. 必要な形式に変換する
            .map((train, idx) => ({
              trainindex: idx + 1,
              station_name: "和田町",
              station_departuretime: train.station_departuretime,
              station_dropoff_name: "横浜駅",
              station_dropoff_arrivetime: train.station_dropoff_arrivetime,
              train_fare: train.fare,
              traindata_details: train.traindata
        }));
          if(tempTrainDataArray.length === 0) return result;
          if(cyclecost ===  -1 || tempTrainDataArray[0].train_fare == null) return result;

      // 結果オブジェクトの更新
      result = [{
        "departuretime":paramJSON.currentTime,
        "arrivetime": tempTrainDataArray[0].station_dropoff_arrivetime,
        "isrentable": true,
        "fare":cyclecost + tempTrainDataArray[0].train_fare,
        "duration":Utils.timeToMinutesExtended(tempTrainDataArray[0].station_dropoff_arrivetime) - Utils.timeToMinutesExtended(paramJSON.currentTime),
        "bike_duration":paramJSON.FromFamiYNUToWadamachi,

        "rentportid": RentalPlaceData.rentportid,
        "rentport_name":RentalPlaceData.port_name,
        "rentport_walktime":rentWalkTime,
        "rentport_departuretime":Utils.minutesToTime(currentMinutes + rentWalkTime),
        "num_bikes_available": RentalPlaceData.num_bikes_available,
        "rentport_byOperator": RentalPlaceData.byOperator ?? null,
        "cyclefare_plan": { operator: cycleFare.operator, label: cycleFare.planLabel },
              
        "returnportid": ReturnPlaceData.returnportid,
        "returnport_name":ReturnPlaceData.port_name,
        "returnport_arrivetime":Utils.minutesToTime(currentMinutes +rentWalkTime + paramJSON.FromFamiYNUToWadamachi),
        "returnport_walktime":paramJSON.FromHamagin_WadamachiToWadamachi,
        "num_docks_available": ReturnPlaceData.num_docks_available,
        "returnport_byOperator": ReturnPlaceData.byOperator ?? null,
        "returnport_capacityUnknown": ReturnPlaceData.returnCapacityUnknown === true,

        "station_name":tempTrainDataArray[0].station_name,
        "station_departuretime":tempTrainDataArray[0].station_departuretime,
        "station_dropoff_name":tempTrainDataArray[0].station_dropoff_name,
        "station_dropoff_arrivetime":tempTrainDataArray[0].station_dropoff_arrivetime,
        "traindata": tempTrainDataArray
              
      }];
    }

  return result;
} 


// 開発用ダミーデータ（実際の運用ではリクエストから受け取る想定）
const paramJSON_temp = {
  "currentTime":"12:14",
  "location":"Library",
  "walkspeed":"fast",
  "ToFamiYNU": 5, 
  "FromFamiYNUToWadamachi": 15,
  "FromHamagin_WadamachiToWadamachi":18,
  "currentDate": new Date
  };
