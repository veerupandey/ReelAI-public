import {
  ApprovedStoryboardSceneMetadata,
  SceneReferenceBinding,
  ImageGenerationRequest,
  ImageReferenceInput,
  ReelScript,
  ReelScriptSegmentPlan,
  SceneDraft,
  SceneImageSource,
  SceneImageVariant,
  ScenePacingRole,
  ScenePlan,
  UploadedMedia,
  VoiceOption,
  VoiceSlotMeterStatus,
} from '../types';

export type { ScenePacingRole, VoiceSlotMeterStatus };
import type { AssetProvenanceStep, SceneRoute } from '../types/brand';
import { sourceModeToSceneRoute } from '../services/sceneRouter';
import {
  buildRouteReferenceAssembly,
  getSceneReferenceInputFromMedia,
  normalizeSceneReferenceBindings,
} from './sceneReferenceBuilder';

const MIN_SCENE_DURATION = 0.7;
const MAX_SCENE_DURATION = 30;
const DEFAULT_SCENE_DURATION = 3;
/** Minimum scene length when voiceover is expected (avoids 1.4s death-trap hooks). */
export const SPOKEN_SCENE_MIN_SEC = 2.8;
/** Conservative conversational TTS budget; measured audio remains authoritative. */
export const WORDS_PER_SEC = 2.5;
/** Only force-fit when estimated speech clearly overruns the slot. */
export const SCRIPT_FIT_OVERFLOW_RATIO = 1.35;
const APPROVED_STORYBOARD_METADATA_KEYS: Array<keyof ApprovedStoryboardSceneMetadata> = [
  'productId',
  'productTitle',
  'productUrl',
  'storyboardRoute',
  'storyboardRouteOverride',
  'storyboardRouteReason',
  'storyboardSourceMode',
  'storyboardVisualTask',
  'storyboardVisualTaskReason',
  'storyboardSuggestedPosition',
  'storyboardBaseAssetId',
  'storyboardBaseAssetDescription',
  'storyboardLinkedAssetId',
  'storyboardLinkedAssetDescription',
  'storyboardDirectorsNote',
  'referenceImageBase64',
  'referenceImageMimeType',
];

type EditorContinuityMetadata = Pick<SceneDraft, 'storyboardRouteOverride' | 'sceneReferenceBindings' | 'sourceAssetIds' | 'provenance'>;

const EDITOR_CONTINUITY_KEYS: Array<keyof EditorContinuityMetadata> = [
  'storyboardRouteOverride',
  'sceneReferenceBindings',
  'sourceAssetIds',
  'provenance',
];

export type SceneRouteActionId =
  | 'restore_shot'
  | 'reframe_shot'
  | 'choose_different_asset'
  | 'upgrade_shot'
  | 'tune_prompt'
  | 'choose_base_asset'
  | 'compose_scene'
  | 'add_references'
  | 'generate_new_scene'
  | 'use_prior_scene_context'
  | 'continue_sequence'
  | 'use_previous_shot';

export interface SceneRouteActionDescriptor {
  id: SceneRouteActionId;
  label: string;
}

export interface SceneRouteActionSpec {
  effectiveRoute: SceneRoute;
  approvedRoute?: SceneRoute;
  primaryAction: SceneRouteActionDescriptor;
  secondaryActions: SceneRouteActionDescriptor[];
  guidance: string;
  warning?: string;
}

const hasApprovedStoryboardMetadataValue = (value: unknown): boolean => {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
};

export const pickApprovedStoryboardMetadata = (
  source?: Partial<ApprovedStoryboardSceneMetadata> | null,
): ApprovedStoryboardSceneMetadata => {
  const metadata: ApprovedStoryboardSceneMetadata = {};
  APPROVED_STORYBOARD_METADATA_KEYS.forEach((key) => {
    const value = source?.[key];
    if (hasApprovedStoryboardMetadataValue(value)) {
      metadata[key] = value as never;
    }
  });
  return metadata;
};

export const mergeApprovedStoryboardMetadata = (
  primary?: Partial<ApprovedStoryboardSceneMetadata> | null,
  fallback?: Partial<ApprovedStoryboardSceneMetadata> | null,
): ApprovedStoryboardSceneMetadata => {
  const merged: ApprovedStoryboardSceneMetadata = {};
  APPROVED_STORYBOARD_METADATA_KEYS.forEach((key) => {
    const primaryValue = primary?.[key];
    const fallbackValue = fallback?.[key];
    if (hasApprovedStoryboardMetadataValue(primaryValue)) {
      merged[key] = primaryValue as never;
    } else if (hasApprovedStoryboardMetadataValue(fallbackValue)) {
      merged[key] = fallbackValue as never;
    }
  });
  return merged;
};

export const pickEditorContinuityMetadata = (
  source?: Partial<EditorContinuityMetadata> | null,
): EditorContinuityMetadata => {
  const metadata: EditorContinuityMetadata = {};
  EDITOR_CONTINUITY_KEYS.forEach((key) => {
    const value = source?.[key];
    if (hasApprovedStoryboardMetadataValue(value)) {
      metadata[key] = value as never;
    }
  });
  if (metadata.sceneReferenceBindings) {
    metadata.sceneReferenceBindings = normalizeSceneReferenceBindings(metadata.sceneReferenceBindings);
  }
  return metadata;
};

export const mergeEditorContinuityMetadata = (
  primary?: Partial<EditorContinuityMetadata> | null,
  fallback?: Partial<EditorContinuityMetadata> | null,
): EditorContinuityMetadata => {
  const merged: EditorContinuityMetadata = {};
  EDITOR_CONTINUITY_KEYS.forEach((key) => {
    const primaryValue = primary?.[key];
    const fallbackValue = fallback?.[key];
    if (hasApprovedStoryboardMetadataValue(primaryValue)) {
      merged[key] = primaryValue as never;
    } else if (hasApprovedStoryboardMetadataValue(fallbackValue)) {
      merged[key] = fallbackValue as never;
    }
  });
  if (merged.sceneReferenceBindings || (primary as SceneDraft | undefined)?.referenceImageBase64 || (fallback as SceneDraft | undefined)?.referenceImageBase64) {
    merged.sceneReferenceBindings = normalizeSceneReferenceBindings(
      merged.sceneReferenceBindings,
      (primary as SceneDraft | undefined) || (fallback as SceneDraft | undefined),
    );
  }
  return merged;
};

export const backfillUploadedMediaStoryboardMetadata = (
  media: UploadedMedia,
  fallback?: Partial<ApprovedStoryboardSceneMetadata> | null,
): UploadedMedia => ({
  ...media,
  ...mergeApprovedStoryboardMetadata(media, fallback),
  ...mergeEditorContinuityMetadata(media, fallback as Partial<EditorContinuityMetadata> | null),
});

export const backfillSceneDraftStoryboardMetadata = (
  draft: SceneDraft,
  fallback?: Partial<ApprovedStoryboardSceneMetadata> | null,
): SceneDraft => ({
  ...draft,
  ...mergeApprovedStoryboardMetadata(draft, fallback),
  ...mergeEditorContinuityMetadata(draft, fallback as Partial<EditorContinuityMetadata> | null),
});

export const syncStoryboardMetadataAcrossDraftsAndMedia = (
  drafts: SceneDraft[],
  media: UploadedMedia[],
): { drafts: SceneDraft[]; media: UploadedMedia[] } => {
  const draftBySceneId = new Map(drafts.map((draft) => [draft.id, draft]));
  const mediaBySceneId = new Map(
    media
      .map((item) => [item.sceneId || item.id || '', item] as const)
      .filter(([key]) => Boolean(key)),
  );

  const syncedDrafts = drafts.map((draft, index) => {
    const matchingMedia = mediaBySceneId.get(draft.id) || media[index];
    return backfillSceneDraftStoryboardMetadata(
      matchingMedia ? { ...draft, media: draft.media ? backfillUploadedMediaStoryboardMetadata(draft.media, matchingMedia) : draft.media } : draft,
      matchingMedia,
    );
  });

  const syncedMedia = media.map((item, index) => {
    const sceneId = item.sceneId || item.id || '';
    const matchingDraft = (sceneId && draftBySceneId.get(sceneId)) || drafts[index];
    return matchingDraft
      ? backfillUploadedMediaStoryboardMetadata(item, matchingDraft)
      : item;
  });

  return { drafts: syncedDrafts, media: syncedMedia };
};

export const serializeUploadedMediaForPersistence = (items: UploadedMedia[]): UploadedMedia[] => {
  return items.map((item) => ({
    ...item,
    file: null as any,
  }));
};

export const serializeSceneDraftsForPersistence = (drafts: SceneDraft[]): SceneDraft[] => {
  return drafts.map((draft) => ({
    ...draft,
    media: draft.media ? serializeUploadedMediaForPersistence([draft.media])[0] : undefined,
    imageVariants: draft.imageVariants?.map((variant) => ({
      ...variant,
      media: serializeUploadedMediaForPersistence([variant.media])[0],
    })),
  }));
};

