/**
 * 運賃の IC ／ 現金の切り替え（#97・ADR-0003）。
 *
 * 入力画面には置かない。差が出るのは相鉄線だけ（IC 188 / 現金 190）で、
 * 2円のために入力の項目を増やすのは割に合わないため。結果画面に
 * ワンタップのボタンを1つ置き、画面に出ている運賃をその場で書き換える。
 *
 * サーバーには問い合わせない。EJS と React の島が、運賃を出すところに
 * data-fare-ic / data-fare-cash を書いているので、その文字を入れ替えるだけ。
 */
const KEY = "hamakokuex:fare-type";

function readChoice() {
  try {
    return localStorage.getItem(KEY) === "cash" ? "cash" : "ic";
  } catch {
    // プライベートウィンドウなどで読めないことがある。既定は IC
    return "ic";
  }
}

function saveChoice(type) {
  try {
    localStorage.setItem(KEY, type);
  } catch {
    // 保存できなくても、その場の切り替えは効く
  }
}

// 運賃を出している要素の文字を入れ替える
export function applyFareType(type, root = document) {
  for (const el of root.querySelectorAll("[data-fare-ic]")) {
    const value = type === "cash" ? el.dataset.fareCash : el.dataset.fareIc;
    if (value !== undefined) el.textContent = `${value}円`;
  }
}

export function wireFareToggle() {
  const toggle = document.getElementById("fare-toggle");
  if (!toggle) return;

  const buttons = [...toggle.querySelectorAll("[data-fare-type]")];

  const render = (type) => {
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.fareType === type));
    }
    document.documentElement.dataset.fareType = type;
    applyFareType(type);
  };

  toggle.addEventListener("click", (event) => {
    const button = event.target.closest("[data-fare-type]");
    if (!button) return;
    saveChoice(button.dataset.fareType);
    render(button.dataset.fareType);
  });

  render(readChoice());
  // 滑らせるのは最初の描画のあとから。読み込んだ瞬間に動くと目障り
  toggle.querySelector(".fare-toggle-switch")?.classList.add("is-ready");
}

export { readChoice as currentFareType };
