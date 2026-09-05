import { NavLink } from 'react-router-dom';

/**
 * BottomNav — the same three destinations the desktop rail carries, on a phone.
 *
 * Ported to the design language: a hairline top rule rather than a shadow, the
 * sidebar's own inline marks rather than emoji (emoji are a different visual
 * system entirely, and render as a different colour, weight and vertical rhythm
 * on every device), and English with Tamil beneath rather than one label chosen
 * by a language switch — a Tamil reader should never have to find a toggle to
 * be addressed, and an English reader should never lose their footing either.
 *
 * "You are here" is carried by ink weight and a short bar on the rule, never by
 * hue: the system has exactly one saturated family and it is spent elsewhere.
 * The count on the right is the mono meta face, as everywhere else.
 */

const Icons = {
  schemes: (p) => (
    <svg width="20" height="20" viewBox="0 0 22 22" fill="currentColor" aria-hidden="true" {...p}>
      <rect x="3" y="3" width="16" height="4" rx="1.4" />
      <rect x="3" y="9.5" width="16" height="4" rx="1.4" />
      <rect x="3" y="16" width="10" height="4" rx="1.4" />
    </svg>
  ),
  applications: (p) => (
    <svg width="20" height="20" viewBox="0 0 22 22" fill="currentColor" aria-hidden="true" {...p}>
      <circle cx="5" cy="5" r="2.4" />
      <rect x="10" y="3.8" width="9" height="2.4" rx="1.2" />
      <circle cx="5" cy="11" r="2.4" />
      <rect x="10" y="9.8" width="9" height="2.4" rx="1.2" />
      <circle cx="5" cy="17" r="2.4" />
      <rect x="10" y="15.8" width="9" height="2.4" rx="1.2" />
    </svg>
  ),
  profile: (p) => (
    <svg width="20" height="20" viewBox="0 0 22 22" fill="currentColor" aria-hidden="true" {...p}>
      <circle cx="11" cy="7" r="4.2" />
      <rect x="3" y="13.6" width="16" height="8" rx="4" />
    </svg>
  ),
};

const ITEMS = [
  { to: '/feed', icon: Icons.schemes, en: 'Schemes', ta: 'திட்டங்கள்' },
  { to: '/applications', icon: Icons.applications, en: 'Applications', ta: 'விண்ணப்பங்கள்' },
  { to: '/profile', icon: Icons.profile, en: 'Profile', ta: 'சுயவிவரம்' },
];

const nf = (n) => Number(n || 0).toLocaleString('en-IN');

export default function BottomNav({ lang = 'en', feedBadge = 0, counts = {} }) {
  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-50 rule-t bg-white/90 backdrop-blur-xl
                 pb-[env(safe-area-inset-bottom)]"
      aria-label={lang === 'ta' ? 'முதன்மை வழிசெலுத்தல்' : 'Main navigation'}
    >
      <div className="max-w-[560px] mx-auto grid grid-cols-3">
        {ITEMS.map((item) => {
          const n = counts[item.to];
          const badge = item.to === '/feed' ? feedBadge : 0;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className="relative flex flex-col items-center gap-[5px] pt-3 pb-2.5"
            >
              {({ isActive }) => (
                <>
                  <span
                    aria-hidden="true"
                    className={`absolute top-0 h-[2px] bg-ink transition-all duration-300 ${
                      isActive ? 'w-7 opacity-100' : 'w-0 opacity-0'
                    }`}
                  />

                  <span className={`relative flex-none ${isActive ? 'text-ink' : 'text-ink-30'}`}>
                    <item.icon />
                    {badge > 0 && (
                      <span
                        className="absolute -top-1.5 -right-2.5 min-w-[17px] h-[17px] px-1 rounded-full
                                   bg-ink text-white text-[10px] font-semibold tabular
                                   flex items-center justify-center leading-none"
                      >
                        {badge > 9 ? '9+' : badge}
                      </span>
                    )}
                  </span>

                  <span className="text-center leading-none">
                    <span
                      className={`block text-[11.5px] leading-[1.25] ${
                        isActive ? 'text-ink font-semibold' : 'text-ink-45'
                      }`}
                    >
                      {item.en}
                    </span>
                    <span
                      className={`ta block text-[9.5px] leading-[1.35] mt-px ${
                        isActive ? 'text-ink-45' : 'text-ink-25'
                      }`}
                      lang="ta"
                    >
                      {item.ta}
                    </span>
                    {n != null && (
                      <span className="mono block text-[9px] tracking-[.12em] text-ink-25 mt-[3px] tabular">
                        {nf(n)}
                      </span>
                    )}
                  </span>

                  {badge > 0 && (
                    <span className="sr-only">
                      {badge} {lang === 'ta' ? 'புதியவை' : 'new'}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
