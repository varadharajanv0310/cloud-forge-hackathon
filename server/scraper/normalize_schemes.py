#!/usr/bin/env python3
"""
normalize_schemes.py — raw_schemes.json -> sharded client data (supersedes normalizeLocal.js)

See SCHEMA.md for the output contract. The three faults this fixes:

  1. MONEY.  v1 took Math.max() over every rupee figure in the benefits text, so
     "a loan up to Rs 10,00,000" became a Rs 10 lakh benefit, and grants, loans
     and subsidies were one undifferentiated number summed into a headline.
     v2 parses clause by clause, classifies each figure as cash / loan / subsidy
     / in-kind, and records frequency so monthly and one-time are never confused.

  2. ELIGIBILITY.  v1 regex-guessed from prose; "Rs 5 lakh" parsed as 5, which is
     why a card read "For families earning under Rs 5 per year". v2 reads
     myScheme's structured facets and only falls back to prose for numeric
     thresholds, where it handles lakh/crore and monthly->annual.

  3. SCOPE.  v1 hardcoded state:'Tamil Nadu'. v2 carries level + state so a
     citizen sees central schemes plus their own state's, and nothing else.

Usage:  python3 server/scraper/normalize_schemes.py
"""

import html
import json
import os
import random
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
RAW_FILE = os.path.join(HERE, "raw_schemes.json")
OUT_DIR = os.path.abspath(os.path.join(HERE, "../../client/public/data"))
SCHEMA_VERSION = 2

# ---------------------------------------------------------------------------
# Category mapping. v1's mapCategoryFromTags() was dead code — mapCategory()
# always returned a value (defaulting to 'employment'), so the tag-based branch
# never ran and 90/233 schemes landed in 'employment' with health at 4 and
# housing at 1. Here every myScheme category maps explicitly.
# ---------------------------------------------------------------------------
CATEGORY_MAP = {
    "Agriculture,Rural & Environment": "farming",
    "Education & Learning": "education",
    "Skills & Employment": "employment",
    "Women and Child": "women",
    "Health & Wellness": "health",
    "Housing & Shelter": "housing",
    "Business & Entrepreneurship": "business",
    "Banking,Financial Services and Insurance": "business",
    "Social welfare & Empowerment": "welfare",
    "Sports & Culture": "sports",
    "Science, IT & Communications": "education",
    "Transport & Infrastructure": "employment",
    "Travel & Tourism": "business",
    "Utility & Sanitation": "health",
    "Public Safety,Law & Justice": "welfare",
}

# Refine the broad 'welfare' bucket using tags/sub-category, so elderly and
# disability schemes surface under their own headings instead of a catch-all.
TAG_REFINEMENTS = [
    ("elderly", ("old age", "senior citizen", "elderly", "pension for old", "vayo")),
    ("disability", ("disabilit", "divyang", "handicap", "differently abled", "visually impaired")),
    ("women", ("widow", "women", "girl child", "maternity", "bride", "mother")),
    ("education", ("scholarship", "student", "school", "college", "tuition", "education")),
    ("health", ("health", "medical", "hospital", "treatment", "insurance cover")),
    ("housing", ("housing", "house construction", "shelter", "dwelling")),
    ("farming", ("farmer", "agricultur", "crop", "horticultur", "fisher", "livestock")),
]

CASTE_MAP = {
    "Scheduled Caste (SC)": "SC",
    "Scheduled Tribe (ST)": "ST",
    "Other Backward Class (OBC)": "OBC",
    "General": "General",
    "Particularly Vulnerable Tribal Group (PVTG)": "ST",
    "De-Notified, Nomadic, and Semi-Nomadic (DNT) communities": "OBC",
}

# myScheme's 20 occupations collapsed onto the six the onboarding actually
# collects. occupation_raw keeps the original for display.
OCCUPATION_MAP = {
    "Farmer": "farmer",
    "Fishermen": "farmer",
    "Student": "student",
    "Construction Worker": "daily_wage",
    "Unorganized Worker": "daily_wage",
    "Organized Worker": "daily_wage",
    "Safai Karamchari": "daily_wage",
    "Artisans, Spinners & Weavers": "small_business",
    "Artists": "small_business",
    "Entrepreneur": "small_business",
    "Self Employed": "small_business",
    "Unemployed": "unemployed",
    "Housewife": "homemaker",
}

GENDER_MAP = {"Female": "female", "Male": "male", "Transgender": "transgender"}

# ---------------------------------------------------------------------------
# Money parsing
# ---------------------------------------------------------------------------
MULTIPLIERS = {
    "lakh": 100_000, "lakhs": 100_000, "lac": 100_000, "lacs": 100_000,
    "crore": 10_000_000, "crores": 10_000_000, "cr": 10_000_000,
    "thousand": 1_000,
}

# Currency-prefixed figure, with an optional Indian magnitude word after it.
AMOUNT_RE = re.compile(
    r"(?:₹|Rs\.?|INR|rupees)\s*"
    r"(\d[\d,]*(?:\.\d+)?)"
    r"\s*(lakhs?|lacs?|crores?|cr|thousand)?",
    re.IGNORECASE,
)
# Bare "5 lakh" with no currency symbol.
BARE_MAGNITUDE_RE = re.compile(
    r"(\d[\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?|crores?)", re.IGNORECASE
)

MONTHLY_HINTS = ("per month", "/month", "per mensem", "p.m.", "monthly",
                 "every month", "a month", "per-month")
ANNUAL_HINTS = ("per annum", "per year", "/year", "p.a.", "annually",
                "yearly", "a year", "per financial year", "per annum.")
ONETIME_HINTS = ("one-time", "one time", "lump sum", "lumpsum", "single "
                 "instalment", "once")

# An insurance sum assured is a contingent payout on death or disability, not
# money the citizen receives. PM Garib Kalyan quotes Rs 50,00,000 of COVID
# cover; counting that as a cash benefit overstates a citizen's entitlement by
# two orders of magnitude.
INSURANCE_WORDS = ("insurance", "sum assured", "coverage of", "cover of",
                   "risk cover", "life cover", "in case of death",
                   "accidental death", "permanent disability", "hospitali",
                   "mediclaim", "assured sum")
LOAN_WORDS = ("loan", "credit", "advance", "borrow", "repay", "interest rate",
              "margin money", "collateral", "term loan", "working capital",
              "overdraft", "mudra", "refinanc")
SUBSIDY_WORDS = ("subsidy", "subsidis", "subsidiz", "reimburs", "rebate",
                 "concession", "% of the cost", "back-ended", "capital support")
