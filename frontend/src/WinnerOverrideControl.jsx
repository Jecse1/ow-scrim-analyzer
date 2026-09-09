// src/WinnerOverrideControl.jsx
// 사후 승패 보정 컨트롤 — 매치 상세 헤더·세션 매치 목록에서 공용.
// 노출 조건: 유효 승자가 무승부(Draw)이거나 이미 수기 보정된 매치에만 표시한다.
//   (명확한 자동 승패 매치에는 노출하지 않음 — 오조작 방지)
// 동작: [team1][team2][해제] 인라인 선택 → PATCH /api/matches/{id}/winner-override →
//   공유 API 캐시 무효화 + onChanged(newWo)로 부모 상태 갱신. 라벨·색은 ScrimModal 보정 UI와 동일.
import React, { useState } from "react";
import axios from "axios";
import { Trophy, AlertCircle } from "lucide-react";
import { invalidateApiCache } from "./utils/apiCache";
import { useTheme } from "./ThemeContext";
import { useLanguage } from "./LanguageContext";

export default function WinnerOverrideControl({ match, onChanged }) {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const t1 = match?.team1_name || match?.team_1_name || "";
  const t2 = match?.team2_name || match?.team_2_name || "";
  const teams = [t1, t2].filter(Boolean);
  const wo = (match?.winner_override || "").trim();
  const eff = (match?.winner || "").trim();
  const isOverridden = !!wo;
  // 유효 승자가 팀명이 아니면(빈값/Draw/미상) 무승부로 간주.
  const isDraw = !eff || eff === "Draw" || !teams.includes(eff);
  if (!isDraw && !isOverridden) return null;

  const patch = async (value) => {
    setSaving(true); setErr("");
    try {
      const res = await axios.patch(
        `/api/matches/${encodeURIComponent(match.id)}/winner-override`,
        { winner_override: value }   // "" = 해제
      );
      invalidateApiCache();          // 밀기맵 보정과 동일: 공유 캐시 무효화
      onChanged?.(res?.data?.winner_override || "");
      setEditing(false);
    } catch (e) {
      setErr(e?.response?.data?.detail || e?.message || t.woSaveFail);
    } finally {
      setSaving(false);
    }
  };

  const badgeColor = isOverridden ? (theme.success || "#22c55e") : (theme.warning || "#f59e0b");
  const badgeText = isOverridden ? `${t.woBadgeOverridden}: ${wo}` : t.woBadgeDraw;

  return (
    <div onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 800, color: badgeColor, background: `${badgeColor}20`, border: `1px solid ${badgeColor}55`, padding: "2px 8px", borderRadius: 999 }}>
          <Trophy size={12} /> {badgeText}
        </span>
        <button
          onClick={() => setEditing((v) => !v)}
          disabled={saving}
          style={{ fontSize: 11, fontWeight: 800, color: theme.text, background: theme.surfaceHighlight, border: `1px solid ${theme.borderHighlight}`, borderRadius: 8, padding: "3px 10px", cursor: saving ? "wait" : "pointer" }}
        >
          {t.woPick}
        </button>
      </div>

      {editing && (
        <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {/* 좌우 순서 = team1, team2, 해제 — ScrimModal 보정 UI와 동일 규칙 */}
          {[[t1, `${t1} ${t.woWinSuffix}`], [t2, `${t2} ${t.woWinSuffix}`], ["", t.woNone]].map(([val, label], i) => {
            const active = wo === val || (val === "" && !wo);
            const warn = val !== "";
            return (
              <button
                key={i}
                onClick={() => patch(val)}
                disabled={saving}
                style={{ padding: "4px 12px", borderRadius: 8, border: "1px solid", cursor: saving ? "wait" : "pointer", fontSize: 12, fontWeight: 800,
                  background: active ? (warn ? theme.warning : theme.surface) : "transparent",
                  color: active ? (warn ? "#000" : theme.text) : theme.textSub,
                  borderColor: active ? (warn ? theme.warning : theme.text) : theme.borderHighlight }}
              >
                {label}
              </button>
            );
          })}
          {saving && <span style={{ fontSize: 11, color: theme.textSub }}>{t.woSaving}</span>}
        </div>
      )}

      {err && (
        <span style={{ fontSize: 11, color: theme.danger || "#ef4444" }}>
          <AlertCircle size={11} style={{ verticalAlign: "-2px" }} /> {err}
        </span>
      )}
    </div>
  );
}
