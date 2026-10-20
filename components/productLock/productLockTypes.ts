import type { AssetLabMode, PlannedStoryboardScene, SceneVisualTask, StoryboardSceneState } from '../../types/brand';

export type SceneVisualTaskType = SceneVisualTask;

export interface AgencySuggestedTrim {
  sceneIdToRemove: string;
  reasoning: string;
}

export interface LockedAssetJobState {
  isGenerating: boolean;
  assetIndex: number | null;
  runId?: string;
}

export type ProductLockUndoAction =
  | {
      type: 'remove_scene';
      idea: StoryboardSceneState;
      index: number;
    }
  | {
      type: 'toggle_asset_excluded';
      assetId: string;
      excludedAssetIds: string[];
      sceneIdeas: StoryboardSceneState[];
      selectedContinuationAssetId: string;
    };

export interface PlannerRequirement {
  message: string;
  type: 'hook' | 'proof' | 'closing' | 'approval' | 'unbound' | 'repetitive';
  isFixed?: boolean;
}

export type SceneOrderingFunction = (ideas: StoryboardSceneState[]) => PlannedStoryboardScene[];