CASH_WORDS = ("assistance", "pension", "scholarship", "stipend", "grant",
              "incentive", "allowance", "honorarium", "prize", "award",
              "relief", "compensation", "financial support", "cash",
              "dbt", "direct benefit", "remuneration", "maintenance",
              "monetary", "benefit of", "amount of", "sum of")
INKIND_WORDS = ("free ", "kit", "equipment", "machine", "training", "laptop",
                "bicycle", "cycle", "seeds", "gold coin", "insurance cover",
                "sewing machine", "toolkit", "uniform", "textbook", "in kind",
                "solar", "pump set", "livestock", "sanitary")


def clean_text(s):
    if not s:
        return ""
    s = html.unescape(str(s))
    s = re.sub(r"[*_`#>]+", " ", s)          # strip markdown emphasis
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s)   # links -> label
    s = unicodedata.normalize("NFKC", s)
    return re.sub(r"\s+", " ", s).strip()


def parse_amount(num_str, magnitude):
    """'2,00,000' + 'lakh' -> int. Handles Indian comma grouping."""
    try:
        n = float(num_str.replace(",", ""))
    except ValueError:
        return None
    if magnitude:
        n *= MULTIPLIERS.get(magnitude.lower().rstrip("s"), 1) \
            if magnitude.lower().rstrip("s") in MULTIPLIERS \
            else MULTIPLIERS.get(magnitude.lower(), 1)
    return int(round(n))


def protect_abbreviations(text):
    """'Rs.' ends a sentence as far as a naive splitter is concerned, which
    severed 'Rs.' from its own amount and lost the figure entirely. Normalise
    the abbreviation away before any sentence-level processing."""
    if not text:
        return ""
    t = re.sub(r"\bRs\.\s*", "Rs ", text, flags=re.IGNORECASE)
    t = re.sub(r"\bRe\.\s*", "Re ", t, flags=re.IGNORECASE)
    t = re.sub(r"\bNo\.\s*", "No ", t, flags=re.IGNORECASE)
    return t


def detect_frequency(clause):
    c = clause.lower()
    if any(h in c for h in MONTHLY_HINTS):
        return "monthly"
    if any(h in c for h in ANNUAL_HINTS):
        return "annual"
    if any(h in c for h in ONETIME_HINTS):
        return "one_time"
    return "unknown"


def amount_frequency(clause, end_pos):
    """Frequency for ONE figure, from the words that immediately follow it.

    Clause-level detection is wrong when a clause states the same benefit twice
    in different units — 'Rs 1,500 per month (Rs 18,000 per annum)' would tag
    both figures 'monthly' and annualising the larger one yields Rs 2.16 lakh.
    Reading the qualifier that trails each figure keeps them independent.
    """
    window = clause[end_pos:end_pos + 40].lower()
    if any(h in window for h in MONTHLY_HINTS):
        return "monthly"
    if any(h in window for h in ANNUAL_HINTS):
        return "annual"
    if any(h in window for h in ONETIME_HINTS):
        return "one_time"
    return detect_frequency(clause)


def annualise(value, freq):
    """Comparable yearly value. One-time and unknown are left alone — inflating
    a one-off payment to a yearly figure is exactly the overstatement v1 made."""
    if value is None:
        return None
    return value * 12 if freq == "monthly" else value


def classify_clause(clause):
    """Which bucket does a money figure in this clause belong to?

    Subsidy is tested before loan: 'margin money subsidy' contains a loan word
    ('margin money') but the figure quoted is the subsidy, not a credit limit.
    """
    c = clause.lower()
    # Insurance first: "cover of Rs 5,00,000" is contingent, not received.
    if any(w in c for w in INSURANCE_WORDS):
        return "insurance"
    if any(w in c for w in SUBSIDY_WORDS):
        return "subsidy"
    if any(w in c for w in LOAN_WORDS):
        return "loan"
    if any(w in c for w in CASH_WORDS):
        return "cash"
    return "cash"      # a bare rupee figure in a benefits section is cash


def split_clauses(text):
    """Benefits markdown -> clause list. Amount and its qualifying words must
    stay together, so we split on list items and sentence ends only."""
    if not text:
        return []
    t = protect_abbreviations(html.unescape(text))
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)
    parts = re.split(r"(?:\n+|(?<=[.;])\s+|•|^\s*\d+\.\s*)", t, flags=re.M)
    return [p.strip() for p in parts if p and p.strip()]


def name_bias(name):
    """A scheme's own title is strong evidence about what its money is.

    'Loan Based Schemes For Safai Karamchari' quotes a Rs 10,00,000 figure in a
    clause with no loan keyword, and 'Pradhan Mantri Suraksha Bima Yojana' quotes
    Rs 2,00,000 of accident cover without the English word insurance. Both were
    landing in cash. Returns a bucket to force, or None.
    """
    n = (name or "").lower()
    if any(w in n for w in ("bima", "insurance", "suraksha", "accident cover")):
        return "insurance"
    if any(w in n for w in ("loan", "credit", "mudra", "refinance")):
        return "loan"
    if "subsidy" in n:
        return "subsidy"
    return None


