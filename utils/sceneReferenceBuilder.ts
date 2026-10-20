import type {
  ImageGenerationRequest,
  ImageReferenceInput,
  SceneDraft,
  SceneReferenceBinding,
  UploadedMedia,
} from '../types';
import type { AssetProvenanceRole, AssetProvenanceStep, SceneRoute } from '../types/brand';

const MAX_SELECTED_REFERENCES = 4;

const preserveByRole: Record<AssetProvenanceRole, string[]> = {
  product: ['product_identity', 'label', 'packaging'],
  person: ['person_identity', 'face', 'wardrobe'],
  environment: ['environment_style', 'lighting'],
  style_guide: ['lighting', 'composition', 'palette'],
  previous_scene: ['lighting', 'composition', 'sequence_continuity'],
  reference: ['mood', 'composition'],
};

const hashString = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
};

const buildDataUrl = (base64?: string, mimeType?: string): string | undefined => {
  if (!base64) return undefined;
  if (base64.startsWith('data:')) return base64;
  return `data:${mimeType || 'image/png'};base64,${base64}`;
};

const parseInlineImage = (
  value?: string,
  mimeTypeFallback?: string,
): ImageReferenceInput | undefined => {
  if (!value) return undefined;
  const match = value.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  if (!match) return undefined;
  return {
    data: match[2],
    mimeType: match[1] || mimeTypeFallback,
  };
};

const toReferenceInput = (
  binding?: Pick<SceneReferenceBinding, 'base64' | 'mimeType' | 'previewUrl' | 'assetId'> | null,
): ImageReferenceInput | undefined => {
  if (!binding) return undefined;
  if (binding.base64) {
    return {
      data: binding.base64.startsWith('data:')
        ? (binding.base64.match(/^data:(image\/[\w.+-]+);base64,(.+)$/)?.[2] || binding.base64)
        : binding.base64,
      mimeType: binding.mimeType,
      assetId: binding.assetId,
    };
  }
  const inline = parseInlineImage(binding.previewUrl, binding.mimeType);
  if (!inline) return undefined;
  return {
    ...inline,
    assetId: binding.assetId,
  };
};

const buildLegacyReferenceBinding = (
  scene?: Pick<SceneDraft, 'referenceImageBase64' | 'referenceImageMimeType'> | null,
): SceneReferenceBinding | undefined => {
  if (!scene?.referenceImageBase64) return undefined;
  const seed = `${scene.referenceImageMimeType || 'image/png'}:${scene.referenceImageBase64.slice(0, 64)}`;
  return {
    assetId: `external_ref_${hashString(seed)}`,
    source: 'external_image',
    role: 'style_guide',
    label: 'Legacy reference',
    mimeType: scene.referenceImageMimeType || 'image/png',
    base64: scene.referenceImageBase64,
    previewUrl: buildDataUrl(scene.referenceImageBase64, scene.referenceImageMimeType || 'image/png'),
  };
};

const normalizeBindingKey = (binding: SceneReferenceBinding): string => {
  return [
    binding.source,
    binding.assetId,
    binding.variantId || '',
    binding.sourceSceneId || '',
  ].join(':');
};

const normalizeBinding = (binding: SceneReferenceBinding): SceneReferenceBinding => ({
  ...binding,
  label: binding.label?.trim() || 'Reference',
  description: binding.description?.trim() || undefined,
  previewUrl: binding.previewUrl || buildDataUrl(binding.base64, binding.mimeType),
});

const roleModifyText = (role: AssetProvenanceRole, route: SceneRoute): string => {
  switch (role) {
    case 'product':
      switch (route) {
        case 'upgrade_existing':
          return 'Use this as the base product shot and improve the scene around it.';
        case 'composite_product':
          return 'Anchor the composite around this exact product while building a new world around it.';
        case 'continue_sequence':
          return 'Keep this exact product identity if it appears in the continued shot.';
        default:
          return 'Keep this exact product identity and label intact.';
      }
    case 'person':
      return route === 'composite_product'
        ? 'Use this person as a supporting subject in the composite scene.'
        : 'Use this person for continuity and subject guidance.';
    case 'environment':
      return 'Use this environment as scene-setting guidance.';
    case 'style_guide':
      return 'Use this as a style and lighting guide only.';
    case 'previous_scene':
      return 'Continue the visual sequence from this previous shot.';
    case 'reference':
    default:
      return 'Use this as supporting reference guidance only.';
  }
};

