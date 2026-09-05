import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from '../hooks/useLanguage.js';
import { useVault } from '../hooks/useVault.js';
import { useEligibility } from '../hooks/useEligibility.js';
import { QUESTIONS } from '../data/profileSchema.js';
import { loadManifest } from '../utils/schemesStore.js';
import { loadApplications } from '../utils/applications.js';
import BottomNav from './BottomNav.jsx';
import LangToggle from './LangToggle.jsx';

/**
 * AppShell — ported from the Claude Design source (Sevai.dc.html, the desktop
 * frame at lines 174–250).
 *
 * The prototype drew this inside a device bezel with a Desktop/Mobile toggle;
 * none of that is product. What IS product is the shape: a 66px hairline top
 * bar carrying the wordmark, a search affordance, the language pill and the
 * citizen, and a 264px left rail carrying the three destinations with their
 * real counts, the Sahayak entry in its own warm dashed treatment, and a footer
 * that repeats the promise the whole product rests on — nothing leaves the
 * device.
 *
 * It is a real responsive shell, not a desktop-only skin: the rail and top bar
 * appear from `lg:` up, and below that the same three destinations are carried
 * by BottomNav. Both read the same counts, so the two can never disagree.
 */

const FALLBACK = { schemes: 4643, states: 36, refreshed: '06 Aug 2026' };

function useCorpusStats() {
  const [s, setS] = useState(FALLBACK);
  useEffect(() => {
    loadManifest()
      .then((m) => {
        if (!m) return;
        setS({
          schemes:
            m.total_schemes
            || (m.central_count || 0) + (m.states || []).reduce((n, x) => n + x.count, 0),
          states: (m.states || []).length || FALLBACK.states,
          refreshed: m.generated_at
            ? new Date(m.generated_at).toLocaleDateString('en-GB', {
                day: '2-digit', month: 'short', year: 'numeric',
              })
            : FALLBACK.refreshed,
        });
      })
      .catch(() => {});
  }, []);
  return s;
}

/**
 * Applications live in localStorage; another tab may add one, and the
 * Applications screen itself seeds the demo entry on first visit — so the count
 * is re-read on every navigation as well as on storage and focus. A rail that
 * says 0 next to a list of three is worse than no count at all.
 */
function useApplicationCount(pathname) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const read = () => setN(loadApplications().length);
    read();
    const timer = setTimeout(read, 300); // after the screen's own seed writes
    window.addEventListener('storage', read);
    window.addEventListener('focus', read);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('storage', read);
      window.removeEventListener('focus', read);
    };
  }, [pathname]);
  return n;
}

const nf = (n) => Number(n || 0).toLocaleString('en-IN');

/* ── the three destination marks, taken from the source's sidebar ────────── */
const Icons = {
  schemes: (p) => (
    <svg width="19" height="19" viewBox="0 0 22 22" fill="currentColor" aria-hidden="true" {...p}>
      <rect x="3" y="3" width="16" height="4" rx="1.4" />
      <rect x="3" y="9.5" width="16" height="4" rx="1.4" />
      <rect x="3" y="16" width="10" height="4" rx="1.4" />
    </svg>
  ),
  applications: (p) => (
    <svg width="19" height="19" viewBox="0 0 22 22" fill="currentColor" aria-hidden="true" {...p}>
      <circle cx="5" cy="5" r="2.4" />
      <rect x="10" y="3.8" width="9" height="2.4" rx="1.2" />
      <circle cx="5" cy="11" r="2.4" />
      <rect x="10" y="9.8" width="9" height="2.4" rx="1.2" />
      <circle cx="5" cy="17" r="2.4" />
      <rect x="10" y="15.8" width="9" height="2.4" rx="1.2" />
    </svg>
  ),
  profile: (p) => (
    <svg width="19" height="19" viewBox="0 0 22 22" fill="currentColor" aria-hidden="true" {...p}>
      <circle cx="11" cy="7" r="4.2" />
      <rect x="3" y="13.6" width="16" height="8" rx="4" />
    </svg>
  ),
};

/** The avatar is painted, never an uploaded photograph — there is no account. */
const AVATAR_BG =
  'radial-gradient(60% 60% at 34% 30%,rgba(192,172,240,.95),rgba(192,172,240,0) 72%),'
  + 'radial-gradient(60% 60% at 70% 72%,rgba(248,201,156,.95),rgba(248,201,156,0) 74%),#EFEFF3';

