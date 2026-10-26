// 結果の画面に出す「データの時点」の文言をつくる（#220。ODPT ガイドライン 2.1.1・2.2.1）
//
// 動的データ（台数・遅れ・位置）はデータの生成時刻、静的データ（時刻表）は取得日時を出す。
// 値は services の応答の meta.dataTimes（utils/dataTimes.js の getDataTimes()）をそのまま受ける。

// 画面に出す項目と、それぞれがまとめるキー。複数あるときは、いちばん古い時刻を出す（新しく見せない）。
// 動的データ（〜時点）と時刻表（〜取得）は、規約の項目が別なので（2.1.1・2.2.1）、行も分ける。
// ここに無いキーは出さない。相鉄・神奈中の時刻表は仮データのあいだは出さない（時刻は記録している）。
// 運行日のカレンダー（timetable.gtfsCalendar）は、時刻表を選ぶための材料で、画面に出すデータではないので数えない
const LIVE_GROUPS = [
  { label: "シェアサイクル(HELLO)", match: (key) => key === "cycle.hellocycling" },
  { label: "シェアサイクル(ドコモ)", match: (key) => key === "cycle.docomo" },
  { label: "バスリアルタイム情報", match: (key) => key === "bus.municipal" },
  { label: "鉄道リアルタイム情報", match: (key) => key.startsWith("train.") || key.startsWith("info.") },
];
const TIMETABLE_GROUPS = [
  { label: "バス時刻表情報", match: (key) => key === "timetable.municipalBus" },
  { label: "鉄道時刻表情報", match: (key) => key === "timetable.municipalTrain" },
];

function parts(iso, timeZone = "Asia/Tokyo") {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const f = Object.fromEntries(
    new Intl.DateTimeFormat("ja-JP", { timeZone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(date).map((p) => [p.type, p.value]),
  );
  return { md: `${f.month}/${f.day}`, hm: `${f.hour === "24" ? "00" : f.hour}:${f.minute}` };
}

/** 'HH:mm'。基準日（now）と違う日なら 'M/D HH:mm'。読めなければ null */
export function formatAsOf(iso, now = new Date()) {
  if (!iso) return null; // null を new Date(null)（1970 年）として読まない
  const p = parts(iso);
  if (!p) return null;
  return p.md === parts(now.toISOString()).md ? p.hm : `${p.md} ${p.hm}`;
}

/** 日付だけ（取得日時が日単位のものを、時刻つきに見せない）。'M/D' */
function formatDay(iso) {
  return parts(iso)?.md ?? null;
}

function oldest(values) {
  const times = values.filter((v) => v && !Number.isNaN(Date.parse(v))).sort();
  return times[0] ?? null;
}

/**
 * @param {{generated?:object, fetched?:object}|undefined} dataTimes
 * @returns {{summary:string|null, live: {label:string, at:string}[], timetables: {label:string, at:string}[]}}
 *   summary は閉じたままでも見える 1 行。動的データのうち最も古い時点を出す（新しく見せない）
 */
export function buildDataTimes(dataTimes, now = new Date()) {
  const pick = (map, group) => oldest(Object.entries(map ?? {}).filter(([key]) => group.match(key)).map(([, iso]) => iso));
  const live = [];
  const liveIso = [];
  for (const group of LIVE_GROUPS) {
    const iso = pick(dataTimes?.generated, group);
    const at = formatAsOf(iso, now);
    if (at) {
      live.push({ label: group.label, at: `${at} 時点` });
      liveIso.push(iso);
    }
  }
  const timetables = [];
  for (const group of TIMETABLE_GROUPS) {
    const iso = pick(dataTimes?.fetched, group);
    // ファイル名の日付など、日単位のものは時刻をつけない
    const at = iso && /T15:00:00\.000Z$/.test(iso) ? formatDay(iso) : formatAsOf(iso, now);
    if (at) timetables.push({ label: group.label, at: `${at} 取得` });
  }
  const oldestLive = oldest(liveIso);
  return { summary: oldestLive ? `遅れ・台数などは ${formatAsOf(oldestLive, now)} 時点の情報を含みます` : null, live, timetables };
}
