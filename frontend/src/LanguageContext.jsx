// src/LanguageContext.jsx
import React, { createContext, useState, useContext } from 'react';
import { setDisplayLanguage } from './gameData';

const LanguageContext = createContext();

import ko from './i18n/ko';
import en from './i18n/en';
import zh from './i18n/zh';

// 번역 본문은 src/i18n/{ko,en,zh}.js 로 분리(2026-10-16). 컴포넌트는 이전과 같이 t.키 로 접근한다.
export const translations = { ko, en, zh };

// [i18n zh] 지원 언어 목록·localStorage 키. 저장값이 목록 밖이면 기본 ko.
export const LANGUAGES = ['ko', 'en', 'zh'];
const LANG_STORAGE_KEY = 'lang';
const loadLang = () => {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY);
    return LANGUAGES.includes(v) ? v : 'ko';
  } catch { return 'ko'; }
};

export const LanguageProvider = ({ children }) => {
  const [language, _setLanguage] = useState(loadLang);
  const setLanguage = (lang) => {
    const v = LANGUAGES.includes(lang) ? lang : 'ko';
    _setLanguage(v);
    setDisplayLanguage(v); // gameData 표시명(영웅/맵/스킬) 언어 동기화
    try { localStorage.setItem(LANG_STORAGE_KEY, v); } catch { /* ignore */ }
  };
  // 초기 마운트 시 저장된 언어를 gameData 에도 반영
  if (typeof window !== 'undefined') setDisplayLanguage(language);
  // 하위호환: 기존 토글은 ko→en→zh 순환으로 유지(현재 UI는 드롭다운 사용)
  const toggleLanguage = () => setLanguage(LANGUAGES[(LANGUAGES.indexOf(language) + 1) % LANGUAGES.length]);
  const t = translations[language] || translations.ko;

  return (
    <LanguageContext.Provider value={{ language, setLanguage, toggleLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);