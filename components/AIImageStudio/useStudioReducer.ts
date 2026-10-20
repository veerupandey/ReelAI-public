import React, { useReducer, useEffect, useCallback, useRef } from 'react';
import type {
  StudioState,
  StudioAsset,
  CreativeRoute,
  AspectRatio,
  ReferenceRole,
  RoleAssignment,
  HistoryEntry,
  ComposerReference,
  ComposerReferenceRole,
  StudioDocument,
  GenerationVersion,
  ProductTruth,
  BrandKnowledge,
  TrendResearchResult,
  CreativeConcept,
  SocialPostDraft,
  StudioCaptionPack,
  StrategistBrief,
  StudioProductionBrief,
  CreativeDirection,
  OutputIntent,
} from './types';
import {
  deserializeStudioState,
  emptyStudioState,
  SESSION_STORAGE_KEY,
} from './studioStatePersistence';
import type { ProductionBrief } from './productionBriefService';
import { areProtectedAssetsInSync } from './creativeCopilotService';

/**
 * All possible actions for the studio reducer.
 */
export type StudioAction =
  // --- Legacy actions (kept for backward compatibility) ---
  | { type: 'ADD_ASSETS'; assets: StudioAsset[] }
  | { type: 'REMOVE_ASSET'; id: string }
  | { type: 'UPDATE_ASSET'; id: string; updates: Partial<StudioAsset> }
  | { type: 'TOGGLE_SELECT'; id: string }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SET_MULTI_SELECT'; enabled: boolean }
  | { type: 'SET_DETAIL_ASSET'; id: string | null }
  | { type: 'SET_VIEW_MODE'; mode: 'default' | 'compact' }
  | { type: 'SET_CREATIVE_ROUTE'; route: CreativeRoute }
  | { type: 'SET_ASPECT_RATIO'; ratio: AspectRatio }
  | { type: 'SET_PROMPT'; text: string }
  | { type: 'SET_PROMPT_ENRICHED'; text: string; enriched: boolean }
  | { type: 'SET_ROLE'; assetId: string; role: ReferenceRole }
  | { type: 'SET_ROLE_INSTRUCTIONS'; assetId: string; preserve?: string; modify?: string }
  | { type: 'GENERATION_START' }
  | { type: 'GENERATION_SUCCESS'; asset: StudioAsset; historyEntry: HistoryEntry }
  | { type: 'GENERATION_FAILURE'; error: string; historyEntry: HistoryEntry }
  | { type: 'SET_GENERATING'; generating: boolean }
  | { type: 'SET_ENHANCING'; enhancing: boolean }
  // --- Phase 1 actions: gallery selection (separate from composer references) ---
  | { type: 'GALLERY_TOGGLE_SELECT'; id: string }
  | { type: 'GALLERY_CLEAR_SELECTION' }
  | { type: 'POST_QUEUE_TOGGLE'; id: string }
  | { type: 'POST_QUEUE_REORDER'; fromIndex: number; toIndex: number }
  | { type: 'POST_QUEUE_CLEAR' }
  | { type: 'POST_QUEUE_SET'; ids: string[] }
  // --- Phase 1 actions: composer references ---
  | { type: 'ADD_COMPOSER_REFERENCE'; reference: ComposerReference }
  | { type: 'UPDATE_COMPOSER_REFERENCE'; assetId: string; updates: Partial<Omit<ComposerReference, 'assetId'>> }
  | { type: 'REMOVE_COMPOSER_REFERENCE'; assetId: string }
  | { type: 'SET_COMPOSER_REFERENCE_ROLE'; assetId: string; role: ComposerReferenceRole }
  | { type: 'CLEAR_COMPOSER_REFERENCES' }
  // --- Phase 1 actions: active document ---
  | { type: 'OPEN_DOCUMENT'; document: StudioDocument }
  | { type: 'CLOSE_DOCUMENT' }
  | { type: 'UPDATE_DOCUMENT'; updates: Partial<StudioDocument> }
  // --- Phase 1 actions: generation versions ---
  | { type: 'ADD_VERSION'; version: GenerationVersion }
  // --- Phase 1 actions: product truth ---
  | { type: 'SET_PRODUCT_TRUTH'; productTruth: ProductTruth }
  | { type: 'CLEAR_PRODUCT_TRUTH' }
  | { type: 'ADD_PRODUCT_TRUTH_CORRECTION'; correction: string }
  | { type: 'SET_BRAND_KNOWLEDGE'; brandKnowledge: BrandKnowledge }
  | { type: 'CLEAR_BRAND_KNOWLEDGE' }
  | { type: 'SET_BRAND_URL_INPUT'; text: string }
  | { type: 'SET_TREND_RESEARCH'; trendResearch: TrendResearchResult }
  | { type: 'CLEAR_TREND_RESEARCH' }
  | { type: 'EXCLUDE_TREND_INSIGHT'; insightId: string }
  | { type: 'SET_CONCEPT_CANDIDATES'; concepts: CreativeConcept[] }
  | { type: 'APPEND_CONCEPT_CANDIDATES'; concepts: CreativeConcept[] }
  | { type: 'SELECT_CONCEPT'; conceptId: string }
  | { type: 'REJECT_CONCEPT'; conceptId: string }
  | { type: 'MARK_CONCEPTS_STALE' }
  | { type: 'CLEAR_CONCEPT_CANDIDATES' }
  | { type: 'SET_SOCIAL_POST_DRAFT'; draft: SocialPostDraft }
  | { type: 'UPDATE_SOCIAL_POST_DRAFT'; updates: Partial<SocialPostDraft> }
  | { type: 'CLEAR_SOCIAL_POST_DRAFT' }
  | { type: 'SET_CAPTION_PACK'; captionPack: StudioCaptionPack }
  | { type: 'UPDATE_CAPTION_PACK'; updates: Partial<StudioCaptionPack> }
  | { type: 'CLEAR_CAPTION_PACK' }
  | { type: 'SET_STRATEGIST_BRIEF'; brief: StrategistBrief }
  | { type: 'UPDATE_STRATEGIST_BRIEF'; updates: Partial<StrategistBrief> }
  | { type: 'CLEAR_STRATEGIST_BRIEF' }
  | { type: 'SET_PRODUCTION_BRIEF'; brief: ProductionBrief | StudioProductionBrief }
  | { type: 'UPDATE_PRODUCTION_BRIEF'; updates: Partial<ProductionBrief | StudioProductionBrief> }
  | { type: 'CLEAR_PRODUCTION_BRIEF' }
  | { type: 'SET_ACTIVE_DIRECTION'; direction: CreativeDirection }
  | { type: 'CLEAR_ACTIVE_DIRECTION' }
  | { type: 'SET_OUTPUT_INTENT'; outputIntent: OutputIntent }
  | { type: 'TOGGLE_VARIATION_FAVORITE'; assetId: string }
  | { type: 'KEEP_VARIATION_FAVORITES'; variationSetId: string }
  | { type: 'REPLACE_STATE'; state: StudioState };

