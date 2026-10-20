import type { CampaignBrief } from '../types/brand';
import type { SkillId, SkillSpec } from './contracts';
import type { TaskType } from './types';

export const SKILL_REGISTRY: Record<SkillId, SkillSpec> = {
  research_methodology: {
    skillId: 'research_methodology',
    name: 'Research Methodology',
    description: 'Run grounded, source-aware external research and summarize it cleanly.',
    guidance: 'Prefer concrete examples, cite domains, distinguish facts from inference, and avoid vague market language.',
    requiredTools: ['web_search', 'structured_output'],
    latencyClass: 'normal',
    riskTier: 'low',
    canRunWithoutSubagent: true,
  },
  url_signal_extraction: {
    skillId: 'url_signal_extraction',
    name: 'URL Signal Extraction',
    description: 'Extract strong signals from product or brand URLs before broader research.',
    guidance: 'Infer likely platform type, capture product identifiers, and list import hypotheses before deeper analysis.',
    requiredTools: ['web_search', 'structured_output'],
    latencyClass: 'fast',
    riskTier: 'low',
    canRunWithoutSubagent: true,
  },
  product_page_import: {
    skillId: 'product_page_import',
    name: 'Product Page Import',
    description: 'Pull product facts, gallery cues, and merchandising signals from a product page.',
    guidance: 'Extract title, benefits, ingredients, proof points, price cues, and visible gallery/packaging details.',
    requiredTools: ['web_search', 'url_import', 'structured_output'],
    latencyClass: 'normal',
    riskTier: 'medium',
    canRunWithoutSubagent: false,
  },
  brand_asset_grounding: {
    skillId: 'brand_asset_grounding',
    name: 'Brand Asset Grounding',
    description: 'Treat uploaded/imported brand assets as primary visual truth.',
    guidance: 'Bind scenes to real assets where possible and describe asset provenance explicitly.',
    requiredTools: ['image_analysis', 'structured_output'],
    latencyClass: 'fast',
    riskTier: 'low',
    canRunWithoutSubagent: true,
  },
  social_profile_analysis: {
    skillId: 'social_profile_analysis',
    name: 'Social Profile Analysis',
    description: 'Study social channels for tone, content pillars, and posting patterns.',
    guidance: 'Look for repeating hooks, creator framing, aesthetic decisions, and engagement mechanics.',
    requiredTools: ['web_search', 'structured_output'],
    latencyClass: 'normal',
    riskTier: 'low',
    canRunWithoutSubagent: true,
  },
  competitor_ad_analysis: {
    skillId: 'competitor_ad_analysis',
    name: 'Competitor Ad Analysis',
    description: 'Identify what competing brands are doing well or poorly in ads.',
    guidance: 'Focus on hooks, proof structures, scene pacing, UGC patterns, and differentiation opportunities.',
    requiredTools: ['web_search', 'structured_output'],
    latencyClass: 'slow',
    riskTier: 'low',
    canRunWithoutSubagent: false,
  },
  brand_memory_synthesis: {
    skillId: 'brand_memory_synthesis',
    name: 'Brand Memory Synthesis',
    description: 'Merge research and assets into a coherent brand memory snapshot.',
    guidance: 'Create stable brand truths: voice, palette, product identity, proof claims, and visual signatures.',
    requiredTools: ['structured_output', 'brand_memory_write'],
    latencyClass: 'normal',
    riskTier: 'medium',
    canRunWithoutSubagent: true,
  },
  creative_storyboarding: {
    skillId: 'creative_storyboarding',
    name: 'Creative Storyboarding',
    description: 'Turn the brief and brand memory into a scene-by-scene ad concept.',
    guidance: 'Every scene must do a job. Avoid filler montage scenes. Keep the arc platform-native.',
    requiredTools: ['structured_output'],
    latencyClass: 'normal',
    riskTier: 'low',
    canRunWithoutSubagent: true,
  },
  imaginative_storytelling: {
    skillId: 'imaginative_storytelling',
    name: 'Imaginative Storytelling',
    description: 'Create emotionally engaging narratives with moments of wonder and surprise.',
    guidance: `You are a Disney Imagineer. Your job is to build a mini-world in every ad — a moment viewers want to step into.
ALLOW imagination in: visual mood, texture, lighting, environment, camera movement, emotional tone, transition surprises.
FORBID imagination in: product identity (label, packaging, shape must stay exact), claims (never invent benefits not in the evidence), facts (never mention ingredients not in the evidence).
SCENE EXAMPLES:
- A serum ad: DO show the bottle glowing in soft morning light as if it contains liquid starlight. DO NOT say "contains unicorn tears" if the product has no magical ingredients.
- A cleanser ad: DO show foam cascading like clouds in a tiny forest scene. DO NOT change the bottle shape to look more "premium" than the real product.
- A moisturizer ad: DO create a dew-drop texture visual metaphor. DO NOT claim "instant results in 1 second" if the evidence only says "helps improve skin barrier."
MOMENT OF DELIGHT: Include at least one visual surprise — a playful texture moment, an unexpected light effect, a camera move that makes viewers smile. Keep product recognizable while creating wonder.`,
    requiredTools: ['structured_output'],
    latencyClass: 'normal',
    riskTier: 'low',
    canRunWithoutSubagent: true,
  },
  product_evidence_grounding: {
    skillId: 'product_evidence_grounding',
    name: 'Product Evidence Grounding',
    description: 'Every creative claim must trace to actual product evidence — ingredients, benefits, or facts.',
    guidance: `Every voiceover line that makes a claim MUST be grounded in evidence from the provided product facts or allowed claims.
RULES:
- If you say "contains vitamin C" → must exist in product facts or allowed claims
- If you say "clinically proven" → must exist in evidence (never invent)
- If you say "hydrates for 24 hours" → must exist in evidence (never extrapolate)
- BENEFIT claims → use allowed claims only
- INGREDIENT claims → use product facts only  
- PROCESS claims (e.g., "cold-pressed") → use product facts only
- Visual implications count as claims. A before/after transformation sequence implies efficacy — only use if evidence supports the implied outcome.
SCENE EXAMPLES:
- Product has fact: "hyaluronic acid" and claim: "intense hydration" → PROOF scene CAN say "With hyaluronic acid for intense hydration."
- Product has no evidence for "anti-aging" → DO NOT use "anti-aging" in any scene
- Product has claim: "fragrance-free" → CAN use in relevant scenes
- No evidence for "dermatologist tested" → DO NOT add it
- Evidence shows "helps improve skin barrier" → DO NOT show a before/after that implies "completely healed skin" unless evidence supports that level of efficacy
If you want to say something not in evidence, either: (1) rephrase to stay factual, or (2) flag it as a "suggested claim" for human review. NEVER invent evidence.`,
    requiredTools: ['structured_output'],
    latencyClass: 'normal',
    riskTier: 'medium',
    canRunWithoutSubagent: true,
  },
  scene_source_binding: {
    skillId: 'scene_source_binding',
    name: 'Scene Source Binding',
    description: 'Decide whether each scene should use, crop, edit, or generate from assets.',
    guidance: 'Prefer exact or edited brand assets for product scenes; reserve fresh generation for true gaps only.',
    requiredTools: ['image_analysis', 'structured_output'],
    latencyClass: 'fast',
    riskTier: 'low',
    canRunWithoutSubagent: true,
  },
  duration_fit_planning: {
    skillId: 'duration_fit_planning',
    name: 'Duration Fit Planning',
    description: 'Respect the requested ad duration when planning scene count and script density.',
    guidance: 'Treat duration as a hard constraint. Do not over-pack scenes or scripts beyond the target runtime.',
    requiredTools: ['structured_output'],
    latencyClass: 'fast',
    riskTier: 'low',
    canRunWithoutSubagent: true,
  },
  tiktok_native_direction: {
    skillId: 'tiktok_native_direction',
    name: 'TikTok Native Direction',
    description: 'Shape creative choices for TikTok pacing and hook style.',
    guidance: 'Bias toward immediate hooks, faster pacing, strong proof, and creator-native framing.',
    requiredTools: ['structured_output'],
    latencyClass: 'fast',
    riskTier: 'low',
    canRunWithoutSubagent: true,
  },
  instagram_reels_direction: {
    skillId: 'instagram_reels_direction',
    name: 'Instagram Reels Direction',
    description: 'Shape creative choices for polished Reels-style ads.',
    guidance: 'Bias toward aesthetic cohesion, premium framing, and save/share-friendly structure.',
    requiredTools: ['structured_output'],
    latencyClass: 'fast',
    riskTier: 'low',
    canRunWithoutSubagent: true,
  },
  youtube_shorts_direction: {
    skillId: 'youtube_shorts_direction',
    name: 'YouTube Shorts Direction',
    description: 'Shape creative for Shorts pacing and broader voiceover clarity.',
    guidance: 'Favor clarity, spoken structure, and slightly more explanatory momentum than TikTok.',
    requiredTools: ['structured_output'],
    latencyClass: 'fast',
    riskTier: 'low',
    canRunWithoutSubagent: true,
  },
  creative_qa_review: {
    skillId: 'creative_qa_review',
    name: 'Creative QA Review',
    description: 'Critique concepts against brand fit, hook power, and execution quality.',
    guidance: 'Be demanding, specific, and revision-oriented. Identify mandatory fixes, not generic comments.',
    requiredTools: ['structured_output'],
    latencyClass: 'normal',
    riskTier: 'low',
    canRunWithoutSubagent: true,
  },
  structured_json_delivery: {
    skillId: 'structured_json_delivery',
    name: 'Structured JSON Delivery',
    description: 'Return clean JSON matching the requested output contract.',
    guidance: 'Return valid JSON only when asked. No wrappers, no prose before or after the payload.',
    requiredTools: ['structured_output'],
    latencyClass: 'fast',
    riskTier: 'low',
    canRunWithoutSubagent: true,
  },

  // ── Production skills ───────────────────────────────────────────────────────
  video_production: {
    skillId: 'video_production',
    name: 'Video Production',
    description: 'End-to-end video assembly: Ken Burns clips → xfade transitions → audio mix → final MP4.',
    guidance: 'Use ffmpeg via shell_exec. Always use absolute paths. Clamp xfade duration to 40% of shortest clip. All WAV files must have proper RIFF headers.',
    requiredTools: ['shell_exec', 'video_assembly'],
    latencyClass: 'slow',
    riskTier: 'medium',
    canRunWithoutSubagent: false,
  },
  audio_production: {
    skillId: 'audio_production',
    name: 'Audio Production',
    description: 'Generate TTS voiceover from script segments and concatenate into a full audio track.',
    guidance: 'Gemini TTS returns raw PCM16 at 24kHz. Always wrap in WAV header before saving. Concatenate using filter_complex concat, not the concat demuxer.',
    requiredTools: ['tts_generation', 'shell_exec'],
    latencyClass: 'normal',
    riskTier: 'low',
    canRunWithoutSubagent: false,
  },
  caption_burning: {
    skillId: 'caption_burning',
    name: 'Caption Burning',
    description: 'Overlay text captions on video using Python PIL (not ffmpeg drawtext, which requires libfreetype).',
    guidance: 'Generate transparent PNG caption images via PIL, then overlay using ffmpeg overlay filter with enable=between(t,start,end).',
    requiredTools: ['python_exec', 'shell_exec'],
    latencyClass: 'normal',
    riskTier: 'low',
    canRunWithoutSubagent: false,
  },
  campaign_memory: {
    skillId: 'campaign_memory',
    name: 'Campaign Memory',
    description: 'Read past learnings before each phase and write new learnings after each run.',
    guidance: 'Read memory at run start to load constraints. Write memory after user gives feedback rating. Scope global memory for universal rules, brand memory for aesthetic preferences.',
    requiredTools: ['memory_read', 'memory_write'],
    latencyClass: 'fast',
    riskTier: 'low',
    canRunWithoutSubagent: true,
  },

  // ── Format-specific production skills ─────────────────────────────────────

  static_image_export: {
    skillId: 'static_image_export',
    name: 'Static Image Export',
    description: 'Export a single high-quality image ad. Handles aspect ratio, text overlay, and platform-specific sizing.',
    guidance: 'Generate one hero image at the target aspect ratio (4:5 for Instagram feed). Optionally burn a headline and CTA overlay. Export at platform-native resolution (1080x1350 for feed). Ensure text is legible and does not obscure the product.',
    requiredTools: ['image_generation', 'image_export'],
    latencyClass: 'fast',
    riskTier: 'low',
    canRunWithoutSubagent: true,
  },

  carousel_export: {
    skillId: 'carousel_export',
    name: 'Carousel Export',
    description: 'Export multi-slide carousel images with per-slide text overlays and consistent visual style.',
    guidance: 'Generate images per slide at 1:1 aspect ratio (1080x1080). Maintain consistent color palette and typography across all slides. Each slide must deliver standalone value. Burn headline and optional body text per slide. First slide is the hook; last slide is the CTA. AI recommends slide count (3-10), user confirms.',
    requiredTools: ['image_generation', 'carousel_export'],
    latencyClass: 'normal',
    riskTier: 'low',
    canRunWithoutSubagent: true,
  },

  veo3_video_production: {
    skillId: 'veo3_video_production',
    name: 'Veo3 Video Production',
    description: 'Generate per-scene video clips using Google Veo3 API and stitch them into a final video.',
    guidance: 'COST WARNING: Veo3 is premium-priced. Always show a cost estimate and get explicit user confirmation before ANY Veo3 call. Safe product pipeline: (1) generate product-grounded stills, (2) human approves stills, (3) animate each still with veo-3.1-fast-generate-preview image-to-video, (4) approve each clip before the next. Never text-only invent packaging. Auto-approve is NEVER allowed. Stitch clips via ffmpeg concat. Veo3 generates audio natively — separate TTS is usually unnecessary.',
    requiredTools: ['veo3_generation', 'shell_exec', 'video_assembly'],
    latencyClass: 'slow',
    riskTier: 'high',
    canRunWithoutSubagent: false,
  },
};

