/**
 * After repeated shell repair failures, propose a forged session-local tool.
 */
import { routeGeminiText } from './modelRouter';
import { classifyForgeDraft, hybridForgeTool } from './toolForge';
import type { ForgeDraft } from './types';
import type { UnifiedTool } from '../toolRegistry';

export function shouldProposeForgeAfterRepair(args: {
  repairSucceeded: boolean;
  repairAttempts: number;
  alreadyForgedThisGoal?: boolean;
}): boolean {
  if (args.repairSucceeded) return false;
  if (args.alreadyForgedThisGoal) return false;
  return args.repairAttempts >= 2;
}

export async function proposeForgeScript(args: {
  goal: string;
  error: string;
  sessionDir: string;
}): Promise<ForgeDraft> {
  const prompt = `You write a short Python 3 script that fixes a media/ffmpeg problem in a session directory.
SESSION DIR: ${args.sessionDir}
GOAL: ${args.goal.slice(0, 500)}
ERROR: ${args.error.slice(0, 800)}

Rules:
- Stay inside the session directory only (use absolute paths under SESSION DIR).
- Prefer subprocess + ffmpeg/ffprobe. No network, no pip install.
- Print useful stdout. Exit non-zero on failure.
- Return ONLY JSON: {"name":"snake_case","description":"...","code":"..."}`;

  try {
    const { content } = await routeGeminiText({
      prompt,
      role: 'worker',
      temperature: 0.2,
      json: true,
    });
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('no json');
    const parsed = JSON.parse(match[0]) as { name?: string; description?: string; code?: string };
    return classifyForgeDraft({
      name: String(parsed.name || 'shell_repair_fix').slice(0, 48),
      description: String(parsed.description || args.goal).slice(0, 400),
      code: String(parsed.code || ''),
    });
  } catch {
    // Deterministic minimal ffmpeg probe helper as last resort
    const code = `#!/usr/bin/env python3
import os, subprocess, sys
session = ${JSON.stringify(args.sessionDir)}
os.chdir(session)
# List media files and probe first mp4
files = [f for f in os.listdir(session) if f.endswith((".mp4", ".wav", ".png", ".jpg"))]
print("files:", files[:20])
mp4s = [f for f in files if f.endswith(".mp4")]
if not mp4s:
    print("No mp4 found", file=sys.stderr)
    sys.exit(1)
target = os.path.join(session, mp4s[0])
r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", target], capture_output=True, text=True)
print(r.stdout or r.stderr)
sys.exit(0 if r.returncode == 0 else 1)
`;
    return classifyForgeDraft({
      name: 'probe_session_media',
      description: 'Probe session media after repair failure',
      code,
    });
  }
}

export async function forgeAndRegisterRepairTool(args: {
  draft: ForgeDraft;
  sessionDir: string;
  approved?: boolean;
}): Promise<
  | { status: 'forged'; tool: UnifiedTool; path: string }
  | { status: 'needs_approval'; draft: ForgeDraft }
  | { status: 'error'; error: string }
> {
  const result = await hybridForgeTool({
    name: args.draft.name,
    description: args.draft.description,
    code: args.draft.code,
    sessionDir: args.sessionDir,
    approved: args.approved,
  });
  if (result.status === 'forged') {
    const { registerForgedTool } = await import('../toolRegistry');
    registerForgedTool(result.tool);
    return result;
  }
  if (result.status === 'needs_approval') return result;
  return { status: 'error', error: result.error };
}
