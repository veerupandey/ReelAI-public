/**
 * Agent Director — capability-aware tool loop.
 *
 * Discovers what the runtime can do (shell, python, ffmpeg helpers, MCP, skills)
 * and runs a bounded ReAct-style loop so the ad agent can solve open-ended asks
 * by actually invoking tools / writing short scripts — not only fixed pipeline steps.
 */
import { GoogleGenAI } from '@google/genai';
import {
  callTool,
  formatSkillsForPrompt,
  formatToolsForPrompt,
  getAllTools,
  loadSkills,
  type ToolResult,
  type UnifiedTool,
} from './toolRegistry';
import { isShellServerRunning } from './shellToolService';
import { isSafeRepairPayload } from './agentShellRepair';
import { getSiliconFlowHealth } from './siliconflow/client';

export interface CapabilitySnapshot {
  shellOnline: boolean;
  siliconflowConfigured: boolean;
  tools: UnifiedTool[];
  skillNames: string[];
  markdown: string;
}

export interface DirectorStep {
  thought: string;
  tool?: string;
  args?: Record<string, unknown>;
  resultText?: string;
  isError?: boolean;
}

export interface DirectorRunResult {
  ok: boolean;
  summary: string;
  steps: DirectorStep[];
  finalAnswer: string;
}

export type DirectorLog = (message: string) => void;
export type DirectorOut = (markdown: string, label?: string) => void;

function getApiKey(): string {
  return (
    (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_API_KEY || import.meta.env?.GEMINI_API_KEY))
    || (typeof process !== 'undefined' ? (process.env.GEMINI_API_KEY || process.env.VITE_API_KEY || '') : '')
    || ''
  ).trim();
}

const PIPELINE_CAPABILITIES = `
AD PIPELINE CAPABILITIES (built-in phases — prefer these for production asks):
- Loop runtime: goal card + Kimi task plan (recreate-reference / standard / open-ended)
- Research product URL / packshot lock
- Plan scenes with continuity + Live Motion / Ken Burns per scene
- Generate stills (Gemini image) in parallel
- Wan Live Motion (I2V) — paid; serial; say "use live motion"
- Voiceover TTS — change voice via feedback ("regen audio with Gen Z female")
- Assemble video (ffmpeg Ken Burns / Live Motion clips + captions + platform export)
- Selective redo at end (model/dress/voice/live motion) without full re-run
- Shell repair: on ffmpeg failure, propose+run a short python/shell fix in-session
- forge_tool: create session Python tools (network/MCP tools need human approval)
`.trim();

/** Discover live resources and format a human + LLM-facing capability card. */
export async function discoverAgentCapabilities(): Promise<CapabilitySnapshot> {
  const [shellOnline, sf, tools, skills] = await Promise.all([
    isShellServerRunning(),
    getSiliconFlowHealth(),
    getAllTools(),
    loadSkills(),
  ]);

  const bySource = {
    function: tools.filter((t) => t.source === 'function'),
    mcp: tools.filter((t) => t.source === 'mcp'),
  };
  const mcpServers = [...new Set(bySource.mcp.map((t) => t.serverName || 'mcp'))];

  const markdown = [
    '## Agent capabilities',
    '',
    `**Shell server:** ${shellOnline ? 'online (:3721)' : 'offline — start with `npm run agent:server`'}`,
    `**SiliconFlow (Wan / Kimi):** ${sf.siliconflowConfigured ? 'configured' : 'not configured'}`,
    `**Callable tools:** ${tools.length} (${bySource.function.length} built-in · ${bySource.mcp.length} MCP)`,
    mcpServers.length ? `**MCP servers:** ${mcpServers.join(', ')}` : '**MCP servers:** none connected',
    `**Skills loaded:** ${skills.length ? skills.map((s) => s.name).join(', ') : 'none'}`,
    '',
    '### Built-in tools',
    ...bySource.function.map((t) => `- \`${t.name}\` — ${t.description.slice(0, 120)}`),
    bySource.mcp.length ? '### MCP tools (sample)' : '',
    ...bySource.mcp.slice(0, 12).map((t) => `- \`${t.name}\` — ${t.description.replace(/^\[.*?\]\s*/, '').slice(0, 100)}`),
    bySource.mcp.length > 12 ? `- … +${bySource.mcp.length - 12} more` : '',
    '',
    '### Pipeline',
    PIPELINE_CAPABILITIES,
  ].filter(Boolean).join('\n');

  return {
    shellOnline,
    siliconflowConfigured: sf.siliconflowConfigured,
    tools,
    skillNames: skills.map((s) => s.name),
    markdown,
  };
}

