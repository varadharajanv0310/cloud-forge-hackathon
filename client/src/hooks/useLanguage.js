import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import React from 'react';
import { loadVault } from '../utils/vaultEncryption.js';
import { languageForState, languageInfo, fontStackFor, lineHeightFor } from '../data/languages.js';

/**
 * Language, and which one sits beside English.
 *
 * TWO THINGS WERE WRONG BEFORE.
 *
 * The second language was Tamil for everybody. A citizen in Bihar was shown a
 * script they cannot read, in the exact place reserved for the words meant to
 * make the product usable — worse than blank, because it occupies the space
 * where help should be. The second language now comes from their state, which
 * they have already told us and which the matcher needs anyway.
 *
 * And the toggle did nothing anyone could see. Both languages were printed
 * together on every screen, so switching changed a handful of conditional
 * strings and nothing else. It now decides which language is PRIMARY — which
 * one is set large and read first — and the other becomes the quiet line
 * beneath it. Both stay on screen, because the whole design rests on a reader
 * of either never having to hunt for a switch; what changes is whose language
 * the screen is written in first.
 *
 * The font follows from that. `.ta` used to hardcode Noto Sans Tamil, so it
 * would have rendered Devanagari in a Tamil font — which mostly means tofu. The
 * family and the line-height are published as CSS variables on <html> instead,
 * so every element already carrying `.ta` re-scripts itself with no edit, and
 * scripts with taller ascenders get the leading they need rather than the 1.5
 * that suits Latin.
 */

const LANG_KEY = 'sevai_lang';

const LanguageCtx = createContext({
  lang: 'en',
  setLang: () => {},
  secondary: 'en',
  primary: 'en',
  swap: () => {},
});

export const LanguageProvider = ({ children }) => {
  // The vault is read directly rather than through useVault: this provider sits
  // above the tree that owns the vault, and the only field wanted here is the
  // state, which onboarding writes before any screen that needs a translation.
  const [state, setState] = useState(() => {
    try { return loadVault()?.state || null; } catch { return null; }
  });

  const secondary = useMemo(() => languageForState(state), [state]);

  /**
   * 'en' means English is primary and the regional language is the second line.
   * Anything else means that language leads. Stored, because a citizen who
   * chose to read in Marathi should not have to choose again next time.
   */
  const [lang, setLangState] = useState(() => localStorage.getItem(LANG_KEY) || 'en');

  const setLang = useCallback((l) => {
    setLangState(l);
    try { localStorage.setItem(LANG_KEY, l); } catch { /* private mode */ }
  }, []);

  /** The toggle: swap which language leads. */
  const swap = useCallback(() => {
    setLang(lang === 'en' ? secondary : 'en');
  }, [lang, secondary, setLang]);

  // The state can change after onboarding (a citizen moves, or corrects it in
  // their profile), and the second language must follow it without a reload.
  useEffect(() => {
    const reread = () => {
      try { setState(loadVault()?.state || null); } catch { /* ignore */ }
    };
    window.addEventListener('storage', reread);
    window.addEventListener('focus', reread);
    const id = setInterval(reread, 2000);
    return () => {
      window.removeEventListener('storage', reread);
      window.removeEventListener('focus', reread);
      clearInterval(id);
    };
  }, []);

  // A stored preference for a language this citizen's state does not use — they
  // moved, or they are on a second-hand phone — would leave the toggle pointing
  // at something the screen can no longer produce. Fall back to English.
  useEffect(() => {
    if (lang !== 'en' && lang !== secondary) setLang('en');
  }, [lang, secondary, setLang]);

  // Publish the script's font and leading so `.ta` can serve any of them.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--lang-font', fontStackFor(secondary));
    root.style.setProperty('--lang-lh', String(lineHeightFor(secondary)));
    root.lang = lang === 'en' ? 'en-IN' : `${lang}-IN`;
    // Read by the guard rule in index.css. Every second-language string in the
    // app is still Tamil, so this is what stops a citizen in Bihar being shown
    // Tamil words wearing a Devanagari font.
    root.dataset.secondary = secondary;
    root.dir = languageInfo(lang).rtl ? 'rtl' : 'ltr';
  }, [lang, secondary]);

  const value = useMemo(() => ({
    lang,
    setLang,
    swap,
    secondary,
    primary: lang,
    secondaryInfo: languageInfo(secondary),
    // True when the citizen's state has no regional language we can set type
    // in. Screens use it to drop the second line rather than print an empty one.
    monolingual: secondary === 'en',
  }), [lang, setLang, swap, secondary]);

  return React.createElement(LanguageCtx.Provider, { value }, children);
};

export const useLanguage = () => useContext(LanguageCtx);
