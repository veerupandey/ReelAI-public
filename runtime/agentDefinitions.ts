/**
 * Agent Definitions
 * Each agent is a pure data object — no runtime logic, no imports from services.
 * Adding a new agent = adding one object here + registering it in agentRegistry.ts
 * AND wiring a runner in AgentConsole (or a dedicated console).
 *
 * Canonical production path: ad-agent → AgentConsole → AutonomousAgent
 * (research → plan → generate → assemble with HITL approval gates).
 *
 * uiSchema describes launch fields (Ad Creator / hub forms may use a subset).
 * requiredTools gates whether the agent can run (checked at AgentHub load time).
 */

import type { AgentToolId, SkillId } from '../agents/contracts';
import type { TaskType } from '../agents/types';
import {
  AD_AGENT_DEFAULT_I2V_MODEL_ID,
  AD_AGENT_DURATION_MAX,
  AD_AGENT_DURATION_MIN,
  AD_AGENT_I2V_MODEL_OPTIONS,
  AD_AGENT_VOICE_OPTIONS,
} from './adAgentOptions';

// ── UI Schema ─────────────────────────────────────────────────────────────────

export type UIFieldType = 'url' | 'text' | 'textarea' | 'select' | 'slider' | 'toggle' | 'radio';

export interface UISelectOption {
  value: string;
  label: string;
  description?: string;
}

export interface UIField {
  id: string;
  type: UIFieldType;
  label: string;
  placeholder?: string;
  required: boolean;
  defaultValue?: string | number | boolean;
  options?: UISelectOption[];   // for select / radio
  min?: number;                  // for slider
  max?: number;
  step?: number;
  hint?: string;                 // small helper text below the field
}

// ── Agent Definition ──────────────────────────────────────────────────────────

export interface AgentDefinition {
  id: string;
  name: string;
  icon: string;
  tagline: string;               // one line shown on the hub card
  description: string;           // used by intent router for matching
  capabilities: string[];        // plain english, for intent router examples
  requiredTools: AgentToolId[];  // if any are unavailable → agent is disabled
  skills: SkillId[];             // informational — what this agent uses
  taskTypes: TaskType[];         // what phases the orchestrator will plan
  uiSchema: UIField[];           // launch-form field schema
  examplePrompts: string[];      // shown as quick-fill suggestions in hub
}

// ── Registered Agents ─────────────────────────────────────────────────────────

