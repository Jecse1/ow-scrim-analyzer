// src/ThemeContext.jsx
import React, { createContext, useState, useContext } from 'react';

const ThemeContext = createContext();

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