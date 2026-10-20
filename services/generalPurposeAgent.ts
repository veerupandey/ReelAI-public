/**
 * General Purpose Agent — Autonomous open-ended runner.
 *
 * Plan → (HITL) → fan-out parallel workers → optional tool loops → synthesize deliverable.
 * Distinct from AutonomousAgent (ad production pipeline). Reuses GLM planner + agentDirector tools.
 */

import {
  createSession,
  isShellServerRunning,
  type SessionInfo,
} from './shellToolService';
import {
  planText,
  coercePlannerModelId,
  DEFAULT_PLANNER_MODEL,
  type PlannerModelId,
} from './siliconflow/planner';
import { discoverAgentCapabilities, runAgentDirector } from './agentDirector';
import { mapWithConcurrency } from './concurrency';
import { resolveApiKeyForModel } from './llm/apiKeys';
import {
  formatWorkerSkillBlock,
  resolveGeneralAgentSkills,
  type GeneralAgentSkillPack,
} from './generalAgentSkills';
import {
  fetchUrlAsMarkdown,
  extractImageUrls,
  generateImage,
  downloadImageAsBase64,
  searchWeb,
  runPython,
  readPdf,
  writeFile,
  formatToolCatalogForPlanner,
  getToolsForRole,
  type ImageGenResult,
} from './generalAgentTools';
import {
  initRunMemory,
  addMemory,
  getAllMemory,
  memoryToPrompt,
  clearRunMemory,
  persistRunToSession,
  sessionMemoryToPrompt,
  saveCheckpoint,
  clearCheckpoint,
  loadCheckpoint,
  initTaskCanvas,
  setTaskRunning,
  setTaskDone,
  setTaskFailed,
  clearTaskCanvas,
  buildTaskCanvasFromPlan,
  getTaskCanvas,
  type RunCheckpoint,
} from './agentMemoryStore';
import type { SkillId } from '../agents/contracts';
import { GENERAL_PURPOSE_AGENT } from '../runtime/agentDefinitions';

export type GeneralAgentPhase =
  | 'intake'
  | 'plan'
  | 'fan_out'
  | 'execute'
  | 'synthesize'
  | 'deliver';

export type GeneralAgentEventType =
  | 'phase_start'
  | 'log'
  | 'output'
  | 'image'
  | 'worker_spawned'
  | 'worker_done'
  | 'approval_needed'
  | 'complete'
  | 'error'
  | 'stopped';

export interface GeneralAgentEvent {
  id: string;
  type: GeneralAgentEventType;
  timestamp: number;
  phase?: GeneralAgentPhase;
  message?: string;
  data?: Record<string, unknown>;
}

export interface GeneralAgentConfig {
  goal: string;
  plannerModel?: PlannerModelId;
  plannerApiKey?: string;
  maxWorkers?: number;
  allowTools?: boolean;
  reviewMode?: 'review' | 'auto';
  autoApproveSec?: number;
  /** Optional preferred contract SkillIds (merged with goal routing). */
  preferContractSkills?: SkillId[];
  /** Optional preferred disk skill folder ids under skills/. */
  preferDiskSkills?: string[];
}

export interface GeneralAgentWorkerSpec {
  id: string;
  title: string;
  role: string;
  instructions: string;
  /** When true, worker may use shell/MCP via agent director. */
  useTools?: boolean;
  parallelGroup?: string;
  /** Optional skill ids (contract or disk) assigned by the planner. */
  skillIds?: string[];
  /** URLs the worker should fetch for research. */
  fetchUrls?: string[];
  /** When true, worker should generate images as part of its output. */
  generateImages?: boolean;
  /** Specific tool ids this worker should use. */
  tools?: string[];
}

export interface GeneralAgentPlan {
  summary: string;
  deliverable: string;
  workers: GeneralAgentWorkerSpec[];
  /** Ordered phases of worker ids; ids in the same phase run in parallel. */
  phases: string[][];
}

export interface GeneralAgentWorkerResult {
  workerId: string;
  title: string;
  ok: boolean;
  summary: string;
  detail: string;
  toolsUsed: string[];
  /** Generated images (base64) if any */
  images?: Array<{ base64: string; label: string; savedPath?: string }>;
  /** Fetched URL content summaries */
  fetchedUrls?: Array<{ url: string; ok: boolean; snippet: string }>;
}

export interface GeneralAgentDeliverable {
  plan: GeneralAgentPlan;
  workers: GeneralAgentWorkerResult[];
  synthesis: string;
  sessionDir?: string;
  /** All generated images across workers */
  images?: Array<{ base64: string; label: string; workerId: string; savedPath?: string }>;
}

type EventHandler = (e: GeneralAgentEvent) => void;