export const AD_AGENT: AgentDefinition = {
  id: 'ad-agent',
  name: 'Ad Creator',
  icon: '🎬',
  tagline: 'Product URL → finished ad (auto-runs with human review gates)',
  description: 'Creates ads from a product page URL end-to-end with a task-adaptive loop: goal card, Kimi planning, research, scene planning, image/video generation, voiceover, and assembly. Can recreate a reference reel/video structure for your brand. Supports Instagram Reels, TikTok, YouTube Shorts, static, carousel, and Veo3. Human-in-the-loop gates pause at loop plan, scenes, images, tool forge, and deliver.',
  capabilities: [
    'make a video ad',
    'create an instagram reel',
    'produce a tiktok ad',
    'generate a product video',
    'make a 30 second ad',
    'create a youtube short',
    'build a video commercial',
    'create a static image ad',
    'make an instagram feed post',
    'create a carousel ad',
    'make an instagram carousel',
    'create an AI video ad',
    'make a veo3 video',
    'recreate a reference video for my brand',
    'match this reel structure with my product',
    'remake this Instagram ad for our brand',
  ],
  requiredTools: ['image_generation'],
  skills: [
    'product_page_import',
    'brand_asset_grounding',
    'creative_storyboarding',
    'imaginative_storytelling',
    'product_evidence_grounding',
    'video_production',
    'audio_production',
    'caption_burning',
    'campaign_memory',
    'static_image_export',
    'carousel_export',
    'veo3_video_production',
  ],
  taskTypes: ['web_search', 'creative', 'image_gen', 'video_production'],
  uiSchema: [
    {
      id: 'productUrl',
      type: 'url',
      label: 'Product URL',
      placeholder: 'https://brand.com/products/your-product',
      required: false,
      hint: 'Optional if you upload a product packshot below. With a URL, the agent imports facts and page images; an uploaded packshot always wins as the product hero.',
    },
    {
      id: 'adFormat',
      type: 'radio',
      label: 'Ad Format',
      required: true,
      defaultValue: 'stitched_video',
      options: [
        { value: 'stitched_video', label: 'Video Ad', description: 'Images + Ken Burns + voiceover → MP4' },
        { value: 'static_image', label: 'Static Image', description: 'Single image ad · 4:5' },
        { value: 'carousel', label: 'Carousel', description: 'Multi-slide Instagram carousel · 1:1' },
        { value: 'veo3_video', label: 'AI Video (Veo3)', description: 'AI-generated video clips · costly' },
      ],
      hint: 'Choose the output format. Veo3 is premium-priced and requires manual approval per scene. Video Ad supports Live Motion I2V (Seedance, Kling, Veo, Grok, Wan) from Ad Creator or per scene at the plan gate.',
    },
    {
      id: 'preferLiveMotion',
      type: 'toggle',
      label: 'Live Motion',
      required: false,
      defaultValue: false,
      hint: 'Video Ad only. Default scenes to I2V instead of Ken Burns. Pick a model below; toggle per scene at the Scene Plan gate.',
    },
    {
      id: 'liveMotionModelId',
      type: 'select',
      label: 'Live Motion model',
      required: false,
      defaultValue: AD_AGENT_DEFAULT_I2V_MODEL_ID,
      options: AD_AGENT_I2V_MODEL_OPTIONS,
      hint: 'Video Ad only. Used when Live Motion is on — fal (Seedance/Kling/Veo/Grok/Wan 2.7) or SiliconFlow Wan.',
    },
    {
      id: 'plannerModel',
      type: 'radio',
      label: 'Planner / Agent model',
      required: false,
      defaultValue: 'glm_53_flash',
      options: [
        { value: 'glm_53_flash', label: 'GLM 5.3 Flash', description: 'OpenAI-compatible · z.ai · default' },
        { value: 'kimi_k3', label: 'SiliconFlow', description: 'OpenAI-compatible · Kimi-K3' },
        { value: 'openai', label: 'OpenAI', description: 'gpt-5.2' },
        { value: 'codex', label: 'Codex', description: 'gpt-5.1-codex' },
        { value: 'gemini_pro', label: 'Gemini', description: 'gemini-3.1-pro-preview' },
      ],
      hint: 'Main planner + main agent text. GLM/SiliconFlow/OpenAI/Codex use OpenAI-compatible chat. Images always use Gemini Flash Image. Non-Gemini choices fall back to Gemini on failure.',
    },
    {
      id: 'platform',
      type: 'radio',
      label: 'Platform',
      required: true,
      defaultValue: 'instagram_reels',
      options: [
        { value: 'instagram_reels', label: 'Instagram', description: 'Reels · 9:16' },
        { value: 'tiktok', label: 'TikTok', description: 'For You · 9:16' },
        { value: 'youtube_shorts', label: 'Shorts', description: 'YouTube · 9:16' },
        { value: 'instagram_feed', label: 'Feed', description: 'Instagram · 4:5' },
        { value: 'instagram_carousel', label: 'Carousel', description: 'Instagram · 1:1' },
      ],
    },
    {
      id: 'durationSec',
      type: 'slider',
      label: 'Duration',
      required: false,
      defaultValue: 30,
      min: AD_AGENT_DURATION_MIN,
      max: AD_AGENT_DURATION_MAX,
      step: 1,
      hint: `Presets 5/15/30/45/60 or custom ${AD_AGENT_DURATION_MIN}–${AD_AGENT_DURATION_MAX}s. (Video formats only)`,
    },
    {
      id: 'style',
      type: 'select',
      label: 'Visual Style',
      required: true,
      defaultValue: 'luxe_minimalist',
      options: [
        { value: 'luxe_minimalist', label: 'Luxe Minimalist', description: 'White, dramatic shadows, editorial' },
        { value: 'earthy_organic', label: 'Earthy & Organic', description: 'Terracotta, raw textures, warm' },
        { value: 'high_energy', label: 'High Energy', description: 'Bold colours, fast pacing, punchy' },
        { value: 'ugc_style', label: 'UGC Style', description: 'Raw, creator-native, handheld feel' },
      ],
    },
    {
      id: 'vibe',
      type: 'radio',
      label: 'Vibe',
      required: false,
      defaultValue: 'gen_z_bright',
      options: [
        { value: 'gen_z_bright', label: 'Gen Z Bright', description: 'Punchy hooks, creator voice, fast cuts' },
        { value: 'balanced', label: 'Balanced', description: 'Modern, confident, versatile' },
        { value: 'premium_calm', label: 'Premium Calm', description: 'Cinematic, luxe, measured pacing' },
      ],
      hint: 'Video formats only. Drives hook energy, cut rhythm, voiceover voice, and the researcher video treatment.',
    },
    {
      id: 'includeVoiceover',
      type: 'toggle',
      label: 'Include voiceover',
      required: false,
      defaultValue: true,
      hint: 'Video formats only. Off = silent video (no TTS). On-screen captions from the script may still burn.',
    },
    {
      id: 'voice',
      type: 'select',
      label: 'Voice',
      required: false,
      defaultValue: 'Kore',
      options: AD_AGENT_VOICE_OPTIONS.map((v) => ({
        value: v.value,
        label: v.label,
        description: v.desc,
      })),
      hint: 'Used when Include voiceover is on. Static and carousel ads have no voiceover.',
    },
    {
      id: 'reviewMode',
      type: 'toggle',
      label: 'Auto-approve scenes',
      required: false,
      defaultValue: false,
      hint: 'Off = agent pauses for your approval. On = fully autonomous. Always off for Veo3 (cost protection).',
    },
  ],
  examplePrompts: [
    'Make a 30s Instagram reel for this product: ',
    'Create a TikTok ad for ',
    'Build a luxury video ad for ',
    'Create a static image ad for Instagram feed: ',
    'Make an Instagram carousel for ',
    'Create an AI video ad using Veo3 for ',
    'Recreate this reference reel for my brand (upload frames or paste Instagram URL): ',
    'Match this ad structure with our product — analyze beats then stills + Live Motion: ',
  ],
};

