# Sevai — design brief for Claude Design

Paste this whole file into Claude Design and attach the reference images.
It describes every screen, the data behind it, and the constraints that cannot
be traded away.

---

## 1. What the product is

Sevai matches Indian citizens to government welfare schemes they can actually
claim, and tells them **why** each one matched.

**The corpus is real, not sample data.** 4,643 schemes scraped and normalised
from myscheme.gov.in — 668 nationwide, the rest across 36 states and UTs. A
citizen loads central + their own state only (≈900 schemes for Tamil Nadu).

**The user.** Rural or semi-urban India. Often low-literacy. Often on a shared
phone with a cracked screen. Frequently reading in Tamil, Hindi, Telugu, Bengali
or another Indian script rather than English. They are about to find out whether
they are owed money — a genuinely vulnerable moment.

**The tone I want.** Every existing route to a welfare scheme in India is
adversarial by accident: dense forms, red asterisks, English-only PDFs, a queue
at a counter. Sevai should feel like *someone sitting beside you*, not an
interrogation. Calm, light, unhurried, and never intimidating.

**What it is NOT.** Not a fintech dashboard. Not a government portal. Not a
gamified app — no confetti, no streaks, no progress badges. Someone finding out
they qualify for ₹6,000 a year is not a celebration moment, it is a relief
moment.

---

## 2. Non-negotiable constraints

These override any aesthetic decision. Every screen must satisfy them.

### 2.1 Benefit kinds must never look like they can be added together

A scheme's money comes in five kinds, and they are categorically different:

| Kind | What it means | Field |
|---|---|---|
| **Cash** | Money the citizen receives | `benefit.cash` (always annualised), `benefit.cash_frequency` = `annual` / `monthly` / `one_time` / `unknown` |
| **Loan ceiling** | Borrowing capacity — **must be repaid**, not income | `benefit.loan_ceiling` |
| **Subsidy** | A discount on a cost they still incur | `benefit.subsidy` |
| **Insurance cover** | A contingent payout on death/disability — not money in hand | `benefit.insurance_cover` |
| **In kind** | Goods, training, equipment | `benefit.in_kind` |

Rules: they never share a row. No `+`, `=`, or "total" between them. Only cash
may be rendered at full weight/contrast. A loan must be visually incapable of
reading as cash — differ in **face, weight, colour and container simultaneously**,
not colour alone. A one-time payment must never be labelled "per year".

An earlier version summed everything into "₹1.0 Cr per year", 23% of which was
invented by a `₹50,000` placeholder for unparseable schemes. That is the single
worst thing this product could do. **Never invent an amount.** If a scheme has
not published one, say so.

### 2.2 The citizen must always be able to tell why something matched

Every matched scheme carries the answers that caused the match. This is the
product's core trust mechanism and must be visible on the artefact itself, not
behind a disclosure.

### 2.3 Multi-script typography is a hard requirement

Tamil, Hindi, Telugu, Bengali, Kannada, Malayalam, Gujarati, Gurmukhi, Odia.
- Indian scripts **have no uppercase** — never apply `text-transform: uppercase`
  to them. Uppercase treatments must be Latin-only.
- Indic glyphs are taller with deeper descenders: they need ~1.35–1.5 line-height
  where Latin display can sit at 1.1, and far gentler letter-spacing (Tamil
  conjuncts collide if tracked like Latin).
- **Scheme names are long and get longer in translation.** "Innovation In Science
  Pursuit For Inspired Research (INSPIRE) - Scholarship" is typical. They must
  wrap gracefully across 2–3 lines, never truncate mid-word, and never use a
  display face.
- Reserve ~1.35× the vertical space any English string occupies.

### 2.4 Privacy on a shared screen

Caste, disability status, marital status and pregnancy are answered but must
**never** be displayed as persistent on-screen labels — someone may be reading
over the citizen's shoulder. They can be revealed behind an explicit tap.

### 2.5 Honesty

No invented statistics anywhere, including marketing. Real corpus numbers only.

---

## 3. Every screen

### 3.1 Landing

The first thing a competition judge sees. Must make someone believe the product
before touching it.

