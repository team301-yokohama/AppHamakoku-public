import { useEffect, useState } from "react";
import { pad, setDeparture, useDeparture } from "../departure.js";
import { DateBoxes, PeriodButtons, RelativeMinutes } from "./DepartureTime.jsx";
import ModeIcon from "./ModeIcon.jsx";
import { readChecks, readDisabled, readRadio, setRadio, subscribeForm, toggleCheck } from "../formFields.js";
import { OPERATORS_BY_MODE, operatorName } from "../../config/providers/operators.js";

// 券売機方式（PC・タブレットの入力 / ADR-0013）。
// 1画面1問で「時刻 → 出発地 → 乗り物 → 速さ → 確認」の5手順。
// 左に手順の一覧、中央に質問と大きなボタン、右に案内券の見本。
//
// 送信する値は経路申込書と同じ input が持っている（formFields.js 経由で
// 読み書きする）。券売機は別の入力欄を作らないので、幅が変わって申込書に
// 戻っても選んだ内容がそのまま残る。

const LOCATIONS = [
  { value: "Library", label: "図書館前" },
  { value: "RikoA", label: "理工A棟" },
  { value: "Shokudo1", label: "第1食堂" },
  { value: "Shokudo2", label: "第2食堂" },
];

const TRANSPORTS = [
  { value: "bus", label: "バス", mode: "bus" },
  { value: "train", label: "電車", mode: "train" },
  { value: "cycle", label: "シェアサイクル", mode: "cycle" },
  { value: "walk", label: "徒歩のみ", mode: "walk" },
];

const SPEEDS = [
  { value: "slow", label: "ゆっくり" },
  { value: "normal", label: "ふつう" },
  { value: "littlefast", label: "早歩き" },
  { value: "fast", label: "ダッシュ" },
];

// 時刻は「いまから〇分後」か「日時を指定」。〇分後は決まった選択肢ではなく、
// main の「〇分後に出発」と同じく +1・+5・+10 で足していく（申込書と共用）
const TIME_MODES = [
  { mode: "relative", label: "いまから" },
  { mode: "absolute", label: "日時を指定" },
];

// 質問と説明文は画面サンプルの文面
const STEPS = [
  { key: "time", name: "時刻", question: "いつ出発しますか", help: "出発までの時間を +1分・+5分・+10分 で指定。日付・時刻を指定する場合は「日時を指定」を選択" },
  { key: "location", name: "出発地", question: "どこから出発しますか", help: "歩き始める場所を選択（到着は横浜駅で固定）" },
  { key: "transport", name: "乗り物", question: "使う乗り物を選んでください", help: "複数選択可。乗り物の下の事業者も個別に除外可能（定期券対象外の事業者を避ける場合など）" },
  { key: "speed", name: "速さ", question: "歩く速さを選んでください", help: "出発地からの徒歩・乗り換え時間の算出に使用" },
  { key: "confirm", name: "確認", question: "この内容で乗換案内を検索します", help: "案内券の内容を確認のうえ「検索」を押してください。条件は検索後も調整できます。" },
];

const labelOf = (list, value) => list.find((item) => item.value === value)?.label ?? "—";

function readForm() {
  return {
    departure: readRadio("departure"),
    walkspeed: readRadio("walkspeed"),
    transports: readChecks("routepattern"),
    // 交通事業者（#96）。手段を外しているあいだは無効になるので、それも読む
    operators: readChecks("operators"),
    operatorsOff: readDisabled("operators"),
  };
}

// 出発日時を読める1行にする
function departureText({ mode, offset, date, time }) {
  if (mode === "absolute") {
    if (!date || !time) return "—";
    const [, month, day] = date.split("-");
    return `${Number(month)}月${Number(day)}日 ${time}`;
  }
  const at = new Date();
  at.setMinutes(at.getMinutes() + offset);
  const hhmm = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return offset === 0 ? `今すぐ（${hhmm}ごろ）` : `${offset}分後（${hhmm}ごろ）`;
}

