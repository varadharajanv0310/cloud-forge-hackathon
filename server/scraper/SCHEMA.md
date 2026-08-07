# Scheme data contract (v2)

Produced by `normalize_schemes.py`, consumed by the client. This is the single
source of truth — the normalizer and every client file that reads scheme data
must agree with this document.

## Why v2 exists

v1 (`normalizeLocal.js`) inferred everything from prose with regexes and had
three structural faults:

1. `benefit_amount` was `Math.max()` over *every* rupee figure in the benefits
   text, so a scheme offering "a loan up to ₹10,00,000" recorded a ₹10 lakh
   benefit. Loans, subsidies and grants were one undifferentiated number.
2. Nothing recorded **frequency**, so ₹1,500/month and ₹1,500 one-time were the
   same number, and the UI labelled the sum "per year".
3. Eligibility was regex-guessed from prose. `₹5 lakh` parsed as `5`, which is
   why a scheme card read *"For families earning under ₹5 per year"*.

v2 reads myScheme's **structured facets** for eligibility and parses benefits
clause-by-clause with explicit frequency and kind.

---

## Record shape

```jsonc
{
  "id": "pm-kisan",                    // myScheme slug, stable
  "name_plain": "PM Kisan Samman Nidhi",
  "name_official": "Pradhan Mantri Kisan Samman Nidhi",
  "name_ta": "பிரதமர் கிசான் …",        // filled by translate_schemes.py; null until then

  // ── Scoping ──
  // `nationwide` is the authority, NOT `level`. 14 schemes carry level=Central
  // while naming specific states (one covers Kerala + Tamil Nadu only), so
  // trusting the level would show those to all 36 states. Conversely a
  // multi-state scheme filed only under states[0] would be invisible to
  // everyone else entitled to it.
  "level": "central" | "state",        // provenance, informational
  "nationwide": true,                  // THE scoping flag
  "state": "Tamil Nadu" | null,        // scalar only when exactly one state
  "states": ["Kerala", "Tamil Nadu"],  // full reach; ["All"] when nationwide
  "beneficiary_type": "individual" | "family" | "institution",

  "category": "farming",               // primary (first mapped)
  "categories": ["farming", "employment"],
  "ministry": "Ministry Of Agriculture and Farmers Welfare" | null,

  "description_long": "…",
  "description_simple": ["…", "…", "…"],     // 3 plain-language bullets
  "description_simple_ta": ["…","…","…"] | null,

  // ── Eligibility: from structured facets, thresholds from prose ──
  "eligibility": {
    "min_age": 18 | null,
    "max_age": 60 | null,
    "gender": "any" | "female" | "male" | "transgender",
    "caste_required": ["SC","ST"],     // [] = open to all
    "income_max_annual": 72000 | null, // ALWAYS annualised
    "occupation": ["farmer"],          // [] = any
    "residence": "any" | "rural" | "urban",
    "bpl_required": false,
    "disability_required": false,
    "minority_required": false,
    "student_required": false,
    "marital_status": ["widowed"],     // [] = any
    "employment_status": ["unemployed"],
    "state": "Tamil Nadu" | null,      // mirrors top-level, used by hardFilter
    "additional_conditions": "…" | null
  },

  // ── Money: the v2 fix. Kinds are separated and never summed together. ──
  "benefit": {
    "cash": 6000 | null,               // ANNUALISED direct cash/grant
    "cash_raw": 500 | null,            // figure as printed
    "cash_frequency": "one_time" | "monthly" | "annual" | "unknown",
    "loan_ceiling": 1000000 | null,    // credit AVAILABLE — not money received
    "subsidy": 25000 | null,
    "in_kind": "8-gram gold coin" | null,
    "type": "cash" | "in_kind" | "composite",
    "confidence": "high" | "low"       // high = parsed a real figure
  },

  "deadline": "2026-03-31" | null,
  "is_ongoing": true,
  "documents_required": ["Aadhaar Card", "Land Records"],

  // ── Outbound links (feature #9) ──
  "application_link": "https://www.myscheme.gov.in/schemes/pm-kisan",  // always present
  "official_url": "https://pmkisan.gov.in" | null,                     // real portal when published
  "application_modes": ["Online", "Offline"],

  // ── Demo-only illustrative data (kept deliberately; see note) ──
  "total_applicants_this_month": 1936,
  "district_applicants": { "Chennai": 328, … },
  "verified_by": { "name": "…", "role": "…", "district": "…", "verified_date": "…" },

  "related_scheme_ids": ["pm-fasal-bima"]
}
```

### Note on illustrative fields

`total_applicants_this_month`, `district_applicants` and `verified_by` are
**synthetic demo data**, not sourced from myScheme. They are retained for the
demo narrative by explicit decision. They are now generated from a **seeded**
RNG keyed on the scheme id, so regenerating the dataset produces identical
values instead of a noisy git diff. If this ever ships to real users these
must be replaced with real figures or removed.

---

## Money rules

**Never sum `cash` and `loan_ceiling`.** A ₹10 lakh loan ceiling is borrowing
capacity, not a benefit received. The UI shows them as separate figures.

**`cash` is always annualised.** `cash_raw` × 12 for monthly, × 1 for annual,
and one-time amounts are carried as-is with `cash_frequency: "one_time"` so the
UI can label them correctly rather than implying they recur.

**Aggregate shape** returned by the eligibility engine:

```js
{
  cashAnnual:    Number,  // Σ benefit.cash where frequency is monthly|annual
  cashOneTime:   Number,  // Σ benefit.cash where frequency is one_time
  loanCeiling:   Number,  // Σ benefit.loan_ceiling  — shown separately
  subsidyTotal:  Number,
  valuedCount:   Number,  // schemes contributing a real figure
  unvaluedCount: Number,  // eligible but no parseable amount — counted, never invented
}
```

There is deliberately **no single "total value"** number. v1's `DEFAULT_VALUE =
50000` invented ₹22.5 lakh of the ₹98.8 lakh headline (23%) for schemes whose
benefit it could not parse.

---

## Sharding

`normalize_schemes.py` writes one file per scope into
`client/public/data/`:

| File | Contents |
|---|---|
| `central.json` | `nationwide === true` only |
| `state-tamil-nadu.json` | every scheme whose `states` includes Tamil Nadu |
| `state-<slug>.json` | one per state (36 buckets, slugs verified collision-free) |
| `index.json` | manifest: available states, counts, generated-at, schema version |

A multi-state scheme is written into **every** state shard it names, so it is
duplicated across files by design — the client dedupes by `id` on load.

A Tamil Nadu user downloads `central.json` + `state-tamil-nadu.json` only. This
is what keeps the payload viable: the whole corpus as one bundled JS module
would be ~6 MB at full India scale, which breaks the offline/low-bandwidth
premise the product is built on.

Files are served from `client/public/` (static, cacheable by the existing
service worker) and fetched at runtime — **not** `import`ed into the JS bundle.