const platformSkill = (brief: CampaignBrief): SkillId => {
  switch (brief.platform) {
    case 'instagram_reels':
    case 'instagram_feed':
    case 'instagram_carousel':
      return 'instagram_reels_direction';
    case 'youtube_shorts':
      return 'youtube_shorts_direction';
    case 'tiktok':
    default:
      return 'tiktok_native_direction';
  }
};

/** Resolve format-specific production skills based on adFormat */
const formatProductionSkills = (brief: CampaignBrief): SkillId[] => {
  switch (brief.adFormat) {
    case 'static_image':
      return ['static_image_export', 'campaign_memory', 'brand_asset_grounding', 'structured_json_delivery'];
    case 'carousel':
      return ['carousel_export', 'campaign_memory', 'brand_asset_grounding', 'structured_json_delivery'];
    case 'veo3_video':
      return ['veo3_video_production', 'campaign_memory', 'brand_asset_grounding', 'structured_json_delivery'];
    case 'stitched_video':
    default:
      return ['video_production', 'audio_production', 'caption_burning', 'campaign_memory', 'brand_asset_grounding', 'structured_json_delivery'];
  }
};

export const resolveSkillsForTask = (taskType: TaskType, brief: CampaignBrief): SkillId[] => {
  const basePlatformSkill = platformSkill(brief);

  switch (taskType) {
    case 'web_search':
      return ['research_methodology', 'url_signal_extraction', 'structured_json_delivery'];
    case 'social_analysis':
      return ['research_methodology', 'social_profile_analysis', 'structured_json_delivery'];
    case 'competitor_study':
      return ['research_methodology', 'competitor_ad_analysis', 'structured_json_delivery'];
    case 'market_research':
      return ['research_methodology', 'structured_json_delivery'];
    case 'brand_synthesis':
      return ['brand_asset_grounding', 'brand_memory_synthesis', 'structured_json_delivery'];
    case 'creative':
      return ['creative_storyboarding', 'imaginative_storytelling', 'product_evidence_grounding', 'scene_source_binding', 'duration_fit_planning', basePlatformSkill, 'structured_json_delivery'];
    case 'review':
      return ['creative_qa_review', 'imaginative_storytelling', 'product_evidence_grounding', 'duration_fit_planning', basePlatformSkill, 'structured_json_delivery'];
    case 'image_gen':
      return ['brand_asset_grounding', 'scene_source_binding', basePlatformSkill, 'structured_json_delivery'];
    case 'video_production':
      return formatProductionSkills(brief);
    case 'custom':
    default:
      return ['research_methodology', 'structured_json_delivery'];
  }
};

export const renderSkillGuidance = (skillIds: SkillId[]): string => {
  return skillIds
    .map((skillId) => {
      const skill = SKILL_REGISTRY[skillId];
      return `- ${skill.name}: ${skill.guidance}`;
    })
    .join('\n');
};
