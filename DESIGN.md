# Sevai — DESIGN.md

Token, rule, and rationale in one file. If a screen hits a case this file does
not cover, decide it from the rationale, not from taste.

---

## 0. The point of view

**Government paperwork feels like an interrogation. This should feel like
someone sitting beside you.**

Every existing route to a welfare scheme in India is adversarial by accident:
dense forms, red asterisks, English-only PDFs, a counter you queue at. The
person using Sevai is often on a shared phone, often reading slowly, and is
about to find out whether they are owed money. That is a vulnerable moment.

So the softness here is **not decoration — it is reassurance**. The light, the
space, and the single unhurried question per screen exist to signal: nothing on
this screen will trap you, and you cannot get this wrong.

Two rules fall straight out of that and override any aesthetic preference:

1. **Never show a number we cannot defend.** The old landing page claimed
   "₹4Cr+ Claimed Successfully" and "12k Farmers Served". Both were invented.
   They are deleted. Every figure on the marketing surface is now a real count
   from the corpus.
2. **Never make the citizen ask "why am I seeing this?"** The answer must be
   visible on the artefact itself.

---

## 1. Visual theme & atmosphere

Very light. One soft chromatic bloom per screen, near-white everywhere else,
generous air, one rounded surface floating on a faintly tinted canvas.

**The bloom is functional, not ornamental.** It carries state through colour
temperature, so progress is legible without reading:

| Moment | Temperature | Meaning |
|---|---|---|
| Landing | cool lavender + sky | calm, before anything is asked |
| Onboarding, early | cool | you have just begun |
| Onboarding, late | neutral mint/pearl | you are nearly through |
| Processing | contracting, saturating | the system is working |
| Reveal | warm peach + gold | the answer has arrived |

Density: **low**. One idea per screen. On content screens the bloom drops to
6–10% strength and sits behind the surface; it is never allowed to compete with
a scheme name or a rupee figure.

---

## 2. Colour palette & roles

```css
--canvas:      #FBFAFC;   /* page behind the surface, faintly cool */
--surface:     #FFFFFF;   /* the floating card */
--surface-sub: #F6F5F9;   /* inset wells, unselected options */
--ink:         #14131A;   /* headlines, cash figures — the only true black */
--ink-2:       #3D3A47;   /* body */
--muted:       #6E6B78;   /* meta, secondary */
--hairline:    rgba(20,19,26,0.08);

/* bloom stops — the ONLY saturated colour in the system */
--bloom-lavender: #C9BEEF;
--bloom-sky:      #B8D4F0;
--bloom-mint:     #BEEBD8;
--bloom-peach:    #FBD9B5;
--bloom-blush:    #F3C7DC;
```

### Benefit-kind colour is semantic, not decorative

The hard constraint — *benefit kinds must never look like they can be added
together* — drives the palette rather than being retrofitted onto it. Each kind
gets its own **grammar**, not merely its own hue, so the eye cannot sum them:

| Kind | Face | Weight | Colour | Extra signal |
|---|---|---|---|---|
| Cash received | display | 600, largest on screen | `--ink` | the only kind set in display type |
| Loan available | text, tabular figures | 500 | `--muted`, 1px outlined pill | ↩ glyph + "to repay" |
| Subsidy | text, tabular | 500 | mint-tinted well | leads with "up to" |
| Insurance cover | text, tabular | 500 | sky-tinted well | always prefixed "if" |
| Not published | text | 400 | `--muted` | **never renders a numeral** |

**Rules.** Kinds never share a row. No `+`, `=`, or `total` may appear between
them. Only cash is ever set in the display face. A loan figure is visually
incapable of reading as part of a cash total because it differs in face, weight,
colour, alignment and container simultaneously.

---

## 3. Typography

```
Display (Latin):  Bricolage Grotesque   — variable, opsz axis
Display (Tamil):  Noto Sans Tamil 600   — sized 0.92×, line-height 1.45
Text + all Indic: Noto Sans / Noto Sans Tamil / Devanagari / Telugu /
                  Bengali / Kannada / Malayalam / Gujarati / Gurmukhi / Oriya
Figures:          tabular-nums everywhere a number can be compared
```

**Why not Inter.** Inter is the default answer and reads as generic AI output.
Bricolage Grotesque is variable, has genuine character at display size, and its
optical-size axis lets the reveal figure go very large without turning flabby.

**Why Noto for everything else.** This is a hard requirement, not a preference:
Noto is the only family with complete, mutually harmonised coverage of every
Indian script. A regional-language build must not fall back to a different
metric per script.

### The multi-script rule

Bricolage has no Tamil. A Tamil reader would therefore never see the display
face, so **the identity must not live in the Latin typeface.** It lives in three
script-independent treatments instead:

1. the **size jump** between display and text (≥ 2.4×),
2. tight display tracking (−0.03em Latin, −0.01em Tamil — Tamil breaks if
   tracked as hard as Latin),