def extract_benefit(benefits_md, benefit_type_label, description,
                    beneficiary_type="individual", scheme_name=""):
    """Clause-by-clause money extraction. Returns the SCHEMA.md benefit block.

    `beneficiary_type` sets the plausibility ceiling. Institutional schemes quote
    figures like "Rs 5,00,00,000 upper limit for a Centre of Excellence" — real,
    but not something a citizen receives. Counting those into a personal total is
    the same overstatement as v1's, just three orders of magnitude worse.
    """
    source = benefits_md or ""
    if not source.strip():
        source = description or ""

    # Largest credible per-beneficiary figure. Direct cash to one citizen above
    # ~Rs 20 lakh essentially does not exist; figures past that are aggregates,
    # institutional outlays, or rate tables misread as a single amount.
    ceiling = 50_000_000 if beneficiary_type == "institution" else 2_000_000
    # Insurance cover is legitimately much larger than any cash grant.
    insurance_ceiling = 50_000_000

    found = {"cash": [], "loan": [], "subsidy": [], "insurance": []}
    in_kind_bits = []

    forced = name_bias(scheme_name)
    for clause in split_clauses(source):
        kind = classify_clause(clause)
        # Only override a clause that had no signal of its own; an explicit
        # "subsidy of Rs X" inside a loan scheme is still a subsidy.
        if forced and kind == "cash":
            kind = forced

        # (annualised, raw, frequency) per figure — frequency read from the
        # words trailing each figure, not from the clause as a whole.
        amounts = []
        for m in AMOUNT_RE.finditer(clause):
            v = parse_amount(m.group(1), m.group(2))
            if v is not None:
                f = amount_frequency(clause, m.end())
                amounts.append((annualise(v, f), v, f))
        if not amounts:
            for m in BARE_MAGNITUDE_RE.finditer(clause):
                v = parse_amount(m.group(1), m.group(2))
                if v is not None:
                    f = amount_frequency(clause, m.end())
                    amounts.append((annualise(v, f), v, f))

        cl = clean_text(clause)
        if not amounts:
            if any(w in clause.lower() for w in INKIND_WORDS) and len(cl) > 8:
                in_kind_bits.append(cl[:120])
            continue

        # Ignore absurd values: percentages misread as rupees, year numbers,
        # and anything past a crore that is almost always a scheme-wide outlay
        # rather than a per-beneficiary amount.
        cap = insurance_ceiling if kind == "insurance" else ceiling
        for annual, rawv, f in amounts:
            if rawv < 100 or annual > cap:
                continue
            found[kind].append((annual, rawv, f, cl[:160]))

    def best(bucket):
        """Largest per-beneficiary figure, compared on its annualised value so
        a monthly stipend and a yearly grant rank on equal terms."""
        if not bucket:
            return None, None, "unknown", None
        annual, rawv, f, ctx = max(bucket, key=lambda x: x[0])
        return annual, rawv, f, ctx

    cash, cash_raw, cash_freq, cash_ctx = best(found["cash"])
    loan_v, _, _, _ = best(found["loan"])
    sub_v, _, _, _ = best(found["subsidy"])
    ins_v, _, _, _ = best(found["insurance"])

    # A guarantee/credit scheme often describes the same ceiling twice — once as
    # "financial assistance", once as "loan". Landing the identical figure in
    # both buckets would let a card claim a Rs 5 crore grant AND a Rs 5 crore
    # loan. Credit is the more conservative reading, so keep only that.
    if cash is not None and loan_v is not None and cash == loan_v:
        cash = cash_raw = cash_ctx = None
        cash_freq = "unknown"

    label = (benefit_type_label or "").strip().lower()
    if label in ("cash", "in kind", "composite"):
        btype = label.replace(" ", "_")
    else:
        btype = "cash" if cash else ("in_kind" if in_kind_bits else "cash")

    return {
        "cash": cash,
        "cash_raw": cash_raw,
        "cash_frequency": cash_freq if cash_raw is not None else "unknown",
        "loan_ceiling": loan_v,
        "subsidy": sub_v,
        "insurance_cover": ins_v,
        "in_kind": "; ".join(in_kind_bits[:2]) or None,
        "type": btype,
        "confidence": "high" if (cash or loan_v or sub_v or ins_v) else "low",
    }


# ---------------------------------------------------------------------------
# Eligibility thresholds from prose (facets carry the categorical fields)
# ---------------------------------------------------------------------------
INCOME_CTX = re.compile(
    r"([^.;\n]{0,140}?\bincome\b[^.;\n]{0,140})", re.IGNORECASE)


def extract_income_limit(text):
    """Annual income ceiling, always annualised.

    v1 produced income_max_annual = 5 from 'Rs 5 lakh' and never annualised a
    monthly figure. Both are handled here.
    """
    if not text:
        return None
    # 'Rs.' would otherwise terminate the no-period context window before the
    # digits were reached, silently dropping every 'Rs. 2,50,000' threshold.
    t = protect_abbreviations(html.unescape(text))
    best = None
    for m in INCOME_CTX.finditer(t):
        clause = m.group(1)
        low = clause.lower()
        # Only ceilings, not "income above" style exclusion clauses.
        if not any(w in low for w in ("not exceed", "less than", "below",
                                      "upto", "up to", "maximum", "within",
                                      "does not exceed", "under", "limit")):
            continue
        vals = []
        for am in AMOUNT_RE.finditer(clause):
            v = parse_amount(am.group(1), am.group(2))
            if v:
                vals.append(annualise(v, amount_frequency(clause, am.end())))
        if not vals:
            for am in BARE_MAGNITUDE_RE.finditer(clause):
                v = parse_amount(am.group(1), am.group(2))
                if v:
                    vals.append(annualise(v, amount_frequency(clause, am.end())))
        vals = [v for v in vals if v]
        if not vals:
            continue
        v = max(vals)
        if 1_000 <= v <= 10_000_000:
            best = v if best is None else min(best, v)
    return best


AGE_MIN_RE = [
    re.compile(r"(?:aged?\s*)?(\d{1,2})\s*years?\s*(?:or\s*)?(?:and\s*)?(?:above|older|more|plus)", re.I),
    re.compile(r"above\s*(?:the\s*age\s*of\s*)?(\d{1,2})\s*years?", re.I),
    re.compile(r"minimum\s*age[^\d]{0,15}(\d{1,2})", re.I),
    re.compile(r"completed\s*(\d{1,2})\s*years?", re.I),
    re.compile(r"between\s*(\d{1,2})\s*(?:and|to|-)\s*\d{1,2}\s*years?", re.I),
]
AGE_MAX_RE = [
    re.compile(r"(?:not\s*(?:more\s*than|exceed(?:ing)?)|below|under|upto|up\s*to|maximum\s*(?:of\s*)?age(?:\s*of)?)[^\d]{0,15}(\d{1,2})\s*years?", re.I),
    re.compile(r"between\s*\d{1,2}\s*(?:and|to|-)\s*(\d{1,2})\s*years?", re.I),
    re.compile(r"(\d{1,2})\s*years?\s*(?:or\s*)?(?:and\s*)?(?:below|younger|less)", re.I),
]


def extract_age(text):
    if not text:
        return None, None
    t = html.unescape(text)
    lo = hi = None
    for rx in AGE_MIN_RE:
        m = rx.search(t)
        if m:
            v = int(m.group(1))
            if 0 < v < 100:
                lo = v
                break
    for rx in AGE_MAX_RE:
        m = rx.search(t)
        if m:
            v = int(m.group(1))
            if 0 < v <= 120:
                hi = v
                break
    if lo is not None and hi is not None and lo > hi:
        lo, hi = None, hi
    return lo, hi


# ---------------------------------------------------------------------------
# Discriminative attribute extraction (v3)
#
# Six profile attributes cannot separate 4,600 schemes. Measured across the full
# corpus, these are what schemes actually gate on — with the count of schemes
# whose eligibility prose references each:
#
#   student marks %          984      welfare board registration   410
#   domicile / state         646      ration card type             323
#   course level (UG/PG)     359      disability                   221
#   class / standard         197      ITI / diploma                185
#   livestock                180      marriage                     174
#   institution type         169      widow / destitute            152
#   land ownership           142      unemployment                 124
#
# Each extractor below populates a scheme-side field so the matcher can compare
# it against the citizen's answer. Without these the extra questions would be
# asked and then ignored.
# ---------------------------------------------------------------------------

