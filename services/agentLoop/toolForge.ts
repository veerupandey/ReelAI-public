/**
 * Hybrid tool forge:
 * - Auto: session-local python tools (no network) → compile + register for this run
 * - HITL: network / MCP / external → draft + require approval
 */
import { SHELL_SERVER } from '../shellToolService';
import type { ToolResult, UnifiedTool } from '../toolRegistry';
import type { ForgeDraft } from './types';

const NETWORKISH_RE =
  /\b(requests\.|urllib|httpx|aiohttp|socket\.|ftp|paramiko|subprocess\.check_output\(\s*['\"]curl|wget\b|playwright|selenium|mcp)\b/i;

export function forgeRequiresApproval(code: string, description = ''): boolean {
  const blob = `${code}\n${description}`;
  return NETWORKISH_RE.test(blob)
    || /\b(https?:\/\/|api[_-]?key|Authorization)\b/i.test(blob);
}

export function classifyForgeDraft(args: {
  name: string;
  description: string;
  code: string;
}): ForgeDraft {
  const requiresApproval = forgeRequiresApproval(args.code, args.description);
  return {
    forgeId: `forge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: args.name.replace(/[^\w-]/g, '_').slice(0, 64),
    description: args.description.slice(0, 500),
    code: args.code,
    requiresApproval,
    reason: requiresApproval
      ? 'Uses network/MCP/external capabilities — human approval required'
      : 'Session-local script — auto-forge allowed',
  };
}

export async function forgeToolOnServer(args: {
  name: string;
  description: string;
  code: string;
  sessionDir: string;
}): Promise<{ ok: boolean; path?: string; error?: string; valid?: boolean }> {
  try {
    const res = await fetch(`${SHELL_SERVER}/forge/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: args.name,
        description: args.description,
        code: args.code,
        sessionDir: args.sessionDir,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json() as {
      ok?: boolean;
      path?: string;
      error?: string;
      valid?: boolean;
    };
    return {
      ok: Boolean(data.ok && data.valid !== false),
      path: data.path,
      error: data.error,
      valid: data.valid,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/** Register a forged python tool as a callable UnifiedTool for this run. */
export function buildForgedPythonTool(args: {
  name: string;
  description: string;
  scriptPath: string;
  sessionDir: string;
}): UnifiedTool {
  const toolName = `forged_${args.name}`;
  return {
    name: toolName,
    description: `[forged] ${args.description}`,
    source: 'function',
    inputSchema: {
      type: 'object',
      properties: {
        args_json: {
          type: 'string',
          description: 'Optional JSON string of args passed to the script via env FORGE_ARGS',
        },
        sessionDir: { type: 'string', description: 'Session directory' },
      },
      required: [],
    },
    execute: async (input): Promise<ToolResult> => {
      const { runPython } = await import('../shellToolService');
      const sessionDir = String(input.sessionDir || args.sessionDir);
      const wrapper = `
import json, os, runpy, sys
os.environ["FORGE_ARGS"] = ${JSON.stringify(String(input.args_json || '{}'))}
sys.argv = [${JSON.stringify(args.scriptPath)}]
runpy.run_path(${JSON.stringify(args.scriptPath)}, run_name="__main__")
`;
      const result = await runPython(wrapper, sessionDir, `run_forged_${args.name}.py`);
      return {
        content: [{
          type: 'text',
          text: [result.stdout, result.stderr].filter(Boolean).join('\n') || '(no output)',
        }],
        isError: !result.ok,
        metadata: { exitCode: result.exitCode, artifacts: result.artifacts, scriptPath: args.scriptPath },
      };
    },
  };
}

/**
 * Hybrid entry: auto-forge safe tools; return draft for HITL otherwise.
 */
export async function hybridForgeTool(args: {
  name: string;
  description: string;
  code: string;
  sessionDir: string;
  approved?: boolean;
}): Promise<
  | { status: 'forged'; tool: UnifiedTool; path: string }
  | { status: 'needs_approval'; draft: ForgeDraft }
  | { status: 'error'; error: string; draft: ForgeDraft }
> {
  const draft = classifyForgeDraft(args);
  if (draft.requiresApproval && !args.approved) {
    return { status: 'needs_approval', draft };
  }

  const forged = await forgeToolOnServer({
    name: draft.name,
    description: draft.description,
    code: draft.code,
    sessionDir: args.sessionDir,
  });
  if (!forged.ok || !forged.path) {
    return {
      status: 'error',
      error: forged.error || 'Forge failed',
      draft,
    };
  }

  const tool = buildForgedPythonTool({
    name: draft.name,
    description: draft.description,
    scriptPath: forged.path,
    sessionDir: args.sessionDir,
  });
  return { status: 'forged', tool, path: forged.path };
}