const toProvenanceStep = (
  assetId: string,
  role: AssetProvenanceRole,
  route: SceneRoute,
): AssetProvenanceStep => ({
  assetId,
  role,
  preserve: preserveByRole[role],
  modify: roleModifyText(role, route),
});

const dedupeStrings = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)));

export interface BuildRouteReferenceAssemblyParams {
  route: SceneRoute;
  scene: Pick<
    SceneDraft,
    | 'imagePrompt'
    | 'visualDescription'
    | 'voiceoverText'
    | 'onScreenText'
    | 'referenceImageBase64'
    | 'referenceImageMimeType'
    | 'sceneReferenceBindings'
  >;
  currentReference?: ImageReferenceInput;
  previousReference?: ImageReferenceInput;
  nextReference?: ImageReferenceInput;
  previousSceneText?: string;
  nextSceneText?: string;
  productAnchor?: SceneReferenceBinding;
  selectedBindings?: SceneReferenceBinding[];
}

export interface RouteReferenceAssemblyResult {
  request: ImageGenerationRequest | null;
  sourceAssetIds: string[];
  provenance: AssetProvenanceStep[];
  selectedBindings: SceneReferenceBinding[];
}

export const getExternalSceneReferenceId = (seed: string): string => `external_ref_${hashString(seed)}`;

export const createExternalSceneReferenceBinding = ({
  label,
  description,
  base64,
  mimeType,
  previewUrl,
  role = 'reference',
  sourceHint,
}: {
  label: string;
  description?: string;
  base64?: string;
  mimeType?: string;
  previewUrl?: string;
  role?: Extract<AssetProvenanceRole, 'product' | 'person' | 'environment' | 'style_guide' | 'reference'>;
  sourceHint?: string;
}): SceneReferenceBinding => {
  const resolvedPreviewUrl = previewUrl || buildDataUrl(base64, mimeType);
  const seed = `${sourceHint || label}:${mimeType || 'image/png'}:${base64 || resolvedPreviewUrl || ''}`;
  return {
    assetId: getExternalSceneReferenceId(seed),
    source: 'external_image',
    role,
    label,
    description,
    mimeType: mimeType || 'image/png',
    base64,
    previewUrl: resolvedPreviewUrl,
  };
};

export const normalizeSceneReferenceBindings = (
  bindings?: SceneReferenceBinding[] | null,
  scene?: Pick<SceneDraft, 'referenceImageBase64' | 'referenceImageMimeType'> | null,
): SceneReferenceBinding[] => {
  const next = [...(bindings || [])];
  if (!next.length) {
    const legacy = buildLegacyReferenceBinding(scene);
    if (legacy) next.push(legacy);
  }

  const deduped: SceneReferenceBinding[] = [];
  const seen = new Set<string>();
  next.forEach((binding) => {
    const normalized = normalizeBinding(binding);
    const key = normalizeBindingKey(normalized);
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(normalized);
  });
  return deduped.slice(0, MAX_SELECTED_REFERENCES);
};

export const getSceneReferenceInputFromBinding = (
  binding?: SceneReferenceBinding | null,
): ImageReferenceInput | undefined => toReferenceInput(binding);

export const getSceneReferenceInputFromMedia = (
  media?: Pick<UploadedMedia, 'base64' | 'previewUrl' | 'thumbnailUrl' | 'mimeType' | 'brandAssetId'> | null,
): ImageReferenceInput | undefined => {
  if (!media) return undefined;
  if (media.base64) {
    return {
      data: media.base64.startsWith('data:')
        ? (media.base64.match(/^data:(image\/[\w.+-]+);base64,(.+)$/)?.[2] || media.base64)
        : media.base64,
      mimeType: media.mimeType,
      assetId: media.brandAssetId,
    };
  }
  const inline = parseInlineImage(media.previewUrl, media.mimeType)
    || parseInlineImage(media.thumbnailUrl, media.mimeType);
  if (!inline) return undefined;
  return {
    ...inline,
    assetId: media.brandAssetId,
  };
};

