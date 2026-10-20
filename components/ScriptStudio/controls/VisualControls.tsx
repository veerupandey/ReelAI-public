import React, { useState } from 'react';
import type { SceneDraft, UploadedMedia } from '../../../types';
import type { SceneRoute } from '../../../types/brand';
import { useScriptStudio } from '../ScriptStudioContext';
import { 
  getEffectiveStoryboardRoute,
  getRouteActionSpec,
  getSceneVisualPrompt, 
  hasInlineImageReference, 
  promoteSceneImageVariant,
  getMediaDisplayUrl,
  type SceneRouteActionId,
} from '../../../utils/sceneDrafts';
import {
  getSceneReferenceRoleLabel,
  getSceneReferenceSourceLabel,
  getScriptStudioRouteLabel,
  getScriptStudioRouteTone,
  getScriptStudioSourceModeLabel,
  getScriptStudioVisualTaskLabel,
} from '../scriptStudioViewUtils';

interface VisualControlsProps {
  index: number;
  currentDraft: SceneDraft | undefined;
  currentMedia: UploadedMedia | undefined;
  previousMedia: UploadedMedia | undefined;
  handleExecuteSceneRouteAction: (idx: number, action: SceneRouteActionId, draftsOverride?: SceneDraft[]) => void;
  handleSetSceneRouteOverride: (idx: number, route?: SceneRoute, draftsOverride?: SceneDraft[]) => void;
  openSceneReferencePicker: (sceneIndex: number, mode: 'base_asset' | 'reference_assets') => void;
  onUploadImage: () => void;
}

