const { chromium } = require('playwright');
const assert = require('node:assert/strict');

// Run against a local preview, or pass a staging URL as the first argument.
const base = process.argv[2] || 'http://127.0.0.1:4173/';
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390, 320]) {
      for (const reducedMotion of ['no-preference', 'reduce']) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route(/googletagmanager|google-analytics/, route => route.abort());
        const url = new URL(base);
        url.searchParams.set('exp', 'one');
        await page.goto(url.href, { waitUntil: 'domcontentloaded' });
        await page.locator('[data-exp-pick="two"]').click();
        await page.waitForTimeout(800);
        assert.equal(await page.locator('.exp').getAttribute('data-exp'), 'two');
        const visible = await page.locator('.card.is-front').evaluate(el => {
          const r = el.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= innerHeight;
        });
        assert(visible, `Living Deck must stay in view: ${width}px, ${reducedMotion}`);
        assert.equal(new URL(page.url()).hash, '', 'switch must not navigate');
        await page.getByRole('button', { name: 'Next speaker', exact: true }).click();
        assert.equal(await page.locator('[data-exp-n]').innerText(), '02');
        await page.locator('[data-exp-pick="one"]').focus();
        await page.keyboard.press('Enter');
        await page.waitForTimeout(800);
        assert.equal(await page.locator('.exp').getAttribute('data-exp'), 'one');
        const deckVisible = await page.locator('[data-deck]').evaluate(el => {
          const r = el.getBoundingClientRect();
          return r.top >= 0 && r.top < innerHeight / 2;
        });
        assert(deckVisible, `Stack Reveal must return to its beginning: ${width}px, ${reducedMotion}`);
        assert.deepEqual(errors, [], 'no JavaScript errors');
        await page.close();
        console.log(`PASS ${width}px / ${reducedMotion}`);
      }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
