/**
 * ReelAI Agent Shell Server
 * Runs alongside `npm run dev`. Gives the autonomous agent access to:
 *   - Shell command execution (ffmpeg, bash, etc.)
 *   - Python script execution
 *   - File upload/serve (base64 → disk → HTTP URL)
 *
 * Usage: node scripts/agent-shell-server.cjs
 * Port:  3721
 */

'use strict';

const http = require('http');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ── MCP SDK (CJS) ─────────────────────────────────────────────────────────────
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const PORT = 3721;
// Persistent, always-writable home dir: ~/reelai-sessions/{brand}/{product}/{flow}/{sessionId}
const BASE_DIR = path.join(os.homedir(), 'reelai-sessions');
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024; // 2MB stdout cap

/** Load repo .env / .env.local into process.env (does not override existing vars). */
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"'))
      || (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadEnvFile(path.join(__dirname, '..', '.env'));
loadEnvFile(path.join(__dirname, '..', '.env.local'));

if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR, { recursive: true });

const slugify = (s) => (s || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'unknown';

// ── Helpers ──────────────────────────────────────────────────────────────────

const SF_BASE = (process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.com/v1').replace(/\/$/, '');
const ZAI_BASE = (process.env.ZAI_BASE_URL || 'https://api.z.ai/api/coding/paas/v4').replace(/\/$/, '');
const OPENAI_BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const FAL_KEY = process.env.FAL_KEY || process.env.FAL_API_KEY || '';
const FAL_QUEUE_BASE = 'https://queue.fal.run';
const FAL_STORAGE_INITIATE = 'https://rest.alpha.fal.ai/storage/upload/initiate';
const HARNESS_MAX_JSON_BYTES = Number(process.env.HARNESS_MAX_JSON_BYTES || 2 * 1024 * 1024);
const HARNESS_PROVIDER_TIMEOUT_MS = Number(process.env.HARNESS_PROVIDER_TIMEOUT_MS || 120_000);
/** Allowlisted SiliconFlow proxy routes under /harness/v1/* */
const HARNESS_PROXY_ROUTES = new Set([
  'GET /models',
  'POST /chat/completions',
  'POST /video/submit',
  'POST /video/status',
  'POST /images/generations',
]);
/** Allowlisted fal model ids for Video Studio I2V */
const FAL_ALLOWLISTED_MODELS = new Set([
  'fal-ai/veo3.1/image-to-video',
  'fal-ai/veo3.1/fast/image-to-video',
  'fal-ai/veo3.1/lite/image-to-video',
  'fal-ai/kling-video/v2.6/pro/image-to-video',
  'fal-ai/kling-video/v3/pro/image-to-video',
  'bytedance/seedance-2.0/image-to-video',
  'bytedance/seedance-2.0/fast/image-to-video',
  'bytedance/seedance-2.0/mini/image-to-video',
  'alibaba/happy-horse/image-to-video',
  'fal-ai/wan/v2.7/image-to-video',
  'xai/grok-imagine-video/image-to-video',
  'xai/grok-imagine-video/v1.5/image-to-video',
]);

const getFalKey = () => FAL_KEY || process.env.FAL_KEY || process.env.FAL_API_KEY || '';

const assertFalModel = (model) => {
  const id = String(model || '').trim();
  if (!id || !FAL_ALLOWLISTED_MODELS.has(id)) {
    const err = new Error(`fal model not allowlisted: ${id || '(empty)'}`);
    err.status = 400;
    throw err;
  }
  return id;
};

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-ReelAI-Harness-Token');
};

const json = (res, status, body) => {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
    catch (e) { reject(new Error('Invalid JSON body')); }
  });
  req.on('error', reject);
});

const readRawBodyLimited = (req, maxBytes) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  let settled = false;
  const fail = (error) => {
    if (settled) return;
    settled = true;
    req.removeAllListeners('data');
    req.on('data', () => {});
    req.resume();
    reject(error);
  };
  req.on('data', (chunk) => {
    if (settled) return;
    size += chunk.length;
    if (size > maxBytes) {
      fail(Object.assign(new Error(`Request body exceeds ${maxBytes} bytes`), { status: 413 }));
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (!settled) {
      settled = true;
      resolve(Buffer.concat(chunks));
    }
  });
  req.on('error', (error) => {
    if (!settled) fail(error);
  });
});

const fetchWithTimeout = async (url, init = {}, timeoutMs = HARNESS_PROVIDER_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const mimeFromExt = (filename) => {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.mp4': 'video/mp4', '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.aac': 'audio/aac',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.txt': 'text/plain', '.json': 'application/json',
  };
  return map[ext] || 'application/octet-stream';
};

// Detect artifact files written into a dir during command execution
const snapshotDir = (dir) => new Set(fs.readdirSync(dir));

const diffArtifacts = (before, after, dir) =>
  [...after].filter((f) => !before.has(f)).map((f) => {
    const relPath = path.relative(BASE_DIR, path.join(dir, f)).split(path.sep).map(encodeURIComponent).join('/');
    return { filename: f, url: `http://localhost:${PORT}/files/${relPath}`, mimeType: mimeFromExt(f) };
  });

// ── Route handlers ────────────────────────────────────────────────────────────

// POST /session  { brand: string, product: string }  → create organized session dir
const handleSession = async (req, res) => {
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }

  const brandSlug   = slugify(body.brand   || 'brand');
  const productSlug = slugify(body.product || 'product');
  const flowSlug    = slugify(body.flow    || 'agent');   // e.g. ad-agent, agent-creator
  const sessionId   = Date.now().toString(36);

  // ~/reelai-sessions/{brand}/{product}/{flow}/{sessionId}/
  const sessionDir = path.join(BASE_DIR, brandSlug, productSlug, flowSlug, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const urlBase = [brandSlug, productSlug, flowSlug, sessionId].map(encodeURIComponent).join('/');
  json(res, 200, {
    sessionDir,
    sessionId,
    brandSlug,
    productSlug,
    flowSlug,
    baseUrl: `http://localhost:${PORT}/files/${urlBase}`,
  });
};

// POST /exec  { command: string, sessionDir?: string, env?: Record<string,string> }
const handleExec = async (req, res) => {
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }

  const { command, sessionDir, env = {} } = body;
  if (!command || typeof command !== 'string') return json(res, 400, { error: 'command required' });

  const cwd = sessionDir && fs.existsSync(sessionDir) ? sessionDir : BASE_DIR;
  const before = snapshotDir(cwd);

  exec(command, {
    cwd,
    env: { ...process.env, ...env },
    maxBuffer: MAX_OUTPUT_BYTES,
  }, (err, stdout, stderr) => {
    const after = snapshotDir(cwd);
    const artifacts = diffArtifacts(before, after, cwd);
    json(res, 200, {
      stdout: stdout || '',
      stderr: stderr || '',
      exitCode: err ? (err.code || 1) : 0,
      artifacts,
      workDir: cwd,
    });
  });
};

// POST /python  { code: string, filename?: string, sessionDir?: string }
const handlePython = async (req, res) => {
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }

  const { code, filename, sessionDir } = body;
  if (!code) return json(res, 400, { error: 'code required' });

  const cwd = sessionDir && fs.existsSync(sessionDir) ? sessionDir : BASE_DIR;
  const scriptName = filename || `script_${Date.now()}.py`;
  const scriptPath = path.join(cwd, scriptName);
  fs.writeFileSync(scriptPath, code, 'utf8');

  const before = snapshotDir(cwd);

  exec(`python3 "${scriptPath}"`, {
    cwd,
    env: process.env,
    maxBuffer: MAX_OUTPUT_BYTES,
  }, (err, stdout, stderr) => {
    const after = snapshotDir(cwd);
    const artifacts = diffArtifacts(before, after, cwd);
    try { fs.unlinkSync(scriptPath); } catch {}
    json(res, 200, {
      stdout: stdout || '',
      stderr: stderr || '',
      exitCode: err ? (err.code || 1) : 0,
      artifacts,
      workDir: cwd,
    });
  });
};

// POST /upload  { base64: string, filename: string, mimeType?: string, sessionDir?: string }
const handleUpload = async (req, res) => {
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }

  const { base64, filename, mimeType, sessionDir } = body;
  if (!base64 || !filename) return json(res, 400, { error: 'base64 and filename required' });

  const dir = sessionDir && fs.existsSync(sessionDir) ? sessionDir : BASE_DIR;
  const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(dir, safeName);

  // Build a URL path relative to BASE_DIR
  const relPath = path.relative(BASE_DIR, filePath).split(path.sep).map(encodeURIComponent).join('/');

  try {
    const buf = Buffer.from(base64, 'base64');
    fs.writeFileSync(filePath, buf);
    json(res, 200, {
      filename: safeName,
      path: filePath,
      url: `http://localhost:${PORT}/files/${relPath}`,
      mimeType: mimeType || mimeFromExt(safeName),
      size: buf.length,
    });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
};