# Single-letter degree abbreviations MUST require their periods. An earlier
# version used `b\.?e\b`, which matches the word "be" — present in almost every
# eligibility text — and tagged 94.6% of the corpus as having a study level.
# Likewise `class\s*i` matched "Other Backward Class in ...", so class levels
# now require a digit or an unambiguous roman numeral.
STUDENT_LEVELS = [
    ("phd", r"\b(ph\.\s?d|doctoral|doctorate|post[- ]doctoral)"),
    ("pg", r"\b(post[- ]?graduate|postgraduate|master'?s degree|m\.a\.|m\.sc|m\.com|m\.tech|m\.e\.|mba\b|m\.phil)"),
    ("ug", r"\b(under[- ]?graduate|undergraduate|bachelor|b\.a\.|b\.sc|b\.com|b\.tech|b\.e\.|degree course)"),
    ("diploma", r"\b(diploma|polytechnic)\b"),
    ("iti", r"\b(iti\b|industrial training institute|craftsman training)"),
    ("class_11_12", r"\b(?:class|standard)\s*(?:11|12|xi|xii)\b|\bhigher secondary\b|\+2\b|\b1[12]th\b"),
    ("class_9_10", r"\b(?:class|standard)\s*(?:9|10|ix|x)\b|\bmatriculation\b|\b(?:9|10)th\b|\bsecondary school\b"),
    ("class_1_8", r"\b(?:class|standard)\s*[1-8]\b|\b[1-8]th standard\b|\bprimary school\b|\belementary school\b|\bupper primary\b"),
]

MARKS_RE = re.compile(
    r"(?:secur\w+|obtain\w+|scor\w+|minimum|at least|not less than|above|passed with)"
    r"[^.]{0,40}?(\d{2,3}(?:\.\d+)?)\s*%|"
    r"(\d{2,3}(?:\.\d+)?)\s*%[^.]{0,30}?(?:marks|aggregate|in the qualifying)",
    re.IGNORECASE)

ACRE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(acre|hectare|cent)s?\b", re.IGNORECASE)
DISABILITY_PCT_RE = re.compile(
    r"(\d{2,3})\s*%\s*(?:or\s+(?:more|above))?\s*(?:of\s+)?disab|"
    r"disab\w*[^.]{0,25}?(\d{2,3})\s*%|benchmark disab", re.IGNORECASE)


def extract_student_reqs(text):
    """Study level, minimum marks and institution type — the education branch.

    1,139 education schemes exist and 'student' is a single bit today, so every
    student matches all of them. These three fields are what separate them.
    """
    t = (text or "").lower()
    levels = [name for name, rx in STUDENT_LEVELS if re.search(rx, t)]

    marks = None
    for m in MARKS_RE.finditer(text or ""):
        val = m.group(1) or m.group(2)
        if not val:
            continue
        try:
            v = float(val)
        except ValueError:
            continue
        # Reject reservation/subsidy percentages masquerading as a marks bar.
        if 30 <= v <= 95:
            marks = v if marks is None else min(marks, v)

    inst = None
    if re.search(r"\bgovernment(?:\s|-)(?:school|college|institution|recognis)", t) or \
       re.search(r"\bgovt\.?\s+(?:school|college)", t):
        inst = "government"
    elif re.search(r"\b(aided|government[- ]aided)\b", t):
        inst = "aided"
    elif re.search(r"\bprivate\s+(?:school|college|institution|unaided)", t):
        inst = "private"

    hostel = None
    if re.search(r"\bhostell?er|residing in (?:a )?hostel\b", t):
        hostel = "hosteller"
    elif re.search(r"\bday[- ]scholar\b", t):
        hostel = "day_scholar"

    return levels, marks, inst, hostel


def extract_land_reqs(text):
    """Tenure and holding size. Tenants and sharecroppers are excluded from
    land-linked schemes and specifically included in others, and essentially no
    system asks — 47 schemes reference tenancy, 26 reference landless."""
    t = (text or "").lower()
    tenure = []
    if re.search(r"\blandless\b", t):
        tenure.append("landless")
    if re.search(r"\b(tenant|share ?cropper|oral lessee|lease(?:d|hold)? land)\b", t):
        tenure.append("tenant")
    if re.search(r"\bown(?:s|ing|ed)?\b[^.]{0,25}\b(land|acre|cent)\b", t) or \
       re.search(r"\b(land ?holder|land ?owning|owner cultivator|patta)\b", t):
        tenure.append("owner")
    if re.search(r"\b(small|marginal)\s+farmer\b", t):
        tenure.append("small_marginal")

    max_acres = None
    for m in ACRE_RE.finditer(text or ""):
        try:
            v = float(m.group(1))
        except ValueError:
            continue
        unit = m.group(2).lower()
        if unit.startswith("hectare"):
            v *= 2.47105                 # citizens think in acres, never hectares
        elif unit.startswith("cent"):
            v /= 100.0
        if 0 < v <= 100:
            max_acres = v if max_acres is None else max(max_acres, v)

    livestock = bool(re.search(
        r"\b(dairy|milch|cattle|buffalo|cow|goat|sheep|poultry|piggery|livestock)\b", t))
    fisher = bool(re.search(r"\bfisher(?:man|men|folk|ies)?\b|\bfish farming\b", t))
    return tenure, max_acres, livestock, fisher


