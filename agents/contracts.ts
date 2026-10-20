import type { ExecutionMode } from '../types/brand';

export type AgentToolId =
  | 'web_search'
  | 'browser_operator'
  | 'url_import'
  | 'image_analysis'
  | 'image_generation'
  | 'video_generation'
  | 'veo3_generation'   // Veo3 video clip generation (costly, requires user confirmation)
  | 'script_runner'
  | 'repo_write'
  | 'structured_output'
  | 'brand_memory_write'
  | 'subagent_request'
  // ── Production tools (require shell server) ──────────────────────────────
  | 'shell_exec'       // ffmpeg, bash, any shell command
  | 'python_exec'      // run Python scripts
  | 'tts_generation'   // Gemini TTS → WAV with proper header
  | 'video_assembly'   // Ken Burns + xfade + audio mix + captions
  | 'image_export'     // static image export (resize, format, quality)
  | 'carousel_export'  // batch carousel slide export
  | 'memory_read'      // read agent memory (global + brand)
  | 'memory_write';    // write agent memory entry

export type SkillId =
  | 'research_methodology'
  | 'url_signal_extraction'
  | 'product_page_import'
  | 'brand_asset_grounding'
  | 'social_profile_analysis'
  | 'competitor_ad_analysis'
  | 'brand_memory_synthesis'
  | 'creative_storyboarding'
  | 'imaginative_storytelling'
  | 'product_evidence_grounding'
  | 'scene_source_binding'
  | 'duration_fit_planning'
  | 'tiktok_native_direction'
  | 'instagram_reels_direction'
  | 'youtube_shorts_direction'
  | 'creative_qa_review'
  | 'structured_json_delivery'
  // ── Production skills ─────────────────────────────────────────────────────
  | 'video_production'        // end-to-end video assembly via ffmpeg
  | 'audio_production'        // TTS voiceover pipeline
  | 'caption_burning'         // PIL caption overlay
  | 'campaign_memory'         // read/write agent memory for learning
  // ── Format-specific production skills ─────────────────────────────────────
  | 'static_image_export'     // single image crop/resize/quality/text overlay
  | 'carousel_export'         // multi-slide batch export with text overlays
  | 'veo3_video_production';  // Veo3 clip generation + stitching

export type WorkerProfileId =
  | 'research_worker'
  | 'brand_memory_worker'
  | 'creative_planner_worker'
  | 'review_worker'
  | 'scene_worker'
  | 'orchestrator_signed_worker'
  | 'video_production_worker';  // new: has shell_exec + video_assembly

export interface TaskContract {
  contractVersion: '1';
  taskId: string;
  parentTaskId?: string | null;
  assignedBy: 'orchestrator';
  executionMode: ExecutionMode;
  workerProfile: WorkerProfileId;
  objective: string;
  loadedSkills: SkillId[];
  allowedTools: AgentToolId[];
  readScopes: string[];
  writeScopes: string[];
  hardConstraints: string[];
  outputSchema: string;
  deadlineMs?: number;
}

export interface SkillSpec {
  skillId: SkillId;
  name: string;
  description: string;
  guidance: string;
  requiredTools: AgentToolId[];
  latencyClass: 'fast' | 'normal' | 'slow';
  riskTier: 'low' | 'medium' | 'high';
  canRunWithoutSubagent: boolean;
}

export interface WorkerProfile {
  id: WorkerProfileId;
  displayName: string;
  defaultModel: string;
  allowedTools: AgentToolId[];
  allowedSkills: SkillId[];
  defaultReadScopes: string[];
  defaultWriteScopes: string[];
  hardConstraints: string[];
  canSpawnChildren: boolean;
  riskTier: 'low' | 'medium' | 'high';
}

export interface TaskValidationResult {
  valid: boolean;
  errors: string[];
}

export const validateTaskContract = (
  contract: TaskContract,
  workerProfile: WorkerProfile,
): TaskValidationResult => {
  const errors: string[] = [];

  if (contract.assignedBy !== 'orchestrator') {
    errors.push('Task was not assigned by orchestrator.');
  }

  if (contract.workerProfile !== workerProfile.id) {
    errors.push(`Worker profile mismatch: expected ${workerProfile.id}, got ${contract.workerProfile}.`);
  }

  const invalidTools = contract.allowedTools.filter((tool) => !workerProfile.allowedTools.includes(tool));
  if (invalidTools.length > 0) {
    errors.push(`Task requested disallowed tools: ${invalidTools.join(', ')}.`);
  }

  const invalidSkills = contract.loadedSkills.filter((skill) => !workerProfile.allowedSkills.includes(skill));
  if (invalidSkills.length > 0) {
    errors.push(`Task loaded unsupported skills: ${invalidSkills.join(', ')}.`);
  }

  if (!contract.objective.trim()) {
    errors.push('Task objective cannot be empty.');
  }

  if (!contract.outputSchema.trim()) {
    errors.push('Task output schema cannot be empty.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};