/** Maximum number of assets that can be selected at once. */
const MAX_SELECTION = 100;

/** Instagram carousel limit. */
export const MAX_POST_QUEUE = 10;

/** Maximum number of history entries retained (LIFO). */
const MAX_HISTORY = 50;

/**
 * Initial state for the AI Image Studio.
 */
export const initialState: StudioState = emptyStudioState;

/**
 * Adds a history entry to the front of the history array,
 * enforcing the max 50 entry limit by evicting the oldest (last) entry.
 */
function addHistoryEntry(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const updated = [entry, ...history];
  if (updated.length > MAX_HISTORY) {
    return updated.slice(0, MAX_HISTORY);
  }
  return updated;
}

/** Apply gallery selection (canonical multi-select). */
function withGallerySelection(
  state: StudioState,
  gallerySelectionIds: Set<string>,
): StudioState {
  return {
    ...state,
    gallerySelectionIds,
  };
}

/**
 * When locked product selection diverges from productTruth.protectedAssetIds,
 * mark product truth / strategist brief stale and candidate concepts stale —
 * without wiping brand/trend research.
 */
function applyProtectedAssetSync(
  state: StudioState,
  lockedAssetIds: string[],
): Pick<StudioState, 'productTruthStale' | 'strategistBriefStale' | 'conceptCandidates'> {
  if (!state.productTruth) {
    return {
      productTruthStale: false,
      strategistBriefStale: false,
      conceptCandidates: state.conceptCandidates,
    };
  }

  const inSync = areProtectedAssetsInSync(state.productTruth, lockedAssetIds);
  if (inSync) {
    return {
      productTruthStale: false,
      strategistBriefStale: false,
      conceptCandidates: state.conceptCandidates,
    };
  }

  return {
    productTruthStale: true,
    strategistBriefStale: Boolean(state.strategistBrief) || state.strategistBriefStale === true,
    conceptCandidates: state.conceptCandidates.map((c) =>
      c.status === 'candidate' ? { ...c, status: 'stale' as const } : c,
    ),
  };
}

