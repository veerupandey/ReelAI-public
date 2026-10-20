/**
 * Unified Tool Registry
 *
 * Three source types, one interface:
 *
 *   'function' — local TypeScript functions (shell exec, python, ffmpeg helpers)
 *   'mcp'      — tools from external MCP servers (filesystem, brave-search, puppeteer…)
 *   'skill'    — markdown skill docs from skills/ (instructional context, not executable)
 *
 * Any agent or component can call getAllTools() to get the full merged list,
 * or callTool(name, args) to invoke any tool by name regardless of its source.
 *
 * MCP tools are namespaced as "{serverName}__{toolName}" to avoid collisions.
 * Skills are exposed as metadata only — they inject instructional context into
 * LLM prompts rather than being directly invoked.
 */

import { execShell, runPython, SHELL_SERVER } from './shellToolService';
import {
  listMcpTools,
  callMcpTool,
  mcpContentToText,
  type McpTool,
  type McpContent,
} from './mcpClient';
import {
  classifyForgeDraft,
  hybridForgeTool,
} from './agentLoop/toolForge';
import { loadBundledSkills } from './bundledSkills';

/** Session-scoped forged tools registered for the current agent run. */
const _forgedTools: UnifiedTool[] = [];
const _pendingForgeApprovals: Map<string, {
  name: string;
  description: string;
  code: string;
  sessionDir: string;
}> = new Map();

export function registerForgedTool(tool: UnifiedTool): void {
  const idx = _forgedTools.findIndex((t) => t.name === tool.name);
  if (idx >= 0) _forgedTools[idx] = tool;
  else _forgedTools.push(tool);
}

export function clearForgedTools(): void {
  _forgedTools.length = 0;
  _pendingForgeApprovals.clear();
}

export function listForgedTools(): UnifiedTool[] {
  return [..._forgedTools];
}

export function getPendingForgeApproval(forgeId: string) {
  return _pendingForgeApprovals.get(forgeId);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type ToolSource = 'function' | 'mcp' | 'skill';

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
    default?: unknown;
  }>;
  required: string[];
}

export interface ToolResult {
  content: Array<{
    type: 'text' | 'image' | 'artifact';
    text?: string;
    url?: string;
    mimeType?: string;
  }>;
  isError: boolean;
  metadata?: Record<string, unknown>;
}

export interface UnifiedTool {
  name: string;
  description: string;
  source: ToolSource;
  serverName?: string;     // MCP only — which server it comes from
  skillDir?: string;       // skill only — folder name under skills/
  inputSchema: ToolInputSchema;
  execute?: (input: Record<string, unknown>) => Promise<ToolResult>;
}

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  dir: string;
  files: string[];
  content: string;         // full SKILL.md text for prompt injection
}

// ── Local function tools ──────────────────────────────────────────────────────
// These mirror the MCP Tool interface exactly so the agent treats them uniformly.

