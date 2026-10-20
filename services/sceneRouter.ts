import type { AssetLabMode, SceneRoute, SceneSourceMode, SceneVisualTask, StoryboardSceneState } from '../types/brand';

export const sceneRouteToAssetLabMode = (route: SceneRoute): AssetLabMode => {
  switch (route) {
    case 'use_existing':
      return 'continue_image_into_scene';
    case 'upgrade_existing':
      return 'image_variant';
    case 'composite_product':
      return 'continue_image_into_scene';
    case 'generate_fresh':
      return 'new_from_scene';
    case 'continue_sequence':
      return 'continue_image';
    default:
      return 'continue_image_into_scene';
  }
};

export const assetLabModeToSceneRoute = (mode?: AssetLabMode): SceneRoute => {
  switch (mode) {
    case 'scene_prompt_only':
      return 'generate_fresh';
    case 'continue_image':
      return 'continue_sequence';
    case 'continue_image_into_scene':
      return 'composite_product';
    case 'image_variant':
      return 'upgrade_existing';
    case 'new_from_scene':
      return 'generate_fresh';
    default:
      return 'composite_product';
  }
};

export const sourceModeToSceneRoute = (mode?: SceneSourceMode): SceneRoute => {
  switch (mode) {
    case 'use_exact_asset':
    case 'crop_reframe_asset':
      return 'use_existing';
    case 'edit_from_asset':
      return 'upgrade_existing';
    case 'generate_fresh':
      return 'generate_fresh';
    case 'generate_matching_shot':
    default:
      return 'composite_product';
  }
};

export const visualTaskToSceneRoute = (visualTask?: SceneVisualTask): SceneRoute => {
  switch (visualTask) {
    case 'use_imported':
      return 'use_existing';
    case 'edit_imported':
      return 'upgrade_existing';
    case 'overlay_on_product':
      return 'composite_product';
    case 'generate_new':
      return 'generate_fresh';
    default:
      return 'composite_product';
  }
};

export const resolveSceneIdeaRoute = (
  idea: Pick<StoryboardSceneState, 'route' | 'generationMode' | 'visualTask' | 'sourceMode'>,
): SceneRoute => {
  if (idea.route) return idea.route;
  if (idea.visualTask) return visualTaskToSceneRoute(idea.visualTask);
  if (idea.sourceMode) return sourceModeToSceneRoute(idea.sourceMode);
  if (idea.generationMode) return assetLabModeToSceneRoute(idea.generationMode);
  return 'composite_product';
};
