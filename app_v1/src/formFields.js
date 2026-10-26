// 券売機は、経路申込書と同じ input を動かす。
// 送信する値は EJS が置いた input が持っているので、券売機は別の入力欄を作らず
// こちらを読み書きする。幅が変わって申込書に戻っても、選んだ内容がそのまま残る。
function form() {
  return document.getElementById("main-search-form");
}

function inputs(name) {
  const element = form();
  return element ? [...element.querySelectorAll(`input[name="${name}"]`)] : [];
}

export function readRadio(name) {
  return inputs(name).find((input) => input.checked)?.value ?? null;
}

export function readChecks(name) {
  return inputs(name).filter((input) => input.checked).map((input) => input.value);
}

// 無効にされている値（#96 の事業者は、その手段を外すと無効になる）
export function readDisabled(name) {
  return inputs(name).filter((input) => input.disabled).map((input) => input.value);
}

// change を自分で起こす。控（Receipt）はフォームの change を見ているため
function fire(input) {
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export function setRadio(name, value) {
  for (const input of inputs(name)) {
    const next = input.value === value;
    if (input.checked !== next) {
      input.checked = next;
      if (next) fire(input);
    }
  }
}

export function toggleCheck(name, value) {
  const input = inputs(name).find((candidate) => candidate.value === value);
  if (!input) return;
  input.checked = !input.checked;
  fire(input);
}

// フォームの change を購読する（券売機の表示を合わせるため）
export function subscribeForm(listener) {
  const element = form();
  if (!element) return () => {};
  element.addEventListener("change", listener);
  return () => element.removeEventListener("change", listener);
}
