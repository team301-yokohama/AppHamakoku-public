/**
 * @file yokohamaStation.js
 * @abstract 横浜駅に乗り入れる鉄道の、はまこく Map 用の定義
 *
 * はまこく Map の横浜駅の地図で、駅をタップして発車時刻を出すのに使う。
 * ルート検索（app_v1 の domain）は使わない。あちらは「出発地 → 横浜駅」の片道だけで、
 * ここは逆向き（横浜駅から出る電車）を両方向とも出すため。
 *
 * 調べた結果（2026-10-18 に実際に叩いて確認、#186 のコメントの表を更新したもの）:
 *
 * | 路線              | 時刻表 | 運行情報 | 走行中の列車 | 便と結びつく | 遅れ(秒) |
 * |-------------------|-------|---------|------------|------------|---------|
 * | JR 東海道線        | ○     | ○       | ○ 25本     | ○          | ○       |
 * | JR 横須賀線        | ○     | ○       | ○ 20本     | ○          | ○       |
 * | JR 京浜東北・根岸線 | ○     | ○       | ○ 45本     | ○          | ○       |
 * | JR 湘南新宿ライン   | ○     | ○       | ○ 14本     | ○          | ○       |
 * | 京急本線           | ○     | ×       | ○ 45本     | ×          | ×       |
 * | 東急東横線         | ○     | ○       | ×          | ×          | ×       |
 * | 相鉄本線           | ○     | ×       | ×          | ○（列車が無い）| ×     |
 * | 地下鉄ブルーライン  | ○     | ○       | ○ 23本     | ○          | ○       |
 * | みなとみらい線      | ×     | ×       | ×          | ×          | ×       |
 *
 * - **京急は走行中の列車は取れるが、便と結びつけられない**（odpt:StationTimetable の便に
 *   odpt:train が無い）。odpt:delay も入っていないので、便ごとの遅れは出せない
 * - **みなとみらい線は時刻表が 0 件**なので、この一覧に入れない（地図にも印を出さない）
 * - 東急は横浜が終点、相鉄は横浜が起点なので、**時刻表がある方向が片方だけ**
 * - 地下鉄だけ本番 API（ODPT_API_KEY）。ほかはチャレンジ API（ODPT_CHL_API_KEY、#100）
 */

/**
 * 地図に出す印。横浜駅には6事業者が乗り入れるので、路線ではなく事業者ごとに1つ置く
 *
 * 座標のもとは odpt:Station の geo:lat / geo:long。どちらの API も全事業者ぶんは持っていないので、
 * JR・京急・東急はチャレンジ API、地下鉄は本番 API から取った値。
 *
 * **相鉄と京急だけは手で置き直してある。** この印は測量の点ではなく「どこを押せばその路線か」の
 * 目印なので、改札や乗り場のある場所に寄せたほうが分かりやすい:
 * - 相鉄は odpt の 35.46559 / 139.62232（JR の 10m 南）だと JR の札と重なって読めない。
 *   乗り場のある新相鉄ビルの上（地図の SVG から拾った建物の重心）に移した
 * - 京急は odpt の 35.465264 / 139.622848 がホームの南端で、地図では駅の南に外れて見える。
 *   地図に書いてある「横浜駅」の文字（lat 35.466290）より少し北。駅の建物の東寄りに置き、
 *   東口のロータリー（OSM の一方通行の輪。地図では x 471〜534）にも札が掛かるようにした
 *   （この高さでは建物は x 361〜461、札の幅は地図の座標でおよそ 65）
 *
 * short は地図の印に書く名前。横浜駅のまわりは印が近いので、札は短いほどよい
 */
export const YOKOHAMA_RAIL_OPERATORS = [
  { id: "jr", name: "JR", short: "JR", lat: 35.46579, lon: 139.6224 },
  { id: "keikyu", name: "京急", short: "京急", lat: 35.466397, lon: 139.623467 },
  { id: "tokyu", name: "東急", short: "東急", lat: 35.466419, lon: 139.622203 },
  { id: "sotetsu", name: "相鉄", short: "相鉄", lat: 35.464794, lon: 139.62038 },
  { id: "subway", name: "市営地下鉄", short: "地下鉄", lat: 35.465624, lon: 139.619948 },
];