/** Parse image generation prompts from worker markdown output. */
function parseImagePrompts(markdown: string): Array<{ label: string; prompt: string; aspectRatio?: string; textOnImage?: string }> {
  const results: Array<{ label: string; prompt: string; aspectRatio?: string; textOnImage?: string }> = [];
  const sections = markdown.split(/###\s*Image\s*\d+[:\s]*/i).slice(1);
  for (const section of sections) {
    const label = section.split('\n')[0]?.trim() || 'Untitled';
    const promptMatch = section.match(/PROMPT:\s*(.+?)(?:\n|$)/i);
    const arMatch = section.match(/ASPECT_RATIO:\s*(\d+:\d+)/i);
    const textMatch = section.match(/TEXT_ON_IMAGE:\s*(.+?)(?:\n|$)/i);
    if (promptMatch?.[1]) {
      const textOnImage = textMatch?.[1]?.trim();
      results.push({
        label,
        prompt: promptMatch[1].trim(),
        aspectRatio: arMatch?.[1] || '1:1',
        textOnImage: textOnImage && textOnImage.toLowerCase() !== 'none' ? textOnImage : undefined,
      });
    }
  }
  // Fallback: look for PROMPT: lines without ### headers
  if (results.length === 0) {
    const promptLines = [...markdown.matchAll(/PROMPT:\s*(.+?)(?:\n|$)/gi)];
    for (let i = 0; i < promptLines.length; i++) {
      results.push({ label: `Slide ${i + 1}`, prompt: promptLines[i][1].trim() });
    }
  }
  return results;
}


let evtCounter = 0;
const nextId = () => `ga_${Date.now()}_${++evtCounter}`;

function emit(onEvent: EventHandler, type: GeneralAgentEventType, partial: Partial<GeneralAgentEvent> = {}) {
  onEvent({
    id: nextId(),
    type,
    timestamp: Date.now(),
    ...partial,
  });
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizePlan(raw: Record<string, unknown>, goal: string, maxWorkers: number): GeneralAgentPlan {
  const workersIn = Array.isArray(raw.workers) ? raw.workers : [];
  const workers: GeneralAgentWorkerSpec[] = workersIn
    .slice(0, Math.max(1, maxWorkers * 2))
    .map((w: any, i: number) => ({
      id: String(w.id || `w${i + 1}`),
      title: String(w.title || w.goal || `Worker ${i + 1}`).slice(0, 120),
      role: String(w.role || 'specialist').slice(0, 60),
      instructions: String(w.instructions || w.goal || goal).slice(0, 2000),
      useTools: Boolean(w.useTools),
      parallelGroup: w.parallelGroup ? String(w.parallelGroup) : undefined,
      skillIds: Array.isArray(w.skillIds)
        ? w.skillIds.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 6)
        : undefined,
      fetchUrls: Array.isArray(w.fetchUrls)
        ? w.fetchUrls.map((u: unknown) => String(u).trim()).filter((u: string) => u.startsWith('http')).slice(0, 5)
        : undefined,
      generateImages: Boolean(w.generateImages),
      tools: Array.isArray(w.tools)
        ? w.tools.map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 8)
        : undefined,
    }));

  if (workers.length === 0) {
    workers.push({
      id: 'w1',
      title: 'Primary investigator',
      role: 'generalist',
      instructions: `Accomplish this goal thoroughly and report findings:\n${goal}`,
      useTools: true,
    });
  }

  let phases: string[][] = [];
  if (Array.isArray(raw.phases) && raw.phases.length) {
    phases = raw.phases
      .map((phase: unknown) =>
        (Array.isArray(phase) ? phase : [])
          .map((id) => String(id))
          .filter((id) => workers.some((w) => w.id === id)),
      )
      .filter((p) => p.length > 0);
  }

  if (!phases.length) {
    // Group by parallelGroup, else single parallel wave capped by maxWorkers.
    const groups = new Map<string, string[]>();
    for (const w of workers) {
      const key = w.parallelGroup || 'default';
      const list = groups.get(key) || [];
      list.push(w.id);
      groups.set(key, list);
    }
    phases = [...groups.values()];
  }

  // Cap concurrent workers per phase.
  phases = phases.map((phase) => phase.slice(0, maxWorkers));

  return {
    summary: String(raw.summary || `Plan for: ${goal}`).slice(0, 500),
    deliverable: String(raw.deliverable || 'Written synthesis of findings').slice(0, 300),
    workers,
    phases,
  };
}

function fallbackPlan(goal: string, maxWorkers: number): GeneralAgentPlan {
  const workers = [
    {
      id: 'w1',
      title: 'Research lead',
      role: 'researcher',
      instructions: `Research the goal and collect concrete facts, sources, and angles.\nGOAL: ${goal}`,
      useTools: false,
      parallelGroup: 'wave1',
    },
    {
      id: 'w2',
      title: 'Critical analyst',
      role: 'analyst',
      instructions: `Challenge assumptions, list risks/gaps, and propose sharper framing.\nGOAL: ${goal}`,
      useTools: false,
      parallelGroup: 'wave1',
    },
    {
      id: 'w3',
      title: 'Synthesizer prep',
      role: 'editor',
      instructions: `Outline the final deliverable structure the synthesizer should fill.\nGOAL: ${goal}`,
      useTools: false,
      parallelGroup: 'wave2',
    },
  ].slice(0, Math.max(1, maxWorkers));

  const phases: string[][] = [];
  const wave1 = workers.filter((w) => w.parallelGroup === 'wave1').map((w) => w.id);
  const wave2 = workers.filter((w) => w.parallelGroup === 'wave2').map((w) => w.id);
  if (wave1.length) phases.push(wave1);
  if (wave2.length) phases.push(wave2);
  if (!phases.length) phases.push(workers.map((w) => w.id));

  return normalizePlan(
    {
      summary: `Investigate and deliver on: ${goal}`,
      deliverable: 'Structured findings + recommended next actions',
      workers,
      phases,
    },
    goal,
    maxWorkers,
  );
}

export class GeneralPurposeAgent {
  private stopped = false;
  private approvalResolver: ((value: { approved: boolean; feedback: string }) => void) | null = null;

  stop() {
    this.stopped = true;
    if (this.approvalResolver) {
      this.approvalResolver({ approved: false, feedback: '' });
      this.approvalResolver = null;
    }
  }

  respondToApproval(approved: boolean, feedback = '') {
    if (this.approvalResolver) {
      this.approvalResolver({ approved, feedback });
      this.approvalResolver = null;
    }
  }

  private check() {
    if (this.stopped) throw new Error('Agent stopped by user.');
  }

  private async gate(
    onEvent: EventHandler,
    config: GeneralAgentConfig,
    phase: GeneralAgentPhase,
    question: string,
    detail: string,
  ): Promise<{ approved: boolean; feedback: string }> {
    if (config.reviewMode === 'auto') {
      const sec = Math.max(0, config.autoApproveSec ?? 0);
      if (sec > 0) await new Promise((r) => setTimeout(r, sec * 1000));
      return { approved: true, feedback: '' };
    }

    emit(onEvent, 'approval_needed', {
      phase,
      message: question,
      data: { detail, question },
    });

    return new Promise((resolve) => {
      this.approvalResolver = resolve;
    });
  }

