/**
* @abstract アプリの制御ロジック
*/

import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import './config/env.js';

// Helmet:HTTPヘッダーのセキュリティ強化
import helmet from 'helmet';

// エスケープ処理用ライブラリ
import { body, validationResult } from 'express-validator';
import apiRouter from './routes/next.js';
import { convert2kanji, calcTotalMinutes, fetchJson } from './utils/utils.js';
import { busLegNames, trainLegNames } from './utils/rideNames.js';
import { buildRouteSearchResponse } from './services/mainLogic/routeSearch.js';
import { validateSearchQuery, InvalidQueryError } from './services/mainLogic/searchQuery.js';
import { createErrorHandler, sanitizeForLog } from './utils/errorHandler.js';
// 区間（step）の整形。画面と GET /api の両方から使う
import { shapeRouteData } from './services/mainLogic/shapeRouteData.js';
// 時刻が配列で来る経路（busstop_dropoff_arrivetime は ["21:00"] の形）を1つに揃える。
// 並べ替えと同じ規則にしておかないと、券面の時刻と並び順の根拠がずれる
import { normalizeTimeValue } from './services/mainLogic/pickFastestRoutesToYokohama.js';
import { normalizeTransportSelection, toApiRoutepattern, toRouteKey } from './services/mainLogic/transportSelection.js';
import { getCachedValue, REALTIME_CACHE_TTL_MS } from './utils/cache.js';
// はまこく Map（ADR-0030）。常盤祭までは同じ Node に相乗りし、/hamakokumap/ で配る
import { createHamakokumapRouter, HAMAKOKUMAP_CSP_DIRECTIVES } from '../hamakokumap/server/router.js';
import { presetDeparture } from './config/departures.js';
// はまこく Map のバス停タップ用。時刻表の取り方は本体の adapter をそのまま使う
import { getBusDeparturesByStop } from './services/mainLogic/busDepartures.js';
// はまこく Map の駅タップ用。チャレンジ API のキーが要るので、無ければ渡さない
import { getTrainDeparturesAtYokohama } from './services/mainLogic/trainDepartures.js';
import { hasRailwayKeys } from './services/adapters/odptRailway.js';
// team301 のサイト（/ のインデックス、#154）。静的なファイルを配るだけ
import { createSiteHandler } from '../site/server/static.js';
// 共有されたときの見え方
import { pageMeta } from './config/site.js';
import { normalizeOperatorSelection } from './services/mainLogic/operatorSelection.js';
import { OPERATORS_BY_MODE } from './config/providers/operators.js';
import { demoBannerVisible, demoMode, withDemo } from './demo/index.js';
import { NOTICES, NOTICE_VISIBLE, activeNotices, todayInJapan } from './config/notice.js';
// 案内券・ダイヤ図を描くための値づくり。EJS と React の島の両方から使う
import * as ticketView from './shared/ticketView.js';
import * as dataTimesView from './shared/dataTimesView.js';
import { modeIconSvg } from './shared/modeIcons.js';
import { REPORT_KINDS, REPORT_LIMITS, REPORT_RATE, REPORT_DAILY_LIMIT, REPORT_DAILY_PER_CLIENT, REPORT_HONEYPOT, reportFormConfig, reportEnabled, reportKindsFor } from './config/report.js';
import { validateReport, createRateLimiter, createDailyCap, createWarner, clientKeyOf, deliverReport, isOwnPageRequest } from './services/report/report.js';

// デバック用
// import fs from 'fs';
// import { route } from 'express/lib/application.js';

const app = express();
const port = 3000;
const BASE_URL = '/hamakokuex';
// ロゴの元データ（brand/hamakoku/）。cwd に依存しないよう、このファイルの位置から決める
const BRAND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'brand', 'hamakoku');

// 画面ごとに使い捨ての nonce を作る。CSP の script-src に入れ、ページ内の <script nonce="..."> だけを許す
// （'unsafe-inline' をやめるため。#210）。helmet より先に置く
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

