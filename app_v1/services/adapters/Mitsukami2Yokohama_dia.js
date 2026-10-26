import { BASE, KEY } from "../../config/defaults.js";
import * as Utils from '../../utils/utils.js';
import { createDebugLogger, createDebugErrorLogger } from "../../utils/debug/debug.js";
import { getTrainCalendarType } from '../../utils/date/gtfsCalendar.js';
import { getCachedValue, REALTIME_CACHE_TTL_MS, DAILY_TIMETABLE_TTL_MS } from '../../utils/cache.js';
import { withDemo } from '../../demo/index.js';
import { demoSubway } from '../../demo/timetables.js';
import { isValidAt, latestDcDate, noteFetched, noteGenerated, noteValidUntil } from '../../utils/dataTimes.js';

const debugLog = createDebugLogger('Mitsukami2Yokohama');  // デバッグログ表示用関数
const debugError = createDebugErrorLogger('Mitsukami2Yokohama');

// オンメモリキャッシュの箱

// API制限回避のためのスリープ関数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * @abstract 日ごとの時刻表を上流から取り、取得日時を画面用に記録する
 * @detail ディスクには保存しない（本番のサーバーにデータを溜めない。#248）。
 *         同じ日の2回目以降は、呼び出し側のメモリのキャッシュ（DAILY_TIMETABLE_TTL_MS）から返る
 * @param {() => Promise<any>} fetchFn
 */
async function fetchDaily(fetchFn) {
    const data = (await fetchFn()) || [];
    noteFetched('timetable.municipalTrain');
    return data;
}

// APIから列車の時刻表を取得する関数
async function fetchTrainDia(targetDate) {
    const calendarType = await getTrainCalendarType(targetDate);
    const url = Utils.buildUrl(BASE, 'odpt:TrainTimetable', {
        'odpt:operator': 'odpt.Operator:YokohamaMunicipal',
        'acl:consumerKey': KEY,
        'odpt:railDirection': 'odpt.RailDirection:Outbound',
        'odpt:railway': 'odpt.Railway:YokohamaMunicipal.Blue',
        'odpt:calendar': `odpt.Calendar:${calendarType}`
    });
    return await Utils.fetchJson(url);
}

// APIから列車の位置情報を取得する関数
async function fetchLocation() {
    const url = Utils.buildUrl(BASE, 'odpt:Train', {
        'odpt:operator': 'odpt.Operator:YokohamaMunicipal',
        'acl:consumerKey': KEY,
        'odpt:railDirection': 'odpt.RailDirection:Outbound',
        'odpt:railway': 'odpt.Railway:YokohamaMunicipal.Blue'
    });
    const body = await Utils.fetchJson(url);
    // dct:valid を過ぎた位置は使わない（2.1.2）。残りの dc:date を画面に出す（2.1.1。#220）
    const valid = Array.isArray(body) ? body.filter((loc) => isValidAt(loc)) : body;
    if (Array.isArray(valid)) noteGenerated('train.municipalDia', latestDcDate(valid));
    return valid;
}

async function fetchStationDia(targetDate) {
    const calendarType = await getTrainCalendarType(targetDate);
    const url = Utils.buildUrl(BASE, 'odpt:StationTimetable', {
        'odpt:operator': 'odpt.Operator:YokohamaMunicipal',
        'acl:consumerKey': KEY,
        'odpt:railDirection': 'odpt.RailDirection:Outbound',
        'odpt:station': 'odpt.Station:YokohamaMunicipal.Blue.MitsuzawaKamicho',
        'odpt:calendar': `odpt.Calendar:${calendarType}`
    });
    return await Utils.fetchJson(url);
}

async function buildJsonReal(targetDate) {
    if (!KEY || KEY === 'YOUR_ACCESS_TOKEN_HERE') throw new Error('[Error] Valid API key is not set');

    const nowDate = new Date().toISOString().split('T')[0];
    const isToday = (targetDate === nowDate);
    const nowHM = Utils.getCurrentTime();

    // ディスクには保存しない（本番のサーバーに、データを溜めない。#248）。
    // 時刻表は日ごとにメモリに持ち、期限が切れたら取り直す。再起動のあとも取り直す
    // 1. 時刻表データの取得 (直列にして、間にスリープを挟む)
    const trainDia = await getCachedValue(
        `municipal-train:trainDia:${targetDate}`,
        DAILY_TIMETABLE_TTL_MS,
        () => fetchDaily(() => fetchTrainDia(targetDate))
    );
    await sleep(500); // 429回避
    const stationDia = await getCachedValue(
        `municipal-train:stationDia:${targetDate}`,
        DAILY_TIMETABLE_TTL_MS,
        () => fetchDaily(() => fetchStationDia(targetDate))
    );

    // 2. 列車位置情報の取得（60秒キャッシュ）
    let locations = null;
    if (isToday) {
        locations = await getCachedValue(
            `municipal-train:location:${targetDate}`,
            REALTIME_CACHE_TTL_MS,
            async () => {
                await sleep(500);
                return (await fetchLocation()) || [];
            }
        );
    }

    // キャッシュで寝かせているあいだに dct:valid を過ぎた位置は、遅れの元にしない（ODPT ガイドライン 2.1.2。#220）
    if (Array.isArray(locations)) {
        locations = locations.filter((loc) => isValidAt(loc));
        noteGenerated('train.municipalDia', latestDcDate(locations));
        noteValidUntil('train.municipalDia', locations);
    }

    // 3. データ統合
    const results = [{
        date: targetDate,
        currentTime: nowHM
    }];

    if (!Array.isArray(stationDia)) {
        debugError('Invalid stationDia format:', stationDia);
        return results;
    }

    stationDia.forEach(item => {
        const scheduleObjects = item["odpt:stationTimetableObject"] || [];
        
        scheduleObjects.forEach(train => {
            const trainNumber = train["odpt:trainNumber"];
            const loca = locations?.find(loc => loc["odpt:trainNumber"] === trainNumber);
            const diaRecord = trainDia?.find(dia => dia["odpt:trainNumber"] === trainNumber);
            
            const arrivalStation = diaRecord?.["odpt:trainTimetableObject"]?.find(
                dia => dia["odpt:arrivalStation"] === "odpt.Station:YokohamaMunicipal.Blue.Yokohama"
            );

            results.push({
                trainNumber,
                departureTime: train["odpt:departureTime"],
                arrivalTime: arrivalStation?.["odpt:arrivalTime"] || null,
                delay: loca?.["odpt:delay"] ?? null,
                trainType: loca?.["odpt:trainType"] || null,
                fromStation: loca?.["odpt:fromStation"] || null,
                toStation: loca?.["odpt:toStation"] || null,
                originStation: loca?.["odpt:originStation"] || null,
                destinationStation: train["odpt:destinationStation"] || null,
            });
        });
    });

    return results;
}

/** 地下鉄（三ツ沢上町）の時刻表と遅れ。実データが取れないときは、仮データに切り替える（公開用のコピー。demo/index.js） */
export function buildJson(targetDate) {
    return withDemo('地下鉄', () => buildJsonReal(targetDate), () => demoSubway(targetDate), (list) => !Array.isArray(list) || list.length <= 1);
}