def extract_household_reqs(text):
    """Ration card, housing, welfare-board registration, pension exclusion and
    chronic illness — the cross-cutting household gates."""
    t = (text or "").lower()

    card = []
    if re.search(r"\b(antyodaya|aay)\b", t):
        card.append("aay")
    if re.search(r"\b(bpl|below poverty line)\b", t):
        card.append("bpl")
    if re.search(r"\bpriority household|phh\b", t):
        card.append("priority")
    if re.search(r"\bapl\b|above poverty line", t):
        card.append("apl")

    housing = None
    if re.search(r"\b(homeless|houseless|shelterless|without (?:a )?(?:own )?house)\b", t):
        housing = "homeless"
    elif re.search(r"\bkutcha|kachcha|dilapidated|thatched\b", t):
        housing = "kutcha"
    elif re.search(r"\b(?:should not own|not owning|does not own)[^.]{0,25}\b(?:pucca )?house\b", t):
        housing = "no_pucca"

    board = bool(re.search(
        r"\b(welfare board|registered (?:as a )?(?:construction|unorganis|unorganiz)"
        r"|labour (?:card|board)|registered worker|board member(?:ship)?)\b", t))

    # An existing pension both gates and disqualifies, depending on the scheme.
    pension_excluded = bool(re.search(
        r"\bnot\b[^.]{0,40}\b(?:receiv\w+|draw\w+|in receipt of)\b[^.]{0,25}\bpension\b", t))

    illness = bool(re.search(
        r"\b(cancer|kidney|dialysis|thalassaem|haemophil|hiv|tuberculosis|"
        r"transplant|chronic (?:illness|disease)|heart surgery|leprosy)\b", t))

    unemployed = bool(re.search(
        r"\b(unemployed|employment exchange|jobless|not (?:be )?(?:gainfully )?employed)\b", t))

    maternity = None
    if re.search(r"\bpregnan", t):
        maternity = "pregnant"
    elif re.search(r"\blactating|nursing mother|after delivery|post[- ]?natal", t):
        maternity = "lactating"

    first_child = bool(re.search(
        r"\bfirst (?:live )?(?:birth|child)|one girl child|single girl child\b", t))

    return {
        "ration_card_required": card,
        "housing_status_required": housing,
        "welfare_board_required": board,
        "pension_excluded": pension_excluded,
        "chronic_illness_required": illness,
        "unemployed_required": unemployed,
        "maternity_required": maternity,
        "first_child_only": first_child,
    }


def extract_disability_reqs(text, facets):
    """221 disability schemes exist and NOT ONE can surface today, because the
    profile has no disability question at all."""
    t = (text or "").lower()
    required = "Yes" in (facets.get("disability") or [])
    min_pct = None
    for m in DISABILITY_PCT_RE.finditer(text or ""):
        val = m.group(1) or m.group(2)
        if not val:
            continue
        try:
            v = int(val)
        except ValueError:
            continue
        if 20 <= v <= 100:
            min_pct = v if min_pct is None else min(min_pct, v)
    if not min_pct:
        for band in (facets.get("disabilityPercentage") or []):
            try:
                v = int(band)
            except (TypeError, ValueError):
                continue
            if 20 <= v <= 100:
                min_pct = v if min_pct is None else min(min_pct, v)
    if min_pct and not required:
        required = True

    types = []
    for name, rx in [
        ("visual", r"\b(visual(?:ly)? impair|blind|low vision)\b"),
        ("hearing", r"\b(hearing impair|deaf|hard of hearing)\b"),
        ("locomotor", r"\b(locomotor|orthopaedic|orthopedic|physically handicap)\b"),
        ("intellectual", r"\b(intellectual disab|mental retard|autism|cerebral palsy|learning disab)\b"),
        ("speech", r"\b(speech (?:and language )?disab|dumb|mute)\b"),
    ]:
        if re.search(rx, t):
            types.append(name)
    return required, min_pct, types


# myScheme's occupation facet reaches only 23% of schemes, yet occupation is the
# main branch of the questionnaire. Recovering it from prose roughly doubles the
# coverage. Patterns are deliberately specific — over-matching here would wrongly
# EXCLUDE citizens, which is far worse than leaving a scheme unclassified.
OCCUPATION_PROSE = [
    ("farmer", r"\b(farmer|cultivator|agricultur(?:e|ist|al labour)|horticultur|"
               r"tiller of the soil|krishi|ryot|kisan)\b"),
    ("fisher", r"\b(fisher(?:man|men|folk|women)?|fisheries|fish farmer)\b"),
    ("student", r"\b(student|scholar of|pupil|studying in|enrolled in|"
                r"pursuing (?:a |an )?(?:course|degree|study))\b"),
    ("artisan", r"\b(artisan|weaver|handloom|handicraft|craftsm(?:an|en)|potter|"
                r"blacksmith|carpenter|cobbler|goldsmith|barber|tailor|"
                r"khadi|coir worker|toy maker)\b"),
    ("daily_wage", r"\b(daily wage|wage earner|construction worker|manual labour|"
                   r"unorganis(?:ed)? (?:sector )?worker|unorganiz(?:ed)? worker|"
                   r"agricultural labour|casual labour|mgnrega|job card)\b"),
    ("small_business", r"\b(entrepreneur|self[- ]employ|micro enterprise|small business|"
                       r"msme|own(?:ing)? (?:a )?(?:unit|shop|enterprise)|"
                       r"set(?:ting)? up (?:a |an )?(?:unit|enterprise|business))\b"),
    ("unemployed", r"\b(unemployed youth|unemployed person|jobless|"
                   r"registered .{0,20}employment exchange)\b"),
    ("homemaker", r"\b(housewife|home ?maker)\b"),
]


def extract_occupation_prose(text):
    t = (text or "").lower()
    return [name for name, rx in OCCUPATION_PROSE if re.search(rx, t)]


def extract_documents(detail, elig_text):
    """myScheme rarely populates documents_required; recover names from prose."""
    docs = []
    raw = detail.get("documents_required")
    if isinstance(raw, list):
        for d in raw:
            name = d.get("document_name") or d.get("name") if isinstance(d, dict) else d
            if isinstance(name, str) and 2 < len(name) < 90:
                docs.append(clean_text(name))

    if not docs:
        blob = " ".join([
            elig_text or "",
            detail.get("application_process_text") or "",
            detail.get("detailedDescription_md") or "",
        ]).lower()
        known = [
            ("aadhaar", "Aadhaar Card"), ("ration card", "Ration Card"),
            ("income certificate", "Income Certificate"),
            ("caste certificate", "Caste Certificate"),
            ("community certificate", "Community Certificate"),
            ("bank passbook", "Bank Passbook"),
            ("bank account", "Bank Account Details"),
            ("land record", "Land Records"), ("patta", "Land Patta"),
            ("photograph", "Passport Photo"), ("passport size", "Passport Photo"),
            ("birth certificate", "Birth Certificate"),
            ("death certificate", "Death Certificate"),
            ("marriage certificate", "Marriage Certificate"),
            ("disability certificate", "Disability Certificate"),
            ("domicile", "Domicile Certificate"),
            ("residence certificate", "Residence Certificate"),
            ("bpl", "BPL Card"), ("voter", "Voter ID"), ("pan card", "PAN Card"),
            ("mark sheet", "Mark Sheet"), ("marksheet", "Mark Sheet"),
            ("school certificate", "School Certificate"),
            ("self-declaration", "Self Declaration"),
            ("medical certificate", "Medical Certificate"),
        ]
        seen = set()
        for needle, label in known:
            if needle in blob and label not in seen:
                seen.add(label)
                docs.append(label)
    return docs[:8]