// はまこく Map。下の hamakokuex 用の helmet より先に置き、マップ側で決めた CSP を当てる
// （キャンパス図の <object> などを許す）。マップの Router が応答するので、下の helmet は掛からない
app.use(
  '/hamakokumap',
  helmet({
    contentSecurityPolicy: {
      directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), ...HAMAKOKUMAP_CSP_DIRECTIVES },
    },
  }),
  createHamakokumapRouter({
    express, getCachedValue, fetchJson, ttlMs: REALTIME_CACHE_TTL_MS,
    odptKey: process.env.ODPT_API_KEY, getBusDepartures: getBusDeparturesByStop,
    // キーが片方でも欠けたら渡さない。画面は 503 を見て駅の印ごと畳む
    // 仮データでの表示のときは、キーが無くても渡す（#276。実データが取れなければ仮データになる）
    getTrainDepartures: hasRailwayKeys() || demoMode() !== 'off' ? getTrainDeparturesAtYokohama : undefined,
    // 報告の受け口。はまこく Exp. と同じものを使う。止めているときは渡さない
    postReport: reportEnabled() ? handleReport : undefined,
    reportKinds: reportKindsFor('map'),
    // 仮データでの表示。切り替えと帯は app_v1/demo/、作り物の中身は hamakokumap/server/demo.js
    demo: {
      enabled: () => demoMode() !== 'off',
      bannerVisible: () => demoBannerVisible({ hasKey: Boolean(process.env.ODPT_API_KEY) }),
      withDemo,
    },
  })
);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "upgrade-insecure-requests": null, // これでHTTPS強制を無効化
        // ページ内の <script> は nonce で許す（'unsafe-inline' は付けない。#210）
        "script-src": ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
        // 外部の CSS と書体は Google Fonts だけ（既定は https: 全部）
        "style-src": ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "connect-src": ["'self'"],
      },
    },
  })
);
// お知らせ（掲示板 / #137）。期限があるので、描くたびに今日の分を選び直す
// 仮データで表示しているときは、画面の上に帯を出す（公開用のコピー。demo/index.js）
app.use((req, res, next) => {
  // 検索の途中で仮データに切り替わることがあるので、描く時点で決める（getter）
  Object.defineProperty(res.locals, 'demoBanner', { get: () => demoBannerVisible({ hasKey: Boolean(process.env.ODPT_API_KEY) }), enumerable: true });
  next();
});
app.locals.noticeVisible = NOTICE_VISIBLE;
app.use((req, res, next) => {
  res.locals.notices = activeNotices(NOTICES, todayInJapan());
  next();
});
app.locals.ticketView = ticketView;
app.locals.dataTimesView = dataTimesView;
app.locals.modeIconSvg = modeIconSvg;
// 検索条件に出す交通事業者の一覧。利用手段ごとに分けて渡す
app.locals.operatorsByMode = OPERATORS_BY_MODE;
// 報告の欄で使う選択肢と上限
app.locals.report = { kinds: reportKindsFor('exp'), limits: REPORT_LIMITS, honeypot: REPORT_HONEYPOT };
// REPORT_ENABLED=false で報告の欄ごと消す（緊急停止・廃止用）
app.locals.reportEnabled = reportEnabled();

// リバースプロキシの後ろで動かすときは TRUST_PROXY を設定する（例: loopback）。
// 設定しないと、報告の連投制限で全員が同じ送信元（プロキシ）として数えられる
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

app.set('view engine', 'ejs');            // ejs:JavascriptをHTML内で使用可能にするテンプレートエンジン