function toolResultToText(result: ToolResult): string {
  return result.content
    .map((c) => c.text || (c.url ? `[${c.type}: ${c.url.slice(0, 80)}]` : ''))
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);
}

function sanitizeToolArgs(
  toolName: string,
  args: Record<string, unknown>,
  sessionDir: string,
): { ok: true; args: Record<string, unknown> } | { ok: false; reason: string } {
  const next = { ...args };

  // Always pin sessionDir for local runners
  if (toolName === 'shell_exec' || toolName === 'python_exec'
    || toolName.startsWith('ffmpeg_') || toolName === 'platform_export') {
    next.sessionDir = sessionDir;
  }

  if (toolName === 'shell_exec') {
    const command = String(next.command || '');
    const safety = isSafeRepairPayload('shell_exec', command, sessionDir);
    if (safety.ok === false) return { ok: false, reason: safety.reason };
  }
  if (toolName === 'python_exec') {
    const code = String(next.code || '');
    const safety = isSafeRepairPayload('python_exec', code, sessionDir);
    if (safety.ok === false) return { ok: false, reason: safety.reason };
  }

  return { ok: true, args: next };
}

/**
 * True when feedback looks like an open-ended ops ask (scripts / inspect / fix)
 * rather than a selective visual/voice redo the pipeline already handles.
 */
export function looksLikeOpenEndedAgentAsk(feedback: string): boolean {
  const f = (feedback || '').trim();
  if (!f) return false;
  // Known selective redo intents — leave to pipeline
  if (/\b(live\s*motion|change the model|different dress|regen(?:erate)?\s+(audio|vo|voice)|switch voice|warmer lighting|keep vo)\b/i.test(f)
    && !/\b(script|ffmpeg|shell|python|inspect|debug|fix|run |write a|session dir|list files)\b/i.test(f)) {
    return false;
  }
  return /\b(run |script|ffmpeg|ffprobe|python|shell|inspect|debug|fix|repair|list files|session|probe|download|convert|trim|loudnorm|normalize audio|check (the )?(files|clips|audio))\b/i.test(f)
    || /\b(what can you do|available tools|capabilities)\b/i.test(f)
    || f.length > 180; // long freeform asks often need tool use
}

/**
 * Bounded tool-calling loop. The model must return JSON each turn:
 * { "thought": "...", "action": "tool_name"|null, "args": {}, "final": "..."|null }
 * Stop when final is set or maxSteps reached.
 */
