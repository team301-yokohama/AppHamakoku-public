import { useEffect, useMemo, useState } from "react";
import ModeIcon from "./ModeIcon.jsx";
import { applyFareType, currentFareType } from "../fareToggle.js";
import {
  addMinutes,
  buildAxis,
  buildTicket,
  minutesToText,
  modeOf,
  offsetPercent,
  rideDetail,
  widthPercent,
  cycleRentalChips,
  cycleTicketOperators,
  operatorShortName,
  shortPortName,
  cycleReturnChip } from "../../shared/ticketView.js";

// PC・タブレットの出力（ADR-0013・0021）。
// 上に6件のダイヤ図、下に選んだ便の詳細。経路を調整は EJS 側にあり、
// CSS のグリッドで詳細の右に並ぶ。
//
// 経路は EJS が <script type="application/json" id="route-data"> に置く。
// 値づくりはサーバ側と同じ shared/ticketView.js を使う。

function readRoutes() {
  const element = document.getElementById("route-data");
  if (!element) return [];
  try {
    return JSON.parse(element.textContent);
  } catch {
    return [];
  }
}

// データの時刻（#220）。EJS が id="data-times-data" に置く。値づくりは shared/dataTimesView.js
function readDataTimes() {
  const element = document.getElementById("data-times-data");
  if (!element) return { live: [], timetables: [] };
  try {
    return JSON.parse(element.textContent);
  } catch {
    return { live: [], timetables: [] };
  }
}

// 10分おきの目盛り
function ticks(axis) {
  const list = [];
  for (let m = 0; m <= axis.span; m += 10) {
    list.push({ minutes: m, label: minutesToText(axis.start + m) });
  }
  return list;
}



/** 券の見出しに添える、借りられる事業者の印（#47）。EJS 側と同じ見た目 */
function LineOperators({ leg }) {
  if (leg.type !== "sharecycle") return null;
  return (
    <>
      {cycleTicketOperators(leg).map((op) => (
        <span key={op.className} className={`line-op ${op.usable ? op.className : "is-off"}`}
              title={`${op.fullName}: ${op.usable ? "貸出可" : "このポートでは貸出不可"}`}>
          {op.name}
        </span>
      ))}
    </>
  );
}

/**
 * シェアサイクルのポートに添える、事業者ごとの印（#47）。
 * EJS の views/_portChips.ejs と同じ見た目にそろえている。
 * 貸出は事業者の色つきで台数、返却は色を並べて空き数を 1 つだけ出す
 * （空きはラックを共用していて 1 つの数しか無いため）。
 */
function PortChips({ rentChips = [], retChip = null }) {
  if (rentChips.length === 0 && !retChip) return null;
  return (
    <>
      {rentChips.length > 0 ? (
        <span className="port-chips">
          {rentChips.map((chip) => (
            <span key={chip.className} className={`port-chip ${chip.usable ? chip.className : "is-off"}`}
                  title={`${chip.fullName}: ${chip.count}台`}>
              {chip.name} {chip.count}
            </span>
          ))}
        </span>
      ) : null}
      {retChip ? (
        <span className="port-chips">
          <span className="port-chip port-chip--return" title={retChip.title}>
            <span className="port-chip-ops" aria-hidden="true">
              {retChip.operators.map((op) => (
                <i key={op.className} className={op.usable ? op.className : "is-off"} />
              ))}
            </span>
            {retChip.label}
          </span>
        </span>
      ) : null}
    </>
  );
}

