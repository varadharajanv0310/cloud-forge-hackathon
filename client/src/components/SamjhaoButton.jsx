import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { t } from '../data/strings.js';
import { useTTS } from '../hooks/useTTS.js';

/**
 * SamjhaoButton — the "Kelungal" read-aloud control.
 *
 * Fetches a plain-language summary from /api/summarize-scheme, then speaks it.
 * The audio path is unchanged; only the surface is. It is the primary action on
 * a scheme card for anyone reading slowly, so it takes the primary button —
 * ink, full width, ≥52px — and the waveform replaces the icon in place rather
 * than appearing beside it, so the row never reflows mid-sentence.
 */
const localCache = new Map();

export default function SamjhaoButton({ scheme, lang }) {
  const { speak, stop, isPlaying, isLoading } = useTTS();
  const [bullets, setBullets] = useState([]);
  const [audioText, setAudioText] = useState('');
  const [error, setError] = useState(null);
  // Track whether THIS button is the one currently active
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);

  // When isPlaying goes false externally (another button started), deactivate
  useEffect(() => {
    if (!isPlaying && activeRef.current) {
      setActive(false);
      activeRef.current = false;
    }
  }, [isPlaying]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (activeRef.current) stop();
    };
  }, [stop]);

  const fetchSummary = async () => {
    const key = `${scheme.id}:${lang}`;
    if (localCache.has(key)) return localCache.get(key);
    const res = await fetch('/api/summarize-scheme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheme, language: lang }),
    });
    if (!res.ok) throw new Error('summary-failed');
    const data = await res.json();
    localCache.set(key, data);
    return data;
  };

  const handleClick = async (e) => {
    e.stopPropagation();

    // If THIS button is playing → stop
    if (active && isPlaying) {
      stop();
      setActive(false);
      activeRef.current = false;
      return;
    }

    setError(null);
    let textToSpeak = audioText;
    let bulletsToShow = bullets;

    // Need to fetch summary first?
    if (!textToSpeak) {
      try {
        const data = await fetchSummary();
        bulletsToShow = data.bullets || [];
        textToSpeak = data.audio_text || bulletsToShow.join('. ');
        setBullets(bulletsToShow);
        setAudioText(textToSpeak);
      } catch {
        const fallback = scheme.description_simple || [];
        bulletsToShow = fallback;
        textToSpeak = fallback.join('. ');
        setBullets(fallback);
        setAudioText(textToSpeak);
        setError(lang === 'ta' ? 'சுருக்கம் உள்ளூர் தகவலில் இருந்து' : 'Summary from local data');
      }
    }

    setActive(true);
    activeRef.current = true;
    speak(textToSpeak, lang, {
      onEnd: () => {
        setActive(false);
        activeRef.current = false;
      },
    });
  };

  // Determine display state: loading = fetching summary OR waiting for audio
  const showLoading = isLoading && active;
  const showPlaying = isPlaying && active;
  const ta = lang === 'ta';

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <button
        onClick={handleClick}
        disabled={isLoading && !active} // disabled only if another button is loading
        aria-live="polite"
        lang={lang}
        className="btn-primary w-full flex items-center justify-center gap-3
                   disabled:opacity-50 disabled:shadow-e1"
      >
        <span className="w-6 h-6 grid place-items-center shrink-0" aria-hidden="true">
          {showLoading ? (
            <span className="w-4 h-4 border-2 border-white/35 border-t-white rounded-full animate-spin" />
          ) : showPlaying ? (
            <WaveformBars />
          ) : (
            <SpeakerGlyph />
          )}
        </span>
        <span>
          {showLoading
            ? ta ? 'தயாராகிறது…' : 'Preparing…'
            : showPlaying
            ? ta ? 'படிக்கிறது… (நிறுத்த தட்டவும்)' : 'Reading aloud… (tap to stop)'
            : t('listen_kelungal', lang)}
        </span>
      </button>

      <AnimatePresence>
        {bullets.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="well mt-3 px-4 py-3.5">
              <ul className="space-y-2 text-[15px] leading-relaxed text-ink-2" lang={lang}>
                {bullets.map((b, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="text-muted shrink-0 select-none" aria-hidden="true">
                      —
                    </span>
                    <span>{String(b).replace(/^[✓\-•]\s*/, '')}</span>
                  </li>
                ))}
              </ul>
              {error && (
                <div className="u-meta mt-3" lang={lang}>
                  {error}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SpeakerGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" />
      <path d="M15.5 9.2a4 4 0 0 1 0 5.6" />
      <path d="M18.4 6.6a8 8 0 0 1 0 10.8" />
    </svg>
  );
}

/* Five bars on the tailwind `wave` keyframe (scaleY), anchored to the baseline.
   prefers-reduced-motion is handled globally in index.css, which flattens the
   animation rather than removing the bars — the playing state stays legible. */
function WaveformBars() {
  return (
    <span className="flex items-end h-5 gap-[2.5px]" aria-hidden="true">
      {[10, 16, 8, 14, 11].map((h, i) => (
        <span
          key={i}
          className="w-[2.5px] rounded-full bg-white animate-wave"
          style={{ height: `${h}px`, transformOrigin: 'bottom', animationDelay: `${i * 90}ms` }}
        />
      ))}
    </span>
  );
}
