import { useEffect, useRef, useState } from "react";
import { REPORT_HONEYPOT, REPORT_LIMITS, reportKindsFor } from "../../config/report.js";
import { reportConditionText, reportRouteText } from "../../shared/ticketView.js";

// 「間に合わなかった・おかしいと思ったら報告」の欄（#122・ADR-0010）。
// 問い合わせを交通事業者ではなく team301 に向けるための受け口。
//
// ページに1つだけ置き、data-report を持つボタン（案内券・ダイヤ図の詳細・0件の欄・
// フッター）が押されたら開く。ボタンは EJS と React の島の両方にあるので、
// クリックは document でまとめて拾う。
// 押された案内券の経路と検索条件を自動で入れ、利用者が説明を書かなくても
// こちらで再現できるようにする。

// EJS が埋めた JSON を読む。無いページ（結果を出す前など）では空
function readJson(id, fallback) {
  const element = document.getElementById(id);
  if (!element) return fallback;
  try {
    return JSON.parse(element.textContent);
  } catch {
    return fallback;
  }
}

// はまこく Exp. で出す選択肢だけ（マップ用は出さない、#204）
const EXP_KINDS = reportKindsFor("exp");
const KIND_VALUES = EXP_KINDS.map((k) => k.value);

export default function ReportDialog({ base = "" }) {
  const dialogRef = useRef(null);
  const [kind, setKind] = useState("missed");
  const [message, setMessage] = useState("");
  const [route, setRoute] = useState("");
  const [conditions, setConditions] = useState("");
  const [trap, setTrap] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | done | error
  const [error, setError] = useState("");

  useEffect(() => {
    const open = (nextKind, ticketIndex) => {
      const context = readJson("report-context", null);
      const routes = readJson("route-data", []);
      const picked = ticketIndex ? routes.find((r) => String(r.index) === String(ticketIndex)) : null;

      setKind(KIND_VALUES.includes(nextKind) ? nextKind : "other");
      setRoute(picked ? reportRouteText(picked) : "");
      setConditions(context ? reportConditionText(context) : "");
      setMessage("");
      setStatus("idle");
      setError("");
      dialogRef.current?.showModal();
    };

    const onClick = (event) => {
      const trigger = event.target.closest?.("[data-report]");
      if (!trigger) return;
      event.preventDefault();
      open(trigger.dataset.report, trigger.dataset.reportTicket);
    };

    document.addEventListener("click", onClick);
    // フッターや免責事項のページから「#report」付きで来たら開く
    if (window.location.hash === "#report") open("other");
    return () => document.removeEventListener("click", onClick);
  }, []);

  const close = () => dialogRef.current?.close();

  const submit = async (event) => {
    event.preventDefault();
    setStatus("sending");
    setError("");
    try {
      const res = await fetch(`${base}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          message,
          route,
          conditions,
          page: window.location.pathname,
          [REPORT_HONEYPOT]: trap,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "送信に失敗しました。時間をおいて再度お試しください。");
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setError(err.message);
    }
  };

  // 経路も条件も無いときは、何があったかを書いてもらう
  const needsMessage = !route && !conditions;

  return (
    <dialog ref={dialogRef} className="report-dialog" aria-labelledby="report-title">
      <div className="report-head">
        <h2 className="report-title" id="report-title">team301 に報告する</h2>
        <button type="button" className="report-close" onClick={close} aria-label="閉じる">×</button>
      </div>

      {status === "done" ? (
        <div className="report-body">
          <p className="report-done">受け付けました。ご協力ありがとうございます。</p>
          <p className="note">いただいた報告は、案内の見直しに使用します。交通事業者へのお問い合わせはご遠慮ください。</p>
          <button type="button" className="report-submit" onClick={close}>閉じる</button>
        </div>
      ) : (
        <form className="report-body" onSubmit={submit}>
          <p className="report-lead">
            表示時刻は目安です。案内どおりに移動して乗り換えに間に合わなかった場合や、案内内容に誤りがあると思われる場合は、
            <strong>交通事業者ではなく team301 へ</strong>お知らせください。
          </p>

          <label className="report-field">
            <span className="report-label">報告の種類</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {EXP_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </label>

          <label className="report-field">
            <span className="report-label">詳細{needsMessage ? "" : "（任意）"}</span>
            <textarea rows={4} maxLength={REPORT_LIMITS.message} value={message}
                      required={needsMessage}
                      placeholder="例: 国大南門で待っていたが、案内された 14:39 のバスが来なかった"
                      onChange={(e) => setMessage(e.target.value)} />
          </label>

          {route || conditions ? (
            <details className="report-auto">
              <summary>自動で送られる内容</summary>
              <pre>{[conditions, route].filter(Boolean).join("\n")}</pre>
            </details>
          ) : null}

          {/* 人には見えない罠の欄。機械が埋めたら受け付けたふりをして捨てる */}
          <div className="report-trap" aria-hidden="true">
            <label>
              ウェブサイト
              <input type="text" name={REPORT_HONEYPOT} tabIndex={-1} autoComplete="off"
                     value={trap} onChange={(e) => setTrap(e.target.value)} />
            </label>
          </div>

          {/* 集める時点で、何を・何のために・どこに置くかを伝える（#122）*/}
          <p className="note">
            氏名・学籍番号・連絡先などの個人情報は記入しないでください。送信内容は案内の改善にのみ使用し、
            team301 が管理する Google フォームの回答シートに保存します（閲覧は team301 のみ）。
            返信を希望される場合は、免責事項ページ記載のメールアドレスへご連絡ください。
          </p>

          {status === "error" ? <p className="report-error" role="alert">{error}</p> : null}

          <div className="report-actions">
            <button type="button" className="report-cancel" onClick={close}>キャンセル</button>
            <button type="submit" className="report-submit" disabled={status === "sending"}>
              {status === "sending" ? "送信中…" : "送信"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