// GET /files/*  — serves nested paths under BASE_DIR
const handleFile = (req, res, rawPath) => {
  cors(res);
  const segments = rawPath.split('/').map(decodeURIComponent);
  const filePath = path.join(BASE_DIR, ...segments);

  if (!filePath.startsWith(BASE_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) { res.writeHead(404); return res.end('Not found'); }

  const stat = fs.statSync(filePath);
  const mime = mimeFromExt(path.extname(filePath));
  const total = stat.size;

  const baseHeaders = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
  };

  // Support HTTP Range requests — required for browser <video> playback
  const rangeHeader = req.headers['range'];
  if (rangeHeader) {
    const [startStr, endStr] = rangeHeader.replace(/^bytes=/i, '').split('-');
    let start = Number.parseInt(startStr, 10);
    let end = endStr ? Number.parseInt(endStr, 10) : total - 1;

    if (!Number.isFinite(start) || start < 0) start = 0;
    if (!Number.isFinite(end) || end < 0) end = total - 1;
    // Empty / past-EOF ranges (common when video length changes mid-poll) → 416, never crash.
    if (total === 0 || start >= total || start > end) {
      res.writeHead(416, {
        ...baseHeaders,
        'Content-Range': `bytes */${total}`,
      });
      return res.end();
    }
    end = Math.min(end, total - 1);
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': chunkSize,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...baseHeaders, 'Content-Length': total });
    fs.createReadStream(filePath).pipe(res);
  }
};

// GET /health
const handleHealth = (res) => {
  json(res, 200, {
    ok: true,
    baseDir: BASE_DIR,
    port: PORT,
    siliconflowConfigured: Boolean(process.env.SILICONFLOW_API_KEY),
    falConfigured: Boolean(getFalKey()),
    zaiConfigured: Boolean(process.env.ZAI_API_KEY),
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    sfBase: SF_BASE,
  });
};

// GET /harness/health — provider readiness (never echoes keys)
const handleHarnessHealth = (res) => {
  json(res, 200, {
    ok: true,
    siliconflowConfigured: Boolean(process.env.SILICONFLOW_API_KEY),
    falConfigured: Boolean(getFalKey()),
    zaiConfigured: Boolean(process.env.ZAI_API_KEY),
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    sfBase: SF_BASE,
  });
};

/**
 * POST /llm/chat — OpenAI-compatible chat/completions proxy.
 * Body: {
 *   transport?: 'openai_compatible',
 *   baseUrl, model, messages, apiKey?,
 *   keyEnv?: 'zai'|'siliconflow'|'openai',  // env fallback when apiKey omitted
 *   tools?, webSearch?, temperature?, max_tokens?, thinking?, reasoning_effort?
 * }
 * Also accepts legacy { provider: 'zai'|'openai'|'siliconflow' } without baseUrl.
 * Never logs keys.
 *
 * GLM 5.3 Flash (z.ai) is a thinking model. Agent/planner calls may enable thinking
 * and receive reasoning_content separately. App/worker calls keep thinking
 * disabled by default so max_tokens goes to visible content.
 */
const handleLlmChat = async (req, res) => {
  try {
    const body = await readBody(req);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const model = String(body.model || '').trim();
    const apiKeyOverride = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const temperature = typeof body.temperature === 'number' ? body.temperature : 0.4;
    const maxTokens = typeof body.max_tokens === 'number'
      ? body.max_tokens
      : (typeof body.maxTokens === 'number' ? body.maxTokens : 4096);
    const tools = Array.isArray(body.tools) ? body.tools : undefined;
    const wantWebSearch = Boolean(body.webSearch);
    const thinkingOverride = body.thinking && typeof body.thinking === 'object'
      ? body.thinking
      : undefined;
    const reasoningEffort = typeof body.reasoning_effort === 'string'
      ? body.reasoning_effort.trim()
      : (typeof body.reasoningEffort === 'string' ? body.reasoningEffort.trim() : '');

    if (!model || !messages.length) {
      return json(res, 400, { error: 'model and messages are required' });
    }

    // Resolve OpenAI-compatible base URL (GLM / SiliconFlow / OpenAI / Codex / custom).
    let baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim().replace(/\/$/, '') : '';
    const legacyProvider = String(body.provider || '').trim();
    const keyEnv = String(body.keyEnv || '').trim()
      || (legacyProvider === 'zai' || legacyProvider === 'siliconflow' || legacyProvider === 'openai'
        ? legacyProvider
        : '');

    if (!baseUrl) {
      if (legacyProvider === 'zai' || keyEnv === 'zai') baseUrl = ZAI_BASE;
      else if (legacyProvider === 'siliconflow' || keyEnv === 'siliconflow') baseUrl = SF_BASE;
      else if (legacyProvider === 'openai' || keyEnv === 'openai') baseUrl = OPENAI_BASE;
    }

    if (!baseUrl) {
      return json(res, 400, {
        error: 'baseUrl is required for OpenAI-compatible chat (e.g. https://api.z.ai/api/coding/paas/v4)',
      });
    }

    const envName = keyEnv === 'zai'
      ? 'ZAI_API_KEY'
      : keyEnv === 'siliconflow'
        ? 'SILICONFLOW_API_KEY'
        : keyEnv === 'openai'
          ? 'OPENAI_API_KEY'
          : '';
    const key = apiKeyOverride
      || (envName ? process.env[envName] : '')
      || process.env.OPENAI_API_KEY
      || process.env.ZAI_API_KEY
      || process.env.SILICONFLOW_API_KEY
      || '';

    if (!key) {
      return json(res, 503, {
        error: 'API key not configured — paste a key in the UI or set ZAI_API_KEY / OPENAI_API_KEY / SILICONFLOW_API_KEY on the shell server',
      });
    }

    // GLM Web Search in Chat when requested and no explicit tools provided.
    const resolvedTools = tools || (wantWebSearch
      ? [{
          type: 'web_search',
          web_search: {
            enable: true,
            search_result: true,
            search_engine: 'search-prime',
          },
        }]
      : undefined);

    const isZaiBase = /api\.z\.ai/i.test(baseUrl) || keyEnv === 'zai' || legacyProvider === 'zai';
    let thinking = thinkingOverride;
    if (!thinking && isZaiBase) {
      // Default off for fast app text; callers enable for agent/planner reasoning.
      thinking = { type: 'disabled' };
    }
    const thinkingEnabled = Boolean(thinking && thinking.type === 'enabled');

    const upstreamPayload = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    };
    if (resolvedTools) upstreamPayload.tools = resolvedTools;
    if (thinking) upstreamPayload.thinking = thinking;
    if (isZaiBase && thinkingEnabled && reasoningEffort) {
      upstreamPayload.reasoning_effort = reasoningEffort;
    }

    const upstream = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(upstreamPayload),
    }, thinkingEnabled ? Math.max(HARNESS_PROVIDER_TIMEOUT_MS, 180_000) : HARNESS_PROVIDER_TIMEOUT_MS);
    const upstreamBody = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const errMsg = upstreamBody.error?.message
        || upstreamBody.message
        || upstreamBody.error
        || `openai-compatible chat failed (${upstream.status})`;
      return json(res, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, {
        error: typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg).slice(0, 400),
      });
    }
    const message = upstreamBody.choices?.[0]?.message || {};
    const content = message.content;
    let text = typeof content === 'string'
      ? content.trim()
      : Array.isArray(content)
        ? content.map((c) => (typeof c === 'string' ? c : c?.text || '')).join('').trim()
        : '';
    const reasoning = typeof message.reasoning_content === 'string'
      ? message.reasoning_content.trim()
      : '';
    // Only promote reasoning→content when thinking was off (budget accident).
    // With thinking on, empty content should fail so Gemini fallback can run.
    if (!text && !thinkingEnabled && reasoning) {
      text = reasoning;
    }
    if (!text) {
      const finish = upstreamBody.choices?.[0]?.finish_reason || 'unknown';
      return json(res, 502, {
        error: `openai-compatible endpoint returned empty content (finish_reason=${finish}${reasoning ? ', had_reasoning=1' : ''})`,
      });
    }
    return json(res, 200, {
      content: text,
      reasoning: reasoning || undefined,
      model: upstreamBody.model || model,
      provider: 'openai_compatible',
      baseUrl,
      id: upstreamBody.id,
    });
  } catch (e) {
    const status = e.name === 'AbortError' ? 504 : (e.status || 500);
    console.error('[llm-chat]', e.message);
    return json(res, status, { error: status === 500 ? 'LLM chat failed' : e.message });
  }
};

