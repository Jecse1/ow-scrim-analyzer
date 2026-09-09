// 킬데스 통계 — 퍼킬 통계 + 퍼뎃 통계 통합 탭.
// 상단 [퍼스트킬 / 퍼스트데스] 토글(0차 토큰 필형 스타일)로 기존 두 컴포넌트를 전환 표시.
// 두 컴포넌트 내부는 무수정(래핑만).
import React, { useState } from 'react';
import { useLanguage } from './LanguageContext';
import FirstKillStats from './FirstKillStats';
import FirstDeathStats from './FirstDeathStats';
import { T } from './FightLabStats';

export default function KillDeathStats({ allScrims }) {
    const { t } = useLanguage();
    const [mode, setMode] = useState('fk'); // 'fk' | 'fd'
    return (
        <div>
            <div style={{ display: 'flex', gap: '6px', padding: '20px 24px 0' }}>
                {[['fk', t.kdToggleFk], ['fd', t.kdToggleFd]].map(([k, label]) => (
                    <button key={k} onClick={() => setMode(k)}
                        style={{
                            background: mode === k ? T.pillRed : T.pillBg,
                            color: mode === k ? '#fff' : T.sub,
                            border: 'none',
                            padding: '6px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 500, fontSize: '13px',
                        }}>
                        {label}
                    </button>
                ))}
            </div>
            {mode === 'fk' ? <FirstKillStats allScrims={allScrims} /> : <FirstDeathStats allScrims={allScrims} />}
        </div>
    );
}