export const buildRouteReferenceAssembly = ({
  route,
  scene,
  currentReference,
  previousReference,
  nextReference,
  previousSceneText,
  nextSceneText,
  productAnchor,
  selectedBindings,
}: BuildRouteReferenceAssemblyParams): RouteReferenceAssemblyResult => {
  const promptText = (
    scene.imagePrompt
    || scene.visualDescription
    || scene.onScreenText
    || scene.voiceoverText
    || ''
  ).trim();
  const currentSceneText = (scene.voiceoverText || scene.onScreenText || '').trim() || undefined;
  const selected = normalizeSceneReferenceBindings(selectedBindings || scene.sceneReferenceBindings, scene);
  const usedAssetIds = new Set<string>();
  const provenance: AssetProvenanceStep[] = [];
  const supportingReferences: NonNullable<ImageGenerationRequest['references']> = [];

  const addProvenance = (assetId: string | undefined, role: AssetProvenanceRole) => {
    if (!assetId || usedAssetIds.has(assetId)) return;
    usedAssetIds.add(assetId);
    provenance.push(toProvenanceStep(assetId, role, route));
  };

  const productAnchorInput = getSceneReferenceInputFromBinding(productAnchor);
  const includeProductAnchor = route === 'upgrade_existing' || route === 'composite_product' || route === 'continue_sequence';

  if (includeProductAnchor && productAnchor?.assetId && productAnchorInput) {
    addProvenance(productAnchor.assetId, 'product');
    if (route === 'composite_product' || route === 'continue_sequence') {
      supportingReferences.push({
        input: productAnchorInput,
        role: 'product',
        preserve: preserveByRole.product,
        modify: roleModifyText('product', route),
      });
    }
  }

  if (route === 'continue_sequence' && previousReference?.assetId) {
    addProvenance(previousReference.assetId, 'previous_scene');
  }

  selected.forEach((binding) => {
    const input = getSceneReferenceInputFromBinding(binding);
    if (!input) return;
    if (binding.assetId === productAnchor?.assetId && binding.role === 'product') return;
    if (binding.assetId === previousReference?.assetId && binding.role === 'previous_scene') return;
    addProvenance(binding.assetId, binding.role);
    supportingReferences.push({
      input,
      role: binding.role,
      preserve: preserveByRole[binding.role],
      modify: roleModifyText(binding.role, route),
    });
  });

  const baseRequest: ImageGenerationRequest = {
    mode: 'generate',
    imagePrompt: promptText,
    visualDescription: scene.visualDescription,
    prevSceneReference: previousReference,
    nextSceneReference: nextReference,
    prevSceneText: previousSceneText,
    currentSceneText,
    nextSceneText,
  };

  if (route === 'use_existing') {
    return {
      request: null,
      sourceAssetIds: dedupeStrings(provenance.map((step) => step.assetId)),
      provenance,
      selectedBindings: selected,
    };
  }

  let request: ImageGenerationRequest;
  switch (route) {
    case 'upgrade_existing':
      request = {
        ...baseRequest,
        mode: 'edit',
        primaryReference: currentReference || productAnchorInput,
        references: supportingReferences.length ? supportingReferences : undefined,
      };
      break;
    case 'composite_product':
      request = {
        ...baseRequest,
        mode: 'composite',
        references: supportingReferences.length ? supportingReferences : undefined,
      };
      break;
    case 'continue_sequence':
      request = previousReference
        ? {
            ...baseRequest,
            mode: 'edit',
            primaryReference: previousReference,
            references: supportingReferences.length ? supportingReferences : undefined,
          }
        : {
            ...baseRequest,
            mode: 'generate',
            references: supportingReferences.length ? supportingReferences : undefined,
          };
      break;
    case 'generate_fresh':
    default:
      request = {
        ...baseRequest,
        mode: 'generate',
        references: supportingReferences.length ? supportingReferences : undefined,
      };
      break;
  }

  return {
    request,
    sourceAssetIds: dedupeStrings(provenance.map((step) => step.assetId)),
    provenance,
    selectedBindings: selected,
  };
};