/** POST /harness/fal/upload — { base64, mimeType } → fal CDN url */
const handleFalUpload = async (req, res) => {
  try {
    const key = getFalKey();
    if (!key) return json(res, 503, { error: 'FAL_KEY not configured on shell server' });
    const body = await readBody(req);
    const raw = String(body.base64 || '').trim();
    if (!raw) return json(res, 400, { error: 'base64 is required' });
    const mimeType = String(body.mimeType || 'image/jpeg').trim() || 'image/jpeg';
    const cleaned = raw.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
    const buffer = Buffer.from(cleaned, 'base64');
    if (buffer.length < 64) return json(res, 400, { error: 'Image payload too small' });
    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
    const fileName = `studio-${Date.now()}.${ext}`;

    const initRes = await fetchWithTimeout(FAL_STORAGE_INITIATE, {
      method: 'POST',
      headers: {
        Authorization: `Key ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file_name: fileName, content_type: mimeType }),
    });
    const initBody = await initRes.json().catch(() => ({}));
    if (!initRes.ok) {
      return json(res, initRes.status, {
        error: initBody.detail || initBody.error || initBody.message || 'fal storage initiate failed',
      });
    }
    const uploadUrl = initBody.upload_url || initBody.uploadUrl;
    const fileUrl = initBody.file_url || initBody.fileUrl || initBody.url;
    if (!uploadUrl || !fileUrl) {
      return json(res, 502, { error: 'fal storage initiate returned no upload_url/file_url' });
    }

    const putRes = await fetchWithTimeout(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: buffer,
    }, Math.max(HARNESS_PROVIDER_TIMEOUT_MS, 180_000));
    if (!putRes.ok) {
      const text = await putRes.text().catch(() => '');
      return json(res, putRes.status, { error: text || 'fal storage PUT failed' });
    }
    return json(res, 200, { url: fileUrl });
  } catch (e) {
    const status = e.name === 'AbortError' ? 504 : (e.status || 500);
    console.error('[fal-upload]', e.message);
    return json(res, status, { error: status === 500 ? 'fal upload failed' : e.message });
  }
};

/** POST /harness/fal/queue/submit — { model, input } → { requestId } */
const handleFalQueueSubmit = async (req, res) => {
  try {
    const key = getFalKey();
    if (!key) return json(res, 503, { error: 'FAL_KEY not configured on shell server' });
    const body = await readBody(req);
    const model = assertFalModel(body.model);
    const input = body.input && typeof body.input === 'object' ? body.input : null;
    if (!input) return json(res, 400, { error: 'input object is required' });

    const falRes = await fetchWithTimeout(`${FAL_QUEUE_BASE}/${model}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
    const falBody = await falRes.json().catch(() => ({}));
    if (!falRes.ok) {
      return json(res, falRes.status, {
        error: falBody.detail || falBody.error || falBody.message || `fal submit failed (${falRes.status})`,
      });
    }
    const requestId = falBody.request_id || falBody.requestId;
    if (!requestId) return json(res, 502, { error: 'fal submit returned no request_id' });
    return json(res, 200, {
      requestId,
      statusUrl: falBody.status_url,
      responseUrl: falBody.response_url,
    });
  } catch (e) {
    const status = e.name === 'AbortError' ? 504 : (e.status || 500);
    console.error('[fal-submit]', e.message);
    return json(res, status, { error: status === 500 ? 'fal submit failed' : e.message });
  }
};

/** Only allow proxying GET to fal queue URLs returned by submit (status_url / response_url). */
const assertFalQueueUrl = (raw, kind) => {
  const value = String(raw || '').trim();
  if (!value) {
    const err = new Error(`${kind} URL is required`);
    err.status = 400;
    throw err;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    const err = new Error(`Invalid ${kind} URL`);
    err.status = 400;
    throw err;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'queue.fal.run') {
    const err = new Error(`${kind} URL must be https://queue.fal.run/...`);
    err.status = 400;
    throw err;
  }
  return parsed.toString();
};

/** GET /harness/fal/queue/status?statusUrl= (preferred) or model=&requestId= fallback */
const handleFalQueueStatus = async (req, res, url) => {
  try {
    const key = getFalKey();
    if (!key) return json(res, 503, { error: 'FAL_KEY not configured on shell server' });

    let target;
    const statusUrl = url.searchParams.get('statusUrl');
    if (statusUrl) {
      target = assertFalQueueUrl(statusUrl, 'status');
      const u = new URL(target);
      if (!u.searchParams.has('logs')) u.searchParams.set('logs', '1');
      target = u.toString();
    } else {
      // fal queue apps use a short path (e.g. fal-ai/kling-video), not the full model id.
      // Prefer statusUrl from submit — this fallback is best-effort.
      const model = assertFalModel(url.searchParams.get('model'));
      const requestId = String(url.searchParams.get('requestId') || '').trim();
      if (!requestId) return json(res, 400, { error: 'requestId or statusUrl is required' });
      const appPath = model.split('/').slice(0, 2).join('/');
      target = `${FAL_QUEUE_BASE}/${appPath}/requests/${encodeURIComponent(requestId)}/status?logs=1`;
    }

    const falRes = await fetchWithTimeout(target, {
      method: 'GET',
      headers: { Authorization: `Key ${key}` },
    });
    const falBody = await falRes.json().catch(() => ({}));
    if (!falRes.ok) {
      return json(res, falRes.status, {
        error: falBody.detail || falBody.error || falBody.message || `fal status failed (${falRes.status})`,
      });
    }
    return json(res, 200, {
      status: falBody.status,
      queuePosition: falBody.queue_position,
      logs: falBody.logs,
    });
  } catch (e) {
    const status = e.name === 'AbortError' ? 504 : (e.status || 500);
    console.error('[fal-status]', e.message);
    return json(res, status, { error: status === 500 ? 'fal status failed' : e.message });
  }
};

/** GET /harness/fal/queue/result?responseUrl= (preferred) or model=&requestId= → { videoUrl } */
const handleFalQueueResult = async (req, res, url) => {
  try {
    const key = getFalKey();
    if (!key) return json(res, 503, { error: 'FAL_KEY not configured on shell server' });

    let target;
    const responseUrl = url.searchParams.get('responseUrl');
    if (responseUrl) {
      target = assertFalQueueUrl(responseUrl, 'response');
    } else {
      const model = assertFalModel(url.searchParams.get('model'));
      const requestId = String(url.searchParams.get('requestId') || '').trim();
      if (!requestId) return json(res, 400, { error: 'requestId or responseUrl is required' });
      const appPath = model.split('/').slice(0, 2).join('/');
      target = `${FAL_QUEUE_BASE}/${appPath}/requests/${encodeURIComponent(requestId)}`;
    }

    const falRes = await fetchWithTimeout(target, {
      method: 'GET',
      headers: { Authorization: `Key ${key}` },
    });
    const falBody = await falRes.json().catch(() => ({}));
    if (!falRes.ok) {
      return json(res, falRes.status, {
        error: falBody.detail || falBody.error || falBody.message || `fal result failed (${falRes.status})`,
      });
    }
    const videoUrl =
      falBody?.video?.url ||
      falBody?.data?.video?.url ||
      falBody?.output?.video?.url ||
      (typeof falBody?.video === 'string' ? falBody.video : undefined);
    if (!videoUrl) {
      return json(res, 502, { error: 'fal result contained no video URL', detail: falBody });
    }
    return json(res, 200, { videoUrl, raw: falBody });
  } catch (e) {
    const status = e.name === 'AbortError' ? 504 : (e.status || 500);
    console.error('[fal-result]', e.message);
    return json(res, status, { error: status === 500 ? 'fal result failed' : e.message });
  }
};

/** Proxy OpenAI-compatible paths under /harness/v1/* → SiliconFlow /v1/* */
const handleHarnessProxy = async (req, res, restPath, search) => {
  try {
    if (!HARNESS_PROXY_ROUTES.has(`${req.method} ${restPath}`)) {
      return json(res, 404, { error: 'Harness provider route not allowlisted' });
    }
    const key = process.env.SILICONFLOW_API_KEY;
    if (!key) return json(res, 503, { error: 'SILICONFLOW_API_KEY not configured on shell server' });

    const rawBody = ['GET', 'HEAD'].includes(req.method)
      ? Buffer.alloc(0)
      : await readRawBodyLimited(req, HARNESS_MAX_JSON_BYTES);

    const headers = { Authorization: `Bearer ${key}` };
    const ct = req.headers['content-type'];
    if (ct) headers['Content-Type'] = ct;
    else if (rawBody.length && (req.method === 'POST' || req.method === 'PUT')) {
      headers['Content-Type'] = 'application/json';
    }

    const target = `${SF_BASE}${restPath}${search || ''}`;
    const sfRes = await fetchWithTimeout(target, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : rawBody,
    });
    const outBuf = Buffer.from(await sfRes.arrayBuffer());
    cors(res);
    res.writeHead(sfRes.status, {
      'Content-Type': sfRes.headers.get('content-type') || 'application/octet-stream',
    });
    res.end(outBuf);
  } catch (e) {
    const status = e.name === 'AbortError' ? 504 : (e.status || 500);
    console.error('[harness-proxy]', e.message);
    json(res, status, { error: status === 500 ? 'Harness proxy failed' : e.message });
  }
};

// GET /ls — list workspace files (flat, recursive)
const handleLs = (res) => {
  const walkDir = (dir, prefix = '') => {
    const results = [];
    fs.readdirSync(dir).forEach((f) => {
      const full = path.join(dir, f);
      const rel = prefix ? `${prefix}/${f}` : f;
      if (fs.statSync(full).isDirectory()) {
        results.push(...walkDir(full, rel));
      } else {
        const relPath = path.relative(BASE_DIR, full).split(path.sep).map(encodeURIComponent).join('/');
        results.push({ filename: rel, size: fs.statSync(full).size, url: `http://localhost:${PORT}/files/${relPath}` });
      }
    });
    return results;
  };
  json(res, 200, { files: walkDir(BASE_DIR), baseDir: BASE_DIR });
};

// DELETE /clean — wipe all sessions
const handleClean = (res) => {
  fs.readdirSync(BASE_DIR).forEach((f) => {
    const full = path.join(BASE_DIR, f);
    try { fs.rmSync(full, { recursive: true, force: true }); } catch {}
  });
  json(res, 200, { ok: true });
};

// ── Agent Memory ──────────────────────────────────────────────────────────────

const MEMORY_DIR = path.join(BASE_DIR, '_memory');
if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });

