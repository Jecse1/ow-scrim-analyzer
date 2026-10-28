import React from "react";
import { AlertCircle, CheckCircle2, RefreshCw, RotateCcw, X } from "lucide-react";
import { useTheme } from "./ThemeContext";
import { useLanguage } from "./LanguageContext";
import { formatFailReason } from "./utils/registerFlow";

// 등록 후 업로드 결과 배너. 화면 아래 고정 — 모달을 닫고 다른 화면으로 옮겨도 닫기 전까지 남는다.
// issue: { kind: 'cancelled'|'partial'|'resolved', scrimId, scrimName, failed: [{ index, map, reason }],
//          deleted?, busy?, notify? } | null
//      | { kind: 'slow' } — 통계 요청이 504·네트워크 오류로 실패(utils/apiCache onLoadError). 다시 불러오기 버튼만 있다.
// onRetry(index, file): 실패 매치의 파일을 다시 골랐을 때(App 이 그 매치만 다시 올린다)
// onReload(): 'slow' 의 다시 불러오기 버튼(App 이 지금 화면을 다시 마운트)
const UploadIssueBanner = ({ issue, onRetry, onReload, onDismiss }) => {
  const { theme } = useTheme();
  const { t } = useLanguage();
  if (!issue) return null;

  const ok = issue.kind === "resolved";
  const slow = issue.kind === "slow";
  const accent = ok ? theme.success : issue.kind === "cancelled" ? theme.danger : theme.warning;
  const title = slow ? t.ubSlowTitle
    : issue.kind === "cancelled" ? t.ubCancelledTitle
    : issue.kind === "partial" ? t.ubPartialTitle.replace("{n}", issue.failed.length)
    : t.ubResolvedTitle;
  const Icon = ok ? CheckCircle2 : AlertCircle;

  return (
    <div role="alert" data-testid="upload-issue-banner" style={{
      position: "fixed", left: "50%", bottom: "16px", transform: "translateX(-50%)", zIndex: 1100,
      width: "min(760px, calc(100vw - 32px))", boxSizing: "border-box", padding: "14px 16px",
      background: theme.surface, color: theme.text, border: `1px solid ${accent}`, borderLeft: `4px solid ${accent}`,
      borderRadius: "12px", boxShadow: "0 12px 32px rgba(0, 0, 0, 0.35)", fontSize: "14px",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
        <Icon size={18} color={accent} style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{title}</div>
          {slow ? (
            <>
              <div style={{ fontSize: "12px", color: theme.textSub, marginTop: "6px" }}>{t.ubSlowHint}</div>
              <button onClick={onReload} style={{
                display: "inline-flex", alignItems: "center", gap: "6px", marginTop: "10px", padding: "6px 12px", borderRadius: "8px",
                border: `1px solid ${theme.borderHighlight}`, background: theme.surfaceHighlight, color: theme.text, fontSize: "13px", fontWeight: 600, cursor: "pointer",
              }}>
                <RefreshCw size={13} /> {t.ubReload}
              </button>
            </>
          ) : (
            <div style={{ fontSize: "12px", color: theme.textSub, marginTop: "2px" }}>{t.ubSession}: {issue.scrimName} ({issue.scrimId})</div>
          )}
          {issue.kind === "cancelled" && issue.deleted === false && (
            <div style={{ fontSize: "13px", color: theme.danger, marginTop: "6px" }}>{t.ubDeleteFailed}</div>
          )}
          {issue.kind === "partial" && <div style={{ fontSize: "12px", color: theme.textSub, marginTop: "6px" }}>{t.ubPartialHint}</div>}
          {ok && issue.notify && <div style={{ fontSize: "13px", marginTop: "6px" }}>{t.notifyLabel}{issue.notify}</div>}
          {!ok && !slow && issue.failed.length > 0 && (
            <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
              {issue.failed.map((f) => (
                <li key={f.index} style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <span style={{ flex: "1 1 260px", minWidth: 0 }}>
                    <b>#{f.index}{f.map ? ` ${f.map}` : ""}</b>
                    <span style={{ color: theme.textSub }}> — {formatFailReason(f.reason, t)}</span>
                  </span>
                  {issue.kind === "partial" && (
                    <label style={{
                      display: "inline-flex", alignItems: "center", gap: "6px", padding: "6px 12px", borderRadius: "8px",
                      border: `1px solid ${theme.borderHighlight}`, background: theme.surfaceHighlight, fontSize: "13px", fontWeight: 600,
                      cursor: issue.busy ? "not-allowed" : "pointer", opacity: issue.busy && issue.busy !== f.index ? 0.5 : 1,
                    }}>
                      <RotateCcw size={13} /> {issue.busy === f.index ? t.ubRetrying : t.ubRetry}
                      <input type="file" accept=".txt" disabled={!!issue.busy} style={{ display: "none" }}
                        onChange={(e) => { const file = e.target.files[0]; e.target.value = ""; if (file) onRetry(f.index, file); }} />
                    </label>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button onClick={onDismiss} disabled={!!issue.busy} aria-label={t.ubDismiss} title={t.ubDismiss}
          style={{ background: "transparent", border: "none", color: theme.textSub, cursor: "pointer", padding: 0, flexShrink: 0 }}>
          <X size={18} />
        </button>
      </div>
    </div>
  );
};

export default UploadIssueBanner;
