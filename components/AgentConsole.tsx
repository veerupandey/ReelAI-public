import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  AutonomousAgent,
  AgentEvent,
  AgentPhase,
  AgentConfig,
  type ApprovalRequest,
  type AgencyRunContext,
} from '../services/autonomousAgent';
import type { SceneMotionMode } from '../types/brand';
import { isShellServerRunning, createSession, type SessionInfo } from '../services/shellToolService';
import { writeMemory, listMemory, clearMemory, type MemoryEntry, type MemoryPhase, type MemoryScope, type MemorySummary } from '../services/agentMemory';
import { listMcpServers, type McpServerInfo } from '../services/mcpClient';
import type { CreativeReferenceUpload } from '../services/creativeReferenceDirector';
import AdAgentEvalDashboard from './AdAgentEvalDashboard';
import goldenCases from '../evals/ad-agent/cases.json';
import { runIntelligenceEval } from '../services/adIntelligence/evalRunner';
import { CarouselTextEditor, type CarouselSlideWithText, type TextOverlayStyle } from './CarouselTextEditor';
import { applyTextOverlays, type CarouselSlide } from '../services/producers/carouselProducer';
import type { AgencyAgentLaunchParams } from '../services/brandVideoHandoff';
import {
  clearPendingHubLaunch,
  peekAgentLaunchHeavy,
  peekPendingHubLaunch,
  takeAgentLaunchHeavy,
} from '../services/agentLaunchStore';
import {
  AD_AGENT_DEFAULT_I2V_MODEL_ID,
  AD_AGENT_DURATION_MAX,
  AD_AGENT_DURATION_MIN,
  AD_AGENT_DURATION_PRESETS,
  AD_AGENT_I2V_MODEL_OPTIONS,
  AD_AGENT_VOICE_OPTIONS,
  clampAdAgentDurationSec,
  coerceAdAgentI2vModelId,
  estimateAdAgentSceneCount,
  isAdAgentDurationPreset,
} from '../runtime/adAgentOptions';
import {
  coerceVideoVibe,
  defaultVibeForPlatform,
  VIDEO_VIBE_OPTIONS,
  type AdAgentVideoVibe,
} from '../services/adAgentVideoTreatment';
import { captureReferencePostUrl } from '../services/referencePostCapture';
import { missingProductIdentity, resolvePromptUrlRoles } from '../services/promptUrlRoles';
import {
  isDetailsOnlyPhase,
  shouldShowOutput,
  userPhaseLabel,
} from '../services/agentOutputAudience';
import {
  ApprovalGate,
  ConsoleHeader,
  DETAILS_STORAGE_KEY,
  OutputItem,
  PhaseRail,
  SidebarRunStatus,
  StickyRunStatus,
  normalizeAdAgentFileUrl,
  type GoalProgress,
} from './adAgentConsole';
import PlannerModelControls from './PlannerModelControls';
import {
  coercePlannerModelId,
  DEFAULT_PLANNER_MODEL,
  type PlannerModelId,
} from '../services/llm/types';
import { getPlannerModelOption } from '../services/llm/catalog';
import { resolveApiKeyForModel } from '../services/llm/apiKeys';

interface Props {
  userId: string;
  onBack: () => void;
}

/** Module-scoped so React Strict Mode remounts cannot double-fire hub auto-start. */
const recentAutoStarts = new Map<string, number>();
const AUTO_START_DEDUP_MS = 3_000;

const PHASES: { key: AgentPhase; label: string; icon: string }[] = [
  { key: 'plan_loop', label: 'Planning', icon: '🧭' },
  { key: 'research', label: 'Product', icon: '🔬' },
  { key: 'plan_scenes', label: 'Storyboard', icon: '🎬' },
  { key: 'generate_images', label: 'Visuals', icon: '🎨' },
  { key: 'generate_live_motion', label: 'Motion', icon: '✨' },
  { key: 'generate_voiceover', label: 'Voice', icon: '🎙️' },
  { key: 'assemble_video', label: 'Finishing', icon: '⚙️' },
  { key: 'forge_tool', label: 'Tool setup', icon: '🔧' },
  { key: 'deliver', label: 'Ready', icon: '📦' },
];

const VOICE_OPTIONS = AD_AGENT_VOICE_OPTIONS.map((v) => ({
  id: v.value,
  label: v.label,
  desc: v.desc,
}));

const STYLE_OPTIONS: { id: AgentConfig['style']; label: string; desc: string }[] = [
  { id: 'luxe_minimalist', label: 'Luxe Minimalist', desc: 'White, dramatic shadows' },
  { id: 'earthy_organic', label: 'Earthy & Organic', desc: 'Terracotta, raw textures' },
  { id: 'high_energy', label: 'High Energy', desc: 'Bold, fast-paced' },
  { id: 'ugc_style', label: 'UGC Style', desc: 'Raw, creator-native' },
];

const DURATION_OPTIONS = AD_AGENT_DURATION_PRESETS.map((p) => ({
  sec: p.sec,
  scenes: estimateAdAgentSceneCount(p.sec),
  label: p.label,
}));

export const readCreativeReferenceFile = (file: File): Promise<CreativeReferenceUpload> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const previewUrl = String(reader.result || '');
    const [, base64 = ''] = previewUrl.split(',');
    resolve({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      base64,
      mimeType: file.type || 'image/png',
      previewUrl,
      note: '',
    });
  };
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

/**
 * Ingest image and/or video creative references.
 * Videos are sampled into low-res JPEG stills (never uploaded as video).
 */
export async function ingestCreativeReferenceFiles(
  files: File[],
  opts?: { maxTotal?: number },
): Promise<{ uploads: CreativeReferenceUpload[]; errors: string[] }> {
  const {
    extractVideoReferenceFrames,
    isImageReferenceFile,
    isVideoReferenceFile,
  } = await import('../services/videoReferenceFrames');
  const maxTotal = opts?.maxTotal ?? 12;
  const uploads: CreativeReferenceUpload[] = [];
  const errors: string[] = [];

  for (const file of files) {
    if (uploads.length >= maxTotal) {
      errors.push(`Stopped at ${maxTotal} references (skipped remaining files).`);
      break;
    }
    try {
      if (isVideoReferenceFile(file)) {
        const remaining = maxTotal - uploads.length;
        const frames = await extractVideoReferenceFrames(file, {
          maxFrames: Math.min(5, remaining),
        });
        if (!frames.length) {
          errors.push(`${file.name}: no frames extracted.`);
          continue;
        }
        uploads.push(...frames.slice(0, remaining));
      } else if (isImageReferenceFile(file)) {
        uploads.push(await readCreativeReferenceFile(file));
      } else {
        errors.push(`${file.name}: unsupported type (use PNG/JPEG/WebP or MP4/WebM).`);
      }
    } catch (err: any) {
      errors.push(`${file.name}: ${err?.message || 'failed to read'}`);
    }
  }

  return { uploads, errors };
}

export const buildAgentConfigFromLaunchParams = (
  params: Record<string, string | number | boolean>,
  fallback?: Partial<AgentConfig>,
): AgentConfig => {
  const adFormat = (params.adFormat || fallback?.adFormat || 'stitched_video') as AgentConfig['adFormat'];
  let platform = (params.platform || fallback?.platform || 'instagram_reels') as AgentConfig['platform'];
  if (adFormat === 'carousel') platform = 'instagram_carousel';
  if (adFormat === 'static_image') platform = 'instagram_feed';
  const plannerRaw = params.plannerModel || fallback?.plannerModel;
  const plannerModel = coercePlannerModelId(plannerRaw, fallback?.plannerModel || DEFAULT_PLANNER_MODEL);

  const preferLiveMotion = params.preferLiveMotion === true
    || fallback?.preferLiveMotion === true;
  const liveMotionModelId = coerceAdAgentI2vModelId(
    params.liveMotionModelId ?? fallback?.liveMotionModelId,
    AD_AGENT_DEFAULT_I2V_MODEL_ID,
  );

  return {
    adFormat,
    platform,
    durationSec: clampAdAgentDurationSec(params.durationSec ?? fallback?.durationSec ?? 30),
    style: (params.style || fallback?.style || 'luxe_minimalist') as AgentConfig['style'],
    voice: String(params.voice || fallback?.voice || 'Kore'),
    reviewMode: params.reviewMode === true ? 'auto' : fallback?.reviewMode || 'review',
    autoApproveSec: Number(params.autoApproveSec || fallback?.autoApproveSec || 15),
    carouselEditMode: (params.carouselEditMode || fallback?.carouselEditMode || 'auto') as AgentConfig['carouselEditMode'],
    plannerModel,
    plannerApiKey: resolveApiKeyForModel(plannerModel),
    preferLiveMotion: adFormat === 'stitched_video' ? preferLiveMotion : false,
    liveMotionModelId: adFormat === 'stitched_video' ? liveMotionModelId : undefined,
    vibe: coerceVideoVibe(params.vibe ?? fallback?.vibe, defaultVibeForPlatform(platform)),
    includeVoiceover: adFormat === 'stitched_video'
      ? (params.includeVoiceover === false || params.includeVoiceover === 'false'
        ? false
        : (fallback?.includeVoiceover !== false))
      : false,
  };
};