const FUNCTION_TOOLS: UnifiedTool[] = [
  {
    name: 'shell_exec',
    description: 'Run a shell command (bash, ffmpeg, imagemagick, etc.) in the agent session directory. Returns stdout, stderr, exit code, and any new artifact files.',
    source: 'function',
    inputSchema: {
      type: 'object',
      properties: {
        command:    { type: 'string', description: 'Shell command to execute' },
        sessionDir: { type: 'string', description: 'Absolute path to session directory (optional)' },
      },
      required: ['command'],
    },
    execute: async ({ command, sessionDir }) => {
      const result = await execShell(String(command), sessionDir ? String(sessionDir) : undefined);
      return {
        content: [{ type: 'text', text: [result.stdout, result.stderr].filter(Boolean).join('\n') || '(no output)' }],
        isError: !result.ok,
        metadata: { exitCode: result.exitCode, artifacts: result.artifacts },
      };
    },
  },

  {
    name: 'python_exec',
    description: 'Run a Python 3 script in the agent session directory. PIL (Pillow), wave, json, os, subprocess are available. Returns stdout, stderr, and any generated files.',
    source: 'function',
    inputSchema: {
      type: 'object',
      properties: {
        code:       { type: 'string', description: 'Python 3 source code to execute' },
        sessionDir: { type: 'string', description: 'Absolute path to session directory (optional)' },
        filename:   { type: 'string', description: 'Script filename (optional, auto-generated if omitted)' },
      },
      required: ['code'],
    },
    execute: async ({ code, sessionDir, filename }) => {
      const result = await runPython(
        String(code),
        sessionDir ? String(sessionDir) : undefined,
        filename ? String(filename) : undefined,
      );
      return {
        content: [{ type: 'text', text: [result.stdout, result.stderr].filter(Boolean).join('\n') || '(no output)' }],
        isError: !result.ok,
        metadata: { exitCode: result.exitCode, artifacts: result.artifacts },
      };
    },
  },

  {
    name: 'ffmpeg_ken_burns',
    description: 'Apply Ken Burns zoom/pan animation to a still image and export as MP4 clip. Zoom direction alternates between scenes for variety.',
    source: 'function',
    inputSchema: {
      type: 'object',
      properties: {
        inputAbsPath:  { type: 'string', description: 'Absolute path to input image (PNG/JPG)' },
        outputAbsPath: { type: 'string', description: 'Absolute path for output MP4 clip' },
        durationSec:   { type: 'number', description: 'Clip duration in seconds' },
        zoomDirection: { type: 'string', enum: ['in', 'out'], description: 'Zoom direction' },
        sessionDir:    { type: 'string', description: 'Absolute path to session directory' },
      },
      required: ['inputAbsPath', 'outputAbsPath', 'durationSec', 'zoomDirection', 'sessionDir'],
    },
    execute: async ({ inputAbsPath, outputAbsPath, durationSec, zoomDirection, sessionDir }) => {
      const { buildKenBurnsClip } = await import('./shellToolService');
      const result = await buildKenBurnsClip(
        String(inputAbsPath), String(outputAbsPath),
        Number(durationSec), zoomDirection as 'in' | 'out', String(sessionDir),
      );
      return {
        content: [{ type: 'text', text: result.ok ? `Ken Burns clip: ${outputAbsPath}` : (result.stderr || 'failed') }],
        isError: !result.ok,
      };
    },
  },

  {
    name: 'ffmpeg_concat_xfade',
    description: 'Join multiple video clips with xfade transitions (fade, wipeup, smoothleft, etc.). All paths must be absolute.',
    source: 'function',
    inputSchema: {
      type: 'object',
      properties: {
        clips:         { type: 'array', description: 'Array of { absPath, durationSec } objects' },
        outputAbsPath: { type: 'string', description: 'Absolute path for output MP4' },
        sessionDir:    { type: 'string', description: 'Absolute path to session directory' },
        fadeDuration:  { type: 'number', description: 'Transition duration in seconds (default 0.5, clamped automatically)' },
      },
      required: ['clips', 'outputAbsPath', 'sessionDir'],
    },
    execute: async ({ clips, outputAbsPath, sessionDir, fadeDuration }) => {
      const { concatWithXfade } = await import('./shellToolService');
      const result = await concatWithXfade(
        clips as Array<{ absPath: string; durationSec: number }>,
        String(outputAbsPath), String(sessionDir),
        fadeDuration ? Number(fadeDuration) : 0.5,
      );
      return {
        content: [{ type: 'text', text: result.ok ? `Concat done: ${outputAbsPath}` : (result.stderr || 'failed') }],
        isError: !result.ok,
      };
    },
  },

  {
    name: 'ffmpeg_add_audio',
    description: 'Mix voiceover audio into a video file. Automatically freeze-extends the last frame if audio is longer than video.',
    source: 'function',
    inputSchema: {
      type: 'object',
      properties: {
        videoAbsPath:  { type: 'string', description: 'Absolute path to input video' },
        audioAbsPath:  { type: 'string', description: 'Absolute path to WAV audio file' },
        outputAbsPath: { type: 'string', description: 'Absolute path for output MP4' },
        sessionDir:    { type: 'string', description: 'Absolute path to session directory' },
      },
      required: ['videoAbsPath', 'audioAbsPath', 'outputAbsPath', 'sessionDir'],
    },
    execute: async ({ videoAbsPath, audioAbsPath, outputAbsPath, sessionDir }) => {
      const { addAudioToVideo } = await import('./shellToolService');
      const result = await addAudioToVideo(
        String(videoAbsPath), String(audioAbsPath),
        String(outputAbsPath), String(sessionDir),
      );
      return {
        content: [{ type: 'text', text: result.ok ? `Final video: ${outputAbsPath}` : (result.stderr || 'failed') }],
        isError: !result.ok,
      };
    },
  },

  {
    name: 'ffmpeg_time_stretch_audio',
    description: 'Time-stretch audio to a target duration without changing pitch. Uses ffmpeg atempo filter (supports 0.25x–4x range). Use this when voiceover audio duration does not match the video duration.',
    source: 'function',
    inputSchema: {
      type: 'object',
      properties: {
        inputAbsPath:   { type: 'string', description: 'Absolute path to input WAV audio file' },
        outputAbsPath:  { type: 'string', description: 'Absolute path for output WAV audio file' },
        targetDuration: { type: 'number', description: 'Target duration in seconds' },
        sessionDir:     { type: 'string', description: 'Absolute path to session directory' },
      },
      required: ['inputAbsPath', 'outputAbsPath', 'targetDuration', 'sessionDir'],
    },
    execute: async ({ inputAbsPath, outputAbsPath, targetDuration, sessionDir }) => {
      const { timeStretchAudio } = await import('./shellToolService');
      const result = await timeStretchAudio(
        String(inputAbsPath), String(outputAbsPath),
        Number(targetDuration), String(sessionDir),
      );
      return {
        content: [{ type: 'text', text: result.ok ? `Time-stretched audio: ${outputAbsPath}` : (result.stderr || 'failed') }],
        isError: !result.ok,
      };
    },
  },

  {
    name: 'platform_export',
    description: 'Re-encode a video for a specific platform with the correct bitrate, pixel format, and metadata. Supports instagram_reels, tiktok, youtube_shorts.',
    source: 'function',
    inputSchema: {
      type: 'object',
      properties: {
        inputAbsPath:  { type: 'string', description: 'Absolute path to input video' },
        outputAbsPath: { type: 'string', description: 'Absolute path for output MP4' },
        platform:      { type: 'string', enum: ['instagram_reels', 'tiktok', 'youtube_shorts'] },
        sessionDir:    { type: 'string', description: 'Absolute path to session directory' },
      },
      required: ['inputAbsPath', 'outputAbsPath', 'platform', 'sessionDir'],
    },
    execute: async ({ inputAbsPath, outputAbsPath, platform, sessionDir }) => {
      const { exportForPlatform } = await import('./shellToolService');
      const result = await exportForPlatform(
        String(inputAbsPath), String(outputAbsPath),
        platform as 'instagram_reels' | 'tiktok' | 'youtube_shorts',
        String(sessionDir),
      );
      return {
        content: [{ type: 'text', text: result.ok ? `Exported: ${outputAbsPath}` : (result.stderr || 'failed') }],
        isError: !result.ok,
      };
    },
  },

  {
    name: 'forge_tool',
    description:
      'Create a Python tool for this session. Safe local scripts auto-compile and register. Network/MCP/external tools return needs_approval JSON for human review.',
    source: 'function',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tool name (snake_case)' },
        description: { type: 'string', description: 'What the tool does' },
        code: { type: 'string', description: 'Python 3 source code' },
        sessionDir: { type: 'string', description: 'Absolute session directory' },
        approved: { type: 'string', description: 'Set "true" after human approval for network tools' },
      },
      required: ['name', 'code', 'sessionDir'],
    },
    execute: async ({ name, description, code, sessionDir, approved }) => {
      const draft = classifyForgeDraft({
        name: String(name),
        description: String(description || ''),
        code: String(code),
      });
      const result = await hybridForgeTool({
        name: draft.name,
        description: draft.description,
        code: draft.code,
        sessionDir: String(sessionDir),
        approved: String(approved || '') === 'true',
      });
      if (result.status === 'needs_approval') {
        _pendingForgeApprovals.set(result.draft.forgeId, {
          name: result.draft.name,
          description: result.draft.description,
          code: result.draft.code,
          sessionDir: String(sessionDir),
        });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'needs_approval',
              forgeId: result.draft.forgeId,
              reason: result.draft.reason,
              name: result.draft.name,
            }),
          }],
          isError: false,
          metadata: { forgeId: result.draft.forgeId, requiresApproval: true },
        };
      }
      if (result.status === 'error') {
        return {
          content: [{ type: 'text', text: result.error }],
          isError: true,
        };
      }
      registerForgedTool(result.tool);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'forged',
            toolName: result.tool.name,
            path: result.path,
          }),
        }],
        isError: false,
        metadata: { toolName: result.tool.name, path: result.path },
      };
    },
  },

  {
    name: 'list_forged_tools',
    description: 'List Python tools forged and registered for the current agent session.',
    source: 'function',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    execute: async () => {
      const tools = listForgedTools();
      return {
        content: [{
          type: 'text',
          text: tools.length
            ? tools.map((t) => `- ${t.name}: ${t.description}`).join('\n')
            : '(no forged tools yet)',
        }],
        isError: false,
      };
    },
  },
];

