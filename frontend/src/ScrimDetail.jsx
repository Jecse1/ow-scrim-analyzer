// src/ScrimDetail.jsx
import React, { useEffect, useState } from "react";
import axios from "axios";
import { invalidateApiCache } from "./utils/apiCache";
import { ChevronLeft, BarChart3, Trash2, Pencil, Upload } from "lucide-react";
import { useTheme } from "./ThemeContext";
import { useLanguage } from "./LanguageContext";
import { getMapDisplayName } from "./gameData";
import { BASE_TEAM } from "./config";
import WinnerOverrideControl from "./WinnerOverrideControl";

const API_BASE = import.meta.env.PROD ? "" : "";

// "MM:SS"/"HH:MM:SS" → 초 (빈값/불가 = null), 초 → "MM:SS"
const mmssToSec = (s) => {
  const parts = String(s || "").trim().split(":").map(Number);
  if (parts.length < 2 || parts.some(isNaN)) return null;
  return parts.reduce((acc, v) => acc * 60 + v, 0);
};
const secToMmss = (v) => {
  if (v == null || isNaN(Number(v))) return "";
  const n = Math.max(0, Math.floor(Number(v)));
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
};

export default function ScrimDetail({ scrimId, onSelectMatch, onBack, onGoOverall }) {
  const { theme } = useTheme();
  const { t } = useLanguage();

  const [scrim, setScrim] = useState(null);
  const [scrimLoading, setScrimLoading] = useState(true);
  const [scrimErr, setScrimErr] = useState("");

  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deleting, setDeleting] = useState(false);

  // 세션 편집 패널 상태
  const [editSession, setEditSession] = useState(null); // null=닫힘, {scrimName,date,renameFrom,renameTo}
  // 매치 인라인 편집 상태: {id, map_name, video_url, offsetStr, startStr, endStr, winner, score_t1, score_t2, match_index}
  const [editMatch, setEditMatch] = useState(null);
  const [busy, setBusy] = useState(false);
  // 라운드별 VOD 보정 편집 상태(로그 매치 전용) — 편집 폼 열릴 때 /api/matches/{id}에서 로드
  // { matchId, drift, videoOffset, gameSetupSec, pauses, perTransStr,
  //   rows: [{round_number, valueStr(''=자동), auto, ref:{desc,ts}|null, refStr}] } | { matchId, error }
  const [deltaInfo, setDeltaInfo] = useState(null);

  useEffect(() => {
    if (!editMatch?.id || editMatch.source === "manual") { setDeltaInfo(null); return; }
    let alive = true;
    setDeltaInfo(null);
    axios.get(`${API_BASE}/api/matches/${editMatch.id}`).then(res => {
      if (!alive) return;
      const md = res.data || {};
      const drift = md.round_transition_drift_sec || 0;
      const rows = (md.rounds || []).map(r => {
        const evs = r.events || [];
        const refEv = evs.find(e => e.event_type === "kill") || evs.find(e => e.event_type === "ultimate_start") || null;
        return {
          round_number: r.round_number,
          valueStr: r.video_delta_sec == null ? "" : String(r.video_delta_sec),
          auto: drift * (r.round_number - 1),
          ref: refEv ? {
            desc: refEv.event_type === "kill"
              ? `${refEv.player_name} ➜ ${refEv.target_name}`
              : `${refEv.player_name} (ult)`,
            ts: refEv.timestamp,
          } : null,
          refStr: "",
        };
      });
      setDeltaInfo({
        matchId: editMatch.id, drift, rows, perTransStr: String(drift),
        videoOffset: md.video_offset || 0, gameSetupSec: md.game_setup_sec, pauses: md.pauses || [],
      });
    }).catch(() => { if (alive) setDeltaInfo({ matchId: editMatch.id, error: true }); });
    return () => { alive = false; };
  }, [editMatch?.id, editMatch?.source]);

  const updDeltaRow = (rn, patch) => setDeltaInfo(di => ({
    ...di, rows: di.rows.map(row => row.round_number === rn ? { ...row, ...patch } : row),
  }));

  // 기준 장면 역산: delta = 입력 영상 시각 − (offset + (ts − gss)) − (입력 시각 이전 pause 합)
  const calcDeltaFromRef = (row) => {
    const videoSec = mmssToSec(row.refStr);
    if (videoSec == null || !row.ref) return;
    const di = deltaInfo;
    const base = di.gameSetupSec != null
      ? di.videoOffset + (row.ref.ts - di.gameSetupSec)
      : di.videoOffset + row.ref.ts;
    const pauseBefore = (di.pauses || [])
      .filter(p => p.start_sec <= videoSec)
      .reduce((a, p) => a + (p.end_sec - p.start_sec), 0);
    updDeltaRow(row.round_number, { valueStr: String(Math.round(videoSec - base - pauseBefore)) });
  };

  const saveSession = async () => {
    setBusy(true);
    try {
      const body = { scrimName: editSession.scrimName, date: editSession.date };
      if (editSession.renameFrom && editSession.renameTo && editSession.renameFrom !== editSession.renameTo) {
        body.teamRenameFrom = editSession.renameFrom;
        body.teamRenameTo = editSession.renameTo;
      }
      await axios.patch(`${API_BASE}/api/sessions/${encodeURIComponent(scrimId)}`, body);
      invalidateApiCache();
      setEditSession(null);
      await fetchScrim();
    } catch (err) {
      alert(t.sdEditFail + (err.response?.data?.detail || err.message));
    } finally { setBusy(false); }
  };

  const saveMatch = async () => {
    setBusy(true);
    try {
      const em = editMatch;
      const body = {
        map_name: em.map_name,
        video_url: em.video_url,
        match_index: Number(em.match_index) || undefined,
      };
      if (em.source === "manual") {
        body.winner = em.winner || "";
        body.score_t1 = Number(em.score_t1) || 0;
        body.score_t2 = Number(em.score_t2) || 0;
        const vs = mmssToSec(em.startStr); if (vs != null) body.videoStartSec = vs;
        const ve = mmssToSec(em.endStr); if (ve != null) body.videoEndSec = ve;
      } else {
        const off = mmssToSec(em.offsetStr); if (off != null) body.video_offset = off;
        // 라운드별 VOD 보정 — 빈 입력('') = null(자동으로 되돌림)
        if (deltaInfo && deltaInfo.matchId === em.id && !deltaInfo.error) {
          body.roundsDelta = deltaInfo.rows.map(r => ({
            round_number: r.round_number,
            video_delta_sec: r.valueStr.trim() === "" ? null : (Number(r.valueStr) || 0),
          }));
        }
      }
      await axios.patch(`${API_BASE}/api/matches/${em.id}`, body);
      invalidateApiCache();
      setEditMatch(null);
      await fetchScrim();
    } catch (err) {
      alert(t.sdEditFail + (err.response?.data?.detail || err.message));
    } finally { setBusy(false); }
  };

  // 로그 추가/교체: 경고 → dry_run 파싱 → (수기값과 차이 시) 채택 선택 → 실제 업로드
  const uploadLog = async (m, file) => {
    if (!file) return;
    if (!window.confirm(t.sdReplaceWarn)) return;
    setBusy(true);
    try {
      const fd = (extra = {}) => {
        const f = new FormData();
        f.append("scrim_id", scrimId);
        f.append("match_index", m.match_index);
        f.append("file", file);
        Object.entries(extra).forEach(([k, v]) => f.append(k, v));
        return f;
      };
      let adopt = "parsed";
      if (m.source === "manual") {
        const dry = await axios.post(`${API_BASE}/api/matches/upload`, fd({ dry_run: "1" }));
        const diff = dry.data?.diff || {};
        if (Object.keys(diff).length > 0) {
          const lines = Object.entries(diff).map(([k, v]) => `- ${k}: ${v.manual} → ${v.parsed}`).join("\n");
          adopt = window.confirm(`${t.sdDiffTitle}\n${lines}\n\n${t.sdDiffAdopt}`) ? "parsed" : "keep";
        }
      }
      await axios.post(`${API_BASE}/api/matches/upload`, fd({ adopt }));
      invalidateApiCache();
      alert(t.sdUploadDone);
      await fetchScrim();
    } catch (err) {
      alert(t.sdEditFail + (err.response?.data?.detail || err.message));
    } finally { setBusy(false); }
  };

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
                onClick={() => setEditSession(editSession ? null : {
                  scrimName: scrim.scrim_name, date: scrim.date, renameFrom: "", renameTo: "",
                })}
                style={{ background: theme.surface, border: `1px solid ${theme.border}`, color: theme.text, padding: "10px 14px", borderRadius: 10, cursor: "pointer", fontWeight: 800, display: "inline-flex", gap: 8, alignItems: "center" }}
              >
                <Pencil size={15} /> {t.sdEdit}
              </button>
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

      {/* 세션 편집 패널 — 이름·날짜·상대팀명(BASE_TEAM 잠금) */}
      {editSession && (() => {
        const opponents = [...new Set(matches.flatMap(m => [m.team1_name, m.team2_name]))].filter(n => n && n !== BASE_TEAM);
        const inp = { padding: "10px 12px", background: theme.surfaceHighlight, border: `1px solid ${theme.borderHighlight}`, borderRadius: 8, color: theme.text, fontSize: 14, outline: "none" };
        return (
          <div style={{ marginTop: 20, background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 14, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontWeight: 900 }}>{t.sdEditSession}</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <input style={{ ...inp, minWidth: 240 }} value={editSession.scrimName}
                onChange={e => setEditSession({ ...editSession, scrimName: e.target.value })} />
              <input type="date" style={{ ...inp, colorScheme: theme.mode === "dark" ? "dark" : "light" }} value={editSession.date}
                onChange={e => setEditSession({ ...editSession, date: e.target.value })} />
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: theme.textSub, fontWeight: 700 }}>{t.sdOppRename}</span>
              <select style={{ ...inp, cursor: "pointer" }} value={editSession.renameFrom}
                onChange={e => setEditSession({ ...editSession, renameFrom: e.target.value })}>
                <option value="">-</option>
                {opponents.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <span style={{ color: theme.textSub }}>→</span>
              <input style={inp} value={editSession.renameTo} placeholder={t.sdOppRename}
                onChange={e => setEditSession({ ...editSession, renameTo: e.target.value })} />
            </div>
            <div style={{ fontSize: 12, color: theme.textSub }}>{t.sdOppRenameHint.replace("{team}", BASE_TEAM)}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button disabled={busy} onClick={saveSession}
                style={{ background: theme.text, color: theme.bg, border: "none", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontWeight: 800 }}>{t.sdSave}</button>
              <button onClick={() => setEditSession(null)}
                style={{ background: "transparent", color: theme.textSub, border: `1px solid ${theme.border}`, padding: "8px 18px", borderRadius: 8, cursor: "pointer" }}>{t.sdCancel}</button>
            </div>
          </div>
        );
      })()}

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
              <React.Fragment key={m.id}>
              <div
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
                    <div style={{ fontWeight: 900, marginBottom: 6 }}>
                      #{m.match_index} · {getMapDisplayName(m.map_name)}
                      {m.source === "manual" && (
                        <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: theme.warning, border: `1px solid ${theme.warning}`, borderRadius: 6, padding: "1px 7px", verticalAlign: "1px" }}>{t.sdManualBadge}</span>
                      )}
                    </div>
                    <div style={{ color: theme.textSub, fontSize: 13, marginBottom: 6 }}>
                      {t.sdResult}: {m.source === "manual"
                        ? (m.winner ? `${m.winner} (${m.score_t1} : ${m.score_t2})` : `${m.score_t1} : ${m.score_t2}`)
                        : (m.result || t.sdUnknown)}
                    </div>
                    {!isSelectMode && m.source !== "manual" && <WinnerOverrideControl match={m} onChanged={() => fetchScrim()} />}
                  </div>
                </div>

                {!isSelectMode && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {/* 로그 추가(수기) / 교체(로그) — 파일 선택 즉시 경고→dry_run→업로드 흐름 */}
                    <input type="file" accept=".txt" id={`logfile-${m.id}`} style={{ display: "none" }}
                      onClick={e => e.stopPropagation()}
                      onChange={e => { const f = e.target.files[0]; e.target.value = ""; uploadLog(m, f); }} />
                    <label htmlFor={`logfile-${m.id}`} onClick={e => e.stopPropagation()}
                      style={{ background: theme.surfaceHighlight, border: `1px solid ${theme.borderHighlight}`, color: theme.text, padding: "8px 10px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 12, display: "inline-flex", gap: 6, alignItems: "center", opacity: busy ? 0.5 : 1 }}>
                      <Upload size={13} /> {m.source === "manual" ? t.sdAddLog : t.sdReplaceLog}
                    </label>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        setEditMatch(editMatch?.id === m.id ? null : {
                          id: m.id, source: m.source, map_name: m.map_name, video_url: m.video_url || "",
                          offsetStr: secToMmss(m.video_offset), startStr: secToMmss(m.video_start_sec), endStr: secToMmss(m.video_end_sec),
                          winner: m.source === "manual" ? (m.winner_override || m.winner || "") : "",
                          score_t1: m.score_t1, score_t2: m.score_t2, match_index: m.match_index,
                          team1_name: m.team1_name, team2_name: m.team2_name,
                        });
                      }}
                      style={{ background: theme.surfaceHighlight, border: `1px solid ${theme.borderHighlight}`, color: theme.text, padding: "8px 10px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 12, display: "inline-flex", gap: 6, alignItems: "center" }}
                    >
                      <Pencil size={13} /> {t.sdMatchEdit}
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); onSelectMatch?.(m.id); }}
                      style={{ background: theme.text, border: "none", color: theme.bg, padding: "8px 10px", borderRadius: 10, cursor: "pointer", fontWeight: 900, fontSize: 12 }}
                    >
                      {t.sdAnalyze}
                    </button>
                  </div>
                )}
              </div>

              {/* 매치 인라인 편집 폼 — 표시값이 아닌 정본 값(map_name 원문 등)을 편집 */}
              {editMatch?.id === m.id && (() => {
                const em = editMatch;
                const upd = (k, v) => setEditMatch({ ...em, [k]: v });
                const inp = { padding: "9px 11px", background: theme.surfaceHighlight, border: `1px solid ${theme.borderHighlight}`, borderRadius: 8, color: theme.text, fontSize: 13, outline: "none", width: 150 };
                const lbl = { fontSize: 11, color: theme.textSub, fontWeight: 700, display: "block", marginBottom: 4 };
                return (
                  <div style={{ border: `1px dashed ${theme.borderHighlight}`, borderRadius: 12, padding: 14, display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end", background: theme.surface }}>
                    <div><span style={lbl}>{t.mapName}</span>
                      <input style={inp} value={em.map_name} onChange={e => upd("map_name", e.target.value)} /></div>
                    <div><span style={lbl}>{t.sdOrder}</span>
                      <input style={{ ...inp, width: 60 }} type="number" min="1" value={em.match_index} onChange={e => upd("match_index", e.target.value)} /></div>
                    <div style={{ flexBasis: "100%", maxWidth: 480 }}><span style={lbl}>{t.smYoutubeLink}</span>
                      <input style={{ ...inp, width: "100%", boxSizing: "border-box" }} value={em.video_url} onChange={e => upd("video_url", e.target.value)} /></div>
                    {em.source === "manual" ? (
                      <>
                        <div><span style={lbl}>{t.smWinnerLabel}</span>
                          <select style={{ ...inp, cursor: "pointer" }} value={em.winner} onChange={e => upd("winner", e.target.value)}>
                            <option value="">{t.woNone}</option>
                            <option value={em.team1_name}>{em.team1_name}</option>
                            <option value={em.team2_name}>{em.team2_name}</option>
                          </select></div>
                        <div><span style={lbl}>{t.smScoreLabel}</span>
                          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                            <input style={{ ...inp, width: 55 }} type="number" min="0" value={em.score_t1} onChange={e => upd("score_t1", e.target.value)} />
                            :
                            <input style={{ ...inp, width: 55 }} type="number" min="0" value={em.score_t2} onChange={e => upd("score_t2", e.target.value)} />
                          </span></div>
                        <div><span style={lbl}>{t.smVodStart}</span>
                          <input style={{ ...inp, width: 80 }} value={em.startStr} placeholder="MM:SS" onChange={e => upd("startStr", e.target.value)} /></div>
                        <div><span style={lbl}>{t.smVodEnd}</span>
                          <input style={{ ...inp, width: 80 }} value={em.endStr} placeholder="MM:SS" onChange={e => upd("endStr", e.target.value)} /></div>
                      </>
                    ) : (
                      <>
                      <div><span style={lbl}>{t.sdVodOffset}</span>
                        <input style={{ ...inp, width: 80 }} value={em.offsetStr} placeholder="MM:SS" onChange={e => upd("offsetStr", e.target.value)} /></div>
                      {/* 라운드별 VOD 보정 — 라운드 종료 연출 타이머 정지 보정 */}
                      <div style={{ flexBasis: "100%", border: `1px solid ${theme.border}`, borderRadius: 10, padding: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>{t.sdRoundDelta}</div>
                        {deltaInfo?.error && <div style={{ fontSize: 12, color: theme.danger }}>{t.sdDeltaLoadFail}</div>}
                        {!deltaInfo && <div style={{ fontSize: 12, color: theme.textSub }}>{t.loading}</div>}
                        {deltaInfo && !deltaInfo.error && (
                          <>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                              <span style={{ fontSize: 11, color: theme.textSub, fontWeight: 700 }}>{t.sdDeltaPerTrans}</span>
                              <input style={{ ...inp, width: 55 }} type="number" value={deltaInfo.perTransStr}
                                onChange={e => setDeltaInfo({ ...deltaInfo, perTransStr: e.target.value })} />
                              <button type="button" onClick={() => {
                                const n = Number(deltaInfo.perTransStr) || 0;
                                setDeltaInfo(di => ({ ...di, rows: di.rows.map(r => ({ ...r, valueStr: String(n * (r.round_number - 1)) })) }));
                              }}
                                style={{ background: theme.surfaceHighlight, border: `1px solid ${theme.borderHighlight}`, color: theme.text, padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>{t.sdDeltaApply}</button>
                              <span style={{ fontSize: 11, color: theme.textSub }}>({t.sdDeltaEmptyAuto})</span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              {deltaInfo.rows.map(row => (
                                <div key={row.round_number} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                  <span style={{ fontSize: 12, fontWeight: 800, width: 32 }}>R{row.round_number}</span>
                                  <input style={{ ...inp, width: 60 }} value={row.valueStr}
                                    placeholder={t.sdDeltaAutoFmt.replace("{n}", row.auto)}
                                    onChange={e => updDeltaRow(row.round_number, { valueStr: e.target.value })} />
                                  <span style={{ fontSize: 11, color: theme.textSub }}>{t.sdDeltaSecUnit}</span>
                                  {row.ref ? (
                                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }} title={t.sdDeltaCalcHint}>
                                      <span style={{ fontSize: 11, color: theme.textSub }}>{t.sdDeltaRefScene}: {row.ref.desc}</span>
                                      <input style={{ ...inp, width: 70 }} value={row.refStr} placeholder="MM:SS"
                                        onChange={e => updDeltaRow(row.round_number, { refStr: e.target.value })} />
                                      <button type="button" onClick={() => calcDeltaFromRef(row)}
                                        style={{ background: theme.surfaceHighlight, border: `1px solid ${theme.borderHighlight}`, color: theme.text, padding: "5px 10px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>{t.sdDeltaCalc}</button>
                                    </span>
                                  ) : (
                                    <span style={{ fontSize: 11, color: theme.textSub }}>{t.sdDeltaNoRef}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                      </>
                    )}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button disabled={busy} onClick={saveMatch}
                        style={{ background: theme.text, color: theme.bg, border: "none", padding: "9px 16px", borderRadius: 8, cursor: "pointer", fontWeight: 800, fontSize: 13 }}>{t.sdSave}</button>
                      <button onClick={() => setEditMatch(null)}
                        style={{ background: "transparent", color: theme.textSub, border: `1px solid ${theme.border}`, padding: "9px 16px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>{t.sdCancel}</button>
                    </div>
                  </div>
                );
              })()}
              </React.Fragment>
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
