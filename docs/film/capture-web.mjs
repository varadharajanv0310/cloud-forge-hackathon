// Desktop/web capture for the video. Native 16:9 at 1920x1080 (deviceScaleFactor 2
// => 3840x2160 plates) so shots can punch in without softening.
// Writes to docs/video-frames/ and leaves the mobile README screenshots alone.
import { createRequire } from 'module';
import { mkdirSync } from 'fs';
import path from 'path';

const require = createRequire('file:///D:/CloudForge - SEVAI/server/package.json');
const { chromium } = require('playwright');

const OUT = 'D:/CloudForge - SEVAI/docs/video-frames';
const BASE = 'http://localhost:5173';
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

const settle = async (page, ms = 2400) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(ms);
};
const shot = async (page, name, { full = false, hold = false } = {}) => {
  if (hold) await page.waitForTimeout(2000); else await settle(page);
  await page.screenshot({ path: path.join(OUT, name), fullPage: full });
  log(`  ${name}`);
};
const jsClick = (page, label) =>
  page.evaluate((l) => {
    const b = [...document.querySelectorAll('button, a')]
      .find((x) => x.innerText.trim().toLowerCase().startsWith(l.toLowerCase()));
    if (b) { b.click(); return true; }
    return false;
  }, label);
const tap = async (page, label) => {
  const els = await page.$$('button, a');
  const txt = await Promise.all(els.map((b) => b.innerText().catch(() => '')));
  let i = txt.findIndex((t) => t.trim().toLowerCase().startsWith(label.toLowerCase()));
  if (i === -1) {
    i = txt.findIndex((t) => {
      const s = t.trim();
      return s && s !== '←' && !/^\d+\s*\/\s*\d+$/.test(s);
    });
    if (i !== -1) log(`    ! "${label}" absent — took "${txt[i].trim().split('\n')[0]}"`);
  }
  if (i === -1) throw new Error(`no option for "${label}"`);
  await els[i].click().catch(() => jsClick(page, txt[i].trim().split('\n')[0]));
  await page.waitForTimeout(750);
};

const ANSWERS = ['Tamil Nadu', '36', 'Man', 'SC', 'Priority', 'Farming',
  'No', 'I own it', '1', 'No', 'Our own pucca'];

const run = async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    locale: 'en-IN',
  });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('sevai_lang','en'); } catch {} });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);

  log('landing');
  await shot(page, '01-landing.png');
  await page.evaluate(() => window.scrollTo(0, 700));
  await shot(page, '02-landing-figures.png', { hold: true });
  await page.evaluate(() => window.scrollTo(0, 1500));
  await shot(page, '03-landing-howitworks.png', { hold: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);

  await tap(page, 'Find my schemes');
  log('onboarding');
  await shot(page, '04-onboarding-state.png');
  let n = 0;
  for (const a of ANSWERS) {
    if (!/\d+\s*\/\s*\d+/.test(await page.innerText('body'))) break;
    await tap(page, a);
    n += 1;
    if (n === 2) await shot(page, '05-onboarding-age.png');
    if (n === 5) await shot(page, '06-onboarding-work.png');
  }

  await page.waitForTimeout(5200);
  log('result');
  await shot(page, '07-result.png');
  await shot(page, '08-result-full.png', { full: true });
  await page.evaluate(() => window.scrollTo(0, 800));
  await shot(page, '09-result-money.png', { hold: true });

  await page.evaluate(() => window.scrollTo(0, 0));
  await tap(page, 'See all');
  await page.waitForTimeout(2200);
  log('feed');
  await shot(page, '10-feed.png');
  await page.evaluate(() => window.scrollTo(0, 1100));
  await shot(page, '11-feed-list.png', { hold: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
  // already English by default now
  await shot(page, '12-feed-en.png');

  log('scheme + apply');
  await page.goto(`${BASE}/scheme/pm-kisan`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  await shot(page, '13-scheme-detail.png');
  await shot(page, '14-scheme-detail-full.png', { full: true });

  await page.goto(`${BASE}/apply/pm-kisan`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  await shot(page, '15-apply.png');

  const submitted = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .find((x) => /submit|record|sent|சமர்ப்/i.test(x.innerText));
    if (b) { b.click(); return true; }
    return false;
  });
  if (submitted) {
    await page.waitForTimeout(3200);
    await shot(page, '16-success-chaining.png', { hold: true });
  } else log('  ! submit control not found');

  log('applications + sahayak + profile');
  await page.goto(`${BASE}/applications`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  await shot(page, '17-applications.png');
  await shot(page, '18-applications-full.png', { full: true });

  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  await shot(page, '19-profile.png');

  const els = await page.$$('button');
  for (const b of els) {
    const t = (await b.innerText().catch(() => '')).trim();
    if (/sahayak|helper/i.test(t)) { await b.click(); break; }
  }
  await page.waitForTimeout(1800);
  await page.fill('input[type=password]', '9999').catch(() => {});
  await shot(page, '20-sahayak-pin.png');
  await jsClick(page, 'Continue');
  await page.waitForTimeout(1600);
  const code = await page.$('input:not([type=password])');
  if (code) { await code.fill('200200'); await page.waitForTimeout(400); await jsClick(page, 'Continue'); }
  await page.waitForTimeout(2000);
  await shot(page, '21-sahayak-session.png');

  await browser.close();
  log('done');
};
run().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
