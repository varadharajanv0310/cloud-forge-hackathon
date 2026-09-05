// Title cards rendered in the product's own typefaces (Archivo, IBM Plex Mono)
// as transparent PNGs, then composited in ffmpeg. drawtext would have meant a
// second, unrelated typeface on top of a film about a typographic product.
//
// Used sparingly and only where the UI does not already say the thing — the
// interface is well written, and captioning what it already states is noise.
import { createRequire } from 'module';
import { mkdirSync } from 'fs';
import path from 'path';

const require = createRequire('file:///D:/CloudForge - SEVAI/server/package.json');
const { chromium } = require('playwright');

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname.slice(1)), 'titles');
mkdirSync(OUT, { recursive: true });

const INK = '#14141A';
const MUTED = '#55555F';

// id, html body, colour scheme ('dark' for the void shots, 'light' over UI)
const CARDS = [
  ['T01', `<div class="wrap left"><div class="d">4,707 government schemes.</div></div>`, 'dark'],
  ['T02', `<div class="wrap left"><div class="d">Written for people who will<br>never hear about them.</div></div>`, 'dark'],
  ['T10', `<div class="wrap centre"><div class="d2">They are not added together.</div><div class="sub">Sevai will never show you a single total.</div></div>`, 'light'],
  ['T11', `<div class="wrap left"><div class="plate"><div class="m">SAHAYAK MODE</div><div class="d2">Someone can help.<br>For one hour. On the record.</div></div></div>`, 'light'],
  ['T12', `<div class="wrap centre"><div class="brand">Sevai</div><div class="m2">TRACK 03 &middot; PS 14 &mdash; FINANCIAL INCLUSION</div></div>`, 'light'],
  ['T13', `<div class="wrap left"><div class="plate"><div class="m">THE WALKTHROUGH</div><div class="d2">One citizen.<br>A smallholder farmer.</div></div></div>`, 'light'],
  ['T19', `<div class="wrap left"><div class="plate"><div class="m">A REAL PUBLISHED FIGURE</div><div class="d2">Six thousand rupees<br>a year, as published.</div></div></div>`, 'light'],
  ['T22', `<div class="wrap left"><div class="plate"><div class="m">CROSS-SCHEME CHAINING</div><div class="d2">One application<br>unlocks the next.</div></div></div>`, 'light'],
  ['T24', `<div class="wrap centre"><div class="d2">It does not invent amounts.</div><div class="url">github.com/varadharajanv0310/cloud-forge-hackathon</div></div>`, 'light'],
];

const page_html = (body, scheme) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;width:1920px;height:1080px;background:transparent;}
  body{font-family:Archivo,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;
       color:${scheme === 'dark' ? '#FFFFFF' : INK};}
  /* The card carries its own ground. Without it the type lands on whatever the
     UI happens to have under it — the first pass put "Rs 6,000 a year" directly
     across the app's own "Rs 6K". A white wash reads as the page receding,
     which suits a light editorial interface better than a dark lower-third. */
  .wrap{width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;
        padding:0 110px;box-sizing:border-box;position:relative;}
  /* A left card is a contained plate in the app's own panel style, not a wash
     across the frame. The wash version buried the interface; a plate sits
     beside it, which is also how the product itself presents information. */
  .left{align-items:flex-start;text-align:left;justify-content:flex-end;padding-bottom:104px;}
  .left .plate{background:#fff;border:1px solid rgba(20,20,26,.14);border-radius:6px;
        padding:46px 52px;max-width:660px;
        box-shadow:0 40px 90px -40px rgba(20,20,26,.30);}
  /* Centred cards are the statement beats — there the page is meant to recede. */
  .centre{align-items:center;text-align:center;}
  .centre::before{content:'';position:absolute;inset:0;z-index:-1;background:rgba(251,251,253,.93);}
  .d{font-size:72px;line-height:1.04;font-weight:700;letter-spacing:-.038em;max-width:12ch;}
  .d2{font-size:46px;line-height:1.12;font-weight:700;letter-spacing:-.03em;max-width:14ch;}
  .brand{font-size:96px;font-weight:800;letter-spacing:-.045em;}
  .m,.m2{font-family:'IBM Plex Mono',monospace;text-transform:uppercase;letter-spacing:.16em;
       font-size:19px;color:${scheme === 'dark' ? 'rgba(255,255,255,.62)' : MUTED};margin-bottom:26px;}
  .m2{margin:22px 0 0;font-size:17px;}
  .sub{margin-top:20px;font-size:25px;font-weight:400;letter-spacing:-.01em;
       color:${scheme === 'dark' ? 'rgba(255,255,255,.7)' : MUTED};max-width:42ch;}
  .url{margin-top:30px;font-family:'IBM Plex Mono',monospace;font-size:20px;letter-spacing:.04em;
       color:${MUTED};}
</style></head><body>${body}</body></html>`;

const run = async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  for (const [id, body, scheme] of CARDS) {
    await page.setContent(page_html(body, scheme), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${id}.png`), omitBackground: true });
    console.log(`  ${id}`);
  }
  await browser.close();
};
run().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
