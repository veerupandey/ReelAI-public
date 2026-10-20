import type { SceneReferenceBinding } from '../../types';
import type { AssetProvenanceRole, SceneRoute, SceneSourceMode, SceneVisualTask } from '../../types/brand';

export const getScriptStudioRouteLabel = (route?: SceneRoute): string => {
  switch (route) {
    case 'use_existing':
      return 'Use This Shot';
    case 'upgrade_existing':
      return 'Upgrade Shot';
    case 'composite_product':
      return 'Place In New World';
    case 'generate_fresh':
      return 'Imagine New Scene';
    case 'continue_sequence':
      return 'Continue Sequence';
    default:
      return 'Approved Route';
  }
};

export const getScriptStudioRouteTone = (route?: SceneRoute): string => {
  switch (route) {
    case 'use_existing':
      return 'bg-emerald-500/10 text-emerald-200 border-emerald-500/20';
    case 'upgrade_existing':
      return 'bg-cyan-500/10 text-cyan-200 border-cyan-500/20';
    case 'composite_product':
      return 'bg-fuchsia-500/10 text-fuchsia-200 border-fuchsia-500/20';
    case 'generate_fresh':
      return 'bg-amber-500/10 text-amber-200 border-amber-500/20';
    case 'continue_sequence':
      return 'bg-indigo-500/10 text-indigo-200 border-indigo-500/20';
    default:
      return 'bg-white/5 text-white/70 border-white/10';
  }
};

export const getScriptStudioSourceModeLabel = (mode?: SceneSourceMode): string => {
  switch (mode) {
    case 'use_exact_asset':
      return 'Exact Asset';
    case 'crop_reframe_asset':
      return 'Reframe Asset';
    case 'edit_from_asset':
      return 'Edit Asset';
    case 'generate_matching_shot':
      return 'Match Product';
    case 'generate_fresh':
      return 'Generate Fresh';
    default:
      return 'Source Mode';
  }
};

export const getScriptStudioVisualTaskLabel = (task?: SceneVisualTask): string => {
  switch (task) {
    case 'use_imported':
      return 'Use Imported';
    case 'edit_imported':
      return 'Edit Imported';
    case 'overlay_on_product':
      return 'Composite Scene';
    case 'generate_new':
      return 'Generate New';
    default:
      return 'Visual Task';
  }
};

export const getSceneReferenceRoleLabel = (role?: AssetProvenanceRole): string => {
  switch (role) {
    case 'product':
      return 'Product';
    case 'person':
      return 'Person';
    case 'environment':
      return 'Environment';
    case 'style_guide':
      return 'Style Guide';
    case 'previous_scene':
      return 'Previous Scene';
    case 'reference':
    default:
      return 'Reference';
  }
};

export const getSceneReferenceSourceLabel = (source?: SceneReferenceBinding['source']): string => {
  switch (source) {
    case 'brand_asset':
      return 'Brand Asset';
    case 'scene_variant':
      return 'Scene Variant';
    case 'external_image':
      return 'External Ref';
    default:
      return 'Reference';
  }
};
