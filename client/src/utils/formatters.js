// Small formatting helpers used across cards and the feed.
export const formatRupees = (n) => {
  if (n == null) return '—';
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(0)}K`;
  return `₹${n}`;
};

export const formatTime = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m} min ${s} sec`;
};

export const formatTimeTa = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m} நிமிடம் ${s} விநாடி`;
};

export const deadlineColor = (daysLeft) => {
  if (daysLeft <= 7) return '#E53935'; // red (pressure)
  if (daysLeft <= 21) return '#FB8C00'; // amber
  return '#43A047'; // green
};

// Covers the full v2 category set. v1 handled five and defaulted everything
// else to a clipboard, which was most of the catalogue.
export const categoryEmoji = (cat) =>
  ({
    farming: '🌾',
    education: '📚',
    housing: '🏠',
    health: '🏥',
    women: '👩',
    employment: '💼',
    business: '🏪',
    elderly: '🧓',
    disability: '♿',
    welfare: '🤝',
    sports: '🏅',
  }[cat] || '📋');

export const occupationKey = (o) =>
  ({
    Farmer: 'farmer',
    Student: 'student',
    'Daily Wage Worker': 'daily_wage',
    'Small Business': 'small_business',
    Homemaker: 'homemaker',
    Other: 'other',
  }[o] || o);

export const incomeBandToMax = (band) =>
  ({
    'under_1l': 80000,
    '1_2_5l': 180000,
    '2_5_5l': 400000,
    'above_5l': 800000,
  }[band] ?? 100000);

export const ageBandToNumber = (band) =>
  ({
    'under_18': 16,
    '18_25': 22,
    '26_40': 33,
    '41_60': 50,
    '60_plus': 65,
  }[band] ?? 30);

// ─── v2 money vocabulary ────────────────────────────────────────────────────
// One place decides how money is described, so a card, the feed header and the
// detail page can never disagree — and so a loan can never be rendered as
// though it were cash in hand.

const TA = {
  perYear: 'ஆண்டுக்கு',
  perMonth: 'மாதம்',
  oneTime: 'ஒரு முறை',
  loan: 'கடன் வசதி',
  subsidy: 'மானியம்',
  cover: 'காப்பீட்டுத் தொகை',
  inKind: 'பொருள் உதவி',
  notPublished: 'தொகை அறிவிக்கப்படவில்லை',
  seeScheme: 'திட்டத்தைப் பார்க்க',
};

/**
 * How one scheme's benefit should read.
 * @returns {{primary: string, secondary: string, tone: string}}
 *   tone ∈ cash | loan | subsidy | insurance | inkind | unknown
 */
export function formatBenefit(benefit, lang = 'en') {
  const ta = lang === 'ta';
  const b = benefit || {};

  if (b.cash) {
    const amount = formatRupees(b.cash);
    if (b.cash_frequency === 'monthly') {
      const monthly = formatRupees(b.cash_raw);
      return {
        primary: amount,
        secondary: ta
          ? `${TA.perYear} (${TA.perMonth} ${monthly})`
          : `per year (${monthly}/month)`,
        tone: 'cash',
      };
    }
    if (b.cash_frequency === 'annual') {
      return { primary: amount, secondary: ta ? TA.perYear : 'per year', tone: 'cash' };
    }
    // 'one_time' and 'unknown' are both shown as one-time. Presenting an
    // unqualified figure as recurring is the overstatement v2 removes.
    return { primary: amount, secondary: ta ? TA.oneTime : 'one-time', tone: 'cash' };
  }

  if (b.loan_ceiling) {
    return {
      primary: `${ta ? '' : 'Up to '}${formatRupees(b.loan_ceiling)}`,
      secondary: ta ? TA.loan : 'loan available — to be repaid',
      tone: 'loan',
    };
  }

  if (b.subsidy) {
    return {
      primary: formatRupees(b.subsidy),
      secondary: ta ? TA.subsidy : 'subsidy on cost',
      tone: 'subsidy',
    };
  }

  if (b.insurance_cover) {
    return {
      primary: formatRupees(b.insurance_cover),
      secondary: ta ? TA.cover : 'insurance cover',
      tone: 'insurance',
    };
  }

  if (b.in_kind) {
    return {
      primary: ta ? TA.inKind : 'In kind',
      secondary: String(b.in_kind).slice(0, 48),
      tone: 'inkind',
    };
  }

  return {
    primary: ta ? TA.seeScheme : 'See scheme',
    secondary: ta ? TA.notPublished : 'amount not published',
    tone: 'unknown',
  };
}

/**
 * Text colour per benefit tone.
 *
 * Cash is ink — the only kind rendered at full contrast, and the only one that
 * ever takes the display face. Everything else is muted, so a loan ceiling
 * cannot be mistaken for money received. Colour alone is never the signal
 * (see DESIGN.md §2): each kind also differs in face, weight and container.
 */
export const benefitToneClass = (tone) =>
  ({
    cash: 'text-ink',
    subsidy: 'text-ink-2',
    loan: 'text-muted',
    insurance: 'text-muted',
    inkind: 'text-muted',
    unknown: 'text-muted',
  }[tone] || 'text-ink');

/**
 * Rows for the feed header.
 *
 * Deliberately returns no grand total. Summing every matched scheme yields
 * ~Rs 3.8 crore against the India-wide corpus — arithmetically correct and
 * still a lie, because nobody applies to 390 schemes. The headline is built
 * from the strongest matches by fit; the rest is shown as context.
 *
 * @returns {Array<{key, label, value, tone, emphasis}>}
 */
export function formatTotals(totals, lang = 'en') {
  const ta = lang === 'ta';
  const t = totals || {};
  const rows = [];

  if (t.focusCashAnnual > 0) {
    rows.push({
      key: 'focusAnnual',
      label: ta
        ? `சிறந்த ${t.focusCount} திட்டங்கள் · ஆண்டுக்கு`
        : `Top ${t.focusCount} matches · per year`,
      value: formatRupees(t.focusCashAnnual),
      tone: 'cash',
      emphasis: true,
    });
  }
  if (t.focusCashOneTime > 0) {
    rows.push({
      key: 'focusOneTime',
      label: ta ? 'ஒரு முறை பணம்' : 'one-time payments',
      value: formatRupees(t.focusCashOneTime),
      tone: 'cash',
      emphasis: !(t.focusCashAnnual > 0),
    });
  }
  if (t.loanCeiling > 0) {
    rows.push({
      key: 'loan',
      label: ta ? 'கடன் வசதி (திருப்பிச் செலுத்த வேண்டும்)' : 'credit available — to be repaid',
      value: formatRupees(t.loanCeiling),
      tone: 'loan',
      emphasis: false,
    });
  }
  if (t.unvaluedCount > 0) {
    rows.push({
      key: 'unvalued',
      label: ta
        ? `மேலும் ${t.unvaluedCount} திட்டங்கள் — தொகை அறிவிக்கப்படவில்லை`
        : `+${t.unvaluedCount} more — amount not published`,
      value: '',
      tone: 'unknown',
      emphasis: false,
    });
  }
  return rows;
}

/**
 * Honest one-line framing of the match count. Most of the catalogue carries no
 * eligibility restrictions at all, so a bare "390 matches" reads as far more
 * personal than it is.
 */
export function formatMatchSummary(totals, lang = 'en') {
  const t = totals || {};
  const targeted = t.targetedCount || 0;
  const open = t.openCount || 0;
  if (lang === 'ta') {
    return `${targeted} திட்டங்கள் உங்களைப் போன்றவர்களுக்கானவை · மேலும் ${open} அனைவருக்கும் திறந்தவை`;
  }
  return `${targeted} written for someone like you · ${open} more open to all citizens`;
}

/** Ranking weight. Recurring cash matters most; a loan ceiling is not income. */
export function benefitSortValue(benefit) {
  const b = benefit || {};
  const recurring = b.cash_frequency === 'annual' || b.cash_frequency === 'monthly';
  return (b.cash || 0) * (recurring ? 1.5 : 1)
    + (b.subsidy || 0) * 0.8
    + (b.loan_ceiling || 0) * 0.15
    + (b.insurance_cover || 0) * 0.05;
}
