import { useEffect, useState } from "react";
import { publish, read, subscribe } from "./formState.js";

// 出発日時の持ち主。
// 経路申込書（DepartureTime）と券売機（TicketMachine）は同じ画面の別の島で、
// どちらも同じ出発日時を触る。React の context は島をまたげないので、
// 値は formState の入れ物に1つだけ置き、両方がそれを読み書きする。
const KEY = "departureTime";

export const pad = (n) => String(n).padStart(2, "0");

export function getDeparture() {
  return read(KEY) ?? { mode: "relative", offset: 0, date: "", time: "" };
}

export function setDeparture(patch) {
  publish(KEY, { ...getDeparture(), ...patch });
}

/**
 * 箱への打ち込み以外から日時を入れ替える（「〇限終わり」ボタンなど、#164）。
 *
 * 日時の箱（DateBoxes）は defaultValue で描いているので、値を変えただけでは
 * 表示中の数字が変わらない。revision を進め、箱を key で描き直させる。
 * 打ち込みのたびに描き直すとカーソルが外れるので、setDeparture では進めない
 */
export function replaceDeparture(patch) {
  const current = getDeparture();
  publish(KEY, { ...current, ...patch, revision: (current.revision ?? 0) + 1 });
}

// EJS の data-* を初期値にする。島が複数あっても最初の1回だけ効かせる
export function initDeparture({ mode, date, time }) {
  if (read(KEY) !== undefined) return;
  publish(KEY, {
    mode: mode === "absolute" ? "absolute" : "relative",
    offset: 0,
    date: date ?? "",
    time: time ?? "",
  });
}

export function useDeparture() {
  const [value, setValue] = useState(getDeparture);

  useEffect(() => subscribe((key, next) => {
    if (key === KEY) setValue(next);
  }), []);

  return value;
}

/**
 * 送信時に hidden（departure_date / departure_time）を書く。
 *
 * 島ではなく main.jsx から1回だけ呼ぶ。描かれている島が申込書か券売機かに
 * よらず、送信の経路を1つにしておくため。
 *
 * 「〇分後」は押した瞬間からの相対時刻なので、描画時ではなく送信時に計算する
 * （描画時に入れると、利用者が迷っている間に古くなる）。
 */
export function wireSubmit() {
  const form = document.getElementById("main-search-form");
  if (!form) return;

  form.addEventListener("submit", () => {
    const { mode, offset, date, time } = getDeparture();
    const hiddenDate = document.getElementById("hidden-date");
    const hiddenTime = document.getElementById("hidden-time");
    if (!hiddenDate || !hiddenTime) return;

    if (mode === "relative") {
      const at = new Date();
      at.setMinutes(at.getMinutes() + offset);
      hiddenDate.value = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
      hiddenTime.value = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
    } else {
      hiddenDate.value = date;
      hiddenTime.value = time;
    }
  });
}
