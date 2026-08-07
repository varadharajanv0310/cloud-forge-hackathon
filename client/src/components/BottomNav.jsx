import { NavLink } from 'react-router-dom';
import { t } from '../data/strings.js';

/**
 * BottomNav.
 *
 * The previous version leaned on colour to say "you are here" — an iOS blue
 * active state, a red badge, and grayscale-plus-drop-shadow on the icons. None
 * of that survives contact with the palette: the system has exactly one
 * saturated family (the bloom) and it is reserved for state temperature.
 *
 * So position is carried structurally instead: a hairline rule above, a short
 * ink bar over the active item, and ink versus muted for the label. The badge
 * stays — it is a real count — but it is an ink pill, not an alarm.
 */
export default function BottomNav({ lang, feedBadge = 0 }) {
  const items = [
    { to: '/feed', labelKey: 'nav_feed', emoji: '🏠', badge: feedBadge },
    { to: '/applications', labelKey: 'nav_apps', emoji: '📄', badge: 0 },
    { to: '/profile', labelKey: 'nav_profile', emoji: '👤', badge: 0 },
  ];

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-50 border-t border-hairline bg-surface/90 backdrop-blur-xl
                 pb-[env(safe-area-inset-bottom)]"
      aria-label={lang === 'ta' ? 'முதன்மை வழிசெலுத்தல்' : 'Main navigation'}
    >
      <div className="max-w-lg mx-auto grid grid-cols-3">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className="relative flex flex-col items-center gap-1 pt-3 pb-2.5 transition-colors duration-240 ease-composed"
          >
            {({ isActive }) => (
              <>
                {/* "You are here" without colour: a short ink bar on the rule. */}
                <span
                  aria-hidden="true"
                  className={`absolute top-0 h-[2px] rounded-full bg-ink transition-all duration-320 ease-composed ${
                    isActive ? 'w-7 opacity-100' : 'w-0 opacity-0'
                  }`}
                />

                <span
                  className={`relative text-[21px] leading-none transition-opacity duration-240 ease-composed ${
                    isActive ? 'opacity-100' : 'opacity-45'
                  }`}
                  aria-hidden="true"
                >
                  {item.emoji}
                  {item.badge > 0 && (
                    <span
                      className="absolute -top-1.5 -right-2 min-w-[17px] h-[17px] px-1 rounded-full
                                 bg-ink text-white text-[10px] font-semibold tabular
                                 flex items-center justify-center leading-none"
                    >
                      {item.badge > 9 ? '9+' : item.badge}
                    </span>
                  )}
                </span>

                <span
                  className={`u-meta transition-colors duration-240 ${isActive ? '!text-ink' : 'text-muted'}`}
                  lang={lang}
                >
                  {t(item.labelKey, lang)}
                </span>

                {item.badge > 0 && (
                  <span className="sr-only">
                    {item.badge} {lang === 'ta' ? 'புதியவை' : 'new'}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