/**
 * Studio reducer — handles all state transitions for the AI Image Studio.
 */
export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case 'ADD_ASSETS': {
      return {
        ...state,
        assets: [...state.assets, ...action.assets],
      };
    }

    case 'REMOVE_ASSET': {
      const gallerySelectionIds = new Set(state.gallerySelectionIds);
      gallerySelectionIds.delete(action.id);

      const newRoleAssignments = new Map(state.roleAssignments);
      newRoleAssignments.delete(action.id);

      return withGallerySelection(
        {
          ...state,
          assets: state.assets.filter((a) => a.id !== action.id),
          roleAssignments: newRoleAssignments,
          composerReferences: state.composerReferences.filter(
            (reference) => reference.assetId !== action.id,
          ),
          postQueueIds: state.postQueueIds.filter((id) => id !== action.id),
          detailAssetId: state.detailAssetId === action.id ? null : state.detailAssetId,
        },
        gallerySelectionIds,
      );
    }

    case 'UPDATE_ASSET': {
      return {
        ...state,
        assets: state.assets.map((a) =>
          a.id === action.id ? { ...a, ...action.updates } : a,
        ),
      };
    }

    case 'TOGGLE_VARIATION_FAVORITE': {
      return {
        ...state,
        assets: state.assets.map((asset) =>
          asset.id === action.assetId &&
          asset.variationSetId &&
          asset.variationIndex != null &&
          !asset.carouselSetId
            ? { ...asset, isFavorite: !asset.isFavorite }
            : asset,
        ),
      };
    }

    case 'KEEP_VARIATION_FAVORITES': {
      const setAssets = state.assets.filter(
        (asset) =>
          asset.variationSetId === action.variationSetId &&
          asset.variationIndex != null &&
          !asset.carouselSetId,
      );
      const favoriteIds = new Set(
        setAssets.filter((asset) => asset.isFavorite).map((asset) => asset.id),
      );
      if (favoriteIds.size === 0) return state;

      const removedIds = new Set(
        setAssets
          .filter((asset) => !favoriteIds.has(asset.id))
          .map((asset) => asset.id),
      );
      const gallerySelectionIds = new Set(
        Array.from(state.gallerySelectionIds).filter((id) => !removedIds.has(id)),
      );
      const roleAssignments = new Map(state.roleAssignments);
      removedIds.forEach((id) => roleAssignments.delete(id));

      return withGallerySelection(
        {
          ...state,
          assets: state.assets.filter((asset) => !removedIds.has(asset.id)),
          roleAssignments,
          composerReferences: state.composerReferences.filter(
            (reference) => !removedIds.has(reference.assetId),
          ),
          postQueueIds: state.postQueueIds.filter((id) => !removedIds.has(id)),
          detailAssetId:
            state.detailAssetId && removedIds.has(state.detailAssetId)
              ? null
              : state.detailAssetId,
        },
        gallerySelectionIds,
      );
    }

    case 'TOGGLE_SELECT': {
      // Deprecated alias — delegates to gallery selection (canonical).
      const next = new Set(state.gallerySelectionIds);
      if (next.has(action.id)) {
        next.delete(action.id);
      } else {
        if (next.size >= MAX_SELECTION) {
          return state;
        }
        next.add(action.id);
      }
      return {
        ...withGallerySelection(state, next),
        ...applyProtectedAssetSync(state, Array.from(next)),
      };
    }

    case 'CLEAR_SELECTION': {
      return {
        ...withGallerySelection(state, new Set()),
        ...applyProtectedAssetSync(state, []),
      };
    }

    case 'SET_MULTI_SELECT': {
      if (!action.enabled) {
        return withGallerySelection(
          { ...state, multiSelectEnabled: false },
          new Set(),
        );
      }
      return {
        ...state,
        multiSelectEnabled: true,
      };
    }

    case 'SET_DETAIL_ASSET': {
      return {
        ...state,
        detailAssetId: action.id,
      };
    }

    case 'SET_VIEW_MODE': {
      return {
        ...state,
        viewMode: action.mode,
      };
    }

    case 'SET_CREATIVE_ROUTE': {
      // When entering composite mode, assign default 'product' role to selected assets
      // that don't already have a role assignment
      if (action.route === 'composite') {
        const newRoleAssignments = new Map(state.roleAssignments);
        for (const assetId of state.gallerySelectionIds) {
          if (!newRoleAssignments.has(assetId)) {
            newRoleAssignments.set(assetId, { role: 'product' });
          }
        }
        return {
          ...state,
          creativeRoute: action.route,
          roleAssignments: newRoleAssignments,
        };
      }
      return {
        ...state,
        creativeRoute: action.route,
      };
    }

    case 'SET_ASPECT_RATIO': {
      return {
        ...state,
        aspectRatio: action.ratio,
      };
    }

    case 'SET_PROMPT': {
      // User direction changes → mark concepts stale (preserve research and references)
      const updatedCandidates = state.conceptCandidates.map((c) =>
        c.status === 'candidate' ? { ...c, status: 'stale' as const } : c,
      );
      return {
        ...state,
        prompt: action.text,
        conceptCandidates: updatedCandidates,
        socialPostDraft: undefined,
        productionBrief: undefined,
        isPromptEnriched: false,
      };
    }

    case 'SET_PROMPT_ENRICHED': {
      return {
        ...state,
        prompt: action.text,
        isPromptEnriched: action.enriched,
      };
    }

    case 'SET_ROLE': {
      const newRoleAssignments = new Map(state.roleAssignments);
      const existing = newRoleAssignments.get(action.assetId);
      if (existing) {
        newRoleAssignments.set(action.assetId, { ...existing, role: action.role });
      } else {
        // Create new assignment with default role if none exists
        newRoleAssignments.set(action.assetId, { role: action.role });
      }
      return {
        ...state,
        roleAssignments: newRoleAssignments,
      };
    }

    case 'SET_ROLE_INSTRUCTIONS': {
      const newRoleAssignments = new Map(state.roleAssignments);
      const existing = newRoleAssignments.get(action.assetId);
      if (existing) {
        newRoleAssignments.set(action.assetId, {
          ...existing,
          preserve: action.preserve,
          modify: action.modify,
        });
      } else {
        // Create new assignment with default role 'product' if none exists
        newRoleAssignments.set(action.assetId, {
          role: 'product',
          preserve: action.preserve,
          modify: action.modify,
        });
      }
      return {
        ...state,
        roleAssignments: newRoleAssignments,
      };
    }

    case 'GENERATION_START': {
      return {
        ...state,
        isGenerating: true,
      };
    }

    case 'GENERATION_SUCCESS': {
      return {
        ...state,
        isGenerating: false,
        assets: [action.asset, ...state.assets],
        history: addHistoryEntry(state.history, action.historyEntry),
      };
    }

    case 'GENERATION_FAILURE': {
      return {
        ...state,
        isGenerating: false,
        history: addHistoryEntry(state.history, action.historyEntry),
      };
    }

    case 'SET_GENERATING': {
      return {
        ...state,
        isGenerating: action.generating,
      };
    }

    case 'SET_ENHANCING': {
      return {
        ...state,
        isEnhancing: action.enhancing,
      };
    }

    // -------------------------------------------------------------------------
    // Phase 1: Gallery selection (independent of composer references)
    // -------------------------------------------------------------------------

    case 'GALLERY_TOGGLE_SELECT': {
      const next = new Set(state.gallerySelectionIds);
      if (next.has(action.id)) {
        next.delete(action.id);
      } else {
        if (next.size >= MAX_SELECTION) {
          return state;
        }
        next.add(action.id);
      }
      return {
        ...withGallerySelection(state, next),
        ...applyProtectedAssetSync(state, Array.from(next)),
      };
    }

    case 'GALLERY_CLEAR_SELECTION': {
      return {
        ...withGallerySelection(state, new Set()),
        ...applyProtectedAssetSync(state, []),
      };
    }

    case 'POST_QUEUE_TOGGLE': {
      const exists = state.postQueueIds.includes(action.id);
      if (exists) {
        return {
          ...state,
          postQueueIds: state.postQueueIds.filter((id) => id !== action.id),
        };
      }
      if (state.postQueueIds.length >= MAX_POST_QUEUE) {
        return state;
      }
      return {
        ...state,
        postQueueIds: [...state.postQueueIds, action.id],
      };
    }

    case 'POST_QUEUE_REORDER': {
      const { fromIndex, toIndex } = action;
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= state.postQueueIds.length ||
        toIndex >= state.postQueueIds.length ||
        fromIndex === toIndex
      ) {
        return state;
      }
      const next = [...state.postQueueIds];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return { ...state, postQueueIds: next };
    }

    case 'POST_QUEUE_CLEAR': {
      return { ...state, postQueueIds: [] };
    }

    case 'POST_QUEUE_SET': {
      const seen = new Set<string>();
      const ids: string[] = [];
      for (const id of action.ids) {
        if (typeof id !== 'string' || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
        if (ids.length >= MAX_POST_QUEUE) break;
      }
      return { ...state, postQueueIds: ids };
    }

    // -------------------------------------------------------------------------
    // Phase 1: Composer references with invalidation rules
    // Locked references change → invalidate concepts, social draft
    // (preserve brand knowledge, trend research, user direction)
    // -------------------------------------------------------------------------

    case 'ADD_COMPOSER_REFERENCE': {
      const exists = state.composerReferences.some((r) => r.assetId === action.reference.assetId);
      if (exists) {
        return state;
      }
      return {
        ...state,
        composerReferences: [...state.composerReferences, action.reference],
        conceptCandidates: [],
        selectedConceptId: undefined,
        socialPostDraft: undefined,
        productionBrief: undefined,
      };
    }

    case 'UPDATE_COMPOSER_REFERENCE': {
      return {
        ...state,
        composerReferences: state.composerReferences.map((r) =>
          r.assetId === action.assetId ? { ...r, ...action.updates } : r,
        ),
        conceptCandidates: [],
        selectedConceptId: undefined,
        socialPostDraft: undefined,
        productionBrief: undefined,
      };
    }

    case 'REMOVE_COMPOSER_REFERENCE': {
      return {
        ...state,
        composerReferences: state.composerReferences.filter((r) => r.assetId !== action.assetId),
        conceptCandidates: [],
        selectedConceptId: undefined,
        socialPostDraft: undefined,
        productionBrief: undefined,
      };
    }

    case 'SET_COMPOSER_REFERENCE_ROLE': {
      return {
        ...state,
        composerReferences: state.composerReferences.map((r) =>
          r.assetId === action.assetId ? { ...r, role: action.role } : r,
        ),
        conceptCandidates: [],
        selectedConceptId: undefined,
        socialPostDraft: undefined,
        productionBrief: undefined,
      };
    }

    case 'CLEAR_COMPOSER_REFERENCES': {
      return {
        ...state,
        composerReferences: [],
        conceptCandidates: [],
        selectedConceptId: undefined,
        socialPostDraft: undefined,
        productionBrief: undefined,
      };
    }

    // -------------------------------------------------------------------------
    // Phase 1: Active document
    // -------------------------------------------------------------------------

    case 'OPEN_DOCUMENT': {
      return { ...state, activeDocument: action.document };
    }

    case 'CLOSE_DOCUMENT': {
      return { ...state, activeDocument: undefined };
    }

    case 'UPDATE_DOCUMENT': {
      if (!state.activeDocument) return state;
      return { ...state, activeDocument: { ...state.activeDocument, ...action.updates } };
    }

    // -------------------------------------------------------------------------
    // Phase 1: Generation versions
    // -------------------------------------------------------------------------

    case 'ADD_VERSION': {
      return { ...state, versions: [...state.versions, action.version] };
    }

    // -------------------------------------------------------------------------
    // Phase 1: Product truth with invalidation rules
    // Product Truth changes → invalidate concepts, social draft
    // -------------------------------------------------------------------------

    case 'SET_PRODUCT_TRUTH': {
      return {
        ...state,
        productTruth: action.productTruth,
        productTruthStale: false,
        strategistBriefStale: false,
        conceptCandidates: [],
        selectedConceptId: undefined,
        socialPostDraft: undefined,
        productionBrief: undefined,
        strategistBrief: undefined,
      };
    }

    case 'CLEAR_PRODUCT_TRUTH': {
      return {
        ...state,
        productTruth: undefined,
        productTruthStale: false,
        strategistBriefStale: false,
        conceptCandidates: [],
        selectedConceptId: undefined,
        socialPostDraft: undefined,
        productionBrief: undefined,
        strategistBrief: undefined,
      };
    }

    case 'ADD_PRODUCT_TRUTH_CORRECTION': {
      if (!state.productTruth) return state;
      // User correction may invalidate concepts - mark them stale
      const updatedCandidates = state.conceptCandidates.map((c) =>
        c.status === 'candidate' || c.status === 'selected' ? { ...c, status: 'stale' as const } : c,
      );
      return {
        ...state,
        productTruth: {
          ...state.productTruth,
          userCorrections: [...state.productTruth.userCorrections, action.correction],
        },
        conceptCandidates: updatedCandidates,
        selectedConceptId: undefined,
        socialPostDraft: undefined,
        productionBrief: undefined,
      };
    }

    // -------------------------------------------------------------------------
    // Phase 1: Brand Knowledge with invalidation rules
    // Brand Knowledge changes → invalidate trend research, concepts, social draft
    // -------------------------------------------------------------------------

    case 'SET_BRAND_KNOWLEDGE': {
      const fromKnowledge = action.brandKnowledge.sourceUrls?.join('\n') ?? '';
      return {
        ...state,
        brandKnowledge: action.brandKnowledge,
        // Keep the shared editable field in sync after research, unless user cleared it intentionally
        brandUrlInput: fromKnowledge || state.brandUrlInput,
        trendResearch: undefined,
        conceptCandidates: [],
        selectedConceptId: undefined,
        socialPostDraft: undefined,
        productionBrief: undefined,
        strategistBrief: undefined,
        activeDirection: undefined,
      };
    }

    case 'CLEAR_BRAND_KNOWLEDGE':
      return {
        ...state,
        brandKnowledge: undefined,
        // Keep brandUrlInput so the user can edit / re-run without retyping
        trendResearch: undefined,
        conceptCandidates: [],
        selectedConceptId: undefined,
        socialPostDraft: undefined,
        productionBrief: undefined,
        strategistBrief: undefined,
        activeDirection: undefined,
      };

    case 'SET_BRAND_URL_INPUT':
      return {
        ...state,
        brandUrlInput: action.text,
      };

    // -------------------------------------------------------------------------
    // Phase 1: Trend Research with invalidation rules
    // -------------------------------------------------------------------------

    case 'SET_TREND_RESEARCH': {
      // Invalidate concepts from previous trend research
      const oldTrendIds = new Set(state.trendResearch?.insights.map(i => i.id) || []);
      const invalidatedConcepts = state.conceptCandidates.map(c => {
        // If concept was backed by old trends that aren't in new research, mark stale
        const hasOldTrendBacking = c.sourceTrendInsightIds?.some(id => oldTrendIds.has(id));
        return hasOldTrendBacking ? { ...c, status: 'stale' as const } : c;
      });

      // Clear selection if selected concept became stale
      const selectedBecameStale = state.selectedConceptId &&
        invalidatedConcepts.find(c => c.id === state.selectedConceptId)?.status === 'stale';

      return {
        ...state,
        trendResearch: action.trendResearch,
        conceptCandidates: invalidatedConcepts,
        selectedConceptId: selectedBecameStale ? undefined : state.selectedConceptId,
        socialPostDraft: undefined,
        productionBrief: undefined,
        strategistBrief: undefined,
      };
    }

    case 'CLEAR_TREND_RESEARCH': {
      // Invalidate concepts that were sourced from trends and social drafts
      const trendBackedConcepts = state.conceptCandidates.map(c => ({
        ...c,
        status: c.sourceTrendInsightIds?.length > 0 ? 'stale' : c.status,
      }));
      return {
        ...state,
        trendResearch: undefined,
        conceptCandidates: trendBackedConcepts,
        // If selected concept was trend-backed, clear selection
        selectedConceptId: trendBackedConcepts.find(c => c.id === state.selectedConceptId)?.status === 'stale'
          ? undefined
          : state.selectedConceptId,
        socialPostDraft: undefined,
        productionBrief: undefined,
      };
    }

    case 'EXCLUDE_TREND_INSIGHT': {
      if (!state.trendResearch) return state;
      const conceptCandidates = state.conceptCandidates.map(concept =>
        concept.sourceTrendInsightIds.includes(action.insightId)
          ? { ...concept, status: 'stale' as const }
          : concept,
      );
      const selectedBecameStale = conceptCandidates.find(concept => concept.id === state.selectedConceptId)?.status === 'stale';
      return {
        ...state,
        trendResearch: {
          ...state.trendResearch,
          insights: state.trendResearch.insights.filter(insight => insight.id !== action.insightId),
        },
        conceptCandidates,
        selectedConceptId: selectedBecameStale ? undefined : state.selectedConceptId,
        socialPostDraft: undefined,
        productionBrief: undefined,
      };
    }

    // -------------------------------------------------------------------------
    // Phase 1: Creative Concepts with invalidation rules
    // Product Truth changes → invalidate concepts, social draft
    // Locked references change → invalidate concepts, social draft
    // User direction changes → mark concepts stale
    // -------------------------------------------------------------------------

    case 'SET_CONCEPT_CANDIDATES':
      return {
        ...state,
        conceptCandidates: action.concepts,
        selectedConceptId: undefined,
        socialPostDraft: undefined,
        productionBrief: undefined,
      };

    case 'APPEND_CONCEPT_CANDIDATES': {
      const existingIds = new Set(state.conceptCandidates.map((c) => c.id));
      const newConcepts = action.concepts.filter((c) => !existingIds.has(c.id));
      return {
        ...state,
        conceptCandidates: [...state.conceptCandidates, ...newConcepts],
      };
    }

    case 'SELECT_CONCEPT': {
      // Unselect previous and select new
      const updatedCandidates = state.conceptCandidates.map((c) => {
        if (c.id === action.conceptId) return { ...c, status: 'selected' as const };
        if (c.status === 'selected') return { ...c, status: 'candidate' as const };
        return c;
      });
      return {
        ...state,
        conceptCandidates: updatedCandidates,
        selectedConceptId: action.conceptId,
        socialPostDraft: undefined,
        productionBrief: undefined,
      };
    }

    case 'REJECT_CONCEPT': {
      const updatedCandidates = state.conceptCandidates.map((c) =>
        c.id === action.conceptId ? { ...c, status: 'rejected' as const } : c,
      );
      return { ...state, conceptCandidates: updatedCandidates };
    }

    case 'MARK_CONCEPTS_STALE': {
      const updatedCandidates = state.conceptCandidates.map((c) =>
        c.status === 'candidate' ? { ...c, status: 'stale' as const } : c,
      );
      return { ...state, conceptCandidates: updatedCandidates };
    }

    case 'CLEAR_CONCEPT_CANDIDATES':
      return {
        ...state,
        conceptCandidates: [],
        selectedConceptId: undefined,
        socialPostDraft: undefined,
        productionBrief: undefined,
      };

    // -------------------------------------------------------------------------
    // Phase 1: Social Post Draft
    // Selected concept changes → invalidate social draft
    // -------------------------------------------------------------------------

    case 'SET_SOCIAL_POST_DRAFT':
      return { ...state, socialPostDraft: action.draft };

    case 'UPDATE_SOCIAL_POST_DRAFT':
      return state.socialPostDraft
        ? { ...state, socialPostDraft: { ...state.socialPostDraft, ...action.updates } }
        : state;

    case 'CLEAR_SOCIAL_POST_DRAFT':
      return { ...state, socialPostDraft: undefined };

    case 'SET_CAPTION_PACK':
      return { ...state, captionPack: action.captionPack };

    case 'UPDATE_CAPTION_PACK':
      return state.captionPack
        ? { ...state, captionPack: { ...state.captionPack, ...action.updates } }
        : state;

    case 'CLEAR_CAPTION_PACK':
      return { ...state, captionPack: undefined };

    case 'SET_STRATEGIST_BRIEF':
      return { ...state, strategistBrief: action.brief, strategistBriefStale: false };

    case 'UPDATE_STRATEGIST_BRIEF':
      return state.strategistBrief
        ? { ...state, strategistBrief: { ...state.strategistBrief, ...action.updates }, strategistBriefStale: false }
        : state;

    case 'CLEAR_STRATEGIST_BRIEF':
      return { ...state, strategistBrief: undefined, strategistBriefStale: false };

    case 'SET_PRODUCTION_BRIEF':
      return { ...state, productionBrief: action.brief };

    case 'UPDATE_PRODUCTION_BRIEF':
      return state.productionBrief
        ? { ...state, productionBrief: { ...state.productionBrief, ...action.updates } }
        : state;

    case 'CLEAR_PRODUCTION_BRIEF':
      return { ...state, productionBrief: undefined };

    // -------------------------------------------------------------------------
    // Phase 1: Active direction (legacy, deprecated)
    // -------------------------------------------------------------------------

    case 'SET_ACTIVE_DIRECTION':
      return { ...state, activeDirection: action.direction };

    case 'CLEAR_ACTIVE_DIRECTION':
      return { ...state, activeDirection: undefined };

    case 'SET_OUTPUT_INTENT':
      return { ...state, outputIntent: action.outputIntent };

    case 'REPLACE_STATE':
      return {
        ...action.state,
        isGenerating: false,
        isEnhancing: false,
      };

    default:
      return state;
  }
}