/** Derive a display-ready data URL from a media item without storing a duplicate string. */
export const getMediaDisplayUrl = (media?: Pick<UploadedMedia, 'previewUrl' | 'base64' | 'mimeType'> | null): string => {
  if (!media) return '';
  if (media.previewUrl) return media.previewUrl;
  if (!media.base64) return '';
  if (media.base64.startsWith('data:') || media.base64.startsWith('blob:') || media.base64.startsWith('http')) {
    return media.base64;
  }
  return `data:${media.mimeType || 'image/png'};base64,${media.base64}`;
};

const parseInlineImageData = (value?: string, mimeTypeFallback?: string): ImageReferenceInput | undefined => {
  if (!value) return undefined;
  const match = value.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  if (!match) return undefined;
  return {
    mimeType: match[1] || mimeTypeFallback,
    data: match[2],
  };
};

export const getSceneVisualPrompt = (
  draft?: Pick<SceneDraft, 'imagePrompt' | 'visualDescription' | 'onScreenText' | 'voiceoverText'> | null,
  fallbackMedia?: Pick<UploadedMedia, 'imagePrompt' | 'description'> | null,
): string => {
  return (
    draft?.imagePrompt ||
    fallbackMedia?.imagePrompt ||
    draft?.visualDescription ||
    fallbackMedia?.description ||
    draft?.onScreenText ||
    draft?.voiceoverText ||
    ''
  ).trim();
};

export const cleanScriptText = (text?: string): string => {
  if (!text) return '';
  // Strips role prefixes like "HOOK:", "CONTEXT:", "SCENE 1:" generated by LLM planning phases
  return text.replace(/^(?:HOOK|CONTEXT|MESSAGE|CLAIM|MESSAGE\/CLAIM|COUNTERPOINT|PROOF|TAKEAWAY|CTA|SCENE(?:\s*\d+)?)\s*:\s*/i, '').trim();
};

export const getEffectiveStoryboardRoute = (
  scene?: Partial<ApprovedStoryboardSceneMetadata> | null,
  fallback?: Partial<ApprovedStoryboardSceneMetadata> | null,
): SceneRoute => {
  const merged = mergeApprovedStoryboardMetadata(scene, fallback);
  if (merged.storyboardRouteOverride) return merged.storyboardRouteOverride;
  if (merged.storyboardRoute) return merged.storyboardRoute;
  if (merged.storyboardSourceMode) return sourceModeToSceneRoute(merged.storyboardSourceMode);
  return 'generate_fresh';
};

const getSceneReferenceFromState = (
  draft?: SceneDraft | null,
  fallbackMedia?: UploadedMedia | null,
): ImageReferenceInput | undefined => {
  const reference = getImageReference(draft);
  if (reference) return reference;
  return getSceneReferenceInputFromMedia(fallbackMedia);
};

export const buildRouteAwareImageRequest = (
  drafts: SceneDraft[],
  media: UploadedMedia[],
  index: number,
  route: SceneRoute,
): ImageGenerationRequest | null => {
  const current = drafts[index];
  if (!current) return null;

  const currentMedia = current.media || media[index];
  const previousDraft = index > 0 ? drafts[index - 1] : undefined;
  const nextDraft = index < drafts.length - 1 ? drafts[index + 1] : undefined;
  const previousMedia = index > 0 ? (previousDraft?.media || media[index - 1]) : undefined;
  const nextMedia = index < drafts.length - 1 ? (nextDraft?.media || media[index + 1]) : undefined;
  const previousReference = getSceneReferenceFromState(previousDraft, previousMedia);
  const nextReference = getSceneReferenceFromState(nextDraft, nextMedia);
  const currentReference = getSceneReferenceFromState(current, currentMedia);
  const productAnchorBinding = current.storyboardBaseAssetId || current.storyboardLinkedAssetId || current.brandAssetId
    ? {
        assetId: current.storyboardLinkedAssetId || current.storyboardBaseAssetId || current.brandAssetId || '',
        source: 'brand_asset' as const,
        role: 'product' as const,
        label: current.storyboardLinkedAssetDescription || current.storyboardBaseAssetDescription || current.productTitle || 'Product reference',
        description: current.storyboardLinkedAssetDescription || current.storyboardBaseAssetDescription || current.visualDescription,
      }
    : undefined;

  const assembly = buildRouteReferenceAssembly({
    route,
    scene: current,
    currentReference,
    previousReference,
    nextReference,
    previousSceneText: previousDraft ? (previousDraft.voiceoverText || previousDraft.onScreenText) : undefined,
    nextSceneText: nextDraft ? (nextDraft.voiceoverText || nextDraft.onScreenText) : undefined,
    productAnchor: productAnchorBinding,
    selectedBindings: current.sceneReferenceBindings,
  });

  if (!assembly.request) {
    return null;
  }

  return {
    ...assembly.request,
    imagePrompt: getSceneVisualPrompt(current, currentMedia),
    visualDescription: current.visualDescription,
  };
};

export const getRouteActionSpec = (
  scene?: Partial<SceneDraft> | null,
  media?: Partial<UploadedMedia> | null,
): SceneRouteActionSpec => {
  const effectiveRoute = getEffectiveStoryboardRoute(scene, media);
  const approvedRoute = scene?.storyboardRoute || media?.storyboardRoute;
  const overrideActive = Boolean(
    scene?.storyboardRouteOverride
    && approvedRoute
    && scene.storyboardRouteOverride !== approvedRoute,
  );
  const hasAnchoredAsset = Boolean(
    scene?.storyboardLinkedAssetId
    || scene?.storyboardBaseAssetId
    || media?.storyboardLinkedAssetId
    || media?.storyboardBaseAssetId
    || scene?.brandAssetId
    || media?.brandAssetId,
  );

  let spec: Omit<SceneRouteActionSpec, 'effectiveRoute' | 'approvedRoute' | 'warning'> & { warning?: string } = {
    primaryAction: { id: 'generate_new_scene', label: 'Generate New Scene' },
    secondaryActions: [{ id: 'use_prior_scene_context', label: 'Use Prior Scene Context' }],
    guidance: 'Generate a fresh scene from the current brief and product context.',
  };

  switch (effectiveRoute) {
    case 'use_existing':
      spec = {
        primaryAction: { id: 'restore_shot', label: 'Restore Shot' },
        secondaryActions: [
          { id: 'reframe_shot', label: 'Reframe' },
          { id: 'choose_different_asset', label: 'Choose Different Asset' },
        ],
        guidance: 'Keep the approved product shot. Reapply or lightly reframe the existing asset instead of generating a new scene.',
        warning: hasAnchoredAsset ? undefined : 'No approved asset is currently bound to this scene. Restoring the shot may not be possible until you choose a base asset.',
      };
      break;
    case 'upgrade_existing':
      spec = {
        primaryAction: { id: 'upgrade_shot', label: 'Upgrade Shot' },
        secondaryActions: [
          { id: 'tune_prompt', label: 'Tune Prompt' },
          { id: 'choose_base_asset', label: 'Choose Base Asset' },
        ],
        guidance: 'Preserve the real product while improving composition, lighting, and scene polish.',
        warning: hasAnchoredAsset ? undefined : 'This route works best with a bound product shot. Choose a base asset if the current scene is drifting away from the approved product image.',
      };
      break;
    case 'composite_product':
      spec = {
        primaryAction: { id: 'compose_scene', label: 'Compose Scene' },
        secondaryActions: [
          { id: 'add_references', label: 'Add References' },
          { id: 'choose_base_asset', label: 'Choose Base Asset' },
        ],
        guidance: 'Keep the product exact, but place it into a new world with extra people, props, or environments.',
        warning: hasAnchoredAsset ? undefined : 'No product anchor is bound to this scene. Composition will rely mostly on the prompt unless you choose a base asset.',
      };
      break;
    case 'continue_sequence':
      spec = {
        primaryAction: { id: 'continue_sequence', label: 'Continue Sequence' },
        secondaryActions: [
          { id: 'use_previous_shot', label: 'Use Previous Shot' },
          { id: 'tune_prompt', label: 'Tune Prompt' },
        ],
        guidance: 'Continue the previous shot with continuity in product identity, framing, and story momentum.',
      };
      break;
    case 'generate_fresh':
    default:
      spec = {
        primaryAction: { id: 'generate_new_scene', label: 'Generate New Scene' },
        secondaryActions: [
          { id: 'use_prior_scene_context', label: 'Use Prior Scene Context' },
          { id: 'tune_prompt', label: 'Tune Prompt' },
        ],
        guidance: 'Invent a new visual beat from the brief without relying on the current shot as the source image.',
      };
      break;
  }

  if (overrideActive) {
    const overrideWarning = `Route override active. Editing with ${scene?.storyboardRouteOverride ? '"' + scene.storyboardRouteOverride.replace('_', ' ') + '"' : 'an overridden route'} instead of the approved route can reduce continuity.`;
    spec.warning = spec.warning ? `${overrideWarning} ${spec.warning}` : overrideWarning;
  }

  return {
    effectiveRoute,
    approvedRoute,
    primaryAction: spec.primaryAction,
    secondaryActions: spec.secondaryActions,
    guidance: spec.guidance,
    warning: spec.warning,
  };
};

