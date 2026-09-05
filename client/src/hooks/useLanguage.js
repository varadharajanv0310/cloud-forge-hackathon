import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import React from 'react';

const LANG_KEY = 'sevai_lang';
const LanguageCtx = createContext({ lang: 'en', setLang: () => {} });

export const LanguageProvider = ({ children }) => {
  const [lang, setLangState] = useState(() => localStorage.getItem(LANG_KEY) || 'en');

  const setLang = useCallback((l) => {
    setLangState(l);
    localStorage.setItem(LANG_KEY, l);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === 'ta' ? 'ta-IN' : 'en-IN';
  }, [lang]);

  return React.createElement(LanguageCtx.Provider, { value: { lang, setLang } }, children);
};

export const useLanguage = () => useContext(LanguageCtx);