# ---------------------------------------------------------------------------
# Illustrative demo fields — kept by explicit decision (see SCHEMA.md).
# Seeded on the scheme id so regenerating produces identical values rather
# than a noisy diff; v1 used Math.random() and was non-reproducible.
# ---------------------------------------------------------------------------
TN_DISTRICTS = ["Chennai", "Coimbatore", "Madurai", "Salem", "Trichy",
                "Tirunelveli", "Vellore", "Thanjavur", "Erode", "Dindigul"]
VERIFIERS = [
    ("Anitha Krishnamurthy", "Panchayat Officer", "Chennai"),
    ("Selvam Murugan", "CSC Operator", "Coimbatore"),
    ("Kavitha Rajan", "ASHA Worker", "Madurai"),
    ("Balasubramanian S", "NGO Volunteer", "Salem"),
    ("Priya Devarajan", "Panchayat Officer", "Trichy"),
    ("Muthukumar V", "CSC Operator", "Thanjavur"),
    ("Suganya Devi", "ASHA Worker", "Tirunelveli"),
    ("Rajeswaran K", "NGO Volunteer", "Vellore"),
    ("Meenakshi Sundaram", "Panchayat Officer", "Erode"),
    ("Dhandapani P", "CSC Operator", "Dindigul"),
]
DATES = ["2024-10-12", "2024-11-03", "2024-11-28", "2024-12-05",
         "2025-01-10", "2025-01-22", "2025-02-14", "2025-03-01"]


def demo_fields(slug):
    rnd = random.Random(f"sevai::{slug}")
    total = rnd.randint(300, 4300)
    dist, remaining = {}, total
    for i, d in enumerate(TN_DISTRICTS):
        if i == len(TN_DISTRICTS) - 1:
            dist[d] = max(1, remaining)
        else:
            share = max(1, int(remaining * rnd.uniform(0.05, 0.22)))
            dist[d] = share
            remaining = max(1, remaining - share)
    name, role, district = VERIFIERS[rnd.randrange(len(VERIFIERS))]
    return {
        "total_applicants_this_month": total,
        "district_applicants": dist,
        "verified_by": {"name": name, "role": role, "district": district,
                        "verified_date": DATES[rnd.randrange(len(DATES))],
                        "illustrative": True},
    }


# ---------------------------------------------------------------------------
def plain_name(official, short_title):
    if not official:
        return short_title or ""
    n = clean_text(official)
    n = re.sub(r"\s*\((?:[^)]*)\)\s*$", "", n)
    n = re.sub(r"\s*-\s*\d+$", "", n)
    n = re.sub(r"\bScheme\s+[IVXLC0-9]+$", "", n).strip()
    words = n.split()
    return " ".join(words[:10]) if len(words) > 10 else n


def make_bullets(benefit, elig, name):
    """Three plain-language lines. Replaces v1's makeBullets(), which emitted
    'For families earning under Rs 5 per year'."""
    b = []
    if benefit["cash"]:
        amt = f"₹{benefit['cash']:,}"
        if benefit["cash_frequency"] == "monthly":
            b.append(f"Gives {amt} a year (₹{benefit['cash_raw']:,} every month)")
        elif benefit["cash_frequency"] == "annual":
            b.append(f"Gives {amt} every year")
        else:
            b.append(f"Gives {amt} as a one-time payment")
    elif benefit["loan_ceiling"]:
        b.append(f"Lets you borrow up to ₹{benefit['loan_ceiling']:,}")
    elif benefit["subsidy"]:
        b.append(f"Covers up to ₹{benefit['subsidy']:,} of the cost")
    elif benefit["in_kind"]:
        b.append(f"Gives support in kind: {benefit['in_kind'][:70]}")
    else:
        b.append("Government support — see the scheme page for the amount")

    if elig["gender"] == "female":
        b.append("For women and girls")
    elif elig["caste_required"]:
        b.append(f"For {'/'.join(elig['caste_required'])} community members")
    elif elig["income_max_annual"]:
        b.append(f"For families earning under ₹{elig['income_max_annual']:,} a year")
    elif elig["occupation"]:
        b.append(f"For {', '.join(elig['occupation']).replace('_', ' ')}")
    elif elig["min_age"]:
        b.append(f"For people aged {elig['min_age']} and above")
    else:
        b.append("Open to all eligible citizens")

    b.append("Aadhaar and a bank account are usually needed")
    return b[:3]


