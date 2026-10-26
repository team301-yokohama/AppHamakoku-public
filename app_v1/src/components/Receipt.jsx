import { useEffect, useState } from "react";
import { useDeparture } from "../departure.js";
import { operatorName } from "../../config/providers/operators.js";

// 控。いま選んでいる条件を1か所にまとめた確認欄で、入力に合わせて書き換わる
// （デザイン指南書「経路申込書」）。送信する値そのものではなく、
// 利用者が読んで確かめるための要約を出す。
const LOCATION_LABELS = {
  Library: "図書館前",
  RikoA: "理工A棟",
  Shokudo1: "第1食堂",
  Shokudo2: "第2食堂",
};

const SPEED_LABELS = {
  slow: "ゆっくり",
  normal: "ふつう",
  littlefast: "早歩き",
  fast: "ダッシュ",
};

const TRANSPORT_LABELS = {
  bus: "バス",
  train: "電車",
  cycle: "シェアサイクル",
  walk: "徒歩のみ",
};

// 選ばれている value を順番どおりに拾う
function checkedValues(form, name) {
  return [...form.querySelectorAll(`input[name="${name}"]`)]
    .filter((input) => input.checked)
    .map((input) => input.value);
}

// 外した交通事業者（#96）。手段ごと外しているものは「利用」の行で分かるので、
// ここでは「その手段は使うが、この事業者は使わない」ものだけを拾う
function excludedOperators(form) {
  return [...form.querySelectorAll('input[name="operators"][data-mode]')]
    .filter((input) => !input.checked && !input.disabled)
    .map((input) => operatorName(input.value))
    .filter(Boolean);
}

function readForm(form) {
  const departure = checkedValues(form, "departure")[0];
  const walkspeed = checkedValues(form, "walkspeed")[0];
  return {
    departure: LOCATION_LABELS[departure] ?? "—",
    walkspeed: SPEED_LABELS[walkspeed] ?? "—",
    transports: checkedValues(form, "routepattern").map((v) => TRANSPORT_LABELS[v] ?? v),
    excluded: excludedOperators(form),
  };
}

// 出発日時の島が publish した状態を、読める1行にする
function departureText(time) {
  if (!time) return "—";
  if (time.mode === "absolute") {
    if (!time.date || !time.time) return "—";
    const [, month, day] = time.date.split("-");
    return `${Number(month)}月${Number(day)}日 ${time.time}`;
  }
  const at = new Date();
  at.setMinutes(at.getMinutes() + time.offset);
  const hhmm = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  return time.offset === 0 ? `いま（${hhmm}ごろ）` : `${time.offset}分後（${hhmm}ごろ）`;
}

// 控に書く出発の1行（画面サンプル: 「今すぐ出発」「10分後に出発」「10月04日 14:30 発」）
function departureShort(time) {
  if (!time) return "—";
  if (time.mode === "absolute") {
    if (!time.date || !time.time) return "—";
    const [, month, day] = time.date.split("-");
    return `${month}月${day}日 ${time.time} 発`;
  }
  return time.offset === 0 ? "今すぐ出発" : `${time.offset}分後に出発`;
}

export default function Receipt({ variant = "sheet" }) {
  const [form, setForm] = useState({ departure: "—", walkspeed: "—", transports: [], excluded: [] });
  const time = useDeparture();

  useEffect(() => {
    const element = document.getElementById("main-search-form");
    if (!element) return;

    const update = () => setForm(readForm(element));
    update();

    // チェックボックスの排他処理（インラインスクリプト）より後に読みたいので
    // change はバブリングしたものを拾う
    element.addEventListener("change", update);
    return () => element.removeEventListener("change", update);
  }, []);

  // 未選択は「すべての交通手段」の意味（ADR-0001）
  const transports = form.transports.length > 0 ? form.transports.join("・") : "すべて";

  // 経路を調整の見出しに出す1行（ADR-0020「見出しに今の条件を1行で出す」）
  if (variant === "line") {
    return (
      <span className="receipt-line" aria-live="polite">
        {departureText(time)}　{form.departure} → 横浜駅　{transports}
        {form.excluded.length > 0 ? `（${form.excluded.join("・")}を除く）` : ""}　{form.walkspeed}
      </span>
    );
  }

  // 左に大きく「控」、右に条件を1行ずつ（画面サンプルの申込書）
  return (
    <div className="receipt" aria-live="polite">
      <span className="receipt-mark">控</span>
      <div className="receipt-body">
        <span className="receipt-route">{form.departure} → 横浜駅</span>
        <span>{departureShort(time)}　／　{form.walkspeed}</span>
        <span className="receipt-modes">利用：{form.transports.length > 0 ? transports : "すべての乗り物"}</span>
        {/* 外した事業者があるときだけ出す。いつも出すと控が長くなる */}
        {form.excluded.length > 0 ? (
          <span className="receipt-modes">使わない：{form.excluded.join("・")}</span>
        ) : null}
      </div>
    </div>
  );
}
