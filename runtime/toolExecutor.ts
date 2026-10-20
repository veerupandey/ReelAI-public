/**
 * Tool Executor
 * Maps AgentToolId → actual implementation.
 * SubAgents call this instead of importing services directly.
 * This is the single seam between the agent runtime and execution infrastructure.
 */

import type { AgentToolId } from '../agents/contracts';
import {
  execShell,
  runPython,
  buildKenBurnsClip,
  concatWithXfade,
  concatAudio,
  addAudioToVideo,
  burnCaptions,
  getAudioDuration,
  isShellServerRunning,
  pcmToWav,
  uploadBase64,
  createSession,
  type SessionInfo,
  type ShellResult,
} from '../services/shellToolService';
import { readMemory, writeMemory, type MemoryEntry, type MemoryPhase, type MemoryScope } from '../services/agentMemory';
import { generateImageAsset, generateVoiceover } from '../services/geminiService';

// ── Tool input/output types ───────────────────────────────────────────────────

export interface ToolContext {
  sessionDir: string;
  brandSlug?: string;
}

export type ToolInput = Record<string, any>;
export type ToolOutput = Record<string, any>;

export interface ToolResult {
  ok: boolean;
  output: ToolOutput;
  error?: string;
}

// ── Tool implementations ──────────────────────────────────────────────────────

const TOOL_IMPLS: Partial<Record<AgentToolId, (input: ToolInput, ctx: ToolContext) => Promise<ToolResult>>> = {

  shell_exec: async (input, ctx) => {
    const result = await execShell(input.command as string, ctx.sessionDir);
    return { ok: result.ok, output: { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode } };
  },

  python_exec: async (input, ctx) => {
    const result = await runPython(input.code as string, ctx.sessionDir);
    return { ok: result.ok, output: { stdout: result.stdout, stderr: result.stderr } };
  },

  tts_generation: async (input, ctx) => {
    const rawB64 = await generateVoiceover(input.text as string, {
      provider: 'gemini', id: input.voice || 'Kore', name: input.voice || 'Kore', language: 'en-US',
    } as any);
    const wavB64 = pcmToWav(rawB64, 24000, 1, 16);
    if (ctx.sessionDir && input.filename) {
      const up = await uploadBase64(wavB64, input.filename as string, 'audio/wav', ctx.sessionDir);
      return { ok: true, output: { path: up.path, url: up.url, wavBase64: wavB64 } };
    }
    return { ok: true, output: { wavBase64: wavB64 } };
  },

  video_assembly: async (input, ctx) => {
    const action = input.action as string;

    if (action === 'ken_burns') {
      const result = await buildKenBurnsClip(
        input.imagePath as string,
        input.outputPath as string,
        input.durationSec as number,
        (input.zoomDirection || 'in') as 'in' | 'out',
        ctx.sessionDir,
      );
      return { ok: result.ok, output: { path: input.outputPath, stderr: result.stderr } };
    }

    if (action === 'xfade') {
      const result = await concatWithXfade(
        input.clips as Array<{ absPath: string; durationSec: number }>,
        input.outputPath as string,
        ctx.sessionDir,
        input.fadeDuration || 0.5,
      );
      return { ok: result.ok, output: { path: input.outputPath, stderr: result.stderr } };
    }

    if (action === 'concat_audio') {
      const result = await concatAudio(
        input.audioPaths as string[],
        input.outputPath as string,
        ctx.sessionDir,
      );
      return { ok: result.ok, output: { path: input.outputPath, stderr: result.stderr } };
    }

    if (action === 'add_audio') {
      const result = await addAudioToVideo(
        input.videoPath as string,
        input.audioPath as string,
        input.outputPath as string,
        ctx.sessionDir,
      );
      return { ok: result.ok, output: { path: input.outputPath, stderr: result.stderr } };
    }

    if (action === 'burn_captions') {
      const result = await burnCaptions(
        input.videoPath as string,
        input.outputPath as string,
        input.captions as Array<{ text: string; startSec: number; endSec: number }>,
        ctx.sessionDir,
      );
      return { ok: result.ok, output: { path: input.outputPath, stderr: result.stderr } };
    }

    if (action === 'get_duration') {
      const dur = await getAudioDuration(input.path as string, ctx.sessionDir);
      return { ok: true, output: { durationSec: dur } };
    }

    return { ok: false, output: {}, error: `Unknown video_assembly action: ${action}` };
  },

  image_generation: async (input) => {
    const base64 = await generateImageAsset({
      mode: (input.mode || 'generate') as 'generate' | 'edit',
      imagePrompt: input.prompt as string,
      visualDescription: (input.description || input.prompt) as string,
      ...(input.referenceBase64 ? { primaryReference: { data: input.referenceBase64 as string, mimeType: 'image/png' } } : {}),
    });
    return { ok: true, output: { base64, dataUrl: `data:image/png;base64,${base64}` } };
  },

  memory_read: async (input, ctx) => {
    const entries = await readMemory(
      (input.phase || '') as MemoryPhase,
      input.brandSlug || ctx.brandSlug,
    );
    return { ok: true, output: { entries } };
  },

  memory_write: async (input, ctx) => {
    const entry: MemoryEntry = {
      phase: (input.phase || 'all') as MemoryPhase,
      what_went_wrong: input.what_went_wrong as string,
      better_approach: input.better_approach as string,
      ...(input.example ? { example: input.example as string } : {}),
    };
    await writeMemory(entry, (input.scope || 'global') as MemoryScope, input.brandSlug || ctx.brandSlug);
    return { ok: true, output: {} };
  },
};

// ── Public API ────────────────────────────────────────────────────────────────

export const executeTool = async (
  toolId: AgentToolId,
  input: ToolInput,
  ctx: ToolContext,
): Promise<ToolResult> => {
  const impl = TOOL_IMPLS[toolId];
  if (!impl) {
    return { ok: false, output: {}, error: `Tool '${toolId}' has no executor registered.` };
  }
  try {
    return await impl(input, ctx);
  } catch (e: any) {
    return { ok: false, output: {}, error: e?.message || String(e) };
  }
};

export const isToolAvailable = async (toolId: AgentToolId): Promise<boolean> => {
  if (toolId === 'shell_exec' || toolId === 'python_exec' || toolId === 'video_assembly' ||
      toolId === 'tts_generation' || toolId === 'memory_read' || toolId === 'memory_write') {
    return isShellServerRunning();
  }
  return true;
};

export const createToolContext = async (brandSlug: string, productSlug: string): Promise<ToolContext & { session: SessionInfo }> => {
  const session = await createSession(brandSlug, productSlug);
  return { sessionDir: session.sessionDir, brandSlug, session };
};