3. the **figure** — tabular, huge, ink. Numerals are the same in both scripts,
   so the emotional peak of the product renders identically in every language.

### Script handling

- **Never uppercase Tamil or any Indic script.** They have no case; forcing it
  produces nonsense. Uppercase is Latin-only, and only for 11px meta labels.
- Tamil line-height is 1.5 minimum (1.15 is fine for Latin display).
- Long scheme names **never** use the display face. Text face, `text-wrap:
  balance`, max 3 lines, ellipsis on word boundaries only.
- Reserve 1.35× vertical space for any string that can arrive in Tamil.

### Scale

| Role | Size | Tracking | Line-height |
|---|---|---|---|
| Reveal figure | 72–104px | −0.04em | 1.0 |
| Display / question | 34–56px | −0.03em | 1.12 |
| Scheme name | 19px | −0.01em | 1.35 |
| Body | 16px | 0 | 1.6 |
| Meta / label | 11px, uppercase (Latin only) | 0.09em | 1.2 |

---

## 4. The signature element — **the Thread**

*The one thing this product is remembered by.*

Every answer a citizen gives becomes a **chip**. Those chips do not disappear
when the question does — they accumulate into a visible thread that follows the
citizen through the entire app.

- **In onboarding**, the thread grows beneath the question. Progress is the
  thread getting longer, not a bar filling up.
- **In processing**, the chips collapse inward and *become* the sphere. The
  sphere is literally made of what the citizen told us.
- **On every scheme card**, the exact chips that caused the match are echoed
  back. `farmer · SC · 1.75 acres` sits on the card that matched on them.

**Why this and not a spinner or a mascot.** It answers the hardest constraint in
the brief — *whatever a citizen sees, they should be able to tell why it matched
them* — as a **visual property rather than a disclosure link**. It works at low
literacy because each chip carries the exact word the citizen just tapped, so
they recognise their own answer rather than parsing an eligibility table. And it
makes the reveal feel earned: the number came out of *their* chips, in front of
them.

---

## 5. Layout

- **One surface.** A single rounded container (radius 28px) floating on the
  tinted canvas, bloom behind and bleeding through. Max width 1120px.
- **Left-aligned editorial column.** Not centred. Centred type at 40px+ is hard
  to read and reads as a splash screen; left alignment reads as someone
  addressing you.
- **The rail.** Desktop: the Thread lives in a right-hand rail. Mobile: it
  collapses to a horizontal chip strip pinned under the question.
- Spacing scale: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96.
- Tap targets ≥ 52px. Option rows are full-width and generously padded — a
  shared phone with a cracked screen is the design target.

---

## 6. Depth & elevation

Three levels only. Shadows are large, soft and near-colourless; no dark drop
shadows, nothing that reads as "material".

```css
--e1: 0 1px 2px rgba(20,19,26,.04);
--e2: 0 8px 24px -12px rgba(20,19,26,.10);
--e3: 0 24px 64px -24px rgba(20,19,26,.16);
```

**Performance rule:** blooms are painted as pre-baked CSS `radial-gradient`
layers, **not** `filter: blur()` on a large element. A 120px blur on a
full-viewport div drops a budget Android below 30fps. Real blur is permitted
only on elements under 96px.

---

## 7. Do's and don'ts

**Do**
- Show the match reason on the artefact itself.
- Keep one question per screen, and let it be large.
- Use real counts from the corpus (4,643 schemes · 36 states · 668 central).
- Let the citizen skip any sensitive question without penalty.

**Don't**
- Never sum benefit kinds, or place them in one row.
- Never invent a statistic for the landing page.
- Never render a citizen's caste, disability or marital status in large type —
  this is often a shared screen, and someone may be reading over their shoulder.
- Never uppercase Indic script.
- Never use `filter: blur()` above 96px.
- Never use Inter.

---

## 8. Responsive behaviour

| Breakpoint | Behaviour |
|---|---|
| < 640 | single column, rail → chip strip, question 34px, surface fills viewport with 12px inset |
| 640–1024 | single column, wider gutters, question 44px |
| > 1024 | editorial column + right rail, question 56px, surface max 1120px |

Motion: transitions **240–320ms**, `cubic-bezier(.22,1,.36,1)`. "Unhurried"
means *composed*, not slow — a citizen on a metered connection should never wait
on an animation. All motion respects `prefers-reduced-motion`.

---

## 9. Agent prompt guide

When generating a new screen:

> Light canvas `--canvas`, one white surface radius 28, one soft bloom behind at
> 6–10% on content screens. Left-aligned. Display face for the one idea on the
> screen; Noto for everything else and all Indic text. Any benefit kind gets its
> own row and its own grammar — never summed. Any matched scheme shows its
> Thread chips. Uppercase is Latin-only at 11px. No Inter, no invented numbers,
> no blur over 96px.