def normalize(rec):
    slug = rec["slug"]
    detail = rec.get("detail") or {}
    facets = rec.get("facets") or {}
    if "_error" in detail:
        detail = {}

    elig_md = detail.get("eligibilityDescription_md") or ""
    desc_md = detail.get("detailedDescription_md") or rec.get("briefDescription") or ""

    # -- scope ------------------------------------------------------------
    # "Central" does not imply nationwide. 14 schemes carry level=Central while
    # naming a specific set of states (one covers Kerala + Tamil Nadu only).
    # Treating central as nationwide would show those to all 36 states, and
    # filing a multi-state scheme under states[0] alone would hide it from
    # everyone else entitled to it. Reach is the state list, not the level.
    level_raw = (detail.get("level") or rec.get("level") or "").lower()
    level = "central" if "central" in level_raw else "state"
    states = [s for s in (rec.get("beneficiaryState") or []) if s]
    detail_state = detail.get("state")
    if not states and detail_state:
        states = [detail_state]

    nationwide = ("All" in states) or (level == "central" and not states)
    if nationwide:
        states = ["All"]
        state = None
    else:
        # Single-state schemes keep a scalar for display; multi-state ones don't.
        state = states[0] if len(states) == 1 else None

    # -- categories -------------------------------------------------------
    raw_cats = rec.get("schemeCategory") or []
    cats = []
    for c in raw_cats:
        mapped = CATEGORY_MAP.get(c)
        if mapped and mapped not in cats:
            cats.append(mapped)
    blob = " ".join([rec.get("schemeName") or "", " ".join(rec.get("tags") or []),
                     " ".join(detail.get("schemeSubCategory") or [])]).lower()
    if not cats or cats[0] == "welfare":
        for target, needles in TAG_REFINEMENTS:
            if any(n in blob for n in needles):
                if target in cats:
                    cats.remove(target)
                cats.insert(0, target)
                break
    if not cats:
        cats = ["welfare"]

    # -- eligibility: facets first, prose only for numeric thresholds -----
    genders = [GENDER_MAP[g] for g in facets.get("gender", []) if g in GENDER_MAP]
    castes, occ, occ_raw = [], [], []
    for c in facets.get("caste", []):
        m = CASTE_MAP.get(c)
        if m and m not in castes:
            castes.append(m)
    for o in facets.get("occupation", []):
        occ_raw.append(o)
        m = OCCUPATION_MAP.get(o)
        if m and m not in occ:
            occ.append(m)
    # Facets cover only 23% of schemes; recover the rest from the prose.
    for m in extract_occupation_prose(f"{elig_md}\n{desc_md}"):
        if m not in occ:
            occ.append(m)

    residence = "any"
    for r in facets.get("residence", []):
        if r.lower() == "rural":
            residence = "rural"
        elif r.lower() == "urban":
            residence = "urban"

    min_age, max_age = extract_age(elig_md)
    if min_age is None:
        buckets = [int(b) for b in facets.get("age-general", [])
                   if str(b).isdigit()]
        if buckets:
            min_age = min(buckets)
            if max_age is None and max(buckets) < 100:
                max_age = max(buckets) + 9

    # v3 discriminative attributes, read from the eligibility prose plus the
    # detailed description (some schemes state the real bar only in the latter).
    attr_text = f"{elig_md}\n{desc_md}"
    stu_levels, stu_marks, stu_inst, stu_hostel = extract_student_reqs(attr_text)
    land_tenure, land_acres, has_livestock, is_fisher = extract_land_reqs(attr_text)
    household = extract_household_reqs(attr_text)
    dis_required, dis_min_pct, dis_types = extract_disability_reqs(attr_text, facets)

    eligibility = {
        "min_age": min_age,
        "max_age": max_age,
        "gender": genders[0] if len(genders) == 1 else "any",
        "caste_required": castes,
        "income_max_annual": extract_income_limit(elig_md),
        "occupation": occ,
        "occupation_raw": occ_raw,
        "residence": residence,
        "bpl_required": "Yes" in facets.get("isBpl", []),
        "disability_required": dis_required,
        "disability_min_pct": dis_min_pct,
        "disability_types": dis_types,
        "minority_required": "Yes" in facets.get("minority", []),
        "student_required": "Yes" in facets.get("isStudent", []),
        "marital_status": [m.lower() for m in facets.get("maritalStatus", [])],
        "employment_status": [e.lower() for e in facets.get("employmentStatus", [])],
        # ── education branch (1,139 schemes; marks alone gates 984) ──
        "student_levels": stu_levels,
        "marks_min_pct": stu_marks,
        "institution_type": stu_inst,
        "hostel_requirement": stu_hostel,
        # ── farming branch ──
        "land_tenure": land_tenure,
        "land_max_acres": land_acres,
        "livestock_required": has_livestock,
        "fisher_required": is_fisher,
        # ── cross-cutting household gates ──
        **household,
        "state": state,
        "additional_conditions": clean_text(elig_md)[:300] or None,
    }

    # Who the scheme is actually for. myScheme's schemeFor tags 245 of 1219 as
    # "Infra" — institutional grants a citizen cannot personally claim. They stay
    # in the corpus but the matcher scopes them out of a citizen's feed.
    scheme_for = (rec.get("schemeFor") or "").strip().lower()
    targets = [str(t).lower() for t in (detail.get("targetBeneficiaries") or [])]
    if scheme_for == "infra" or any(
            k in " ".join(targets)
            for k in ("business entity", "institution", "industries",
                      "university", "organization", "organisation")):
        beneficiary_type = "institution"
    elif scheme_for == "family" or "family" in " ".join(targets):
        beneficiary_type = "family"
    else:
        beneficiary_type = "individual"

    benefit = extract_benefit(detail.get("benefits_md"),
                              detail.get("benefitTypes"), desc_md,
                              beneficiary_type, rec.get("schemeName") or "")

    urls = [u for u in (detail.get("application_urls") or []) if u.startswith("http")]

    out = {
        "id": slug,
        "name_plain": plain_name(rec.get("schemeName"), rec.get("schemeShortTitle")),
        "name_official": clean_text(rec.get("schemeName")),
        "name_ta": None,
        "level": level,
        "state": state,
        "states": states,
        "nationwide": nationwide,
        "beneficiary_type": beneficiary_type,
        "category": cats[0],
        "categories": cats,
        "ministry": detail.get("nodalMinistryName") or detail.get("nodalDepartmentName"),
        # Trimmed deliberately: these shards are fetched over rural connections
        # and cached offline, so every KB is a real cost. Full text stays one tap
        # away on the official scheme page.
        "description_long": clean_text(desc_md)[:420],
        "description_simple": make_bullets(benefit, eligibility, rec.get("schemeName")),
        "description_simple_ta": None,
        "eligibility": eligibility,
        "benefit": benefit,
        "deadline": rec.get("schemeCloseDate"),
        "is_ongoing": not rec.get("schemeCloseDate"),
        "documents_required": extract_documents(detail, elig_md),
        "application_link": rec.get("myscheme_url"),
        "official_url": urls[0] if urls else None,
        "application_modes": detail.get("application_modes") or [],
        "tags": rec.get("tags") or [],
        "related_scheme_ids": [],
    }
    out.update(demo_fields(slug))
    return out


def link_related(schemes):
    """Cross-scheme chaining links.

    v1 linked on shared required documents, but 230 of 233 schemes carried the
    same placeholder 'Aadhaar Card', so every scheme linked to every other one —
    53,032 edges, 228 per node out of a possible 232, i.e. no signal at all.

    myScheme never populates documents_required (0 of 1219 records), so documents
    are recovered from prose and land on only ~12% of schemes. Tags are populated
    almost everywhere, so they carry the relationship, with documents and shared
    eligibility as bonus signal. Candidates are restricted to what the same
    citizen could actually claim: same category, and central or same state.
    """
    UNIVERSAL = {"Aadhaar Card", "Bank Passbook", "Bank Account Details",
                 "Passport Photo"}
    by_cat = defaultdict(list)
    for s in schemes:
        by_cat[s["category"]].append(s)

    for s in schemes:
        my_tags = {t.lower() for t in (s.get("tags") or [])}
        my_docs = set(s["documents_required"]) - UNIVERSAL
        my_occ = set(s["eligibility"]["occupation"])
        scored = []
        for other in by_cat[s["category"]]:
            if other["id"] == s["id"]:
                continue
            # Only chain to something this citizen could also claim.
            if not (other["level"] == "central" or other["state"] == s["state"]):
                continue
            if other.get("beneficiary_type") != s.get("beneficiary_type"):
                continue
            score = (
                3 * len(my_tags & {t.lower() for t in (other.get("tags") or [])})
                + 2 * len(my_docs & (set(other["documents_required"]) - UNIVERSAL))
                + 2 * len(my_occ & set(other["eligibility"]["occupation"]))
            )
            if score <= 0:
                continue
            scored.append((score, other["benefit"].get("cash") or 0, other["id"]))
        scored.sort(reverse=True)
        s["related_scheme_ids"] = [sid for _, _, sid in scored[:4]]


