/**
 * Browser/client SiliconFlow access via agent-shell-server proxy.
 * API keys stay on the shell process — never VITE_*.
 */
import { SHELL_SERVER } from '../shellToolService';

const PROXY_BASE = `${SHELL_SERVER}/harness/v1`;

export const KIMI_K3_MODEL = 'moonshotai/Kimi-K3';
export const WAN_I2V_MODEL = 'Wan-AI/Wan2.2-I2V-A14B';
export const WAN_I2V_TURBO_MODEL = 'Wan-AI/Wan2.1-I2V-14B-720P-Turbo';
export const WAN_T2V_MODEL = 'Wan-AI/Wan2.2-T2V-A14B';

export type WanImageSize = '1280x720' | '720x1280' | '960x960';

export interface SiliconFlowChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SiliconFlowChatResult {
  content: string;
  model: string;
  providerRequestId?: string;
}

export interface SiliconFlowVideoStatus {
  status: 'InQueue' | 'InProgress' | 'Succeed' | 'Failed' | string;
  reason?: string;
  videoUrl?: string;
  /** Raw provider payload (minus video URLs) for failure diagnostics. */
  detail?: string;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

export async function getSiliconFlowHealth(): Promise<{
  ok: boolean;
  siliconflowConfigured: boolean;
  falConfigured: boolean;
}> {
  try {
    const res = await fetch(`${SHELL_SERVER}/harness/health`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return { ok: false, siliconflowConfigured: false, falConfigured: false };
    const body = (await res.json()) as {
      ok?: boolean;
      siliconflowConfigured?: boolean;
      falConfigured?: boolean;
    };
    return {
      ok: Boolean(body.ok),
      siliconflowConfigured: Boolean(body.siliconflowConfigured),
      falConfigured: Boolean(body.falConfigured),
    };
  } catch {
    return { ok: false, siliconflowConfigured: false, falConfigured: false };
  }
}

/** Kimi can be slow; fail over to Gemini Pro before the UI feels stuck. */
const CHAT_TIMEOUT_MS = 20_000;

export async function siliconflowChat(args: {
  model?: string;
  messages: SiliconFlowChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<SiliconFlowChatResult> {
  const model = args.model || KIMI_K3_MODEL;
  const res = await fetch(`${PROXY_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: args.messages,
      temperature: args.temperature ?? 0.4,
      max_tokens: args.maxTokens ?? 4096,
    }),
    signal: AbortSignal.timeout(args.timeoutMs ?? CHAT_TIMEOUT_MS),
  });
  const body = (await readJson(res)) as {
    error?: string | { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
    id?: string;
  };
  if (!res.ok) {
    const msg = typeof body.error === 'string'
      ? body.error
      : body.error?.message || `SiliconFlow chat failed (${res.status})`;
    throw new Error(msg);
  }
  const content = body.choices?.[0]?.message?.content?.trim() || '';
  if (!content) throw new Error('SiliconFlow chat returned empty content');
  return { content, model, providerRequestId: body.id };
}

/**
 * SiliconFlow I2V docs require image as `data:image/...;base64,...` or a public URL.
 * Raw base64 alone often submits OK then fails asynchronously with an empty reason.
 */
export function formatWanImagePayload(
  imageBase64OrUrl: string,
  mimeType = 'image/jpeg',
): string {
  const trimmed = (imageBase64OrUrl || '').trim();
  if (!trimmed) throw new Error('Wan image payload is empty');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(trimmed)) return trimmed;
  const cleaned = trimmed.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (cleaned.length < 64) throw new Error('Wan image payload is too small or invalid');
  const mime = mimeType.includes('png')
    ? 'image/png'
    : mimeType.includes('webp')
      ? 'image/webp'
      : 'image/jpeg';
  return `data:${mime};base64,${cleaned}`;
}

function extractVideoFailureReason(body: Record<string, unknown>): string | undefined {
  const nested = (value: unknown): string | undefined => {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      for (const key of ['message', 'reason', 'failReason', 'fail_reason', 'failure_reason', 'msg']) {
        if (typeof obj[key] === 'string' && (obj[key] as string).trim()) {
          return (obj[key] as string).trim();
        }
      }
    }
    return undefined;
  };
  for (const key of [
    'reason', 'message', 'failReason', 'fail_reason', 'failure_reason', 'error', 'data',
  ]) {
    const hit = nested(body[key]);
    if (hit) return hit;
  }
  const results = body.results;
  if (results && typeof results === 'object') {
    const hit = nested(results);
    if (hit) return hit;
  }
  return undefined;
}

export async function siliconflowSubmitVideo(args: {
  model?: string;
  prompt: string;
  imageBase64?: string;
  imageMimeType?: string;
  imageSize?: WanImageSize;
  negativePrompt?: string;
  seed?: number;
}): Promise<{ requestId: string }> {
  const payload: Record<string, unknown> = {
    model: args.model || WAN_I2V_MODEL,
    prompt: args.prompt,
    image_size: args.imageSize || '960x960',
  };
  if (args.imageBase64) {
    payload.image = formatWanImagePayload(args.imageBase64, args.imageMimeType || 'image/jpeg');
  }
  if (args.negativePrompt) payload.negative_prompt = args.negativePrompt;
  if (typeof args.seed === 'number' && Number.isFinite(args.seed)) payload.seed = Math.floor(args.seed);

  const res = await fetch(`${PROXY_BASE}/video/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await readJson(res)) as {
    error?: string | { message?: string };
    message?: string;
    requestId?: string;
    code?: number | string;
  };
  if (!res.ok) {
    const msg = typeof body.error === 'string'
      ? body.error
      : body.error?.message || body.message || `SiliconFlow video submit failed (${res.status})`;
    throw new Error(msg);
  }
  if (!body.requestId) throw new Error('SiliconFlow video submit missing requestId');
  return { requestId: body.requestId };
}

export async function siliconflowPollVideo(requestId: string): Promise<SiliconFlowVideoStatus> {
  const res = await fetch(`${PROXY_BASE}/video/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId }),
  });
  const body = (await readJson(res)) as Record<string, unknown> & {
    error?: string | { message?: string };
    status?: string;
    results?: { videos?: Array<{ url?: string }> };
  };
  if (!res.ok) {
    const msg = typeof body.error === 'string'
      ? body.error
      : body.error?.message || extractVideoFailureReason(body)
        || `SiliconFlow video status failed (${res.status})`;
    throw new Error(msg);
  }
  const reason = extractVideoFailureReason(body);
  // Keep a compact diagnostic dump (omit huge video URLs).
  const diagnostic: Record<string, unknown> = { ...body };
  if (diagnostic.results && typeof diagnostic.results === 'object') {
    const results = diagnostic.results as { videos?: Array<{ url?: string }>; [k: string]: unknown };
    diagnostic.results = {
      ...results,
      videos: (results.videos || []).map((v) => ({
        url: v?.url ? `[url len=${v.url.length}]` : undefined,
      })),
    };
  }
  return {
    status: body.status || 'Unknown',
    reason,
    videoUrl: body.results?.videos?.[0]?.url,
    detail: JSON.stringify(diagnostic).slice(0, 500),
  };
}
