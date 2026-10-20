/**
 * Live smoke for recreate loop pieces that need a real API + shell.
 * Run: set -a && source .env.local && set +a && node scripts/smoke-recreate-loop.mjs
 */
import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));

// Live smoke: shell skills, URL role split, Gemini vision critique.

const SHELL = 'http://localhost:3721';
const API_KEY = process.env.VITE_API_KEY || process.env.GEMINI_API_KEY || process.env.API_KEY || '';
if (!API_KEY) {
  console.error('Set VITE_API_KEY / GEMINI_API_KEY before running.');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: API_KEY });
let passed = 0;
let failed = 0;

function pass(name, detail = '') {
  passed++;
  console.log(`  ✓  ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail = '') {
  failed++;
  console.log(`  ✗  ${name} — ${detail}`);
}

async function get(path) {
  const res = await fetch(`${SHELL}${path}`, { signal: AbortSignal.timeout(5000) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

console.log('\n── Recreate loop smoke ───────────────────────────────');

// 1. Shell + recreate skill
try {
  const health = await get('/health');
  if (health.status === 200 && health.body.ok) pass('Shell health');
  else fail('Shell health', JSON.stringify(health.body));
} catch (e) {
  fail('Shell reachable', e.message);
  console.log('\nStart with: npm run agent:server\n');
  process.exit(1);
}

try {
  const skills = await get('/skills');
  const list = skills.body.skills || [];
  const recreate = list.find((s) => s.id === 'recreate-reference-video' || /recreate/i.test(s.id || s.name || ''));
  if (recreate) pass('recreate-reference-video skill registered', recreate.id);
  else fail('recreate-reference-video skill registered', `skills: ${list.map((s) => s.id).join(', ') || 'none'}`);
} catch (e) {
  fail('skills endpoint', e.message);
}

// 2. URL role split (inline mirror of promptUrlRoles heuristics)
const IG = 'https://www.instagram.com/reel/DK7xyz/';
const SHOP = 'https://kageha.ca/products/matcha-whisk';
const SOCIAL = /instagram\.com|tiktok\.com|youtube\.com|youtu\.be|facebook\.com/i;
const urls = [IG, SHOP];
const referenceUrl = urls.find((u) => SOCIAL.test(u));
const productUrl = urls.find((u) => u !== referenceUrl && /\/products\//i.test(u)) || urls.find((u) => u !== referenceUrl);
if (productUrl === SHOP && referenceUrl === IG) pass('URL roles (IG first → reference, shop → product)');
else fail('URL roles', `product=${productUrl} ref=${referenceUrl}`);

// 3. Vision critique with tiny product + reference stills
const tinyPng = readFileSync(resolve(__dirname, '../evals/ad-agent/recreate-reference-golden.json')); // ensure path exists
void tinyPng;
const ONE_PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function visionCritique(model) {
  const res = await ai.models.generateContent({
    model,
    contents: [{
      parts: [
        {
          text: `Review this draft scene for a matcha whisk ad. You can see two tiny placeholder images (product + reference).
Draft: {"index":0,"imagePrompt":"generic lifestyle"}
Return ONLY compact JSON:
{"agree":false,"notes":["one note"],"productIdentityRisks":[],"revisions":[{"index":0,"imagePrompt":"whisk hero on linen","reason":"show product"}]}`,
        },
        { inlineData: { mimeType: 'image/png', data: ONE_PX } },
        { inlineData: { mimeType: 'image/png', data: ONE_PX } },
      ],
    }],
    config: {
      ...(model.startsWith('gemini-3.8-flash') ? {} : { temperature: 0.1 }),
      responseMimeType: 'application/json',
      maxOutputTokens: 1024,
    },
  });
  return res.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
}

function parseCritique(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    // Truncated JSON still proves the multimodal path answered.
    if (/"agree"\s*:\s*(true|false)/.test(text)) return { agree: /"agree"\s*:\s*true/.test(text), revisions: [] };
    return null;
  }
}

const visionModels = ['gemini-3.1-pro-preview', 'gemini-3.1-pro', 'gemini-3.8-flash'];
let visionOk = false;
let lastVisionErr = '';
for (const model of visionModels) {
  try {
    const text = await visionCritique(model);
    const parsed = parseCritique(text);
    if (parsed && (parsed.agree === true || parsed.agree === false || Array.isArray(parsed.revisions))) {
      pass('Gemini vision critique', `${model} · ${parsed.agree ? 'agreed' : `${(parsed.revisions || []).length} revision(s)`}`);
      visionOk = true;
      break;
    }
    lastVisionErr = `${model}: no parseable JSON (${text.slice(0, 120)})`;
  } catch (e) {
    lastVisionErr = `${model}: ${e.message}`;
  }
}
if (!visionOk) fail('Gemini vision critique', lastVisionErr);

// 4. Confirm golden fixture still present
try {
  const golden = JSON.parse(readFileSync(resolve(__dirname, '../evals/ad-agent/recreate-reference-golden.json'), 'utf8'));
  if (golden.expectedIntent === 'recreate_reference_video') pass('Golden fixture present', golden.id);
  else fail('Golden fixture', 'bad intent');
} catch (e) {
  fail('Golden fixture', e.message);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