/**
 * Autonomous general agent — open-ended goals with plan → parallel workers → tools → deliverable.
 * Not the Ad Creator pipeline; use Ad Creator for product ads.
 */
export const GENERAL_PURPOSE_AGENT: AgentDefinition = {
  id: 'general-agent',
  name: 'General Agent',
  icon: '🧠',
  tagline: 'Open-ended goals · plan · fan-out workers · tools · deliver',
  description:
    'A Autonomous general-purpose agent. Takes any goal, builds a task plan, fans out specialist workers in parallel, uses shell/MCP/browser tools when available, and synthesizes a deliverable with human review gates.',
  capabilities: [
    'research a topic and write a brief',
    'analyze competitors in parallel',
    'browse a site and extract facts',
    'run shell or python scripts in a session',
    'inspect files with ffmpeg or ffprobe',
    'plan and execute a multi-step project',
    'fan out subagents for parallel research',
    'open-ended autonomous agent task',
    'autonomous general agent',
  ],
  requiredTools: [],
  skills: [
    'research_methodology',
    'url_signal_extraction',
    'product_page_import',
    'competitor_ad_analysis',
    'social_profile_analysis',
    'brand_memory_synthesis',
    'creative_storyboarding',
    'creative_qa_review',
    'structured_json_delivery',
    'campaign_memory',
    'duration_fit_planning',
  ],
  taskTypes: ['web_search', 'market_research', 'competitor_study', 'custom'],
  uiSchema: [
    {
      id: 'goal',
      type: 'textarea',
      label: 'Goal',
      placeholder: 'What should the agent accomplish? Be specific about deliverables…',
      required: true,
      hint: 'Describe the outcome. The agent will plan steps and fan out workers.',
    },
    {
      id: 'plannerModel',
      type: 'radio',
      label: 'Planner / Agent model',
      required: false,
      defaultValue: 'glm_53_flash',
      options: [
        { value: 'glm_53_flash', label: 'GLM 5.3 Flash', description: 'OpenAI-compatible · z.ai · default' },
        { value: 'kimi_k3', label: 'SiliconFlow', description: 'OpenAI-compatible · Kimi-K3' },
        { value: 'openai', label: 'OpenAI', description: 'gpt-5.2' },
        { value: 'codex', label: 'Codex', description: 'gpt-5.1-codex' },
        { value: 'gemini_pro', label: 'Gemini', description: 'gemini-3.1-pro-preview' },
      ],
      hint: 'Main planner + worker text. Falls back to Gemini on failure.',
    },
    {
      id: 'maxWorkers',
      type: 'slider',
      label: 'Max parallel workers',
      required: false,
      defaultValue: 3,
      min: 1,
      max: 5,
      step: 1,
      hint: 'How many specialist workers may run at once during fan-out.',
    },
    {
      id: 'allowTools',
      type: 'toggle',
      label: 'Allow shell / MCP tools',
      required: false,
      defaultValue: true,
      hint: 'When on and the shell server is online, workers may run shell/python/MCP tools.',
    },
    {
      id: 'reviewMode',
      type: 'toggle',
      label: 'Auto-approve plan',
      required: false,
      defaultValue: false,
      hint: 'Off = pause after the plan for your approval. On = run autonomously.',
    },
  ],
  examplePrompts: [
    'Research 3 competitors for ceremonial matcha and summarize ad hooks',
    'Inspect this session folder and probe any MP4 durations',
    'Build a brief + creative territories for a 15s TikTok launch',
    'Fan out workers to research audience, competitors, and trends then synthesize',
  ],
};