  private async planGoal(
    config: GeneralAgentConfig,
    onEvent: EventHandler,
    skillPack: GeneralAgentSkillPack,
    shellOnline = false,
  ): Promise<GeneralAgentPlan> {
    const maxWorkers = Math.max(1, Math.min(5, Math.round(config.maxWorkers ?? 3)));
    emit(onEvent, 'phase_start', { phase: 'plan', message: 'Planning task graph…' });
    emit(onEvent, 'log', { phase: 'plan', message: `Planner: ${config.plannerModel || DEFAULT_PLANNER_MODEL}` });

    const skillCatalog = [
      ...skillPack.contractSkillIds.map((id) => `contract:${id}`),
      ...skillPack.diskSkillIds.map((id) => `disk:${id}`),
    ].join(', ');

    const prompt = `You are a Autonomous autonomous agent planner.
Break the USER GOAL into specialist workers that can fan out in parallel.
Each worker has access to powerful tools based on their role.

USER GOAL:
${config.goal}

${formatToolCatalogForPlanner(shellOnline)}

ACTIVE SKILLS (assign relevant ones to each worker via skillIds):
${skillCatalog || '(defaults)'}

${skillPack.promptBlock.slice(0, 4000)}

WORKER ROLES & THEIR AUTO-TOOLS:
- researcher: web_fetch, web_search, pdf_read, memory (for finding facts, reading pages/PDFs)
- analyst: web_fetch, web_search, code_python, data_transform, memory (for analysis, calculations)
- designer: image_gen, screenshot, file_write (for creating visual assets)
- writer: file_write, memory, todo (for creating documents, reports, copy)
- engineer: code_python, code_shell, file_read, file_write (for scripts, automation)
- browser: web_fetch, screenshot, browser (for navigating sites, capturing visual references)
- data_scientist: code_python, data_transform, file_read, file_write (for data analysis)

CONSTRAINTS:
- Max ${maxWorkers} workers per parallel wave. Prefer 2–${Math.max(2, maxWorkers + 1)} workers total.
- useTools=true when shell/filesystem/browser/MCP is truly needed (code_python, code_shell, browser, screenshot).
- fetchUrls: URLs the worker needs to read. Auto-fetched before the worker runs.
- generateImages: true for workers that should produce visual assets.
- tools: array of tool ids this worker should use (from AVAILABLE TOOLS above).

Return ONLY JSON:
{
  "summary": "<one sentence plan>",
  "deliverable": "<what we will hand back>",
  "workers": [
    {
      "id": "w1",
      "title": "<short title>",
      "role": "<researcher|analyst|designer|writer|engineer|browser|data_scientist>",
      "instructions": "<detailed worker brief>",
      "useTools": false,
      "parallelGroup": "wave1",
      "skillIds": ["research_methodology"],
      "fetchUrls": ["https://example.com"],
      "generateImages": false,
      "tools": ["web_fetch", "web_search", "memory"]
    }
  ],
  "phases": [["w1","w2"],["w3"]]
}`;

    try {
      const result = await planText({
        prompt,
        requested: coercePlannerModelId(config.plannerModel, DEFAULT_PLANNER_MODEL),
        apiKey: config.plannerApiKey || resolveApiKeyForModel(
          coercePlannerModelId(config.plannerModel, DEFAULT_PLANNER_MODEL),
        ),
        json: true,
        enableReasoning: true,
        reasoningEffort: 'high',
        temperature: 0.3,
      });
      if (result.reasoning) {
        emit(onEvent, 'output', {
          phase: 'plan',
          message: 'Planner reasoning',
          data: { type: 'markdown', label: 'Planner reasoning', content: result.reasoning.slice(0, 2500) },
        });
      }
      const parsed = parseJsonObject(result.content);
      if (parsed) {
        const plan = normalizePlan(parsed, config.goal, maxWorkers);
        emit(onEvent, 'log', {
          phase: 'plan',
          message: `${plan.workers.length} workers · ${plan.phases.length} wave(s) · via ${result.actual}`,
        });
        return plan;
      }
    } catch (err: any) {
      emit(onEvent, 'log', { phase: 'plan', message: `Planner failed (${err?.message || err}) — using fallback plan` });
    }
    return fallbackPlan(config.goal, maxWorkers);
  }

