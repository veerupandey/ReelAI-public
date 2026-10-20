/**
 * Agent Memory Store — persistent memory + checkpointing for General Agent.
 *
 * Three layers:
 * 1. Run Memory — key/value facts shared between workers in a single run (in-memory + localStorage)
 * 2. Session Memory — persists across runs within the same browser session (localStorage)
 * 3. Checkpoints — snapshots of run state at each phase, enabling resume after crash/refresh
 *
 * Storage keys:
 *   ga_memory_<runId>   — run-level facts
 *   ga_session_memory   — cross-run persistent facts
 *   ga_checkpoint       — latest run checkpoint
 *   ga_task_canvas      — planner task list with completion state
 */

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface MemoryEntry {
  key: string;
  value: string;
  source: string; // worker id or 'user' or 'system'
  timestamp: number;
  category?: 'finding' | 'decision' | 'artifact' | 'url' | 'error';
}

export interface TaskItem {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  assignedTo?: string; // worker id
  phase?: string;
  startedAt?: number;
  completedAt?: number;
  result?: string; // short summary of what was produced
  tools?: string[];
}

export interface RunCheckpoint {
  runId: string;
  goal: string;
  phase: 'intake' | 'plan' | 'fan_out' | 'execute' | 'synthesize' | 'deliver';
  timestamp: number;
  plan?: any; // GeneralAgentPlan serialized
  completedWorkerIds: string[];
  workerResults: Array<{ workerId: string; title: string; ok: boolean; summary: string }>;
  tasks: TaskItem[];
  memory: MemoryEntry[];
  config: Record<string, unknown>;
}

export interface SessionMemory {
  entries: MemoryEntry[];
  lastRunId?: string;
  lastGoal?: string;
  updatedAt: number;
}


// ═══════════════════════════════════════════════════════════════════════════════
// STORAGE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const CHECKPOINT_KEY = 'ga_checkpoint';
const SESSION_MEMORY_KEY = 'ga_session_memory';
const TASK_CANVAS_KEY = 'ga_task_canvas';

function safeGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch { return null; }
}

function safeSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* quota exceeded — silently fail */ }
}

function safeRemove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RUN MEMORY — in-memory Map backed by localStorage for the current run
// ═══════════════════════════════════════════════════════════════════════════════

let currentRunId: string | null = null;
let runMemoryEntries: MemoryEntry[] = [];

export function initRunMemory(runId: string): void {
  currentRunId = runId;
  runMemoryEntries = [];
}

export function addMemory(key: string, value: string, source: string, category?: MemoryEntry['category']): void {
  const entry: MemoryEntry = { key, value, source, timestamp: Date.now(), category };
  // Deduplicate by key — latest wins
  runMemoryEntries = runMemoryEntries.filter((e) => e.key !== key);
  runMemoryEntries.push(entry);
}

export function getMemory(key: string): string | undefined {
  return runMemoryEntries.find((e) => e.key === key)?.value;
}

export function getAllMemory(): MemoryEntry[] {
  return [...runMemoryEntries];
}

export function clearRunMemory(): void {
  runMemoryEntries = [];
  currentRunId = null;
}

/** Format memory for injection into worker/LLM prompts. */
export function memoryToPrompt(): string {
  if (runMemoryEntries.length === 0) return '';
  const lines = runMemoryEntries
    .slice(-15) // cap at 15 most recent
    .map((e) => `- **${e.key}** (${e.source}): ${e.value.slice(0, 400)}`);
  return `\nSHARED MEMORY:\n${lines.join('\n')}\n`;
}


// ═══════════════════════════════════════════════════════════════════════════════
// SESSION MEMORY — persists across runs (brand facts, URLs, decisions)
// ═══════════════════════════════════════════════════════════════════════════════

export function getSessionMemory(): SessionMemory {
  return safeGet<SessionMemory>(SESSION_MEMORY_KEY) || { entries: [], updatedAt: 0 };
}

export function addSessionMemory(key: string, value: string, source: string, category?: MemoryEntry['category']): void {
  const session = getSessionMemory();
  session.entries = session.entries.filter((e) => e.key !== key);
  session.entries.push({ key, value, source, timestamp: Date.now(), category });
  // Cap at 50 entries
  if (session.entries.length > 50) session.entries = session.entries.slice(-50);
  session.updatedAt = Date.now();
  safeSet(SESSION_MEMORY_KEY, session);
}

