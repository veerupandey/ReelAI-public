import React from 'react';
import type { SceneDraft, UploadedMedia, ReelScript } from '../../types';
import type { SceneRoute } from '../../types/brand';
import SceneCard from './SceneCard';
import ViralHook from './ViralHook';
import { useScriptStudio } from './ScriptStudioContext';
import type { SceneRouteActionId } from '../../utils/sceneDrafts';

interface SceneListProps {
  script: ReelScript;
  sceneDrafts: SceneDraft[];
  media: UploadedMedia[];
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
  addScenePanelRef: React.RefObject<HTMLDivElement | null>;
  addScenePrompt: string;
  setAddScenePrompt: (val: string) => void;
  handleAddSceneToScript: (insertAtIndex?: number) => void;
  isAddingScene: boolean;
}

const SceneList: React.FC<SceneListProps> = (props) => {
  const { dispatch } = useScriptStudio();
  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 pr-2 pb-20">
      <ViralHook />
      {props.script.segments.length === 0 && (
        <div className="text-center py-12 text-white/30">
          <p className="text-sm">No scenes yet</p>
          <p className="text-xs mt-1">Use "+ Scene" or "AI Add Scene" above to get started</p>
        </div>
      )}
      {props.script.segments.map((seg, idx) => {
        const currentDraft = props.sceneDrafts[idx];
        const currentMedia = currentDraft?.media;
        const previousMedia = idx > 0 ? props.sceneDrafts[idx - 1]?.media : undefined;

        return (
          <React.Fragment key={currentDraft?.id || idx}>
            <SceneCard
              idx={idx}
              seg={seg}
              currentDraft={currentDraft}
              currentMedia={currentMedia}
              previousMedia={previousMedia}
              reelPlanScenes={props.reelPlanScenes}
              handleExecuteSceneRouteAction={(i, action, draftsOverride) => props.handleExecuteSceneRouteAction(i, action, dispatch, draftsOverride)}
              handleSetSceneRouteOverride={(i, route, draftsOverride) => props.handleSetSceneRouteOverride(i, route, dispatch, draftsOverride)}
              openSceneReferencePicker={props.openSceneReferencePicker}
              handleSmartRewrite={(i, ins) => props.handleSmartRewrite(i, ins, dispatch)}
              handleDeleteScene={props.handleDeleteScene}
              invalidateGeneratedVoicePreview={props.invalidateGeneratedVoicePreview}
              handleSceneImageInput={props.handleSceneImageInput}
              handleSceneImageUpload={props.handleSceneImageUpload}
              sceneImageInputRefs={props.sceneImageInputRefs}
            />
            {idx < props.script.segments.length - 1 && (
              <button
                onClick={() => props.handleAddSceneToScript(idx + 1)}
                disabled={props.isAddingScene || !props.addScenePrompt.trim()}
                className="w-full py-1.5 flex items-center gap-2 opacity-0 hover:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-30"
                title={props.addScenePrompt.trim()
                  ? `Insert scene between #${idx + 1} and #${idx + 2}`
                  : 'Type a scene description below first'}
              >
                <div className="flex-1 border-t border-dashed border-white/20" />
                <span className="text-[10px] text-white/40 whitespace-nowrap">+ Insert Scene</span>
                <div className="flex-1 border-t border-dashed border-white/20" />
              </button>
            )}
          </React.Fragment>
        );
      })}

      {/* Add Scene Section */}
      <div ref={props.addScenePanelRef} className="bg-black/40 p-4 rounded-2xl border border-white/10 space-y-3 mt-4">
        <p className="text-[10px] uppercase font-bold text-white/40">Add New Scene</p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Describe scene to add..."
            className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-2 text-sm outline-none focus:border-insta-mid"
            value={props.addScenePrompt}
            onChange={e => props.setAddScenePrompt(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !props.isAddingScene && props.addScenePrompt.trim() && props.handleAddSceneToScript()}
          />
          <button
            onClick={() => props.handleAddSceneToScript()}
            disabled={props.isAddingScene || !props.addScenePrompt.trim()}
            className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-semibold disabled:opacity-50"
          >
            {props.isAddingScene ? 'Adding...' : 'Add +'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SceneList;
