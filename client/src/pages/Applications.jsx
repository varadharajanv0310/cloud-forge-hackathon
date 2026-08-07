import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import StatusTimeline from '../components/StatusTimeline.jsx';
import { loadApplications, saveApplications } from '../utils/applications.js';
import { useLanguage } from '../hooks/useLanguage.js';

/**
 * Applications — what the citizen has already sent, and where each one sits.
 *
 * Logic is unchanged from v1; only the surface is. This is a content screen, so
 * it follows the same shape as the Feed: canvas, one floating surface carrying
 * the single idea ("three applications, one needs you"), a quiet bloom behind,
 * and the timelines as ordinary cards beneath it.
 *
 * No rupee figure appears here. An application's worth is the scheme's, and it
 * is shown on the scheme — repeating it beside a status would imply money is
 * owed on the strength of having applied.
 */

// On mount: if there are no applications yet, seed one "rejected" demo entry
// (PMAY-Gramin) so the timeline + Fix & Resubmit flow can be shown to judges.
const seedIfEmpty = () => {
  const existing = loadApplications();
  if (existing.length === 0) {
    saveApplications([
      {
        scheme_id: 'pmay-gramin',
        submitted_at: Date.now() - 5 * 24 * 60 * 60 * 1000,
        status: 'rejected',
        reject_reason: null, // uses default Tamil/English copy
        documents: ['Aadhaar Card', 'Bank Passbook'],
      },
    ]);
  }
};

export default function Applications() {
  const { lang } = useLanguage();
  const [apps, setApps] = useState([]);
  const reduce = useReducedMotion();

  const ta = lang === 'ta';
  const t = (en, taStr) => (ta ? taStr : en);

  useEffect(() => {
    seedIfEmpty();
    setApps(loadApplications());
    const handler = () => setApps(loadApplications());
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const sorted = [...apps].sort((a, b) => b.submitted_at - a.submitted_at);
  const needsYou = sorted.filter((a) => a.status === 'rejected').length;

  const rise = (delay = 0) => ({
    initial: reduce ? false : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.32, delay, ease: [0.22, 1, 0.36, 1] },
  });

  return (
    <div className="min-h-[100dvh] w-full bg-canvas relative overflow-x-hidden pb-28">
      <div className="bloom bloom-neutral bloom-quiet" aria-hidden="true" />

      <div className="relative z-10 mx-auto w-full max-w-[1120px] px-4 sm:px-6 py-4 sm:py-6">
        <header className="flex items-center justify-between mb-5 px-2">
          <div className="u-display text-[19px] tracking-[-0.02em]">Sevai</div>
          <span className="u-meta" lang={lang}>
            {t('Applications', 'விண்ணப்பங்கள்')}
          </span>
        </header>

        {/* ── the one surface ──────────────────────────────────────────────── */}
        <div className="surface-tray">
          <div className="surface-plate relative overflow-hidden px-6 sm:px-10 lg:px-12 py-9 sm:py-12">
            <div className="bloom bloom-warm bloom-quiet" aria-hidden="true" />

            <div className="relative z-10">
              <motion.div {...rise(0)}>
                <span className="u-meta" lang={lang}>
                  {t('What you have sent', 'நீங்கள் அனுப்பியவை')}
                </span>
              </motion.div>

              <motion.h1
                {...rise(0.04)}
                lang={lang}
                className="u-display text-q sm:text-q-md mt-3 text-ink"
              >
                {apps.length === 0
                  ? t('Nothing sent yet.', 'இதுவரை எதுவும் அனுப்பப்படவில்லை.')
                  : t(
                      `${apps.length} application${apps.length === 1 ? '' : 's'}`,
                      `${apps.length} விண்ணப்பம்`,
                    )}
              </motion.h1>

              <motion.p
                {...rise(0.1)}
                lang={lang}
                className="mt-4 text-[15px] sm:text-body leading-[1.6] text-ink-2 max-w-[56ch]"
              >
                {apps.length === 0
                  ? t(
                      'When you apply for a scheme, it appears here with its status in plain language — and what to do next if something is missing.',
                      'ஒரு திட்டத்திற்கு விண்ணப்பித்தால், அதன் நிலை எளிய மொழியில் இங்கே தெரியும் — ஏதேனும் குறைந்தால் அடுத்து என்ன செய்வது என்பதும்.',
                    )
                  : needsYou > 0
                    ? t(
                        `${needsYou} of them need something from you. The rest are with the department.`,
                        `அவற்றில் ${needsYou} உங்களிடமிருந்து ஏதோ ஒன்றை எதிர்பார்க்கிறது. மற்றவை துறையின் பரிசீலனையில் உள்ளன.`,
                      )
                    : t(
                        'All of them are with the department. Nothing is waiting on you.',
                        'அனைத்தும் துறையின் பரிசீலனையில் உள்ளன. உங்களிடம் எதுவும் நிலுவையில் இல்லை.',
                      )}
              </motion.p>
            </div>
          </div>
        </div>

        {/* ── the timelines ────────────────────────────────────────────────── */}
        <div className="mt-6 space-y-3">
          {sorted.map((app, i) => (
            <motion.div
              key={`${app.scheme_id}-${i}`}
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, delay: Math.min(i, 6) * 0.05, ease: [0.22, 1, 0.36, 1] }}
            >
              <StatusTimeline app={app} lang={lang} />
            </motion.div>
          ))}
        </div>

        {apps.length === 0 && (
          <div className="card mt-6">
            <div className="u-meta" lang={lang}>{t('Where to start', 'எங்கே தொடங்குவது')}</div>
            <p className="mt-2 text-[15px] leading-[1.6] text-muted max-w-[56ch]" lang={lang}>
              {t(
                'Open any scheme from your list and follow the link to the official page. Sevai does not submit anything on your behalf.',
                'உங்கள் பட்டியலில் உள்ள எந்தத் திட்டத்தையும் திறந்து, அதிகாரப்பூர்வ பக்கத்திற்குச் செல்லுங்கள். சேவை உங்கள் சார்பாக எதையும் சமர்ப்பிக்காது.',
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