def state_slug(name):
    return re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")


def main():
    if not os.path.exists(RAW_FILE):
        raise SystemExit(f"{RAW_FILE} not found — run fetch_schemes.py first.")
    raw = json.load(open(RAW_FILE))
    print(f"Normalizing {len(raw)} raw records ...")

    seen, schemes, dupes = set(), [], 0
    for rec in raw:
        slug = rec.get("slug")
        if not slug or slug in seen:
            dupes += 1
            continue
        seen.add(slug)
        try:
            s = normalize(rec)
        except Exception as e:
            print(f"  ! {slug}: {e}")
            continue
        if not s["name_plain"] or len(s["name_plain"]) < 4:
            continue
        schemes.append(s)

    # Near-duplicate collapse: the same scheme sometimes appears under both a
    # central and a state listing with a renamed title.
    by_key = {}
    collapsed = 0
    for s in schemes:
        key = (re.sub(r"[^a-z0-9]", "", s["name_official"].lower())[:60],
               s["level"], s["state"])
        if key in by_key:
            collapsed += 1
            continue
        by_key[key] = s
    schemes = list(by_key.values())

    link_related(schemes)

    os.makedirs(OUT_DIR, exist_ok=True)
    # central.json = genuinely nationwide only. Everything else is filed under
    # EVERY state it names, so a Kerala+Tamil Nadu scheme reaches both.
    central = [s for s in schemes if s["nationwide"]]
    by_state = defaultdict(list)
    for s in schemes:
        if s["nationwide"]:
            continue
        for st in s["states"]:
            if st and st != "All":
                by_state[st].append(s)

    def write(path, payload):
        with open(os.path.join(OUT_DIR, path), "w") as f:
            json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)
        return os.path.getsize(os.path.join(OUT_DIR, path))

    generated = datetime.now(timezone.utc).isoformat()
    size_central = write("central.json", central)
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated,
        "source": "myscheme.gov.in",
        "central_count": len(central),
        "states": [],
    }
    for st, rows in sorted(by_state.items()):
        fn = f"state-{state_slug(st)}.json"
        size = write(fn, rows)
        manifest["states"].append({"name": st, "slug": state_slug(st),
                                   "file": fn, "count": len(rows),
                                   "bytes": size})
    write("index.json", manifest)

    # ---- report ----------------------------------------------------------
    print(f"\n  {len(schemes)} schemes ({dupes} dupe slugs, {collapsed} near-dupes collapsed)")
    print(f"  central.json  {len(central):>5} schemes  {size_central/1024:>7.0f} KB")
    for st in manifest["states"]:
        print(f"  {st['file']:<28} {st['count']:>5} schemes  {st['bytes']/1024:>7.0f} KB")

    cash = [s for s in schemes if s["benefit"]["cash"]]
    loan = [s for s in schemes if s["benefit"]["loan_ceiling"]]
    lowconf = [s for s in schemes if s["benefit"]["confidence"] == "low"]
    print(f"\n  money: {len(cash)} with cash, {len(loan)} with loan ceiling, "
          f"{len(lowconf)} unvalued")
    print("  frequency:", dict(Counter(s["benefit"]["cash_frequency"] for s in cash)))
    print("  categories:", dict(Counter(s["category"] for s in schemes).most_common()))
    inc = [s["eligibility"]["income_max_annual"] for s in schemes
           if s["eligibility"]["income_max_annual"]]
    print(f"  income limits parsed: {len(inc)}; "
          f"min={min(inc) if inc else '-'} max={max(inc) if inc else '-'}")
    bad = [s["id"] for s in schemes if (s["eligibility"]["income_max_annual"] or 9e9) < 1000]
    print(f"  suspicious income limits (<1000): {len(bad)} {bad[:5]}")
    docs = Counter(d for s in schemes for d in s["documents_required"])
    withdocs = sum(1 for s in schemes if s["documents_required"])
    print(f"  distinct documents: {len(docs)} | coverage {withdocs}/{len(schemes)}"
          f" (myScheme publishes none; recovered from prose) | top: {docs.most_common(4)}")
    print(f"  with official_url: {sum(1 for s in schemes if s['official_url'])}")
    print("  beneficiary_type:", dict(Counter(s["beneficiary_type"] for s in schemes)))
    big = [s for s in schemes
           if s["beneficiary_type"] != "institution" and (s["benefit"]["cash"] or 0) > 1_000_000]
    print(f"  individual schemes claiming >Rs 10L cash: {len(big)}"
          f" {[s['id'] for s in big[:4]]}")
    rel = [len(s["related_scheme_ids"]) for s in schemes]
    print(f"  related links: avg {sum(rel)/max(1,len(rel)):.1f} per scheme "
          f"(v1 averaged 228 — every scheme linked to every other)")

    print("\n  v3 discriminative attributes extracted (schemes gated by each):")
    E = [s["eligibility"] for s in schemes]
    checks = [
        ("student_levels", lambda e: bool(e["student_levels"])),
        ("marks_min_pct", lambda e: e["marks_min_pct"] is not None),
        ("institution_type", lambda e: bool(e["institution_type"])),
        ("hostel_requirement", lambda e: bool(e["hostel_requirement"])),
        ("land_tenure", lambda e: bool(e["land_tenure"])),
        ("land_max_acres", lambda e: e["land_max_acres"] is not None),
        ("livestock_required", lambda e: e["livestock_required"]),
        ("fisher_required", lambda e: e["fisher_required"]),
        ("disability_required", lambda e: e["disability_required"]),
        ("disability_min_pct", lambda e: e["disability_min_pct"] is not None),
        ("ration_card_required", lambda e: bool(e["ration_card_required"])),
        ("housing_status_required", lambda e: bool(e["housing_status_required"])),
        ("welfare_board_required", lambda e: e["welfare_board_required"]),
        ("pension_excluded", lambda e: e["pension_excluded"]),
        ("maternity_required", lambda e: bool(e["maternity_required"])),
        ("first_child_only", lambda e: e["first_child_only"]),
        ("chronic_illness_required", lambda e: e["chronic_illness_required"]),
        ("unemployed_required", lambda e: e["unemployed_required"]),
    ]
    for name, fn in sorted(checks, key=lambda c: -sum(1 for e in E if c[1](e))):
        n = sum(1 for e in E if fn(e))
        print(f"    {name:<26}{n:>6}  {100*n/max(1,len(E)):>5.1f}%")
    print(f"\nWrote -> {OUT_DIR}")


if __name__ == "__main__":
    main()