export async function runAgentDirector(args: {
  goal: string;
  sessionDir: string;
  context?: string;
  maxSteps?: number;
  allowedTools?: string[];
  /** Disk skill folder ids under skills/ to inject. Defaults to ad-pipeline set. */
  skillIds?: string[];
  log?: DirectorLog;
  out?: DirectorOut;
}): Promise<DirectorRunResult> {
  const key = getApiKey();
  const maxSteps = Math.min(8, Math.max(1, args.maxSteps ?? 5));
  const steps: DirectorStep[] = [];

  if (!key) {
    return {
      ok: false,
      summary: 'No Gemini API key — cannot run director loop.',
      steps,
      finalAnswer: 'Director unavailable (missing API key).',
    };
  }

  const caps = await discoverAgentCapabilities();
  if (!caps.shellOnline) {
    args.log?.('Shell offline — director can reason but shell/python/MCP tools will fail until `npm run agent:server`.');
  }

  const toolsPrompt = await formatToolsForPrompt();
  const defaultSkills = [
    'video-assembly', 'voiceover-production', 'platform-export', 'caption-design',
  ];
  const skillsPrompt = await formatSkillsForPrompt(
    (args.skillIds?.length ? args.skillIds : defaultSkills).filter(Boolean),
  );

  const allow = args.allowedTools?.length
    ? new Set(args.allowedTools)
    : null;

  const catalog = (await getAllTools())
    .filter((t) => !allow || allow.has(t.name) || allow.has(t.name.split('__').slice(1).join('__')))
    .map((t) => {
      const props = Object.keys(t.inputSchema.properties || {}).join(', ');
      return `- ${t.name}(${props}): ${t.description.slice(0, 160)}`;
    })
    .join('\n');

  const ai = new GoogleGenAI({ apiKey: key });
  const transcript: string[] = [];

  const system = `You are the ReelAI Agent Director. You have a real tool runtime (shell, python, ffmpeg helpers, MCP).
You solve the USER GOAL by calling tools when needed. Prefer short scripts over speculation.

SESSION DIR (all file ops must stay here): ${args.sessionDir}

${PIPELINE_CAPABILITIES}

${toolsPrompt}
${skillsPrompt}

CALLABLE TOOL CATALOG:
${catalog}

RULES:
- Return ONLY JSON each turn (no markdown fences):
  {"thought":"<brief>","action":"<tool name or null>","args":{...},"final":"<answer when done, else null>"}
- When action is set, args must match that tool. For shell_exec/python_exec, keep paths under the session dir.
- Prefer python_exec for multi-step media math; shell_exec for one ffmpeg/ffprobe/cp.
- Never sudo, never network exfil, never touch files outside the session dir.
- If the goal is only asking what you can do, set action=null and put the capability summary in final.
- Stop when the goal is satisfied; put a concise result in final.`;

  let finalAnswer = '';
  for (let i = 0; i < maxSteps; i++) {
    const userTurn = [
      `USER GOAL: ${args.goal}`,
      args.context ? `CONTEXT:\n${args.context.slice(0, 3000)}` : '',
      transcript.length ? `PRIOR STEPS:\n${transcript.join('\n\n')}` : '',
      `Step ${i + 1}/${maxSteps}. Decide next action or finish.`,
    ].filter(Boolean).join('\n\n');

    let raw = '';
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: [{ parts: [{ text: `${system}\n\n${userTurn}` }] }],
        config: { maxOutputTokens: 2048, responseMimeType: 'application/json' },
      });
      raw = (response.candidates?.[0]?.content?.parts || [])
        .map((p: { text?: string }) => p.text || '')
        .join('')
        .trim();
    } catch (err: any) {
      return {
        ok: false,
        summary: `Director LLM failed: ${err?.message || err}`,
        steps,
        finalAnswer: '',
      };
    }

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      steps.push({ thought: 'Invalid director response (no JSON)', resultText: raw.slice(0, 400), isError: true });
      break;
    }

    let parsed: {
      thought?: string;
      action?: string | null;
      args?: Record<string, unknown>;
      final?: string | null;
    };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      steps.push({ thought: 'Invalid JSON from director', resultText: match[0].slice(0, 400), isError: true });
      break;
    }

    const thought = String(parsed.thought || '').slice(0, 400);
    const action = parsed.action ? String(parsed.action).trim() : '';
    const maybeFinal = parsed.final != null ? String(parsed.final).trim() : '';

    if (!action && maybeFinal) {
      finalAnswer = maybeFinal;
      steps.push({ thought, resultText: maybeFinal });
      args.log?.(`Director done: ${maybeFinal.slice(0, 120)}`);
      break;
    }

    if (!action) {
      finalAnswer = maybeFinal || thought || 'No further action.';
      steps.push({ thought, resultText: finalAnswer });
      break;
    }

    // Resolve MCP short names → namespaced
    let toolName = action;
    const all = await getAllTools();
    if (!all.some((t) => t.name === toolName)) {
      const hit = all.find((t) => t.name.endsWith(`__${action}`) || t.name === action);
      if (hit) toolName = hit.name;
    }

    args.log?.(`Director → ${toolName}`);
    const sanitized = sanitizeToolArgs(toolName, parsed.args || {}, args.sessionDir);
    if (sanitized.ok === false) {
      const msg = `Blocked unsafe tool call: ${sanitized.reason}`;
      steps.push({ thought, tool: toolName, args: parsed.args, resultText: msg, isError: true });
      transcript.push(`Thought: ${thought}\nAction: ${toolName}\nResult ERROR: ${msg}`);
      continue;
    }

    const result = await callTool(toolName, sanitized.args);
    const text = toolResultToText(result);
    steps.push({
      thought,
      tool: toolName,
      args: sanitized.args,
      resultText: text,
      isError: result.isError,
    });
    transcript.push(
      `Thought: ${thought}\nAction: ${toolName}\nArgs: ${JSON.stringify(sanitized.args).slice(0, 500)}\nResult${result.isError ? ' ERROR' : ''}: ${text.slice(0, 1500)}`,
    );
    args.out?.(
      `**${toolName}**${result.isError ? ' (error)' : ''}\n\n\`\`\`\n${text.slice(0, 1200)}\n\`\`\``,
      `Director step ${i + 1}`,
    );

    if (maybeFinal && !result.isError) {
      finalAnswer = maybeFinal;
      break;
    }
  }

  if (!finalAnswer) {
    finalAnswer = steps.filter((s) => s.resultText).map((s) => s.resultText).slice(-1)[0]
      || 'Director finished without a final answer.';
  }

  return {
    ok: !steps.some((s) => s.isError && s.tool),
    summary: `Director ran ${steps.length} step(s).`,
    steps,
    finalAnswer,
  };
}