const GLOBAL_MEMORY_FILE = path.join(MEMORY_DIR, 'global-skills.jsonl');

const brandMemoryFile = (brandSlug) =>
  path.join(MEMORY_DIR, `brand-${slugify(brandSlug)}.jsonl`);

const readMemoryFile = (filePath) => {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n').filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
};

const appendMemory = (filePath, entry) => {
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
};

// POST /memory/write  { scope: 'global'|'brand', brandSlug?: string, entry: MemoryEntry }
const handleMemoryWrite = async (req, res) => {
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }

  const { scope, brandSlug, entry } = body;
  if (!entry || !entry.phase || !entry.what_went_wrong || !entry.better_approach) {
    return json(res, 400, { error: 'entry must have phase, what_went_wrong, better_approach' });
  }

  const record = { ...entry, ts: new Date().toISOString() };
  const filePath = scope === 'brand' && brandSlug ? brandMemoryFile(brandSlug) : GLOBAL_MEMORY_FILE;
  appendMemory(filePath, record);
  json(res, 200, { ok: true, scope, file: filePath });
};

// GET /memory/read?scope=global|brand&brand=<slug>&phase=<phase>
const handleMemoryRead = (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const scope = url.searchParams.get('scope') || 'global';
  const brandSlug = url.searchParams.get('brand') || '';
  const phase = url.searchParams.get('phase') || '';

  const globalEntries = readMemoryFile(GLOBAL_MEMORY_FILE);
  const brandEntries = brandSlug ? readMemoryFile(brandMemoryFile(brandSlug)) : [];
  let entries = [...globalEntries, ...brandEntries];
  if (phase) entries = entries.filter((e) => !e.phase || e.phase === phase || e.phase === 'all');

  // Return most recent 20 entries to avoid bloating prompts
  const recent = entries.slice(-20);
  json(res, 200, { entries: recent });
};

// GET /memory/list  → all memory files summary
const handleMemoryList = (req, res) => {
  const files = fs.existsSync(MEMORY_DIR) ? fs.readdirSync(MEMORY_DIR) : [];
  const summary = files.map((f) => {
    const entries = readMemoryFile(path.join(MEMORY_DIR, f));
    return { file: f, count: entries.length, latest: entries[entries.length - 1]?.ts || null };
  });
  json(res, 200, { summary });
};

// DELETE /memory/clear  { scope: 'global'|'brand', brandSlug?: string }
const handleMemoryClear = async (req, res) => {
  let body;
  try { body = await readBody(req); } catch { body = {}; }
  const filePath = body.scope === 'brand' && body.brandSlug
    ? brandMemoryFile(body.brandSlug)
    : GLOBAL_MEMORY_FILE;
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  json(res, 200, { ok: true });
};

// ── MCP Manager ───────────────────────────────────────────────────────────────

/** Live MCP client registry: serverName → { client, tools[], status, error } */
const mcpRegistry = new Map();

/** Load mcp.config.json from cwd */
const loadMcpConfig = () => {
  const cfgPath = path.join(process.cwd(), 'mcp.config.json');
  if (!fs.existsSync(cfgPath)) return { mcpServers: {} };
  try { return JSON.parse(fs.readFileSync(cfgPath, 'utf8')); }
  catch (e) { console.warn('  MCP: bad mcp.config.json:', e.message); return { mcpServers: {} }; }
};

/** Connect to one MCP server and cache its tool list */
const connectMcpServer = async (serverName, cfg) => {
  mcpRegistry.set(serverName, { tools: [], status: 'connecting', config: cfg });
  try {
    const client = new Client({ name: 'reelai-agent', version: '1.0.0' }, { capabilities: {} });

    let transport;
    if (cfg.url) {
      transport = new StreamableHTTPClientTransport(new URL(cfg.url));
    } else {
      const env = { ...process.env };
      if (cfg.env) {
        for (const [k, v] of Object.entries(cfg.env)) {
          // substitute ${VAR} references from process.env
          const resolved = typeof v === 'string' ? v.replace(/\$\{([^}]+)\}/g, (_, n) => process.env[n] || '') : v;
          if (resolved) env[k] = resolved;
        }
      }
      // Expand ${VAR} in args
      const expandedArgs = (cfg.args || []).map((a) =>
        a.replace(/\$\{([^}]+)\}/g, (_, n) => process.env[n] || a)
      );
      transport = new StdioClientTransport({ command: cfg.command, args: expandedArgs, env });
    }

    await client.connect(transport);
    const { tools } = await client.listTools();
    mcpRegistry.set(serverName, { client, tools, status: 'connected', config: cfg, connectedAt: new Date().toISOString() });
    console.log(`  MCP [${serverName}]: connected — ${tools.length} tool(s): ${tools.map(t => t.name).join(', ')}`);
  } catch (err) {
    mcpRegistry.set(serverName, { tools: [], status: 'error', config: cfg, error: err.message });
    console.warn(`  MCP [${serverName}]: ${err.message}`);
  }
};

/** Boot: connect all non-optional MCP servers defined in mcp.config.json */
const initMcp = async () => {
  const cfg = loadMcpConfig();
  const servers = cfg.mcpServers || {};
  if (Object.keys(servers).length === 0) return;
  console.log('\n  Connecting MCP servers...');
  for (const [name, serverCfg] of Object.entries(servers)) {
    // skip optional servers that have empty required env vars
    if (serverCfg.optional) {
      const missingEnv = Object.entries(serverCfg.env || {}).some(([, v]) => !v && !process.env[v]);
      if (missingEnv) { console.log(`  MCP [${name}]: skipped (optional, env not set)`); continue; }
    }
    await connectMcpServer(name, serverCfg);
  }
};

// GET /mcp/servers — list all configured MCP servers and their status
const handleMcpServers = (res) => {
  const servers = [...mcpRegistry.entries()].map(([name, info]) => ({
    name,
    status: info.status,
    toolCount: info.tools.length,
    tools: info.tools.map(t => ({ name: t.name, description: t.description })),
    error: info.error,
    connectedAt: info.connectedAt,
  }));
  json(res, 200, { servers });
};

// GET /mcp/tools — flat list of all tools from all connected servers
const handleMcpTools = (res) => {
  const tools = [];
  for (const [serverName, info] of mcpRegistry) {
    if (info.status !== 'connected') continue;
    for (const t of info.tools) {
      tools.push({ ...t, serverName });
    }
  }
  json(res, 200, { tools });
};

// POST /mcp/call  { serverName, toolName, args }
const handleMcpCall = async (req, res) => {
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
  const { serverName, toolName, args = {} } = body;

  const info = mcpRegistry.get(serverName);
  if (!info || info.status !== 'connected') {
    return json(res, 404, { error: `MCP server "${serverName}" not connected` });
  }
  const isBrowserClosed = (msg) =>
    typeof msg === 'string' && (
      msg.includes('browser has been closed') ||
      msg.includes('context or browser has been closed') ||
      msg.includes('Target page') ||
      msg.includes('Session closed')
    );

  const tryCall = async (client) => client.callTool({ name: toolName, arguments: args });

  const reconnectAndRetry = async () => {
    if (!info.config) return null;
    console.log(`  MCP [${serverName}]: browser closed — reconnecting...`);
    await connectMcpServer(serverName, info.config);
    const fresh = mcpRegistry.get(serverName);
    if (fresh && fresh.status === 'connected') {
      return tryCall(fresh.client);
    }
    return null;
  };

  try {
    let result = await tryCall(info.client);

    // Playwright returns isError=true with the closed-browser message inside content
    const resultText = result.content?.[0]?.text ?? '';
    if (result.isError && isBrowserClosed(resultText)) {
      console.log(`  MCP [${serverName}]: browser closed in result — reconnecting...`);
      const retried = await reconnectAndRetry().catch(() => null);
      if (retried) result = retried;
    }

    json(res, 200, { content: result.content, isError: result.isError || false });
  } catch (err) {
    // Playwright browser-closed thrown as exception
    if (isBrowserClosed(err.message)) {
      const retried = await reconnectAndRetry().catch(() => null);
      if (retried) return json(res, 200, { content: retried.content, isError: retried.isError || false });
    }
    json(res, 200, { error: err.message, isError: true, content: [{ type: 'text', text: `### Error\n${err.message}` }] });
  }
};

// POST /mcp/connect  { serverName, config }  — connect a new server at runtime
const handleMcpConnect = async (req, res) => {
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
  const { serverName, config } = body;
  if (!serverName || !config) return json(res, 400, { error: 'serverName and config required' });
  await connectMcpServer(serverName, config);
  const info = mcpRegistry.get(serverName);
  json(res, info.status === 'connected' ? 200 : 500, {
    ok: info.status === 'connected',
    toolCount: info.tools.length,
    error: info.error,
  });
};

