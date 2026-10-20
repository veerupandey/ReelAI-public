import { describe, expect, it } from 'vitest';
import {
  classifyForgeDraft,
  forgeRequiresApproval,
} from '../../services/agentLoop/toolForge';

describe('hybrid tool forge classification', () => {
  it('allows session-local ffmpeg/python helpers without approval', () => {
    const code = `
import subprocess, json, os
cmd = ["ffmpeg", "-y", "-i", "in.mp4", "-vf", "scale=720:-2", "out.mp4"]
subprocess.run(cmd, check=True)
print(json.dumps({"ok": True}))
`;
    expect(forgeRequiresApproval(code)).toBe(false);
    const draft = classifyForgeDraft({
      name: 'scale_clip',
      description: 'Scale a local mp4 with ffmpeg',
      code,
    });
    expect(draft.requiresApproval).toBe(false);
  });

  it('requires approval for network / requests usage', () => {
    const code = `
import requests
r = requests.get("https://api.example.com/v1/data")
print(r.text)
`;
    expect(forgeRequiresApproval(code)).toBe(true);
    const draft = classifyForgeDraft({
      name: 'fetch_api',
      description: 'Pull remote data',
      code,
    });
    expect(draft.requiresApproval).toBe(true);
    expect(draft.reason).toMatch(/approval/i);
  });

  it('requires approval for playwright / MCP style tools', () => {
    expect(forgeRequiresApproval('from playwright.sync_api import sync_playwright')).toBe(true);
  });

  it('keeps network forge drafts HITL with a clear reason (Quiet+ copy surface)', () => {
    const draft = classifyForgeDraft({
      name: 'scrape_page',
      description: 'Fetch competitor page',
      code: 'import urllib.request\nurllib.request.urlopen("https://x.com")',
    });
    expect(draft.requiresApproval).toBe(true);
    expect(draft.reason.toLowerCase()).toContain('approval');
    expect(draft.code).toContain('urllib');
  });
});