export default function TicketMachine({ defaultDate = "", defaultTime = "" }) {
  const [step, setStep] = useState(0);
  const [fields, setFields] = useState(readForm);
  const departure = useDeparture();

  // 申込書側で触られても表示を合わせる
  useEffect(() => {
    const update = () => setFields(readForm());
    update();
    return subscribeForm(update);
  }, []);

  // 外した事業者（#96）。手段ごと外しているものは「乗り物」で分かるので、
  // その手段は使うが外した事業者だけを書く
  const excluded = Object.values(OPERATORS_BY_MODE).flat()
    .filter((operator) => !fields.operators.includes(operator.key) && !fields.operatorsOff.includes(operator.key))
    .map((operator) => operatorName(operator.key));

  const transportLabel = fields.transports.length > 0
    ? fields.transports.map((v) => labelOf(TRANSPORTS, v)).join("・")
    : "すべての乗り物";

  const summary = {
    time: departureText(departure),
    location: labelOf(LOCATIONS, fields.departure),
    transport: excluded.length > 0 ? `${transportLabel}（${excluded.join("・")}を除く）` : transportLabel,
    speed: labelOf(SPEEDS, fields.walkspeed),
    confirm: "",
  };

  // 取消。入力を最初の状態に戻して手順1へ（券売機の「取消」）
  const cancel = () => {
    setRadio("departure", "Library");
    setRadio("walkspeed", "normal");
    for (const value of readChecks("routepattern")) toggleCheck("routepattern", value);
    setDeparture({ mode: "relative", offset: 0, date: defaultDate, time: defaultTime });
    setStep(0);
  };

  const current = STEPS[step];

  return (
    <div className="machine">
      {/* 上の帯。サイトのヘッダーの代わりに出す（画面サンプル）*/}
      <div className="machine-band">
        <h2 className="machine-title">横浜駅への最短ルートを検索</h2>
        <span className="machine-brand">はまこく Exp.</span>
      </div>

      <div className="machine-body">
        {/* 左: 手順の一覧。今の手順を塗り、各手順の下に選んだ内容を出す。押すとその手順へ */}
        <nav className="machine-steps" aria-label="手順">
          <ol>
            {STEPS.map((item, i) => (
              <li key={item.key}>
                <button type="button"
                        className="machine-step"
                        aria-current={i === step ? "step" : undefined}
                        onClick={() => setStep(i)}>
                  <span className="machine-step-no" aria-hidden="true">{i + 1}</span>
                  <span className="machine-step-name">{item.name}</span>
                  {summary[item.key]
                    ? <span className="machine-step-value">{summary[item.key]}</span>
                    : null}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        {/* 中央: 質問・説明文・大きなボタン */}
        <div className="machine-main">
          <div className="machine-head">
            <p className="machine-count">手順 {step + 1} / {STEPS.length}</p>
            <p className="machine-question">{current.question}</p>
            <p className="machine-help">{current.help}</p>
          </div>

          {current.key === "time" ? (
            <div className="machine-time">
              <div className="machine-choices machine-choices--when">
                {TIME_MODES.map((item) => (
                  <button type="button" key={item.mode} className="machine-btn machine-btn--when"
                          aria-pressed={departure.mode === item.mode}
                          onClick={() => setDeparture({ mode: item.mode })}>
                    {item.label}
                  </button>
                ))}
              </div>

              {departure.mode === "absolute"
                // ボタンで日時を入れ替えたら（revision が進んだら）箱を描き直す
                ? <DateBoxes key={departure.revision ?? 0} date={departure.date} time={departure.time} size="lg" />
                : <RelativeMinutes offset={departure.offset} size="lg" />}

              <PeriodButtons size="lg" />
            </div>
          ) : null}

          {current.key === "location" ? (
            <div className="machine-choices machine-choices--tall">
              {LOCATIONS.map((item) => (
                <button type="button" key={item.value} className="machine-btn machine-btn--tall"
                        aria-pressed={fields.departure === item.value}
                        onClick={() => setRadio("departure", item.value)}>
                  <span className="icon-slot icon-slot--lg" aria-hidden="true"></span>{item.label}
                </button>
              ))}
            </div>
          ) : null}

          {current.key === "transport" ? (
            <div className="machine-choices machine-choices--modes">
              {TRANSPORTS.map((item) => {
                const on = fields.transports.includes(item.value);
                // 手段の下にその事業者を並べる（#96・ADR-0029）。徒歩に事業者は無い
                const operators = OPERATORS_BY_MODE[item.value] ?? [];
                return (
                  <div className="machine-mode" key={item.value}>
                    <button type="button" className="machine-btn machine-btn--mode"
                            aria-pressed={on}
                            onClick={() => toggleCheck("routepattern", item.value)}>
                      <span className="machine-check" aria-hidden="true">{on ? "✓" : ""}</span>
                      <ModeIcon mode={item.mode} />
                      {item.label}
                    </button>
                    {operators.length > 0 ? (
                      <div className="machine-operators">
                        {operators.map((operator) => (
                          <button type="button" key={operator.key} className="machine-op"
                                  aria-pressed={fields.operators.includes(operator.key)}
                                  disabled={fields.operatorsOff.includes(operator.key)}
                                  onClick={() => toggleCheck("operators", operator.key)}>
                            {operator.name}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {current.key === "speed" ? (
            <div className="machine-choices machine-choices--tall">
              {SPEEDS.map((item) => (
                <button type="button" key={item.value} className="machine-btn machine-btn--tall"
                        aria-pressed={fields.walkspeed === item.value}
                        onClick={() => setRadio("walkspeed", item.value)}>
                  <span className="icon-slot icon-slot--lg" aria-hidden="true"></span>{item.label}
                </button>
              ))}
            </div>
          ) : null}

          {current.key === "confirm" ? (
            <>
              <p className="note">現在時刻から、横浜駅への到着が早い順に最大6件を案内</p>
              {/* タブレット幅では右の見本が無いので、ここで券面を見せてから検索する */}
              <div className="machine-sample machine-sample--inline" aria-label="案内券の見本">
                <SampleTicket summary={summary} />
              </div>
              <button type="submit" className="machine-submit" id="machine-submit">検索</button>
            </>
          ) : null}

          <div className="machine-controls">
            <button type="button" className="machine-ctl" onClick={cancel}>取消</button>
            <button type="button" className="machine-ctl" disabled={step === 0}
                    onClick={() => setStep((s) => Math.max(s - 1, 0))}>戻る</button>
            {step < STEPS.length - 1 ? (
              <button type="button" className="machine-ctl machine-ctl--next"
                      onClick={() => setStep((s) => Math.min(s + 1, STEPS.length - 1))}>次へ</button>
            ) : null}
          </div>
        </div>

        {/* 右: 案内券の見本。1024px からだけ出す（ADR-0024）。
            それより狭いタブレットでは、確認の手順で検索ボタンの上に出す */}
        <aside className="machine-sample machine-sample--side" aria-label="案内券の見本">
          <p className="machine-sample-cap">この内容で案内します</p>
          <SampleTicket summary={summary} />
        </aside>
      </div>
    </div>
  );
}

// 案内券の見本（画面サンプルの「案内券（はまこく）」の券面）
function SampleTicket({ summary }) {
  return (
    <div className="ticket ticket--sample">
      <div className="ticket-face">
        <p className="sample-head">
          <span className="sample-name">案内券</span>
          <span className="sample-brand">（はまこく）</span>
        </p>
        <p className="sample-route">
          <span>{summary.location}</span>
          <span className="sample-arrow" aria-hidden="true">→</span>
          <span>横浜駅</span>
        </p>
        <dl className="sample-list">
          <dt>出発</dt>
          <dd>{summary.time}</dd>
          <dt>乗り物</dt>
          <dd>{summary.transport}</dd>
          <dt>速さ</dt>
          <dd>{summary.speed}</dd>
        </dl>
        <p className="sample-foot">
          <span>当日限り有効</span>
          <span>見本</span>
        </p>
      </div>
    </div>
  );
}
