/**
 * alertEngine.js — Community Scheme Alert matching engine.
 * Runs entirely client-side against local vault + scheme data.
 */
import { hardFilter } from './eligibilityEngine.js';

export const getRelevantAlerts = (schemes, profile, lastChecked) => {
  const alerts = [];
  const now = Date.now();

  // Alert deadline window from profile prefs (default 7 days)
  const deadlineWindow = profile?.alert_deadline_days ?? 7;
  // Alert category filter (default: all enabled)
  const alertCategories = profile?.alert_categories ?? null; // null = all

  schemes.forEach((scheme) => {
    // Only schemes the user qualifies for
    if (!hardFilter(scheme, profile)) return;

    // Category filter
    if (alertCategories && !alertCategories[scheme.category]) return;

    // New scheme (added after lastChecked)
    if (scheme.added_date && new Date(scheme.added_date) > lastChecked) {
      alerts.push({
        type: 'new_scheme',
        scheme,
        priority: 'high',
        message_ta: `புதிய திட்டம்: ${scheme.name_plain}`,
        message_en: `New scheme: ${scheme.name_plain}`,
      });
    }

    // Expiring soon
    if (scheme.deadline) {
      const daysLeft = Math.ceil(
        (new Date(scheme.deadline) - now) / (1000 * 60 * 60 * 24),
      );
      if (daysLeft <= deadlineWindow && daysLeft > 0) {
        alerts.push({
          type: 'expiring',
          scheme,
          daysLeft,
          priority: daysLeft <= 3 ? 'urgent' : 'high',
          message_ta: `${scheme.name_plain} — ${daysLeft} நாட்களில் காலாவதியாகும்`,
          message_en: `${scheme.name_plain} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
        });
      }
    }
  });

  // Max 3 alerts — urgent first, then high
  return alerts
    .sort((a, b) => (a.priority === 'urgent' ? -1 : b.priority === 'urgent' ? 1 : 0))
    .slice(0, 3);
};

/** Request browser push permission and register the SW push subscription. */
export const requestNotificationPermission = async () => {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  const result = await Notification.requestPermission();
  return result;
};

/**
 * Body copy for a scheme notification.
 *
 * v1 read `scheme.benefit_amount` and fell back to `|| 0`, so every scheme
 * whose amount the parser could not read — which is most of the corpus —
 * pushed a notification promising "Benefit: ₹0". A notification is the one
 * surface a citizen cannot inspect for context, so an unpublished amount is
 * omitted entirely rather than printed as a numeral.
 *
 * Only `benefit.cash` is quoted. A loan ceiling is borrowing capacity, not
 * money received, and a push notification has no room to carry that
 * distinction — so it is never used as the figure.
 */
export const notificationBody = (scheme, lang = 'ta') => {
  const cash = scheme?.benefit?.cash;
  const ta = lang === 'ta';

  if (!cash) {
    return ta
      ? 'நீங்கள் தகுதியானவர். விவரங்களைப் பார்க்க திறக்கவும்.'
      : 'You qualify — open Sevai to see the details.';
  }

  const amount = `₹${cash.toLocaleString('en-IN')}`;
  const freq = scheme.benefit.cash_frequency;
  const recurring = freq === 'annual' || freq === 'monthly';

  if (recurring) {
    return ta
      ? `நீங்கள் தகுதியானவர். ஆண்டுக்கு ${amount} வரை.`
      : `You qualify — ${amount} per year.`;
  }
  return ta
    ? `நீங்கள் தகுதியானவர். ஒரு முறை ${amount}.`
    : `You qualify — ${amount}, one-time.`;
};

/**
 * Trigger a local push notification immediately (for demo / judge trigger).
 * Uses the service worker's showNotification so it fires even when minimized.
 */
export const triggerDemoNotification = async (scheme, lang = 'ta') => {
  const perm = await requestNotificationPermission();
  if (perm !== 'granted') return false;

  const title = lang === 'ta' ? `புதிய திட்டம்: ${scheme.name_plain}` : `New scheme: ${scheme.name_plain}`;
  const body = notificationBody(scheme, lang);

  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    if (reg) {
      reg.showNotification(title, {
        body,
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        tag: `sevai-alert-${scheme.id}`,
        data: { schemeId: scheme.id },
      });
      return true;
    }
  }

  // Fallback: direct Notification API
  new Notification(title, { body, icon: '/favicon.svg' });
  return true;
};