export default function Diagram({ issuedAt = "", reportEnabled = "true" }) {
  const tickets = useMemo(() => readRoutes().map(buildTicket), []);
  const dataTimes = useMemo(readDataTimes, []);
  const axis = useMemo(() => buildAxis(tickets), [tickets]);
  const [selected, setSelected] = useState(0);

  // ダイヤ図は島なので、描き直すたびに IC／現金の選択を当て直す（#97）
  useEffect(() => {
    applyFareType(currentFareType());
  });

  if (!axis || tickets.length === 0) return null;

  const current = tickets[Math.min(selected, tickets.length - 1)];

  // 「現在」の位置。時間軸の外なら引かない
  const now = new Date();
  const nowText = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const nowAt = offsetPercent(axis, nowText);
  const showNow = nowAt >= 0 && nowAt <= 100;

  return (
    <>
      <section className="diagram" aria-labelledby="diagram-title">
        <div className="diagram-head">
          <h2 className="diagram-title" id="diagram-title">ダイヤ図</h2>
          <p className="diagram-help">横軸：時刻　タップで詳しい経路を表示</p>
        </div>
        <div className="diagram-scale" aria-hidden="true">
          {ticks(axis).map((tick) => (
            <span key={tick.minutes} className="diagram-tick"
                  style={{ left: `${widthPercent(axis, tick.minutes)}%` }}>
              {tick.label}
            </span>
          ))}
        </div>

        <ol className="diagram-rows">
          {tickets.map((ticket, i) => (
            <li key={ticket.index}>
              <button type="button"
                      className={`diagram-row${i === selected ? " is-selected" : ""}`}
                      aria-pressed={i === selected}
                      onClick={() => setSelected(i)}>
                {/* 左: 番号と路線名の札、その下に発着（画面サンプル）*/}
                <span className="diagram-label">
                  <span className="diagram-lines">
                    <span className="ticket-no" aria-hidden="true">{i + 1}</span>
                    {ticket.rides.length === 0 ? (
                      <span className="ticket-line"><ModeIcon mode="walk" />徒歩</span>
                    ) : ticket.rides.map((leg, j) => (
                      <span key={j} className={`ticket-line${Number(leg.delay) > 0 ? " is-delayed" : ""}`}>
                        <ModeIcon mode={modeOf(leg.type)} />
                        {ticket.rideLabels[j]}
                        <LineOperators leg={leg} />
                      </span>
                    ))}
                  </span>
                  <span className="diagram-times">
                    {ticket.departure} → {ticket.arrival}
                    {ticket.delay > 0
                      ? <span className="diagram-estimate">（見込み {ticket.estimatedArrival}）</span>
                      : null}
                  </span>
                </span>

                <span className="diagram-track">
                  {ticks(axis).map((tick) => (
                    <span key={tick.minutes} className="diagram-gridline" aria-hidden="true"
                          style={{ left: `${widthPercent(axis, tick.minutes)}%` }} />
                  ))}

                  {ticket.bands.map((band, j) => (
                    <span key={j}
                          className={band.kind === "wait"
                            ? "diagram-band is-wait"
                            : `diagram-band mode mode--band is-${band.kind}${band.delayed ? " is-delayed" : ""}`}
                          style={{
                            left: `${offsetPercent(axis, band.from)}%`,
                            width: `${widthPercent(axis, band.minutes)}%`,
                          }} />
                  ))}

                  {/* 遅れで到着が延びる分。赤い斜線の破線で後ろに足す（ADR-0021）*/}
                  {ticket.delay > 0 ? (
                    <span className="diagram-extra"
                          style={{
                            left: `${offsetPercent(axis, ticket.arrival)}%`,
                            width: `${widthPercent(axis, ticket.delay)}%`,
                          }}>
                      <span className="diagram-extra-label">+{ticket.delay}分</span>
                    </span>
                  ) : null}
                </span>

              </button>
            </li>
          ))}

          {showNow ? (
            <span className="diagram-now-wrap" aria-hidden="true">
              <span className="diagram-now" style={{ left: `${nowAt}%` }}>
                <span className="diagram-now-label">現在</span>
              </span>
            </span>
          ) : null}
        </ol>

        {/* 凡例は図の枠の下に置く（画面サンプル）。広い画面では案内券側の凡例を隠す */}
        <ul className="diagram-legend">
          <li><span className="mode mode--swatch is-walk" aria-hidden="true" />徒歩</li>
          <li><span className="mode mode--swatch is-bus" aria-hidden="true" />バス</li>
          <li><span className="mode mode--swatch is-train" aria-hidden="true" />電車</li>
          <li><span className="mode mode--swatch is-cycle" aria-hidden="true" />シェアサイクル</li>
          <li><span className="mode mode--swatch is-wait" aria-hidden="true" />乗り継ぎ待ち</li>
          <li className="is-delayed"><span className="diagram-legend-extra" aria-hidden="true" />遅延見込み</li>
          <li className="diagram-legend-note">遅延表示対応：横浜市営バス・横浜市営地下鉄</li>
        </ul>
        {dataTimes.live.length || dataTimes.timetables.length ? (
          <details className="legend-times">
            <summary>データの時刻</summary>
            <dl className="data-times">
              {dataTimes.live.map((item) => (
                <div className="data-times-row" key={item.label}><dt>{item.label}</dt><dd>{item.at}</dd></div>
              ))}
              {dataTimes.timetables.map((item) => (
                <div className="data-times-row" key={item.label}><dt>{item.label}</dt><dd>{item.at}</dd></div>
              ))}
            </dl>
          </details>
        ) : null}
      </section>

      <section className="diagram-detail" aria-label="選んだ便の詳細">
        <Detail ticket={current} issuedAt={issuedAt} reportEnabled={reportEnabled !== "false"} />
      </section>
    </>
  );
}

