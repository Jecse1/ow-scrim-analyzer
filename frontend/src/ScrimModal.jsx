import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { X, Upload, Plus, Trash2, Calendar, Youtube, Map, Clock, PauseCircle, AlertCircle, Users, PlayCircle, Trophy } from 'lucide-react';
// [중요] ThemeContext, LanguageContext 적용
import { useTheme } from "./ThemeContext";
import { useLanguage } from "./LanguageContext";
import { useIsMobile } from "./utils/responsive";

const HOURS = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));

// 매치 1개 초기값. 1팀명·2팀명은 자유 입력 — 로그 매치는 1팀명 = 로그 첫 match_start 의 첫 팀(roster slot 1) 자리.
// winner·winner_override 는 't1' | 't2' | 'Draw' | '' 로 들고 있다가 App 이 팀명으로 바꾼다
// (팀명을 나중에 고쳐도 선택이 어긋나지 않게).
// roster: POST /api/logs/roster 상태 { status: 'loading'|'ok'|'error', file, data?, error? } | null
let _uidSeq = 0;
const blankMatch = (team1Name = '', team2Name = '') => ({
  uid: ++_uidSeq,
  map_name: '', videoUrl: '', team1Name, team2Name, start_time: '', end_time: '', result: '',
  has_pause: false, pauses: [], winner_override: '',
  // 수기(로그 없는) 매치: source='manual' + winner/score 직접 입력
  source: 'log', winner: '', score_t1: '', score_t2: '',
  roster: null
});