const VisualControls: React.FC<VisualControlsProps> = ({
  index,
  currentDraft,
  currentMedia,
  previousMedia,
  handleExecuteSceneRouteAction,
  handleSetSceneRouteOverride,
  openSceneReferencePicker,
  onUploadImage,
}) => {
  const { state, dispatch } = useScriptStudio();
  const currentImagePrompt = getSceneVisualPrompt(currentDraft, currentMedia);
  const currentVariants = currentDraft?.imageVariants || [];
  const sceneText = currentDraft?.voiceoverText || currentDraft?.onScreenText || '';
  const hasPrev = index > 0 && hasInlineImageReference(previousMedia);
  const effectiveRoute = getEffectiveStoryboardRoute(currentDraft, currentMedia);
  const routeActionSpec = getRouteActionSpec(currentDraft, currentMedia);
  const isRegenerating = state.regeneratingIndices
    ? state.regeneratingIndices.has(index)
    : (state as any).regeneratingImageIndex === index;
  const [routeWarning, setRouteWarning] = useState('');
  const promptAreaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const hasStoryboardGuidance = Boolean(
    currentDraft?.productTitle
    || currentDraft?.storyboardRoute
    || currentDraft?.storyboardRouteOverride
    || currentDraft?.storyboardVisualTask
    || currentDraft?.storyboardSourceMode
    || currentDraft?.storyboardBaseAssetDescription
    || currentDraft?.storyboardLinkedAssetDescription
    || currentDraft?.storyboardRouteReason
    || currentDraft?.storyboardVisualTaskReason
    || currentDraft?.storyboardDirectorsNote
  );
  const selectedReferenceBindings = currentDraft?.sceneReferenceBindings || [];

  const buildSceneAwarePrompt = (): string => {
    const parts: string[] = [];
    if (currentImagePrompt) parts.push(currentImagePrompt);
    if (sceneText && !currentImagePrompt) {
      parts.push(`Visual for scene narration: "${sceneText.slice(0, 200)}"`);
    }
    const prevDraft = state.sceneDrafts[index - 1];
    const nextDraft = state.sceneDrafts[index + 1];
    if (prevDraft?.voiceoverText || prevDraft?.onScreenText) {
      parts.push(`Previous scene context: "${(prevDraft.voiceoverText || prevDraft.onScreenText || '').slice(0, 100)}"`);
    }
    if (nextDraft?.voiceoverText || nextDraft?.onScreenText) {
      parts.push(`Next scene context: "${(nextDraft.voiceoverText || nextDraft.onScreenText || '').slice(0, 100)}"`);
    }
    return parts.join('. ');
  };

  const handleAutoGeneratePrompt = () => {
    const autoPrompt = buildSceneAwarePrompt();
    if (autoPrompt) {
      dispatch({
        type: 'UPDATE_SCENE_VISUALS',
        payload: {
          index,
          updates: {
            imagePrompt: autoPrompt,
            generationStatus: {
              ...currentDraft?.generationStatus,
              image: 'stale',
              script: currentDraft?.generationStatus?.script || 'stale',
              voice: currentDraft?.generationStatus?.voice || 'stale',
            },
          },
        },
      });
    }
  };

  const handleRouteAction = (action: SceneRouteActionId) => {
    setRouteWarning('');
    switch (action) {
      case 'tune_prompt':
        promptAreaRef.current?.focus();
        return;
      case 'add_references':
        openSceneReferencePicker(index, 'reference_assets');
        return;
      case 'choose_different_asset':
      case 'choose_base_asset':
        openSceneReferencePicker(index, 'base_asset');
        return;
      case 'use_previous_shot':
      case 'use_prior_scene_context':
        if (!hasPrev) {
          setRouteWarning('No previous scene image is available yet. This action will fall back to a fresh generation.');
        }
        handleExecuteSceneRouteAction(index, action, state.sceneDrafts);
        return;
      default:
        handleExecuteSceneRouteAction(index, action, state.sceneDrafts);
    }
  };

  const handleRouteSelection = (nextRoute: SceneRoute) => {
    if (currentDraft?.storyboardRoute === nextRoute && currentDraft?.storyboardRouteOverride === undefined) {
      return;
    }
    handleSetSceneRouteOverride(index, nextRoute, state.sceneDrafts);
  };

  return (
    <div className="flex-1 flex flex-col">
      {sceneText && (
        <div className="text-[10px] text-white/40 mb-1.5 px-1 italic truncate" title={sceneText}>
          Scene: "{sceneText.slice(0, 80)}{sceneText.length > 80 ? '...' : ''}"
        </div>
      )}

      {hasStoryboardGuidance && (
        <div className="mb-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
          <div className="mb-2 flex flex-wrap gap-2">
            {currentDraft?.productTitle && (
              <span className="rounded-full border border-white/10 bg-black/30 px-2 py-1 text-[10px] font-semibold text-white/80">
                {currentDraft.productTitle}
              </span>
            )}
            {(currentDraft?.storyboardRoute || currentDraft?.storyboardRouteOverride) && (
              <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${getScriptStudioRouteTone(effectiveRoute)}`}>
                {getScriptStudioRouteLabel(effectiveRoute)}
              </span>
            )}
            {currentDraft?.storyboardRouteOverride && currentDraft?.storyboardRoute && currentDraft.storyboardRouteOverride !== currentDraft.storyboardRoute && (
              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-100/85">
                Approved: {getScriptStudioRouteLabel(currentDraft.storyboardRoute)}
              </span>
            )}
            {currentDraft?.storyboardVisualTask && (
              <span className="rounded-full border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-white/70">
                {getScriptStudioVisualTaskLabel(currentDraft.storyboardVisualTask)}
              </span>
            )}
            {currentDraft?.storyboardSourceMode && (
              <span className="rounded-full border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-white/70">
                {getScriptStudioSourceModeLabel(currentDraft.storyboardSourceMode)}
              </span>
            )}
          </div>
          {currentDraft?.storyboardBaseAssetDescription && (
            <p className="text-[10px] text-white/60">
              Base asset: <span className="text-white/78">{currentDraft.storyboardBaseAssetDescription}</span>
            </p>
          )}
          {currentDraft?.storyboardLinkedAssetDescription && currentDraft.storyboardLinkedAssetDescription !== currentDraft.storyboardBaseAssetDescription && (
            <p className="mt-1 text-[10px] text-white/60">
              Selected variant: <span className="text-white/78">{currentDraft.storyboardLinkedAssetDescription}</span>
            </p>
          )}
          {currentDraft?.storyboardVisualTaskReason && (
            <p className="mt-1 text-[10px] text-white/60">
              Visual brief: <span className="text-white/78">{currentDraft.storyboardVisualTaskReason}</span>
            </p>
          )}
          {currentDraft?.storyboardRouteReason && currentDraft.storyboardRouteReason !== currentDraft.storyboardVisualTaskReason && (
            <p className="mt-1 text-[10px] text-white/55">
              Route note: <span className="text-white/72">{currentDraft.storyboardRouteReason}</span>
            </p>
          )}
          {currentDraft?.storyboardDirectorsNote && (
            <p className="mt-1 text-[10px] text-amber-200/80">
              Director note: {currentDraft.storyboardDirectorsNote}
            </p>
          )}
        </div>
      )}

      <div className="mb-3 rounded-xl border border-white/10 bg-black/20 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-white/45">Route</p>
            <p className="mt-1 text-xs text-white/75">{routeActionSpec.guidance}</p>
          </div>
          {routeActionSpec.warning && (
            <span className="max-w-[220px] rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-100/85">
              {routeActionSpec.warning}
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {(['use_existing', 'upgrade_existing', 'composite_product', 'generate_fresh', 'continue_sequence'] as SceneRoute[]).map((route) => {
            const isActive = effectiveRoute === route;
            return (
              <button
                key={route}
                type="button"
                onClick={() => handleRouteSelection(route)}
                className={`rounded-full border px-3 py-1 text-[10px] font-semibold transition ${isActive ? getScriptStudioRouteTone(route) : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'}`}
              >
                {getScriptStudioRouteLabel(route)}
              </button>
            );
          })}
          {currentDraft?.storyboardRouteOverride && (
            <button
              type="button"
              onClick={() => handleSetSceneRouteOverride(index, undefined, state.sceneDrafts)}
              className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10px] text-white/65 hover:bg-white/10"
            >
              Reset to Approved
            </button>
          )}
        </div>

        {(routeWarning || routeActionSpec.warning) && (
          <p className="mt-3 text-[10px] text-amber-100/85">
            {routeWarning || routeActionSpec.warning}
          </p>
        )}

        {selectedReferenceBindings.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedReferenceBindings.map((binding) => (
              <span
                key={`${binding.source}:${binding.assetId}:${binding.variantId || ''}:${binding.sourceSceneId || ''}`}
                className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-white/70"
                title={binding.description || binding.label}
              >
                {binding.label} · {getSceneReferenceRoleLabel(binding.role)} · {getSceneReferenceSourceLabel(binding.source)}
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleRouteAction(routeActionSpec.primaryAction.id)}
            disabled={isRegenerating}
            className="text-xs bg-insta-purple/20 px-3 py-1 rounded hover:bg-insta-purple/30 disabled:opacity-40"
          >
            {isRegenerating ? 'AI...' : routeActionSpec.primaryAction.label}
          </button>
          {routeActionSpec.secondaryActions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => handleRouteAction(action.id)}
              disabled={isRegenerating && action.id !== 'tune_prompt' && action.id !== 'add_references'}
              className="text-xs bg-white/10 px-3 py-1 rounded hover:bg-white/20 disabled:opacity-40"
            >
              {action.label}
            </button>
          ))}
          <button
            type="button"
            onClick={onUploadImage}
            className="text-xs bg-white/10 px-3 py-1 rounded hover:bg-white/20"
          >
            Upload Image
          </button>
        </div>
      </div>

      <div className="relative mb-2">
        <textarea
          ref={promptAreaRef}
          className="w-full bg-black/40 border border-white/10 p-2 rounded text-xs font-mono resize-none outline-none"
          rows={3}
          value={currentImagePrompt}
          placeholder="Describe how AI should frame or change this shot..."
          onChange={e => {
            const imagePrompt = e.target.value;
            dispatch({
              type: 'UPDATE_SCENE_VISUALS',
              payload: {
                index,
                updates: {
                  imagePrompt,
                  generationStatus: {
                    ...currentDraft?.generationStatus,
                    image: 'stale',
                    script: currentDraft?.generationStatus?.script || 'stale',
                    voice: currentDraft?.generationStatus?.voice || 'stale',
                  },
                },
              },
            });
          }}
        />
        {!currentImagePrompt && sceneText && (
          <button
            type="button"
            onClick={handleAutoGeneratePrompt}
            className="absolute bottom-2 right-2 text-[9px] bg-insta-purple/30 hover:bg-insta-purple/50 text-white/80 px-2 py-0.5 rounded transition"
            title="Auto-generate a visual prompt from scene text and context"
          >
            Auto-fill from scene
          </button>
        )}
      </div>
      
      {currentVariants.length > 0 && (
        <div className="mb-2">
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/40 mb-2">Scene Variants</div>
          <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
            {currentVariants.map((variant) => {
              const isActive = variant.id === currentDraft?.activeVariantId;
              const previewSrc = getMediaDisplayUrl(variant.media);
              return (
                <button
                  key={variant.id}
                  type="button"
                  onClick={() => {
                    if (currentDraft) {
                      const updatedDraft = promoteSceneImageVariant(currentDraft, variant.id);
                      dispatch({
                        type: 'UPDATE_SCENE_VISUALS',
                        payload: { index, updates: updatedDraft }
                      });
                    }
                  }}
                  className={`shrink-0 w-20 rounded-lg border p-1 text-left ${isActive ? 'border-insta-purple bg-insta-purple/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                  title={`Use ${variant.label}`}
                >
                  <div className="w-full h-16 rounded overflow-hidden bg-black/40 mb-1">
                    {previewSrc ? (
                      <img src={previewSrc} alt={variant.label} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[9px] text-white/30">No preview</div>
                    )}
                  </div>
                  <div className="text-[10px] font-semibold truncate">{variant.label}</div>
                  <div className="text-[9px] text-white/45 uppercase truncate">{variant.imageSource.replace('_', ' ')}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default VisualControls;
