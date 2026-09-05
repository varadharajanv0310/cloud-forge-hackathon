import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';

import { LanguageProvider, useLanguage } from './hooks/useLanguage.js';
import { useVault } from './hooks/useVault.js';
import { useEligibility } from './hooks/useEligibility.js';
import { useSchemes } from './utils/schemesStore.js';
import Onboarding from './components/Onboarding.jsx';
import ProcessingSphere from './components/ProcessingSphere.jsx';
import WowReveal from './components/WowReveal.jsx';
import AppShell from './components/AppShell.jsx';
import Landing from './pages/Landing.jsx';
import Feed from './pages/Feed.jsx';
import Applications from './pages/Applications.jsx';
import Profile from './pages/Profile.jsx';
import SchemeDetail from './pages/SchemeDetail.jsx';
import Apply from './pages/Apply.jsx';

export default function App() {
  return (
    <LanguageProvider>
      <Shell />
    </LanguageProvider>
  );
}

function Shell() {
  const { vault, setVault, ready } = useVault();
  const { lang, setLang } = useLanguage();
  // loading | landing | onboarding | processing | reveal | app
  const [phase, setPhase] = useState('loading');
  const nav = useNavigate();
  const { confirmed, totals } = useEligibility(vault);
  const { schemes } = useSchemes(vault?.state);
  const [feedBadge, setFeedBadge] = useState(0);

  // Decides the ENTRY phase only. It must not re-run when onboarding_complete
  // flips, because that happens the instant onboarding finishes — and it would
  // then overwrite the explicit setPhase('processing'), skipping the sphere and
  // the reveal entirely and dropping the citizen straight onto the feed.
  useEffect(() => {
    if (!ready) return;
    setPhase((p) => (p === 'loading' ? (vault.onboarding_complete ? 'app' : 'landing') : p));
  }, [ready, vault.onboarding_complete]);

  const handleOnboardingDone = (answers) => {
    setVault({
      ...answers,
      onboarding_complete: true,
      languages_preferred: answers.languages_preferred || [lang],
    });
    setPhase('processing');
  };

  const goFeed = () => {
    setPhase('app');
    nav('/feed');
  };

  if (phase === 'loading') {
    return (
      <div className="min-h-[100dvh] grid place-items-center bg-page" lang={lang}>
        <span className="mono text-[11px] tracking-[.14em] text-ink-30">
          {lang === 'ta' ? 'ஏற்றப்படுகிறது…' : 'Loading…'}
        </span>
      </div>
    );
  }

  if (phase === 'landing') {
    return <Landing onStart={() => setPhase('onboarding')} lang={lang} setLang={setLang} />;
  }

  if (phase === 'onboarding') {
    return <Onboarding onComplete={handleOnboardingDone} lang={lang} setLang={setLang} />;
  }

  if (phase === 'processing') {
    return (
      <ProcessingSphere
        profile={vault}
        lang={lang}
        schemeCount={schemes?.length || 0}
        onDone={() => setPhase('reveal')}
      />
    );
  }

  if (phase === 'reveal') {
    // No AnimatePresence here. Phases swap by conditional return, so there is
    // never an exiting sibling for it to coordinate — and wrapping a single
    // keyless child left the reveal's staggered entrances stuck at opacity 0.
    return (
      <WowReveal
        count={confirmed.length}
        totals={totals}
        profile={vault}
        lang={lang}
        onContinue={goFeed}
      />
    );
  }

  // AppShell owns the chrome from here on: the desktop rail and top bar, the
  // phone's BottomNav, and the decision to drop both on the full-bleed task
  // screens (/scheme, /apply). Routing stays here.
  return (
    <AppShell feedBadge={feedBadge}>
      <Routes>
        <Route path="/" element={<Navigate to="/feed" replace />} />
        <Route path="/feed" element={<Feed onAlertsChange={setFeedBadge} />} />
        <Route path="/applications" element={<Applications />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/scheme/:id" element={<SchemeDetail />} />
        <Route path="/apply/:id" element={<Apply />} />
        <Route path="*" element={<Navigate to="/feed" replace />} />
      </Routes>
    </AppShell>
  );
}
