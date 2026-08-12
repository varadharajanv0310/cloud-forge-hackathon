# Sevai — Project Document

Complete explanation of the idea, the build, and what is and is not integrated.
Written to be turned into a presentation. A suggested slide breakdown is at the
end (§15).

Everything marked **[VERIFIED]** was measured in this codebase against the real
dataset. Everything marked **[NOT BUILT]** is honest scope we have not shipped.

---

# PART 1 — THE IDEA

## 1. The problem

India runs roughly **4,600 live welfare schemes** across the central government
and 36 states and union territories. Agricultural input subsidies, maternity
benefits, education stipends, housing grants, pensions, crop insurance, tool
kits, scholarships.

Most never reach the person they were written for.

**The failure is not eligibility. It is discovery.** A rural claimant typically
learns a scheme exists by word of mouth, often after the window has closed. They
cannot look one up, because every official discovery channel assumes four things
at once:

1. a smartphone,
2. a data connection,
3. a supported language,
4. and the literacy to read a government form.

The people with the strongest claim on these schemes are precisely the people
least likely to have all four.

**The second failure is delegation.** People who cannot complete an application
hand their documents and identity to whoever can operate the form — a relative,
a village worker, an NGO volunteer, sometimes a paid intermediary. This is
universal and entirely undocumented. The citizen has no record of what was done
for them and no way to revoke access. Most systems pretend it does not happen,
which leaves it unprotected.

## 2. Why the obvious solution does not work

The obvious solution is a search box over a scheme database. It fails for three
reasons, and we measured all three.

**(a) Search assumes you know what to search for.** A citizen does not know that
"Moovalur Ramamirtham Ammaiyar Ninaivu Marriage Assistance Scheme" is the thing
that would pay for their daughter's wedding.

**(b) The published data is not machine-readable in the way you'd hope.**
**[VERIFIED]** Of 4,643 schemes, **13% declare no machine-readable eligibility
criterion at all**, and another 24% declare exactly one. myScheme publishes a
required-documents list for **0 of 4,643** schemes. Eligibility lives in prose:
*"The annual income of the family of the applicant should not exceed ₹72,000/-."*

**(c) A naive matcher returns everything.** With a six-attribute profile — age,
gender, caste, occupation, income, district — a typical citizen "matches"
**3,364 of 4,643 schemes**. That is not a result, it is a phone book.

## 3. The insight

> **Invert discovery, then prove the match.**

Two moves:

**Move one — ask, don't search.** The citizen answers a small number of
questions about themselves once. The engine evaluates that profile against the
entire catalogue and returns what they are entitled to. They never read a scheme
document to decide whether it applies to them.

**Move two — show your working.** Every matched scheme carries the citizen's own
answers back to them as the reason it matched. Not an eligibility table — the
actual words they tapped. `farmer · SC · 1.75 acres`.

This second move is what makes the first one trustworthy. A black box that says
"you qualify for 300 schemes" is worthless to someone who has been let down by
institutions before.

## 4. What Sevai does

1. Asks 7–12 adaptive questions in the citizen's own language.
2. Checks all central schemes plus their own state's — **never another state's**.
3. Returns matches ranked by fit, each showing why it matched.
4. States honestly what each is worth, separating money received from money
   borrowed, and never inventing an amount.
5. Links out to the real government application page.
6. Supports assisted access — someone else can help, time-boxed and audited.

---

# PART 2 — HOW IT WORKS

## 5. Architecture