// ── MCP tool cache ────────────────────────────────────────────────────────────

let _mcpCache: UnifiedTool[] | null = null;
let _mcpCacheExpiry = 0;
const MCP_CACHE_TTL_MS = 30_000;

const fetchMcpTools = async (): Promise<UnifiedTool[]> => {
  if (Date.now() < _mcpCacheExpiry && _mcpCache) return _mcpCache;
  try {
    const raw: McpTool[] = await listMcpTools();
    _mcpCache = raw.map((t) => ({
      name: `${t.serverName}__${t.name}`,
      description: `[${t.serverName}] ${t.description ?? t.name}`,
      source: 'mcp' as ToolSource,
      serverName: t.serverName,
      inputSchema: (t.inputSchema ?? { type: 'object', properties: {}, required: [] }) as ToolInputSchema,
      execute: async (args) => {
        const result = await callMcpTool(t.serverName, t.name, args as Record<string, unknown>);
        const text = mcpContentToText(result.content as McpContent[]);
        const images = (result.content as McpContent[])
          .filter((c) => c.type === 'image')
          .map((c) => ({ type: 'image' as const, url: `data:${c.mimeType};base64,${c.data}` }));
        return {
          content: [
            ...(text ? [{ type: 'text' as const, text }] : []),
            ...images,
          ],
          isError: result.isError,
        };
      },
    }));
    _mcpCacheExpiry = Date.now() + MCP_CACHE_TTL_MS;
  } catch {
    _mcpCache = [];
  }
  return _mcpCache!;
};

