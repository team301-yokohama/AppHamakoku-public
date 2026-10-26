/**
 * 検索中の表示。
 *
 * 検索は POST の全画面遷移で、冷えた状態では 0.5〜2.3 秒かかる。
 * その間なにも変わらないと「押せたのか」「固まったのか」が分からないので、
 * 送信した瞬間に紙を1枚かぶせて「検索中」と出す。「発券」は物理的に何かが出てくると
 * 受け取られることがあるので使わない（ADR-0032）。
 *
 * 見た目は券売機の世界観に合わせる（ADR-0011・0012）。回る丸は使わず、
 * 帯が左から右へ流れる形にした。丸い形は選択の印と番号だけに取っておく。
 */
const OVERLAY_ID = "search-progress";

export function wireSearchProgress() {
  const form = document.getElementById("main-search-form");
  const overlay = document.getElementById(OVERLAY_ID);
  if (!form || !overlay) return;

  // 送信ボタンは券売機と申込書で別にあるので、フォームの中から全部拾う
  const submitButtons = () => [...form.querySelectorAll('button[type="submit"]')];

  let submitting = false;

  const show = () => {
    submitting = true;
    overlay.hidden = false;
    document.documentElement.dataset.searching = "true";
    for (const button of submitButtons()) button.disabled = true;
  };

  const hide = () => {
    submitting = false;
    overlay.hidden = true;
    delete document.documentElement.dataset.searching;
    for (const button of submitButtons()) button.disabled = false;
  };

  form.addEventListener("submit", (event) => {
    // 連打で同じ検索が何本も飛ばないようにする
    if (submitting) {
      event.preventDefault();
      return;
    }
    show();
  });

  // 戻るボタンで戻ってきたとき（bfcache）に、かぶせたままにしない
  window.addEventListener("pageshow", (event) => {
    if (event.persisted || submitting) hide();
  });
}