export default function AppShell({ children, feedBadge = 0 }) {
  const { lang, setLang } = useLanguage();
  const { vault } = useVault();
  const { totalCount, loading } = useEligibility(vault);
  const corpus = useCorpusStats();
  const loc = useLocation();
  const nav = useNavigate();
  const appCount = useApplicationCount(loc.pathname);

  // Only the questions this citizen was actually asked, and actually answered.
  const answeredCount = QUESTIONS.filter(
    (q) => (q.askWhen ? q.askWhen(vault) : true)
      && vault[q.key] !== undefined && vault[q.key] !== null && vault[q.key] !== '',
  ).length;

  // Scheme detail and the apply flow are full-bleed tasks: they take the whole
  // window, exactly as they did before the shell existed.
  const bare = ['/apply', '/scheme'].some((p) => loc.pathname.startsWith(p));

  const counts = {
    '/feed': loading ? null : totalCount,
    '/applications': appCount,
    '/profile': answeredCount,
  };

  if (bare) return <div className="min-h-[100dvh] bg-page">{children}</div>;

  const items = [
    { to: '/feed', icon: Icons.schemes, en: 'Schemes', ta: 'திட்டங்கள்' },
    { to: '/applications', icon: Icons.applications, en: 'Applications', ta: 'விண்ணப்பங்கள்' },
    { to: '/profile', icon: Icons.profile, en: 'Profile', ta: 'சுயவிவரம்' },
  ];

  const isOn = (to) =>
    to === '/feed' ? loc.pathname === '/' || loc.pathname.startsWith('/feed')
      : loc.pathname.startsWith(to);

  return (
    <div className="min-h-[100dvh] bg-page">
      {/* ── top bar (desktop) ──────────────────────────────────────────────── */}
      <header className="hidden lg:flex sticky top-0 z-40 items-center gap-7 h-[66px] px-[26px] bg-white rule-b">
        <div className="flex items-baseline gap-2.5 flex-none">
          <span className="text-[19px] font-bold tracking-[-.035em]">Sevai</span>
          <span className="ta text-[13px] font-medium text-ink-30" lang="ta">சேவை</span>
        </div>

        {/* The search lives on the feed, where the filters and the list are.
            This is the way in, not a second search that could disagree. */}
        <button
          onClick={() => nav('/feed')}
          className="flex-1 min-w-0 max-w-[520px] h-10 flex items-center gap-2.5 px-[13px]
                     border border-rule-16 rounded-flat bg-page text-left
                     hover:border-rule-22 transition-colors"
        >
          <span className="w-3 h-3 rounded-full border-[1.5px] border-ink-30 flex-none" aria-hidden="true" />
          <span className="text-[14px] text-ink-25 truncate tabular">
            Search {nf(corpus.schemes)} schemes
          </span>
        </button>

        <div className="flex-1" />

        <LangToggle />

        <button
          onClick={() => nav('/profile')}
          className="flex items-center gap-2.5 flex-none"
          aria-label={lang === 'ta' ? 'சுயவிவரம்' : 'Profile'}
        >
          <span
            className="w-[34px] h-[34px] rounded-full border border-rule-12 flex-none"
            style={{ background: AVATAR_BG }}
            aria-hidden="true"
          />
          <span className="min-w-0 text-left">
            <span className="block text-[13.5px] font-semibold tracking-[-.01em] leading-[1.3] truncate max-w-[150px]">
              {vault.name || (lang === 'ta' ? 'உங்கள் விவரம்' : 'Your profile')}
            </span>
            <span className="block text-[11.5px] text-ink-30 leading-[1.45] truncate max-w-[150px]">
              {vault.state || (lang === 'ta' ? 'மாநிலம் இல்லை' : 'No state yet')}
            </span>
          </span>
        </button>
      </header>

      <div className="lg:grid lg:grid-cols-[264px_minmax(0,1fr)] lg:items-stretch">
        {/* ── the rail (desktop) ───────────────────────────────────────────── */}
        <aside className="hidden lg:flex sticky top-[66px] h-[calc(100dvh-66px)] flex-col gap-0.5
                          rule-r bg-white px-4 py-[22px]">
          <div className="mono text-[9.5px] tracking-[.14em] text-ink-25 px-2.5 pb-2.5">
            Your account
          </div>

          {items.map((it) => {
            const on = isOn(it.to);
            const n = counts[it.to];
            return (
              <button
                key={it.to}
                onClick={() => nav(it.to)}
                aria-current={on ? 'page' : undefined}
                className={`flex items-center justify-between gap-2.5 px-3 py-[11px] rounded-flat
                            transition-colors ${
                              on ? 'bg-ink text-white font-semibold' : 'text-ink-90 hover:bg-black/[.035]'
                            }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <it.icon className="flex-none" />
                  <span className="min-w-0">
                    <span className="block text-[14.5px] leading-[1.3]">{it.en}</span>
                    <span className="ta block text-[11.5px] leading-[1.45] mt-px opacity-[.62]" lang="ta">
                      {it.ta}
                    </span>
                  </span>
                </span>
                <span className="mono text-[10.5px] opacity-60 flex-none tabular">
                  {n == null ? '—' : nf(n)}
                </span>
              </button>
            );
          })}

          <div className="h-px bg-rule-12 mx-2.5 my-4" />

          <button
            onClick={() => nav('/profile#sahayak')}
            className="sahayak flex items-center justify-between gap-2.5 px-3 py-[11px]"
          >
            <span>
              <span className="block text-[14px] font-medium leading-[1.3]">Sahayak mode</span>
              <span className="ta block text-[11.5px] leading-[1.45] text-[color:var(--sah-ink-2)]" lang="ta">
                உதவியாளர் முறை
              </span>
            </span>
          </button>

          <div className="flex-1 min-h-[34px]" />

          <div className="rule-t pt-3.5 px-2.5">
            <div className="flex gap-2.5 items-start">
              <span className="w-2 h-2 rounded-[2px] bg-ink mt-1 flex-none" aria-hidden="true" />
              <div>
                <div className="text-[12.5px] leading-[1.55] text-ink-45">
                  Your answers are stored on this device only. Nothing is uploaded.
                </div>
                <div className="ta text-[12px] leading-[1.5] text-ink-30 mt-1" lang="ta">
                  உங்கள் பதில்கள் இந்தச் சாதனத்தில் மட்டுமே.
                </div>
              </div>
            </div>
            <div className="mono text-[9.5px] tracking-[.11em] text-ink-15 mt-3.5 leading-[1.7] tabular">
              Corpus {nf(corpus.schemes)} · {corpus.states} states
              <br />
              Refreshed {corpus.refreshed}
            </div>
          </div>
        </aside>

        {/* ── the routed screen ────────────────────────────────────────────── */}
        <main className="min-w-0 relative pb-[96px] lg:pb-0">{children}</main>
      </div>

      <BottomNav lang={lang} feedBadge={feedBadge} counts={counts} />
    </div>
  );
}
