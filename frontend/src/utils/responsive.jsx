import React, { useState, useEffect } from 'react';

// 모바일 폭 분기 — 앱 전반 공통 기준(App 네비와 동일: matchMedia 767px 미만=모바일).
// 표시 레이어 전용. 데스크톱은 이 값이 false라 기존 레이아웃 그대로(가산 분기).
export function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const on = (e) => setM(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}

// 가로 스크롤 래퍼 + 모바일 전용 우측 페이드 힌트(은은). 데스크톱은 기존 단순 overflow-x 래퍼 그대로.
//  - isMobile: 모바일이면 페이드 힌트 표시
//  - fade    : 페이드가 녹아드는 배경색(표 우측 뒤 배경과 동일하게 — 보통 theme.bg/surface)
//  - style   : 스크롤 div에 추가 스타일(기존 래퍼 style 승계용)
export function ScrollX({ isMobile, fade = '#09090b', style, children }) {
  if (!isMobile) return <div style={{ overflowX: 'auto', ...style }}>{children}</div>;
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ overflowX: 'auto', ...style }}>{children}</div>
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 18, pointerEvents: 'none', background: `linear-gradient(to right, transparent, ${fade})`, borderRadius: 'inherit' }} />
    </div>
  );
}