export const isLikelyVisualPromptText = (value: string): boolean => {
  if (!value) return false;
  return /(close[- ]up|medium shot|wide shot|lean into the lens|camera|foreground|background|lighting|label fully visible|hold the .* bottle|match the .* look|framing)/i.test(value);
};

export const isBrokenRewriteOutput = (value: string): boolean => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return /^here is the json requested[:\s]/i.test(value)
    || /^rewrittentext[:\s]/i.test(value.replace(/["{}]/g, ''))
    || /^the data (you requested|you've been waiting for)(?:\s+is)?$/i.test(value.trim())
    || /^the results? (you requested|you've been waiting for)(?:\s+is|(?:\s+are))?$/i.test(value.trim())
    || /^the response (you requested|you've been waiting for)(?:\s+is)?$/i.test(value.trim())
    || normalized === 'the data you requested'
    || normalized === 'the data you\'ve been waiting for is'
    || normalized === 'the results you\'ve been waiting for are';
};

export const hasInlineImageReference = (
  mediaItem?: Pick<UploadedMedia, 'base64' | 'previewUrl' | 'thumbnailUrl'> | null,
): boolean => Boolean(
  mediaItem?.base64 ||
  mediaItem?.previewUrl?.startsWith('data:image/') ||
  mediaItem?.thumbnailUrl?.startsWith('data:image/'),
);

export const getSceneDraftId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `scene-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

export const getSceneImageVariantId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `scene-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

export const clampSceneDuration = (value?: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SCENE_DURATION;
  }
  return Math.max(MIN_SCENE_DURATION, Math.min(MAX_SCENE_DURATION, value));
};

const ROLE_WEIGHTS: Record<ScenePacingRole, number> = {
  hook: 0.7,
  body: 1.0,
  cta: 1.25,
  other: 1.0,
};

/** Infer pacing role from scriptGuidance labels / position. */
export const parseSceneRole = (
  scriptGuidance?: string,
  sceneIndex = 0,
  sceneCount = 1,
): ScenePacingRole => {
  const text = (scriptGuidance || '').toUpperCase();
  const hasHook = /\bHOOK\b/.test(text);
  const hasCta = /\bCTA\b|\bCALL[\s-]?TO[\s-]?ACTION\b|\bTAKEAWAY\b/.test(text);
  const hasBody = /\bPROOF\b|\bMESSAGE\b|\bCLAIM\b|\bCONTEXT\b|\bCOUNTERPOINT\b|\bBODY\b/.test(text);

  if (hasCta && !hasHook) return 'cta';
  if (hasHook && !hasCta) return 'hook';
  if (hasBody) return 'body';
  if (sceneCount <= 1) return 'body';
  if (sceneIndex === 0) return 'hook';
  if (sceneIndex === sceneCount - 1) return 'cta';
  return 'body';
};

/** Stored pacingRole wins; otherwise infer from draft text / position. */
export const getScenePacingRole = (
  draft: Pick<SceneDraft, 'pacingRole' | 'voiceoverText' | 'onScreenText' | 'visualDescription'>,
  sceneIndex = 0,
  sceneCount = 1,
): ScenePacingRole => {
  if (draft.pacingRole) return draft.pacingRole;
  return parseSceneRole(
    draft.voiceoverText || draft.onScreenText || draft.visualDescription,
    sceneIndex,
    sceneCount,
  );
};

export const maxSceneDurationForTarget = (targetDuration: number, sceneCount = 0): number => {
  if (!Number.isFinite(targetDuration) || targetDuration <= 0) return 15;
  // Allow longer scenes on longer reels while still leaving room for role variation.
  const divisor = sceneCount > 1 ? Math.max(2, sceneCount - 1) : 3;
  return Math.min(MAX_SCENE_DURATION, Math.max(8, targetDuration / divisor));
};

/**
 * Role-weighted duration allocation that sums exactly to targetDuration.
 * When preserveRelative is set, blend existing scene lengths into the weights.
 */
export const allocateDurationsToTarget = (
  scenes: Array<{
    scriptGuidance?: string;
    pacingRole?: ScenePacingRole;
    estimatedDuration?: number;
    requestedDurationSec?: number;
  }>,
  targetDuration: number,
  options?: { preserveRelative?: boolean; minSec?: number; maxSec?: number },
): number[] => {
  const n = scenes.length;
  if (n === 0) return [];

  const minSec = options?.minSec ?? MIN_SCENE_DURATION;
  const maxSec = options?.maxSec ?? maxSceneDurationForTarget(targetDuration, n);
  const safeTarget = Math.max(minSec * n, Number(targetDuration) || minSec * n);

  const roles = scenes.map((scene, index) =>
    scene.pacingRole || parseSceneRole(scene.scriptGuidance, index, n),
  );
  let weights = roles.map((role) => ROLE_WEIGHTS[role]);

  if (options?.preserveRelative) {
    const existing = scenes.map((scene) => {
      const value = scene.requestedDurationSec ?? scene.estimatedDuration ?? 0;
      return Number.isFinite(value) && value > 0 ? value : 0;
    });
    const existingSum = existing.reduce((sum, value) => sum + value, 0);
    if (existingSum > 0.1) {
      weights = existing.map((value, index) => Math.max(0.15, value) * ROLE_WEIGHTS[roles[index]]);
    }
  }

  const weightSum = weights.reduce((sum, value) => sum + value, 0) || n;
  let durations = weights.map((weight) => (weight / weightSum) * safeTarget);

  // Iteratively clamp + redistribute so we hit the target within min/max bounds.
  for (let pass = 0; pass < 8; pass += 1) {
    let lockedSum = 0;
    let freeWeight = 0;
    const freeIndexes: number[] = [];

    durations = durations.map((duration, index) => {
      if (duration <= minSec + 1e-6) {
        lockedSum += minSec;
        return minSec;
      }
      if (duration >= maxSec - 1e-6) {
        lockedSum += maxSec;
        return maxSec;
      }
      freeIndexes.push(index);
      freeWeight += weights[index];
      return duration;
    });

    const remaining = safeTarget - lockedSum;
    if (freeIndexes.length === 0) break;

    if (remaining <= minSec * freeIndexes.length) {
      freeIndexes.forEach((index) => {
        durations[index] = minSec;
      });
      break;
    }

    freeIndexes.forEach((index) => {
      const share = (weights[index] / (freeWeight || freeIndexes.length)) * remaining;
      durations[index] = Math.max(minSec, Math.min(maxSec, share));
    });
  }

  // Final penny fix on the largest adjustable scene.
  let sum = durations.reduce((total, value) => total + value, 0);
  let diff = Number((safeTarget - sum).toFixed(2));
  if (Math.abs(diff) >= 0.05) {
    let adjustIndex = 0;
    for (let index = 1; index < durations.length; index += 1) {
      if (durations[index] > durations[adjustIndex]) adjustIndex = index;
    }
    durations[adjustIndex] = Math.max(
      minSec,
      Math.min(maxSec, Number((durations[adjustIndex] + diff).toFixed(2))),
    );
  }

  // Round to 1 decimal and re-fix residual on last scene.
  const rounded = durations.map((value) => Number(value.toFixed(1)));
  const roundedSum = rounded.reduce((total, value) => total + value, 0);
  const residual = Number((safeTarget - roundedSum).toFixed(1));
  if (Math.abs(residual) >= 0.1) {
    const last = rounded.length - 1;
    rounded[last] = Math.max(minSec, Math.min(maxSec, Number((rounded[last] + residual).toFixed(1))));
  }
  return rounded;
};

/** Equal split of target across count scenes (or a slice). */
export const equalSplitDurations = (count: number, targetDuration: number): number[] => {
  if (count <= 0) return [];
  const scenes = Array.from({ length: count }, () => ({ scriptGuidance: 'BODY' }));
  return allocateDurationsToTarget(scenes, targetDuration, { preserveRelative: false });
};

export const sumSceneDurations = (
  items: Array<{
    requestedDurationSec?: number;
    resolvedDurationSec?: number;
    duration?: number;
    extendedDuration?: number;
    estimatedDuration?: number;
  }>,
): number => {
  return items.reduce((sum, item) => {
    const value =
      item.extendedDuration
      ?? item.requestedDurationSec
      ?? item.resolvedDurationSec
      ?? item.estimatedDuration
      ?? item.duration
      ?? 0;
    return sum + (Number.isFinite(value) ? Number(value) : 0);
  }, 0);
};

/** Suggested role preset duration given remaining budget and scene count. */
export const rolePresetDuration = (
  role: ScenePacingRole,
  targetDuration: number,
  sceneCount: number,
): number => {
  const allocated = allocateDurationsToTarget(
    Array.from({ length: Math.max(1, sceneCount) }, (_, index) => ({
      scriptGuidance: index === 0 ? 'HOOK' : index === sceneCount - 1 ? 'CTA' : 'BODY',
    })),
    targetDuration,
  );
  if (role === 'hook') return allocated[0] ?? 2.5;
  if (role === 'cta') return allocated[allocated.length - 1] ?? 4;
  const mid = allocated.slice(1, -1);
  if (!mid.length) return allocated[0] ?? 3;
  return Number((mid.reduce((a, b) => a + b, 0) / mid.length).toFixed(1));
};

/**
 * Timeline targets after voice gen: keep plan/user scene times unless the sum
 * drifted far from the topic target (then role-weighted rebalance once).
 * Measured TTS lengths must never become the timeline.
 */
export const resolveVoiceTimelineTargets = (
  scenes: Array<{
    requestedDurationSec: number;
    resolvedDurationSec?: number;
    voiceoverText?: string;
    onScreenText?: string;
    visualDescription?: string;
    pacingRole?: ScenePacingRole;
    pacingLocked?: boolean;
  }>,
  targetDuration: number,
  driftThreshold = 0.15,
): number[] => {
  const timelineTargets = scenes.map((scene) => clampSceneDuration(scene.requestedDurationSec));
  if (!(targetDuration > 0) || timelineTargets.length === 0) return timelineTargets;

  const targetSum = timelineTargets.reduce((sum, value) => sum + value, 0);
  if (Math.abs(targetSum - targetDuration) <= targetDuration * driftThreshold) {
    return timelineTargets;
  }

  return rippleUnlockedDurationsToTarget(
    scenes.map((scene) => ({
      pacingRole: scene.pacingRole,
      scriptGuidance: scene.voiceoverText || scene.onScreenText || scene.visualDescription,
      requestedDurationSec: scene.requestedDurationSec,
      estimatedDuration: scene.resolvedDurationSec,
      pacingLocked: scene.pacingLocked,
    })),
    targetDuration,
  );
};

/** True when VO would have to be compressed or cut to fit the scene target. */
export const isVoiceStretchExtreme = (
  targetSec: number,
  voiceSec: number,
  threshold = 0.35,
): boolean => {
  if (!(targetSec > 0) || !(voiceSec > 0)) return false;
  return (voiceSec - targetSec) / targetSec > threshold;
};

export type NarrationFeasibility = 'feasible' | 'impossible';
export type NarrationConstraint = 'none' | 'measured_overflow' | 'locked_constraints';

export type MeasuredNarrationOffender = {
  index: number;
  sceneNumber: number;
  slotSec: number;
  measuredVoiceSec: number;
  overrunSec: number;
  pacingLocked: boolean;
};

export type MeasuredNarrationAssessment = {
  targetSec: number;
  measuredMinimumSec: number;
  feasibility: NarrationFeasibility;
  constraint: NarrationConstraint;
  reconciledSlots: number[];
  offendingScenes: MeasuredNarrationOffender[];
};

/**
 * Measured TTS is authoritative: every reconciled slot has the complete voice as
 * a hard floor. When the measured floor fits, unlocked visual slack is adjusted
 * to hit the target exactly; otherwise the result exposes the real minimum.
 */
export const assessMeasuredNarrationFeasibility = (
  scenes: Array<{
    requestedDurationSec: number;
    sceneNumber?: number;
    pacingRole?: ScenePacingRole;
    pacingLocked?: boolean;
    scriptGuidance?: string;
    voiceoverText?: string;
    onScreenText?: string;
  }>,
  voiceDurations: number[],
  targetDuration: number,
): MeasuredNarrationAssessment => {
  const n = scenes.length;
  const targetSec = Math.max(0, Number(targetDuration) || 0);
  if (!n) {
    return {
      targetSec,
      measuredMinimumSec: 0,
      feasibility: 'feasible',
      constraint: 'none',
      reconciledSlots: [],
      offendingScenes: [],
    };
  }

  const original = scenes.map((scene) => clampSceneDuration(scene.requestedDurationSec));
  const measured = scenes.map((_scene, index) => Math.max(0, Number(voiceDurations[index]) || 0));
  const floors = measured.map((voice) => voice > 0.05 ? voice : MIN_SCENE_DURATION);
  const measuredMinimumSec = Number(floors.reduce((total, value) => total + value, 0).toFixed(3));
  const offendingScenes = scenes.flatMap((scene, index): MeasuredNarrationOffender[] => {
    const overrunSec = measured[index] - original[index];
    if (overrunSec <= 0.05) return [];
    return [{
      index,
      sceneNumber: scene.sceneNumber ?? index + 1,
      slotSec: original[index],
      measuredVoiceSec: measured[index],
      overrunSec: Number(overrunSec.toFixed(2)),
      pacingLocked: Boolean(scene.pacingLocked),
    }];
  });
  const lockedVoiceConflict = offendingScenes.some((scene) => scene.pacingLocked);
  let durations = scenes.map((scene, index) => {
    const slot = clampSceneDuration(scene.requestedDurationSec);
    return scene.pacingLocked ? slot : Math.max(slot, floors[index]);
  });

  if (!(targetSec > 0)) {
    return {
      targetSec,
      measuredMinimumSec,
      feasibility: lockedVoiceConflict ? 'impossible' : 'feasible',
      constraint: lockedVoiceConflict ? 'locked_constraints' : 'none',
      reconciledSlots: durations,
      offendingScenes,
    };
  }

  const floorTotal = floors.reduce((total, value) => total + value, 0);
  if (floorTotal > targetSec + 0.005) {
    return {
      targetSec,
      measuredMinimumSec,
      feasibility: 'impossible',
      constraint: 'measured_overflow',
      reconciledSlots: durations,
      offendingScenes,
    };
  }
  if (lockedVoiceConflict) {
    return {
      targetSec,
      measuredMinimumSec,
      feasibility: 'impossible',
      constraint: 'locked_constraints',
      reconciledSlots: durations,
      offendingScenes,
    };
  }

  let sum = durations.reduce((total, value) => total + value, 0);
  if (sum > targetSec + 0.005) {
    const overflow = sum - targetSec;
    const slack = durations.map((duration, index) =>
      scenes[index].pacingLocked ? 0 : Math.max(0, duration - floors[index]),
    );
    const totalSlack = slack.reduce((total, value) => total + value, 0);
    if (totalSlack < overflow - 0.005) {
      return {
        targetSec,
        measuredMinimumSec,
        feasibility: 'impossible',
        constraint: 'locked_constraints',
        reconciledSlots: durations,
        offendingScenes,
      };
    }
    if (totalSlack > 0) {
      durations = durations.map((duration, index) =>
        duration - overflow * (slack[index] / totalSlack),
      );
    }
  } else if (sum < targetSec - 0.005) {
    const extra = targetSec - sum;
    const adjustable = scenes
      .map((scene, index) => (scene.pacingLocked ? -1 : index))
      .filter((index) => index >= 0);
    if (adjustable.length === 0) {
      return {
        targetSec,
        measuredMinimumSec,
        feasibility: 'impossible',
        constraint: 'locked_constraints',
        reconciledSlots: durations,
        offendingScenes,
      };
    }
    const weights = adjustable.map((index) => Math.max(original[index], floors[index]));
    const weightTotal = weights.reduce((total, value) => total + value, 0) || adjustable.length;
    adjustable.forEach((index, weightIndex) => {
      durations[index] += extra * (weights[weightIndex] / weightTotal);
    });
  }

  sum = durations.reduce((total, value) => total + value, 0);
  const residual = targetSec - sum;
  if (Math.abs(residual) >= 0.0001) {
    const candidates = scenes
      .map((scene, index) => ({ index, slack: durations[index] - floors[index], locked: Boolean(scene.pacingLocked) }))
      .filter((entry) => !entry.locked && (residual > 0 || entry.slack >= Math.abs(residual) - 0.0001))
      .sort((a, b) => b.slack - a.slack);
    if (candidates.length > 0) {
      const index = candidates[0].index;
      durations[index] = Math.max(floors[index], durations[index] + residual);
    }
  }
  return {
    targetSec,
    measuredMinimumSec,
    feasibility: 'feasible',
    constraint: 'none',
    reconciledSlots: durations,
    offendingScenes,
  };
};

/** Compatibility wrapper for callers that only need reconciled slots. */
export const reconcileTimelineToMeasuredVoice = (
  scenes: Parameters<typeof assessMeasuredNarrationFeasibility>[0],
  voiceDurations: number[],
  targetDuration: number,
): number[] => assessMeasuredNarrationFeasibility(scenes, voiceDurations, targetDuration).reconciledSlots;

export type MeasuredNarrationCorrection = MeasuredNarrationOffender & {
  currentWordCount: number;
  maxWords: number;
  targetVoiceSec: number;
};

/**
 * Build a selective correction plan from actual TTS cadence. Only measured
 * offenders are included; word budgets scale by the observed duration ratio.
 */
export const buildMeasuredNarrationCorrectionPlan = (
  scenes: Array<{
    requestedDurationSec: number;
    sceneNumber?: number;
    voiceoverText?: string;
    onScreenText?: string;
    pacingLocked?: boolean;
  }>,
  voiceDurations: number[],
  targetDuration: number,
): MeasuredNarrationCorrection[] => {
  const assessment = assessMeasuredNarrationFeasibility(scenes, voiceDurations, targetDuration);
  if (assessment.feasibility === 'feasible' || assessment.constraint !== 'measured_overflow') return [];

  const unlockedOffenders = assessment.offendingScenes.filter((offender) => !offender.pacingLocked);
  if (unlockedOffenders.length === 0) {
    let remainingReduction = Math.max(0, assessment.measuredMinimumSec - assessment.targetSec);
    return scenes
      .map((scene, index) => ({
        index,
        scene,
        measuredVoiceSec: Math.max(0, Number(voiceDurations[index]) || 0),
      }))
      .filter(({ scene, measuredVoiceSec }) => !scene.pacingLocked && measuredVoiceSec > MIN_SCENE_DURATION)
      .sort((a, b) => b.measuredVoiceSec - a.measuredVoiceSec)
      .flatMap(({ index, scene, measuredVoiceSec }): MeasuredNarrationCorrection[] => {
        if (remainingReduction <= 0.005) return [];
        const spoken = getSceneSpokenText(scene as Pick<SceneDraft, 'voiceoverText' | 'onScreenText'>);
        const currentWordCount = countSpokenWords(spoken);
        if (!isUsefulSpokenLine(spoken) || currentWordCount < 5) return [];
        const reduction = Math.min(remainingReduction + 0.05, measuredVoiceSec - MIN_SCENE_DURATION);
        const targetVoiceSec = measuredVoiceSec - reduction;
        const maxWords = Math.floor(currentWordCount * (targetVoiceSec / measuredVoiceSec));
        if (maxWords < 4 || maxWords >= currentWordCount) return [];
        remainingReduction -= reduction;
        return [{
          index,
          sceneNumber: scene.sceneNumber ?? index + 1,
          slotSec: scene.requestedDurationSec,
          measuredVoiceSec,
          overrunSec: Number(reduction.toFixed(3)),
          pacingLocked: false,
          currentWordCount,
          maxWords,
          targetVoiceSec: Number(targetVoiceSec.toFixed(3)),
        }];
      });
  }

  return unlockedOffenders.flatMap((offender): MeasuredNarrationCorrection[] => {
    const spoken = getSceneSpokenText(scenes[offender.index] as Pick<SceneDraft, 'voiceoverText' | 'onScreenText'>);
    const currentWordCount = countSpokenWords(spoken);
    if (!isUsefulSpokenLine(spoken) || currentWordCount < 5 || offender.measuredVoiceSec <= 0) return [];
    const targetVoiceSec = Math.max(
      MIN_SCENE_DURATION,
      Math.min(offender.slotSec - 0.1, offender.measuredVoiceSec - offender.overrunSec - 0.1),
    );
    const maxWords = Math.floor(currentWordCount * (targetVoiceSec / offender.measuredVoiceSec));
    // Four-word output is the minimum accepted meaningful correction.
    if (maxWords < 4 || maxWords >= currentWordCount) return [];
    return [{ ...offender, currentWordCount, maxWords, targetVoiceSec: Number(targetVoiceSec.toFixed(2)) }];
  });
};

export type VoiceSlotMeter = {
  index: number;
  role: ScenePacingRole;
  slotSec: number;
  voiceSec?: number;
  stretchRatio: number;
  status: VoiceSlotMeterStatus;
  pacingLocked: boolean;
};

export const buildVoiceSlotMeter = (
  draft: Pick<
    SceneDraft,
    | 'pacingRole'
    | 'pacingLocked'
    | 'requestedDurationSec'
    | 'voiceAsset'
    | 'voiceoverText'
    | 'onScreenText'
    | 'visualDescription'
    | 'generationStatus'
  >,
  index: number,
  sceneCount: number,
): VoiceSlotMeter => {
  const slotSec = clampSceneDuration(draft.requestedDurationSec);
  const voiceSec = draft.voiceAsset?.durationSec;
  const role = getScenePacingRole(draft, index, sceneCount);
  const pacingLocked = Boolean(draft.pacingLocked);

  if (!(typeof voiceSec === 'number' && voiceSec > 0)) {
    return {
      index,
      role,
      slotSec,
      voiceSec,
      stretchRatio: 0,
      status: draft.generationStatus?.voice === 'stale' ? 'extreme' : 'missing',
      pacingLocked,
    };
  }

  const stretchRatio = slotSec > 0 ? Math.max(0, voiceSec - slotSec) / slotSec : 0;
  const status: VoiceSlotMeterStatus = stretchRatio > 0.35
    ? 'extreme'
    : stretchRatio > 0.15
      ? 'tight'
      : 'ok';

  return { index, role, slotSec, voiceSec, stretchRatio, status, pacingLocked };
};

export const buildPacingScenesViewModel = (drafts: SceneDraft[]): VoiceSlotMeter[] =>
  drafts.map((draft, index) => buildVoiceSlotMeter(draft, index, drafts.length));

/**
 * Keep locked (and optionally the just-edited) scenes fixed; role-weight the rest
 * so the full timeline sums to targetDuration.
 */
export const rippleUnlockedDurationsToTarget = (
  scenes: Array<{
    pacingRole?: ScenePacingRole;
    scriptGuidance?: string;
    requestedDurationSec?: number;
    estimatedDuration?: number;
    pacingLocked?: boolean;
  }>,
  targetDuration: number,
  options?: {
    editedIndex?: number;
    nextDuration?: number;
    keepEditedFixed?: boolean;
  },
): number[] => {
  const n = scenes.length;
  if (n === 0) return [];

  const base = scenes.map((scene, index) => {
    if (options?.editedIndex === index && typeof options.nextDuration === 'number') {
      return clampSceneDuration(options.nextDuration);
    }
    return clampSceneDuration(scene.requestedDurationSec ?? scene.estimatedDuration);
  });

  if (!(targetDuration > 0)) return base.map((value) => Number(value.toFixed(1)));

  const keepEditedFixed = options?.keepEditedFixed !== false
    && typeof options?.editedIndex === 'number';
  const fixedMask = scenes.map((scene, index) =>
    Boolean(scene.pacingLocked)
    || (keepEditedFixed && index === options?.editedIndex),
  );

  const unlockedIndexes = fixedMask
    .map((fixed, index) => (fixed ? -1 : index))
    .filter((index) => index >= 0);

  if (unlockedIndexes.length === 0) {
    return base.map((value) => Number(value.toFixed(1)));
  }

  const fixedSum = base.reduce((sum, value, index) => sum + (fixedMask[index] ? value : 0), 0);
  const remaining = Math.max(MIN_SCENE_DURATION * unlockedIndexes.length, targetDuration - fixedSum);

  const unlockedScenes = unlockedIndexes.map((index) => ({
    pacingRole: scenes[index].pacingRole,
    scriptGuidance: scenes[index].scriptGuidance,
    requestedDurationSec: base[index],
    estimatedDuration: base[index],
  }));

  const allocated = allocateDurationsToTarget(unlockedScenes, remaining, { preserveRelative: true });
  const result = [...base];
  unlockedIndexes.forEach((sceneIndex, allocIndex) => {
    result[sceneIndex] = allocated[allocIndex] ?? result[sceneIndex];
  });
  return result.map((value) => Number(value.toFixed(1)));
};

export const createEmptySceneDraft = (index: number): SceneDraft => ({
  id: getSceneDraftId(),
  sceneNumber: index + 1,
  visualDescription: '',
  imagePrompt: '',
  voiceoverText: '',
  onScreenText: '',
  requestedDurationSec: DEFAULT_SCENE_DURATION,
  resolvedDurationSec: DEFAULT_SCENE_DURATION,
  pacingRole: parseSceneRole(undefined, index, Math.max(1, index + 1)),
  pacingLocked: false,
  imageSource: 'generated',
  captionMode: 'derived',
  generationStatus: {
    script: 'stale',
    image: 'stale',
    voice: 'stale',
  },
});

const getSceneImageVariantLabel = (
  imageSource: SceneImageSource,
  index: number,
  preferredLabel?: string,
): string => {
  if (preferredLabel?.trim()) return preferredLabel.trim();

  const prefix = imageSource === 'brand_asset'
    ? 'Brand'
    : imageSource === 'brand_edit'
      ? 'AI Edit'
      : imageSource === 'uploaded'
        ? 'Upload'
        : 'AI';

  return `${prefix} ${index}`;
};

const cloneMediaForVariant = (
  sceneId: string,
  media: UploadedMedia,
  fallbackDuration: number,
): UploadedMedia => {
  const nextDuration = clampSceneDuration(media.extendedDuration ?? media.duration ?? fallbackDuration);
  return {
    ...media,
    sceneId,
    duration: nextDuration,
    extendedDuration: nextDuration,
  };
};

const getVariantMediaIdentity = (variant: Pick<SceneImageVariant, 'media' | 'brandAssetId' | 'imageSource'>): string => {
  const media = variant.media;
  return [
    variant.imageSource,
    variant.brandAssetId || media.brandAssetId || '',
    media.base64 || '',
    media.previewUrl || '',
    media.thumbnailUrl || '',
  ].join('::');
};

export const createSceneImageVariant = (
  sceneId: string,
  media: UploadedMedia,
  imageSource: SceneImageSource,
  brandAssetId?: string,
  preferredLabel?: string,
  existingCount = 0,
  sceneReferenceBindings?: SceneReferenceBinding[],
  sourceAssetIds?: string[],
  provenance?: AssetProvenanceStep[],
): SceneImageVariant => ({
  id: getSceneImageVariantId(),
  label: getSceneImageVariantLabel(imageSource, existingCount + 1, preferredLabel),
  imageSource,
  createdAt: new Date().toISOString(),
  media: {
    ...cloneMediaForVariant(sceneId, media, media.extendedDuration ?? media.duration ?? DEFAULT_SCENE_DURATION),
    sceneReferenceBindings: normalizeSceneReferenceBindings(sceneReferenceBindings || media.sceneReferenceBindings),
    sourceAssetIds: sourceAssetIds || media.sourceAssetIds,
    provenance: provenance || media.provenance,
  },
  brandAssetId: brandAssetId || media.brandAssetId,
  sourceAssetIds: sourceAssetIds || media.sourceAssetIds,
  provenance: provenance || media.provenance,
});

export const ensureSceneImageVariants = (draft: SceneDraft): SceneDraft => {
  if (draft.imageVariants?.length || !draft.media) {
    return draft;
  }

  const initialVariant = createSceneImageVariant(
    draft.id,
    draft.media,
    draft.imageSource,
    draft.brandAssetId,
    'Current',
    0,
    draft.sceneReferenceBindings,
  );

  return {
    ...draft,
    media: initialVariant.media,
    imageVariants: [initialVariant],
    activeVariantId: initialVariant.id,
  };
};

export const appendSceneImageVariant = (
  draft: SceneDraft,
  media: UploadedMedia,
  imageSource: SceneImageSource,
  options?: {
    brandAssetId?: string;
    label?: string;
    sceneReferenceBindings?: SceneReferenceBinding[];
    sourceAssetIds?: string[];
    provenance?: AssetProvenanceStep[];
  },
): SceneDraft => {
  const nextDraft = ensureSceneImageVariants({
    ...draft,
    media: cloneMediaForVariant(draft.id, media, draft.requestedDurationSec || draft.resolvedDurationSec),
  });
  const existingVariants = nextDraft.imageVariants || [];
  const brandAssetId = options?.brandAssetId || media.brandAssetId || draft.brandAssetId;
  const candidate = createSceneImageVariant(
    draft.id,
    media,
    imageSource,
    brandAssetId,
    options?.label,
    existingVariants.length,
    options?.sceneReferenceBindings,
    options?.sourceAssetIds,
    options?.provenance,
  );
  const candidateIdentity = getVariantMediaIdentity(candidate);
  const existingMatch = existingVariants.find((variant) => getVariantMediaIdentity(variant) === candidateIdentity);

  if (existingMatch) {
    return {
      ...nextDraft,
      media: existingMatch.media,
      imageSource: existingMatch.imageSource,
      brandAssetId: existingMatch.brandAssetId || nextDraft.brandAssetId,
      sceneReferenceBindings: normalizeSceneReferenceBindings(existingMatch.media.sceneReferenceBindings || nextDraft.sceneReferenceBindings),
      sourceAssetIds: existingMatch.media.sourceAssetIds || nextDraft.sourceAssetIds,
      provenance: existingMatch.media.provenance || nextDraft.provenance,
      activeVariantId: existingMatch.id,
    };
  }

  return {
    ...nextDraft,
    media: candidate.media,
    imageSource,
    brandAssetId,
    sceneReferenceBindings: normalizeSceneReferenceBindings(candidate.media.sceneReferenceBindings || nextDraft.sceneReferenceBindings),
    sourceAssetIds: candidate.media.sourceAssetIds || nextDraft.sourceAssetIds,
    provenance: candidate.media.provenance || nextDraft.provenance,
    imageVariants: [...existingVariants, candidate],
    activeVariantId: candidate.id,
  };
};

export const promoteSceneImageVariant = (
  draft: SceneDraft,
  variantId: string,
): SceneDraft => {
  const nextDraft = ensureSceneImageVariants(draft);
  const selectedVariant = nextDraft.imageVariants?.find((variant) => variant.id === variantId);
  if (!selectedVariant) {
    return nextDraft;
  }

  return {
    ...nextDraft,
    media: selectedVariant.media,
    imageSource: selectedVariant.imageSource,
    brandAssetId: selectedVariant.brandAssetId || nextDraft.brandAssetId,
    sceneReferenceBindings: normalizeSceneReferenceBindings(selectedVariant.media.sceneReferenceBindings || nextDraft.sceneReferenceBindings),
    sourceAssetIds: selectedVariant.media.sourceAssetIds || nextDraft.sourceAssetIds,
    provenance: selectedVariant.media.provenance || nextDraft.provenance,
    activeVariantId: selectedVariant.id,
    generationStatus: {
      ...nextDraft.generationStatus,
      image: 'clean',
    },
  };
};

export const createSceneDraftFromPlanScene = (
  scene: ScenePlan,
  index: number,
  sceneCount = index + 1,
): SceneDraft => {
  const sceneId = scene.userProvidedImage?.sceneId || getSceneDraftId();
  const imageSource = scene.userProvidedImage
    ? 'uploaded'
    : scene.brandImageIndex !== undefined
      ? (scene.brandAssetEditAction === 'use_as_is' ? 'brand_asset' : 'brand_edit')
      : 'generated';
  const requestedDurationSec = clampSceneDuration(scene.estimatedDuration);
  const pacingRole = parseSceneRole(scene.scriptGuidance, index, sceneCount);

  const uploadedMedia: UploadedMedia | undefined = scene.userProvidedImage
    ? {
        ...scene.userProvidedImage,
        sceneId,
        assetOrigin: 'user_upload' as const,
        duration: requestedDurationSec,
        extendedDuration: requestedDurationSec,
      }
    : undefined;
  const imageVariants = uploadedMedia
    ? [createSceneImageVariant(sceneId, uploadedMedia, 'uploaded', undefined, 'Upload')]
    : undefined;
    const storyboardMetadata = pickApprovedStoryboardMetadata(scene);
    const editorContinuity = pickEditorContinuityMetadata(scene);

  return {
    id: sceneId,
    sceneNumber: scene.sceneNumber || index + 1,
    visualDescription: scene.visualDescription || '',
    imagePrompt: scene.imagePrompt || '',
    voiceoverText: cleanScriptText(scene.scriptGuidance || ''),
    onScreenText: cleanScriptText(scene.onScreenText || scene.scriptGuidance || ''),
    requestedDurationSec,
    resolvedDurationSec: requestedDurationSec,
    pacingRole,
    pacingLocked: false,
    imageSource,
    captionMode: 'derived',
    generationStatus: {
      script: 'clean',
      image: scene.userProvidedImage ? 'clean' : 'stale',
      voice: 'stale',
    },
    media: uploadedMedia,
    imageVariants,
    activeVariantId: imageVariants?.[0]?.id,
    brandImageIndex: scene.brandImageIndex,
    brandAssetEditAction: scene.brandAssetEditAction,
    sceneReferenceBindings: editorContinuity.sceneReferenceBindings,
    sourceAssetIds: editorContinuity.sourceAssetIds,
    provenance: editorContinuity.provenance,
    ...storyboardMetadata,
  };
};

export const mergeScriptIntoSceneDrafts = (
  drafts: SceneDraft[],
  script: ReelScript | null,
): SceneDraft[] => {
  if (!script) return drafts;

  return drafts.map((draft, index) => {
    const plan = script.segmentPlans?.[index];
    const voiceoverText = cleanScriptText((plan?.voiceoverText || script.segments?.[index] || draft.voiceoverText || '').trim());
    const onScreenText = cleanScriptText((plan?.onScreenText || voiceoverText || draft.onScreenText || '').trim());
    const duration = clampSceneDuration(plan?.durationSec || draft.requestedDurationSec || draft.resolvedDurationSec);

    return {
      ...draft,
      sceneNumber: index + 1,
      voiceoverText,
      onScreenText,
      requestedDurationSec: duration,
      resolvedDurationSec: duration,
      visualDescription: plan?.visualBeat || draft.visualDescription,
      generationStatus: {
        ...draft.generationStatus,
        script: 'clean',
        voice: draft.voiceAsset ? draft.generationStatus.voice : 'stale',
      },
    };
  });
};

export const createSceneDraftsFromMediaAndScript = (
  media: UploadedMedia[],
  script: ReelScript | null,
): SceneDraft[] => {
  return media.map((item, index) => {
    const sceneId = item.sceneId || item.id || getSceneDraftId();
    const plan = script?.segmentPlans?.[index];
    const duration = clampSceneDuration(
      plan?.durationSec ??
      item.extendedDuration ??
      item.duration ??
      DEFAULT_SCENE_DURATION,
    );
    const hasManualCaptions = Boolean(item.captions && item.captions.length > 0);

    const nextMedia = {
      ...item,
      sceneId,
      duration,
      extendedDuration: duration,
    };
    const imageSource = item.assetOrigin === 'brand_edit'
      ? 'brand_edit'
      : item.assetOrigin === 'brand_asset'
        ? 'brand_asset'
        : item.assetOrigin === 'user_upload'
          ? 'uploaded'
          : 'generated';
    const imageVariants = (item.base64 || item.previewUrl)
      ? [createSceneImageVariant(sceneId, nextMedia, imageSource, item.brandAssetId, 'Current')]
      : undefined;
    const storyboardMetadata = pickApprovedStoryboardMetadata(item);
    const editorContinuity = pickEditorContinuityMetadata(item);

    const voiceoverText = cleanScriptText((plan?.voiceoverText || script?.segments?.[index] || '').trim());
    const onScreenText = cleanScriptText((plan?.voiceoverText || plan?.onScreenText || script?.segments?.[index] || '').trim());
    const visualDescription = item.description || plan?.visualBeat || '';

    return {
      id: sceneId,
      sceneNumber: index + 1,
      visualDescription,
      imagePrompt: item.imagePrompt || '',
      voiceoverText,
      onScreenText,
      requestedDurationSec: duration,
      resolvedDurationSec: duration,
      pacingRole: parseSceneRole(
        voiceoverText || onScreenText || visualDescription,
        index,
        media.length,
      ),
      pacingLocked: false,
      imageSource,
      captionMode: hasManualCaptions ? 'manual' : 'derived',
      generationStatus: {
        script: 'clean',
        image: item.base64 || item.previewUrl ? 'clean' : 'stale',
        voice: 'stale',
      },
      media: nextMedia,
      imageVariants,
      activeVariantId: imageVariants?.[0]?.id,
      manualCaptions: hasManualCaptions ? item.captions : [],
      brandAssetId: item.brandAssetId,
      sceneReferenceBindings: editorContinuity.sceneReferenceBindings,
      sourceAssetIds: editorContinuity.sourceAssetIds,
      provenance: editorContinuity.provenance,
      ...storyboardMetadata,
    };
  });
};

export const deriveMediaFromSceneDrafts = (drafts: SceneDraft[]): UploadedMedia[] => {
  return drafts.map((draft) => {
    const media = draft.media;
    const storyboardMetadata = mergeApprovedStoryboardMetadata(draft, media);
    const editorContinuity = mergeEditorContinuityMetadata(draft, media);
    return {
      ...(media || {
        file: new File([], `${draft.id}.png`),
        previewUrl: '',
        type: 'image' as const,
        mimeType: 'image/png',
      }),
      sceneId: draft.id,
      description: draft.visualDescription,
      imagePrompt: draft.imagePrompt,
      duration: clampSceneDuration(draft.resolvedDurationSec),
      extendedDuration: clampSceneDuration(draft.requestedDurationSec),
      captions: draft.captionMode === 'manual' ? (draft.manualCaptions || []) : [],
      assetOrigin: draft.imageSource === 'brand_edit'
        ? 'brand_edit'
        : draft.imageSource === 'brand_asset'
          ? 'brand_asset'
          : draft.imageSource === 'uploaded'
            ? 'user_upload'
            : (media?.assetOrigin || 'generated'),
      brandAssetId: draft.brandAssetId || media?.brandAssetId,
      sceneReferenceBindings: editorContinuity.sceneReferenceBindings,
      sourceAssetIds: editorContinuity.sourceAssetIds,
      provenance: editorContinuity.provenance,
      ...storyboardMetadata,
    };
  });
};

export const deriveSlideDurationsFromSceneDrafts = (drafts: SceneDraft[]): number[] => {
  return drafts.map((draft) => clampSceneDuration(draft.resolvedDurationSec));
};

export const deriveScriptFromSceneDrafts = (
  baseScript: ReelScript | null,
  drafts: SceneDraft[],
): ReelScript | null => {
  if (!baseScript && drafts.length === 0) return null;

  const segmentPlans: ReelScriptSegmentPlan[] = drafts.map((draft, index) => ({
    index,
    onScreenText: cleanScriptText(draft.onScreenText || draft.voiceoverText || ' '),
    voiceoverText: cleanScriptText(draft.voiceoverText || draft.onScreenText || ' '),
    visualBeat: draft.visualDescription || '',
    durationSec: clampSceneDuration(draft.resolvedDurationSec),
  }));

  // `segments` is the generic per-scene script text consumed by multiple studio surfaces.
  // Make spoken text authoritative so Script Studio, derived captions, and voice preview
  // default to the same line unless the user explicitly adds manual captions.
  const segments = segmentPlans.map((plan) => (plan.voiceoverText || plan.onScreenText || ' ').trim() || ' ');
  // Prefer an explicit script hook when present so preview doesn't flash scene-1 VO as the "hook".
  const preservedHook = cleanScriptText(baseScript?.hook || '').trim();
  const hook = preservedHook || segments[0] || '';

  return {
    title: baseScript?.title || 'Reel Script',
    hook,
    body: segments.slice(1).join(' '),
    callToAction: baseScript?.callToAction || '',
    fullText: segments.join(' '),
    segments,
    segmentPlans,
    musicSuggestion: baseScript?.musicSuggestion,
    suggestedVisuals: baseScript?.suggestedVisuals,
    suggestedSpeed: baseScript?.suggestedSpeed,
  };
};

export const reconcileSceneDraftsWithMedia = (
  previousDrafts: SceneDraft[],
  updatedMedia: UploadedMedia[],
): SceneDraft[] => {
  const draftMap = new Map(previousDrafts.map((draft) => [draft.id, draft]));

  return updatedMedia.map((item, index) => {
    const sceneId = item.sceneId || item.id || previousDrafts[index]?.id || getSceneDraftId();
    const existing = draftMap.get(sceneId);
    const matchedSource = existing || previousDrafts.find((draft) =>
      draft.media?.previewUrl === item.previewUrl &&
      draft.media?.mimeType === item.mimeType,
    );
    const previous = matchedSource || createEmptySceneDraft(index);
    const isNewScene = !existing;
    const hasManualCaptions = Boolean(item.captions && item.captions.length > 0);
    const nextDuration = clampSceneDuration(item.extendedDuration ?? item.duration ?? previous.requestedDurationSec);
    const voiceTooLong = previous.voiceAsset && (previous.voiceAsset.durationSec - nextDuration) > 0.25;
    const storyboardMetadata = mergeApprovedStoryboardMetadata(item, previous);
    const editorContinuity = mergeEditorContinuityMetadata(item, previous);
    const nextMedia = backfillUploadedMediaStoryboardMetadata({
      ...item,
      sceneId,
      duration: nextDuration,
      extendedDuration: nextDuration,
    }, previous);

    const nextDraft: SceneDraft = {
      ...previous,
      id: sceneId,
      sceneNumber: index + 1,
      visualDescription: item.description || previous.visualDescription,
      imagePrompt: item.imagePrompt || previous.imagePrompt,
      requestedDurationSec: nextDuration,
      resolvedDurationSec: nextDuration,
      imageSource: item.assetOrigin === 'brand_edit'
        ? 'brand_edit'
        : item.assetOrigin === 'brand_asset'
          ? 'brand_asset'
          : item.assetOrigin === 'user_upload'
            ? 'uploaded'
            : previous.imageSource,
      captionMode: hasManualCaptions ? 'manual' : 'derived',
      manualCaptions: hasManualCaptions ? item.captions : [],
      brandAssetId: item.brandAssetId || previous.brandAssetId,
      sceneReferenceBindings: editorContinuity.sceneReferenceBindings,
      sourceAssetIds: editorContinuity.sourceAssetIds,
      provenance: editorContinuity.provenance,
      media: nextMedia,
      voiceAsset: isNewScene ? undefined : previous.voiceAsset,
      generationStatus: {
        script: isNewScene || voiceTooLong ? 'stale' : previous.generationStatus.script,
        image: previous.generationStatus.image,
        voice: isNewScene || voiceTooLong ? 'stale' : previous.generationStatus.voice,
      },
      ...storyboardMetadata,
    };

    if (!item.base64 && !item.previewUrl) {
      return nextDraft;
    }

    return appendSceneImageVariant(
      nextDraft,
      nextDraft.media!,
      nextDraft.imageSource,
      {
        brandAssetId: nextDraft.brandAssetId,
        sceneReferenceBindings: nextDraft.sceneReferenceBindings,
        sourceAssetIds: nextDraft.sourceAssetIds,
        provenance: nextDraft.provenance,
      },
    );
  });
};

const getImageReference = (draft?: SceneDraft): ImageReferenceInput | undefined => {
  const data = draft?.media?.base64;
  const fallbackInline = parseInlineImageData(draft?.media?.previewUrl, draft?.media?.mimeType)
    || parseInlineImageData(draft?.media?.thumbnailUrl, draft?.media?.mimeType);
  const reference = data
    ? {
        data,
        mimeType: draft.media?.mimeType,
      }
    : fallbackInline;
  if (!reference?.data) return undefined;
  return {
    ...reference,
    assetId: draft.brandAssetId,
  };
};

export const buildSceneImageGenerationRequest = (
  drafts: SceneDraft[],
  index: number,
  mode: 'generate' | 'edit',
): ImageGenerationRequest | null => {
  const current = drafts[index];
  if (!current) return null;

  return {
    mode,
    imagePrompt: current.imagePrompt,
    visualDescription: current.visualDescription,
    primaryReference: mode === 'edit' ? getImageReference(current) : undefined,
    prevSceneReference: index > 0 ? getImageReference(drafts[index - 1]) : undefined,
    nextSceneReference: index < drafts.length - 1 ? getImageReference(drafts[index + 1]) : undefined,
    prevSceneText: index > 0 ? drafts[index - 1].voiceoverText || drafts[index - 1].onScreenText : undefined,
    currentSceneText: current.voiceoverText || current.onScreenText,
    nextSceneText: index < drafts.length - 1 ? drafts[index + 1].voiceoverText || drafts[index + 1].onScreenText : undefined,
  };
};

const hashText = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return `${Math.abs(hash)}`;
};

/** Spoken text actually sent to TTS — keep cache keys in sync with this. */
export const getSceneSpokenText = (draft: Pick<SceneDraft, 'voiceoverText' | 'onScreenText'>): string => {
  return (draft.voiceoverText || draft.onScreenText || '').trim();
};

export const countSpokenWords = (text?: string): number =>
  (text || '').trim().split(/\s+/).filter(Boolean).length;

export const estimateSpokenDurationSec = (
  text?: string,
  wordsPerSec: number = WORDS_PER_SEC,
): number => {
  const words = countSpokenWords(text);
  if (words <= 0 || !(wordsPerSec > 0)) return 0;
  return Number((words / wordsPerSec).toFixed(2));
};

export const maxWordsForSlot = (
  slotSec: number,
  wordsPerSec: number = WORDS_PER_SEC,
): number => {
  const safeSlot = Math.max(0, Number(slotSec) || 0);
  // Floor of 6 keeps short scenes from collapsing into useless 2–3 word stubs.
  return Math.max(6, Math.floor(safeSlot * wordsPerSec));
};

/** True when a spoken line is still a usable sentence/phrase (not a truncated stub). */
export const isUsefulSpokenLine = (text?: string, minWords = 4): boolean => {
  const cleaned = cleanScriptText(text || '').trim();
  if (!cleaned) return false;
  const words = countSpokenWords(cleaned);
  if (words < minWords && cleaned.replace(/[.!?…]+$/g, '').length < 16) return false;
  if (/^(hook|body|cta|scene|proof|context)\b/i.test(cleaned) && words <= 3) return false;
  return true;
};

export type ScriptBudgetStatus = 'ok' | 'tight' | 'over';

export type SceneScriptBudget = {
  wordCount: number;
  maxWords: number;
  estimatedSec: number;
  slotSec: number;
  status: ScriptBudgetStatus;
  needsFit: boolean;
};

export const getSceneScriptBudget = (
  draft: Pick<SceneDraft, 'voiceoverText' | 'onScreenText' | 'requestedDurationSec'>,
  options?: { wordsPerSec?: number; overflowRatio?: number },
): SceneScriptBudget => {
  const wordsPerSec = options?.wordsPerSec ?? WORDS_PER_SEC;
  const overflowRatio = options?.overflowRatio ?? SCRIPT_FIT_OVERFLOW_RATIO;
  const spoken = getSceneSpokenText(draft);
  const slotSec = clampSceneDuration(draft.requestedDurationSec);
  const wordCount = countSpokenWords(spoken);
  const maxWords = maxWordsForSlot(slotSec, wordsPerSec);
  const estimatedSec = estimateSpokenDurationSec(spoken, wordsPerSec);
  const needsFit = wordCount > maxWords
    || (slotSec > 0 && estimatedSec > slotSec * overflowRatio);
  const status: ScriptBudgetStatus = needsFit
    ? 'over'
    : (wordCount > Math.floor(maxWords * 0.85) || (slotSec > 0 && estimatedSec > slotSec * 0.9))
      ? 'tight'
      : 'ok';

  return { wordCount, maxWords, estimatedSec, slotSec, status, needsFit };
};

export const sceneNeedsScriptFit = (
  draft: Pick<SceneDraft, 'voiceoverText' | 'onScreenText' | 'requestedDurationSec'>,
): boolean => getSceneScriptBudget(draft).needsFit;

const TRAILING_GLUE = new Set([
  'a', 'an', 'the', 'to', 'of', 'and', 'or', 'for', 'with', 'in', 'on', 'at', 'by', 'from',
]);

/**
 * Compress spoken copy toward a word budget while preferring complete meaning.
 * Never returns a useless stub when the original line was useful.
 */
export const truncateSpokenTextToBudget = (text: string, maxWords: number): string => {
  const cleaned = cleanScriptText(text).trim();
  if (!cleaned) return '';
  const budget = Math.max(6, Math.floor(maxWords));
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length <= budget) return cleaned;

  // Prefer the first complete sentence when it fits.
  const firstSentence = cleaned.match(/^[^.!?]+[.!?]+/)?.[0]?.trim();
  if (firstSentence && countSpokenWords(firstSentence) <= budget && isUsefulSpokenLine(firstSentence)) {
    return firstSentence;
  }

  // Prefer a clause before an em/en dash or comma when useful.
  const clause = cleaned.split(/\s+[—–-]\s+|,\s+/)[0]?.trim();
  if (clause && countSpokenWords(clause) <= budget && isUsefulSpokenLine(clause, 3)) {
    return /[.!?]$/.test(clause) ? clause : `${clause}.`;
  }

  let slice = words.slice(0, budget);
  while (slice.length > 4 && TRAILING_GLUE.has(slice[slice.length - 1].toLowerCase().replace(/[^\w']/g, ''))) {
    slice = slice.slice(0, -1);
  }
  let compressed = slice.join(' ');
  if (!/[.!?]$/.test(compressed)) compressed += '.';

  // Meaning wins: if compression destroyed the line, keep the best useful original fragment.
  if (!isUsefulSpokenLine(compressed) && isUsefulSpokenLine(cleaned)) {
    if (firstSentence && isUsefulSpokenLine(firstSentence)) return firstSentence;
    return cleaned;
  }
  return compressed;
};

export const getSceneVoiceCacheKey = (draft: SceneDraft, voice: VoiceOption): string => {
  return [
    draft.id,
    voice.provider,
    voice.id,
    hashText(getSceneSpokenText(draft)),
  ].join(':');
};

export const applySceneTextEdit = (
  draft: SceneDraft,
  nextValue: string,
  field: 'voiceoverText' | 'onScreenText' | 'both',
): SceneDraft => {
  const trimmed = nextValue;
  const voiceoverText = field === 'onScreenText' ? draft.voiceoverText : trimmed;
  const onScreenText = field === 'voiceoverText' ? draft.onScreenText : trimmed;

  return {
    ...draft,
    voiceoverText,
    onScreenText,
    generationStatus: {
      ...draft.generationStatus,
      script: 'clean',
      voice: 'stale',
    },
    voiceAsset: undefined,
  };
};

export const applySceneDurationEdit = (draft: SceneDraft, nextDuration: number): SceneDraft => {
  const requestedDurationSec = clampSceneDuration(nextDuration);
  const voiceSec = draft.voiceAsset?.durationSec;
  const voiceTooLong = typeof voiceSec === 'number' && (voiceSec - requestedDurationSec) > 0.25;
  const voiceFits = typeof voiceSec === 'number' && voiceSec > 0 && !isVoiceStretchExtreme(requestedDurationSec, voiceSec);

  return {
    ...draft,
    requestedDurationSec,
    resolvedDurationSec: requestedDurationSec,
    generationStatus: {
      ...draft.generationStatus,
      script: voiceTooLong ? 'stale' : draft.generationStatus.script,
      voice: voiceTooLong
        ? 'stale'
        : (voiceFits && draft.generationStatus.voice === 'stale' ? 'clean' : draft.generationStatus.voice),
    },
  };
};