const ScrimModal = ({ isOpen, onClose, onSubmit }) => {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const isMobile = useIsMobile();

  const initialScrimData = () => ({
    scrimName: '',
    date: new Date().toISOString().split('T')[0],
    startHour: '20',
    endHour: '22',
    matches: [blankMatch()],
    files: []
  });

  const [step, setStep] = useState(1);
  const [scrimData, setScrimData] = useState(initialScrimData);

  const isDirty =
    scrimData.scrimName !== '' ||
    scrimData.matches.some(m => m.map_name !== '' || m.videoUrl !== '' || m.start_time !== '' || m.end_time !== '' || m.team1Name !== '' || m.team2Name !== '') ||
    scrimData.files.some(Boolean);

  const handleClose = () => {
    if (isDirty) {
      if (!window.confirm(t.smCloseConfirm)) return;
    }
    onClose();
  };

  // ESC 키
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isDirty]);

  // 닫힐 때 state 초기화
  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setScrimData(initialScrimData());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // 등록 불가 사유(로그 매치만): 명단 읽는 중 / 명단 오류
  const setList = (pred) => scrimData.matches.map((m, i) => (m.source !== 'manual' && pred(m) ? `SET ${i + 1}` : null)).filter(Boolean);
  const blockLoading = setList(m => m.roster?.status === 'loading');
  const blockError = setList(m => m.roster?.status === 'error');
  const submitBlocked = blockLoading.length + blockError.length > 0;

  const handleNext = () => {
    if (!scrimData.scrimName) return alert(t.smEnterName);
    setStep(2);
  };

  const handleSubmit = () => {
    if (scrimData.matches.length === 0) return alert(t.smMinOneMatch);
    if (submitBlocked) return;
    
    // 유효성 검사
    for (let i = 0; i < scrimData.matches.length; i++) {
        const m = scrimData.matches[i];
        const n1 = (m.team1Name || '').trim();
        const n2 = (m.team2Name || '').trim();
        if (!n1 || !n2) return alert(`${t.smMatchPre}${i+1}${t.smMatchPost}${t.smTeamNameRequired}`);
        if (n1 === n2) return alert(`${t.smMatchPre}${i+1}${t.smMatchPost}${t.smTeamNamesSame}`);
        if (m.has_pause) {
            if (!m.pauses || m.pauses.length === 0) {
                return alert(`${t.smMatchPre}${i+1}${t.smMatchPost}${t.smPauseSelectedWarn}`);
            }
            for (const p of m.pauses) {
                if (!p.start || !p.end) return alert(`${t.smMatchPre}${i+1}${t.smMatchPost}${t.smPauseTimeWarn}`);
            }
        }
    }

    onSubmit(scrimData);
  };

  const updateMatch = (index, field, value) => {
    setScrimData(prev => ({
      ...prev,
      matches: prev.matches.map((m, i) => i === index ? { ...m, [field]: value } : m)
    }));
  };

  const togglePause = (index, hasPause) => {
    setScrimData(prev => ({
      ...prev,
      matches: prev.matches.map((m, i) => {
        if (i !== index) return m;
        let newPauses = m.pauses || [];
        if (hasPause && newPauses.length === 0) {
            newPauses = [{ start: '', end: '' }];
        }
        return { ...m, has_pause: hasPause, pauses: newPauses };
      })
    }));
  };

  const addPauseRow = (matchIndex) => {
    setScrimData(prev => ({
      ...prev,
      matches: prev.matches.map((m, i) => 
        i === matchIndex ? { ...m, pauses: [...(m.pauses || []), { start: '', end: '' }] } : m
      )
    }));
  };

  const removePauseRow = (matchIndex, pauseIndex) => {
    setScrimData(prev => ({
      ...prev,
      matches: prev.matches.map((m, i) => {
        if (i !== matchIndex) return m;
        const newPauses = m.pauses.filter((_, pid) => pid !== pauseIndex);
        return { ...m, pauses: newPauses };
      })
    }));
  };

  const updatePause = (matchIndex, pauseIndex, field, value) => {
    setScrimData(prev => ({
      ...prev,
      matches: prev.matches.map((m, i) => {
        if (i !== matchIndex) return m;
        const newPauses = m.pauses.map((p, pid) => 
            pid === pauseIndex ? { ...p, [field]: value } : p
        );
        return { ...m, pauses: newPauses };
      })
    }));
  };

  const addMatch = () => {
    setScrimData(prev => ({
      ...prev,
      // 1팀명·2팀명은 앞 매치 값을 이어받는다(같은 상대와 여러 맵 — 바꿀 수 있음)
      matches: [...prev.matches, blankMatch(prev.matches[prev.matches.length - 1]?.team1Name || '', prev.matches[prev.matches.length - 1]?.team2Name || '')],
      files: [...prev.files, null]
    }));
  };

  // 매치 유형 전환. 수기로 바꾸면 고른 로그 파일·명단을 비운다(남은 파일이 업로드되지 않게).
  const setSource = (index, source) => {
    setScrimData(prev => ({
      ...prev,
      matches: prev.matches.map((m, i) => i !== index ? m : (source === 'manual'
        ? { ...m, source, roster: null, winner_override: '' }
        : { ...m, source })),
      files: source === 'manual' ? prev.files.map((f, i) => (i === index ? null : f)) : prev.files
    }));
  };

  // 파일 선택 직후 서버에서 명단을 읽는다(DB·파일 쓰기 없음). 응답이 늦게 와도 그 매치의 현재 파일과
  // 같을 때만 반영(uid·file 대조 — 그 사이 매치 삭제·파일 재선택 대비).
  const fetchRoster = async (uid, file) => {
    const apply = (fn) => setScrimData(prev => {
      const i = prev.matches.findIndex(m => m.uid === uid);
      if (i < 0 || prev.matches[i].roster?.file !== file) return prev;
      return { ...prev, matches: prev.matches.map((m, j) => j === i ? fn(m) : m) };
    });
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await axios.post('/api/logs/roster', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      apply(m => ({ ...m, roster: { status: 'ok', file, data: res.data } }));
    } catch (err) {
      const detail = err.response?.data?.detail;
      apply(m => ({ ...m, roster: { status: 'error', file, error: typeof detail === 'string' ? detail : err.message } }));
    }
  };

  const removeMatch = (index) => {
    if (scrimData.matches.length === 1) return;
    setScrimData(prev => ({
        ...prev,
        matches: prev.matches.filter((_, i) => i !== index),
        files: prev.files.filter((_, i) => i !== index)
    }));
  };

  const handleFileChange = (index, file) => {
    const uid = scrimData.matches[index].uid;
    setScrimData(prev => {
        const newFiles = [...prev.files];
        newFiles[index] = file || null;
        return {
          ...prev,
          files: newFiles,
          matches: prev.matches.map((m, i) => i === index
            ? { ...m, roster: file ? { status: 'loading', file } : null }
            : m)
        };
    });
    if (file) fetchRoster(uid, file);
  };

  const overlayStyle = { position: 'fixed', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: isMobile ? '8px' : '20px' };
  const modalStyle = { backgroundColor: theme.bg, border: `1px solid ${theme.border}`, borderRadius: '20px', width: '100%', maxWidth: '900px', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', color: theme.text, boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' };
  const pad = isMobile ? '16px' : '32px';
  const headerStyle = { padding: pad, borderBottom: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, backgroundColor: theme.bg, zIndex: 10 };
  const bodyStyle = { padding: pad, display: 'flex', flexDirection: 'column', gap: isMobile ? '20px' : '32px' };
  const inputGroupStyle = { display: 'flex', flexDirection: 'column', gap: '10px' };
  const labelStyle = { fontSize: '15px', fontWeight: '600', color: theme.textSub };
  const inputStyle = { padding: '16px 20px', backgroundColor: theme.surfaceHighlight, border: `1px solid ${theme.borderHighlight}`, borderRadius: '12px', color: theme.text, fontSize: '16px', outline: 'none', width: '100%', boxSizing: 'border-box' };
  const selectStyle = { ...inputStyle, appearance: 'none', cursor: 'pointer', textAlign: 'center' };
  const footerStyle = { padding: pad, borderTop: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gap: '16px', position: 'sticky', bottom: 0, backgroundColor: theme.bg, zIndex: 10 };
  const cols2 = isMobile ? '1fr' : '1fr 1fr';
  const btnStyle = (variant) => ({ padding: '14px 28px', borderRadius: '12px', fontSize: '16px', fontWeight: '600', cursor: 'pointer', border: variant === 'primary' ? 'none' : `1px solid ${theme.borderHighlight}`, backgroundColor: variant === 'primary' ? theme.text : theme.surfaceHighlight, color: variant === 'primary' ? theme.bg : theme.text });

  // 로그 명단 카드 1장(slot 1 → 1팀명 칸 아래, slot 2 → 2팀명 칸 아래). 머리의 "로그 라벨: …" 은 입력한 팀명과
  // 로그 표기가 다를 때 대조용(표시만 — 등록 팀명은 입력값).
  const renderTeamCard = (match, slot) => {
    const r = match.roster;
    if (match.source === 'manual' || r?.status !== 'ok') return null;
    const team = r.data.teams.find(tm => tm.slot === slot);
    if (!team) return null;
    return (
      <div style={{ padding: '12px 14px', borderRadius: '12px', border: `1px solid ${theme.borderHighlight}`, background: theme.surfaceHighlight }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
          <span style={{ fontWeight: 700, fontSize: '14px' }}>{t.smRosterTitle}</span>
          <span style={{ fontSize: '12px', color: theme.textSub }}>{t.smRosterLogLabel}: {team.label}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {team.players.map(p => (
            <div key={p.name} style={{ fontSize: '13px', lineHeight: 1.4 }}>
              <span style={{ fontWeight: 600, color: theme.text }}>{p.name}</span>
              {p.heroes.length > 0 && <span style={{ color: theme.textSub }}> · {p.heroes.join(', ')}</span>}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // 파일 선택 칸 아래: 명단 읽는 중 / 오류 / precheck 경고
  const renderRosterStatus = (match) => {
    const r = match.roster;
    if (!r) return null;
    if (r.status === 'loading') {
      return <div style={{ marginTop: '12px', fontSize: '13px', color: theme.textSub }}>{t.smRosterLoading}</div>;
    }
    if (r.status === 'error') {
      return (
        <div style={{ marginTop: '12px', padding: '12px', borderRadius: '10px', border: `1px solid ${theme.danger}`, color: theme.danger, fontSize: '13px', display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{t.smRosterError}{r.error ? ` (${r.error})` : ''}</span>
        </div>
      );
    }
    const { warnings, warning_count } = r.data;
    if (!(warning_count > 0)) return null;
    return (
      <div style={{ marginTop: '12px' }}>
          <details style={{ fontSize: '12px', color: theme.warning }}>
            <summary style={{ cursor: 'pointer' }}>{t.smRosterWarnTpl.replace('{n}', warning_count)}</summary>
            <ul style={{ margin: '6px 0 0', paddingLeft: '18px', color: theme.textSub }}>
              {warnings.map((w, wi) => (
                <li key={wi}>{w.line ? `L${w.line} ` : ''}{w.message}</li>
              ))}
              {warning_count > warnings.length && <li>… +{warning_count - warnings.length}</li>}
            </ul>
          </details>
      </div>
    );
  };

  return (
    <div style={overlayStyle} onClick={handleClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>

        <div style={headerStyle}>
          <h2 style={{ margin: 0, fontSize: '24px', fontWeight: '800' }}>{t.modalTitle}</h2>
          <button onClick={handleClose} style={{ background: 'transparent', border: 'none', color: theme.textSub, cursor: 'pointer' }}><X size={24} /></button>
        </div>

        <div style={bodyStyle}>
          {step === 1 ? (
            <>
              <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '20px', marginBottom: '8px', fontWeight: '700' }}>{t.step1Title}</h3>
                <p style={{ color: theme.textSub, fontSize: '16px' }}>{t.step1Desc}</p>
              </div>

              <div style={inputGroupStyle}>
                <label style={labelStyle}>{t.scrimName}</label>
                <input type="text" placeholder={t.scrimNamePlace} value={scrimData.scrimName} onChange={e => setScrimData({ ...scrimData, scrimName: e.target.value })} style={inputStyle} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1.5fr', gap: '20px' }}>
                  <div style={inputGroupStyle}>
                    <label style={labelStyle}><Calendar size={16} style={{verticalAlign:'text-bottom', marginRight:6}}/> {t.date}</label>
                    <input type="date" value={scrimData.date} onChange={e => setScrimData({ ...scrimData, date: e.target.value })} style={{...inputStyle, colorScheme: theme.mode === 'dark' ? 'dark' : 'light'}} />
                  </div>
                  <div style={inputGroupStyle}>
                    <label style={labelStyle}><Clock size={16} style={{verticalAlign:'text-bottom', marginRight:6}}/> {t.time} (HH ~ HH)</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <select value={scrimData.startHour} onChange={e => setScrimData({ ...scrimData, startHour: e.target.value })} style={selectStyle}>
                            {HOURS.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                        <span style={{ color: theme.textSub, fontWeight: 'bold' }}>~</span>
                        <select value={scrimData.endHour} onChange={e => setScrimData({ ...scrimData, endHour: e.target.value })} style={selectStyle}>
                            {HOURS.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                    </div>
                  </div>
              </div>
            </>
          ) : (
            <>
              <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '20px', marginBottom: '8px', fontWeight: '700' }}>{t.step2Title}</h3>
                <p style={{ color: theme.textSub, fontSize: '16px' }}>{t.step2Desc}</p>
              </div>

              {scrimData.matches.map((match, idx) => (
                <div key={match.uid} style={{ background: theme.surface, padding: isMobile ? '16px' : '24px', borderRadius: '16px', border: `1px solid ${theme.border}`, position: 'relative' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <span style={{ fontSize: '16px', fontWeight: 'bold', color: theme.text, background: theme.surfaceHighlight, padding:'6px 12px', borderRadius:'8px' }}>SET {idx + 1}</span>
                    {scrimData.matches.length > 1 && (
                      <button onClick={() => removeMatch(idx)} style={{ background: 'transparent', border: 'none', color: theme.danger, cursor: 'pointer', display:'flex', alignItems:'center', gap:'6px', fontSize:'14px' }}>
                        <Trash2 size={16} /> {t.delete}
                      </button>
                    )}
                  </div>

                  {/* 매치 유형 — 로그 매치(기존) / 수기 매치(로그 없음, winner·score 직접 기록) */}
                  <div style={{ background: theme.surfaceHighlight, padding: '16px', borderRadius: '12px', marginBottom: '20px', border: `1px solid ${theme.borderHighlight}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                      <label style={{ ...labelStyle, color: theme.text }}>{t.smSourceLabel}</label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {[['log', t.smSourceLog], ['manual', t.smSourceManual]].map(([val, label]) => {
                          const active = (match.source || 'log') === val;
                          return (
                            <button key={val} onClick={() => setSource(idx, val)}
                              style={{ padding: '6px 16px', borderRadius: '8px', border: '1px solid', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold',
                                background: active ? theme.text : 'transparent', color: active ? theme.bg : theme.textSub,
                                borderColor: active ? theme.text : theme.borderHighlight }}>
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {match.source === 'manual' && (
                      <div style={{ fontSize: '12px', color: theme.textSub, marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <AlertCircle size={12} /> {t.smManualHint}
                      </div>
                    )}
                  </div>

                  {/* 💡 맵 이름 및 팀 이름 입력 (SET별 적용) */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '20px' }}>
                      <div style={inputGroupStyle}>
                        <label style={labelStyle}><Map size={16} style={{verticalAlign:'text-bottom', marginRight:6}}/> {t.mapName}</label>
                        <input type="text" placeholder="ex: King's Row" value={match.map_name} onChange={e => updateMatch(idx, 'map_name', e.target.value)} style={inputStyle} />
                      </div>

                      <div style={inputGroupStyle}>
                        <label style={labelStyle}><PlayCircle size={16} style={{verticalAlign:'text-bottom', marginRight:6}}/> {t.smYoutubeLink} <span style={{ fontSize: '12px', fontWeight: 'normal', color: theme.textSub }}>{t.smOptional}</span></label>
                        <input type="text" placeholder="https://youtu.be/..." value={match.videoUrl} onChange={e => updateMatch(idx, 'videoUrl', e.target.value)} style={inputStyle} />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: cols2, gap: '16px', alignItems: 'start' }}>
                          <div style={inputGroupStyle}>
                              <label style={labelStyle}><Users size={16} style={{verticalAlign:'text-bottom', marginRight:6}}/> {t.smTeam1Label}</label>
                              <input type="text" placeholder="ex: Team A" value={match.team1Name} onChange={e => updateMatch(idx, 'team1Name', e.target.value)} style={inputStyle} />
                              {renderTeamCard(match, 1)}
                          </div>
                          <div style={inputGroupStyle}>
                              <label style={labelStyle}><Users size={16} style={{verticalAlign:'text-bottom', marginRight:6}}/> {t.smTeam2Label}</label>
                              <input type="text" placeholder="ex: Team B" value={match.team2Name} onChange={e => updateMatch(idx, 'team2Name', e.target.value)} style={inputStyle} />
                              {renderTeamCard(match, 2)}
                          </div>
                      </div>

                      <div style={{ display:'grid', gridTemplateColumns: cols2, gap:'16px' }}>
                          <div style={inputGroupStyle}>
                              <label style={labelStyle}><Clock size={16} style={{verticalAlign:'text-bottom', marginRight:6}}/> {match.source === 'manual' ? t.smVodStart : `${t.matchStart} (MM:SS)`}</label>
                              <input type="text" placeholder={t.smStartPlaceholder} value={match.start_time} onChange={e => updateMatch(idx, 'start_time', e.target.value)} style={{...inputStyle, textAlign:'center'}} />
                          </div>
                          <div style={inputGroupStyle}>
                              <label style={labelStyle}><Clock size={16} style={{verticalAlign:'text-bottom', marginRight:6}}/> {match.source === 'manual' ? t.smVodEnd : `${t.matchEnd} (MM:SS)`}</label>
                              <input type="text" placeholder="10:00" value={match.end_time} onChange={e => updateMatch(idx, 'end_time', e.target.value)} style={{...inputStyle, textAlign:'center'}} />
                          </div>
                      </div>

                      {/* 수기 매치 전용 — 승리 팀·스코어 직접 입력(winner/score 컬럼 저장, 승패 보정 아님) */}
                      {match.source === 'manual' && (
                        <div style={{ display:'grid', gridTemplateColumns: cols2, gap:'16px' }}>
                          <div style={inputGroupStyle}>
                            <label style={labelStyle}><Trophy size={16} style={{verticalAlign:'text-bottom', marginRight:6}}/> {t.smWinnerLabel}</label>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              {[['', t.smWinnerUndecided], ['t1', match.team1Name.trim() || t.sdTeam1Name], ['t2', match.team2Name.trim() || t.sdTeam2Name], ['Draw', t.woDraw]].map(([val, label], wi) => {
                                const active = (match.winner || '') === val;
                                return (
                                  <button key={wi} onClick={() => updateMatch(idx, 'winner', val)}
                                    style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', flex: 1,
                                      background: active ? (val === '' ? theme.surface : theme.warning) : 'transparent',
                                      color: active ? (val === '' ? theme.text : '#000') : theme.textSub,
                                      borderColor: active ? (val === '' ? theme.text : theme.warning) : theme.borderHighlight }}>
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          <div style={inputGroupStyle}>
                            <label style={labelStyle}>{t.smScoreLabel} <span style={{ fontWeight: 'normal', fontSize: '11px', color: theme.textSub }}>· {t.smWinnerAutoHint}</span></label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <input type="number" min="0" value={match.score_t1} onChange={e => updateMatch(idx, 'score_t1', e.target.value)} style={{...inputStyle, textAlign:'center'}} />
                              <span style={{ color: theme.textSub, fontWeight: 'bold' }}>:</span>
                              <input type="number" min="0" value={match.score_t2} onChange={e => updateMatch(idx, 'score_t2', e.target.value)} style={{...inputStyle, textAlign:'center'}} />
                            </div>
                          </div>
                        </div>
                      )}
                  </div>

                  {/* 퍼즈 입력 섹션 — 수기 매치는 로그 좌표 보정이 없으므로 숨김 */}
                  {match.source !== 'manual' && (
                  <div style={{ background: theme.surfaceHighlight, padding: '16px', borderRadius: '12px', marginBottom: '20px', border: `1px solid ${theme.borderHighlight}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ ...labelStyle, color: theme.text, display:'flex', alignItems:'center', gap:'8px' }}>
                            <PauseCircle size={16} color={theme.warning} /> {t.hasPause}
                        </label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => togglePause(idx, true)} style={{ padding: '6px 16px', borderRadius: '8px', border: '1px solid', cursor: 'pointer', fontSize:'13px', fontWeight:'bold', background: match.has_pause ? theme.warning : 'transparent', color: match.has_pause ? '#000' : theme.textSub, borderColor: match.has_pause ? theme.warning : theme.borderHighlight }}>{t.yes}</button>
                            <button onClick={() => togglePause(idx, false)} style={{ padding: '6px 16px', borderRadius: '8px', border: '1px solid', cursor: 'pointer', fontSize:'13px', fontWeight:'bold', background: !match.has_pause ? theme.surface : 'transparent', color: !match.has_pause ? theme.text : theme.textSub, borderColor: !match.has_pause ? theme.text : theme.borderHighlight }}>{t.no}</button>
                        </div>
                    </div>
                    
                    {match.has_pause && (
                        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: `1px dashed ${theme.textSub}` }}>
                            <div style={{ fontSize: '12px', color: theme.textSub, marginBottom: '12px', display:'flex', alignItems:'center', gap:'6px' }}>
                                <AlertCircle size={12}/> {t.pauseAlert}
                            </div>
                            {(match.pauses || []).map((pause, pIdx) => (
                                <div key={pIdx} style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
                                    <span style={{ fontSize:'12px', color: theme.textSub, width:'20px' }}>#{pIdx+1}</span>
                                    <input 
                                        type="text" placeholder="Start (MM:SS)" 
                                        value={pause.start} 
                                        onChange={e => updatePause(idx, pIdx, 'start', e.target.value)}
                                        style={{...inputStyle, padding:'10px', fontSize:'14px', textAlign:'center', background: theme.bg}} 
                                    />
                                    <span style={{color: theme.textSub}}>~</span>
                                    <input 
                                        type="text" placeholder="End (MM:SS)" 
                                        value={pause.end} 
                                        onChange={e => updatePause(idx, pIdx, 'end', e.target.value)}
                                        style={{...inputStyle, padding:'10px', fontSize:'14px', textAlign:'center', background: theme.bg}} 
                                    />
                                    <button onClick={() => removePauseRow(idx, pIdx)} style={{ background: 'transparent', border: 'none', color: theme.danger, cursor: 'pointer' }}><X size={16}/></button>
                                </div>
                            ))}
                            <button onClick={() => addPauseRow(idx)} style={{ fontSize:'12px', color: theme.primary, background:'transparent', border:'none', cursor:'pointer', padding:0, marginTop:'4px', display:'flex', alignItems:'center', gap:'4px' }}>
                                <Plus size={12}/> {t.addPause}
                            </button>
                        </div>
                    )}
                  </div>
                  )}

                  {/* 승패 보정 섹션 — 퍼즈 보정과 동일 자리·스타일, 맵 종류 무관 항상 노출.
                      밀기맵 등 로그에 스코어가 없어 자동 판정이 무승부로 저장되는 매치의 실제 승팀을
                      등록자가 수동 선택(기본 미보정). 저장 시 winner_override로 전달, 원본 winner 무변경.
                      수기 매치는 winner 직접 입력이 따로 있으므로 숨김. */}
                  {match.source !== 'manual' && (
                  <div style={{ background: theme.surfaceHighlight, padding: '16px', borderRadius: '12px', marginBottom: '20px', border: `1px solid ${theme.borderHighlight}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <label style={{ ...labelStyle, color: theme.text, display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Trophy size={16} color={theme.warning} /> {t.woLabel}
                        </label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          {/* 좌우 순서 = team1, team2 순서와 일치 */}
                          {[['', t.woNone], ['t1', `${match.team1Name.trim() || t.sdTeam1Name} ${t.woWinSuffix}`], ['t2', `${match.team2Name.trim() || t.sdTeam2Name} ${t.woWinSuffix}`]].map(([val, label], wi) => {
                            const active = (match.winner_override || '') === val;
                            return (
                              <button key={wi} onClick={() => updateMatch(idx, 'winner_override', val)}
                                style={{ padding: '6px 16px', borderRadius: '8px', border: '1px solid', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold',
                                  background: active ? (val === '' ? theme.surface : theme.warning) : 'transparent',
                                  color: active ? (val === '' ? theme.text : '#000') : theme.textSub,
                                  borderColor: active ? (val === '' ? theme.text : theme.warning) : theme.borderHighlight }}>
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div style={{ fontSize: '12px', color: theme.textSub, marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <AlertCircle size={12} /> {t.woHint}
                      </div>
                  </div>
                  )}

                  {match.source !== 'manual' && (
                  <div>
                    <label style={{ ...labelStyle, display: 'block', marginBottom: '12px' }}>{t.logFile}</label>
                    <div style={{ position: 'relative' }}>
                        <input type="file" accept=".txt" id={`file-${match.uid}`} onChange={e => { handleFileChange(idx, e.target.files[0]); e.target.value = ''; }} style={{ display: 'none' }} />
                        <label htmlFor={`file-${match.uid}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '20px', border: `1px dashed ${theme.borderHighlight}`, borderRadius: '12px', cursor: 'pointer', color: scrimData.files[idx] ? theme.primary : theme.textSub, fontSize: '15px', transition: 'all 0.2s', backgroundColor: scrimData.files[idx] ? `${theme.primary}10` : 'transparent' }}>
                            <Upload size={20} /> {scrimData.files[idx] ? scrimData.files[idx].name : t.uploadLog}
                        </label>
                    </div>
                    {renderRosterStatus(match)}
                  </div>
                  )}
                </div>
              ))}

              <button onClick={addMatch} style={{ width: '100%', padding: '16px', background: theme.surface, border: `1px dashed ${theme.borderHighlight}`, color: theme.textSub, borderRadius: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', fontSize: '16px', fontWeight: '600' }}>
                <Plus size={20} /> {t.addMatch}
              </button>
            </>
          )}
        </div>

        <div style={footerStyle}>
          {step === 2 && submitBlocked && (
            <div style={{ flex: '1 1 240px', fontSize: '13px', color: theme.warning, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {blockLoading.length > 0 && <span><AlertCircle size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />{t.smBlockedLoading}{blockLoading.join(', ')}</span>}
              {blockError.length > 0 && <span><AlertCircle size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />{t.smBlockedRosterErr}{blockError.join(', ')}</span>}            </div>
          )}
          {step === 2 && <button onClick={() => setStep(1)} style={btnStyle('secondary')}>{t.prev}</button>}
          <button onClick={step === 1 ? handleNext : handleSubmit} disabled={step === 2 && submitBlocked}
            style={{ ...btnStyle('primary'), ...(step === 2 && submitBlocked ? { opacity: 0.4, cursor: 'not-allowed' } : {}) }}>
            {step === 1 ? t.next : t.save}
          </button>
        </div>

      </div>
    </div>
  );
};

export default ScrimModal;