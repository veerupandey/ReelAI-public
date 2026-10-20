/**
 * On-demand shell / Python repair for the ad agent.
 * When ffmpeg/media steps fail, Gemini proposes a short fix script and we run it
 * via the agent shell (session-scoped). Bounded + allowlisted for safety.
 */
import { GoogleGenAI } from '@google/genai';
import { callTool } from './toolRegistry';

export type ShellRepairTool = 'python_exec' | 'shell_exec';

export interface ShellRepairProposal {
  tool: ShellRepairTool;
  /** Python source (python_exec) or bash command (shell_exec) */
  payload: string;
  rationale: string;
}

export interface ShellRepairAttempt {
  proposal: ShellRepairProposal;
  ok: boolean;
  output: string;
}

export interface ShellRepairResult {
  attempted: boolean;
  success: boolean;
  attempts: ShellRepairAttempt[];
  summary: string;
}

const FORBIDDEN = [
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*|--force).*(\/|~)/i,
  /\bcurl\b|\bwget\b|\bnc\b|\bnmap\b/i,
  /\bssh\b|\bscp\b|\bsudo\b/i,
  /\/etc\/|\/System\/|\/Users\/(?!.*reelai)/i,
  /\beval\s*\(|\bexec\s*\(|__import__\s*\(\s*['"]os['"]/i,
];

function getApiKey(): string {
  return (
    (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_API_KEY || import.meta.env?.GEMINI_API_KEY))
    || (typeof process !== 'undefined' ? (process.env.GEMINI_API_KEY || process.env.VITE_API_KEY || '') : '')
    || ''
  ).trim();
}

/** Reject clearly dangerous payloads. Session path must appear for shell commands that write files. */
export function isSafeRepairPayload(
  tool: ShellRepairTool,
  payload: string,
  sessionDir: string,
): { ok: true } | { ok: false; reason: string } {
  const text = (payload || '').trim();
  if (!text || text.length > 12_000) {
    return { ok: false, reason: 'payload empty or too large' };
  }
  for (const re of FORBIDDEN) {
    if (re.test(text)) return { ok: false, reason: `blocked pattern: ${re}` };
  }
  if (tool === 'shell_exec') {
    // Keep shell ops inside the session tree when touching files.
    if (/\b(mv|cp|ffmpeg|ffprobe|python3?)\b/i.test(text) && !text.includes(sessionDir)) {
      return { ok: false, reason: 'shell command must reference sessionDir for file ops' };
    }
  }
  return { ok: true };
}

async function proposeRepair(args: {
  goal: string;
  error: string;
  sessionDir: string;
  contextFiles?: string[];
  priorAttempts?: string[];
}): Promise<ShellRepairProposal | null> {
  const key = getApiKey();
  if (!key) return null;

  const ai = new GoogleGenAI({ apiKey: key });
  const prompt = `You are a media-pipeline repair assistant. A video ad agent failed a local step.
Propose ONE short fix using either Python 3 or a bash command, runnable in the session directory.

SESSION DIR (all file I/O must stay here): ${args.sessionDir}
GOAL: ${args.goal}
ERROR:
${args.error.slice(0, 1200)}
${args.contextFiles?.length ? `KNOWN FILES:\n${args.contextFiles.slice(0, 20).map((f) => `- ${f}`).join('\n')}` : ''}
${args.priorAttempts?.length ? `PRIOR ATTEMPTS (do not repeat):\n${args.priorAttempts.join('\n---\n')}` : ''}

Constraints:
- Prefer python_exec for image/audio math (PIL, wave, json, pathlib, subprocess for ffmpeg).
- Prefer shell_exec for a single ffmpeg/ffprobe/cp fix.
- Do not use network, sudo, or delete outside the session dir.
- Paths must be absolute under the session dir.
- Keep payload under 80 lines.

Return ONLY JSON:
{ "tool": "python_exec" | "shell_exec", "payload": "<code or command>", "rationale": "<one sentence>" }`;

  try {
    const res = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [{ parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json' },
    });
    const text = (res.candidates?.[0]?.content?.parts || [])
      .map((p: any) => p.text || '')
      .join('')
      .trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Partial<ShellRepairProposal>;
    const tool = parsed.tool === 'shell_exec' ? 'shell_exec' : 'python_exec';
    const payload = String(parsed.payload || '').trim();
    if (!payload) return null;
    return {
      tool,
      payload,
      rationale: String(parsed.rationale || 'Attempt shell repair').slice(0, 240),
    };
  } catch {
    return null;
  }
}

async function executeProposal(
  proposal: ShellRepairProposal,
  sessionDir: string,
): Promise<{ ok: boolean; output: string }> {
  const safety = isSafeRepairPayload(proposal.tool, proposal.payload, sessionDir);
  if (!safety.ok) {
    return { ok: false, output: `Rejected unsafe repair: ${safety.reason}` };
  }

  if (proposal.tool === 'python_exec') {
    const result = await callTool('python_exec', {
      code: proposal.payload,
      sessionDir,
      filename: `repair_${Date.now()}.py`,
    });
    const output = result.content.map((c) => c.text || '').join('\n').trim();
    return { ok: !result.isError, output: output.slice(0, 2000) };
  }

  const result = await callTool('shell_exec', {
    command: proposal.payload,
    sessionDir,
  });
  const output = result.content.map((c) => c.text || '').join('\n').trim();
  return { ok: !result.isError, output: output.slice(0, 2000) };
}

/**
 * Up to `maxAttempts` propose→run cycles. Caller should re-check success condition after.
 */
export async function attemptShellRepair(args: {
  goal: string;
  error: string;
  sessionDir: string;
  contextFiles?: string[];
  maxAttempts?: number;
  /** Optional: return true if the failure is already fixed (e.g. output file exists). */
  verify?: () => Promise<boolean>;
}): Promise<ShellRepairResult> {
  const maxAttempts = Math.max(1, Math.min(args.maxAttempts ?? 2, 3));
  const attempts: ShellRepairAttempt[] = [];
  const prior: string[] = [];

  for (let i = 0; i < maxAttempts; i++) {
    if (args.verify && (await args.verify())) {
      return {
        attempted: attempts.length > 0,
        success: true,
        attempts,
        summary: 'Verified success before/without further repair.',
      };
    }

    const proposal = await proposeRepair({
      goal: args.goal,
      error: args.error,
      sessionDir: args.sessionDir,
      contextFiles: args.contextFiles,
      priorAttempts: prior,
    });
    if (!proposal) {
      return {
        attempted: attempts.length > 0,
        success: false,
        attempts,
        summary: 'Could not propose a shell/Python repair (no API key or empty proposal).',
      };
    }

    prior.push(`${proposal.tool}: ${proposal.payload.slice(0, 400)}`);
    const exec = await executeProposal(proposal, args.sessionDir);
    attempts.push({ proposal, ok: exec.ok, output: exec.output });

    const verified = args.verify ? await args.verify() : exec.ok;
    if (verified) {
      return {
        attempted: true,
        success: true,
        attempts,
        summary: `Repair succeeded via ${proposal.tool}: ${proposal.rationale}`,
      };
    }
  }

  return {
    attempted: attempts.length > 0,
    success: false,
    attempts,
    summary: `Repair failed after ${attempts.length} attempt(s). Last: ${attempts[attempts.length - 1]?.output.slice(0, 200) || 'n/a'}`,
  };
}