function Detail({ ticket, issuedAt, reportEnabled }) {
  const { steps, delay } = ticket;

  return (
    <div className={`ticket ticket--large${delay > 0 ? " is-delayed" : ""}`}>
      <div className="ticket-face">
        <div className="ticket-lines">
          <span className="ticket-no" aria-hidden="true">{ticket.index}</span>
          {ticket.rides.length === 0 ? (
            <span className="ticket-line">
              <ModeIcon mode="walk" />徒歩
            </span>
          ) : null}
          {ticket.rides.map((leg, j) => (
            <span key={j} className={`ticket-line${Number(leg.delay) > 0 ? " is-delayed" : ""}`}>
              {j > 0 ? <span className="ticket-line-sep" aria-hidden="true">→</span> : null}
              <ModeIcon mode={modeOf(leg.type)} />
              {ticket.rideLabels[j]}
              <LineOperators leg={leg} />
            </span>
          ))}
        </div>

        <p className="ticket-times">
          {/* 徒歩・シェアサイクルだけの便も時刻は出し、「随時」を添える */}
          <span className="ticket-time">{ticket.departure}</span>
          <span className="ticket-time-lbl">{ticket.scheduled ? "発" : "発（随時）"}</span>
          <span className="ticket-time-arrow" aria-hidden="true">→</span>
          <span className="ticket-time">{ticket.arrival}</span><span className="ticket-time-lbl">着</span>
        </p>

        {delay > 0 ? (
          <p className="ticket-estimate">見込み {ticket.estimatedArrival} 着（遅れ{delay}分）</p>
        ) : null}

        <dl className="ticket-figures">
          <div>
            <dt>所要</dt>
            <dd className={delay > 0 ? "is-delayed" : ""}>{Number(ticket.totaltime) + delay}分</dd>
          </div>
          <div>
            <dt>乗換</dt>
            <dd>{ticket.transfers}回</dd>
          </div>
          <div>
            <dt>{ticket.rides.length === 1 && ticket.cycle ? "料金" : "運賃"}</dt>
            <dd data-fare-ic={ticket.fare} data-fare-cash={ticket.fareCash ?? ticket.fare}>{ticket.fare}円</dd>
          </div>
        </dl>

        {/* シェアサイクルの貸出・返却（#47）。借りる場所と返す場所を行で分け、
            どこで借りてどこに返すのかが券を開かなくても分かるようにする */}
        {ticket.cycle ? (
          <dl className="ticket-cycle">
            <div className="ticket-cycle-row">
              <dt>借りる</dt>
              <dd>
                <span className="ticket-cycle-place">{shortPortName(ticket.cycle.from)}</span>
                {ticket.cycle.rentalcapacity > 0
                  ? <span className="ticket-cycle-num">{`残${ticket.cycle.rentalcapacity}台`}</span>
                  : (ticket.cycle.rentalcapacity === 0
                    ? <span className="alarm">なし</span>
                    : <span className="unknown">—</span>)}
              </dd>
            </div>
            <div className="ticket-cycle-row">
              <dt>返す</dt>
              <dd>
                <span className="ticket-cycle-place">{shortPortName(ticket.cycle.to)}</span>
                {/* 返却枠に制限が無いポートは空き台数が当てにならないので、数字を出さない */}
                {ticket.cycle.returnCapacityUnknown
                  ? <span className="ticket-cycle-num">空きあり</span>
                  : (ticket.cycle.returncapacity > 0
                    ? <span className="ticket-cycle-num">{`空き${ticket.cycle.returncapacity}`}</span>
                    : (ticket.cycle.returncapacity === 0
                      ? <span className="alarm">満</span>
                      : <span className="unknown">—</span>))}
              </dd>
            </div>
          </dl>
        ) : null}

      </div>

      <div className="ticket-detail">
        <div className={`route-map${ticket.hasEstimate ? " has-estimate" : ""}`}>
          {/* 列の見出し。遅れがあるときだけ「見込み」の列を足す */}
          <div className="map-head" aria-hidden="true">
            <span /><span /><span>定刻</span>
            {ticket.hasEstimate ? <span className="map-head-est">見込み</span> : null}
          </div>
          {steps.map((leg, j) => {
            const isFirst = j === 0;
            const prev = j > 0 ? steps[j - 1] : null;
            const wait = prev ? Math.max(0, minutesBetween(prev.arrivaltime, leg.departuretime)) : 0;
            // 地点ごとの見込み。途中の便だけ遅れて、到着は定刻ということがある
            const depLate = ticket.legDelays[j].departure;
            const arrLate = prev ? ticket.legDelays[j - 1].arrival : 0;
            return (
              <div key={j}>
                <div className={`map-point${isFirst ? " is-start" : ""}`}>
                  <span className="map-dot" aria-hidden="true" />
                  <span className="map-name">
                    {isFirst ? leg.from : prev.to}
                    {/* シェアサイクルのポートには、事業者の色で台数・空きを添える（#47）*/}
                    <PortChips
                      rentChips={leg.type === "sharecycle" ? cycleRentalChips(leg.rentalByOperator) : []}
                      retChip={prev && prev.type === "sharecycle"
                        ? cycleReturnChip(prev.returnByOperator, prev.returncapacity, prev.returnCapacityUnknown)
                        : null}
                    />
                  </span>
                  <span className="map-time">
                    {/* 着は乗り換え地点に必ず小さく出す。待ち0分なら発と同じ時刻になるが、
                        「何時に着いて何時に出るか」が読めるように残す */}
                    {!isFirst ? (
                      <>
                        <span className="map-arr">{prev.arrivaltime} 着</span>
                        {wait > 0 ? <span className="map-wait">待ち{wait}分</span> : null}
                      </>
                    ) : null}
                    <span className="map-t">{leg.departuretime}</span><span className="map-lbl">発</span>
                  </span>
                  {ticket.hasEstimate ? (
                    <span className="map-est">
                      {!isFirst ? (
                        <>
                          <span className="map-arr">{arrLate > 0 ? addMinutes(prev.arrivaltime, arrLate) : ""}</span>
                          {wait > 0 ? <span className="map-wait">&nbsp;</span> : null}
                        </>
                      ) : null}
                      {depLate > 0 ? <span className="map-t">{addMinutes(leg.departuretime, depLate)}</span> : null}
                    </span>
                  ) : null}
                </div>

                <div className="map-leg">
                  <span className={`mode mode--line is-${modeOf(leg.type)}${Number(leg.delay) > 0 ? " is-delayed" : ""}`}
                        aria-hidden="true" />
                  <div className="map-leg-text">
                    <p className="map-leg-title">
                      {{ walk: "徒歩", sharecycle: "シェアサイクル", bus: "バス", train: "電車" }[leg.type]}
                      {Number(leg.time) > 0 ? ` ${leg.time}分` : ""}
                    </p>
                    {leg.type === "bus" || leg.type === "train" ? (
                      <p className="map-leg-sub">
                        {rideDetail(leg)}
                        {leg.destination ? `　${leg.destination}ゆき` : ""}
                      </p>
                    ) : null}
                    {Number(leg.delay) > 0 ? <p className="map-leg-delay">遅れ {leg.delay}分</p> : null}
                    {Number(leg.fare) > 0 ? (
                      <p className="map-leg-fare">
                        {leg.type === "sharecycle" ? "料金" : "運賃"}{" "}
                        <span data-fare-ic={leg.fare} data-fare-cash={leg.fareCash ?? leg.fare}>{leg.fare}円</span>
                        {/* 車種・会員種別までは当てられないので、どの料金で出したかを書く（#47）*/}
                        {leg.farePlan ? (
                          <span className="fare-plan">
                            {`${operatorShortName(leg.farePlan.operator)}の${leg.farePlan.label}`}
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                </div>

                {j === steps.length - 1 ? (
                  <div className="map-point is-goal">
                    <span className="map-dot" aria-hidden="true" />
                    <span className="map-name">
                      {leg.to}
                      {/* 最後の区間がシェアサイクルなら、終点が返却ポート */}
                      <PortChips retChip={leg.type === "sharecycle"
                        ? cycleReturnChip(leg.returnByOperator, leg.returncapacity, leg.returnCapacityUnknown)
                        : null} />
                    </span>
                    <span className="map-time">
                      <span className="map-t">{leg.arrivaltime}</span><span className="map-lbl">着</span>
                    </span>
                    {ticket.hasEstimate ? (
                      <span className="map-est">
                        {ticket.legDelays[j].arrival > 0
                          ? <span className="map-t">{addMinutes(leg.arrivaltime, ticket.legDelays[j].arrival)}</span>
                          : null}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* 問い合わせを交通事業者ではなく team301 に向ける（#122）。押すと報告の欄が開く。
            REPORT_ENABLED=false のときは出さない */}
        {reportEnabled ? (
          <button type="button" className="report-link" data-report="missed" data-report-ticket={ticket.index}>
            <span className="report-link-box">案内内容に対するお問い合わせ</span>
          </button>
        ) : null}
        <p className="ticket-issued">{issuedAt} 発行　{ticket.index}/6</p>
      </div>
    </div>
  );
}

function minutesBetween(from, to) {
  const [fh, fm] = String(from || "").split(":").map(Number);
  const [th, tm] = String(to || "").split(":").map(Number);
  if (![fh, fm, th, tm].every(Number.isFinite)) return 0;
  const a = fh * 60 + fm;
  const b = th * 60 + tm;
  return b >= a ? b - a : b + 1440 - a;
}