// ── Skill Loader ──────────────────────────────────────────────────────────────

// GET /skills — list all skills from the project's skills/ directory
const handleSkills = (res) => {
  const skillsRoot = path.join(process.cwd(), 'skills');
  if (!fs.existsSync(skillsRoot)) return json(res, 200, { skills: [] });

  const skills = [];
  for (const dir of fs.readdirSync(skillsRoot)) {
    const skillDir = path.join(skillsRoot, dir);
    if (!fs.statSync(skillDir).isDirectory()) continue;

    const mdPath = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(mdPath)) continue;

    const raw = fs.readFileSync(mdPath, 'utf8');

    // Parse YAML frontmatter between --- delimiters
    const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
    const frontmatter = {};
    if (fmMatch) {
      for (const line of fmMatch[1].split('\n')) {
        const m = line.match(/^(\w[\w-]*):\s*(.+)$/);
        if (m) frontmatter[m[1]] = m[2].trim();
      }
    }

    // Extract supporting files
    const files = fs.readdirSync(skillDir).filter(f => f !== 'SKILL.md');

    skills.push({
      id: dir,
      name: frontmatter['name'] || dir,
      description: frontmatter['description'] || '',
      dir,
      files,
      content: raw,
    });
  }
  json(res, 200, { skills });
};

// GET /skills/:id/files/:filename — serve a skill supporting file
const handleSkillFile = (res, skillId, filename) => {
  const filePath = path.join(process.cwd(), 'skills', skillId, filename);
  if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end('Not found'); }
  cors(res);
  res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
  fs.createReadStream(filePath).pipe(res);
};

// ── Forge — dynamic skill/tool creation ──────────────────────────────────────

/**
 * POST /forge/skill
 * { id, title, description, content, persist? }
 * persist=true  → writes to project skills/{id}/SKILL.md (permanent)
 * persist=false → writes to sessionDir/dynamic-skills/{id}/SKILL.md (temp)
 */
const handleForgeSkill = async (req, res) => {
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
  const { id, title, description, content, persist = false, sessionDir } = body;
  if (!id || !content) return json(res, 400, { error: 'id and content required' });

  let targetDir;
  if (persist) {
    targetDir = path.join(process.cwd(), 'skills', id);
  } else {
    const base = sessionDir || BASE_DIR;
    targetDir = path.join(base, 'dynamic-skills', id);
  }

  fs.mkdirSync(targetDir, { recursive: true });
  const skillPath = path.join(targetDir, 'SKILL.md');
  fs.writeFileSync(skillPath, content, 'utf8');
  console.log(`  Forge: skill "${id}" → ${skillPath}${persist ? ' (persistent)' : ' (temp)'}`);
  json(res, 200, { ok: true, path: skillPath, id, persist });
};

/**
 * POST /forge/tool
 * { name, description, code, sessionDir }
 * Writes a Python script to the session dir and validates it compiles.
 */
const handleForgeTool = async (req, res) => {
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
  const { name, description, code, sessionDir } = body;
  if (!name || !code) return json(res, 400, { error: 'name and code required' });

  const targetDir = sessionDir || BASE_DIR;
  fs.mkdirSync(targetDir, { recursive: true });
  const scriptPath = path.join(targetDir, `tool_${name}.py`);
  fs.writeFileSync(scriptPath, code, 'utf8');

  // Validate by syntax-checking with python3 -m py_compile
  return new Promise((resolve) => {
    const child = spawn('python3', ['-m', 'py_compile', scriptPath]);
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      if (code === 0) {
        console.log(`  Forge: tool "${name}" → ${scriptPath} (valid)`);
        json(res, 200, { ok: true, path: scriptPath, name, valid: true });
      } else {
        console.warn(`  Forge: tool "${name}" syntax error: ${stderr.slice(0, 200)}`);
        json(res, 200, { ok: false, path: scriptPath, name, valid: false, error: stderr.slice(0, 500) });
      }
      resolve();
    });
  });
};

// ── Screenshot carousel via Playwright ──────────────────────────────────────

// POST /screenshot-carousel  { url: string, maxSlides?: number }
// Instagram: /embed/ URL (bypasses login wall). Reuses one Chromium instance.
// Fast path for /p/ carousels: fetch CDN image URLs instead of PNG screenshots.
// Reels: best-effort seek + element screenshots (up to 5 frames).

const SCREENSHOT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Reuse Chromium across captures — cold launch is the biggest delay. */
let sharedScreenshotBrowser = null;
let screenshotBrowserLock = Promise.resolve();

const withScreenshotBrowser = async (fn) => {
  let release;
  const prev = screenshotBrowserLock;
  screenshotBrowserLock = new Promise((r) => { release = r; });
  await prev;
  try {
    const { chromium } = require('playwright');
    if (!sharedScreenshotBrowser || !sharedScreenshotBrowser.isConnected()) {
      console.log('[screenshot-carousel] launching shared Chromium…');
      sharedScreenshotBrowser = await chromium.launch({
        headless: true,
        args: ['--disable-dev-shm-usage', '--no-sandbox'],
      });
    }
    return await fn(sharedScreenshotBrowser);
  } finally {
    release();
  }
};

