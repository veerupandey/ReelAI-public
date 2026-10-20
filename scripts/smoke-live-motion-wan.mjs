/**
 * Opt-in smoke: one Wan I2V Live Motion clip on a Kageha ceremonial still.
 *
 *   HARNESS_LIVE=1 npm run smoke:live-motion
 *
 * Requires agent shell with SILICONFLOW_API_KEY, or loads key from
 * ../reelai-agent-harness/.env.local for direct API (shell preferred).
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REELAI_ROOT = path.resolve(__dirname, '..');
const HARNESS_ROOT = path.resolve(REELAI_ROOT, '../reelai-agent-harness');

if (process.env.HARNESS_LIVE !== '1' && process.env.HARNESS_LIVE !== 'true') {
  throw new Error('Set HARNESS_LIVE=1 to run Live Motion smoke');
}

async function loadEnvFile(filePath) {
  try {
    const text = await readFile(filePath, 'utf8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* optional */ }
}

await loadEnvFile(path.join(HARNESS_ROOT, '.env.local'));
await loadEnvFile(path.join(REELAI_ROOT, '.env.local'));

const shellUrl = process.env.HARNESS_SHELL_URL || 'http://127.0.0.1:3721';
const hero = process.env.HARNESS_HERO_PATH
  || path.join(REELAI_ROOT, 'generated/kageha-matcha-vs-coffee-2026-06-19T15-02-45-296Z/product-reference.jpg');

const health = await fetch(`${shellUrl}/harness/health`, { signal: AbortSignal.timeout(2500) }).catch(() => null);
const healthBody = health?.ok ? await health.json() : null;

let baseUrl;
let authHeaders = {};
if (healthBody?.siliconflowConfigured) {
  baseUrl = `${shellUrl}/harness/v1`;
  console.log(JSON.stringify({ phase: 'proxy', shellUrl, siliconflowConfigured: true }));
} else {
  const key = (process.env.SILICONFLOW_API_KEY || '').trim();
  if (!key) throw new Error('Shell SiliconFlow not configured and SILICONFLOW_API_KEY missing');
  baseUrl = (process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.com/v1').replace(/\/$/, '');
  authHeaders = { Authorization: `Bearer ${key}` };
  console.log(JSON.stringify({ phase: 'direct_api', note: 'shell proxy unavailable; using env key' }));
}

const sessionDir = path.join(REELAI_ROOT, 'tmp', 'wan-i2v', `smoke-live-motion-${Date.now()}`);
await mkdir(path.join(sessionDir, 'artifacts'), { recursive: true });
const square = path.join(sessionDir, 'artifacts', 'source-960.jpg');
execFileSync('ffmpeg', [
  '-y', '-i', hero,
  '-vf', 'scale=960:960:force_original_aspect_ratio=increase,crop=960:960',
  '-q:v', '2', square,
], { stdio: 'ignore' });
const imageBase64 = (await readFile(square)).toString('base64');

async function sf(pathname, body) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${pathname} ${res.status}: ${json.error || json.message || 'failed'}`);
  return json;
}

const prompt = `Animate this Kageha Signature Ceremonial matcha product still.
Keep exact tin identity. Slow steam, soft light, subtle push-in. No people, no new brands.`;

const submit = await sf('/video/submit', {
  model: 'Wan-AI/Wan2.2-I2V-A14B',
  prompt,
  image_size: '960x960',
  // SiliconFlow expects data-URL base64 (or a public image URL), not raw base64.
  image: `data:image/jpeg;base64,${imageBase64}`,
});
console.log(JSON.stringify({ phase: 'submitted', requestId: submit.requestId }));

const started = Date.now();
let videoUrl;
while (Date.now() - started < 12 * 60 * 1000) {
  const status = await sf('/video/status', { requestId: submit.requestId });
  console.log(JSON.stringify({ phase: 'poll', status: status.status, elapsedMs: Date.now() - started }));
  if (status.status === 'Succeed') {
    videoUrl = status.results?.videos?.[0]?.url;
    break;
  }
  if (status.status === 'Failed' || status.status === 'failed') {
    throw new Error(`Wan failed: ${status.reason || 'unknown'}`);
  }
  await new Promise((r) => setTimeout(r, 5000));
}
if (!videoUrl) throw new Error('timeout');

const rawPath = path.join(sessionDir, 'artifacts', 'raw.mp4');
const buf = Buffer.from(await (await fetch(videoUrl)).arrayBuffer());
await writeFile(rawPath, buf);
const dur = Number(execFileSync('ffprobe', [
  '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', rawPath,
], { encoding: 'utf8' }).trim());

const fitPath = path.join(sessionDir, 'artifacts', 'fit-4s.mp4');
execFileSync('ffmpeg', [
  '-y', '-i', rawPath, '-t', '4.000',
  '-vf', 'fps=16,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-an', fitPath,
], { stdio: 'ignore' });

const report = {
  sessionDir,
  hero,
  requestId: submit.requestId,
  rawPath,
  fitPath,
  sourceDurationSec: dur,
  targetDurationSec: 4,
  estimatedCostUsd: 0.29,
};
await writeFile(path.join(sessionDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ phase: 'done', ...report }, null, 2));