// ── Main Component ─────────────────────────────────────────────────────────────

const AgentConsole: React.FC<Props> = ({ onBack }) => {
  const [prompt, setPrompt] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [currentPhase, setCurrentPhase] = useState<AgentPhase>('idle');
  const [completedPhases, setCompletedPhases] = useState<Set<AgentPhase>>(new Set());
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const [deliverable, setDeliverable] = useState<AgentEvent['result'] | null>(null);
const [showCarouselEditor, setShowCarouselEditor] = useState(false);
const [carouselSlides, setCarouselSlides] = useState<CarouselSlideWithText[]>([]);
const [carouselSession, setCarouselSession] = useState<SessionInfo | null>(null);
const [carouselRawImages, setCarouselRawImages] = useState<string[]>([]);
  const [shellServerOk, setShellServerOk] = useState<boolean | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerInfo[]>([]);

  // Memory feedback
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const [showEvalDashboard, setShowEvalDashboard] = useState(false);
  const [memPhase, setMemPhase] = useState<MemoryPhase>('all');
  const [memScope, setMemScope] = useState<MemoryScope>('global');
  const [memWhatWrong, setMemWhatWrong] = useState('');
  const [memBetter, setMemBetter] = useState('');
  const [memExample, setMemExample] = useState('');
  const [memSaving, setMemSaving] = useState(false);
  const [memSaved, setMemSaved] = useState(false);
  const [memorySummary, setMemorySummary] = useState<MemorySummary[]>([]);

  // Config
  const [platform, setPlatform] = useState<AgentConfig['platform']>('instagram_reels');
  const [adFormat, setAdFormat] = useState<AgentConfig['adFormat']>('stitched_video');
  const [durationSec, setDurationSec] = useState(30);
  const [customDurationDraft, setCustomDurationDraft] = useState('20');
  const [style, setStyle] = useState<AgentConfig['style']>('luxe_minimalist');
  const [voice, setVoice] = useState('Kore');
  const [includeVoiceover, setIncludeVoiceover] = useState(true);
  const [reviewMode, setReviewMode] = useState<AgentConfig['reviewMode']>('review');
  const [autoApproveSec, setAutoApproveSec] = useState(15);
  const [plannerModel, setPlannerModel] = useState<PlannerModelId>(DEFAULT_PLANNER_MODEL);
  const [preferLiveMotion, setPreferLiveMotion] = useState(false);
  const [liveMotionModelId, setLiveMotionModelId] = useState(AD_AGENT_DEFAULT_I2V_MODEL_ID);
  const [vibe, setVibe] = useState<AdAgentVideoVibe>('gen_z_bright');
  const [siliconflowOk, setSiliconflowOk] = useState<boolean | null>(null);
  const [productPackshot, setProductPackshot] = useState<CreativeReferenceUpload | null>(null);
  const [referenceUploads, setReferenceUploads] = useState<CreativeReferenceUpload[]>([]);
  const [referenceUrl, setReferenceUrl] = useState('');
  /** Product URL from the launch envelope — authoritative over prompt text. */
  const [launchProductUrl, setLaunchProductUrl] = useState('');
  const [capturingRef, setCapturingRef] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [agencyRunContext, setAgencyRunContext] = useState<AgencyRunContext | undefined>(undefined);
  const [pendingAutoStart, setPendingAutoStart] = useState(false);
  /** Hub Ad Creator launch — run-and-review UI (no duplicate config editors). */
  const [hubLaunch, setHubLaunch] = useState(false);
  const [lockedBriefPreview, setLockedBriefPreview] = useState('');
  const [userDirectionPreview, setUserDirectionPreview] = useState('');
  const [showDetails, setShowDetails] = useState(() => {
    try {
      return sessionStorage.getItem(DETAILS_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [goalProgress, setGoalProgress] = useState<GoalProgress | null>(null);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const autoStartConsumedRef = useRef(false);
  const autoStartKeyRef = useRef('');
  /** Synchronous lock — React state alone cannot stop double auto-start races. */
  const runLockRef = useRef(false);

  useEffect(() => {
    try {
      sessionStorage.setItem(DETAILS_STORAGE_KEY, showDetails ? '1' : '0');
    } catch {
      // ignore
    }
  }, [showDetails]);

  const agentRef = useRef<AutonomousAgent | null>(null);
  const outputEndRef = useRef<HTMLDivElement>(null);
  const phaseOrder = PHASES.map((p) => p.key);
  const goldenEvalResult = React.useMemo(() => runIntelligenceEval(goldenCases, (item) => ({
    adFormat: item.expectedFormat,
    claims: item.approvedClaims,
    intendedUse: item.allowedUses[0] || 'show product',
    citations: item.approvedClaims.map((_, index) => `${item.id}-citation-${index}`),
    referencesPerScene: [2],
  })), []);

  useEffect(() => {
    isShellServerRunning().then(async (ok) => {
      setShellServerOk(ok);
      if (ok) {
        listMcpServers().then(setMcpServers);
        try {
          const { getSiliconFlowHealth } = await import('../services/siliconflow/client');
          const health = await getSiliconFlowHealth();
          setSiliconflowOk(health.siliconflowConfigured);
        } catch {
          setSiliconflowOk(false);
        }
      } else {
        setSiliconflowOk(false);
      }
    });

    // Agent Hub / Brand Agency → AutonomousAgent handoff (ad-agent only).
    // Memory peek survives Strict Mode / HMR remounts (sessionStorage alone does not).
    const parsed = peekPendingHubLaunch();
    if (parsed) {
      try {
        const { agentId } = parsed;
        let params = parsed.params as Partial<AgencyAgentLaunchParams> & Record<string, unknown>;

        // Rehydrate binary assets stashed in memory (sessionStorage is lean).
        // Peek (not take) so remount can re-apply the same packshot/refs.
        if (parsed.launchId) {
          const heavy = peekAgentLaunchHeavy(parsed.launchId);
          if (heavy) {
            const leanRefs = Array.isArray(params.referenceUploads) ? params.referenceUploads as CreativeReferenceUpload[] : [];
            const mergedRefs = heavy.referenceUploads.map((heavyRef, index) => {
              const lean = leanRefs.find((r) => r.id === heavyRef.id) || leanRefs[index];
              return {
                ...lean,
                ...heavyRef,
                previewUrl: heavyRef.previewUrl
                  || (heavyRef.base64 ? `data:${heavyRef.mimeType};base64,${heavyRef.base64}` : lean?.previewUrl),
              };
            });
            params = {
              ...params,
              sceneAssetBank: heavy.sceneAssetBank,
              referenceUploads: mergedRefs,
              productBase64: heavy.productBase64,
              productMimeType: heavy.productMimeType || params.productMimeType,
            };
          }
        }

        if (agentId !== 'ad-agent') {
          console.warn(`[AgentConsole] Ignoring hub agent '${agentId}' — this console only runs ad-agent.`);
        } else {
          const productUrl = typeof params.productUrl === 'string' ? params.productUrl : '';
          const launchReferenceUrl = typeof params.referenceUrl === 'string' ? params.referenceUrl : '';
          const creativeBrief = typeof params.creativeBrief === 'string' ? params.creativeBrief : '';
          const userDirection = typeof params.userDirection === 'string' ? params.userDirection : '';
          const productTitle = typeof params.productTitle === 'string' ? params.productTitle : '';
          const productBase64 = typeof params.productBase64 === 'string' ? params.productBase64 : undefined;
          const productMimeType = typeof params.productMimeType === 'string' ? params.productMimeType : 'image/png';
          const facts = Array.isArray(params.productFacts) ? params.productFacts as string[] : [];
          const isHubLaunch = params.hubLaunch === true
            || String(params.source || '') === 'product_upload'
            || Boolean(creativeBrief || userDirection || productBase64 || facts.length);

          if (isHubLaunch) {
            setHubLaunch(true);
            setLockedBriefPreview(creativeBrief);
            setUserDirectionPreview(userDirection);
          }

          // URL roles travel as data so the agent never re-guesses them from prose.
          if (productUrl) setLaunchProductUrl(productUrl);
          if (launchReferenceUrl) setReferenceUrl(launchReferenceUrl);

          // Prompt surface: human direction + URL (locked brief stays in preview + AgencyRunContext).
          if (userDirection && productUrl) {
            setPrompt(`${userDirection}\n\n${productUrl}`);
          } else if (userDirection) {
            setPrompt(userDirection);
          } else if (creativeBrief && productUrl) {
            setPrompt(`${creativeBrief}\n\n${productUrl}`);
          } else if (productUrl) {
            setPrompt(`Create a ${params.durationSec || 30}s ${String(params.platform || 'instagram_reels').replace(/_/g, ' ')} ad for: ${productUrl}`);
          } else if (productBase64) {
            setPrompt(
              userDirection
                || creativeBrief
                || `Create a ${params.durationSec || 30}s ${String(params.platform || 'instagram_reels').replace(/_/g, ' ')} ad for ${productTitle || 'this product'} (product packshot uploaded).`,
            );
          }

          if (params.adFormat) setAdFormat(params.adFormat as AgentConfig['adFormat']);
          if (params.platform) setPlatform(params.platform as AgentConfig['platform']);
          if (params.durationSec !== undefined) {
            const next = clampAdAgentDurationSec(params.durationSec);
            setDurationSec(next);
            if (!isAdAgentDurationPreset(next)) setCustomDurationDraft(String(next));
          }
          if (params.style) setStyle(params.style as AgentConfig['style']);
          if (params.voice) setVoice(params.voice as string);
          if (params.includeVoiceover === false || params.includeVoiceover === 'false') {
            setIncludeVoiceover(false);
          } else if (params.includeVoiceover === true || params.includeVoiceover === 'true') {
            setIncludeVoiceover(true);
          }
          if (params.reviewMode !== undefined) setReviewMode(params.reviewMode ? 'auto' : 'review');
          if (params.autoApproveSec) setAutoApproveSec(Number(params.autoApproveSec));
          if (params.plannerModel) {
            setPlannerModel(coercePlannerModelId(params.plannerModel));
          }
          if (params.preferLiveMotion === true) setPreferLiveMotion(true);
          if (params.liveMotionModelId !== undefined) {
            setLiveMotionModelId(coerceAdAgentI2vModelId(params.liveMotionModelId));
          }
          if (params.vibe !== undefined || params.platform) {
            setVibe(coerceVideoVibe(
              params.vibe,
              defaultVibeForPlatform(String(params.platform || 'instagram_reels')),
            ));
          }
          if (Array.isArray(params.referenceUploads)) setReferenceUploads(params.referenceUploads as CreativeReferenceUpload[]);

          if (productBase64) {
            setProductPackshot({
              id: 'hub-product-packshot',
              name: productTitle || 'Product packshot',
              base64: productBase64,
              mimeType: productMimeType,
              previewUrl: `data:${productMimeType};base64,${productBase64}`,
              note: 'Product packshot',
            });
          }

          if (params.source === 'brand_video_agency') {
            setAgencyRunContext({
              source: 'brand_video_agency',
              lockPlan: params.lockPlan !== false,
              skipResearch: Boolean(params.skipResearch),
              productTitle: productTitle || undefined,
              productFacts: facts,
              productBase64,
              productMimeType,
              seedScenes: Array.isArray(params.seedScenes) ? params.seedScenes as AgencyRunContext['seedScenes'] : undefined,
              sceneAssetBank: params.sceneAssetBank && typeof params.sceneAssetBank === 'object'
                ? params.sceneAssetBank as AgencyRunContext['sceneAssetBank']
                : undefined,
              approvedConcept: params.approvedConcept && typeof params.approvedConcept === 'object'
                ? params.approvedConcept as AgencyRunContext['approvedConcept']
                : undefined,
            });
          } else if (productBase64 || facts.length || creativeBrief || userDirection) {
            const skipResearch = params.skipResearch === true
              || Boolean(productBase64 && facts.length > 0);
            setAgencyRunContext({
              source: 'product_upload',
              skipResearch,
              skipBrandAndTrends: params.skipBrandAndTrends === true || (skipResearch && Boolean(creativeBrief)),
              creativeBrief: creativeBrief || undefined,
              userDirection: userDirection || undefined,
              productTitle: productTitle || undefined,
              productFacts: facts,
              productBase64,
              productMimeType,
            });
          }

          // Hub launches always auto-start when shell is ready (plan P1).
          if (params.autoStart === true || isHubLaunch) {
            const key = [
              productUrl,
              launchReferenceUrl,
              userDirection.slice(0, 120),
              String(params.durationSec || ''),
              String(params.adFormat || ''),
            ].join('|');
            autoStartKeyRef.current = key;
            setPendingAutoStart(true);
          }
        }
      } catch {}
    }
  }, []);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events, pendingApproval]);

  const handleEvent = useCallback((event: AgentEvent) => {
    setEvents((prev) => [...prev, event]);

    if (event.type === 'phase_start' && event.phase) {
      setCurrentPhase(event.phase);
      setCompletedPhases((prev) => {
        const next = new Set(prev);
        const idx = phaseOrder.indexOf(event.phase!);
        phaseOrder.slice(0, idx).forEach((p) => next.add(p));
        return next;
      });
    }

    if (event.goalProgress) {
      setGoalProgress(event.goalProgress);
    }

    if (event.type === 'status' && event.message) {
      const msg = event.message.toLowerCase();
      setIsBrowsing(/\bbrowsing\b|\bcapturing reference\b|\bnavigating to\b/.test(msg));
    }

    // Milestone steps drive the browsing indicator now that they replaced status chatter.
    if (event.type === 'output' && event.output?.label === 'Step') {
      const text = (event.output.content || '').toLowerCase();
      setIsBrowsing(/\bbrowsing\b|\bcapturing reference\b/.test(text));
    }

    // Detect carousel studio mode completion from status event
    if (event.type === 'status' && event.phase === 'export_carousel' && event.message?.includes('Open Text Studio')) {
      const carouselOutputEvents = events.filter(e => e.type === 'output' && e.phase === 'export_carousel' && e.output?.type === 'image');
      if (carouselOutputEvents.length > 0) {
        const slides: CarouselSlideWithText[] = carouselOutputEvents.map((e, i) => ({
          index: i,
          imageUrl: e.output?.url || '',
          headline: e.output?.label?.replace(`Slide ${i + 1}: `, '') || '',
          body: '',
        }));
        setCarouselSlides(slides);
        setCarouselRawImages(slides.map(s => s.imageUrl));
        // Create session for text overlay application
        createSession('ad-agent', 'test-brand', 'test-product').then(session => {
          setCarouselSession(session);
          setShowCarouselEditor(true);
        });
      }
    }

    if (event.type === 'approval_needed' && event.approval) {
      setPendingApproval(event.approval);
    }

    if (event.type === 'approval_resolved') {
      setPendingApproval(null);
    }

    if (event.type === 'complete') {
      setIsRunning(false);
      setPendingApproval(null);
      setDeliverable(event.result || null);
      setCompletedPhases(new Set(phaseOrder));
      setIsBrowsing(false);
    }

    if (event.type === 'error' || event.type === 'stopped') {
      setIsRunning(false);
      setPendingApproval(null);
      setIsBrowsing(false);
    }
  }, [phaseOrder, events]);

  const handleRun = useCallback(async () => {
    if (!prompt.trim() || isRunning || runLockRef.current) return;
    const hasPackshot = Boolean(productPackshot?.base64 || agencyRunContext?.productBase64);
    const urlRoles = resolvePromptUrlRoles({
      prompt,
      explicitProductUrl: launchProductUrl,
      explicitReferenceUrl: referenceUrl,
      hasPackshot,
    });
    const hasUrl = Boolean(urlRoles.productUrl);
    if (missingProductIdentity(urlRoles, { hasPackshot })) {
      setEvents([{
        id: `evt_${Date.now()}`,
        type: 'error',
        timestamp: Date.now(),
        message: urlRoles.referenceUrl
          ? 'That link is a creative reference, not your product. Add your product page URL, or upload a packshot.'
          : 'Add a product URL in the prompt, or upload a product packshot first.',
      }]);
      return;
    }
    runLockRef.current = true;
    // Kill any in-flight run before starting a new one (Strict Mode / double launch).
    try { agentRef.current?.stop(); } catch { /* ignore */ }
    // Launch envelope already applied into React state — drop remount stash.
    clearPendingHubLaunch();
    setEvents([]);
    setCompletedPhases(new Set());
    setDeliverable(null);
    setPendingApproval(null);
    setGoalProgress(null);
    setIsBrowsing(false);
    setCurrentPhase('research');
    setIsRunning(true);

    const agent = new AutonomousAgent();
    agentRef.current = agent;

    const config = buildAgentConfigFromLaunchParams(
      {
        adFormat,
        platform,
        durationSec,
        style,
        voice,
        includeVoiceover,
        reviewMode: reviewMode === 'auto',
        autoApproveSec,
        carouselEditMode: 'studio',
        plannerModel,
        preferLiveMotion,
        liveMotionModelId,
        vibe,
      },
    );
    const packshotBase64 = productPackshot?.base64 || agencyRunContext?.productBase64;
    const urlRoleContext = {
      productUrl: urlRoles.productUrl,
      referenceUrl: urlRoles.referenceUrl,
    };
    const baseRunContext: AgencyRunContext | undefined = packshotBase64
      ? {
          ...agencyRunContext,
          source: agencyRunContext?.source || 'product_upload',
          skipResearch: agencyRunContext?.skipResearch ?? !hasUrl,
          skipBrandAndTrends: agencyRunContext?.skipBrandAndTrends,
          creativeBrief: agencyRunContext?.creativeBrief || lockedBriefPreview || undefined,
          userDirection: agencyRunContext?.userDirection || userDirectionPreview || undefined,
          productTitle: agencyRunContext?.productTitle || productPackshot?.name.replace(/\.[^.]+$/, '') || undefined,
          productBase64: packshotBase64,
          productMimeType: productPackshot?.mimeType || agencyRunContext?.productMimeType || 'image/png',
        }
        : agencyRunContext
        ? {
            ...agencyRunContext,
            creativeBrief: agencyRunContext.creativeBrief || lockedBriefPreview || undefined,
            userDirection: agencyRunContext.userDirection || userDirectionPreview || undefined,
          }
        : undefined;
    const runContext: AgencyRunContext = { ...baseRunContext, ...urlRoleContext };
    try {
      await agent.run(prompt, config, handleEvent, referenceUploads, runContext);
    } finally {
      runLockRef.current = false;
      setIsRunning(false);
    }
  }, [prompt, isRunning, adFormat, platform, durationSec, style, voice, includeVoiceover, reviewMode, autoApproveSec, plannerModel, preferLiveMotion, liveMotionModelId, vibe, referenceUploads, referenceUrl, launchProductUrl, agencyRunContext, productPackshot, lockedBriefPreview, userDirectionPreview, handleEvent]);

  useEffect(() => {
    // Wait for shell preflight before Agency auto-start so video assembly doesn't fail closed mid-run.
    if (!pendingAutoStart || !prompt.trim() || isRunning || autoStartConsumedRef.current) return;
    if (shellServerOk === null) return;
    if (agencyRunContext?.source === 'brand_video_agency' && shellServerOk === false) {
      // Stay ready — user must start shell then click Run. Don't consume auto-start forever.
      return;
    }
    const key = autoStartKeyRef.current || prompt.slice(0, 160);
    const now = Date.now();
    const last = recentAutoStarts.get(key) || 0;
    if (now - last < AUTO_START_DEDUP_MS) {
      autoStartConsumedRef.current = true;
      setPendingAutoStart(false);
      return;
    }
    recentAutoStarts.set(key, now);
    autoStartConsumedRef.current = true;
    setPendingAutoStart(false);
    void handleRun();
  }, [pendingAutoStart, prompt, isRunning, handleRun, shellServerOk, agencyRunContext?.source]);

  const handleStop = () => {
    agentRef.current?.stop();
    runLockRef.current = false;
    setIsRunning(false);
    setPendingApproval(null);
  };

  const handleCarouselExport = async (slides: CarouselSlideWithText[], style: TextOverlayStyle) => {
    if (!carouselSession) return;

    try {
      const carouselSlidesForProducer: CarouselSlide[] = slides.map((s, i) => ({
        index: i,
        imagePrompt: '',
        headline: s.headline,
        body: s.body,
        useProductAsReference: false,
        imageUrl: carouselRawImages[i],
      }));

      const finalUrls = await applyTextOverlays(
        carouselSlidesForProducer,
        style,
        carouselSession,
        (e) => setEvents(prev => [...prev, e]),
      );

      // Update deliverable with final carousel images
      const baseUrl = carouselSession.baseUrl;
      setDeliverable({
        adFormat: 'carousel',
        carouselImageUrls: finalUrls,
        sceneImages: slides.map((s, i) => ({
          url: `${baseUrl}/${finalUrls[i].split('/').filter(Boolean).pop() || finalUrls[i]}`,
          label: `Slide ${i + 1}: ${s.headline}`,
        })),
        script: slides.map((s, i) => `Slide ${i + 1}: ${s.headline}\n${s.body}`).join('\n\n'),
        durationSec: 0,
        sessionDir: carouselSession.sessionDir,
        postCaption: '',
      });

      setShowCarouselEditor(false);
    } catch (error) {
      console.error('Carousel export failed:', error);
      alert('Failed to apply text overlays. Please try again.');
    }
  };

  const handleApprovalResolve = useCallback((
    approved: boolean,
    feedback: string,
    sceneMotionModes?: Array<{ index: number; motionMode: SceneMotionMode }>,
  ) => {
    if (!pendingApproval || !agentRef.current) return;
    const forgeId = pendingApproval.forgeDraft?.forgeId;
    if (forgeId && approved) {
      void agentRef.current.resolveForgeApproval(forgeId, true);
    }
    agentRef.current.resolveApproval(
      pendingApproval.approvalId,
      approved,
      feedback,
      sceneMotionModes,
      forgeId,
    );
    setPendingApproval(null);
  }, [pendingApproval]);

  // Load memory summary whenever the panel opens
  useEffect(() => {
    if (showMemoryPanel) listMemory().then(setMemorySummary);
  }, [showMemoryPanel]);

  const handleSaveMemory = async () => {
    if (!memWhatWrong.trim() || !memBetter.trim()) return;
    setMemSaving(true);
    const entry: MemoryEntry = {
      phase: memPhase,
      what_went_wrong: memWhatWrong.trim(),
      better_approach: memBetter.trim(),
      ...(memExample.trim() ? { example: memExample.trim() } : {}),
    };
    // Derive brand slug from last run URL if available
    const brandSlug = prompt.match(/https?:\/\/([^\/]+)/)?.[1]?.replace(/^www\./, '').split('.')[0] ?? '';
    await writeMemory(entry, memScope, memScope === 'brand' ? brandSlug : undefined);
    setMemSaving(false);
    setMemSaved(true);
    setMemWhatWrong('');
    setMemBetter('');
    setMemExample('');
    listMemory().then(setMemorySummary);
    setTimeout(() => setMemSaved(false), 2500);
  };

  const outputEvents = events.filter((e) => {
    if (e.type !== 'output' || !e.output) return false;
    return shouldShowOutput({
      audience: e.output.audience,
      label: e.output.label,
      type: e.output.type,
      showDetails,
      approvalPending: Boolean(pendingApproval),
    });
  });
  const errorEvents = events.filter((e) => e.type === 'error');
  // Messageless status events only carry goal progress — they must not blank the status line.
  const statusLog = events.filter((e) => e.type === 'status' && Boolean(e.message));
  const stepEvents = events.filter((e) => e.type === 'output' && e.output?.label === 'Step');
  const latestStep = stepEvents[stepEvents.length - 1]?.output?.content || '';
  const latestStatus = latestStep || statusLog[statusLog.length - 1]?.message || '';
  const isStillFormat = adFormat === 'carousel' || adFormat === 'static_image';
  const hasLiveMotionSeed = Boolean(
    agencyRunContext?.seedScenes?.some((s) => (s.motionMode || 'still') === 'live_motion'),
  );
  const visiblePhases = PHASES.filter((phase) => {
    if (!showDetails && isDetailsOnlyPhase(phase.key)) return false;
    if (phase.key === 'generate_live_motion') {
      return !isStillFormat && (hasLiveMotionSeed || adFormat === 'stitched_video');
    }
    if (phase.key === 'generate_voiceover') {
      return !isStillFormat && includeVoiceover;
    }
    if (!isStillFormat) return true;
    return phase.key !== 'assemble_video';
  });
  const phaseProgressLabel = userPhaseLabel(currentPhase);
  const showGoalProgress = Boolean(
    goalProgress
    && (showDetails || goalProgress.skillPath === 'recreate_reference_video'),
  );
  const headerSubtitle = agencyRunContext?.source === 'brand_video_agency'
    ? (pendingApproval ? '⏸ Agency handoff · waiting for your input' : isRunning ? `Agency lock · ${phaseProgressLabel}` : 'Agency handoff ready')
    : hubLaunch
      ? (pendingApproval ? '⏸ Hub launch · waiting for your input' : isRunning ? `Hub launch · ${phaseProgressLabel}` : 'Hub launch · run & review')
      : (pendingApproval ? '⏸ Waiting for your input' : isRunning ? phaseProgressLabel : 'Ready');

  const estScenes = estimateAdAgentSceneCount(durationSec);
  const usingCustomDuration = !isAdAgentDurationPreset(durationSec);
  const outputUnit = adFormat === 'carousel' ? 'slides' : adFormat === 'static_image' ? 'image' : 'scenes';

  return (
    <div className="min-h-screen bg-dark-bg flex flex-col">
      <ConsoleHeader
        onBack={() => {
          clearPendingHubLaunch();
          onBack();
        }}
        subtitle={headerSubtitle}
        shellServerOk={shellServerOk}
        siliconflowOk={siliconflowOk}
        mcpServers={mcpServers}
        showDetails={showDetails}
        onToggleDetails={() => setShowDetails((v) => !v)}
        showMemoryPanel={showMemoryPanel}
        onToggleMemory={() => setShowMemoryPanel((v) => !v)}
        showEvalDashboard={showEvalDashboard}
        onToggleEvals={() => setShowEvalDashboard((v) => !v)}
        isRunning={isRunning}
        onStop={handleStop}
        hubBadge={hubLaunch && agencyRunContext?.source !== 'brand_video_agency'
          ? `From Ad Creator${agencyRunContext?.skipResearch ? ' · research locked' : ''}`
          : null}
        agencyBadge={agencyRunContext?.source === 'brand_video_agency'
          ? `Agency lock · ${agencyRunContext.seedScenes?.length || 0} scenes${agencyRunContext.seedScenes?.some((s) => s.preserveExactAsset) ? ' · exact assets' : ''}`
          : null}
      />

      {/* ── Agent Memory Panel ─────────────────────────────────────────── */}
      {showMemoryPanel && (
        <div className="max-w-[1800px] mx-auto w-full px-4 py-3 border-b border-purple-500/20 bg-purple-500/5">
          <div className="flex items-start gap-6">
            {/* Feedback form */}
            <div className="flex-1 space-y-3">
              <p className="text-xs font-semibold text-purple-300 uppercase tracking-wider">Teach the agent from this run</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">Phase</label>
                  <select value={memPhase} onChange={(e) => setMemPhase(e.target.value as MemoryPhase)}
                    className="w-full px-2 py-1.5 rounded-lg bg-dark-card border border-dark-border text-white text-xs focus:outline-none focus:border-purple-500">
                    <option value="all">All phases</option>
                    <option value="plan_scenes">Scene Plan</option>
                    <option value="generate_images">Image Generation</option>
                    <option value="generate_voiceover">Voiceover</option>
                    <option value="assemble_video">Assembly</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">Scope</label>
                  <select value={memScope} onChange={(e) => setMemScope(e.target.value as MemoryScope)}
                    className="w-full px-2 py-1.5 rounded-lg bg-dark-card border border-dark-border text-white text-xs focus:outline-none focus:border-purple-500">
                    <option value="global">Global (all brands)</option>
                    <option value="brand">This brand only</option>
                  </select>
                </div>
              </div>
              <textarea value={memWhatWrong} onChange={(e) => setMemWhatWrong(e.target.value)}
                placeholder="What did the agent do wrong? e.g. 'used walnut in ingredients, product page says jojoba'"
                className="w-full px-3 py-2 rounded-lg bg-dark-card border border-dark-border text-white placeholder-gray-600 focus:border-red-500/60 focus:outline-none resize-none text-xs"
                rows={2} />
              <textarea value={memBetter} onChange={(e) => setMemBetter(e.target.value)}
                placeholder="What would have been better? e.g. 'always use only ingredients from the product page facts list'"
                className="w-full px-3 py-2 rounded-lg bg-dark-card border border-dark-border text-white placeholder-gray-600 focus:border-emerald-500/60 focus:outline-none resize-none text-xs"
                rows={2} />
              <input value={memExample} onChange={(e) => setMemExample(e.target.value)}
                placeholder="Optional example (e.g. 'jojoba oil, not walnut shells')"
                className="w-full px-3 py-2 rounded-lg bg-dark-card border border-dark-border text-white placeholder-gray-600 focus:border-purple-500 focus:outline-none text-xs" />
              <button onClick={handleSaveMemory}
                disabled={memSaving || !memWhatWrong.trim() || !memBetter.trim()}
                className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-semibold transition-all">
                {memSaved ? '✓ Saved to memory' : memSaving ? 'Saving...' : 'Save to Agent Memory'}
              </button>
            </div>

            {/* Memory summary */}
            <div className="w-64 flex-shrink-0 space-y-2">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Stored memory files</p>
              {memorySummary.length === 0
                ? <p className="text-xs text-gray-600">No memory yet.</p>
                : memorySummary.map((m) => (
                  <div key={m.file} className="flex items-center justify-between bg-dark-card border border-dark-border rounded-lg px-3 py-2">
                    <div>
                      <p className="text-xs text-white font-mono">{m.file}</p>
                      <p className="text-[10px] text-gray-500">{m.count} entr{m.count === 1 ? 'y' : 'ies'}</p>
                    </div>
                    <button onClick={async () => {
                      const scope: MemoryScope = m.file.startsWith('brand-') ? 'brand' : 'global';
                      const brandSlug = m.file.replace('brand-', '').replace('.jsonl', '');
                      await clearMemory(scope, scope === 'brand' ? brandSlug : undefined);
                      listMemory().then(setMemorySummary);
                    }} className="text-[10px] text-red-400 hover:text-red-300 transition-colors">clear</button>
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      )}
      {showEvalDashboard && (
        <div className="max-w-[1800px] mx-auto w-full px-4 py-3 border-b border-emerald-500/20 bg-emerald-500/5">
          <AdAgentEvalDashboard result={goldenEvalResult} />
        </div>
      )}

      <div className="flex-1 flex max-w-[1800px] mx-auto w-full">
        {/* Left sidebar */}
        <div className="w-64 flex-shrink-0 border-r border-dark-border flex flex-col">

          {/* Hub launch: read-only setup summary (no duplicate editors) */}
          {hubLaunch && !isRunning && events.length === 0 && (
            <div className="p-4 space-y-3 border-b border-dark-border">
              <p className="text-[10px] uppercase tracking-wider text-gray-500">Setup from Ad Creator</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  adFormat.replace(/_/g, ' '),
                  platform.replace(/_/g, ' '),
                  !isStillFormat ? `${durationSec}s` : null,
                  style.replace(/_/g, ' '),
                  !isStillFormat ? (includeVoiceover ? voice : 'silent') : null,
                  reviewMode === 'auto' ? `Auto ${autoApproveSec}s` : 'Review gates',
                  getPlannerModelOption(plannerModel).label,
                  !isStillFormat ? (VIDEO_VIBE_OPTIONS.find((v) => v.value === vibe)?.label || null) : null,
                  preferLiveMotion && adFormat === 'stitched_video'
                    ? `Live Motion · ${AD_AGENT_I2V_MODEL_OPTIONS.find((m) => m.value === liveMotionModelId)?.label || 'I2V'}`
                    : null,
                  agencyRunContext?.skipResearch ? 'Research locked' : null,
                ].filter(Boolean).map((bit) => (
                  <span
                    key={String(bit)}
                    className="text-[10px] px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.04] text-gray-400"
                  >
                    {bit}
                  </span>
                ))}
              </div>
              <p className="text-[10px] text-gray-600 leading-relaxed">
                Edit setup in Ad Creator. This console runs and reviews the pipeline.
              </p>
            </div>
          )}

          {/* Cold-open config (hidden while running, and hidden for Hub launches) */}
          {!hubLaunch && !isRunning && events.length === 0 && (
            <div className="p-4 space-y-4 border-b border-dark-border overflow-y-auto">
              <p className="text-[10px] uppercase tracking-wider text-gray-500">Campaign Config</p>

              {/* Duration */}
              {!isStillFormat && <div className="space-y-1.5">
                <p className="text-[11px] text-gray-400">Duration & Scenes</p>
                <div className="grid grid-cols-1 gap-1">
                  {DURATION_OPTIONS.map(({ sec, scenes, label }) => (
                    <button key={sec} onClick={() => setDurationSec(sec)}
                      className={`py-1.5 px-2 rounded-lg text-[11px] text-left font-medium transition-all flex justify-between ${durationSec === sec ? 'bg-purple-500/20 border border-purple-500/40 text-purple-200' : 'bg-dark-bg border border-dark-border text-gray-500 hover:text-white'}`}>
                      <span>{sec}s · {label}</span>
                      <span className="text-gray-600">{scenes} scenes</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const next = clampAdAgentDurationSec(customDurationDraft);
                      setCustomDurationDraft(String(next));
                      setDurationSec(next);
                    }}
                    className={`py-1.5 px-2 rounded-lg text-[11px] text-left font-medium transition-all flex justify-between gap-2 ${usingCustomDuration ? 'bg-purple-500/20 border border-purple-500/40 text-purple-200' : 'bg-dark-bg border border-dark-border text-gray-500 hover:text-white'}`}
                  >
                    <span>Custom</span>
                    <span className="text-gray-600">{estScenes} scenes</span>
                  </button>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="number"
                    min={AD_AGENT_DURATION_MIN}
                    max={AD_AGENT_DURATION_MAX}
                    value={usingCustomDuration ? durationSec : customDurationDraft}
                    onChange={(e) => {
                      setCustomDurationDraft(e.target.value);
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) setDurationSec(clampAdAgentDurationSec(n));
                    }}
                    onFocus={() => {
                      if (!usingCustomDuration) {
                        const next = clampAdAgentDurationSec(customDurationDraft);
                        setDurationSec(next);
                      }
                    }}
                    className="w-20 rounded-lg border border-dark-border bg-dark-bg px-2 py-1.5 text-[11px] text-white focus:border-purple-400 focus:outline-none"
                  />
                  <span className="text-[10px] text-gray-500">
                    custom seconds ({AD_AGENT_DURATION_MIN}–{AD_AGENT_DURATION_MAX})
                  </span>
                </div>
              </div>}

              {/* Platform */}
              <div className="space-y-1.5">
                <p className="text-[11px] text-gray-400">Platform</p>
                <div className="space-y-1">
                  {(adFormat === 'carousel' ? ['instagram_carousel'] : adFormat === 'static_image' ? ['instagram_feed'] : ['instagram_reels', 'tiktok', 'youtube_shorts'] as AgentConfig['platform'][]).map((p) => (
                    <button key={p} onClick={() => setPlatform(p)}
                      className={`w-full py-1.5 px-2 rounded-lg text-[11px] text-left transition-all ${platform === p ? 'bg-purple-500/20 border border-purple-500/40 text-purple-200' : 'bg-dark-bg border border-dark-border text-gray-500 hover:text-white'}`}>
                      {p.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Planner / main agent model */}
              <div className="space-y-1.5">
                <p className="text-[11px] text-gray-400">Planner / Agent model</p>
                <PlannerModelControls
                  value={plannerModel}
                  onChange={setPlannerModel}
                  variant="list"
                />
              </div>

              {/* Live Motion (Video Ad stills → multi-provider I2V) */}
              {adFormat === 'stitched_video' && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-gray-400">Live Motion</p>
                  <button
                    type="button"
                    onClick={() => setPreferLiveMotion((v) => !v)}
                    className={`w-full py-2 px-2 rounded-lg text-[11px] text-left transition-all ${
                      preferLiveMotion
                        ? 'bg-teal-500/20 border border-teal-500/40 text-teal-100'
                        : 'bg-dark-bg border border-dark-border text-gray-500 hover:text-white'
                    }`}
                  >
                    <span className="font-semibold">{preferLiveMotion ? 'On · default all scenes' : 'Off · Ken Burns stills'}</span>
                    <p className="text-[9px] text-gray-600 mt-0.5">
                      Animate product stills with Seedance, Kling, Veo, Grok, or Wan. Flip per scene at the plan gate.
                    </p>
                  </button>
                  {preferLiveMotion && (
                    <label className="block space-y-1">
                      <span className="text-[10px] text-gray-500">I2V model</span>
                      <select
                        value={liveMotionModelId}
                        onChange={(e) => setLiveMotionModelId(coerceAdAgentI2vModelId(e.target.value))}
                        className="w-full rounded-lg border border-dark-border bg-dark-bg px-2 py-1.5 text-[11px] text-gray-200 focus:outline-none focus:ring-1 focus:ring-teal-500/50"
                        aria-label="Live Motion I2V model"
                      >
                        {AD_AGENT_I2V_MODEL_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label} — {opt.description}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}

              {/* Style */}
              <div className="space-y-1.5">
                <p className="text-[11px] text-gray-400">Visual Style</p>
                <div className="space-y-1">
                  {STYLE_OPTIONS.map((s) => (
                    <button key={s.id} onClick={() => setStyle(s.id)}
                      className={`w-full py-1.5 px-2 rounded-lg text-[11px] text-left transition-all ${style === s.id ? 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-200' : 'bg-dark-bg border border-dark-border text-gray-500 hover:text-white'}`}>
                      <span>{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Vibe (video energy + VO voice) */}
              {!isStillFormat && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-gray-400">Vibe</p>
                  <div className="space-y-1">
                    {VIDEO_VIBE_OPTIONS.map((v) => (
                      <button key={v.value} onClick={() => setVibe(v.value)}
                        className={`w-full py-1.5 px-2 rounded-lg text-[11px] text-left transition-all ${vibe === v.value ? 'bg-teal-500/20 border border-teal-500/40 text-teal-100' : 'bg-dark-bg border border-dark-border text-gray-500 hover:text-white'}`}>
                        <span className="font-medium">{v.label}</span>
                        <span className="block text-[10px] text-gray-500">{v.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Voiceover on/off + voice picker */}
              {!isStillFormat && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-gray-400">Voiceover</p>
                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={() => setIncludeVoiceover(true)}
                      className={`w-full py-2 px-2 rounded-lg text-[11px] text-left transition-all ${includeVoiceover ? 'bg-pink-500/20 border border-pink-500/40 text-pink-200' : 'bg-dark-bg border border-dark-border text-gray-500 hover:text-white'}`}
                    >
                      <span className="font-semibold">With voice</span>
                      <p className="text-[9px] text-gray-600 mt-0.5">Generate TTS and mix into the final video</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIncludeVoiceover(false)}
                      className={`w-full py-2 px-2 rounded-lg text-[11px] text-left transition-all ${!includeVoiceover ? 'bg-slate-500/20 border border-slate-400/40 text-slate-200' : 'bg-dark-bg border border-dark-border text-gray-500 hover:text-white'}`}
                    >
                      <span className="font-semibold">No voice (silent)</span>
                      <p className="text-[9px] text-gray-600 mt-0.5">Skip TTS — music-free silent video; captions may still burn</p>
                    </button>
                  </div>
                  {includeVoiceover && (
                    <div className="space-y-1 pt-1">
                      <p className="text-[10px] text-gray-500">Voice</p>
                      {VOICE_OPTIONS.map((v) => (
                        <button key={v.id} onClick={() => setVoice(v.id)}
                          className={`w-full py-1.5 px-2 rounded-lg text-[11px] text-left transition-all ${voice === v.id ? 'bg-pink-500/20 border border-pink-500/40 text-pink-200' : 'bg-dark-bg border border-dark-border text-gray-500 hover:text-white'}`}>
                          {v.label} <span className="text-gray-600">— {v.desc}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Review mode */}
              <div className="space-y-1.5">
                <p className="text-[11px] text-gray-400">Review Mode</p>
                <div className="space-y-1">
                  <button onClick={() => setReviewMode('review')}
                    className={`w-full py-2 px-2 rounded-lg text-[11px] text-left transition-all ${reviewMode === 'review' ? 'bg-amber-500/20 border border-amber-500/40 text-amber-200' : 'bg-dark-bg border border-dark-border text-gray-500 hover:text-white'}`}>
                    <span className="font-semibold">Review</span>
                    <p className="text-[9px] text-gray-600 mt-0.5">Agent pauses and waits for you at each gate</p>
                  </button>
                  <button onClick={() => setReviewMode('auto')}
                    className={`w-full py-2 px-2 rounded-lg text-[11px] text-left transition-all ${reviewMode === 'auto' ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-200' : 'bg-dark-bg border border-dark-border text-gray-500 hover:text-white'}`}>
                    <span className="font-semibold">Auto</span>
                    <p className="text-[9px] text-gray-600 mt-0.5">Agent self-approves after countdown (you can still intercept)</p>
                  </button>
                </div>
                {reviewMode === 'auto' && (
                  <div className="flex items-center gap-2 pt-1">
                    <input type="range" min={5} max={60} value={autoApproveSec}
                      onChange={(e) => setAutoApproveSec(Number(e.target.value))}
                      className="flex-1 accent-emerald-500" />
                    <span className="text-[11px] text-emerald-300 w-10 text-right">{autoApproveSec}s</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <PhaseRail
            phases={visiblePhases}
            currentPhase={currentPhase}
            completedPhases={completedPhases}
            isRunning={isRunning}
            pendingApproval={Boolean(pendingApproval)}
          />

          <SidebarRunStatus
            isRunning={isRunning}
            phaseLabel={phaseProgressLabel}
            latestStatus={latestStatus}
            showDetails={showDetails}
            statusLog={statusLog}
            goalProgress={goalProgress}
            showGoalProgress={showGoalProgress}
            isBrowsing={isBrowsing}
          />
        </div>

        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Prompt bar */}
          <div className="border-b border-dark-border p-4">
            {/* Hub launch: locked brief + optional packshot thumb (no upload editors) */}
            {hubLaunch && !isRunning && (lockedBriefPreview || productPackshot) && (
              <div className="mb-3 space-y-3">
                {lockedBriefPreview && (
                  <details className="rounded-xl border border-teal-500/25 bg-teal-500/5 p-3 group">
                    <summary className="cursor-pointer text-xs font-semibold text-teal-200 list-none flex items-center justify-between gap-2">
                      <span>Locked brief{userDirectionPreview ? ' · from researcher' : ''}</span>
                      <span className="text-[10px] text-teal-400/70 font-normal group-open:hidden">Show</span>
                      <span className="text-[10px] text-teal-400/70 font-normal hidden group-open:inline">Hide</span>
                    </summary>
                    <p className="mt-2 text-[11px] text-gray-400 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                      {lockedBriefPreview}
                    </p>
                  </details>
                )}
                {productPackshot && (
                  <div className="flex items-center gap-3 rounded-xl border border-dark-border bg-dark-card/40 px-3 py-2">
                    <img src={productPackshot.previewUrl} alt={productPackshot.name} className="h-12 w-12 rounded object-cover shrink-0" />
                    <div className="min-w-0">
                      <p className="truncate text-[11px] text-gray-300">{productPackshot.name}</p>
                      <p className="text-[10px] text-emerald-400/80">Product hero from Ad Creator</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Cold open: packshot + creative reference uploads */}
            {!hubLaunch && !isRunning && (
              <div className="mb-3 space-y-3">
                <div className="rounded-xl border border-dark-border bg-dark-card/50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-white">Product packshot</p>
                      <p className="text-[10px] text-gray-500">
                        Upload the exact product image. Required if the prompt has no URL; overrides scraped page images when both are set.
                      </p>
                    </div>
                    <label className="cursor-pointer rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20">
                      {productPackshot ? 'Replace' : 'Upload image'}
                      <input
                        hidden
                        accept="image/png,image/jpeg,image/webp"
                        type="file"
                        onChange={async (event) => {
                          const file = event.target.files?.[0];
                          event.target.value = '';
                          if (!file) return;
                          setProductPackshot(await readCreativeReferenceFile(file));
                        }}
                      />
                    </label>
                  </div>
                  {productPackshot && (
                    <div className="mt-3 flex items-start gap-3 max-w-sm">
                      <img src={productPackshot.previewUrl} alt={productPackshot.name} className="h-20 w-20 rounded object-cover shrink-0" />
                      <div className="min-w-0">
                        <p className="truncate text-[10px] text-gray-300">{productPackshot.name}</p>
                        <p className="mt-1 text-[10px] text-emerald-400/80">Locked as product hero</p>
                        <button
                          type="button"
                          onClick={() => setProductPackshot(null)}
                          className="mt-1 text-[10px] text-red-400 hover:text-red-300"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-dark-border bg-dark-card/50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-white">Creative references</p>
                      <p className="text-[10px] text-gray-500">
                        Instagram link or upload media. Agent recreates structure for your brand.
                      </p>
                    </div>
                    <label className="cursor-pointer rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20">
                      Add media
                      <input
                        hidden
                        multiple
                        accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
                        type="file"
                        onChange={async (event) => {
                          const files = event.target.files ? (Array.from(event.target.files) as File[]) : [];
                          event.target.value = '';
                          if (!files.length) return;
                          setCaptureError(null);
                          const room = Math.max(0, 12 - referenceUploads.length);
                          const { uploads, errors } = await ingestCreativeReferenceFiles(files, { maxTotal: room });
                          if (uploads.length) {
                            setReferenceUploads((current) => [...current, ...uploads].slice(0, 12));
                          }
                          if (errors.length) {
                            window.alert(errors.join('\n'));
                          }
                        }}
                      />
                    </label>
                  </div>
                  <div className="mt-3 flex flex-col sm:flex-row gap-2">
                    <input
                      type="url"
                      value={referenceUrl}
                      onChange={(e) => {
                        setReferenceUrl(e.target.value);
                        setCaptureError(null);
                      }}
                      placeholder="https://www.instagram.com/reel/… or /p/…"
                      className="flex-1 rounded-lg border border-dark-border bg-black/20 px-3 py-2 text-[11px] text-white placeholder-gray-600 focus:border-cyan-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={capturingRef || !referenceUrl.trim()}
                      onClick={async () => {
                        setCapturingRef(true);
                        setCaptureError(null);
                        try {
                          const result = await captureReferencePostUrl(referenceUrl, {
                            existingCount: referenceUploads.length,
                          });
                          setReferenceUploads((current) => [...current, ...result.uploads].slice(0, 12));
                          if (result.warning) setCaptureError(result.warning);
                        } catch (err: any) {
                          setCaptureError(
                            err?.message
                            || 'Capture failed. Upload the Reel/video file instead.',
                          );
                        } finally {
                          setCapturingRef(false);
                        }
                      }}
                      className="shrink-0 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-40"
                    >
                      {capturingRef ? 'Capturing…' : 'Capture reference'}
                    </button>
                  </div>
                  {captureError && (
                    <p className="mt-2 text-[10px] text-amber-300/90 leading-relaxed">{captureError}</p>
                  )}
                  {referenceUploads.length > 0 && (
                    <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
                      {referenceUploads.map((reference) => (
                        <div key={reference.id} className="rounded-lg border border-dark-border bg-dark-bg p-2">
                          <img src={reference.previewUrl} alt={reference.name} className="h-20 w-full rounded object-cover" />
                          <p className="mt-1 truncate text-[10px] text-gray-300">{reference.name}</p>
                          <input
                            value={reference.note}
                            onChange={(event) => setReferenceUploads((current) => current.map((item) => item.id === reference.id ? { ...item, note: event.target.value } : item))}
                            placeholder="Direction, e.g. use this angle"
                            className="mt-1 w-full rounded border border-dark-border bg-black/20 px-2 py-1 text-[10px] text-white placeholder-gray-600 focus:border-cyan-500 focus:outline-none"
                          />
                          <button onClick={() => setReferenceUploads((current) => current.filter((item) => item.id !== reference.id))}
                            className="mt-1 text-[10px] text-red-400 hover:text-red-300">Remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="flex gap-3 items-end">
              <div className="flex-1 space-y-1">
                {hubLaunch && (
                  <p className="text-[10px] uppercase tracking-wider text-gray-500">Direction</p>
                )}
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={isRunning}
                  placeholder={hubLaunch
                    ? 'Your direction from Ad Creator (editable). Locked brief is attached to the run separately.'
                    : `Product URL and/or brief. Or upload a packshot above and describe the ad — e.g. Create a ${durationSec}s ${platform.replace(/_/g, ' ')} ad, ${style.replace(/_/g, ' ')} style`}
                  className="w-full px-4 py-3 rounded-xl bg-dark-card border border-dark-border text-white placeholder-gray-600 focus:border-emerald-500 focus:outline-none resize-none text-sm leading-relaxed"
                  rows={hubLaunch ? 3 : 2}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isRunning) handleRun(); }}
                />
                <p className="text-[10px] text-gray-600">
                  {isStillFormat ? `${adFormat.replace(/_/g, ' ')} · ${platform.replace(/_/g, ' ')}` : `${durationSec}s · ${estScenes} scenes · ${platform.replace(/_/g, ' ')}`} · {style.replace(/_/g, ' ')}{!isStillFormat ? (includeVoiceover ? ` · ${voice}` : ' · silent') : ''} · {reviewMode === 'review' ? 'Review gates' : `Auto-approve ${autoApproveSec}s`}
                  {productPackshot ? ' · Packshot uploaded' : ''}
                  {hubLaunch && lockedBriefPreview ? ' · Locked brief attached' : ''}
                </p>
              </div>
              <button
                onClick={handleRun}
                disabled={isRunning || !prompt.trim()}
                className="px-5 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-500 text-white font-bold disabled:opacity-40 hover:shadow-lg hover:shadow-emerald-500/25 transition-all whitespace-nowrap"
              >
                {isRunning ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                    Running
                  </span>
                ) : 'Run Agent'}
              </button>
            </div>
          </div>

          {/* Output canvas */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {(isRunning || pendingApproval) && (
              <StickyRunStatus
                pendingApproval={Boolean(pendingApproval)}
                phaseLabel={phaseProgressLabel}
                latestStatus={latestStatus}
                approvalQuestion={pendingApproval?.question}
                showDetails={showDetails}
                onToggleDetails={() => setShowDetails((v) => !v)}
                goalProgress={goalProgress}
                showGoalProgress={showGoalProgress}
                isBrowsing={isBrowsing}
              />
            )}
            {outputEvents.length === 0 && !isRunning && (
              <div className="flex flex-col items-center justify-center py-20 text-center px-8">
                <div className="w-20 h-20 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-4xl mb-5">
                  {agencyRunContext?.source === 'brand_video_agency' ? '🏢' : '🤖'}
                </div>
                <p className="text-white font-semibold text-lg mb-2">
                  {agencyRunContext?.source === 'brand_video_agency' ? 'Agency → Ad Agent Production' : 'Autonomous Ad Agent'}
                </p>
                <p className="text-gray-500 text-sm max-w-lg leading-relaxed mb-6">
                  {agencyRunContext?.source === 'brand_video_agency'
                    ? `Producing ${agencyRunContext.approvedConcept?.title || 'your approved concept'} with ${agencyRunContext.seedScenes?.length || 0} locked Agency scenes. Exact assets stay locked; you still approve plan, images, and deliver.`
                    : `Paste a product URL. The agent researches the product, plans ${adFormat === 'carousel' ? 'a native carousel' : adFormat === 'static_image' ? 'a native static image' : `${estScenes} scenes for ${durationSec}s`}, generates grounded creative with your actual product and verifies it before delivery.`}
                </p>
                {agencyRunContext?.source === 'brand_video_agency' ? (
                  <div className="grid grid-cols-2 gap-3 max-w-sm w-full text-left">
                    {[
                      'Use Agency product lock',
                      'Load approved scene plan',
                      'Keep exact assets locked',
                      'Review plan → images → deliver',
                      'Assemble the final video',
                      'Deliver final MP4',
                    ].map((step, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                        <span className="w-5 h-5 rounded-full bg-dark-card border border-dark-border flex items-center justify-center text-[9px] text-gray-600 flex-shrink-0">{i + 1}</span>
                        {step}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 max-w-sm w-full text-left">
                    {(isStillFormat
                      ? ['Understand your product', `Plan native ${outputUnit}`, `Generate ${outputUnit}`, 'Quality review', `Export final ${adFormat.replace(/_/g, ' ')}`]
                      : [
                          'Understand your product',
                          `Plan ${estScenes} scenes (${durationSec}s)`,
                          'Generate visuals',
                          includeVoiceover ? 'Record voiceover' : 'Silent (no voiceover)',
                          'Assemble the final video',
                          'Deliver final MP4',
                        ]
                    ).map((step, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                        <span className="w-5 h-5 rounded-full bg-dark-card border border-dark-border flex items-center justify-center text-[9px] text-gray-600 flex-shrink-0">{i + 1}</span>
                        {step}
                      </div>
                    ))}
                  </div>
                )}
                {!shellServerOk && (
                  <div className="mt-6 bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-left max-w-md">
                    <p className="text-amber-300 text-xs font-semibold mb-1.5">
                      {agencyRunContext?.source === 'brand_video_agency'
                        ? 'Video assembly needs a local helper before Agency production can auto-start:'
                        : 'Video assembly needs a local helper. Start it once:'}
                    </p>
                    <code className="block font-mono text-xs text-amber-200/80 bg-black/30 px-3 py-2 rounded-lg">npm run dev:agent</code>
                  </div>
                )}
              </div>
            )}

            {outputEvents.map((event) => (
              <OutputItem key={event.id} event={event} />
            ))}

            {/* Error events — always rendered so agent failures are visible */}
            {errorEvents.map((event) => (
              <div key={event.id} className="rounded-xl border border-red-500/40 bg-red-500/8 p-4 flex items-start gap-3">
                <span className="text-lg flex-shrink-0">❌</span>
                <div>
                  <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-1">Agent Error</p>
                  <p className="text-sm text-red-300 leading-relaxed">{event.message || 'An unknown error occurred.'}</p>
                </div>
              </div>
            ))}

            {/* Approval gate — always shown inline after current outputs */}
            {pendingApproval && (
              <ApprovalGate approval={pendingApproval} onResolve={handleApprovalResolve} />
            )}

            {isRunning && !pendingApproval && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
                <p className="text-xs text-emerald-300">
                  {latestStatus || 'Working...'}
                </p>
              </div>
            )}

            {deliverable && (
              <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 overflow-hidden">
                {(() => {
                  const videoUrl = normalizeAdAgentFileUrl(deliverable.videoUrl);
                  return (
                    <>
                {/* Header */}
                <div className="px-5 py-4 flex items-center justify-between border-b border-emerald-500/20">
                  <div>
                    <p className="text-sm font-bold text-emerald-300">Production complete</p>
                    <p className="text-[10px] text-emerald-400/60">{deliverable.durationSec}s · {deliverable.sceneImages.length} scenes</p>
                  </div>
                  <div className="flex gap-2">
                    {videoUrl && (
                      <a href={videoUrl} download="reelai-ad.mp4"
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors">
                        ↓ Download MP4
                      </a>
                    )}
                  </div>
                </div>

                {/* Scene images grid */}
                {deliverable.sceneImages.length > 0 && (
                  <div className="p-4 border-b border-emerald-500/10">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-3">Scene Storyboard</p>
                    <div className="grid grid-cols-5 gap-2">
                      {deliverable.sceneImages.map((img, i) => (
                        <div key={i} className="space-y-1">
                          <div className="rounded-lg overflow-hidden bg-black/40 aspect-[9/16]">
                            <img src={img.url} alt={img.label} className="w-full h-full object-cover" />
                          </div>
                          <p className="text-[9px] text-gray-600 text-center truncate">{img.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Platform export links */}
                <div className="px-5 py-3 border-b border-emerald-500/10 flex gap-2 flex-wrap">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 w-full mb-1">Platform Exports</p>
                  {(['instagram_reels', 'tiktok', 'youtube_shorts'] as const).map((p) => {
                    const exportUrl = videoUrl
                      ? videoUrl.replace('final.mp4', `export_${p}.mp4`)
                      : null;
                    return (
                      <a key={p} href={exportUrl ?? '#'} download={`reelai-${p}.mp4`}
                        className="px-3 py-1.5 rounded-lg bg-dark-card border border-dark-border text-gray-300 hover:text-white hover:border-emerald-500/40 text-xs font-medium transition-all">
                        ↓ {p.replace(/_/g, ' ')}
                      </a>
                    );
                  })}
                </div>

                {/* Script */}
                <div className="px-5 py-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500">Full Script</p>
                    <button
                      onClick={() => navigator.clipboard.writeText(deliverable.script)}
                      className="text-[10px] text-gray-500 hover:text-white transition-colors px-2 py-1 rounded bg-dark-card border border-dark-border">
                      Copy
                    </button>
                  </div>
                  <pre className="text-xs text-gray-400 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto bg-black/20 rounded-lg p-3">
                    {deliverable.script}
                  </pre>
                </div>
                    </>
                  );
                })()}
              </div>
            )}

            <div ref={outputEndRef} />
          </div>
        </div>
      </div>

      {/* Carousel Text Editor Modal */}
      {showCarouselEditor && carouselSlides.length > 0 && (
        <CarouselTextEditor
          slides={carouselSlides}
          onExport={handleCarouselExport}
          onCancel={() => setShowCarouselEditor(false)}
        />
      )}
    </div>
  );
};

export default AgentConsole;
