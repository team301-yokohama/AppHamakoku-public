import { useEffect, useState } from "react";
import { pad, replaceDeparture, setDeparture, useDeparture } from "../departure.js";
import { departureForPeriod, periodLabel, upcomingPeriods } from "../classPeriods.js";

// 出発日時の入力（経路申込書と経路を調整）。
// 値は departure.js が1つだけ持ち、券売機（TicketMachine）とも共有する。
// 送信時の hidden への書き込みは departure.js の wireSubmit が受け持つ。
// EJS 版と同じクラス名・id を使っているので styles.css はそのまま効く。

// 申込書（最初の検索）は「今から何分後」。ボタンの並びは画面サンプルの申込書に合わせる。
// 経路を調整（結果を出したあと）は、前にも後ろにも動かせる（ADR-0020）
const QUICK = [
  { label: "今すぐ", delta: 0 },
  { label: "+1", delta: 1 },
  { label: "+5", delta: 5 },
  { label: "+10", delta: 10 },
];

// 分数は十の位・一の位の2つの箱で見せるので、99分までにする
const MAX_OFFSET = 99;

const SHIFT = [-5, -1, 0, 1, 5];

export default function DepartureTime({ variant = "form" }) {
  const isAdjust = variant === "adjust";
  const { mode, offset, date, time, revision } = useDeparture();

  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const nowText = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  // 「−5・−1・現在・+1・+5」。0 はいまの日時に戻す（ADR-0020）
  const shift = (minutes) => {
    if (minutes === 0) {
      setDeparture({ date: today, time: nowText });
      return;
    }
    const at = new Date();
    const [h, m] = String(time || "00:00").split(":").map(Number);
    at.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
    at.setMinutes(at.getMinutes() + minutes);
    // 日付をまたぐずらし方はしないので、日付は触らない
    setDeparture({ time: `${pad(at.getHours())}:${pad(at.getMinutes())}` });
  };

  if (isAdjust) {
    // 経路を調整では日時の入力欄を置かず、今の出発時刻を見せてボタンでずらす（画面サンプル・ADR-0025）。
    // 日付が変わる規模の変更は「初めから案内し直す」で入力からやり直す。
    // 日付は今日でないときだけ添える
    const [, month, day] = String(date || "").split("-");
    const suffix = date && date !== today
      ? `（${Number(month)}月${Number(day)}日）`
      : (time === nowText ? "（現在）" : "");
    return (
      <>
        <input type="hidden" name="time_mode" value="absolute" />
        <p className="adjust-time" aria-live="polite">
          <span className="adjust-time-lbl">出発</span>
          <strong className="adjust-time-value">{time || "—"}</strong>
          {suffix ? <span className="adjust-time-note">{suffix}</span> : null}
        </p>
        <div className="shift-buttons">
          {SHIFT.map((minutes) => (
            <button type="button" key={minutes} className="quick-btn"
                    onClick={() => shift(minutes)}>
              {minutes === 0 ? "現在" : (minutes > 0 ? `+${minutes}` : String(minutes))}
            </button>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      {/* 選んだほうを○で囲む（画面サンプル）*/}
      <div className="time-mode">
        <input type="radio" name="time_mode" id="mode-relative" value="relative"
               checked={mode === "relative"} onChange={() => setDeparture({ mode: "relative" })} />
        <label htmlFor="mode-relative">いまから</label>

        <input type="radio" name="time_mode" id="mode-absolute" value="absolute"
               checked={mode === "absolute"} onChange={() => setDeparture({ mode: "absolute" })} />
        <label htmlFor="mode-absolute">日時を指定</label>
      </div>

      {mode === "relative" ? (
        <RelativeMinutes offset={offset} />
      ) : (
        // ボタンで日時を入れ替えたら（revision が進んだら）箱を描き直す
        <DateBoxes key={revision ?? 0} date={date} time={time} />
      )}

      <PeriodButtons />
    </>
  );
}

/**
 * 「〇限終わり」のボタン（#164）。まだ終わっていない時限のうち直近の3つを出し、
 * 押すと「日時を指定」に切り替えて今日のその時限の終了時刻を入れる。
 * 残りの時限が無い時間帯（21 時以降など）は何も出さない。
 * JS が無効なときは島ごと描かれないので、検索はこのボタン無しでできる
 */
export function PeriodButtons({ size = "md" }) {
  const [now, setNow] = useState(() => new Date());

  // 開いたまま時限が終わったら、そのボタンを消す
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const periods = upcomingPeriods(now);
  if (periods.length === 0) return null;

  return (
    <div className={`period-buttons period-buttons--${size}`} role="group" aria-labelledby={`period-buttons-lbl-${size}`}>
      <p className="period-buttons-lbl" id={`period-buttons-lbl-${size}`}>授業のあとに出発</p>
      <div className="period-buttons-row">
        {periods.map((period) => (
          <button type="button" key={period.period} className="quick-btn period-btn"
                  aria-label={`${periodLabel(period)}の ${period.end} に出発`}
                  onClick={() => replaceDeparture(departureForPeriod(period, new Date()))}>
            <span className="period-btn-name">{periodLabel(period)}</span>
            <span className="period-btn-time">{period.end}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// 「〇分後に出発」。十の位と一の位を別の箱で見せ、値はボタンで足す（画面サンプル）。
// 足していく形は main の「〇分後に出発」と同じ。券売機でも同じものを大きくして使う
export function RelativeMinutes({ offset, size = "md" }) {
  const shown = Math.min(offset, MAX_OFFSET);
  return (
    <div className={`relative-minutes relative-minutes--${size}`}>
      <p className="minutes-wrapper" aria-live="polite">
        <span className="digit-box" aria-hidden="true">{Math.floor(shown / 10)}</span>
        <span className="digit-box" aria-hidden="true">{shown % 10}</span>
        <span className="min-label">
          <span className="sr-only">{shown}</span>分後に出発
        </span>
      </p>
      <div className="quick-buttons">
        {QUICK.map(({ label, delta }) => (
          <button type="button" key={label} className="quick-btn"
                  aria-label={delta === 0 ? "今すぐ出発" : `${delta}分足す`}
                  onClick={() => setDeparture({ offset: delta === 0 ? 0 : Math.min(offset + delta, MAX_OFFSET) })}>
            {size === "lg" && delta > 0 ? `${label}分` : label}
          </button>
        ))}
      </div>
    </div>
  );
}

// 「日時を指定」は月・日・時・分の4つの箱に書き込む（画面サンプルの申込書）。
// 年は今の値のまま。箱が空や範囲外のあいだは状態を書き換えない
const PARTS = [
  { key: "month", label: "月", min: 1, max: 12 },
  { key: "day", label: "日", min: 1, max: 31 },
  { key: "hour", label: "時", min: 0, max: 23 },
  { key: "minute", label: "分 発", min: 0, max: 59 },
];

export function DateBoxes({ date, time, size = "md" }) {
  const [year, month, day] = String(date || "").split("-");
  const [hour, minute] = String(time || "").split(":");
  const values = { month, day, hour, minute };

  const setPart = (key, raw) => {
    const n = Number(raw);
    const part = PARTS.find((x) => x.key === key);
    if (raw === "" || !Number.isInteger(n) || n < part.min || n > part.max) return;
    if (key === "month") setDeparture({ date: `${year}-${pad(n)}-${day}` });
    if (key === "day") setDeparture({ date: `${year}-${month}-${pad(n)}` });
    if (key === "hour") setDeparture({ time: `${pad(n)}:${minute}` });
    if (key === "minute") setDeparture({ time: `${hour}:${pad(n)}` });
  };

  return (
    <div className={`date-boxes date-boxes--${size}`}>
      {PARTS.map((part) => (
        <label key={part.key} className="date-box">
          <input type="number" inputMode="numeric" min={part.min} max={part.max}
                 aria-label={part.label.replace(" 発", "")}
                 defaultValue={values[part.key] ?? ""}
                 onChange={(e) => setPart(part.key, e.target.value)} />
          <span>{part.label}</span>
        </label>
      ))}
    </div>
  );
}