/**
 * 横浜駅から出る電車の路線。
 *
 * `directions` は odpt:RailDirection の末尾 → 画面に出す名前。ODPT の dc:title は
 * 「上り」「下り」しか返さないので、行先が分かる言い方にしてある。
 * 名前は 2026-10-18 時点の平日ダイヤの行先の多い順（上位6件）から決めた:
 *   東海道 Inbound  = 高崎33・宇都宮27・小金井20・籠原19・東京11・上野10
 *   東海道 Outbound = 熱海44・小田原33・平塚27・国府津12
 *   横須賀 Inbound  = 千葉39・成田空港34・君津12  / Outbound = 久里浜43・逗子41・大船28
 *   京浜東北 North  = 大宮138・八王子65・南浦和59 / South = 大船127・桜木町85・磯子66
 *   湘南新宿 North  = 宇都宮19・籠原18・高崎14   / South = 逗子24・小田原15・平塚12
 *   京急 Inbound    = 品川130・羽田空港73・青砥45 / Outbound = 浦賀99・逗子葉山77・三崎口74
 *   東横 Inbound    = 和光市83・渋谷82・小手指26
 *   相鉄 Outbound   = 海老名118・湘南台76・西谷48
 *   ブルー Inbound  = あざみ野161・新羽12       / Outbound = 湘南台153・踊場12
 */
export const YOKOHAMA_RAIL_LINES = [
  {
    id: "jr-tokaido",
    operatorId: "jr",
    api: "challenge",
    name: "東海道線",
    station: "odpt.Station:JR-East.Tokaido.Yokohama",
    railway: "odpt.Railway:JR-East.Tokaido",
    directions: { Inbound: "東京・上野方面", Outbound: "小田原・熱海方面" },
  },
  {
    id: "jr-yokosuka",
    operatorId: "jr",
    api: "challenge",
    name: "横須賀線",
    station: "odpt.Station:JR-East.Yokosuka.Yokohama",
    railway: "odpt.Railway:JR-East.Yokosuka",
    directions: { Inbound: "東京・千葉方面", Outbound: "逗子・久里浜方面" },
  },
  {
    id: "jr-keihintohoku",
    operatorId: "jr",
    api: "challenge",
    name: "京浜東北・根岸線",
    station: "odpt.Station:JR-East.KeihinTohokuNegishi.Yokohama",
    railway: "odpt.Railway:JR-East.KeihinTohokuNegishi",
    directions: { Northbound: "東京・大宮方面", Southbound: "桜木町・大船方面" },
  },
  {
    id: "jr-shonanshinjuku",
    operatorId: "jr",
    api: "challenge",
    name: "湘南新宿ライン",
    station: "odpt.Station:JR-East.ShonanShinjuku.Yokohama",
    railway: "odpt.Railway:JR-East.ShonanShinjuku",
    directions: { Northbound: "新宿・大宮方面", Southbound: "大船・小田原方面" },
  },
  {
    id: "keikyu-main",
    operatorId: "keikyu",
    api: "challenge",
    name: "京急本線",
    station: "odpt.Station:Keikyu.Main.Yokohama",
    railway: "odpt.Railway:Keikyu.Main",
    directions: { Inbound: "品川・羽田空港方面", Outbound: "浦賀・三崎口方面" },
  },
  {
    id: "tokyu-toyoko",
    operatorId: "tokyu",
    api: "challenge",
    name: "東横線",
    station: "odpt.Station:Tokyu.Toyoko.Yokohama",
    railway: "odpt.Railway:Tokyu.Toyoko",
    // 横浜は東横線の終点。横浜から出るのは渋谷方面だけ
    directions: { Inbound: "渋谷・池袋方面" },
  },
  {
    id: "sotetsu-main",
    operatorId: "sotetsu",
    api: "challenge",
    name: "相鉄本線",
    station: "odpt.Station:Sotetsu.Main.Yokohama",
    railway: "odpt.Railway:Sotetsu.Main",
    // 横浜は相鉄本線の起点。横浜から出るのは海老名方面だけ
    directions: { Outbound: "海老名・湘南台方面" },
  },
  {
    id: "subway-blue",
    operatorId: "subway",
    api: "production",
    name: "ブルーライン",
    station: "odpt.Station:YokohamaMunicipal.Blue.Yokohama",
    railway: "odpt.Railway:YokohamaMunicipal.Blue",
    directions: { Inbound: "あざみ野方面", Outbound: "湘南台方面" },
  },
];
