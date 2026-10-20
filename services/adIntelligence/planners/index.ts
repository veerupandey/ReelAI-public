import { resolveFormatSpec, type AdFormat, type CampaignPlatform } from '../../../types/brand';
import { adAgentSceneBounds } from '../../../runtime/adAgentOptions';

export interface NativePlannerSpec {
  format: AdFormat;
  platform: CampaignPlatform;
  aspectRatio: string;
  minScenes: number;
  maxScenes: number;
  requiredElements: string[];
  planningRules: string[];
}

const requiredPlatform: Partial<Record<AdFormat, CampaignPlatform>> = {
  static_image: 'instagram_feed',
  carousel: 'instagram_carousel',
};

export const assertFormatLocked = (
  requestedFormat: AdFormat,
  deliveredFormat: AdFormat,
  platform: CampaignPlatform,
): void => {
  if (requestedFormat !== deliveredFormat) {
    throw new Error(`Format lock violated: requested ${requestedFormat}, attempted ${deliveredFormat}.`);
  }
  const platformLock = requiredPlatform[requestedFormat];
  if (platformLock && platform !== platformLock) {
    throw new Error(`Platform/format mismatch: ${requestedFormat} requires ${platformLock}, received ${platform}.`);
  }
  if ((requestedFormat === 'stitched_video' || requestedFormat === 'veo3_video') &&
    (platform === 'instagram_feed' || platform === 'instagram_carousel')) {
    throw new Error(`Platform/format mismatch: ${requestedFormat} cannot deliver to ${platform}.`);
  }
};

export const getNativePlannerSpec = (
  format: AdFormat,
  platform: CampaignPlatform,
  durationSec?: number,
): NativePlannerSpec => {
  assertFormatLocked(format, format, platform);
  const aspectRatio = resolveFormatSpec(format, platform).aspectRatio;
  if (format === 'static_image') {
    return {
      format, platform, aspectRatio, minScenes: 1, maxScenes: 1,
      requiredElements: ['single-message hierarchy', 'product or benefit focal point', 'clear CTA'],
      planningRules: ['Communicate one proposition only.', 'Use a clear visual hierarchy.', 'Do not plan motion, voiceover, or sequential scenes.'],
    };
  }
  if (format === 'carousel') {
    return {
      format, platform, aspectRatio, minScenes: 3, maxScenes: 10,
      requiredElements: ['swipe incentive', 'standalone slide value', 'final CTA'],
      planningRules: ['Slide one must create a reason to swipe.', 'Every middle slide must add standalone value.', 'Keep sequential story order fixed.', 'End with a clear CTA.'],
    };
  }
  // Video formats: scene bounds shrink for bumper / short ads so assembly stays viable.
  const videoBounds = adAgentSceneBounds(durationSec ?? 30);
  if (platform === 'tiktok') {
    return {
      format, platform, aspectRatio, ...videoBounds,
      requiredElements: ['first-three-second proposition', 'creator-native delivery', 'hook body close', 'sound-on design'],
      planningRules: [
        'State the proposition in the first three seconds.',
        'Use a creator-native hook/body/close structure.',
        'Design for sound-on vertical viewing.',
        `Respect the ${durationSec ?? 30}s runtime with ${videoBounds.minScenes}-${videoBounds.maxScenes} scenes.`,
      ],
    };
  }
  if (platform === 'youtube_shorts') {
    return {
      format, platform, aspectRatio,
      minScenes: videoBounds.minScenes,
      maxScenes: Math.max(videoBounds.maxScenes, Math.min(10, videoBounds.maxScenes + 2)),
      requiredElements: ['social-first hook', 'sound-on design', 'clear action'],
      planningRules: [
        'Keep the plan under 60 seconds.',
        'Blend with social-first content.',
        'Use sound and a clear action.',
        `Respect the ${durationSec ?? 30}s runtime with ${videoBounds.minScenes}-${videoBounds.maxScenes} scenes.`,
      ],
    };
  }
  return {
    format, platform, aspectRatio, ...videoBounds,
    requiredElements: ['safe-zone hook', 'sound-on design', 'vertical visual storytelling', 'clear CTA'],
    planningRules: [
      'Keep key messages in the safe zone.',
      'Design for 9:16 sound-on Reels.',
      'Use a strong hook and clear CTA.',
      `Respect the ${durationSec ?? 30}s runtime with ${videoBounds.minScenes}-${videoBounds.maxScenes} scenes.`,
    ],
  };
};

export const formatNativePlannerPrompt = (spec: NativePlannerSpec): string => [
  `FORMAT-NATIVE CONTRACT: ${spec.format} for ${spec.platform}`,
  `- Required aspect ratio: ${spec.aspectRatio}`,
  `- Required elements: ${spec.requiredElements.join(', ')}`,
  ...spec.planningRules.map((rule) => `- ${rule}`),
].join('\n');

export const scoreNativePlan = (
  spec: NativePlannerSpec,
  plan: { format: AdFormat; platform: CampaignPlatform; aspectRatio: string; elements: string[]; sceneCount: number },
): { passed: boolean; score: number; missing: string[] } => {
  const sceneCountOk = plan.sceneCount >= spec.minScenes && plan.sceneCount <= spec.maxScenes;
  const checks = [
    plan.format === spec.format,
    plan.platform === spec.platform,
    plan.aspectRatio === spec.aspectRatio,
    sceneCountOk,
    ...spec.requiredElements.map((element) => plan.elements.includes(element)),
  ];
  const missing = spec.requiredElements.filter((element) => !plan.elements.includes(element));
  if (!sceneCountOk) {
    missing.push(`scene count ${plan.sceneCount} (need ${spec.minScenes}-${spec.maxScenes})`);
  }
  const score = checks.filter(Boolean).length / checks.length;
  return { passed: score === 1, score, missing };
};
