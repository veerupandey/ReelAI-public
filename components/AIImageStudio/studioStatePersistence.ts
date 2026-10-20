/**
 * Shared serialize/deserialize for Image Studio session + named projects.
 * Keeps Set/Map JSON conversion in one place.
 */

import type {
  AspectRatio,
  BrandKnowledge,
  CreativeDirection,
  CreativeRoute,
  ProductTruth,
  SocialPostDraft,
  StudioState,
  TrendResearchResult,
} from './types';

export const SESSION_STORAGE_KEY = 'ai-image-studio-session-v1';

export type SerializedStudioState = Record<string, unknown>;

/** Empty studio state — shared by reducer and persistence. */
export const emptyStudioState: StudioState = {
  assets: [],
  multiSelectEnabled: false,
  viewMode: 'default',
  detailAssetId: null,
  prompt: '',
  creativeRoute: 'generate_fresh',
  aspectRatio: '9:16',
  roleAssignments: new Map(),
  isGenerating: false,
  isEnhancing: false,
  history: [],
  gallerySelectionIds: new Set(),
  postQueueIds: [],
  composerReferences: [],
  versions: [],
  activeDocument: undefined,
  productTruth: undefined,
  brandKnowledge: undefined,
  trendResearch: undefined,
  conceptCandidates: [],
  selectedConceptId: undefined,
  socialPostDraft: undefined,
  activeDirection: undefined,
  outputIntent: 'image',
  brandUrlInput: '',
};

export function serializeStudioState(
  state: StudioState,
  opts?: { maxAssets?: number | null },
): SerializedStudioState {
  const maxAssets = opts?.maxAssets === undefined ? 50 : opts.maxAssets;
  const assets =
    maxAssets === null ? state.assets : state.assets.slice(-Math.max(0, maxAssets));

  return {
    ...state,
    isGenerating: false,
    isEnhancing: false,
    roleAssignments: Array.from(state.roleAssignments.entries()),
    gallerySelectionIds: Array.from(state.gallerySelectionIds),
    postQueueIds: state.postQueueIds,
    assets,
  };
}

export function deserializeStudioState(saved: unknown): StudioState | null {
  try {
    const parsed = saved as Record<string, unknown>;
    const legacySelected = new Set<string>(
      Array.isArray(parsed.selectedIds) ? (parsed.selectedIds as string[]) : [],
    );
    const galleryParsed = new Set<string>(
      Array.isArray(parsed.gallerySelectionIds)
        ? (parsed.gallerySelectionIds as string[])
        : [],
    );
    // Promote legacy selectedIds when gallerySelectionIds is empty.
    const gallerySelectionIds =
      galleryParsed.size > 0 ? galleryParsed : legacySelected;

    return {
      ...emptyStudioState,
      ...parsed,
      roleAssignments: new Map(
        Array.isArray(parsed.roleAssignments) ? (parsed.roleAssignments as [string, unknown][]) : [],
      ) as StudioState['roleAssignments'],
      gallerySelectionIds: new Set(gallerySelectionIds),
      postQueueIds: Array.isArray(parsed.postQueueIds)
        ? (parsed.postQueueIds as string[]).filter((id) => typeof id === 'string').slice(0, 10)
        : [],
      assets: Array.isArray(parsed.assets) ? (parsed.assets as StudioState['assets']) : [],
      prompt: typeof parsed.prompt === 'string' ? parsed.prompt : '',
      creativeRoute: (parsed.creativeRoute as CreativeRoute) || 'generate_fresh',
      aspectRatio: (parsed.aspectRatio as AspectRatio) || '9:16',
      viewMode: (parsed.viewMode as 'default' | 'compact') || 'default',
      isGenerating: false,
      isEnhancing: false,
      history: Array.isArray(parsed.history) ? (parsed.history as StudioState['history']) : [],
      composerReferences: Array.isArray(parsed.composerReferences)
        ? (parsed.composerReferences as StudioState['composerReferences'])
        : [],
      versions: Array.isArray(parsed.versions) ? (parsed.versions as StudioState['versions']) : [],
      productTruth: (parsed.productTruth as ProductTruth | undefined) || undefined,
      productTruthStale: Boolean(parsed.productTruthStale),
      brandKnowledge: (parsed.brandKnowledge as BrandKnowledge | undefined) || undefined,
      trendResearch: (parsed.trendResearch as TrendResearchResult | undefined) || undefined,
      conceptCandidates: Array.isArray(parsed.conceptCandidates)
        ? (parsed.conceptCandidates as StudioState['conceptCandidates'])
        : [],
      selectedConceptId:
        typeof parsed.selectedConceptId === 'string' ? parsed.selectedConceptId : undefined,
      socialPostDraft: (parsed.socialPostDraft as SocialPostDraft | undefined) || undefined,
      captionPack: (parsed.captionPack as StudioState['captionPack']) || undefined,
      strategistBrief: (parsed.strategistBrief as StudioState['strategistBrief']) || undefined,
      strategistBriefStale: Boolean(parsed.strategistBriefStale),
      productionBrief: (parsed.productionBrief as StudioState['productionBrief']) || undefined,
      activeDirection: (parsed.activeDirection as CreativeDirection | undefined) || undefined,
      outputIntent: parsed.outputIntent === 'social_post' ? 'social_post' : 'image',
      isPromptEnriched: Boolean(parsed.isPromptEnriched),
      brandUrlInput:
        typeof parsed.brandUrlInput === 'string'
          ? parsed.brandUrlInput
          : Array.isArray((parsed.brandKnowledge as BrandKnowledge | undefined)?.sourceUrls)
            ? ((parsed.brandKnowledge as BrandKnowledge).sourceUrls || []).join('\n')
            : '',
      multiSelectEnabled: Boolean(parsed.multiSelectEnabled),
      detailAssetId:
        typeof parsed.detailAssetId === 'string' || parsed.detailAssetId === null
          ? (parsed.detailAssetId as string | null)
          : null,
    };
  } catch {
    return null;
  }
}