// 共有されたときの見え方。EJS の _meta.ejs から使う
app.locals.pageMeta = pageMeta;
app.use(express.static('public'));
app.use(BASE_URL, express.static('public'));
// ヘッダーのワードマーク（ロゴ H2-3）。brand/hamakoku/ を正とし、コピーを置かない
// （はまこく Map と同じやり方 #199）。中身は svg だけなのでそのまま配る
app.use(BASE_URL + '/brand', express.static(BRAND_DIR, { index: false }));
app.use(createSiteHandler({ express }));
app.get('/', (req, res) => res.redirect(BASE_URL + '/'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// APIルーター
app.use('/api', apiRouter);

// 「間に合わなかった」などの報告を受ける（#122・ADR-0010）。
// 問い合わせを交通事業者ではなく team301 に向けるための受け口。
const allowReport = createRateLimiter(REPORT_RATE);
const dailyReports = createDailyCap(REPORT_DAILY_LIMIT, undefined, { perClient: REPORT_DAILY_PER_CLIENT });
// 制限に達したことを、サーバーのログで気づけるようにする（同じ内容は10分に1回だけ）
const warnLimit = createWarner();
// 報告の受け口。はまこく Mapからも同じものを使うので関数に出す。
// 連投の制限と1日の上限は共通の数え方になる（アプリごとに割らない）。
// 関数宣言にしてあるのは、上の はまこく Map の Router へ渡すのがこの位置より前のため
async function handleReport(req, res) {
  if (!app.locals.reportEnabled) {
    return res.status(503).json({ ok: false, error: '報告の受け付けを止めています。' });
  }
  if (!isOwnPageRequest({ contentType: req.get('content-type') || '', fetchSite: req.get('sec-fetch-site') || '' })) {
    return res.status(403).json({ ok: false, error: 'この画面からは送れません。' });
  }
  const checked = validateReport(req.body);
  // 罠の欄に入力があったときは、受け付けたふりをして捨てる
  if (!checked.ok && checked.reason === 'bot') return res.json({ ok: true });
  if (!checked.ok) return res.status(400).json({ ok: false, error: '報告の内容を確かめてください。' });
  // 1日の上限（日本時間の0時で数え直す）
  // 制限は、IPv4 はそのまま、IPv6 は /64 を1つの送信元として数える
  const clientKey = clientKeyOf(req.ip);
  const dailyState = dailyReports.check(clientKey);
  if (dailyState === 'client') {
    warnLimit(`client:${clientKey}`, `[report] 1つの送信元の1日の上限（${REPORT_DAILY_PER_CLIENT}件）に達しました: ${sanitizeForLog(clientKey)}`);
    return res.status(429).json({ ok: false, error: '同じ接続元からの、今日の受け付けは上限に達しました。お手数ですが、明日以降に送るか、免責事項のページのメールアドレスへお知らせください。' });
  }
  if (dailyState === 'total') {
    warnLimit('daily-total', `[report] 1日の上限（${REPORT_DAILY_LIMIT}件）に達しました。荒らされていないか確かめてください（止めるときは REPORT_ENABLED=false）`);
    return res.status(429).json({ ok: false, error: '今日の受け付けは上限に達しました。お手数ですが、明日以降に送るか、免責事項のページのメールアドレスへお知らせください。' });
  }
  if (!allowReport(clientKey)) {
    warnLimit('rate', '[report] 短い時間の制限に達しました（同じ送信元の連投、または全体の上限）');
    return res.status(429).json({ ok: false, error: '短い時間に何度も送られています。しばらくしてからもう一度送ってください。' });
  }
  dailyReports.take(clientKey);
  try {
    await deliverReport(checked.report, reportFormConfig());
    res.json({ ok: true });
  } catch (error) {
    console.error('[report]', error);
    res.status(502).json({ ok: false, error: '送信できませんでした。時間をおいてもう一度送ってください。' });
  }
}

app.post(BASE_URL + '/report', handleReport);

app.get(BASE_URL + '/', (req, res) => {
  // はまこく Map の出発地の建物から来たときは、その出発地を選んだ状態で開く
  res.render('index', { results: null, errors: null, baseUrl: BASE_URL, presetFrom: presetDeparture(req.query.from) });
});
// 免責事項は team301 直下（site/disclaimer.html）に移し、マップと共用する。
// 共有済みのリンクや検索結果が残っているので、もとの URL は 301 で転送する
app.get(BASE_URL + '/disclaimer', (req, res) => {
  res.redirect(301, '/disclaimer');
});
// バリデーションチェック
app.post(BASE_URL + '/search', [
  // 出発地は必須で、かつエスケープ処理（タグを無効化）を行う
  body('departure').trim().notEmpty().escape().withMessage('出発地を入力してください'),
  body('arrival').trim().notEmpty().escape().withMessage('到着地を入力してください'),
], async (req, res) => {
  
  // バリデーションエラーがあるか確認
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // エラーがあれば元の画面に戻すなどの処理
    return res.render('index', { results: null, errors: errors.array(), baseUrl: BASE_URL });
  }
  // 出発地・日時・歩く速さは、許す値だけを通す。画面は必ず送るので、無いときも誤りにする
  const formErrors = validateSearchQuery({
    now: req.body.departure_time,
    date: req.body.departure_date,
    location: req.body.departure,
    speed: req.body.walkspeed,
  });
  if (!req.body.departure_date) formErrors.push({ field: 'date', msg: '出発日を入力してください' });
  if (!req.body.departure_time) formErrors.push({ field: 'now', msg: '出発時刻を入力してください' });
  if (formErrors.length > 0) {
    return res.status(400).render('index', { results: null, errors: formErrors, baseUrl: BASE_URL });
  }
  // フォームから送られたデータを取り出す（すでにエスケープ済み）
  const departure = req.body.departure;     // name="departure" の中身
  const arrival = req.body.arrival;         // name="arrival" の中身
  const date = req.body.departure_date;     // name="departure_date" の中身
  const time = req.body.departure_time;     // name="departure_time" の中身
  const priority = req.body.priority;       // name="priority" の中身
  const walkspeed = req.body.walkspeed;     // name="walkspeed" の中身
  const routepattern = normalizeTransportSelection(req.body.routepattern); // name="routepattern" の中身
  const routepatternForAPI = toApiRoutepattern(routepattern);
  // 使ってよい交通事業者。画面は hidden の空値を必ず送るので、
  // 「全部オフ」（[]）と「古い画面からの指定なし」（undefined）を区別できる
  const operators = normalizeOperatorSelection(req.body.operators);

  // 利用者が送った文字列は、改行や制御文字を落としてから出す（ログの行を偽造されないように）
  console.log(`検索リクエスト: ${sanitizeForLog(departure)}→${sanitizeForLog(arrival)} 日時:${sanitizeForLog(date)} ${sanitizeForLog(time)} 優先:${sanitizeForLog(priority)} 歩行速度:${sanitizeForLog(walkspeed)} 交通手段:${sanitizeForLog(routepattern)} (API用:${routepatternForAPI}) 事業者:${sanitizeForLog(operators ?? '指定なし')}`);

  // APIを呼び出してルートデータを取得
  try {
  const apiData = await buildRouteSearchResponse({
    now: time,
    location: departure,
    speed: walkspeed,
    priority: priority,
    date: date,
    routepattern: routepatternForAPI,
    operators: operators
  });
    
  // FastestRoutesの結果を取得
  const routeData = apiData.results;

  // ルートデータを整形して表示
  const searchResult = {
    dep: departure,
    ja_dep: convert2kanji(departure),
    arr: arrival,
    date: date,
    time: time,
    time_mode: req.body.time_mode,
    priority: priority,
    walkspeed: walkspeed,
    duration: "",
    routepattern: routepattern,
    // 検索後も申込書のチェックを選んだ状態で描き直すため、画面に返す
    operators: operators,
    way: shapeRouteData(routeData, { departure, arrival, routeKey: toRouteKey(routepattern) }),
    // 夜の検索で出す「今日の最終」。時間帯の外では null
    lastDepartures: apiData.lastDepartures,
    // データの時点。画面では shared/dataTimesView.js が文言にする
    dataTimes: apiData.meta?.dataTimes ?? null,
  };
  
  res.render('index', { results: searchResult, errors: null, baseUrl: BASE_URL });
  
  } catch (error) {
    // 入力の誤りは、どこが誤りかを返す。それ以外は、詳細をログにだけ残す
    if (error instanceof InvalidQueryError) {
      return res.status(400).render('index', { results: null, errors: error.errors, baseUrl: BASE_URL });
    }
    console.error('API呼び出しエラー:', error);
    // エラー時はエラーメッセージを表示
    res.render('index', { results: null, errors: [{ msg: 'ルート検索中にエラーが発生しました' }], baseUrl: BASE_URL });
  }
});

// エラー処理は、ルートの定義の一番最後に置く。はまこく Map の Router のエラーもここに来る
app.use(createErrorHandler());

app.listen(port, () => {
  console.log(`App listening at port ${port}`);
});