```
  ┌──────────────────── OFFLINE / BUILD TIME ─────────────────────┐
  │  myscheme.gov.in                                              │
  │        │                                                      │
  │        ▼                                                      │
  │  fetch_schemes.py     ── facet inversion + detail fetch       │
  │        │                 4,760 records, all 36 states         │
  │        ▼                                                      │
  │  normalize_schemes.py ── money parsing, attribute extraction, │
  │        │                 dedup, sharding                      │
  │        ▼                                                      │
  │  client/public/data/  ── central.json + 36 state shards       │
  └───────────────────────────────┬───────────────────────────────┘
                                  │  fetched at runtime, cached by SW
  ┌───────────────────────────────▼───────────────────────────────┐
  │  CLIENT (React + Vite)                                        │
  │                                                               │
  │  profileSchema.js  ─ adaptive question flow (19 attributes)   │
  │        │                                                      │
  │        ▼                                                      │
  │  Citizen Identity Vault ─ encrypted, on-device, never sent    │
  │        │                                                      │
  │        ▼                                                      │
  │  eligibilityEngine.js ─ hardFilter → score → fuzzy → totals   │
  │        │                                                      │
  │        ▼                                                      │
  │  Feed · Scheme detail · Apply · Sahayak mode                  │
  └───────────────────────────────┬───────────────────────────────┘
                                  │  /api/*  (optional enrichment)
  ┌───────────────────────────────▼───────────────────────────────┐
  │  SERVER (Express) — holds NO citizen data by design           │
  │  summarise scheme · extract intent · OCR document · TTS       │
  └───────────────────────────────────────────────────────────────┘
```

**The key architectural decision:** the identity vault sits on the client side
of the boundary. Scheme matching needs the profile; the server does not — so the
profile never crosses. A compromised server exposes scheme queries, not the
identity documents of every citizen who used the system.

## 6. The data pipeline — the genuinely hard part

### 6.1 Harvesting

myScheme's public API rejects a bare key with a 401. It requires the key **plus**
a session cookie and matching `Origin`/`Referer` — the combination a browser
supplies for free. We replicate it with a plain cookie jar, which means no
headless-browser dependency.

**Facet inversion.** myScheme indexes every scheme against structured facets
(gender, caste, occupation, age band, BPL status, residence, disability
percentage, marital status, employment status…) but does **not** return them on
the scheme record. So instead of 4,600 per-scheme calls, we query **once per
facet value** and record which schemes come back, then invert that mapping.

We only query *restrictive* values — a scheme tagged `gender: All` is not
narrowed by gender, so recording it buys nothing and those are by far the most
expensive queries. **[VERIFIED]** 18 facets → 76 restrictive values → ~532 pages,
about 4 minutes, and it yields structured eligibility for all 4,771 schemes.

Then a per-slug detail fetch for the prose the facets cannot carry: benefits
markdown, eligibility markdown, application URL and mode.

**[VERIFIED]** 4,760 records harvested, **100% with both detail and facets**,
resumable, ~50 minutes end to end.

### 6.2 Normalising money — where most of the intellectual work went

The naive approach — and what the earlier version of this project did — is to
regex every rupee figure out of the benefits text and take the maximum. That
produces nonsense:

- *"a loan of up to ₹10,00,000"* becomes a ₹10 lakh **benefit**
- *"₹1,500 per month (₹18,000 per annum)"* becomes ₹2.16 lakh if you take the
  larger figure and then annualise it again
- *"₹5 lakh"* parses as **5**, which is why a scheme card once read
  *"For families earning under ₹5 per year"*

v2 parses **clause by clause**, and for every figure independently determines:

| Dimension | How |
|---|---|
| **Kind** | keyword classification — insurance → subsidy → loan → cash, in that precedence |
| **Frequency** | read from the words *immediately following* the figure, not the clause as a whole |
| **Magnitude** | lakh/crore aware, Indian comma grouping (`2,00,000`) |
| **Plausibility** | ceiling by beneficiary type — ₹20 lakh for an individual, higher for institutions |

Five kinds are tracked separately and **never summed**: `cash` (always
annualised, with `cash_frequency`), `loan_ceiling`, `subsidy`,
`insurance_cover`, `in_kind`.

**Real bugs this caught, each verified against source text:**

- **Institutional grants counted as citizen benefits.** `schemeFor: Infra` marks
  245 schemes — a ₹5 crore "Centre of Excellence" grant is real, but a citizen
  cannot claim it. Now tagged `beneficiary_type` and excluded from a citizen's feed.
- **Insurance cover counted as cash.** PM Suraksha Bima Yojana's ₹2,00,000 is a
  contingent death payout, not money received. Separated.
- **Scheme titles as evidence.** "Loan Based Schemes For Safai Karamchari" quotes
  ₹10,00,000 in a clause with no loan keyword. The title now biases classification.
