import React, { useState, useEffect } from 'react';
import { X, Upload, Plus, Trash2, Calendar, Youtube, Map, Clock, PauseCircle, AlertCircle, Users, PlayCircle, Trophy } from 'lucide-react';
// [중요] ThemeContext, LanguageContext 적용
import { useTheme } from "./ThemeContext";
import { useLanguage } from "./LanguageContext";

const HOURS = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));

const ScrimModal = ({ isOpen, onClose, onSubmit }) => {
  const { theme } = useTheme();
  const { t } = useLanguage();

  const [step, setStep] = useState(1);
  const [scrimData, setScrimData] = useState({
    scrimName: '',
    date: new Date().toISOString().split('T')[0],
    startHour: '20',
    endHour: '22',
    matches: [{
      map_name: '',
      videoUrl: '',
      team1Name: '1팀',
      team2Name: '2팀',
      start_time: '',
      end_time: '',
      result: '',
      has_pause: false,
      pauses: [],
      winner_override: ''
    }],
    files: []
  });

  const initialScrimData = () => ({
    scrimName: '',
    date: new Date().toISOString().split('T')[0],
    startHour: '20',
    endHour: '22',
    matches: [{ map_name: '', videoUrl: '', team1Name: '1팀', team2Name: '2팀', start_time: '', end_time: '', result: '', has_pause: false, pauses: [], winner_override: '' }],
    files: []
  });

  const isDirty =
    scrimData.scrimName !== '' ||
    scrimData.matches.some(m => m.map_name !== '' || m.videoUrl !== '' || m.start_time !== '' || m.end_time !== '');

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

  const handleNext = () => {
    if (!scrimData.scrimName) return alert(t.smEnterName);
    setStep(2);
  };

  const handleSubmit = () => {
    if (scrimData.matches.length === 0) return alert(t.smMinOneMatch);
    
    // 유효성 검사
    for (let i = 0; i < scrimData.matches.length; i++) {
        const m = scrimData.matches[i];
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
      matches: [...prev.matches, { map_name: '', videoUrl: '', team1Name: '1팀', team2Name: '2팀', start_time: '', end_time: '', result: '', has_pause: false, pauses: [], winner_override: '' }],
      files: [...prev.files, null]
    }));
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
    setScrimData(prev => {
        const newFiles = [...prev.files];
        newFiles[index] = file;
        return { ...prev, files: newFiles };
    });
  };

  const overlayStyle = { position: 'fixed', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px' };
  const modalStyle = { backgroundColor: theme.bg, border: `1px solid ${theme.border}`, borderRadius: '20px', width: '100%', maxWidth: '900px', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', color: theme.text, boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' };
  const headerStyle = { padding: '32px', borderBottom: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, backgroundColor: theme.bg, zIndex: 10 };
  const bodyStyle = { padding: '32px', display: 'flex', flexDirection: 'column', gap: '32px' };
  const inputGroupStyle = { display: 'flex', flexDirection: 'column', gap: '10px' };
  const labelStyle = { fontSize: '15px', fontWeight: '600', color: theme.textSub };
  const inputStyle = { padding: '16px 20px', backgroundColor: theme.surfaceHighlight, border: `1px solid ${theme.borderHighlight}`, borderRadius: '12px', color: theme.text, fontSize: '16px', outline: 'none', width: '100%', boxSizing: 'border-box' };
  const selectStyle = { ...inputStyle, appearance: 'none', cursor: 'pointer', textAlign: 'center' };
  const footerStyle = { padding: '32px', borderTop: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'flex-end', gap: '16px', position: 'sticky', bottom: 0, backgroundColor: theme.bg, zIndex: 10 };
  const btnStyle = (variant) => ({ padding: '14px 28px', borderRadius: '12px', fontSize: '16px', fontWeight: '600', cursor: 'pointer', border: variant === 'primary' ? 'none' : `1px solid ${theme.borderHighlight}`, backgroundColor: variant === 'primary' ? theme.text : theme.surfaceHighlight, color: variant === 'primary' ? theme.bg : theme.text });

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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '20px' }}>
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
                <div key={idx} style={{ background: theme.surface, padding: '24px', borderRadius: '16px', border: `1px solid ${theme.border}`, position: 'relative' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <span style={{ fontSize: '16px', fontWeight: 'bold', color: theme.text, background: theme.surfaceHighlight, padding:'6px 12px', borderRadius:'8px' }}>SET {idx + 1}</span>
                    {scrimData.matches.length > 1 && (
                      <button onClick={() => removeMatch(idx)} style={{ background: 'transparent', border: 'none', color: theme.danger, cursor: 'pointer', display:'flex', alignItems:'center', gap:'6px', fontSize:'14px' }}>
                        <Trash2 size={16} /> {t.delete}
                      </button>
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

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                          <div style={inputGroupStyle}>
                              <label style={labelStyle}><Users size={16} style={{verticalAlign:'text-bottom', marginRight:6}}/> {t.smTeam1Label}</label>
                              <input type="text" placeholder="ex: Team A" value={match.team1Name} onChange={e => updateMatch(idx, 'team1Name', e.target.value)} style={inputStyle} />
                          </div>
                          <div style={inputGroupStyle}>
                              <label style={labelStyle}><Users size={16} style={{verticalAlign:'text-bottom', marginRight:6}}/> {t.smTeam2Label}</label>
                              <input type="text" placeholder="ex: Team B" value={match.team2Name} onChange={e => updateMatch(idx, 'team2Name', e.target.value)} style={inputStyle} />
                          </div>
                      </div>

                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
                          <div style={inputGroupStyle}>
                              <label style={labelStyle}><Clock size={16} style={{verticalAlign:'text-bottom', marginRight:6}}/> {t.matchStart} (MM:SS)</label>
                              <input type="text" placeholder={t.smStartPlaceholder} value={match.start_time} onChange={e => updateMatch(idx, 'start_time', e.target.value)} style={{...inputStyle, textAlign:'center'}} />
                          </div>
                          <div style={inputGroupStyle}>
                              <label style={labelStyle}><Clock size={16} style={{verticalAlign:'text-bottom', marginRight:6}}/> {t.matchEnd} (MM:SS)</label>
                              <input type="text" placeholder="10:00" value={match.end_time} onChange={e => updateMatch(idx, 'end_time', e.target.value)} style={{...inputStyle, textAlign:'center'}} />
                          </div>
                      </div>
                  </div>

                  {/* 퍼즈 입력 섹션 */}
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

                  {/* 승패 보정 섹션 — 퍼즈 보정과 동일 자리·스타일, 맵 종류 무관 항상 노출.
                      밀기맵 등 로그에 스코어가 없어 자동 판정이 무승부로 저장되는 매치의 실제 승팀을
                      등록자가 수동 선택(기본 미보정). 저장 시 winner_override로 전달, 원본 winner 무변경. */}
                  <div style={{ background: theme.surfaceHighlight, padding: '16px', borderRadius: '12px', marginBottom: '20px', border: `1px solid ${theme.borderHighlight}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <label style={{ ...labelStyle, color: theme.text, display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Trophy size={16} color={theme.warning} /> {t.woLabel}
                        </label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          {/* 좌우 순서 = team1, team2 순서와 일치 */}
                          {[['', t.woNone], [match.team1Name, `${match.team1Name} ${t.woWinSuffix}`], [match.team2Name, `${match.team2Name} ${t.woWinSuffix}`]].map(([val, label], wi) => {
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

                  <div>
                    <label style={{ ...labelStyle, display: 'block', marginBottom: '12px' }}>{t.logFile}</label>
                    <div style={{ position: 'relative' }}>
                        <input type="file" accept=".txt" id={`file-${idx}`} onChange={e => handleFileChange(idx, e.target.files[0])} style={{ display: 'none' }} />
                        <label htmlFor={`file-${idx}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '20px', border: `1px dashed ${theme.borderHighlight}`, borderRadius: '12px', cursor: 'pointer', color: scrimData.files[idx] ? theme.success : theme.textSub, fontSize: '15px', transition: 'all 0.2s', backgroundColor: scrimData.files[idx] ? `${theme.success}10` : 'transparent' }}>
                            <Upload size={20} /> {scrimData.files[idx] ? scrimData.files[idx].name : t.uploadLog}
                        </label>
                    </div>
                  </div>
                </div>
              ))}

              <button onClick={addMatch} style={{ width: '100%', padding: '16px', background: theme.surface, border: `1px dashed ${theme.borderHighlight}`, color: theme.textSub, borderRadius: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', fontSize: '16px', fontWeight: '600' }}>
                <Plus size={20} /> {t.addMatch}
              </button>
            </>
          )}
        </div>

        <div style={footerStyle}>
          {step === 2 && <button onClick={() => setStep(1)} style={btnStyle('secondary')}>{t.prev}</button>}
          <button onClick={step === 1 ? handleNext : handleSubmit} style={btnStyle('primary')}>
            {step === 1 ? t.next : t.save}
          </button>
        </div>

      </div>
    </div>
  );
};

export default ScrimModal;