/** Instagram /reels/ID does not embed; canonical embed path is /reel/ID/embed. */
const normalizeInstagramEmbedUrl = (raw) => {
  try {
    const u = new URL(raw.trim());
    if (!/instagram\.com$/i.test(u.hostname.replace(/^www\./, '')) && !/\.instagram\.com$/i.test(u.hostname)) {
      return raw.trim();
    }
    u.pathname = u.pathname.replace(/\/reels\//i, '/reel/');
    u.search = '';
    u.hash = '';
    let p = u.pathname.replace(/\/+$/, '');
    if (!/\/embed\/?$/i.test(p)) p = `${p}/embed`;
    u.pathname = p.endsWith('/') ? p : `${p}/`;
    return u.toString();
  } catch {
    return raw.replace(/\/reels\//i, '/reel/').replace(/\/$/, '') + '/embed/';
  }
};

const fetchImageAsShot = async (imageUrl, slideNumber, label) => {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return null;
  try {
    const res = await fetch(imageUrl, {
      headers: { 'User-Agent': SCREENSHOT_UA, Accept: 'image/*,*/*' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return null;
    const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0] || 'image/jpeg';
    return {
      base64: buf.toString('base64'),
      mimeType: mime.startsWith('image/') ? mime : 'image/jpeg',
      slideNumber,
      label,
    };
  } catch {
    return null;
  }
};

/** Extract /p/SHORTCODE or /reel/SHORTCODE from an Instagram URL. */
const extractInstagramShortcode = (raw) => {
  try {
    const u = new URL(raw.trim());
    if (!/instagram\.com/i.test(u.hostname)) return null;
    const m = u.pathname.match(/\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/i);
    return m ? m[1] : null;
  } catch {
    const m = String(raw).match(/instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/i);
    return m ? m[1] : null;
  }
};

/** Bootstrap anonymous Instagram web cookies (csrftoken + mid) for GraphQL. */
const getInstagramWebCookies = async () => {
  const res = await fetch('https://www.instagram.com/', {
    headers: {
      'User-Agent': SCREENSHOT_UA,
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(10000),
  });
  const cookieMap = {};
  const rawList = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [];
  for (const raw of rawList) {
    const kv = String(raw).split(';')[0];
    const i = kv.indexOf('=');
    if (i > 0) cookieMap[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  // Node < v18 may not expose getSetCookie; fall back to single set-cookie header.
  if (!Object.keys(cookieMap).length) {
    const single = res.headers.get('set-cookie') || '';
    for (const part of single.split(/,(?=[^;]+?=)/)) {
      const kv = part.split(';')[0];
      const i = kv.indexOf('=');
      if (i > 0) cookieMap[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
    }
  }
  return cookieMap;
};

const pickBestImageUrl = (node) => {
  if (!node || typeof node !== 'object') return null;
  if (typeof node.display_url === 'string' && /^https?:\/\//i.test(node.display_url)) {
    return node.display_url;
  }
  if (typeof node.thumbnail_src === 'string' && /^https?:\/\//i.test(node.thumbnail_src)) {
    return node.thumbnail_src;
  }
  const candidates = node.image_versions2?.candidates;
  if (Array.isArray(candidates) && candidates.length) {
    // Prefer largest width.
    const sorted = [...candidates].sort((a, b) => (b.width || 0) - (a.width || 0));
    const url = sorted[0]?.url;
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url;
  }
  return null;
};

/** Legacy xdt_shortcode_media → ordered CDN URLs. */
const urlsFromLegacyShortcodeMedia = (media, maxSlides) => {
  const edges = media?.edge_sidecar_to_children?.edges;
  const urls = [];
  if (Array.isArray(edges) && edges.length > 0) {
    for (const edge of edges) {
      const url = pickBestImageUrl(edge?.node);
      if (url) urls.push(url);
      if (urls.length >= maxSlides) break;
    }
  } else {
    const url = pickBestImageUrl(media);
    if (url) urls.push(url);
  }
  if (urls.length === 0) throw new Error('Instagram GraphQL returned no media URLs');
  return {
    urls,
    kind: edges && edges.length > 1 ? 'carousel' : (media.is_video ? 'video' : 'static'),
    typename: media.__typename || '',
  };
};

/** PolarisPostRootQuery v1/iPhone payload → ordered CDN URLs. */
const urlsFromPolarisWebInfoItem = (item, maxSlides) => {
  if (!item) throw new Error('Instagram Polaris web_info missing item');
  const carousel = Array.isArray(item.carousel_media) ? item.carousel_media : [];
  const urls = [];
  if (carousel.length > 0) {
    for (const child of carousel) {
      const url = pickBestImageUrl(child);
      if (url) urls.push(url);
      if (urls.length >= maxSlides) break;
    }
  } else {
    const url = pickBestImageUrl(item);
    if (url) urls.push(url);
  }
  if (urls.length === 0) throw new Error('Instagram Polaris returned no media URLs');
  // media_type: 1 image, 2 video, 8 carousel
  const mt = Number(item.media_type);
  const kind = carousel.length > 1 || mt === 8
    ? 'carousel'
    : (mt === 2 || item.video_versions ? 'video' : 'static');
  return { urls, kind, typename: 'PolarisWebInfo' };
};

/**
 * Fast path: Instagram public GraphQL shortcode media.
 * Tries PolarisPostRootQuery first (current web doc_id), then legacy xdt_shortcode_media.
 * Playwright Next-clicks on /embed/ are unreliable and often stop at 1–2 slides.
 */
const fetchInstagramCarouselUrlsViaGraphql = async (shortcode, maxSlides = 10) => {
  if (!shortcode) return null;

  const cookieMap = await getInstagramWebCookies();
  const csrf = cookieMap.csrftoken || '';
  const cookieHeader = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
  const commonHeaders = {
    'User-Agent': SCREENSHOT_UA,
    Accept: '*/*',
    'X-IG-App-ID': '936619743392459',
    'X-Requested-With': 'XMLHttpRequest',
    'X-CSRFToken': csrf,
    Cookie: cookieHeader,
    Referer: `https://www.instagram.com/p/${shortcode}/`,
    Origin: 'https://www.instagram.com',
  };

  // Current web query (PolarisPostRootQuery) — returns v1 media shape.
  const polarisVariables = JSON.stringify({
    shortcode,
    __relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider: false,
  });
  try {
    const polarisRes = await fetch('https://www.instagram.com/graphql/query/', {
      method: 'POST',
      headers: {
        ...commonHeaders,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        variables: polarisVariables,
        doc_id: '27128499623469141',
        server_timestamps: 'true',
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (polarisRes.ok) {
      const polarisData = await polarisRes.json();
      if (polarisData?.status === 'fail' || polarisData?.require_login) {
        throw new Error(polarisData?.message || 'Instagram Polaris requires login');
      }
      const items =
        polarisData?.data?.xdt_api__v1__media__shortcode__web_info?.items || [];
      if (items[0]) {
        return urlsFromPolarisWebInfoItem(items[0], maxSlides);
      }
      const polarisErr = polarisData?.errors?.[0]?.message;
      throw new Error(polarisErr || 'Instagram Polaris missing shortcode web_info');
    }
  } catch (polarisErr) {
    console.warn(
      '[screenshot-carousel] Polaris GraphQL failed, trying legacy doc_id:',
      polarisErr.message,
    );
  }

  // Legacy doc — still works for some public posts; kept as fallback.
  const variables = encodeURIComponent(JSON.stringify({ shortcode }));
  const endpoint =
    `https://www.instagram.com/graphql/query/?doc_id=10015901848480474&variables=${variables}`;
  const res = await fetch(endpoint, {
    headers: commonHeaders,
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    throw new Error(`Instagram GraphQL HTTP ${res.status}`);
  }
  const data = await res.json();
  if (data?.status === 'fail' || data?.require_login) {
    throw new Error(data?.message || 'Instagram GraphQL requires login');
  }
  const media =
    data?.data?.xdt_shortcode_media ||
    data?.data?.shortcode_media ||
    null;
  if (!media) throw new Error('Instagram GraphQL missing shortcode media');
  return urlsFromLegacyShortcodeMedia(media, maxSlides);
};

const captureInstagramViaGraphql = async (targetUrl, maxSlides) => {
  const shortcode = extractInstagramShortcode(targetUrl);
  if (!shortcode) return null;
  const meta = await fetchInstagramCarouselUrlsViaGraphql(shortcode, maxSlides);
  const shots = await Promise.all(
    meta.urls.map((url, i) => fetchImageAsShot(url, i + 1, `ig_slide_${i + 1}`)),
  );
  const screenshots = shots.filter(Boolean);
  if (screenshots.length === 0) {
    throw new Error('Failed to download Instagram CDN images from GraphQL URLs');
  }
  // Re-number in case some downloads failed
  screenshots.forEach((s, i) => {
    s.slideNumber = i + 1;
    s.label = `ig_slide_${i + 1}`;
  });
  return {
    screenshots,
    kind: meta.kind,
    partial: screenshots.length < meta.urls.length,
    warning:
      screenshots.length < meta.urls.length
        ? `Downloaded ${screenshots.length}/${meta.urls.length} carousel images.`
        : undefined,
  };
};

const readMainImageSrc = async (page) => page.evaluate(() => {
  const el =
    document.querySelector('.EmbeddedMediaImage') ||
    document.querySelector('img[src*="cdninstagram"]') ||
    document.querySelector('img[src*="fbcdn"]') ||
    Array.from(document.querySelectorAll('img')).find((img) => {
      const r = img.getBoundingClientRect();
      return r.width > 200 && r.height > 200 && img.src;
    });
  return el?.currentSrc || el?.src || '';
});

const handleScreenshotCarousel = async (req, res) => {
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }

  const { url: targetUrl, maxSlides = 10 } = body;
  if (!targetUrl || typeof targetUrl !== 'string') {
    return json(res, 400, { error: 'url required' });
  }

  const startedAt = Date.now();
  let warning = '';
  let kind = 'static';
  let partial = false;

  try {
    const isInstagram = /instagram\.com/i.test(targetUrl);
    const isReel = /instagram\.com\/(reel|reels)\//i.test(targetUrl);

    // Instagram /p/ carousels: GraphQL returns ALL sidecar slides. Embed Next-clicks
    // often stall after 1–2 images in headless Chromium.
    if (isInstagram && !isReel) {
      try {
        console.log(`[screenshot-carousel] GraphQL fast-path ${targetUrl}`);
        const gql = await captureInstagramViaGraphql(targetUrl, maxSlides);
        if (gql?.screenshots?.length) {
          const elapsedMs = Date.now() - startedAt;
          console.log(
            `[screenshot-carousel] GraphQL done in ${elapsedMs}ms — ${gql.screenshots.length} shot(s)`,
          );
          return json(res, 200, {
            screenshots: gql.screenshots,
            count: gql.screenshots.length,
            url: targetUrl,
            kind: gql.kind,
            partial: Boolean(gql.partial),
            warning: gql.warning,
            elapsedMs,
            source: 'instagram_graphql',
          });
        }
      } catch (gqlErr) {
        console.warn(
          '[screenshot-carousel] GraphQL fast-path failed, falling back to Playwright:',
          gqlErr.message,
        );
        warning = `GraphQL capture failed (${gqlErr.message}); used embed fallback.`;
      }
    }

    const result = await withScreenshotBrowser(async (browser) => {
      const navigateUrl = isInstagram ? normalizeInstagramEmbedUrl(targetUrl) : targetUrl;
      console.log(`[screenshot-carousel] navigate ${targetUrl} → ${navigateUrl}`);

      const context = await browser.newContext({
        viewport: { width: 420, height: 680 },
        deviceScaleFactor: 2,
        userAgent: SCREENSHOT_UA,
      });
      const page = await context.newPage();
      const screenshots = [];
      const slideDir = path.join(os.tmpdir(), 'carousel-' + Date.now());
      fs.mkdirSync(slideDir, { recursive: true });

      try {
        await page.goto(navigateUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
        try {
          await page.waitForSelector(
            'video, .EmbeddedMediaImage, img[src*="cdninstagram"], img[src*="fbcdn"]',
            { timeout: 8000 },
          );
        } catch { /* continue — fallbacks below */ }
        // Embed carousel chrome (Next button) hydrates a beat after the first image.
        await page.waitForTimeout(600);

        // Cookie / dialog dismiss (short timeout — don't block capture)
        try {
          const declineBtn = page.locator(
            'button:has-text("Decline"), button:has-text("Not now"), button:has-text("Close"), button:has-text("Allow all cookies")',
          ).first();
          if (await declineBtn.isVisible({ timeout: 400 })) {
            await declineBtn.click({ timeout: 1000 }).catch(() => {});
            await page.waitForTimeout(200);
          }
        } catch { /* ignore */ }

        /** Best-effort video frame grab (Reels / video embeds only). */
        const captureVideoFrames = async (maxFrames = 5) => {
          const videoCount = await page.locator('video').count();
          if (videoCount === 0) return [];
          kind = 'video';
          try {
            await page.evaluate(async () => {
              const v = document.querySelector('video');
              if (!v) return;
              v.muted = true;
              v.playsInline = true;
              try { await v.play(); } catch { /* autoplay blocked */ }
              await new Promise((r) => setTimeout(r, 250));
              try { v.pause(); } catch { /* ignore */ }
            });
          } catch { /* ignore */ }

          const ratios = [0, 0.25, 0.5, 0.75, 0.95].slice(0, Math.max(1, Math.min(maxFrames, 5)));
          const frames = [];
          for (let i = 0; i < ratios.length; i++) {
            const ratio = ratios[i];
            try {
              await page.evaluate(async (r) => {
                const v = document.querySelector('video');
                if (!v) return;
                const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
                const target = dur > 0 ? Math.min(dur * 0.98, Math.max(0, dur * r)) : 0;
                await new Promise((resolve) => {
                  const done = () => resolve(true);
                  if (Math.abs((v.currentTime || 0) - target) < 0.05) return done();
                  v.addEventListener('seeked', done, { once: true });
                  try { v.currentTime = target; } catch { done(); }
                  setTimeout(done, 1200);
                });
              }, ratio);
              const filePath = path.join(slideDir, `reel_frame_${i + 1}.jpg`);
              try {
                await page.locator('video').first().screenshot({ path: filePath, type: 'jpeg', quality: 80 });
              } catch {
                await page.screenshot({ path: filePath, type: 'jpeg', quality: 80, fullPage: false });
              }
              const imgBuffer = fs.readFileSync(filePath);
              if (imgBuffer.length > 2000) {
                frames.push({
                  base64: imgBuffer.toString('base64'),
                  mimeType: 'image/jpeg',
                  slideNumber: frames.length + 1,
                  label: `reel_frame_${frames.length + 1}`,
                });
              }
            } catch (e) {
              console.warn('[screenshot-carousel] video frame failed:', e.message);
            }
          }

          if (frames.length === 0) {
            const filePath = path.join(slideDir, 'video_poster.jpg');
            try {
              await page.locator('video').first().screenshot({ path: filePath, type: 'jpeg', quality: 80 });
            } catch {
              await page.screenshot({ path: filePath, type: 'jpeg', quality: 80, fullPage: false });
            }
            const imgBuffer = fs.readFileSync(filePath);
            frames.push({
              base64: imgBuffer.toString('base64'),
              mimeType: 'image/jpeg',
              slideNumber: 1,
              label: 'reel_poster',
            });
            partial = true;
            warning = 'Could only capture a poster/still from the Reel. Upload the video file for better structure.';
          }
          return frames;
        };

        const captureCarouselByCdn = async () => {
          kind = 'carousel';
          const nextBtn = page.locator(
            'button[aria-label="Next"], [aria-label="Next"], button[aria-label*="Next" i]',
          ).first();
          let hasNext = false;
          try {
            hasNext = await nextBtn.isVisible({ timeout: 2000 });
          } catch { /* single image */ }

          const seen = new Set();

          const appendShot = (shot) => {
            if (!shot) return;
            shot.slideNumber = screenshots.length + 1;
            shot.label = `ig_slide_${shot.slideNumber}`;
            screenshots.push(shot);
          };

          const pushSrc = async (src) => {
            if (!src || seen.has(src) || screenshots.length >= maxSlides) return false;
            seen.add(src);
            const shot = await fetchImageAsShot(src, 0, 'ig_slide');
            if (shot) {
              appendShot(shot);
              return true;
            }
            // CDN fetch blocked — screenshot the main media element.
            const filePath = path.join(slideDir, `slide_${screenshots.length + 1}.jpg`);
            try {
              await page.locator('.EmbeddedMediaImage').first()
                .screenshot({ path: filePath, type: 'jpeg', quality: 82 });
            } catch {
              await page.screenshot({ path: filePath, type: 'jpeg', quality: 82, fullPage: false });
            }
            const imgBuffer = fs.readFileSync(filePath);
            if (imgBuffer.length > 1000) {
              appendShot({
                base64: imgBuffer.toString('base64'),
                mimeType: 'image/jpeg',
                slideNumber: 0,
                label: 'ig_slide',
              });
              return true;
            }
            return false;
          };

          // Images already in the DOM (current + often the next peek).
          const initialSrcs = await page.evaluate(() => {
            const out = [];
            for (const img of document.querySelectorAll('.EmbeddedMediaImage, img[src*="cdninstagram"], img[src*="fbcdn"]')) {
              const r = img.getBoundingClientRect();
              if (r.width < 180 || r.height < 180) continue;
              const src = img.currentSrc || img.src || '';
              if (src && /^https?:\/\//i.test(src)) out.push(src);
            }
            return [...new Set(out)];
          });

          const prefetched = await Promise.all(
            initialSrcs.slice(0, maxSlides).map(async (src) => {
              const shot = await fetchImageAsShot(src, 0, 'ig_slide');
              return { src, shot };
            }),
          );
          for (const { src, shot } of prefetched) {
            if (screenshots.length >= maxSlides) break;
            if (!src || seen.has(src)) continue;
            if (shot) {
              seen.add(src);
              appendShot(shot);
            } else {
              await pushSrc(src);
            }
          }

          // Walk Next for remaining slides; bail quickly when src stops changing.
          let stagnant = 0;
          while (hasNext && screenshots.length < maxSlides && stagnant < 2) {
            const prevSrc = await readMainImageSrc(page);
            try {
              if (!(await nextBtn.isVisible({ timeout: 250 }))) break;
              await nextBtn.click({ timeout: 1000 });
              let nextSrc = '';
              try {
                nextSrc = await page.waitForFunction(
                  (prev) => {
                    const el = document.querySelector('.EmbeddedMediaImage')
                      || document.querySelector('img[src*="cdninstagram"]')
                      || document.querySelector('img[src*="fbcdn"]');
                    const next = el?.currentSrc || el?.src || '';
                    return next && next !== prev ? next : null;
                  },
                  prevSrc,
                  { timeout: 1200 },
                ).then((h) => h.jsonValue());
              } catch {
                nextSrc = await readMainImageSrc(page);
              }
              if (!nextSrc || seen.has(nextSrc)) {
                stagnant += 1;
                continue;
              }
              stagnant = 0;
              await pushSrc(nextSrc);
              try {
                hasNext = await nextBtn.isVisible({ timeout: 250 });
              } catch {
                hasNext = false;
              }
            } catch {
              break;
            }
          }

          if (screenshots.length === 1) kind = 'static';
        };

        if (isInstagram) {
          // /p/ carousels: skip video path entirely (biggest win for Prompt Writer).
          if (isReel) {
            const videoFrames = await captureVideoFrames(5);
            if (videoFrames.length > 0) screenshots.push(...videoFrames);
          }

          if (screenshots.length === 0) {
            try {
              await page.locator('.EmbeddedMediaImage, img[src*="cdninstagram"], img[src*="fbcdn"]').first()
                .waitFor({ state: 'visible', timeout: 5000 });
            } catch { /* fallbacks */ }

            await captureCarouselByCdn();

            if (screenshots.length === 0) {
              // og:image / viewport last resorts
              try {
                const og = await page.evaluate(() =>
                  document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '',
                );
                const ogShot = await fetchImageAsShot(og, 1, 'reel_og_image');
                if (ogShot) {
                  screenshots.push(ogShot);
                  partial = true;
                  warning = 'Used Instagram og:image poster only. Upload screenshots for full carousel structure.';
                  kind = 'static';
                }
              } catch (e) {
                console.warn('[screenshot-carousel] og:image fallback failed:', e.message);
              }
            }

            if (screenshots.length === 0) {
              // Avoid returning Instagram login / "post unavailable" chrome as a fake slide.
              // Note: error pages still load static.cdninstagram.com icons — ignore those.
              const pageSignal = await page.evaluate(() => {
                const text = (document.body?.innerText || '').slice(0, 2000).toLowerCase();
                const title = (document.title || '').toLowerCase();
                const blocked =
                  /log in|sign up|post isn't available|may be broken|may have been removed|page not found|sorry, this page|visit instagram/.test(text)
                  || /log in|isn't available|page not found/.test(title);
                const realMedia = Boolean(
                  document.querySelector('.EmbeddedMediaImage, video')
                  || Array.from(document.querySelectorAll('img[src*="cdninstagram"], img[src*="fbcdn"]')).some((img) => {
                    const r = img.getBoundingClientRect();
                    const src = img.currentSrc || img.src || '';
                    // Real post media is large; skip profile chips / brand icons / rsrc.php assets.
                    if (r.width < 180 || r.height < 180) return false;
                    if (/rsrc\.php|\/static\./i.test(src)) return false;
                    return true;
                  }),
                );
                return { blocked, hasMedia: realMedia, title: document.title || '' };
              }).catch(() => ({ blocked: true, hasMedia: false, title: '' }));

              if (pageSignal.blocked || !pageSignal.hasMedia) {
                throw new Error(
                  'Instagram did not expose media for this URL (login wall, private, or removed post). Upload screenshots manually instead.',
                );
              }

              const filePath = path.join(slideDir, 'fallback_viewport.jpg');
              await page.screenshot({ path: filePath, type: 'jpeg', quality: 80, fullPage: false });
              const imgBuffer = fs.readFileSync(filePath);
              if (imgBuffer.length > 4000) {
                screenshots.push({
                  base64: imgBuffer.toString('base64'),
                  mimeType: 'image/jpeg',
                  slideNumber: 1,
                  label: 'viewport',
                });
                partial = true;
                warning = 'Could not extract clean slide images; captured page viewport. Prefer Upload screenshots.';
                kind = 'static';
              }
            }
          }
        } else {
          const videoFrames = await captureVideoFrames(5);
          if (videoFrames.length > 0) {
            screenshots.push(...videoFrames);
          } else {
            kind = 'static';
            const filePath = path.join(slideDir, 'slide_01.jpg');
            await page.screenshot({ path: filePath, type: 'jpeg', quality: 82, fullPage: true });
            const imgBuffer = fs.readFileSync(filePath);
            screenshots.push({
              base64: imgBuffer.toString('base64'),
              mimeType: 'image/jpeg',
              slideNumber: 1,
              label: 'page_screenshot',
            });
          }
        }

        return screenshots;
      } finally {
        try { fs.rmSync(slideDir, { recursive: true, force: true }); } catch { /* ignore */ }
        await context.close().catch(() => {});
      }
    });

    const elapsedMs = Date.now() - startedAt;
    console.log(`[screenshot-carousel] done in ${elapsedMs}ms — ${result.length} shot(s)`);

    if (result.length === 0) {
      return json(res, 404, {
        error: 'No media captured. The page may require login, be private, or blocked. Upload screenshots instead.',
        partial: true,
      });
    }

    json(res, 200, {
      screenshots: result,
      count: result.length,
      url: targetUrl,
      kind,
      partial,
      warning: warning || undefined,
      elapsedMs,
    });
  } catch (err) {
    console.error('[screenshot-carousel] Error:', err.message);
    const base = (err.message || 'Screenshot capture failed').replace(/\.\s*$/, '');
    json(res, 500, {
      error: `${base}. If this is a Reel, upload the video file instead.`,
      partial: true,
    });
  }
};

// ── Google Cloud TTS proxy (replaces former Supabase edge function) ───────────

const stripWavHeader = (audioContent) => {
  const bytes = Buffer.from(audioContent, 'base64');
  if (bytes.length < 12) return audioContent;
  const riff = bytes.slice(0, 4).toString('ascii');
  const wave = bytes.slice(8, 12).toString('ascii');
  if (riff !== 'RIFF' || wave !== 'WAVE') return audioContent;

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.slice(offset, offset + 4).toString('ascii');
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (chunkId === 'data') {
      return bytes.slice(dataStart, dataStart + chunkSize).toString('base64');
    }
    offset = dataStart + chunkSize + (chunkSize % 2);
  }
  return audioContent;
};

const getLocaleFromVoiceId = (voiceId) => {
  const parts = String(voiceId || '').split('-');
  return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : 'en-IN';
};

const getGoogleTtsAccessToken = async (serviceAccount) => {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: serviceAccount.token_uri || 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(serviceAccount.private_key, 'base64url')}`;

  const response = await fetch(serviceAccount.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Google OAuth token: ${await response.text()}`);
  }
  const tokenPayload = await response.json();
  if (!tokenPayload.access_token) {
    throw new Error('Google OAuth token response did not include access_token.');
  }
  return tokenPayload.access_token;
};

const handleGoogleTts = async (req, res) => {
  try {
    const serviceAccountRaw = process.env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON;
    if (!serviceAccountRaw) {
      return json(res, 500, { error: 'Missing GOOGLE_TTS_SERVICE_ACCOUNT_JSON.' });
    }
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(serviceAccountRaw);
    } catch {
      return json(res, 500, { error: 'GOOGLE_TTS_SERVICE_ACCOUNT_JSON is not valid JSON.' });
    }

    const body = await readBody(req);
    const voiceId = body?.voiceId;
    if (!voiceId) {
      return json(res, 400, { error: 'voiceId is required.' });
    }

    const accessToken = await getGoogleTtsAccessToken(serviceAccount);
    const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: { text: (body?.text || '').trim() || ' ' },
        voice: {
          languageCode: getLocaleFromVoiceId(voiceId),
          name: voiceId,
        },
        audioConfig: {
          audioEncoding: 'LINEAR16',
          sampleRateHertz: 24000,
        },
      }),
    });

    if (!response.ok) {
      return json(res, 500, { error: await response.text() });
    }

    const payload = await response.json();
    return json(res, 200, {
      audioContent: payload.audioContent ? stripWavHeader(payload.audioContent) : '',
      sampleRateHertz: 24000,
    });
  } catch (err) {
    console.error('[tts] Error:', err.message);
    return json(res, 500, { error: err.message || 'Unexpected TTS error' });
  }
};

// ── Main server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (req.method === 'POST' && pathname === '/session') return handleSession(req, res);
  if (req.method === 'POST' && pathname === '/exec') return handleExec(req, res);
  if (req.method === 'POST' && pathname === '/python') return handlePython(req, res);
  if (req.method === 'POST' && pathname === '/upload') return handleUpload(req, res);
  if (req.method === 'POST' && pathname === '/tts') return handleGoogleTts(req, res);
  if (req.method === 'POST' && pathname === '/screenshot-carousel') return handleScreenshotCarousel(req, res);
  if (req.method === 'GET' && pathname === '/health') return handleHealth(res);
  if (req.method === 'GET' && pathname === '/harness/health') return handleHarnessHealth(res);
  if (req.method === 'POST' && pathname === '/llm/chat') return handleLlmChat(req, res);
  if (req.method === 'POST' && pathname === '/harness/fal/upload') return handleFalUpload(req, res);
  if (req.method === 'POST' && pathname === '/harness/fal/queue/submit') return handleFalQueueSubmit(req, res);
  if (req.method === 'GET' && pathname === '/harness/fal/queue/status') return handleFalQueueStatus(req, res, url);
  if (req.method === 'GET' && pathname === '/harness/fal/queue/result') return handleFalQueueResult(req, res, url);
  if (pathname.startsWith('/harness/v1/')) {
    const restPath = pathname.slice('/harness/v1'.length) || '/';
    return handleHarnessProxy(req, res, restPath, url.search);
  }
  if (req.method === 'GET' && pathname === '/ls') return handleLs(res);
  if (req.method === 'DELETE' && pathname === '/clean') return handleClean(res);
  if (req.method === 'GET' && pathname.startsWith('/files/')) {
    return handleFile(req, res, pathname.slice('/files/'.length));
  }
  if (req.method === 'POST' && pathname === '/memory/write') return handleMemoryWrite(req, res);
  if (req.method === 'GET' && pathname === '/memory/read') return handleMemoryRead(req, res);
  if (req.method === 'GET' && pathname === '/memory/list') return handleMemoryList(req, res);
  if (req.method === 'DELETE' && pathname === '/memory/clear') return handleMemoryClear(req, res);

  // MCP
  if (req.method === 'GET' && pathname === '/mcp/servers') return handleMcpServers(res);
  if (req.method === 'GET' && pathname === '/mcp/tools') return handleMcpTools(res);
  if (req.method === 'POST' && pathname === '/mcp/call') return handleMcpCall(req, res);
  if (req.method === 'POST' && pathname === '/mcp/connect') return handleMcpConnect(req, res);

  // Skills
  if (req.method === 'GET' && pathname === '/skills') return handleSkills(res);
  if (req.method === 'GET' && pathname.startsWith('/skills/')) {
    const parts = pathname.slice('/skills/'.length).split('/');
    if (parts.length === 3 && parts[1] === 'files') return handleSkillFile(res, parts[0], parts[2]);
  }

  // Forge — dynamic skill/tool creation
  if (req.method === 'POST' && pathname === '/forge/skill') return handleForgeSkill(req, res);
  if (req.method === 'POST' && pathname === '/forge/tool') return handleForgeTool(req, res);

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🤖 ReelAI Agent Shell Server`);
  console.log(`   Port:     ${PORT}`);
  console.log(`   Base dir: ${BASE_DIR}`);
  console.log(`   Tools:    shell_exec, python_exec, file upload/serve, memory r/w, screenshot carousel, google tts`);
  console.log(`   Harness:  /harness/v1/* (SiliconFlow), /harness/fal/* (fal.ai), /harness/health`);
  console.log(`   LLM:      POST /llm/chat (OpenAI-compatible: z.ai / SiliconFlow / OpenAI)`);
  console.log(`   SF key:   ${process.env.SILICONFLOW_API_KEY ? 'configured' : 'NOT SET'}`);
  console.log(`   ZAI key:  ${process.env.ZAI_API_KEY ? 'configured' : 'NOT SET'}`);
  console.log(`   OpenAI:   ${process.env.OPENAI_API_KEY ? 'configured' : 'NOT SET'}`);
  console.log(`   FAL key:  ${getFalKey() ? 'configured' : 'NOT SET'}`);
  console.log(`   TTS key:  ${process.env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON ? 'configured' : 'NOT SET'}`);
  console.log(`   MCP:      loading mcp.config.json...`);
  initMcp().then(() => console.log('   Ready.\n'));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n⚠️  Port ${PORT} is already in use. Shell server may already be running.\n`);
  } else {
    console.error('Shell server error:', err);
  }
});
