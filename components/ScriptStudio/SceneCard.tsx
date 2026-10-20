import React, { useState } from 'react';
import type { SceneDraft, UploadedMedia, TransitionEffect } from '../../types';
import type { SceneRoute } from '../../types/brand';
import { useScriptStudio } from './ScriptStudioContext';
import VisualControls from './controls/VisualControls';
import ScriptControls from './controls/ScriptControls';
import {
  getEffectiveStoryboardRoute,
  getRouteActionSpec,
  getSceneScriptBudget,
  isBrokenRewriteOutput,
  getMediaDisplayUrl,
  type SceneRouteActionId,
} from '../../utils/sceneDrafts';
import { getSceneReferenceRoleLabel, getSceneReferenceSourceLabel, getScriptStudioRouteLabel, getScriptStudioRouteTone, getScriptStudioSourceModeLabel } from './scriptStudioViewUtils';

interface SceneCardProps {
  idx: number;
  seg: string;
  currentDraft: SceneDraft | undefined;
  currentMedia: UploadedMedia | undefined;
  previousMedia: UploadedMedia | undefined;
  reelPlanScenes: any[] | undefined;
  handleExecuteSceneRouteAction: (idx: number, action: SceneRouteActionId, dispatch?: any, draftsOverride?: SceneDraft[]) => void;
  handleSetSceneRouteOverride: (idx: number, route?: SceneRoute, dispatch?: any, draftsOverride?: SceneDraft[]) => void;
  openSceneReferencePicker: (sceneIndex: number, mode: 'base_asset' | 'reference_assets') => void;
  handleSmartRewrite: (idx: number, instruction: string, dispatch?: any) => void;
  handleDeleteScene: (idx: number) => void;
  invalidateGeneratedVoicePreview: () => void;
  handleSceneImageInput: (idx: number, e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSceneImageUpload: (idx: number, file: File) => void;
  sceneImageInputRefs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
}

const SceneCard: React.FC<SceneCardProps> = (props) => {
  const { state, dispatch } = useScriptStudio();
  const currentSceneId = props.currentDraft?.id || `scene-${props.idx}`;
  const [isDragOver, setIsDragOver] = useState(false);
  const visualEditorOpen = state.visualEditorOpen[props.idx] || false;
  const effectiveRoute = getEffectiveStoryboardRoute(props.currentDraft, props.currentMedia);
  const routeActionSpec = getRouteActionSpec(props.currentDraft, props.currentMedia);
  const hasStoryboardContext = Boolean(
    props.currentDraft?.productTitle
    || props.currentDraft?.storyboardRoute
    || props.currentDraft?.storyboardRouteOverride
    || props.currentDraft?.storyboardSourceMode
    || props.currentDraft?.storyboardBaseAssetDescription
    || props.currentDraft?.storyboardLinkedAssetDescription
  );
  const overlaySecondaryAction = routeActionSpec.secondaryActions[0];

  const handleCardRouteAction = (action: SceneRouteActionId) => {
    switch (action) {
      case 'choose_different_asset':
        props.openSceneReferencePicker(props.idx, 'base_asset');
        return;
      case 'choose_base_asset':
        props.openSceneReferencePicker(props.idx, 'base_asset');
        return;
      case 'tune_prompt':
      case 'add_references':
        if (action === 'add_references') {
          props.openSceneReferencePicker(props.idx, 'reference_assets');
          return;
        }
        dispatch({ type: 'SET_VISUAL_EDITOR_OPEN', payload: { index: props.idx, isOpen: true } });
        return;
      default:
        props.handleExecuteSceneRouteAction(props.idx, action, dispatch, state.sceneDrafts);
    }
  };

  const currentScriptText = (() => {
    const draftScript = (props.currentDraft?.voiceoverText || props.currentDraft?.onScreenText || '').trim();
    const promptText = props.currentDraft?.imagePrompt?.trim() || '';
    const plannedScript = props.reelPlanScenes?.[props.idx]?.scriptGuidance?.trim() || '';
    if (draftScript && plannedScript && plannedScript !== draftScript && (
      isBrokenRewriteOutput(draftScript) ||
      (promptText && draftScript === promptText && plannedScript !== promptText)
    )) {
      return plannedScript;
    }
    return draftScript || props.seg;
  })();
  const scriptBudget = props.currentDraft
    ? getSceneScriptBudget({
        voiceoverText: currentScriptText,
        onScreenText: currentScriptText,
        requestedDurationSec: props.currentDraft.requestedDurationSec,
      })
    : undefined;

  return (
    <div className="bg-black/40 p-4 rounded-2xl border border-white/10 flex gap-4 relative group">
      <div
        className={`w-32 h-32 bg-black rounded-lg shrink-0 overflow-hidden relative group/img ${isDragOver ? 'ring-2 ring-insta-purple' : ''}`}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }}
        onDrop={(e) => {
          e.preventDefault(); e.stopPropagation();
          setIsDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file && file.type.startsWith('image/')) {
            props.handleSceneImageUpload(props.idx, file);
          }
        }}
      >
        <img src={getMediaDisplayUrl(props.currentMedia)} className="w-full h-full object-cover opacity-70 group-hover/img:opacity-50 transition-opacity" />
        <div className="absolute top-1 left-1 bg-black/60 px-1.5 rounded text-[10px] font-bold">#{props.idx + 1}</div>

        {/* Image Actions Overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/40 backdrop-blur-[2px]">
          <button
            onClick={(e) => { e.stopPropagation(); handleCardRouteAction(routeActionSpec.primaryAction.id); }}
            className="bg-insta-purple/30 hover:bg-insta-purple/50 text-white text-[9px] px-2 py-1 rounded border border-white/10 flex items-center gap-1"
          >
            <span>{routeActionSpec.primaryAction.label}</span>
          </button>

          {overlaySecondaryAction && (
            <button
              onClick={(e) => { e.stopPropagation(); handleCardRouteAction(overlaySecondaryAction.id); }}
              className="bg-white/10 hover:bg-white/20 text-white text-[9px] px-2 py-1 rounded border border-white/10 flex items-center gap-1"
            >
              <span>{overlaySecondaryAction.label}</span>
            </button>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              props.sceneImageInputRefs.current[currentSceneId]?.click();
            }}
            className="bg-white/10 hover:bg-white/20 text-white text-[9px] px-2 py-1 rounded border border-white/10 flex items-center gap-1"
          >
            Upload Image
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              dispatch({ type: 'SET_VISUAL_EDITOR_OPEN', payload: { index: props.idx, isOpen: true } });
            }}
            className="text-white/50 hover:text-white text-[8px] mt-1 underline"
          >
            Open Visual Tools
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="flex justify-between mb-2">
          <div className="flex gap-2">
            <button 
              onClick={() => dispatch({ type: 'SET_VISUAL_EDITOR_OPEN', payload: { index: props.idx, isOpen: false } })} 
              className={`text-xs px-2 py-1 rounded ${!visualEditorOpen ? 'bg-white text-black' : 'bg-black/30'}`}
            >
              Script
            </button>
            <button 
              onClick={() => dispatch({ type: 'SET_VISUAL_EDITOR_OPEN', payload: { index: props.idx, isOpen: true } })} 
              className={`text-xs px-2 py-1 rounded ${visualEditorOpen ? 'bg-white text-black' : 'bg-black/30'}`}
            >
              Visuals
            </button>
          </div>
          <div className="flex items-center gap-2">
            {!visualEditorOpen && scriptBudget && scriptBudget.status !== 'ok' && (
              <span
                className={`rounded-full border px-2 py-1 text-[10px] font-mono ${
                  scriptBudget.status === 'over'
                    ? 'border-rose-400/30 bg-rose-500/10 text-rose-100'
                    : 'border-amber-400/30 bg-amber-500/10 text-amber-100'
                }`}
                title={`${scriptBudget.wordCount} words; estimated ${scriptBudget.estimatedSec.toFixed(1)} seconds`}
              >
                Target {scriptBudget.slotSec.toFixed(1)}s · {scriptBudget.status === 'over' ? 'over' : 'tight'}
              </span>
            )}
            <button onClick={() => props.handleDeleteScene(props.idx)} className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10" title="Delete Scene">🗑️</button>
            <select
              className="bg-black/30 text-[10px] rounded px-2 border border-gray-700 outline-none"
              value={props.currentMedia?.transitionEffect || 'fade'}
              onChange={e => {
                const transitionEffect = e.target.value as TransitionEffect;
                dispatch({
                  type: 'UPDATE_SCENE_VISUALS',
                  payload: {
                    index: props.idx,
                    updates: {
                      media: {
                        ...(props.currentDraft?.media || props.currentMedia)!,
                        id: props.currentDraft?.id || `scene-${props.idx}`,
                        sceneId: props.currentDraft?.id || `scene-${props.idx}`,
                        transitionEffect,
                      },
                    },
                  },
                });
              }}
            >
              <option value="fade">Fade</option>
              <option value="slide">Slide</option>
              <option value="zoom">Zoom</option>
              <option value="none">None</option>
            </select>
          </div>
        </div>

        {hasStoryboardContext && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {props.currentDraft?.productTitle && (
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-white/80">
                {props.currentDraft.productTitle}
              </span>
            )}
            {(props.currentDraft?.storyboardRoute || props.currentDraft?.storyboardRouteOverride) && (
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${getScriptStudioRouteTone(effectiveRoute)}`}>
                {getScriptStudioRouteLabel(effectiveRoute)}
              </span>
            )}
            {props.currentDraft?.storyboardRouteOverride && props.currentDraft?.storyboardRoute && props.currentDraft.storyboardRouteOverride !== props.currentDraft.storyboardRoute && (
              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] text-amber-100/85">
                Approved: {getScriptStudioRouteLabel(props.currentDraft.storyboardRoute)}
              </span>
            )}
            {props.currentDraft?.storyboardSourceMode && (
              <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] text-white/65">
                {getScriptStudioSourceModeLabel(props.currentDraft.storyboardSourceMode)}
              </span>
            )}
            {props.currentDraft?.storyboardLinkedAssetDescription && (
              <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[10px] text-cyan-100/85">
                {props.currentDraft.storyboardLinkedAssetDescription}
              </span>
            )}
            {!props.currentDraft?.storyboardLinkedAssetDescription && props.currentDraft?.storyboardBaseAssetDescription && (
              <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] text-white/65">
                {props.currentDraft.storyboardBaseAssetDescription}
              </span>
            )}
            {(props.currentDraft?.sceneReferenceBindings || []).slice(0, 2).map((binding) => (
              <span
                key={`${binding.source}:${binding.assetId}:${binding.variantId || ''}:${binding.sourceSceneId || ''}`}
                className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-white/65"
                title={binding.description || binding.label}
              >
                {binding.label} · {getSceneReferenceRoleLabel(binding.role)} · {getSceneReferenceSourceLabel(binding.source)}
              </span>
            ))}
            {(props.currentDraft?.sceneReferenceBindings?.length || 0) > 2 && (
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-white/55">
                +{(props.currentDraft?.sceneReferenceBindings?.length || 0) - 2} more refs
              </span>
            )}
          </div>
        )}

        {visualEditorOpen ? (
          <VisualControls
            index={props.idx}
            currentDraft={props.currentDraft}
            currentMedia={props.currentMedia}
            previousMedia={props.previousMedia}
            handleExecuteSceneRouteAction={(i, action, draftsOverride) => props.handleExecuteSceneRouteAction(i, action, dispatch, draftsOverride)}
            handleSetSceneRouteOverride={(i, route, draftsOverride) => props.handleSetSceneRouteOverride(i, route, dispatch, draftsOverride)}
            openSceneReferencePicker={props.openSceneReferencePicker}
            onUploadImage={() => props.sceneImageInputRefs.current[currentSceneId]?.click()}
          />
        ) : (
          <ScriptControls
            index={props.idx}
            currentScriptText={currentScriptText}
            handleSmartRewrite={(i, ins) => props.handleSmartRewrite(i, ins, dispatch)}
            invalidateGeneratedVoicePreview={props.invalidateGeneratedVoicePreview}
            onUploadImage={() => props.sceneImageInputRefs.current[currentSceneId]?.click()}
          />
        )}

        <input
          ref={(node) => {
            props.sceneImageInputRefs.current[currentSceneId] = node;
          }}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => props.handleSceneImageInput(props.idx, e)}
        />
      </div>
    </div>
  );
};

export default SceneCard;
