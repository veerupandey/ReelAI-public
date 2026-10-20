/**
 * General Agent Console — Polished Autonomous runner UI.
 * Redesigned for clarity: clean progress, live workers, image gallery, deliverable.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  GeneralPurposeAgent,
  type GeneralAgentConfig,
  type GeneralAgentDeliverable,
  type GeneralAgentEvent,
  type GeneralAgentPhase,
  handleFollowUp,
  type ChatMessage,
} from '../services/generalPurposeAgent';
import { isShellServerRunning } from '../services/shellToolService';
import {
  clearPendingHubLaunch,
  peekPendingHubLaunch,
} from '../services/agentLaunchStore';
import PlannerModelControls from './PlannerModelControls';
import MarkdownRenderer from './MarkdownRenderer';
import TaskCanvas from './TaskCanvas';
import { loadCheckpoint, clearCheckpoint, type RunCheckpoint } from '../services/agentMemoryStore';
import {
  coercePlannerModelId,
  DEFAULT_PLANNER_MODEL,
  type PlannerModelId,
} from '../services/llm/types';
import { resolveApiKeyForModel } from '../services/llm/apiKeys';

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  userId: string;
  onBack: () => void;
}


const PHASE_META: Record<GeneralAgentPhase, { label: string; icon: string }> = {
  intake: { label: 'Starting', icon: '1' },
  plan: { label: 'Planning', icon: '2' },
  fan_out: { label: 'Workers', icon: '3' },
  execute: { label: 'Executing', icon: '3' },
  synthesize: { label: 'Synthesis', icon: '4' },
  deliver: { label: 'Done', icon: '5' },
};

const PHASE_ORDER: GeneralAgentPhase[] = ['intake', 'plan', 'fan_out', 'execute', 'synthesize', 'deliver'];

interface WorkerLive {
  id: string;
  title: string;
  role: string;
  status: 'running' | 'done' | 'failed';
  tools: string[];
  skills: string[];
}

interface GeneratedImage {
  base64: string;
  label: string;
  workerId: string;
}


const GeneralAgentConsole: React.FC<Props> = ({ onBack }) => {
  const agentRef = useRef<GeneralPurposeAgent | null>(null);
  const runLockRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const [goal, setGoal] = useState('');
  const [plannerModel, setPlannerModel] = useState<PlannerModelId>(DEFAULT_PLANNER_MODEL);
  const [maxWorkers, setMaxWorkers] = useState(3);
  const [allowTools, setAllowTools] = useState(true);
  const [autoApprove, setAutoApprove] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [events, setEvents] = useState<GeneralAgentEvent[]>([]);
  const [currentPhase, setCurrentPhase] = useState<GeneralAgentPhase | null>(null);
  const [completedPhases, setCompletedPhases] = useState<Set<string>>(new Set());
  const [isRunning, setIsRunning] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<{ question: string; detail: string } | null>(null);
  const [approvalFeedback, setApprovalFeedback] = useState('');
  const [deliverable, setDeliverable] = useState<GeneralAgentDeliverable | null>(null);
  const [shellOk, setShellOk] = useState<boolean | null>(null);
  const [workersLive, setWorkersLive] = useState<WorkerLive[]>([]);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [activeTab, setActiveTab] = useState<'log' | 'images'>('log');
  const [elapsedSec, setElapsedSec] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Chat follow-up state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatStatus, setChatStatus] = useState<string[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Resume state
  const [pendingCheckpoint, setPendingCheckpoint] = useState<RunCheckpoint | null>(null);

  useEffect(() => { void isShellServerRunning().then(setShellOk); }, []);

  // Check for interrupted run on mount
  useEffect(() => {
    const cp = loadCheckpoint();
    if (cp && cp.plan) {
      setPendingCheckpoint(cp);
      setGoal(cp.goal);
    }
  }, []);


  // Hydrate from Hub launch envelope
  useEffect(() => {
    const pending = peekPendingHubLaunch();
    if (!pending || pending.agentId !== 'general-agent') return;
    const params = pending.params || {};
    if (typeof params.goal === 'string' && params.goal.trim()) setGoal(params.goal);
    if (params.plannerModel) setPlannerModel(coercePlannerModelId(params.plannerModel, DEFAULT_PLANNER_MODEL));
    if (params.maxWorkers !== undefined) {
      const n = Math.round(Number(params.maxWorkers));
      if (Number.isFinite(n)) setMaxWorkers(Math.max(1, Math.min(5, n)));
    }
    if (typeof params.allowTools === 'boolean') setAllowTools(params.allowTools);
    if (typeof params.reviewMode === 'boolean') setAutoApprove(params.reviewMode);
    clearPendingHubLaunch();
  }, []);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  // Timer
  useEffect(() => {
    if (isRunning) {
      setElapsedSec(0);
      timerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRunning]);


  const handleEvent = useCallback((e: GeneralAgentEvent) => {
    setEvents((prev) => [...prev, e]);
    if (e.type === 'phase_start' && e.phase) {
      setCurrentPhase((prev) => {
        if (prev) setCompletedPhases((c) => new Set(c).add(prev));
        return e.phase!;
      });
    }
    if (e.type === 'worker_spawned') {
      const id = String(e.data?.workerId || '');
      const title = e.message || id;
      const skills = Array.isArray(e.data?.skillIds) ? e.data.skillIds.map(String) : [];
      const role = String(e.data?.role || '');
      const tools = Array.isArray(e.data?.tools) ? e.data.tools.map(String) : [];
      setWorkersLive((prev) => [...prev.filter((w) => w.id !== id), { id, title, role, status: 'running', tools, skills }]);
    }
    if (e.type === 'worker_done') {
      const id = String(e.data?.workerId || '');
      const ok = e.data?.ok !== false;
      const tools = Array.isArray(e.data?.toolsUsed) ? e.data.toolsUsed.map(String) : [];
      setWorkersLive((prev) => prev.map((w) => (w.id === id ? { ...w, status: ok ? 'done' : 'failed', tools } : w)));
    }
    if (e.type === 'image' && e.data?.base64) {
      setImages((prev) => [...prev, {
        base64: String(e.data!.base64),
        label: String(e.data!.label || e.message || 'Image'),
        workerId: String(e.data!.workerId || ''),
      }]);
      setActiveTab('images');
    }
    if (e.type === 'approval_needed') {
      setPendingApproval({ question: e.message || 'Approve?', detail: String(e.data?.detail || '') });
    }
    if (e.type === 'complete') {
      setDeliverable((e.data?.deliverable as GeneralAgentDeliverable) || null);
      setCurrentPhase('deliver');
      setCompletedPhases((c) => new Set([...c, 'intake', 'plan', 'fan_out', 'execute', 'synthesize', 'deliver']));
      setPendingApproval(null);
    }
    if (e.type === 'stopped' || e.type === 'error') setPendingApproval(null);
  }, []);


  const handleRun = useCallback(async () => {
    if (!goal.trim() || isRunning || runLockRef.current) return;
    runLockRef.current = true;
    try { agentRef.current?.stop(); } catch { /* ignore */ }

    setEvents([]); setCompletedPhases(new Set()); setDeliverable(null);
    setPendingApproval(null); setWorkersLive([]); setImages([]);
    setCurrentPhase('intake'); setIsRunning(true); setActiveTab('log');
    setChatMessages([]); setChatInput('');

    const agent = new GeneralPurposeAgent();
    agentRef.current = agent;

    const config: GeneralAgentConfig = {
      goal: goal.trim(),
      plannerModel,
      plannerApiKey: resolveApiKeyForModel(plannerModel),
      maxWorkers,
      allowTools,
      reviewMode: autoApprove ? 'auto' : 'review',
      autoApproveSec: 0,
    };

    try { await agent.run(config, handleEvent); }
    finally { runLockRef.current = false; setIsRunning(false); }
  }, [goal, isRunning, plannerModel, maxWorkers, allowTools, autoApprove, handleEvent]);

  const handleResume = useCallback(async () => {
    if (!pendingCheckpoint || isRunning) return;
    setPendingCheckpoint(null);
    setEvents([]); setCompletedPhases(new Set(['intake', 'plan'])); setDeliverable(null);
    setPendingApproval(null); setWorkersLive([]); setImages([]);
    setCurrentPhase('fan_out'); setIsRunning(true); setActiveTab('log');
    setChatMessages([]); setChatInput('');

    const agent = new GeneralPurposeAgent();
    agentRef.current = agent;

    try { await agent.resume(pendingCheckpoint, handleEvent); }
    finally { setIsRunning(false); }
  }, [pendingCheckpoint, isRunning, handleEvent]);

  const handleDismissCheckpoint = () => {
    setPendingCheckpoint(null);
    clearCheckpoint();
  };

  const handleApprove = (approved: boolean) => {
    agentRef.current?.respondToApproval(approved, approvalFeedback);
    setPendingApproval(null); setApprovalFeedback('');
  };

  const handleStop = () => {
    agentRef.current?.stop();
    setIsRunning(false); setPendingApproval(null);
  };

  const handleChatSend = useCallback(async () => {
    if (!chatInput.trim() || chatLoading || !deliverable) return;
    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: chatInput.trim(),
      timestamp: Date.now(),
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput('');
    setChatLoading(true);
    setChatStatus([]);

    // Capture live status from events during follow-up
    const statusHandler = (e: GeneralAgentEvent) => {
      if (e.type === 'log' && e.message) {
        setChatStatus((prev) => [...prev.slice(-4), e.message!]);
      }
      // Also handle images from follow-up
      if (e.type === 'image' && e.data?.base64) {
        setImages((prev) => [...prev, {
          base64: String(e.data!.base64),
          label: String(e.data!.label || 'Image'),
          workerId: 'chat',
        }]);
      }
    };

    try {
      const response = await handleFollowUp({
        message: userMsg.content,
        plannerModel,
        plannerApiKey: resolveApiKeyForModel(plannerModel),
        deliverable,
        history: [...chatMessages, userMsg],
        allowTools: allowTools,
        sessionDir: deliverable.sessionDir,
      }, statusHandler);
      setChatMessages((prev) => [...prev, response]);
    } catch {
      setChatMessages((prev) => [...prev, {
        id: `err_${Date.now()}`,
        role: 'assistant',
        content: 'Something went wrong. Try again.',
        timestamp: Date.now(),
      }]);
    } finally {
      setChatLoading(false);
      setChatStatus([]);
    }
  }, [chatInput, chatLoading, deliverable, plannerModel, allowTools, chatMessages]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const phaseIndex = currentPhase ? PHASE_ORDER.indexOf(currentPhase) : -1;


  return (
    <div className="min-h-screen bg-[#0a0f1a] text-white flex flex-col">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#0a0f1a]/95 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="text-gray-500 hover:text-white transition text-sm">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <div>
              <h1 className="text-[15px] font-semibold tracking-tight">General Agent</h1>
              <p className="text-[11px] text-gray-500">
                {isRunning ? `Running · ${formatTime(elapsedSec)}` : 'Plan, research, create — open-ended'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-[10px] px-2.5 py-1 rounded-full border ${
              shellOk === true ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
              shellOk === false ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
              'bg-gray-500/10 text-gray-500 border-gray-500/20'
            }`}>
              {shellOk === true ? 'Tools online' : shellOk === false ? 'Tools offline' : 'Checking…'}
            </span>
            {isRunning ? (
              <button onClick={handleStop} className="px-4 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition">
                Stop
              </button>
            ) : (
              <button onClick={() => void handleRun()} disabled={!goal.trim()}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 text-black hover:bg-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed transition">
                Run
              </button>
            )}
          </div>
        </div>
      </header>


      {/* ── Progress bar ── */}
      {isRunning && (
        <div className="h-0.5 bg-gray-800">
          <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-700"
            style={{ width: `${Math.max(5, ((phaseIndex + 1) / PHASE_ORDER.length) * 100)}%` }} />
        </div>
      )}

      {/* ── Main content ── */}
      <div className="flex-1 max-w-6xl mx-auto w-full px-5 py-6 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">

        {/* ── Left panel ── */}
        <div className="space-y-4">
          {/* Goal input */}
          <div className="rounded-xl border border-white/[0.06] bg-[#111827] p-4">
            <label className="block space-y-2">
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Goal</span>
              <textarea value={goal} onChange={(e) => setGoal(e.target.value)}
                rows={5} disabled={isRunning}
                placeholder="Create a carousel post for Kageha matcha..."
                className="w-full rounded-lg border border-white/[0.06] bg-black/40 px-3 py-2.5 text-[13px] text-white placeholder-gray-600 focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/20 focus:outline-none disabled:opacity-50 resize-none transition" />
            </label>
            {/* Settings toggle */}
            <button onClick={() => setShowSettings(!showSettings)}
              className="mt-3 text-[11px] text-gray-500 hover:text-gray-300 transition flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 10a2 2 0 100-4 2 2 0 000 4z" stroke="currentColor" strokeWidth="1.2"/><path d="M13.5 8a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z" stroke="currentColor" strokeWidth="1.2"/></svg>
              {showSettings ? 'Hide settings' : 'Settings'}
            </button>
            {showSettings && (
              <div className="mt-3 pt-3 border-t border-white/[0.04] space-y-3">
                <div>
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">Model</span>
                  <div className="mt-1"><PlannerModelControls value={plannerModel} onChange={setPlannerModel} variant="list" /></div>
                </div>
                <label className="flex items-center justify-between text-[12px] text-gray-400">
                  <span>Workers: {maxWorkers}</span>
                  <input type="range" min={1} max={5} value={maxWorkers} disabled={isRunning}
                    onChange={(e) => setMaxWorkers(Number(e.target.value))} className="w-20" />
                </label>
                <label className="flex items-center justify-between text-[12px] text-gray-400">
                  <span>Shell/MCP tools</span>
                  <input type="checkbox" checked={allowTools} disabled={isRunning} onChange={(e) => setAllowTools(e.target.checked)}
                    className="rounded border-gray-600" />
                </label>
                <label className="flex items-center justify-between text-[12px] text-gray-400">
                  <span>Auto-approve</span>
                  <input type="checkbox" checked={autoApprove} disabled={isRunning} onChange={(e) => setAutoApprove(e.target.checked)}
                    className="rounded border-gray-600" />
                </label>
              </div>
            )}
          </div>


          {/* Phase progress */}
          {(isRunning || deliverable) && (
            <div className="rounded-xl border border-white/[0.06] bg-[#111827] p-4">
              <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Progress</span>
              <div className="mt-3 space-y-1">
                {PHASE_ORDER.filter(p => p !== 'execute').map((p) => {
                  const done = completedPhases.has(p);
                  const active = currentPhase === p || (p === 'fan_out' && currentPhase === 'execute');
                  const meta = PHASE_META[p];
                  return (
                    <div key={p} className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12px] transition-all ${
                      active ? 'bg-emerald-500/10 text-emerald-300' : done ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                        active ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40' :
                        done ? 'bg-gray-700 text-gray-400' : 'bg-gray-800/50 text-gray-600'
                      }`}>
                        {done ? <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg> : meta.icon}
                      </span>
                      <span>{meta.label}</span>
                      {active && isRunning && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Task Canvas — replaces basic worker list */}
          {(isRunning || deliverable) && <TaskCanvas />}
        </div>


        {/* ── Right panel (main) ── */}
        <div className="space-y-4 min-w-0">

          {/* Resume interrupted run banner */}
          {pendingCheckpoint && !isRunning && !deliverable && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4 space-y-3">
              <div className="flex items-start gap-3">
                <span className="text-amber-400 mt-0.5 shrink-0">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1v6l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/></svg>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-amber-200">Interrupted run detected</p>
                  <p className="text-[11px] text-gray-400 mt-0.5 truncate">{pendingCheckpoint.goal}</p>
                  <p className="text-[10px] text-gray-500 mt-1">
                    {pendingCheckpoint.completedWorkerIds.length}/{pendingCheckpoint.plan?.workers?.length || '?'} workers completed · Phase: {pendingCheckpoint.phase}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 pl-7">
                <button onClick={() => void handleResume()}
                  className="px-4 py-2 rounded-lg bg-amber-500/80 text-black text-[11px] font-semibold hover:bg-amber-400 transition">
                  Resume run
                </button>
                <button onClick={handleDismissCheckpoint}
                  className="px-3 py-2 rounded-lg border border-white/10 text-[11px] text-gray-400 hover:text-white hover:border-white/20 transition">
                  Discard
                </button>
              </div>
            </div>
          )}

          {/* Running indicator (before deliverable) */}
          {isRunning && !deliverable && !pendingApproval && (
            <div className="rounded-xl border border-white/[0.06] bg-[#111827] p-5">
              <div className="flex items-start gap-3">
                <span className="w-2 h-2 mt-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <div className="space-y-2 min-w-0">
                  <p className="text-[13px] text-gray-300 font-medium">Agent is working…</p>
                  <div className="space-y-1">
                    {events.filter(e => e.type === 'log' || e.type === 'phase_start').slice(-5).map((e) => (
                      <p key={e.id} className="text-[11px] text-gray-500 flex items-center gap-1.5">
                        {e.type === 'phase_start' ? (
                          <span className="text-emerald-400">●</span>
                        ) : (
                          <span className="text-gray-600">→</span>
                        )}
                        {e.message}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Approval gate */}
          {pendingApproval && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] p-5 space-y-3 animate-in fade-in">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <p className="text-[13px] font-medium text-emerald-200">{pendingApproval.question}</p>
              </div>
              {pendingApproval.detail && (
                <div className="max-h-64 overflow-auto rounded-lg bg-black/40 p-3 border border-white/[0.04]">
                  <MarkdownRenderer content={pendingApproval.detail} />
                </div>
              )}
              <textarea value={approvalFeedback} onChange={(e) => setApprovalFeedback(e.target.value)}
                rows={2} placeholder="Optional feedback or adjustments…"
                className="w-full rounded-lg border border-white/[0.06] bg-black/40 px-3 py-2 text-[12px] text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500/40" />
              <div className="flex gap-2">
                <button onClick={() => handleApprove(true)}
                  className="px-5 py-2 rounded-lg bg-emerald-500 text-black text-[12px] font-semibold hover:bg-emerald-400 transition">
                  Approve
                </button>
                <button onClick={() => handleApprove(false)}
                  className="px-4 py-2 rounded-lg border border-white/10 text-[12px] text-gray-400 hover:text-white hover:border-white/20 transition">
                  Reject
                </button>
              </div>
            </div>
          )}

          {/* ── Chat Thread (goal → deliverable → follow-ups) ── */}
          {deliverable && (
            <div className="rounded-xl border border-white/[0.06] bg-[#111827] overflow-hidden">
              <div className="p-4 space-y-4 max-h-[600px] overflow-auto">
                {/* Original goal as first user message */}
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-xl px-3.5 py-2.5 bg-emerald-500/15 border border-emerald-500/20">
                    <p className="text-[12px] text-emerald-100">{goal}</p>
                  </div>
                </div>

                {/* Deliverable as first assistant response */}
                <div className="flex justify-start">
                  <div className="max-w-[95%] rounded-xl px-4 py-3 bg-black/30 border border-white/[0.04]">
                    <div className="flex items-center gap-2 mb-2">
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-7" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">Deliverable · {formatTime(elapsedSec)}</span>
                    </div>
                    <MarkdownRenderer content={deliverable.synthesis} />
                  </div>
                </div>

                {/* Follow-up messages */}
                {chatMessages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[${msg.role === 'user' ? '80' : '95'}%] rounded-xl px-3.5 py-2.5 ${
                      msg.role === 'user'
                        ? 'bg-emerald-500/15 border border-emerald-500/20'
                        : 'bg-black/30 border border-white/[0.04]'
                    }`}>
                      {msg.role === 'user' ? (
                        <p className="text-[12px] text-emerald-100">{msg.content}</p>
                      ) : (
                        <MarkdownRenderer content={msg.content} />
                      )}
                      {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                        <div className="mt-1.5 flex gap-1 flex-wrap">
                          {msg.toolsUsed.map((t, i) => (
                            <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400/70 border border-emerald-500/10">{t}</span>
                          ))}
                        </div>
                      )}
                      {msg.images && msg.images.length > 0 && (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {msg.images.map((img, i) => (
                            <img key={i} src={`data:image/png;base64,${img.base64}`} alt={img.label}
                              className="rounded-lg w-full aspect-square object-cover border border-white/[0.06]" />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="max-w-[80%] bg-black/30 border border-white/[0.04] rounded-xl px-4 py-3 space-y-1.5">
                      <span className="text-[12px] text-gray-400 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Working…
                      </span>
                      {chatStatus.length > 0 && (
                        <div className="space-y-0.5">
                          {chatStatus.map((s, i) => (
                            <p key={i} className={`text-[11px] ${i === chatStatus.length - 1 ? 'text-gray-400' : 'text-gray-600'} flex items-center gap-1.5`}>
                              {i === chatStatus.length - 1 ? (
                                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                              ) : (
                                <span className="text-emerald-500/60 shrink-0">✓</span>
                              )}
                              {s}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat input — always visible after deliverable */}
              {!isRunning && (
                <div className="p-3 border-t border-white/[0.04] flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleChatSend(); } }}
                    placeholder="Ask a follow-up… refine the brief, generate images, dig deeper"
                    disabled={chatLoading}
                    className="flex-1 rounded-lg border border-white/[0.06] bg-black/40 px-3 py-2.5 text-[12px] text-white placeholder-gray-600 focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/20 focus:outline-none disabled:opacity-50 transition"
                  />
                  <button
                    onClick={() => void handleChatSend()}
                    disabled={!chatInput.trim() || chatLoading}
                    className="px-4 py-2.5 rounded-lg bg-emerald-500 text-black text-[11px] font-semibold disabled:opacity-30 hover:bg-emerald-400 transition shrink-0"
                  >
                    Send
                  </button>
                </div>
              )}
            </div>
          )}


          {/* Image gallery */}
          {images.length > 0 && (
            <div className="rounded-xl border border-white/[0.06] bg-[#111827] p-4 space-y-3">
              <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Generated Images ({images.length})</span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {images.map((img, i) => (
                  <div key={i} className="group relative rounded-lg overflow-hidden border border-white/[0.06] aspect-square bg-black/40">
                    <img src={`data:image/png;base64,${img.base64}`} alt={img.label}
                      className="w-full h-full object-cover" />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                      <p className="text-[10px] text-white truncate">{img.label}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab bar for log vs outputs */}
          {events.length > 0 && (
            <div className="rounded-xl border border-white/[0.06] bg-[#111827] overflow-hidden">
              <div className="flex border-b border-white/[0.04]">
                <button onClick={() => setActiveTab('log')}
                  className={`px-4 py-2.5 text-[11px] font-medium transition ${activeTab === 'log' ? 'text-white border-b-2 border-emerald-500' : 'text-gray-500 hover:text-gray-300'}`}>
                  Activity Log
                </button>
                {images.length > 0 && (
                  <button onClick={() => setActiveTab('images')}
                    className={`px-4 py-2.5 text-[11px] font-medium transition ${activeTab === 'images' ? 'text-white border-b-2 border-emerald-500' : 'text-gray-500 hover:text-gray-300'}`}>
                    Images ({images.length})
                  </button>
                )}
              </div>

              <div className="p-4 max-h-[420px] overflow-auto">
                {activeTab === 'log' && (
                  <div className="space-y-2">
                    {events.filter(e => e.type !== 'image').map((e) => {
                      if (e.type === 'output' && e.data?.type === 'markdown') {
                        return (
                          <div key={e.id} className="rounded-lg border border-white/[0.04] bg-black/30 p-3">
                            <p className="text-[10px] text-emerald-400/70 font-medium mb-1.5">{String(e.data.label || e.message)}</p>
                            <MarkdownRenderer content={String(e.data.content || '').slice(0, 3000)} />
                          </div>
                        );
                      }
                      if (e.type === 'error') return <p key={e.id} className="text-[12px] text-red-400">{e.message}</p>;
                      if (e.type === 'phase_start') {
                        return (
                          <div key={e.id} className="flex items-center gap-2 py-1">
                            <span className="w-1 h-1 rounded-full bg-emerald-500" />
                            <span className="text-[11px] text-emerald-400/80 font-medium">{e.message}</span>
                          </div>
                        );
                      }
                      return (
                        <p key={e.id} className="text-[11px] text-gray-600 pl-3">
                          {e.message}
                        </p>
                      );
                    })}
                    <div ref={logEndRef} />
                  </div>
                )}


                {activeTab === 'images' && (
                  <div className="grid grid-cols-2 gap-3">
                    {images.map((img, i) => (
                      <div key={i} className="rounded-lg overflow-hidden border border-white/[0.06]">
                        <img src={`data:image/png;base64,${img.base64}`} alt={img.label} className="w-full aspect-square object-cover" />
                        <div className="p-2 bg-black/40">
                          <p className="text-[10px] text-gray-300 truncate">{img.label}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!isRunning && !deliverable && events.length === 0 && (
            <div className="rounded-xl border border-white/[0.04] bg-[#111827]/50 p-8 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <h3 className="text-[14px] font-medium text-gray-300 mb-1">Ready to run</h3>
              <p className="text-[12px] text-gray-500 max-w-sm mx-auto">
                Describe a goal and the agent will plan, fan out specialist workers, fetch data, generate images, and synthesize a deliverable.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {['Research 3 matcha competitors', 'Create carousel for product launch', 'Analyze Instagram brand aesthetic'].map((ex) => (
                  <button key={ex} onClick={() => setGoal(ex)}
                    className="text-[11px] px-3 py-1.5 rounded-lg border border-white/[0.06] text-gray-500 hover:text-white hover:border-emerald-500/30 transition">
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GeneralAgentConsole;
