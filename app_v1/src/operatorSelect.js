// 利用手段（親）と交通事業者（子）の入れ子を動かす（#96・ADR-0029）。
//
// 親と子の関係はこう決める。
// - 親がオフ → その手段の子は無効（送信されない）。チェックの状態は消さないので、
//   手段を戻せば前に選んだ事業者がそのまま戻る
// - 親を1つも選んでいない → 全ルート扱い（ADR-0001）なので、子は全部有効。
//   「全部の手段から、神奈中だけ外す」を選べるようにするため
// - 親がオンで子が一部だけオフ → 親に半端な印（CSS の :indeterminate）を出す
// - 子を全部オフにした → その手段は使えないので親もオフにする
// - 親をオンにしたとき子が全部オフ → 子を全部オンに戻す（オンにした意味が無くなるため）
//
// 選んだ内容は localStorage に覚える。定期は毎学期変わらないので、毎回選び直すのは手間。
// 覚えるのは「オフにした事業者」だけにする。「オンの一覧」を覚えると、
// 事業者が増えたとき（#47 のドコモ）に既存の利用者だけ勝手にオフになる。

const STORAGE_KEY = "hamakokuex:operators-off";
const MODES = ["bus", "train", "cycle"];

function parentOf(mode) {
  return document.getElementById(`check-${mode}`);
}

function childrenOf(mode) {
  return [...document.querySelectorAll(`input[name="operators"][data-mode="${mode}"]`)];
}

function allOperators() {
  return [...document.querySelectorAll('input[name="operators"][data-mode]')];
}

// オフにした事業者を覚える。書けない環境（プライベートウィンドウなど）では黙って諦める
function save() {
  try {
    const off = allOperators().filter((input) => !input.checked).map((input) => input.value);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(off));
  } catch (e) {
    // 覚えられなくても検索はできる
  }
}

// 親の状態から、子の有効・無効と親の半端な印を決め直す。
// 変更のたびに全部を引き直すので、どの順に押されても結果が同じになる
function sync() {
  // 「徒歩のみ」も手段を選んだ状態に数える。数えないと、徒歩のみを選んだときに
  // 「1つも選んでいない＝全ルート」と見なされ、事業者が有効に戻ってしまう
  const anyParentOn = MODES.some((mode) => parentOf(mode)?.checked)
    || document.getElementById("check-walk")?.checked === true;

  for (const mode of MODES) {
    const parent = parentOf(mode);
    const children = childrenOf(mode);
    if (!parent || children.length === 0) continue;

    // 手段を1つも選んでいないときは全ルート扱いなので、子は全部有効にする
    const enabled = anyParentOn ? parent.checked : true;
    for (const child of children) child.disabled = !enabled;

    const on = children.filter((child) => child.checked).length;
    parent.indeterminate = parent.checked && on > 0 && on < children.length;
  }

  // 券売機（React）はフォームの change を見て表示を合わせている。
  // disabled を立てても change は起きないので、ここで知らせる。
  // 聞いているのは控と券売機だけで、この関数を呼び返すものは無い
  document.getElementById("main-search-form")
    ?.dispatchEvent(new Event("change", { bubbles: true }));
}

export function wireOperatorSelect() {
  if (MODES.every((mode) => !parentOf(mode))) return;

  for (const mode of MODES) {
    const parent = parentOf(mode);
    if (!parent) continue;
    parent.addEventListener("change", () => {
      // オンにしたのに1社も選ばれていないと、その手段の経路が出ない。全部オンに戻す
      const children = childrenOf(mode);
      if (parent.checked && children.every((child) => !child.checked)) {
        for (const child of children) child.checked = true;
        save();
      }
      sync();
    });
  }

  for (const child of allOperators()) {
    child.addEventListener("change", () => {
      const mode = child.dataset.mode;
      const parent = parentOf(mode);
      // 1社も残っていなければ、その手段は使えないので親も外す
      if (parent && childrenOf(mode).every((sibling) => !sibling.checked)) parent.checked = false;
      save();
      sync();
    });
  }

  // 「徒歩のみ」は他の手段のチェックを JS で外す。change は起きないので、
  // クリックのあとに引き直す（views/index.ejs の素のDOM操作と順番が前後しないよう遅らせる）
  const walkOnly = document.getElementById("check-walk");
  if (walkOnly) {
    walkOnly.addEventListener("change", () => setTimeout(() => {
      // 徒歩のみを外したら、ほかの手段をつけ直す。空のままでも「未選択＝全ルート」で
      // 結果は同じだが、何も選んでいないように見えるうえ、初回の表示とも食い違う。
      // 自分で1つずつ外した場合は戻さない（全手段から1社だけ外す選び方を残すため）
      if (!walkOnly.checked && MODES.every((mode) => !parentOf(mode)?.checked)) {
        for (const mode of MODES) {
          const parent = parentOf(mode);
          if (parent) parent.checked = true;
        }
      }
      sync();
    }, 0));
  }

  sync();
}