- **`Rs.` breaking sentence splitting**, severing "Rs." from its own amount and
  silently losing the figure.

### 6.3 Extracting discriminative attributes

**[VERIFIED]** Measured across the full corpus, this is what schemes actually
gate on:

| Discriminator | Schemes | | Discriminator | Schemes |
|---|---|---|---|---|
| student marks % | **984** | | class / standard | 197 |
| domicile / state | 646 | | ITI / diploma | 185 |
| welfare-board registration | **410** | | livestock | 180 |
| course level (UG/PG/PhD) | 359 | | marriage | 174 |
| ration-card type | 323 | | institution type | 169 |
| disability | 221 | | widow / destitute | 152 |

Two findings worth presenting:

- **Marks percentage is the single biggest gate in the entire corpus** (984
  schemes), and no system asks for it.
- **Labour-welfare-board registration is second** (410), and it is a plain yes/no
  a worker already knows.

`normalize_schemes.py` extracts 18 such attributes into structured fields. The
occupation facet covered only 23% of schemes; prose extraction raised it to
**53%**, and ungated schemes fell from 17% to **13%**.

### 6.4 Sharding

**[VERIFIED]** The full corpus is 13.2 MB. Bundling it as JavaScript would break
the low-bandwidth premise the product rests on.

The product rule — *central + own state only* — is also the sharding key. A Tamil
Nadu citizen downloads `central.json` + `state-tamil-nadu.json` = **385 KB
gzipped for ~900 schemes**. For comparison, the earlier version shipped 411 KB of
bundled JavaScript for 233 Tamil-Nadu-only schemes. Files are static and cached
by the service worker, so the offline story survives.

**Subtle correctness bug caught here:** 14 schemes are tagged `level: Central`
while naming specific states (one covers Kerala + Tamil Nadu only). Trusting the
level would show them to all 36 states; filing a multi-state scheme under
`states[0]` alone would hide it from everyone else entitled to it. Reach is now
the state list, not the level.

## 7. The matching engine — the discrimination problem

### 7.1 Why six attributes are not enough

This is the most interesting technical story in the project.

**[VERIFIED]** With the original profile — age, gender, caste, occupation,
income, district — a typical citizen matched **3,364 of 4,643 schemes**. Adding
state scoping and institution filtering brought it to ~390. Still a phone book.

The cause is information-theoretic. Six attributes is roughly six bits of signal
against a corpus that gates on far more. Concretely:

- **1,139 education schemes**, and "student" is *one bit* — so every student
  matched all of them.
- **221 disability schemes** existed in the corpus with **no question that could
  ever reach them**. They were unreachable for every user.
- **118 housing schemes** — PMAY cannot be matched without knowing whether the
  household already owns a pucca house.

### 7.2 The fix: a corpus-derived attribute model

Rather than guessing at questions, we mined the corpus for what it actually gates
on (§6.3) and built the question set from the evidence. 19 attributes, adaptive:

**Base (7, everyone):** state · age · gender · community · **ration-card type** ·
occupation · **disability**

**Conditional branches:**

| Trigger | Questions |
|---|---|
| student | study level · last exam % · government or private institution |
| farmer | land tenure (owner/tenant/sharecropper/landless) · acres · livestock |
| daily wage · artisan · fisher · small business | labour welfare board registration |
| woman, 18–45 | maternity status · marital status |
| age 58+ | already drawing a pension |
| BPL / AAY / priority card | housing status |

Design decisions worth defending in the presentation:

- **Ration-card type replaces annual income as the primary poverty signal.**
  Citizens genuinely do not know their annual income; everyone knows their card
  colour. Income is retained as an optional refinement.
- **Land in acres and cents, never hectares.** Nobody thinks in hectares.
  Converted internally.
- **Tenure is asked separately from ownership.** Tenants and sharecroppers are
  excluded from land-linked schemes and specifically included in others, and
  almost no system asks.
- **Disability is a base question, not conditional** — it cuts across every
  occupation, and 221 schemes depended on it.
- **Worst case is 12 questions.** A male farmer sees 10.

### 7.3 Results