// ── Skill loader ──────────────────────────────────────────────────────────────

let _skillsCache: SkillMeta[] | null = null;
let _skillsCacheExpiry = 0;
const SKILLS_CACHE_TTL_MS = 60_000;

/** Clear the skills cache (tests / after forging a persisted skill). */
export const clearSkillsCache = (): void => {
  _skillsCache = null;
  _skillsCacheExpiry = 0;
};

/**
 * Load skill docs from shell `/skills` when online; otherwise fall back to
 * Vite-bundled markdown under skills/<id>/SKILL.md so agents still get
 * instructional context without agent-shell :3721.
 */
export const loadSkills = async (): Promise<SkillMeta[]> => {
  if (Date.now() < _skillsCacheExpiry && _skillsCache) return _skillsCache;

  let fromShell: SkillMeta[] | null = null;
  try {
    const res = await fetch(`${SHELL_SERVER}/skills`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json() as { skills: SkillMeta[] };
      fromShell = data.skills ?? [];
    }
  } catch {
    fromShell = null;
  }

  // Prefer live shell list (includes dynamic session skills). Fall back to
  // the web bundle when the shell is offline or returns nothing.
  _skillsCache = fromShell && fromShell.length > 0 ? fromShell : loadBundledSkills();
  _skillsCacheExpiry = Date.now() + SKILLS_CACHE_TTL_MS;
  return _skillsCache;
};

/** Return a skill's SKILL.md content for prompt injection, or empty string if not found. */
export const getSkillContext = async (skillId: string): Promise<string> => {
  const skills = await loadSkills();
  return skills.find((s) => s.id === skillId)?.content ?? '';
};

// ── Public registry API ───────────────────────────────────────────────────────

/**
 * Return all available tools — local functions + MCP tools from connected servers.
 * Skills are not included here (they're instructional context, not callable tools).
 * Use loadSkills() separately to get skill metadata.
 */
