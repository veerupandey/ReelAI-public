/**
 * Browser/client fal.ai access via agent-shell-server proxy.
 * API keys stay on the shell process — never VITE_*.
 */
import { SHELL_SERVER } from '../shellToolService';

const FAL_BASE = `${SHELL_SERVER}/harness/fal`;

export const FAL_VEO31_I2V = 'fal-ai/veo3.1/image-to-video';
export const FAL_VEO31_FAST_I2V = 'fal-ai/veo3.1/fast/image-to-video';
export const FAL_VEO31_LITE_I2V = 'fal-ai/veo3.1/lite/image-to-video';
export const FAL_KLING_26_PRO_I2V = 'fal-ai/kling-video/v2.6/pro/image-to-video';
export const FAL_KLING_30_PRO_I2V = 'fal-ai/kling-video/v3/pro/image-to-video';
export const FAL_SEEDANCE_20_I2V = 'bytedance/seedance-2.0/image-to-video';
export const FAL_SEEDANCE_20_FAST_I2V = 'bytedance/seedance-2.0/fast/image-to-video';
export const FAL_SEEDANCE_20_MINI_I2V = 'bytedance/seedance-2.0/mini/image-to-video';
export const FAL_HAPPY_HORSE_I2V = 'alibaba/happy-horse/image-to-video';
export const FAL_WAN_27_I2V = 'fal-ai/wan/v2.7/image-to-video';
export const FAL_GROK_IMAGINE_I2V = 'xai/grok-imagine-video/image-to-video';
export const FAL_GROK_IMAGINE_15_I2V = 'xai/grok-imagine-video/v1.5/image-to-video';
/** @deprecated Never existed on fal — alias kept so stale UI state remaps. */
export const FAL_GROK_IMAGINE_FAST_I2V = FAL_GROK_IMAGINE_I2V;
/** @deprecated Never existed on fal — alias kept so stale UI state remaps. */
export const FAL_GROK_IMAGINE_FLASH_I2V = FAL_GROK_IMAGINE_I2V;

export type FalQueueStatus = 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | string;

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function errorMessage(body: Record<string, unknown>, fallback: string): string {
  if (typeof body.error === 'string' && body.error.trim()) return body.error.trim();
  if (typeof body.detail === 'string' && body.detail.trim()) return body.detail.trim();
  if (typeof body.message === 'string' && body.message.trim()) return body.message.trim();
  return fallback;
}

export async function getFalHealth(): Promise<{
  ok: boolean;
  falConfigured: boolean;
  siliconflowConfigured: boolean;
}> {
  try {
    const res = await fetch(`${SHELL_SERVER}/harness/health`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) {
      return { ok: false, falConfigured: false, siliconflowConfigured: false };
    }
    const body = (await res.json()) as {
      ok?: boolean;
      falConfigured?: boolean;
      siliconflowConfigured?: boolean;
    };
    return {
      ok: Boolean(body.ok),
      falConfigured: Boolean(body.falConfigured),
      siliconflowConfigured: Boolean(body.siliconflowConfigured),
    };
  } catch {
    return { ok: false, falConfigured: false, siliconflowConfigured: false };
  }
}

export async function falUploadImage(args: {
  base64: string;
  mimeType?: string;
}): Promise<{ url: string }> {
  const res = await fetch(`${FAL_BASE}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base64: args.base64,
      mimeType: args.mimeType || 'image/jpeg',
    }),
  });
  const body = await readJson(res);
  if (!res.ok) {
    throw new Error(errorMessage(body, `fal upload failed (${res.status})`));
  }
  const url = typeof body.url === 'string' ? body.url : '';
  if (!url) throw new Error('fal upload returned no URL');
  return { url };
}

export async function falSubmitVideo(args: {
  model: string;
  input: Record<string, unknown>;
}): Promise<{ requestId: string; statusUrl?: string; responseUrl?: string }> {
  const res = await fetch(`${FAL_BASE}/queue/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: args.model, input: args.input }),
  });
  const body = await readJson(res);
  if (!res.ok) {
    throw new Error(errorMessage(body, `fal submit failed (${res.status})`));
  }
  const requestId = typeof body.requestId === 'string' ? body.requestId : '';
  if (!requestId) throw new Error('fal submit returned no requestId');
  return {
    requestId,
    statusUrl: typeof body.statusUrl === 'string' ? body.statusUrl : undefined,
    responseUrl: typeof body.responseUrl === 'string' ? body.responseUrl : undefined,
  };
}

export async function falPollVideo(args: {
  model: string;
  requestId: string;
  /** Prefer fal's status_url from submit — full model paths 405 on GET */
  statusUrl?: string;
  responseUrl?: string;
}): Promise<{ status: FalQueueStatus; videoUrl?: string; detail?: string }> {
  const statusQs = new URLSearchParams();
  if (args.statusUrl) {
    statusQs.set('statusUrl', args.statusUrl);
  } else {
    statusQs.set('model', args.model);
    statusQs.set('requestId', args.requestId);
  }
  const statusRes = await fetch(`${FAL_BASE}/queue/status?${statusQs.toString()}`);
  const statusBody = await readJson(statusRes);
  if (!statusRes.ok) {
    throw new Error(errorMessage(statusBody, `fal status failed (${statusRes.status})`));
  }
  const status = String(statusBody.status || 'IN_QUEUE') as FalQueueStatus;
  if (status !== 'COMPLETED') {
    return { status };
  }

  const resultQs = new URLSearchParams();
  if (args.responseUrl) {
    resultQs.set('responseUrl', args.responseUrl);
  } else {
    resultQs.set('model', args.model);
    resultQs.set('requestId', args.requestId);
  }
  const resultRes = await fetch(`${FAL_BASE}/queue/result?${resultQs.toString()}`);
  const resultBody = await readJson(resultRes);
  if (!resultRes.ok) {
    throw new Error(errorMessage(resultBody, `fal result failed (${resultRes.status})`));
  }
  const videoUrl = typeof resultBody.videoUrl === 'string' ? resultBody.videoUrl : undefined;
  return { status, videoUrl, detail: videoUrl ? undefined : JSON.stringify(resultBody).slice(0, 400) };
}