Content: wordmark; language toggle; one-line eyebrow; a large headline ("Know
what you are owed"); a short paragraph explaining that we check every central and
state scheme and show why each matched; a primary CTA ("Find my schemes") with a
"takes about two minutes" reassurance; four real figures (**4,643 schemes · 36
states & UTs · 668 central · 0 forms to fill**); three "how it works" steps; and
an honest "what this does not do" note (Sevai does not submit applications or
promise money).

*Currently the weakest thing about it is that it's a single centred column of
stacked blocks. It needs real editorial structure and a reason for the eye to
move.*

### 3.2 Onboarding — one question per screen

**This is the part I'm happiest with structurally — please preserve the idea and
raise the craft.** Not a chat log, not a paginated form. Each question owns the
whole screen and is asked in large type, like someone speaking.

The flow is **adaptive**: 7 base questions everyone answers, then conditional
branches. Worst case is 12 questions; a male farmer sees 10.

**Base:** state (36 options — needs a genuinely good picker, this is the one
screen with a long list) · age band · gender · community · ration-card type ·
occupation · disability.

**Branches:** student → study level, last exam %, government/private institution ·
farmer → land tenure (owner / tenant / sharecropper / landless), acres, livestock ·
daily-wage or artisan → labour welfare board registration · woman → maternity
status, marital status · 58+ → already drawing a pension · BPL → housing status.

Each screen needs: a back control, progress that does not depend on literacy or
colour vision (I use both a warming background and discrete dots), the question,
optional helper text, large full-width tappable options (≥52px), an optional
"skip this", and **the running list of answers so far**.

States to design: first question (nothing answered yet), a mid-flow question, the
long state-picker, a skippable sensitive question.

### 3.3 Processing — the emotional beat

The moment before someone finds out what they're owed. This deserves the most
craft in the product.

Currently: a soft gradient sphere; the citizen's answers collapse inward and
*become* it; a ring draws around it; a counter ticks up through the real number
of schemes being checked (~900); and narration steps through what it's doing —
"Reading your answers" → "Central schemes" → "Tamil Nadu schemes" → "Matching
your work and age" → "Community and income schemes" → "Checking what each one is
worth". Runs ~4.2s. A line reassures that details stay on the device.

Narration names **categories, never values** — "community schemes", never the
citizen's actual caste.

### 3.4 Reveal

Content: eyebrow; the scheme count counting up, very large; an honest split
("143 written for someone like you · 158 more open to all citizens"); a money
block built from the **5 strongest matches by fit** (not the sum of all matched
schemes — summing 301 schemes gives ₹3.8 crore, arithmetically true and a lie);
the credit-available row visually separated and marked "to be repaid — not
income"; a note that N more matched without a published amount; and a CTA.

### 3.5 Feed — **needs the most work**

The main screen. Currently a stack of identical white rectangles with no
hierarchy or rhythm — this is the screen most in need of real design.

Content: greeting with state; language toggle; the match summary sentence; the
money summary rows; category filter chips with counts (Education 99, Farming 52,
Business 42, Disability 28, Welfare 19, Employment 17, Health 17, Sports 13…);
then the scheme cards, 30 at a time with "show more".

A citizen matches **300+ schemes**. The core design problem: make several hundred
results navigable and non-overwhelming without pretending there are fewer.
Consider hierarchy between a top handful and the long tail, grouping, or density
that varies by relevance.

States: loading (shards fetching), error (offline), empty, and a citizen with 300+
matches.

### 3.6 Scheme card

Per card: scope badge (Central / state name) · category · scheme name (long,
wraps) · the benefit in its correct kind-grammar · a separated loan row when both
exist · **"why this matched you"** with the citizen's own answer chips · an
outbound "Apply on official site ↗" (opens the real government portal — only 492
of 4,643 schemes have one; the rest fall back to their myScheme page) · a
"Details" link.

Some schemes are **closed** (a past deadline) — these must be visibly
de-emphasised or excluded, never shown as though live.

### 3.7 Scheme detail

Full picture of one scheme: name, scope, category, the match reason, a benefit
breakdown with each kind on its own labelled row plus the explicit line that they
are not added together, eligibility facts that are actually populated, documents
needed (only ~19% of schemes publish these — say so honestly when absent),
application modes, and the outbound link with a note that they're leaving Sevai
for a government site and Sevai submits nothing on their behalf.

### 3.8 Apply

A pre-application checklist, not a real submission. Shows the profile that will
be used, a document checklist, and a camera-based document scanner that reads an
ID and auto-fills. **This screen currently displays the citizen's community/caste
in plain text — that must change per §2.4.**

### 3.9 Applications

A list of schemes the citizen has started, each with a status timeline. Some are
rejected with a remediation path rather than a dead end. Deliberately shows no
rupee figure — an amount beside a pending status implies money is owed.

### 3.10 Profile

The citizen's answers, editable. Rows are driven by the same question definitions
as onboarding so the two can never drift. Includes their answer chips, a privacy
banner ("stored only on this device"), alert settings, an audit log of any
assisted access, and a reset.

### 3.11 Sahayak mode — assisted access

A helper (village worker, shopkeeper, relative) enters a PIN and a beneficiary
code to act on someone else's behalf, time-boxed and audited. Needs to feel
visibly *different* from the citizen's own view so nobody forgets whose data
they're looking at.

### 3.12 Shell

Bottom navigation: Schemes · Applications · Profile. **Currently uses emoji
icons — please replace with a real icon treatment.**

---

## 4. Direction

Light. A very light, softly blurred gradient background — subtle, not
decorative. See the attached references for the feel; match the *feel*, not the
layout.

Two things I'd ask you to hold onto from the current build, because they're the
ideas rather than the styling:

1. **The answer chips as a continuous thread** — the citizen's answers persist
   from onboarding, form the processing sphere, and reappear as the match reason
   on every card. Same object throughout.
2. **The background carries state** — it warms as the citizen advances, so
   progress is legible without reading anything.

Everything else — type, layout, grid, card structure, iconography, motion — is
open. The current post-onboarding screens are a recolour of an older design and
should be treated as a starting point to replace, not preserve.

Performance note: large `filter: blur()` on full-viewport elements drops budget
Android phones below 30fps — gradient blooms should be painted, not blurred. And
entrance animations must never be what makes content visible.
