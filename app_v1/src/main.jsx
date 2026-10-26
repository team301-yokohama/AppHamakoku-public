// React の島の入口。EJS が置いた <div id="..."> を探して、あればそこに差し込む。
// 対象の div が無いページ（免責事項など）では何もしない。
import { createRoot } from "react-dom/client";
import DepartureTime from "./components/DepartureTime.jsx";
import Receipt from "./components/Receipt.jsx";
import TicketMachine from "./components/TicketMachine.jsx";
import Diagram from "./components/Diagram.jsx";
import ReportDialog from "./components/ReportDialog.jsx";
import { initDeparture, wireSubmit } from "./departure.js";
import { wireSearchProgress } from "./searchProgress.js";
import { wireFareToggle } from "./fareToggle.js";
import { wireOperatorSelect } from "./operatorSelect.js";

// 出発日時は申込書と券売機で1つの値を共有する。初期値は申込書の div の data-*
const departureIsland = document.getElementById("departure-time-island");
if (departureIsland) initDeparture(departureIsland.dataset);
wireSubmit();
// 検索中の表示（#60）。島ではないので、島の組み立てとは別に1回だけ繋ぐ
wireSearchProgress();
// 運賃の IC／現金の切り替え（#97）。結果画面にだけ出る
wireFareToggle();
// 利用手段（親）と交通事業者（子）の入れ子（#96）
wireOperatorSelect();

// 島の一覧。EJS 側の id と、差し込む部品の対応
const ISLANDS = [
  ["departure-time-island", DepartureTime],
  ["receipt-island", Receipt],
  // 報告の欄（#122）。ページに1つ置き、data-report のボタンで開く
  ["report-island", ReportDialog],
];

for (const [id, Component] of ISLANDS) {
  const el = document.getElementById(id);
  if (!el) continue;
  // data-* で EJS から初期値を渡せるようにしておく
  createRoot(el).render(<Component {...el.dataset} />);
}

// 券売機（入力）とダイヤ図（出力）は PC・タブレットの幅でだけ組み立てる（ADR-0024）。
// 幅が足りないときは経路申込書と案内券6枚がそのまま使われる。
const WIDE = "(min-width: 768px) and (min-height: 600px)";

function mountOnWide(id, Component, datasetKey) {
  const island = document.getElementById(id);
  if (!island) return;

  const wide = window.matchMedia(WIDE);
  let root = null;

  const sync = () => {
    if (wide.matches && !root) {
      root = createRoot(island);
      root.render(<Component {...island.dataset} />);
    } else if (!wide.matches && root) {
      root.unmount();
      root = null;
    }
    // どちらの画面を見せるかは CSS 側で切り替える
    document.documentElement.dataset[datasetKey] = wide.matches ? "wide" : "narrow";
  };

  sync();
  wide.addEventListener("change", sync);
  window.addEventListener("resize", sync);
}

mountOnWide("ticket-machine-island", TicketMachine, "input");
mountOnWide("diagram-island", Diagram, "output");
