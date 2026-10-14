// src/ThemeContext.jsx
import React, { createContext, useState, useContext } from 'react';

const ThemeContext = createContext();

// 모드 무관 고정색 — 다크/라이트 양쪽 theme 에 같은 값으로 들어간다(아래 spread).
// 훅을 쓸 수 없는 모듈 상수(예: COLOR_TEAM1)·ThemeProvider 바깥(ErrorBoundary)은 이 객체를 직접 import 한다.
// ※ success 는 아직 정의하지 않는다 — 폴백 없는 기존 참조가 undefined(상속색)로 렌더 중이라
//   정의하면 화면이 바뀐다(04 에서 결정). warning 은 모드별 값이라 아래 각 모드에 따로 둔다.
export const FIXED_COLORS = {
  primaryFixed: '#3b82f6',   // 역할 선택·활성 선수 강조(라이트에서도 고정 — 04: primary 통일 검토)
  dangerFixed: '#ef4444',    // 첫 데스 강조·K/D 선·오류 화면(라이트에서도 고정 — 04: danger 통일 검토)
  overrideBadge: '#22c55e',  // 승자 수동 지정(override) 배지
  team1: '#60a5fa',          // 1팀 슬롯 색(게임 관습 파랑)
  team2: '#f87171',          // 2팀 슬롯 색(게임 관습 빨강)
  teamUnknown: '#9ca3af',    // 팀 판정 불가
  neonAccent: '#39FF14',     // 매치 상세: 탭 밑줄·궁 요약·K/D 강조·1팀 차트
  phaseEarly: '#4ade80',     // 궁 타이밍: 초반(진입)
  phaseMid: '#fbbf24',       // 궁 타이밍: 중반
  phaseLate: '#f87171',      // 궁 타이밍: 후반
  rankGold: '#fbbf24',       // 순위 배지 1위
  rankSilver: '#9ca3af',     // 순위 배지 2위
  rankBronze: '#cd7c2f',     // 순위 배지 3위
  keywordPlayer: '#8b5cf6',  // 검색 태그: 선수 키워드
};

// 색상 팔레트 (다크/라이트)
export const themes = {
  dark: {
    mode: 'dark',
    bg: '#09090b',           // 전체 배경 (아주 어두운 회색)
    surface: '#18181b',      // 카드/헤더 배경 (어두운 회색)
    surfaceHighlight: '#27272a', // 버튼 배경
    border: '#27272a',       // 테두리
    borderHighlight: '#3f3f46', 
    text: '#ffffff',         // 메인 텍스트 (흰색)
    textSub: '#a1a1aa',      // 보조 텍스트 (회색)
    primary: '#3b82f6',      // 강조색 (파랑)
    danger: '#ef4444',       // 에러/삭제 (빨강)
    warning: '#f59e0b',      // 경고/주의 (앰버 — MatchStats 의 기존 대체값과 동일)
    winText: '#4ade80',      // 세션 달력 승 칩 글자
    lossText: '#f87171',     // 세션 달력 패 칩 글자
    ...FIXED_COLORS,
  },
  light: {
    mode: 'light',
    bg: '#ffffff',           // 전체 배경 (흰색)
    surface: '#f4f4f5',      // 카드/헤더 배경 (연한 회색)
    surfaceHighlight: '#e4e4e7', // 버튼 배경
    border: '#e4e4e7',       // 테두리
    borderHighlight: '#d4d4d8',
    text: '#09090b',         // 메인 텍스트 (검정)
    textSub: '#71717a',      // 보조 텍스트 (진한 회색)
    primary: '#2563eb',      // 강조색 (진한 파랑)
    danger: '#dc2626',       // 에러/삭제 (진한 빨강)
    warning: '#d97706',      // 경고/주의 (진한 앰버)
    winText: '#15803d',      // 세션 달력 승 칩 글자
    lossText: '#b91c1c',     // 세션 달력 패 칩 글자
    ...FIXED_COLORS,
  }
};

export const ThemeProvider = ({ children }) => {
  const [isDarkMode, setIsDarkMode] = useState(true); // 기본값 다크모드

  const toggleTheme = () => {
    setIsDarkMode(prev => !prev);
  };

  const theme = isDarkMode ? themes.dark : themes.light;

  return (
    <ThemeContext.Provider value={{ isDarkMode, toggleTheme, theme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);