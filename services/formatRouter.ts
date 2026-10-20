/**
 * Format Router
 * Dispatches ad production to the correct producer based on AdFormat.
 * This is the single branching seam — everything upstream (research, creative, review)
 * is shared across all formats. Everything downstream is format-specific.
 */

import type { AdFormat, SceneMotionMode } from '../types/brand';
import type { AgentConfig, AgentEvent, AgentPhase, ScenePlan, TrendInsights } from './autonomousAgent';
import type { SessionInfo, CaptionStyle } from './shellToolService';

// Re-export producer interfaces so callers only depend on the router
export interface ProducerInput {
  scenes: ScenePlan[];
  config: AgentConfig;
  session: SessionInfo;
  onEvent: (e: AgentEvent) => void;
  productBase64?: string;
  trends?: TrendInsights | null;
  title?: string;
  facts?: string;
  brandName?: string;
  chosenCaptionStyle?: CaptionStyle | null;
}

export interface ProducerOutput {
  adFormat: AdFormat;
  videoUrl?: string;            // stitched_video, veo3_video
  imageUrl?: string;            // static_image
  carouselImageUrls?: string[]; // carousel
  sceneImages: Array<{ url: string; label: string }>;
  durationSec: number;
}

export function countLiveMotionScenes(
  scenes: Array<{ motionMode?: SceneMotionMode }>,
): number {
  return scenes.filter((s) => (s.motionMode || 'still') === 'live_motion').length;
}

/**
 * Route to the correct format producer.
 * Currently returns a descriptor of which producer to use — actual producer
 * implementations are in services/producers/*.ts.
 */
export function getProducerForFormat(
  format: AdFormat,
  opts?: { liveMotionSceneCount?: number },
): {
  id: string;
  label: string;
  requiresShellServer: boolean;
  requiresVeo3: boolean;
  requiresWanI2v: boolean;
  requiresTTS: boolean;
  phases: AgentPhase[];
} {
  const liveMotion = Math.max(0, opts?.liveMotionSceneCount || 0);

  switch (format) {
    case 'static_image':
      return {
        id: 'static_image',
        label: 'Static Image Producer',
        requiresShellServer: true,  // for PIL text overlay
        requiresVeo3: false,
        requiresWanI2v: false,
        requiresTTS: false,
        phases: ['research', 'plan_scenes', 'generate_images', 'export_image', 'deliver'],
      };
    case 'carousel':
      return {
        id: 'carousel',
        label: 'Carousel Producer',
        requiresShellServer: true,  // for PIL text overlays
        requiresVeo3: false,
        requiresWanI2v: false,
        requiresTTS: false,
        phases: ['research', 'plan_scenes', 'generate_images', 'export_carousel', 'deliver'],
      };
    case 'veo3_video':
      return {
        id: 'veo3_video',
        label: 'Veo3 Video Producer',
        requiresShellServer: true,  // for ffmpeg stitching
        requiresVeo3: true,
        requiresWanI2v: false,
        requiresTTS: false,         // Veo3 generates audio natively
        phases: ['research', 'plan_scenes', 'generate_images', 'cost_confirmation', 'generate_veo3_clips', 'assemble_video', 'deliver'],
      };
    case 'stitched_video':
    default: {
      const phases: AgentPhase[] = [
        'research',
        'plan_scenes',
        'generate_images',
        ...(liveMotion > 0
          ? (['cost_confirmation', 'generate_live_motion'] as AgentPhase[])
          : []),
        'generate_voiceover',
        'assemble_video',
        'deliver',
      ];
      return {
        id: 'stitched_video',
        label: liveMotion > 0
          ? 'Stitched Video Producer (+ Live Motion)'
          : 'Stitched Video Producer',
        requiresShellServer: true,
        requiresVeo3: false,
        requiresWanI2v: liveMotion > 0,
        requiresTTS: true,
        phases,
      };
    }
  }
}

/**
 * Check if a format requires specific tools to be available.
 * Used by the agent availability system.
 */
export function getRequiredToolsForFormat(
  format: AdFormat,
  opts?: { liveMotionSceneCount?: number },
): string[] {
  switch (format) {
    case 'static_image':
      return ['image_generation', 'shell_exec'];
    case 'carousel':
      return ['image_generation', 'shell_exec'];
    case 'veo3_video':
      return ['image_generation', 'veo3_generation', 'shell_exec', 'video_assembly'];
    case 'stitched_video':
    default: {
      const tools = ['image_generation', 'shell_exec', 'video_assembly', 'tts_generation'];
      if ((opts?.liveMotionSceneCount || 0) > 0) tools.push('wan_i2v');
      return tools;
    }
  }
}

/**
 * Check if auto-approve should be forcibly disabled for a format.
 * Veo3 is expensive — always require manual approval.
 * Live Motion (Wan) also forces a cost gate when any scene requests it.
 */
export function shouldForceManualApproval(
  format: AdFormat,
  opts?: { liveMotionSceneCount?: number },
): boolean {
  if (format === 'veo3_video') return true;
  if (format === 'stitched_video' && (opts?.liveMotionSceneCount || 0) > 0) return true;
  return false;
}
