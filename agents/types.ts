import type {
  AdFormat,
  BrandDNA,
  AdConcept,
  ReviewFeedback,
  Brand,
  BrandMemory,
  CampaignBrief,
  RenderManifest,
  SceneContract,
} from '../types/brand';
import type { AgentToolId, SkillId, WorkerProfileId } from './contracts';

// === AGENT STATUS & ROLES ===

export type AgentStatus = 'queued' | 'spawning' | 'running' | 'waiting' | 'complete' | 'error';

export type TaskType =
  | 'web_search'
  | 'social_analysis'
  | 'competitor_study'
  | 'market_research'
  | 'brand_synthesis'
  | 'creative'
  | 'review'
  | 'image_gen'
  | 'video_production'
  | 'custom';

// === SUB-AGENT CONFIG & STATE ===

export interface SubAgentConfig {
  id: string;
  parentId: string | null;
  assignedBy: 'orchestrator';
  taskType: TaskType;
  goal: string;
  instructions: string;
  workerProfile: WorkerProfileId;
  model: string;
  loadedSkills: SkillId[];
  allowedTools: AgentToolId[];
  readScopes: string[];
  writeScopes: string[];
  hardConstraints: string[];
  outputSchema: string;
  depth: number;
  priority: 'high' | 'normal' | 'low';
  dependsOn: string[];
}

export interface SubAgentState extends SubAgentConfig {
  contractVersion: '1';
  status: AgentStatus;
  progress: number;
  statusText: string;
  displayName: string;
  emoji: string;
  findings: AgentFinding[];
  childAgents: string[];
  startedAt?: number;
  completedAt?: number;
  error?: string;
  tokenUsage: { input: number; output: number };
}

// === FINDINGS ===

export interface AgentFinding {
  id: string;
  agentId: string;
  timestamp: number;
  type: 'data' | 'insight' | 'asset' | 'recommendation' | 'warning';
  title: string;
  content: string;
  confidence: number;
  data?: any;
}

// === TASK GRAPH (Planner output) ===

export interface TaskGraph {
  reasoning: string;
  tasks: TaskDefinition[];
  phases: Phase[];
}

export interface TaskDefinition {
  id: string;
  taskType: TaskType;
  goal: string;
  instructions: string;
  priority: 'high' | 'normal' | 'low';
  dependsOn: string[];
  workerProfile?: WorkerProfileId;
  requiredSkills?: SkillId[];
  allowedTools?: AgentToolId[];
  readsFrom?: string[];
  writesTo?: string[];
  outputSchema?: string;
}

export interface Phase {
  type: 'parallel' | 'sequential' | 'loop';
  taskIds?: string[];
  condition?: string;
  maxIterations?: number;
}

// === SHARED CONTEXT ===

export interface SharedContext {
  // Input
  brief: string;
  campaignBrief: CampaignBrief;
  adFormat: AdFormat;
  productUrl?: string;
  brandId?: string;
  brand?: Brand;
  brandMemory: BrandMemory | null;

  // Dynamic findings pool
  findings: Record<string, AgentFinding[]>;

  // Structured outputs
  intentAnalysis: IntentAnalysis | null;
  brandDNA: BrandDNA | null;
  adConcept: AdConcept | null;
  sceneContracts: SceneContract[];
  renderManifest: RenderManifest | null;
  reviewHistory: ReviewFeedback[];
  generatedAssets: { sceneNumber: number; base64: string; prompt: string }[];

  // Meta
  currentIteration: number;
  maxIterations: number;
  totalTokensUsed: number;
}

export interface IntentAnalysis {
  adType: string;
  productFocus: string;
  platform: string;
  targetMarket: string;
  tone: string;
  suggestedApproach: string;
  additionalResearchNeeded: string[];
}

// === ORCHESTRATOR EVENTS ===

export type OrchestratorEvent =
  | { type: 'agent_spawned'; agent: SubAgentState }
  | { type: 'agent_updated'; agentId: string; updates: Partial<SubAgentState> }
  | { type: 'agent_completed'; agentId: string; findings: AgentFinding[] }
  | { type: 'finding_added'; agentId: string; finding: AgentFinding }
  | { type: 'child_spawned'; parentId: string; child: SubAgentState }
  | { type: 'phase_changed'; phase: string; description: string }
  | { type: 'iteration_started'; iteration: number; feedback: string }
  | { type: 'campaign_complete'; concept: AdConcept }
  | { type: 'error'; agentId: string; error: string };

// Helper: generate unique IDs
export const generateId = (): string => {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

// Helper: emoji for task types
export const taskTypeEmoji: Record<TaskType, string> = {
  web_search: '🔍',
  social_analysis: '📱',
  competitor_study: '🏆',
  market_research: '🌍',
  brand_synthesis: '🧬',
  creative: '🎬',
  review: '⭐',
  image_gen: '🎨',
  video_production: '🎥',
  custom: '🔧',
};
