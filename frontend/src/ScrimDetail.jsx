// src/ScrimDetail.jsx
import React, { useEffect, useState } from "react";
import axios from "axios";
import { invalidateApiCache } from "./utils/apiCache";
import { ChevronLeft, BarChart3, Trash2 } from "lucide-react";
import { useTheme } from "./ThemeContext";
import { useLanguage } from "./LanguageContext";
import WinnerOverrideControl from "./WinnerOverrideControl";

const API_BASE = import.meta.env.PROD ? "" : "";

export default function ScrimDetail({ scrimId, onSelectMatch, onBack, onGoOverall }) {
  const { theme } = useTheme();
  const { t } = useLanguage();

  const [scrim, setScrim] = useState(null);
  const [scrimLoading, setScrimLoading] = useState(true);
  const [scrimErr, setScrimErr] = useState("");

  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deleting, setDeleting] = useState(false);

  const fetchScrim = async () => {
    setScrimLoading(true);
    setScrimErr("");
    setScrim(null);
    try {
      const res = await axios.get(`${API_BASE}/api/scrims/${encodeURIComponent(scrimId)}`);
      setScrim(res.data);
    } catch (e) {
      setScrimErr(e?.message || String(e));
    } finally {
      setScrimLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    async function load() {
      setScrimLoading(true);
      setScrimErr("");
      setScrim(null);
      try {
        const res = await axios.get(`${API_BASE}/api/scrims/${encodeURIComponent(scrimId)}`);
        if (!alive) return;
        setScrim(res.data);
      } catch (e) {
        if (!alive) return;
        setScrimErr(e?.message || String(e));
      } finally {
        if (!alive) return;
        setScrimLoading(false);
      }
    }
    if (scrimId) load();
    return () => { alive = false; };
  }, [scrimId]);

  const enterSelectMode = () => { setIsSelectMode(true); setSelectedIds(new Set()); };
  const exitSelectMode = () => { setIsSelectMode(false); setSelectedIds(new Set()); };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const matches = scrim?.matches || [];
    if (selectedIds.size === matches.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(matches.map(m => m.id)));
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    const msg = `${t.deleteConfirmPre}${ids.length}${t.sdDeleteMatchPost}\n${t.sdIrreversible}`;
    if (!window.confirm(msg)) return;

    setDeleting(true);
    try {
      const res = await axios.post('/api/matches/delete-batch', { ids });
      invalidateApiCache(); // 매치 삭제 성공 → 공유 캐시 무효화
      if (res.data.warnings?.length > 0) {
        alert(`${t.sdDeleteDone} (${res.data.deleted_count}${t.msCountUnit})\n${t.sdWarnings}\n${res.data.warnings.join('\n')}`);
      }
      if (res.data.failed_ids?.length > 0) {
        alert(`${t.sdPartialFail}${res.data.failed_ids.join(', ')}`);
      }
      await fetchScrim();
      exitSelectMode();
    } catch (err) {
      alert(`${t.sdDeleteFail}${err.response?.data?.detail || err.message}`);
    } finally {
      setDeleting(false);
    }
  };

  if (scrimLoading) {
    return (
      <div style={{ padding: 40, maxWidth: 1200, margin: "0 auto", color: theme.text }}>
        {t.loading}
      </div>
    );
  }

  if (!scrim) {
    return (
      <div style={{ padding: 40, maxWidth: 1200, margin: "0 auto", color: theme.text }}>
        <div style={{ color: theme.danger, fontWeight: 800 }}>{t.noData}</div>
        <div style={{ color: theme.textSub, marginTop: 8, fontSize: 13 }}>{scrimErr}</div>
        <button
          onClick={onBack}
          style={{ marginTop: 14, background: theme.surfaceHighlight, border: `1px solid ${theme.borderHighlight}`, color: theme.text, padding: "10px 14px", borderRadius: 10, cursor: "pointer", fontWeight: 800 }}
        >
          {t.back}
        </button>
      </div>
    );
  }

  const matches = scrim.matches || [];
  const allSelected = matches.length > 0 && selectedIds.size === matches.length;

  return (
    <div style={{ padding: "40px", maxWidth: 1200, margin: "0 auto", color: theme.text }}>
      {/* 헤더 */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button
            onClick={onBack}
            style={{ background: theme.surface, border: `1px solid ${theme.border}`, color: theme.text, borderRadius: 10, padding: "10px 12px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            <ChevronLeft size={16} /> {t.backToList}
          </button>
          <div>
            <div style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>{scrim.scrim_name}</div>
            <div style={{ color: theme.textSub, fontSize: 13 }}>
              {scrim.date} · {scrim.start_time} ~ {scrim.end_time} · {t.matchCount.replace('{n}', matches.length)}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {isSelectMode ? (
            <button
              onClick={exitSelectMode}
              style={{ background: theme.surface, border: `1px solid ${theme.border}`, color: theme.textSub, padding: "10px 14px", borderRadius: 10, cursor: "pointer", fontWeight: 800, display: "inline-flex", gap: 8, alignItems: "center" }}
            >
              {t.cancelSelection}
            </button>
          ) : (
            <>
              <button
                onClick={enterSelectMode}
                style={{ background: theme.surface, border: `1px solid ${theme.border}`, color: theme.danger || '#ef4444', padding: "10px 14px", borderRadius: 10, cursor: "pointer", fontWeight: 800, display: "inline-flex", gap: 8, alignItems: "center" }}
              >
                <Trash2 size={15} /> {t.delete}
              </button>
              {onGoOverall && (
                <button
                  onClick={onGoOverall}
                  style={{ background: theme.surfaceHighlight, border: `1px solid ${theme.borderHighlight}`, color: theme.text, padding: "10px 14px", borderRadius: 10, cursor: "pointer", fontWeight: 800, display: "inline-flex", gap: 8, alignItems: "center" }}
                >
                  <BarChart3 size={16} /> {t.overall}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div style={{ height: 24 }} />

      {/* 매치 목록 */}
      <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 14, padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 900 }}>{t.sdMatchList}</div>

          {/* 선택 모드 액션 바 */}
          {isSelectMode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '13px', color: theme.textSub }}>{selectedIds.size}{t.msCountUnit} {t.selectedCount}</span>
              <button
                onClick={toggleSelectAll}
                style={{ background: 'transparent', border: `1px solid ${theme.border}`, color: theme.textSub, padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}
              >
                {allSelected ? t.deselectAll : t.selectAll}
              </button>
              <button
                onClick={handleDeleteSelected}
                disabled={selectedIds.size === 0 || deleting}
                style={{ background: selectedIds.size > 0 ? (theme.danger || '#ef4444') : theme.surfaceHighlight, border: 'none', color: selectedIds.size > 0 ? '#fff' : theme.textSub, padding: '5px 14px', borderRadius: '6px', cursor: selectedIds.size > 0 ? 'pointer' : 'not-allowed', fontSize: '12px', fontWeight: '700', opacity: deleting ? 0.6 : 1 }}
              >
                {deleting ? t.deleting : t.deleteSelected}
              </button>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {matches.map((m) => {
            const isChecked = selectedIds.has(m.id);
            return (
              <div
                key={m.id}
                onClick={() => isSelectMode ? toggleSelect(m.id) : onSelectMatch?.(m.id)}
                style={{
                  border: `1px solid ${isChecked ? (theme.danger || '#ef4444') : theme.border}`,
                  background: isChecked ? `${theme.danger || '#ef4444'}12` : theme.bg,
                  borderRadius: 12, padding: 14,
                  display: "flex", justifyContent: "space-between", gap: 12,
                  cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {isSelectMode && (
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSelect(m.id)}
                      onClick={e => e.stopPropagation()}
                      style={{ width: '16px', height: '16px', accentColor: theme.danger || '#ef4444', cursor: 'pointer', flexShrink: 0 }}
                    />
                  )}
                  <div>
                    <div style={{ fontWeight: 900, marginBottom: 6 }}>#{m.match_index} · {m.map_name}</div>
                    <div style={{ color: theme.textSub, fontSize: 13, marginBottom: 6 }}>{t.sdResult}: {m.result || t.sdUnknown}</div>
                    {!isSelectMode && <WinnerOverrideControl match={m} onChanged={() => fetchScrim()} />}
                  </div>
                </div>

                {!isSelectMode && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button
                      onClick={e => { e.stopPropagation(); onSelectMatch?.(m.id); }}
                      style={{ background: theme.text, border: "none", color: theme.bg, padding: "8px 10px", borderRadius: 10, cursor: "pointer", fontWeight: 900, fontSize: 12 }}
                    >
                      {t.sdAnalyze}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {scrimErr && (
          <div style={{ marginTop: 12, color: theme.danger, fontSize: 13 }}>{scrimErr}</div>
        )}
      </div>
    </div>
  );
}
