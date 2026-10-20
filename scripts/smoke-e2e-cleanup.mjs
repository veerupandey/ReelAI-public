/**
 * End-to-end smoke for safe-cleanup branch.
 * Requires: npm run dev:agent (Vite :3000 + shell :3721)
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';
const SHELL = process.env.SMOKE_SHELL_URL || 'http://127.0.0.1:3721';
const OUT = process.env.SMOKE_OUT || '/opt/cursor/artifacts/e2e-cleanup';
const results = [];

fs.mkdirSync(OUT, { recursive: true });

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function openLanding(page) {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForSelector('text=ReelAI Studio', { timeout: 30_000 });
}

async function backToLanding(page) {
  // Prefer header brand click (handleStartOver)
  const brand = page.locator('header h1', { hasText: 'ReelAI Studio' });
  if (await brand.count()) {
    await brand.click();
    await page.waitForTimeout(400);
  }
  // If still not on landing, reload
  const landing = page.getByRole('button', { name: /Text to Reel/i });
  if (!(await landing.isVisible().catch(() => false))) {
    await openLanding(page);
  }
}

async function main() {
  // Shell health + TTS route presence
  try {
    const health = await fetch(`${SHELL}/health`).then((r) => r.json());
    record('shell /health', Boolean(health?.ok), JSON.stringify(health));
  } catch (e) {
    record('shell /health', false, e.message);
  }

  try {
    const tts = await fetch(`${SHELL}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello', voiceId: 'en-US-Neural2-A' }),
    });
    const body = await tts.json().catch(() => ({}));
    // Without GOOGLE_TTS_SERVICE_ACCOUNT_JSON we expect a controlled 500, not 404.
    const ok = tts.status !== 404 && (tts.status === 500 || tts.status === 200);
    record(
      'shell POST /tts route',
      ok,
      `status=${tts.status} body=${JSON.stringify(body).slice(0, 160)}`,
    );
  } catch (e) {
    record('shell POST /tts route', false, e.message);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(25_000);

  try {
    await openLanding(page);
    await shot(page, '01-landing');

    const bodyText = await page.locator('body').innerText();
    record('landing loads without auth wall', !/Authenticating|Sign in|Welcome back/i.test(bodyText));
    record('landing shows brand', /ReelAI Studio/i.test(bodyText));
    record('Campaign Manager removed', !/Campaign Manager/i.test(bodyText));

    const keepCtas = [
      ['Upload Media', /Upload Media/i],
      ['Text to Reel', /Text to Reel/i],
      ['Song to Video', /Song to Video/i],
      ['Brand Ad Agency', /Brand Ad Agency/i],
      ['Agent Hub', /Agent Hub/i],
      ['Image Studio', /Image Studio/i],
    ];
    for (const [label, re] of keepCtas) {
      const btn = page.getByRole('button', { name: re }).first();
      record(`landing CTA: ${label}`, await btn.isVisible());
    }

    // Image Studio
    await page.getByRole('button', { name: /Image Studio/i }).first().click();
    await page.waitForTimeout(800);
    await shot(page, '02-image-studio');
    const imgOk =
      (await page.getByText(/Image Studio/i).first().isVisible().catch(() => false)) ||
      (await page.getByRole('button', { name: /← Back/i }).isVisible().catch(() => false));
    record('Image Studio opens', imgOk, await page.locator('body').innerText().then((t) => t.slice(0, 120)));
    await backToLanding(page);

    // Song to Video
    await page.getByRole('button', { name: /Song to Video/i }).first().click();
    await page.waitForTimeout(800);
    await shot(page, '03-song-to-video');
    const songText = await page.locator('body').innerText();
    record(
      'Song to Video opens',
      /song|upload|audio|track|music/i.test(songText),
      songText.slice(0, 160).replace(/\s+/g, ' '),
    );
    await backToLanding(page);

    // Text to Reel
    await page.getByRole('button', { name: /Text to Reel/i }).first().click();
    await page.waitForTimeout(800);
    await shot(page, '04-text-to-reel');
    const ttrText = await page.locator('body').innerText();
    record(
      'Text to Reel reaches topic input',
      /topic|prompt|idea|viral|generate|describe/i.test(ttrText),
      ttrText.slice(0, 160).replace(/\s+/g, ' '),
    );
    await backToLanding(page);

    // Upload Media
    await page.getByRole('button', { name: /Upload Media/i }).first().click();
    await page.waitForTimeout(800);
    await shot(page, '05-upload-media');
    const upText = await page.locator('body').innerText();
    record(
      'Upload Media reaches upload step',
      /upload|drop|drag|media|file|photo|video|clip/i.test(upText),
      upText.slice(0, 160).replace(/\s+/g, ' '),
    );
    await backToLanding(page);

    // Brand Ad Agency
    await page.getByRole('button', { name: /Brand Ad Agency/i }).first().click();
    await page.waitForTimeout(1000);
    await shot(page, '06-brand-ad-agency');
    const brandText = await page.locator('body').innerText();
    record(
      'Brand Ad Agency opens',
      /brand|product|agency|import|create/i.test(brandText),
      brandText.slice(0, 160).replace(/\s+/g, ' '),
    );
    await backToLanding(page);

    // Agent Hub
    await page.getByRole('button', { name: /Agent Hub/i }).first().click();
    await page.waitForTimeout(1000);
    await shot(page, '07-agent-hub');
    const agentText = await page.locator('body').innerText();
    record(
      'Agent Hub opens',
      /agent|ad creator|autonomous|launch|product/i.test(agentText),
      agentText.slice(0, 160).replace(/\s+/g, ' '),
    );

    // Console errors related to supabase / campaign manager
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const fatal = errors.filter((e) => /supabase|CampaignManager|campaign_handoff/i.test(e));
    record('no supabase/CM page errors on agent hub', fatal.length === 0, fatal.join(' | ') || `${errors.length} other pageerrors`);
  } catch (e) {
    record('unexpected runner error', false, e.stack || e.message);
    try {
      await shot(page, '99-failure');
    } catch {}
  } finally {
    await browser.close();
  }

  const summary = {
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log('\n=== SUMMARY ===');
  console.log(`passed=${summary.passed} failed=${summary.failed}`);
  console.log(`artifacts: ${OUT}`);
  if (summary.failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