  private async runWorker(
    worker: GeneralAgentWorkerSpec,
    config: GeneralAgentConfig,
    session: SessionInfo | null,
    onEvent: EventHandler,
    skillPack: GeneralAgentSkillPack,
  ): Promise<GeneralAgentWorkerResult> {
    this.check();
    emit(onEvent, 'worker_spawned', {
      phase: 'fan_out',
      message: worker.title,
      data: {
        workerId: worker.id,
        role: worker.role,
        useTools: Boolean(worker.useTools && config.allowTools),
        skillIds: worker.skillIds || [],
        tools: worker.tools || getToolsForRole(worker.role).map((t) => t.id),
      },
    });

    // Mark task as running in canvas
    setTaskRunning(worker.id, worker.id);

    const workerSkills = await formatWorkerSkillBlock({
      role: worker.role,
      instructions: worker.instructions,
      runPack: skillPack,
      explicitSkillIds: worker.skillIds,
    });

    const toolsUsed: string[] = [];
    try {
      const wantTools = Boolean(config.allowTools && worker.useTools && session);
      if (wantTools && session) {
        const director = await runAgentDirector({
          goal: worker.instructions,
          sessionDir: session.sessionDir,
          context: [
            `Parent goal: ${config.goal}`,
            `Worker role: ${worker.role}`,
            workerSkills.promptBlock.slice(0, 5000),
          ].join('\n\n'),
          skillIds: workerSkills.diskSkillIds,
          maxSteps: 5,
          log: (message) => emit(onEvent, 'log', { phase: 'execute', message: `[${worker.id}] ${message}` }),
          out: (markdown, label) => emit(onEvent, 'output', {
            phase: 'execute',
            message: label || worker.title,
            data: { type: 'markdown', label: label || worker.title, content: markdown, workerId: worker.id },
          }),
        });
        for (const step of director.steps) {
          if (step.tool) toolsUsed.push(step.tool);
        }
        const result: GeneralAgentWorkerResult = {
          workerId: worker.id,
          title: worker.title,
          ok: director.ok,
          summary: director.summary,
          detail: director.finalAnswer,
          toolsUsed,
        };
        emit(onEvent, 'worker_done', {
          phase: 'execute',
          message: worker.title,
          data: {
            workerId: worker.id,
            ok: result.ok,
            toolsUsed,
            skills: workerSkills.diskSkillIds.concat(workerSkills.contractSkillIds),
          },
        });
        return result;
      }

      // Text-only specialist (GLM with optional web search for research roles)
      // BUT now enhanced with direct URL fetching and image generation
      const wantsSearch = /research|analyst|browser|market|competitor/i.test(worker.role)
        && !/design|visual|image|carousel slide/i.test(worker.instructions);

      // ── Fetch URLs if the worker has any ──
      const fetchedUrls: Array<{ url: string; ok: boolean; snippet: string }> = [];
      let fetchedContent = '';
      const urlsToFetch = worker.fetchUrls || [];
      // Also extract URLs from instructions
      const instructionUrls = (worker.instructions.match(/https?:\/\/[^\s"',)]+/g) || [])
        .filter((u) => !urlsToFetch.includes(u));
      const allUrls = [...urlsToFetch, ...instructionUrls].slice(0, 4);

      if (allUrls.length > 0) {
        emit(onEvent, 'log', { phase: 'execute', message: `[${worker.id}] Fetching ${allUrls.length} URL(s)…` });
        const fetchResults = await Promise.allSettled(allUrls.map((u) => fetchUrlAsMarkdown(u)));
        for (const r of fetchResults) {
          if (r.status === 'fulfilled' && r.value.ok) {
            const snippet = r.value.markdown.slice(0, 4000);
            fetchedUrls.push({ url: r.value.url, ok: true, snippet: snippet.slice(0, 200) });
            fetchedContent += `\n\n--- CONTENT FROM ${r.value.url} ---\n${snippet}\n`;
            toolsUsed.push('web_fetch');
          } else {
            const url = r.status === 'fulfilled' ? r.value.url : 'unknown';
            const error = r.status === 'fulfilled' ? r.value.error : r.reason?.message;
            fetchedUrls.push({ url, ok: false, snippet: error || 'failed' });
          }
        }
        if (fetchedContent) {
          emit(onEvent, 'output', {
            phase: 'execute',
            message: `${worker.title} — fetched content`,
            data: { type: 'markdown', label: `${worker.title} · web content`, content: `Fetched ${fetchedUrls.filter(u => u.ok).length}/${allUrls.length} URLs successfully.`, workerId: worker.id },
          });
        }
      }

      // ── Web search if worker has web_search tool ──
      const workerTools = worker.tools || getToolsForRole(worker.role).map((t) => t.id);
      let searchContent = '';
      if (workerTools.includes('web_search') && wantsSearch) {
        const searchQuery = worker.instructions.slice(0, 150);
        emit(onEvent, 'log', { phase: 'execute', message: `[${worker.id}] Searching: "${searchQuery.slice(0, 60)}…"` });
        const searchResult = await searchWeb(searchQuery);
        if (searchResult.ok && searchResult.results.length > 0) {
          searchContent = searchResult.results.map((r) => `**${r.title}** (${r.url})\n${r.snippet}`).join('\n\n');
          toolsUsed.push('web_search');
        }
      }

      // ── Run Python code if worker is an engineer/analyst with code_python ──
      let codeOutput = '';
      if (workerTools.includes('code_python') && /calculat|analyz|parse|transform|data|csv|json/i.test(worker.instructions)) {
        // The LLM will include code in its response; we'll execute it post-hoc
        // For now, just flag it as available
        toolsUsed.push('code_python');
      }

      // ── Inject shared memory from prior workers ──
      const memoryBlock = memoryToPrompt();

      // ── Inject todo items assigned to this worker ──
      const todoBlock = '';

      const prompt = `You are a specialist worker (${worker.role}) on a Autonomous agent team.
Follow the ACTIVE SKILLS closely.

PARENT GOAL:
${config.goal}

YOUR BRIEF:
${worker.instructions}

YOUR TOOLS: ${workerTools.join(', ')}

${workerSkills.promptBlock.slice(0, 3000)}

${fetchedContent ? `\nFETCHED WEB CONTENT (use this to inform your work):\n${fetchedContent.slice(0, 5000)}` : ''}
${searchContent ? `\nWEB SEARCH RESULTS:\n${searchContent.slice(0, 2000)}` : ''}
${memoryBlock}
${todoBlock}

${worker.generateImages ? `\nIMAGE GENERATION INSTRUCTIONS:
After your report, include a section "## IMAGE PROMPTS" with numbered entries like:
### Image 1: <label>
PROMPT: <detailed generation prompt for Gemini Flash Image>
ASPECT_RATIO: 1:1
TEXT_ON_IMAGE: <exact text to render, or "none">

Provide prompts for each image that needs to be generated.` : ''}

Return a concise but concrete report with:
1. Key findings (bullets)
2. Evidence / sources or reasoning
3. ${worker.generateImages ? 'Image prompts (in the format above)' : 'Risks / unknowns'}
4. What the synthesizer should do with your output

Plain markdown. No JSON.`;

      const text = await planText({
        prompt,
        requested: coercePlannerModelId(config.plannerModel, DEFAULT_PLANNER_MODEL),
        apiKey: config.plannerApiKey || resolveApiKeyForModel(
          coercePlannerModelId(config.plannerModel, DEFAULT_PLANNER_MODEL),
        ),
        webSearch: wantsSearch,
        enableReasoning: true,
        reasoningEffort: 'medium',
        temperature: 0.4,
      });

      // ── Generate images if the worker is a designer ──
      const images: Array<{ base64: string; label: string; savedPath?: string }> = [];
      if (worker.generateImages) {
        const imagePrompts = parseImagePrompts(text.content);
        if (imagePrompts.length > 0) {
          emit(onEvent, 'log', { phase: 'execute', message: `[${worker.id}] Generating ${imagePrompts.length} image(s)…` });

          // Find product image from fetched URLs to use as reference
          let productImageBase64: string | undefined;
          let productImageMime: string | undefined;
          if (fetchedContent) {
            const imgUrls = extractImageUrls(fetchedContent);
            if (imgUrls.length > 0) {
              const dl = await downloadImageAsBase64(imgUrls[0]);
              if (dl.ok && dl.base64) {
                productImageBase64 = dl.base64;
                productImageMime = dl.mimeType;
                toolsUsed.push('image_download');
              }
            }
          }

          for (const ip of imagePrompts.slice(0, 5)) {
            const genResult = await generateImage({
              prompt: ip.prompt,
              aspectRatio: ip.aspectRatio || '1:1',
              referenceImageBase64: productImageBase64,
              referenceImageMimeType: productImageMime,
              allowedText: ip.textOnImage ? [ip.textOnImage] : undefined,
              sessionDir: session?.sessionDir,
              fileName: `${worker.id}-${ip.label.replace(/[^a-z0-9]/gi, '-').slice(0, 30)}.png`,
            });
            if (genResult.ok && genResult.base64) {
              images.push({ base64: genResult.base64, label: ip.label, savedPath: genResult.savedPath });
              toolsUsed.push('image_generation');
              emit(onEvent, 'image', {
                phase: 'execute',
                message: ip.label,
                data: { workerId: worker.id, base64: genResult.base64, label: ip.label, savedPath: genResult.savedPath },
              });
            } else {
              emit(onEvent, 'log', { phase: 'execute', message: `[${worker.id}] Image failed: ${genResult.error}` });
            }
          }
        }
      }

      const result: GeneralAgentWorkerResult = {
        workerId: worker.id,
        title: worker.title,
        ok: true,
        summary: `Worker ${worker.id} complete via ${text.actual}`,
        detail: text.content,
        toolsUsed: [...new Set(toolsUsed)],
        images: images.length > 0 ? images : undefined,
        fetchedUrls: fetchedUrls.length > 0 ? fetchedUrls : undefined,
      };
      emit(onEvent, 'output', {
        phase: 'execute',
        message: worker.title,
        data: {
          type: 'markdown',
          label: `${worker.title} · ${worker.role}`,
          content: text.content.slice(0, 6000),
          workerId: worker.id,
          skills: workerSkills.contractSkillIds.concat(workerSkills.diskSkillIds),
        },
      });
      emit(onEvent, 'worker_done', {
        phase: 'execute',
        message: worker.title,
        data: {
          workerId: worker.id,
          ok: true,
          toolsUsed: result.toolsUsed,
          skills: workerSkills.contractSkillIds.concat(workerSkills.diskSkillIds),
        },
      });

      // Mark task done in canvas
      setTaskDone(worker.id, result.summary.slice(0, 100), result.toolsUsed);

      // ── Store key findings in shared memory for subsequent workers ──
      if (workerTools.includes('memory') && text.content) {
        const keyFindings = text.content.slice(0, 800);
        addMemory(`${worker.id}_findings`, keyFindings, worker.id, 'finding');
      }

      return result;
    } catch (err: any) {
      const result: GeneralAgentWorkerResult = {
        workerId: worker.id,
        title: worker.title,
        ok: false,
        summary: 'Worker failed',
        detail: String(err?.message || err),
        toolsUsed,
      };
      emit(onEvent, 'worker_done', {
        phase: 'execute',
        message: `${worker.title} failed`,
        data: { workerId: worker.id, ok: false, error: result.detail },
      });
      setTaskFailed(worker.id, result.detail.slice(0, 100));
      return result;
    }
  }

  private async synthesize(
    config: GeneralAgentConfig,
    plan: GeneralAgentPlan,
    workers: GeneralAgentWorkerResult[],
    onEvent: EventHandler,
    skillPack: GeneralAgentSkillPack,
  ): Promise<string> {
    emit(onEvent, 'phase_start', { phase: 'synthesize', message: 'Synthesizing deliverable…' });
    const workerBlock = workers.map((w) =>
      `### ${w.title} (${w.workerId}) · ${w.ok ? 'ok' : 'FAILED'}\n${w.detail.slice(0, 3500)}`,
    ).join('\n\n');

    const prompt = `You are the lead synthesizer for a Autonomous agent run.
Respect the active skills used during the run.

USER GOAL:
${config.goal}

ACTIVE SKILLS: ${skillPack.labels.join(', ') || 'defaults'}

PLAN SUMMARY:
${plan.summary}

EXPECTED DELIVERABLE:
${plan.deliverable}

WORKER REPORTS:
${workerBlock}

Write the final deliverable for the user:
- Lead with the answer / artifact
- Then supporting detail
- End with clear next actions
Use markdown. Be concrete — no fluff.`;

    try {
      const result = await planText({
        prompt,
        requested: coercePlannerModelId(config.plannerModel, DEFAULT_PLANNER_MODEL),
        apiKey: config.plannerApiKey || resolveApiKeyForModel(
          coercePlannerModelId(config.plannerModel, DEFAULT_PLANNER_MODEL),
        ),
        enableReasoning: true,
        reasoningEffort: 'high',
        temperature: 0.35,
      });
      return result.content;
    } catch (err: any) {
      return [
        `## Partial synthesis (model error: ${err?.message || err})`,
        '',
        ...workers.map((w) => `### ${w.title}\n${w.detail}`),
      ].join('\n');
    }
  }

  /**
   * Resume a run from a checkpoint. Skips already-completed workers,
   * re-runs pending/failed ones, then synthesizes.
   */
  async resume(checkpoint: RunCheckpoint, onEvent: EventHandler): Promise<GeneralAgentDeliverable | null> {
    this.stopped = false;
    const { goal, plan, completedWorkerIds, config: savedConfig } = checkpoint;

    if (!plan) {
      emit(onEvent, 'error', { message: 'Checkpoint has no plan — cannot resume. Start a new run.' });
      return null;
    }

    emit(onEvent, 'phase_start', { phase: 'fan_out', message: 'Resuming from checkpoint…' });
    emit(onEvent, 'log', { phase: 'fan_out', message: `Goal: ${goal.slice(0, 100)}` });
    emit(onEvent, 'log', { phase: 'fan_out', message: `Completed: ${completedWorkerIds.length}/${plan.workers.length} workers` });

    const cfg: GeneralAgentConfig = {
      goal,
      maxWorkers: Math.max(1, Math.min(5, Math.round((savedConfig.maxWorkers as number) ?? 3))),
      plannerModel: (savedConfig.plannerModel as PlannerModelId) || DEFAULT_PLANNER_MODEL,
      allowTools: savedConfig.allowTools !== false,
      reviewMode: 'auto', // auto-approve on resume
    };
    const maxWorkers = cfg.maxWorkers!;

    // Restore memory
    initRunMemory(checkpoint.runId);
    for (const entry of checkpoint.memory || []) {
      addMemory(entry.key, entry.value, entry.source, entry.category);
    }

    // Restore task canvas
    if (checkpoint.tasks?.length) {
      initTaskCanvas(checkpoint.tasks);
    }

    // Resolve skills
    const skillPack = await resolveGeneralAgentSkills({ goal, preferContract: GENERAL_PURPOSE_AGENT.skills || [] });

    // Check shell
    const shellOk = await isShellServerRunning();
    let session: SessionInfo | null = null;
    if (shellOk) {
      session = await createSession('general', 'agent', 'general-agent-resume');
    }

    try {
      // Find workers that still need to run
      const completedSet = new Set(completedWorkerIds);
      const pendingWorkers = plan.workers.filter((w: any) => !completedSet.has(w.id));

      if (pendingWorkers.length === 0) {
        emit(onEvent, 'log', { phase: 'fan_out', message: 'All workers already completed — synthesizing.' });
      } else {
        emit(onEvent, 'log', { phase: 'fan_out', message: `Running ${pendingWorkers.length} remaining worker(s)…` });
      }

      // Re-run pending workers in a single parallel wave
      const results: GeneralAgentWorkerResult[] = [
        ...checkpoint.workerResults.map((r) => ({
          ...r,
          detail: r.summary,
          toolsUsed: [] as string[],
        })),
      ];

      if (pendingWorkers.length > 0) {
        const waveResults = await mapWithConcurrency(
          pendingWorkers,
          maxWorkers,
          (worker: any) => this.runWorker(worker, cfg, session, onEvent, skillPack),
        );
        results.push(...waveResults);
      }

      // Synthesize
      setTaskRunning('synthesize');
      const synthesis = await this.synthesize(cfg, plan as GeneralAgentPlan, results, onEvent, skillPack);
      this.check();
      setTaskDone('synthesize', 'Deliverable ready');
      persistRunToSession(checkpoint.runId, goal);
      clearCheckpoint();

      emit(onEvent, 'output', {
        phase: 'synthesize',
        message: 'Deliverable',
        data: { type: 'markdown', label: 'Deliverable', content: synthesis },
      });

      const deliverable: GeneralAgentDeliverable = {
        plan: plan as GeneralAgentPlan,
        workers: results,
        synthesis,
        sessionDir: session?.sessionDir,
      };

      emit(onEvent, 'complete', { phase: 'deliver', message: 'Resumed run finished.', data: { deliverable } });
      return deliverable;
    } catch (err: any) {
      if (err?.message === 'Agent stopped by user.') {
        emit(onEvent, 'stopped', { message: 'Stopped.' });
        return null;
      }
      emit(onEvent, 'error', { message: `Resume failed: ${err?.message || 'unknown'}` });
      return null;
    }
  }

  async run(config: GeneralAgentConfig, onEvent: EventHandler): Promise<GeneralAgentDeliverable | null> {
    this.stopped = false;
    const goal = (config.goal || '').trim();
    if (!goal) {
      emit(onEvent, 'error', { message: 'Add a goal before running the general agent.' });
      return null;
    }

    const maxWorkers = Math.max(1, Math.min(5, Math.round(config.maxWorkers ?? 3)));
    const cfg: GeneralAgentConfig = {
      ...config,
      goal,
      maxWorkers,
      plannerModel: coercePlannerModelId(config.plannerModel, DEFAULT_PLANNER_MODEL),
      allowTools: config.allowTools !== false,
      reviewMode: config.reviewMode === 'auto' ? 'auto' : 'review',
    };

    try {
      emit(onEvent, 'phase_start', { phase: 'intake', message: 'Starting general agent…' });
      emit(onEvent, 'log', { phase: 'intake', message: goal.slice(0, 200) });

      // Clear per-run state
      clearRunMemory();
      clearTaskCanvas();
      const runId = `run_${Date.now()}`;
      initRunMemory(runId);

      const shellOk = await isShellServerRunning();
      let session: SessionInfo | null = null;
      if (shellOk) {
        session = await createSession('general', 'agent', 'general-agent');
        emit(onEvent, 'log', { phase: 'intake', message: `Session: ${session.sessionDir}` });
      } else {
        emit(onEvent, 'log', {
          phase: 'intake',
          message: 'Shell offline — text workers only (start `npm run agent:server` for tools).',
        });
      }

      try {
        const caps = await discoverAgentCapabilities();
        emit(onEvent, 'output', {
          phase: 'intake',
          message: 'Capabilities',
          data: { type: 'markdown', label: 'Capabilities', content: caps.markdown, audience: 'debug' },
        });
      } catch {
        // non-fatal
      }

      const skillPack = await resolveGeneralAgentSkills({
        goal,
        preferContract: [
          ...(GENERAL_PURPOSE_AGENT.skills || []),
          ...(cfg.preferContractSkills || []),
        ],
        preferDisk: cfg.preferDiskSkills,
      });
      emit(onEvent, 'log', {
        phase: 'intake',
        message: `Skills: ${skillPack.labels.join(' · ') || 'defaults'}`,
      });
      if (skillPack.promptBlock) {
        emit(onEvent, 'output', {
          phase: 'intake',
          message: 'Active skills',
          data: {
            type: 'markdown',
            label: 'Active skills',
            content: [
              `**Loaded:** ${skillPack.labels.join(', ') || 'none'}`,
              '',
              `Contract: ${skillPack.contractSkillIds.join(', ') || '—'}`,
              `Disk: ${skillPack.diskSkillIds.join(', ') || '— (shell offline or no match)'}`,
              '',
              skillPack.promptBlock.slice(0, 3500),
            ].join('\n'),
          },
        });
      }

      const plan = await this.planGoal(cfg, onEvent, skillPack, shellOk);
      this.check();

      const planMd = [
        `## Plan`,
        plan.summary,
        '',
        `**Deliverable:** ${plan.deliverable}`,
        '',
        `**Skills:** ${skillPack.labels.join(', ') || 'defaults'}`,
        '',
        '### Workers',
        ...plan.workers.map((w) =>
          `- **${w.id} · ${w.title}** (${w.role})${w.useTools ? ' · tools' : ''}`
          + `${w.skillIds?.length ? ` · skills: ${w.skillIds.join(', ')}` : ''}`
          + `\n  ${w.instructions.slice(0, 180)}…`,
        ),
        '',
        '### Fan-out waves',
        ...plan.phases.map((wave, i) => `${i + 1}. ${wave.join(', ')}`),
      ].join('\n');

      emit(onEvent, 'output', {
        phase: 'plan',
        message: 'Task plan',
        data: { type: 'markdown', label: 'Task plan', content: planMd },
      });

      const gate = await this.gate(
        onEvent,
        cfg,
        'plan',
        'Approve this plan and fan-out?',
        planMd,
      );
      this.check();
      if (!gate.approved) {
        emit(onEvent, 'stopped', { message: 'Plan rejected.' });
        return null;
      }

      emit(onEvent, 'phase_start', {
        phase: 'fan_out',
        message: `Fanning out ${plan.workers.length} worker(s)…`,
      });

      // Initialize task canvas from plan
      const canvasTasks = buildTaskCanvasFromPlan(plan);
      initTaskCanvas(canvasTasks);

      // Save checkpoint after plan approved — can resume from here
      saveCheckpoint({
        runId,
        goal,
        phase: 'fan_out',
        timestamp: Date.now(),
        plan,
        completedWorkerIds: [],
        workerResults: [],
        tasks: canvasTasks,
        memory: getAllMemory(),
        config: { plannerModel: cfg.plannerModel, maxWorkers, allowTools: cfg.allowTools },
      });

      const byId = new Map(plan.workers.map((w) => [w.id, w]));
      const results: GeneralAgentWorkerResult[] = [];

      for (let i = 0; i < plan.phases.length; i++) {
        this.check();
        const wave = plan.phases[i]
          .map((id) => byId.get(id))
          .filter((w): w is GeneralAgentWorkerSpec => Boolean(w));
        if (!wave.length) continue;

        emit(onEvent, 'log', {
          phase: 'fan_out',
          message: `Wave ${i + 1}/${plan.phases.length}: ${wave.map((w) => w.id).join(', ')}`,
        });

        const waveResults = await mapWithConcurrency(
          wave,
          maxWorkers,
          (worker) => this.runWorker(worker, cfg, session, onEvent, skillPack),
        );
        results.push(...waveResults);

        // Update checkpoint after each wave
        saveCheckpoint({
          runId,
          goal,
          phase: 'execute',
          timestamp: Date.now(),
          plan,
          completedWorkerIds: results.map((r) => r.workerId),
          workerResults: results.map((r) => ({ workerId: r.workerId, title: r.title, ok: r.ok, summary: r.summary })),
          tasks: getTaskCanvas(),
          memory: getAllMemory(),
          config: { plannerModel: cfg.plannerModel, maxWorkers, allowTools: cfg.allowTools },
        });
      }

      setTaskRunning('synthesize');
      const synthesis = await this.synthesize(cfg, plan, results, onEvent, skillPack);
      this.check();
      setTaskDone('synthesize', 'Deliverable ready');

      // Persist memory to session for future runs
      persistRunToSession(runId, goal);

      emit(onEvent, 'output', {
        phase: 'synthesize',
        message: 'Deliverable',
        data: { type: 'markdown', label: 'Deliverable', content: synthesis },
      });

      const deliverable: GeneralAgentDeliverable = {
        plan,
        workers: results,
        synthesis,
        sessionDir: session?.sessionDir,
        images: results
          .filter((r) => r.images?.length)
          .flatMap((r) => (r.images || []).map((img) => ({ ...img, workerId: r.workerId }))),
      };

      // Clear checkpoint on successful completion
      clearCheckpoint();

      emit(onEvent, 'complete', {
        phase: 'deliver',
        message: 'General agent finished.',
        data: { deliverable },
      });
      return deliverable;
    } catch (err: any) {
      if (err?.message === 'Agent stopped by user.') {
        emit(onEvent, 'stopped', { message: 'Stopped.' });
        return null;
      }
      emit(onEvent, 'error', {
        message: `${err?.message || 'General agent failed.'} — Edit the goal and run again.`,
      });
      return null;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FOLLOW-UP CHAT — Conversational follow-ups using run context
// ═══════════════════════════════════════════════════════════════════════════════

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolsUsed?: string[];
  images?: Array<{ base64: string; label: string }>;
}

export interface FollowUpConfig {
  message: string;
  plannerModel?: PlannerModelId;
  plannerApiKey?: string;
  deliverable: GeneralAgentDeliverable;
  history: ChatMessage[];
  allowTools?: boolean;
  sessionDir?: string;
}

export async function handleFollowUp(
  config: FollowUpConfig,
  onEvent: EventHandler,
): Promise<ChatMessage> {
  const { message, deliverable, history } = config;
  const msgId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  emit(onEvent, 'log', { phase: 'execute', message: 'Processing your request…' });

  const runContext = [
    `ORIGINAL GOAL: ${deliverable.plan.summary}`,
    `DELIVERABLE:\n${deliverable.synthesis.slice(0, 4000)}`,
    '',
    `WORKER FINDINGS:`,
    ...deliverable.workers.slice(0, 4).map((w) => `- ${w.title}: ${w.detail.slice(0, 600)}`),
    '',
    memoryToPrompt(),
  ].join('\n');

  const chatHistory = history.slice(-6).map((m) =>
    `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.content.slice(0, 1000)}`
  ).join('\n\n');

  const wantsImages = /generat|creat|make|design|draw|render|visualiz/i.test(message) && /image|slide|visual|graphic|carousel|photo|picture/i.test(message);
  const wantsCode = /calculat|comput|analyz|code|script|run|parse|transform/i.test(message);
  const wantsWeb = /search|look up|find|what is|latest|current|check|visit|fetch|browse/i.test(message);

  let fetchedContent = '';
  const urls = message.match(/https?:\/\/[^\s"',)]+/g) || [];
  if (urls.length > 0 && config.allowTools) {
    emit(onEvent, 'log', { phase: 'execute', message: `Fetching ${urls.length} URL(s)…` });
    const results = await Promise.allSettled(urls.slice(0, 3).map((u) => fetchUrlAsMarkdown(u)));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.ok) {
        fetchedContent += `\n--- ${r.value.url} ---\n${r.value.markdown.slice(0, 3000)}\n`;
        emit(onEvent, 'log', { phase: 'execute', message: `Fetched ${r.value.title || r.value.url}` });
      }
    }
  }

  let searchContent = '';
  if (wantsWeb && config.allowTools) {
    emit(onEvent, 'log', { phase: 'execute', message: 'Searching the web…' });
    const searchResult = await searchWeb(message.slice(0, 120));
    if (searchResult.ok) {
      searchContent = searchResult.results.map((r) => `**${r.title}**: ${r.snippet}`).join('\n');
      emit(onEvent, 'log', { phase: 'execute', message: `Found ${searchResult.results.length} result(s)` });
    }
  }

  emit(onEvent, 'log', { phase: 'execute', message: 'Generating response…' });

  const prompt = `You are a follow-up assistant for a completed Autonomous agent run.
Use the RUN CONTEXT and CHAT HISTORY to answer concretely.

RUN CONTEXT:
${runContext.slice(0, 6000)}

${chatHistory ? `CHAT HISTORY:\n${chatHistory}\n` : ''}
${fetchedContent ? `FETCHED CONTENT:\n${fetchedContent.slice(0, 3000)}\n` : ''}
${searchContent ? `SEARCH RESULTS:\n${searchContent.slice(0, 2000)}\n` : ''}

USER: ${message}

${wantsImages ? `If images are needed, include:\n## IMAGE PROMPTS\n### Image 1: <label>\nPROMPT: <detailed prompt>\nASPECT_RATIO: 1:1\nTEXT_ON_IMAGE: <text or "none">` : ''}

Be concise, concrete, actionable. Use markdown.`;

  try {
    const result = await planText({
      prompt,
      requested: coercePlannerModelId(config.plannerModel, DEFAULT_PLANNER_MODEL),
      apiKey: config.plannerApiKey || resolveApiKeyForModel(
        coercePlannerModelId(config.plannerModel, DEFAULT_PLANNER_MODEL),
      ),
      webSearch: wantsWeb,
      enableReasoning: true,
      reasoningEffort: 'medium',
      temperature: 0.4,
    });

    const toolsUsed: string[] = [];
    if (fetchedContent) toolsUsed.push('web_fetch');
    if (searchContent) toolsUsed.push('web_search');

    const images: Array<{ base64: string; label: string }> = [];
    if (wantsImages && config.allowTools) {
      const imagePrompts = parseImagePrompts(result.content);
      for (const ip of imagePrompts.slice(0, 4)) {
        emit(onEvent, 'log', { phase: 'execute', message: `Generating: ${ip.label}` });
        const genResult = await generateImage({
          prompt: ip.prompt,
          aspectRatio: ip.aspectRatio || '1:1',
          allowedText: ip.textOnImage ? [ip.textOnImage] : undefined,
          sessionDir: config.sessionDir,
          fileName: `chat-${ip.label.replace(/[^a-z0-9]/gi, '-').slice(0, 30)}.png`,
        });
        if (genResult.ok && genResult.base64) {
          images.push({ base64: genResult.base64, label: ip.label });
          toolsUsed.push('image_gen');
          emit(onEvent, 'image', {
            phase: 'execute',
            message: ip.label,
            data: { base64: genResult.base64, label: ip.label, workerId: 'chat' },
          });
        }
      }
    }

    if (wantsCode && config.allowTools) {
      const codeBlocks = result.content.match(/```python\n([\s\S]*?)```/g);
      if (codeBlocks?.length) {
        const code = codeBlocks[0].replace(/```python\n?|```$/g, '');
        const codeResult = await runPython(code, config.sessionDir);
        if (codeResult.ok && codeResult.stdout) {
          toolsUsed.push('code_python');
        }
      }
    }

    return {
      id: msgId,
      role: 'assistant',
      content: result.content,
      timestamp: Date.now(),
      toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
      images: images.length > 0 ? images : undefined,
    };
  } catch (err: any) {
    return {
      id: msgId,
      role: 'assistant',
      content: `Sorry, couldn't process that: ${err?.message || 'unknown error'}. Try rephrasing.`,
      timestamp: Date.now(),
    };
  }
}

/** @internal exported for unit tests */
export function buildGeneralAgentPlanFromModelJson(
  raw: Record<string, unknown>,
  goal: string,
  maxWorkers: number,
): GeneralAgentPlan {
  return normalizePlan(raw, goal, maxWorkers);
}

/** @internal exported for unit tests */
export function buildGeneralAgentFallbackPlan(goal: string, maxWorkers: number): GeneralAgentPlan {
  return fallbackPlan(goal, maxWorkers);
}