/**
 * Hook wrapping useReducer with the studio reducer and durable session persistence.
 * - localStorage: fast restore on refresh (debounced + flush on hide/pagehide)
 * - disk autosave: full session under studio-projects/current-session when Vite API is up
 */
export function useStudioReducer(): [StudioState, React.Dispatch<StudioAction>] {
  // Load initial state from localStorage if available
  const getInitialState = useCallback((): StudioState => {
    if (typeof window === 'undefined') return initialState;
    try {
      const saved = localStorage.getItem(SESSION_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const restored = deserializeStudioState(parsed);
        if (restored) {
          console.log('[ImageStudio] Restored session from localStorage:', restored.assets.length, 'assets');
          return restored;
        }
      }
    } catch (e) {
      console.warn('[ImageStudio] Failed to restore from localStorage:', e);
    }
    return initialState;
  }, []);

  const [state, dispatch] = useReducer(studioReducer, undefined, getInitialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Upgrade from disk autosave when it has more work than localStorage (quota trim / failed write).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { resolveResumeSession } = await import('./studioSessionResume');
        const best = await resolveResumeSession(stateRef.current);
        if (cancelled) return;
        if (best !== stateRef.current && scoreDiffers(best, stateRef.current)) {
          console.log('[ImageStudio] Restored richer session from disk autosave:', best.assets.length, 'assets');
          dispatch({ type: 'REPLACE_STATE', state: best });
        }
      } catch (e) {
        console.warn('[ImageStudio] Disk resume skipped:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist to localStorage (debounced) + disk autosave (slower debounce).
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const localTimer = window.setTimeout(() => {
      void import('./studioSessionResume').then(({ writeSessionToLocalStorage }) => {
        writeSessionToLocalStorage(state);
      });
    }, 300);

    const diskTimer = window.setTimeout(() => {
      void import('./studioSessionResume').then(({ saveCurrentSessionToDisk }) => {
        void saveCurrentSessionToDisk(state);
      });
    }, 1500);

    return () => {
      window.clearTimeout(localTimer);
      window.clearTimeout(diskTimer);
    };
  }, [state]);

  // Flush immediately when the tab is hidden (laptop lid, refresh, tab discard).
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const flush = () => {
      void import('./studioSessionResume').then(({ writeSessionToLocalStorage, saveCurrentSessionToDisk }) => {
        writeSessionToLocalStorage(stateRef.current);
        void saveCurrentSessionToDisk(stateRef.current);
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };

    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return [state, dispatch];
}

function scoreDiffers(a: StudioState, b: StudioState): boolean {
  return (
    a.assets.length !== b.assets.length ||
    a.prompt !== b.prompt ||
    a.brandUrlInput !== b.brandUrlInput ||
    a.conceptCandidates.length !== b.conceptCandidates.length ||
    Boolean(a.brandKnowledge) !== Boolean(b.brandKnowledge) ||
    Boolean(a.productTruth) !== Boolean(b.productTruth) ||
    Boolean(a.strategistBrief) !== Boolean(b.strategistBrief)
  );
}
