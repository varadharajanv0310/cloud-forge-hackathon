import { useLanguage } from '../hooks/useLanguage.js';

/**
 * LangToggle — one control, three screens, and the citizen's own language.
 *
 * There used to be three copies of this, each hardcoding தமிழ் as the
 * alternative. On a phone in Bihar that offered a switch to a script the reader
 * cannot use, which is worse than offering nothing: it looks like the product
 * has thought about them and then hands them tofu.
 *
 * What it now offers is whatever language their state actually reads, and where
 * a state has no regional language this app can set type in, it renders NOTHING.
 * A dead toggle is a promise the screen cannot keep, and an empty space is the
 * honest version of that.
 *
 * What it switches is which language LEADS. Both stay on screen either way —
 * the design's whole position is that a reader of either should never have to
 * find a switch to be addressed — but the one they choose is set first and
 * large, and the other becomes the quiet line beneath it.
 */
export default function LangToggle({ className = '', size = 'md' }) {
  const { lang, setLang, secondary, secondaryInfo, monolingual } = useLanguage();

  // Nothing to offer: their state reads English, so there is no second language
  // to switch to and a toggle would be decoration.
  if (monolingual) return null;

  const pad = size === 'sm' ? 'px-[11px] py-1.5' : 'px-[13px] py-1.5';
  const enSize = size === 'sm' ? 'text-[10.5px]' : 'text-[10.5px]';
  const naSize = size === 'sm' ? 'text-[12px]' : 'text-[12.5px]';

  return (
    <div className={`flex rounded-full overflow-hidden border border-rule-16 flex-none ${className}`}>
      <button
        onClick={() => setLang('en')}
        aria-pressed={lang === 'en'}
        className={`mono ${pad} ${enSize} tracking-[.1em] ${
          lang === 'en' ? 'bg-ink text-white' : 'text-ink-70'
        }`}
      >
        EN
      </button>
      <button
        onClick={() => setLang(secondary)}
        aria-pressed={lang === secondary}
        // lang on the element so the script gets its own shaping and the mono
        // rule knows to drop the uppercase transform Indic scripts do not have.
        lang={secondary}
        className={`ta ta-ok ${pad} ${naSize} ${
          lang === secondary ? 'bg-ink text-white' : 'text-ink-70'
        }`}
      >
        {secondaryInfo.native}
      </button>
    </div>
  );
}