export const getAllTools = async (): Promise<UnifiedTool[]> => {
  const mcpTools = await fetchMcpTools();
  return [...FUNCTION_TOOLS, ..._forgedTools, ...mcpTools];
};

/**
 * After HITL approval, forge a previously pending network/external tool.
 */
export const approveAndForgeTool = async (forgeId: string): Promise<ToolResult> => {
  const pending = _pendingForgeApprovals.get(forgeId);
  if (!pending) {
    return { content: [{ type: 'text', text: `Unknown forgeId: ${forgeId}` }], isError: true };
  }
  const result = await hybridForgeTool({
    ...pending,
    approved: true,
  });
  if (result.status === 'forged') {
    registerForgedTool(result.tool);
    _pendingForgeApprovals.delete(forgeId);
    return {
      content: [{ type: 'text', text: `Forged ${result.tool.name} → ${result.path}` }],
      isError: false,
      metadata: { toolName: result.tool.name, path: result.path },
    };
  }
  if (result.status === 'needs_approval') {
    return { content: [{ type: 'text', text: 'Still requires approval' }], isError: true };
  }
  return { content: [{ type: 'text', text: result.error }], isError: true };
};

/** Find a tool by exact name (local or namespaced MCP name). */
export const getTool = async (name: string): Promise<UnifiedTool | undefined> => {
  const all = await getAllTools();
  return all.find((t) => t.name === name);
};

/**
 * Call any tool by name, regardless of source.
 * MCP tools are routed through the shell server.
 * Local function tools are called directly.
 */
export const callTool = async (
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> => {
  const tool = await getTool(name);
  if (!tool) {
    return { content: [{ type: 'text', text: `Tool "${name}" not found` }], isError: true };
  }
  if (!tool.execute) {
    return { content: [{ type: 'text', text: `Tool "${name}" is metadata-only (no executor)` }], isError: true };
  }
  try {
    return await tool.execute(args);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Tool "${name}" threw: ${msg}` }], isError: true };
  }
};

/**
 * Format all available tools as a compact list for LLM prompt injection.
 * Grouped by source so the LLM understands what's local vs MCP.
 */
export const formatToolsForPrompt = async (): Promise<string> => {
  const tools = await getAllTools();
  if (tools.length === 0) return '';

  const bySource: Record<ToolSource, UnifiedTool[]> = { function: [], mcp: [], skill: [] };
  for (const t of tools) bySource[t.source].push(t);

  const lines: string[] = ['\nAVAILABLE TOOLS:'];

  if (bySource.function.length > 0) {
    lines.push('  Built-in:');
    for (const t of bySource.function) lines.push(`    • ${t.name}: ${t.description}`);
  }

  if (bySource.mcp.length > 0) {
    // Group MCP tools by server
    const byServer: Record<string, UnifiedTool[]> = {};
    for (const t of bySource.mcp) {
      const s = t.serverName ?? 'unknown';
      (byServer[s] ??= []).push(t);
    }
    for (const [server, serverTools] of Object.entries(byServer)) {
      lines.push(`  MCP / ${server}:`);
      for (const t of serverTools) {
        // Strip the "serverName__" prefix for readability
        const shortName = t.name.includes('__') ? t.name.split('__').slice(1).join('__') : t.name;
        lines.push(`    • ${shortName}: ${t.description.replace(/^\[.*?\] /, '')}`);
      }
    }
  }

  return lines.join('\n') + '\n';
};

/**
 * Format relevant skill docs as instructional context for an LLM prompt.
 * Pass skillIds to inject specific skills, or omit to inject all.
 */
export const formatSkillsForPrompt = async (skillIds?: string[]): Promise<string> => {
  const skills = await loadSkills();
  const filtered = skillIds ? skills.filter((s) => skillIds.includes(s.id)) : skills;
  if (filtered.length === 0) return '';

  const parts = filtered.map((s) =>
    `--- SKILL: ${s.name} ---\n${s.description}\n\n${s.content.replace(/^---[\s\S]*?---\n/, '').trim()}`
  );
  return '\nSKILL CONTEXT:\n' + parts.join('\n\n') + '\n';
};