**[VERIFIED]** Same corpus, same profiles:

| Profile | v1 (6 attrs) | v2 (+scoping) | v3 (full model) | change |
|---|---|---|---|---|
| TN student, Class 11–12, govt school, 78% | 3,364 | 390 | **215** | −94% |
| TN farmer, owns 1.75 acres, livestock, SC | 3,522 | 314 | **250** | −93% |
| Kerala daily-wage widow, board-registered, AAY | 3,814 | 253 | **218** | −94% |
| UP man, 62, disabled 40%+, pensioner | 3,100 | 195 | **183** | −94% |

Education block for that student: **204 → 83**.
Disability schemes reachable by a disabled citizen: **0 → 14** (of 330 gated).
Cross-state leakage: **0** — verified explicitly.

### 7.4 Ranking

Deadline urgency was worth 25 points in the old scoring — but **only 5 of 4,643
schemes publish a closing date**, so it was a flat constant. District success
rate was worth 20 points and scored synthetic demo numbers. Both were rebalanced
onto things that are real:

benefit value (35, log-scaled so a large grant doesn't swamp everything) ·
targeting precision (25) · application simplicity (15) · locality (12) ·
deadline urgency (10, only when a real date exists) · direct application URL (3).

## 8. The honesty layer — the strongest part of the story

### 8.1 The ₹1 crore problem

The earlier version displayed a single headline: **"₹1.0 Cr per year."**

**[VERIFIED]** It was wrong four ways at once:

1. **23% was invented.** Any scheme whose amount could not be parsed contributed
   a hardcoded ₹50,000. For the demo profile that was ₹22.5 lakh of pure fiction.
2. **It summed loan ceilings with grants.** Borrowing capacity is not income.
3. **It labelled one-time payments "per year."**
4. **It took the maximum rupee figure in each scheme's text** regardless of what
   that figure referred to.

### 8.2 Fixing the parse was not enough

Here is the finding worth a slide of its own. After fixing every individual
figure, we summed the correctly-parsed cash across a citizen's matches and got
**₹3.78 crore**.

Every rupee arithmetically defensible. Still a lie — because **nobody applies to
390 schemes.**

The aggregate itself was the problem, not the arithmetic.

### 8.3 What we show instead

The headline is built from the **5 strongest matches by fit** — a figure a person
could actually go and claim:

| Profile | Headline |
|---|---|
| 50yo SC farmer, TN | **₹1.38L one-time** (PMAY-Urban ₹2.5L, PMAY-Gramin ₹1.3L, …) |
| 20yo female student | **₹7.7L/year** (Savitribai Phule Fellowship, NMMSS, Moovalur Ramamirtham) |
| 28yo daily wage | **₹1.0L/yr + ₹8.8L one-time** |

Human-scale, checkable, and made of schemes the citizen can name.

Alongside it, three rules hold everywhere in the product:

- **Kinds never share a row.** Cash is the only kind set in the display typeface;
  a loan sits in a muted inset panel with a ↩ glyph and the words *"to be repaid
  — not income."* They differ in face, weight, colour **and** container, so the
  eye cannot add them.
- **Unparseable amounts are counted, never valued.** *"99 more schemes matched
  but have not published an amount, so we have not guessed one."*
- **The match count is framed honestly.** *"143 written for someone like you ·
  158 more open to all citizens"* — because most of the catalogue carries no
  restrictions at all, and a bare "301 matches" reads as far more personal than
  it is.

## 9. The experience

**Design position:** *Government paperwork feels like an interrogation. This
should feel like someone sitting beside you.* The softness is not decoration —
it is reassurance, for someone on a shared phone about to learn whether they are
owed money.

**Landing** — real corpus figures only (4,643 schemes · 36 states · 668 central ·
0 forms). The previous version claimed "₹4Cr+ Claimed Successfully" and "12k
Farmers Served"; both were invented and are deleted.

**Onboarding** — one question per screen, asked in large type. Not a chat log,
not a paginated form. Progress is expressed three ways deliberately: the
background warms as you advance (needs no literacy), the answer thread grows, and
discrete dots provide redundancy for colour-blind users and low-gamut screens.

**Processing** — the emotional beat. The citizen's answers collapse inward and
*become* a sphere; a ring draws; a counter ticks through the real number of
schemes being checked; narration shows the work. It names **categories, never
values** — "community schemes", never the citizen's actual caste, because this is
frequently a shared screen.

**The signature idea — the Thread.** Every answer becomes a chip. Chips persist
through onboarding, form the sphere, and reappear on every scheme card as the
match reason. It answers *"why am I seeing this?"* as a visual property rather
than a disclosure link, and it works at low literacy because each chip carries the
exact word the citizen tapped.

**Sahayak mode** — assisted access made explicit. A PIN opens a time-boxed,
scoped, audited session against a beneficiary's profile. Assisted access happens
regardless of what software permits; making it a constrained first-class feature
is safer than forcing it to route around the system.

---

# PART 3 — WHAT IS ACTUALLY BUILT

## 10. Build status — the honest table

### Fully built and verified

| Component | Evidence |
|---|---|
| Harvester, all 36 states + UTs | 4,760 records, 100% with detail + facets |
| Normaliser: money, attributes, sharding | 4,643 schemes, 37 shards, 13.2 MB |
| Central + own-state scoping | 0 cross-state leakage, verified |
| Eligibility engine v3, 19 attributes | −94% match reduction, measured |
| Adaptive question flow | 7–12 questions, branching verified in browser |
| Honest money model | 5 kinds separated, never summed |
| Landing / Onboarding / Processing / Reveal | designed and verified in browser |
| Scheme card with match reasons | the Thread, rendering |
| On-device encrypted vault | never transmitted |

| Every screen on the design system | Feed, detail, apply, profile, applications, Sahayak — ported, verified in browser |
| Document type detection | Aadhaar, PAN, driving licence — with the real Verhoeff checksum |
| Aadhaar Secure QR, decoded on device | no dependency, no network, no API key |
| Camera capture | three separate root causes fixed; verified opening in browser |

### Partially built

| Component | State |
|---|---|
| **Vision OCR fallback** | The pipeline is complete and correct, but with no `ANTHROPIC_API_KEY` set it returns clearly-labelled mocks (`source: "mock"`). One env var away from live. |
| **DigiLocker** | Real OAuth 2.0 + PKCE, state validation, server-only tokens, issued-document list and pull — all implemented. Without a NeGD partner credential it runs in a mode labelled DEMONSTRATION on screen and `source: "demo"` in every payload. |
| **Voice input** | Works in the apply flow (fill-by-speaking). **Not wired into onboarding** — `useTTS` is imported there but only `stop()` is called, so questions are never read aloud and there is no speech input. That is the one that would change who can use this. |
| **Text-to-speech** | ElevenLabs integration works; the browser's own SpeechSynthesis is the fallback when no key is set. |
| **Other Indian document QRs** | EPIC, Parivahan driving licence and vehicle RC carry QR codes, but their payloads are not publicly standardised and vary by state. Best-effort shape matching only, and reported as `medium`/`low` confidence rather than laundered into a fact. |

### Designed, not implemented **[NOT BUILT]**

| Feature | Why it's not shipped |
|---|---|
| **WhatsApp / Telegram / SMS channels** | The core of the multi-channel concept. WhatsApp Business API needs Meta verification (weeks); Indian SMS needs DLT registration with a registered entity (weeks). **Telegram is free and needs no approval — this is the one to build next.** |
| **Toll-free number** | A 1800 series number goes through DoT/telco allocation. **Obtainable alternative:** a virtual number with IVR from an Indian CPaaS (Exotel, Knowlarity) delivers the entire user-facing benefit in days. |
| **QR code for Sahayak** | Currently a mock QR graphic with three hardcoded beneficiary codes. Real QR is small work — `BarcodeDetector` is already wired for document scanning — and the interesting part is making the token signed and expiring. |
| **Voice-driven onboarding** | The one gap that changes *who* can use the product. Voice already works in the apply flow; onboarding needs the question read aloud and the answer taken by speech. |
| **Tamil scheme catalogue** | `name_ta` is null for all 4,643 schemes. The plan — one offline batch translation job baked into the data file — was scoped but never run. **This is the single highest-value remaining item for a Tamil Nadu audience.** |
| **Application submission** | No government API exists to submit to. We link out to the official portal instead, and say so. |

## 11. Known limitations — state these before a judge finds them

**Data limitations we cannot fix:**

- **13% of schemes declare no machine-readable eligibility criterion.** They match
  everyone regardless of how many questions we ask. The ceiling is myScheme's
  prose, not our model.
- **myScheme publishes a documents list for 0 of 4,643 schemes.** We recover them
  from prose, reaching only ~19% of schemes (12 of 233 in Tamil Nadu).
- **Only 508 of 4,707 scheme rows publish a direct department URL** (about 10%).
  The rest link to their myScheme page, and the UI labels which is which.
- **Only 5 schemes publish a closing date**, so deadline-driven features are
  largely inert by nature.
- **67 individual schemes still claim over ₹10 lakh cash** — a residual tail of
  aggregate figures our plausibility ceiling does not catch.

**Our own gaps:**

- **No `ANTHROPIC_API_KEY` is set**, so the vision OCR fallback returns mocks. They
  are labelled `source: "mock"` in the payload and never presented as a real read,
  but the camera's OCR path is not live until a key is supplied. The QR path needs
  no key and is genuinely live.
- **No DigiLocker partner credential.** The OAuth flow is real and complete; without
  a client id and secret from NeGD it runs against sample documents and says so on
  screen, in words, not in a tooltip.
- **`BarcodeDetector` does not exist on Safari or iOS.** The QR path is skipped
  silently there and vision OCR handles the card instead — correct behaviour, but it
  means the best experience is Android/Chrome today. A WASM decoder would close this.
- **We parse the Aadhaar QR signature; we do not verify it.** Verifying needs UIDAI's
  certificate and a real RSA verify. `signatureVerified` is hardcoded `false`
  everywhere and the wording on screen is "read from the card's QR code", never
  "verified by UIDAI". This distinction is deliberate and should be stated, not
  glossed.
- **PAN has no public checksum.** Format and the holder-type character are checked;
  anything claiming more would be folklore.
- `verified_by`, `district_applicants` and `total_applicants_this_month` are
  **synthetic demo data**, retained deliberately for the narrative. They are now
  seeded on the scheme id so they are reproducible rather than random. **They must
  be replaced or removed before real users see them.**
- Sahayak PINs are demonstration values, not cryptographic sessions.
- No accessibility audit has been carried out with the intended user population.

## 12. Measured results — the numbers for the deck

| Metric | Before | After |
|---|---|---|
| Schemes in catalogue | 233 (Tamil Nadu only) | **4,643** (36 states + UTs) |
| Matches for a typical citizen | 3,364 | **215** (−94%) |
| Education schemes for one student | 204 | **83** |
| Disability schemes reachable | **0** | 221 in corpus, 14 for a given profile |
| Headline money figure | ₹1.0 Cr (23% invented) | **₹6,000/yr** for a smallholder — PM-KISAN's real figure |
| Schemes wrongly tagged as farming | 281 (from the word "agriculture" in ministry boilerplate) | **0** |
| Research fellowships in a farmer's top 5 | 5 (₹30.8 lakh/yr) | **0** |
| Aadhaar single-digit errors caught | n/a | **100%** (Verhoeff, measured over 2.16M mutations) |
| Aadhaar adjacent transpositions caught | n/a | **100%** — this is what separates Verhoeff from Luhn |
| Schemes with a bogus income limit | 2 (`₹5/year`) | **0** |
| Category accuracy | health 4, housing 1 | health 259, housing 118, disability 221 |
| Cross-scheme links per scheme | 228 (everything linked to everything) | **3.4** |
| Occupation coverage on schemes | 23% | **53%** |
| Payload for a citizen | 411 KB JS (233 schemes) | **385 KB gzipped (900 schemes)** |
| JS bundle | 700 KB | **434 KB** |
| Cross-state leakage | n/a | **0** |

## 13. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Harvest + normalise | **Python 3** (stdlib only) | Runs anywhere without install; no headless-browser dependency |
| Client | React 18 + Vite | Fast iteration |
| Styling | Tailwind + a token system (`DESIGN.md`) | Token, rule and rationale in one file |
| Motion | Framer Motion + CSS | Entrances are CSS so visibility never depends on JS |
| Server | Node + Express | Thin proxy; holds no citizen state by design |
| Language / vision | Claude API | Scheme summarisation, intent extraction, document OCR |
| Speech | Web Speech API (in) + ElevenLabs (out) | Capture without a paid STT service |
| Storage | Encrypted browser local storage | Keeps the identity vault off the server |
| Data delivery | Static JSON shards + service worker | Offline after first visit |

## 14. Roadmap

**Immediate (before any demo)**
1. Update the Claude model ID — one line, unblocks every AI feature.
2. Add `ELEVENLABS_API_KEY` to `.env.example`.
3. Fix the four known UI defects in §11.

**Next (highest value per unit of work)**
4. **Batch-translate the catalogue into Tamil.** One offline job, baked into the
   data file. Zero runtime cost, and it makes the Tamil-first claim true.
5. **Telegram channel adapter.** Free, no approval, proves the multi-channel
   architecture is real.
6. Redesign the post-onboarding screens properly (brief already written in
   `CLAUDE_DESIGN_BRIEF.md`).

**Then**
7. IVR access line via an Indian CPaaS — delivers the toll-free benefit in days.
8. Signed, expiring QR tokens for Sahayak mode.
9. SMS adapter once DLT registration completes.
10. Field testing with village-level workers to validate the delegation model.

---

# PART 4 — PRESENTATION

## 15. Suggested slide breakdown

| # | Slide | Content |
|---|---|---|
| 1 | Title | Sevai — *know what you are owed* |
| 2 | The problem | 4,600 schemes. The failure is discovery, not eligibility. Four assumptions every official channel makes. |
| 3 | The second problem | Undocumented delegation — people hand over their identity to whoever can fill the form. |
| 4 | Why search doesn't work | You can't search for a scheme whose name you've never heard. |
| 5 | The insight | Invert discovery, then prove the match. |
| 6 | Demo | Onboarding → the sphere → the reveal. *This is the moment; give it time.* |
| 7 | Architecture | The diagram from §5. Emphasise: the vault never leaves the device. |
| 8 | The data problem | 0 of 4,643 schemes publish a document list. 13% declare no criterion. Eligibility lives in prose. |
| 9 | Facet inversion | How we got structured eligibility for 4,771 schemes without 4,771 calls. |
| 10 | **The ₹1 crore slide** | The old headline, and the four ways it was wrong. 23% literally invented. |
| 11 | **The harder truth** | Fixing the parse gave ₹3.78 crore. Every rupee correct. Still a lie. Nobody applies to 390 schemes. |
| 12 | What we show instead | Top 5 by fit. ₹1.38L. Checkable, nameable, human-scale. |
| 13 | Kinds are never summed | The loan row. Face, weight, colour and container all differ. |
| 14 | The discrimination problem | 6 attributes → 3,364 matches. 1,139 education schemes, "student" is one bit. 221 disability schemes unreachable. |
| 15 | Corpus-derived questions | The discriminator table. Marks % gates 984 schemes and nobody asks it. |
| 16 | Results | The −94% table. |
| 17 | The Thread | The signature idea — answers become the sphere become the match reason. |
| 18 | Sahayak mode | Assisted access made explicit, scoped, time-boxed, audited. |
| 19 | **What we did not build** | Be first to say it. The §10 table. Judges trust teams that draw this line. |
| 20 | Roadmap | Telegram next, Tamil catalogue next, IVR after. |
| 21 | Close | *We do not promise money. We tell people what they are owed, and why.* |

**Presentation advice:** slides 10–12 are the strongest sequence in the deck.
Most teams show a big number. Showing that you found a big number, proved it was
wrong, fixed it, found it was *still* wrong, and then changed what you display —
demonstrates engineering judgement that a feature list cannot.

Slide 19 is not a weakness. An honest scope boundary is the most credible thing
in a hackathon deck.