export function persistRunToSession(runId: string, goal: string): void {
  const session = getSessionMemory();
  session.lastRunId = runId;
  session.lastGoal = goal;
  // Promote important run memory to session
  for (const entry of runMemoryEntries) {
    if (entry.category === 'finding' || entry.category === 'decision' || entry.category === 'url') {
      session.entries = session.entries.filter((e) => e.key !== entry.key);
      session.entries.push(entry);
    }
  }
  if (session.entries.length > 50) session.entries = session.entries.slice(-50);
  session.updatedAt = Date.now();
  safeSet(SESSION_MEMORY_KEY, session);
}

export function sessionMemoryToPrompt(): string {
  const session = getSessionMemory();
  if (session.entries.length === 0) return '';
  const lines = session.entries.slice(-10).map((e) => `- ${e.key}: ${e.value.slice(0, 300)}`);
  return `\nPERSISTENT CONTEXT (from prior runs):\n${lines.join('\n')}\n`;
}

export function clearSessionMemory(): void {
  safeRemove(SESSION_MEMORY_KEY);
}


// ═══════════════════════════════════════════════════════════════════════════════
// CHECKPOINTS — save/restore run state for crash recovery
// ═══════════════════════════════════════════════════════════════════════════════

export function saveCheckpoint(checkpoint: RunCheckpoint): void {
  safeSet(CHECKPOINT_KEY, checkpoint);
}

export function loadCheckpoint(): RunCheckpoint | null {
  return safeGet<RunCheckpoint>(CHECKPOINT_KEY);
}

export function clearCheckpoint(): void {
  safeRemove(CHECKPOINT_KEY);
}

export function hasCheckpoint(): boolean {
  return loadCheckpoint() !== null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TASK CANVAS — planner task list with real-time completion tracking
// ═══════════════════════════════════════════════════════════════════════════════

let taskCanvas: TaskItem[] = [];
let taskCanvasListeners: Array<(tasks: TaskItem[]) => void> = [];

export function initTaskCanvas(tasks: TaskItem[]): void {
  taskCanvas = tasks;
  safeSet(TASK_CANVAS_KEY, taskCanvas);
  notifyTaskListeners();
}

export function getTaskCanvas(): TaskItem[] {
  if (taskCanvas.length === 0) {
    taskCanvas = safeGet<TaskItem[]>(TASK_CANVAS_KEY) || [];
  }
  return [...taskCanvas];
}

export function updateTask(taskId: string, updates: Partial<TaskItem>): void {
  taskCanvas = taskCanvas.map((t) => t.id === taskId ? { ...t, ...updates } : t);
  safeSet(TASK_CANVAS_KEY, taskCanvas);
  notifyTaskListeners();
}

export function setTaskRunning(taskId: string, assignedTo?: string): void {
  updateTask(taskId, { status: 'running', startedAt: Date.now(), assignedTo });
}

export function setTaskDone(taskId: string, result?: string, tools?: string[]): void {
  updateTask(taskId, { status: 'done', completedAt: Date.now(), result, tools });
}

export function setTaskFailed(taskId: string, result?: string): void {
  updateTask(taskId, { status: 'failed', completedAt: Date.now(), result });
}

export function clearTaskCanvas(): void {
  taskCanvas = [];
  safeRemove(TASK_CANVAS_KEY);
  notifyTaskListeners();
}

/** Subscribe to task canvas changes. Returns unsubscribe function. */
export function onTaskCanvasChange(listener: (tasks: TaskItem[]) => void): () => void {
  taskCanvasListeners.push(listener);
  return () => { taskCanvasListeners = taskCanvasListeners.filter((l) => l !== listener); };
}

function notifyTaskListeners(): void {
  for (const listener of taskCanvasListeners) {
    try { listener([...taskCanvas]); } catch { /* ignore */ }
  }
}

/** Build task canvas from a plan's workers and phases. */
export function buildTaskCanvasFromPlan(plan: { workers: Array<{ id: string; title: string; role: string; tools?: string[] }>; phases: string[][] }): TaskItem[] {
  const tasks: TaskItem[] = [];
  let phaseIndex = 0;
  for (const phase of plan.phases) {
    phaseIndex++;
    for (const workerId of phase) {
      const worker = plan.workers.find((w) => w.id === workerId);
      if (worker) {
        tasks.push({
          id: worker.id,
          title: worker.title,
          description: worker.role,
          status: 'pending',
          assignedTo: worker.id,
          phase: `Wave ${phaseIndex}`,
          tools: worker.tools,
        });
      }
    }
  }
  // Add synthesis task at the end
  tasks.push({
    id: 'synthesize',
    title: 'Synthesize deliverable',
    description: 'Combine all worker findings into final output',
    status: 'pending',
    phase: 'Final',
  });
  return tasks;
}
