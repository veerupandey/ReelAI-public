import React, { useEffect, useMemo, useRef } from 'react';
import type { 
  SceneDraft, 
  UploadedMedia, 
  ReelScript, 
  VoiceOption, 
  MusicAnalysis, 
  CreationMode, 
} from '../../types';
import type { SceneRoute } from '../../types/brand';
import { useScriptStudio } from './ScriptStudioContext';
import SceneList from './SceneList';
import { type SceneRouteActionId } from '../../utils/sceneDrafts';

interface ScriptStudioProps {
  initialScript: ReelScript | null;
  initialSceneDrafts: SceneDraft[];
  initialMedia: UploadedMedia[];
  
  onBack: () => void;
  creationMode: CreationMode;
  hasProductBackedPlan: boolean;
  handleRegeneratePlan: () => void;
  scrollToAddSceneSection: () => void;
  handleSmartAddScene: (dispatch?: any, contextDrafts?: SceneDraft[]) => void;
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
  handleAddSceneToScript: (promptOverride?: string, dispatch?: any, insertAtIndex?: number, contextDrafts?: SceneDraft[]) => void;
  onSyncSceneDrafts?: (drafts: SceneDraft[]) => void;
  audioProgress?: { completed: number; total: number };
  targetDuration?: number;
  
  // Audio & Captions Props
  enableVoiceover: boolean;
  setEnableVoiceover: (val: boolean) => void;
  enableCaptions: boolean;
  setEnableCaptions: (val: boolean) => void;
  selectedVoiceId: string;
  setSelectedVoiceId: (val: string) => void;
  availableVoiceOptions: VoiceOption[];
  voiceDetails: Record<string, any>;
  playingVoicePreview: string | null;
  handleVoicePreview: (voice: VoiceOption, e: React.MouseEvent) => void;
  setShowVoiceRecorder: (val: boolean) => void;
  musicPanelTab: 'generate' | 'upload';
  setMusicPanelTab: (val: 'generate' | 'upload') => void;
  customMusicPrompt: string;
  setCustomMusicPrompt: (val: string) => void;
  handleGenerateMusic: () => void;
  isGeneratingMusic: boolean;
  handleMusicUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isAnalyzingMusic: boolean;
  uploadedMusicAnalysis: MusicAnalysis | null;
  
  // Footer / Next Props
  onNext: (script: ReelScript, drafts: SceneDraft[], media: UploadedMedia[]) => void;
  isGeneratingAudio: boolean;
}

const ScriptStudio: React.FC<ScriptStudioProps> = (props) => {
  const { state, dispatch } = useScriptStudio();
  const { script, sceneDrafts, media, isAddingScene, addScenePrompt } = state;
  const storyboardProducts = useMemo(() => {
    const seen = new Set<string>();
    return sceneDrafts
      .map((draft) => ({
        key: draft.productId || draft.productTitle || draft.productUrl || draft.id,
        productId: draft.productId,
        productTitle: draft.productTitle,
        productUrl: draft.productUrl,
      }))
      .filter((entry) => {
        if (!entry.productTitle && !entry.productId && !entry.productUrl) return false;
        if (seen.has(entry.key)) return false;
        seen.add(entry.key);
        return true;
      });
  }, [sceneDrafts]);
  const storyboardRouteCount = useMemo(
    () => sceneDrafts.filter((draft) => Boolean(draft.storyboardRoute || draft.storyboardRouteOverride || draft.storyboardSourceMode)).length,
    [sceneDrafts],
  );
  const assetAnchoredSceneCount = useMemo(
    () => sceneDrafts.filter((draft) => draft.storyboardBaseAssetId || draft.storyboardLinkedAssetId).length,
    [sceneDrafts],
  );

  const lastSyncedRef = useRef(props.initialSceneDrafts);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (props.initialScript) {
      lastSyncedRef.current = props.initialSceneDrafts;
      dispatch({
        type: 'INIT_STUDIO',
        payload: {
          script: props.initialScript,
          sceneDrafts: props.initialSceneDrafts,
          media: props.initialMedia,
        },
      });
    }
  }, [props.initialScript, props.initialSceneDrafts, props.initialMedia, dispatch]);

  useEffect(() => {
    if (sceneDrafts !== lastSyncedRef.current && sceneDrafts !== props.initialSceneDrafts) {
      lastSyncedRef.current = sceneDrafts;
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = setTimeout(() => {
        props.onSyncSceneDrafts?.(sceneDrafts);
      }, 300);
    }
    return () => clearTimeout(syncTimeoutRef.current);
  }, [sceneDrafts, props.initialSceneDrafts, props.onSyncSceneDrafts]);

  if (!script) return null;

  return (
    <section className="relative py-10 px-4 sm:px-8">
      <div className="absolute inset-0 bg-gradient-to-br from-[#05070F] via-[#0B1121] to-[#11061C]"></div>
      <div className="absolute inset-y-10 inset-x-0 mx-auto max-w-6xl blur-[120px] rounded-full bg-gradient-to-r from-insta-start/10 via-transparent to-insta-purple/20"></div>

      <div className="relative z-10 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[600px]">
        {/* Left Column: Script & Storyboard */}
        <div className="col-span-1 lg:col-span-8 flex flex-col bg-white/5 border border-white/10 rounded-3xl backdrop-blur-xl p-6 shadow-[0_30px_90px_-60px_rgba(0,0,0,1)]">
          <h2 className="text-xl font-bold mb-4 flex justify-between items-center">
            <div className="flex items-center gap-4">
              <button onClick={props.onBack} className="text-white/60 hover:text-white transition">← Back</button>
              Script Studio
              {props.creationMode === 'TEXT_TO_REEL' && !props.hasProductBackedPlan && (
                <button onClick={props.handleRegeneratePlan} className="text-xs font-bold text-insta-purple bg-dark-card px-3 py-1.5 rounded-lg border border-dark-border">
                  ↻ Regenerate
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={props.scrollToAddSceneSection} className="text-xs font-semibold bg-white/10 px-3 py-1.5 rounded-lg hover:bg-white/20 border border-white/10">
                + Scene
              </button>
              <button onClick={() => props.handleSmartAddScene(dispatch, sceneDrafts)} disabled={isAddingScene} className="text-xs font-bold text-insta-purple bg-dark-card px-3 py-1.5 rounded-lg border border-dark-border disabled:opacity-50">
                {isAddingScene ? 'AI...' : '✨ AI Add Scene'}
              </button>
              <span className="text-xs font-normal bg-white/10 px-2 py-1 rounded">{script.segments.length} Scenes</span>
            </div>
          </h2>
          
          {(storyboardProducts.length > 0 || storyboardRouteCount > 0) && (
            <div className="mb-4 rounded-2xl border border-insta-mid/20 bg-gradient-to-r from-insta-start/10 via-white/5 to-insta-purple/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.35em] text-insta-mid/80 mb-2">Approved Storyboard</p>
                  <div className="flex flex-wrap gap-2">
                    {storyboardProducts.map((product) => (
                      <span key={product.key} className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[11px] text-white/80">
                        {product.productTitle || product.productId || 'Assigned Product'}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-white/75">
                    {storyboardProducts.length || 1} product lane{(storyboardProducts.length || 1) === 1 ? '' : 's'}
                  </span>
                  <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-white/75">
                    {storyboardRouteCount} route-locked scene{storyboardRouteCount === 1 ? '' : 's'}
                  </span>
                  <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-white/75">
                    {assetAnchoredSceneCount} asset-backed scene{assetAnchoredSceneCount === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            </div>
          )}

          <SceneList
            script={script}
            sceneDrafts={sceneDrafts}
            media={media}
            reelPlanScenes={props.reelPlanScenes}
            handleExecuteSceneRouteAction={(idx, action, draftsOverride) => props.handleExecuteSceneRouteAction(idx, action, dispatch, draftsOverride)}
            handleSetSceneRouteOverride={(idx, route, draftsOverride) => props.handleSetSceneRouteOverride(idx, route, dispatch, draftsOverride)}
            openSceneReferencePicker={props.openSceneReferencePicker}
            handleSmartRewrite={(idx, ins) => props.handleSmartRewrite(idx, ins, dispatch)}
            handleDeleteScene={props.handleDeleteScene}
            invalidateGeneratedVoicePreview={props.invalidateGeneratedVoicePreview}
            handleSceneImageInput={props.handleSceneImageInput}
            handleSceneImageUpload={props.handleSceneImageUpload}
            sceneImageInputRefs={props.sceneImageInputRefs}
            addScenePanelRef={props.addScenePanelRef}
            addScenePrompt={addScenePrompt}
            setAddScenePrompt={(val) => dispatch({ type: 'SET_ADD_SCENE_PROMPT', payload: val })}
            handleAddSceneToScript={(insertAtIndex?: number) => {
              if (addScenePrompt.trim()) {
                props.handleAddSceneToScript(addScenePrompt, dispatch, insertAtIndex, sceneDrafts);
              }
            }}
            isAddingScene={isAddingScene}
          />
        </div>

        {/* Right Column: Audio & Captions */}
        <div className="col-span-1 lg:col-span-4 bg-black/50 rounded-3xl border border-white/10 p-6 flex flex-col backdrop-blur-xl shadow-[0_30px_80px_-70px_rgba(0,0,0,1)]">
          <h3 className="font-bold mb-4">Audio & Captions</h3>

          {/* Feature Toggles */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <button
              onClick={() => props.setEnableVoiceover(!props.enableVoiceover)}
              className={`p-3 rounded-xl border text-left transition ${props.enableVoiceover ? 'border-emerald-500 bg-emerald-500/10' : 'border-gray-700 bg-black/30'}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold">{props.enableVoiceover ? '🎙️' : '🔇'} Voice</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${props.enableVoiceover ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700 text-gray-400'}`}>
                  {props.enableVoiceover ? 'ON' : 'OFF'}
                </span>
              </div>
              <p className="text-[10px] text-gray-500 mt-1">{props.enableVoiceover ? 'TTS will be generated' : 'Saves TTS costs'}</p>
            </button>
            <button
              onClick={() => props.setEnableCaptions(!props.enableCaptions)}
              className={`p-3 rounded-xl border text-left transition ${props.enableCaptions ? 'border-emerald-500 bg-emerald-500/10' : 'border-gray-700 bg-black/30'}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold">{props.enableCaptions ? '📝' : '🚫'} Captions</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${props.enableCaptions ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700 text-gray-400'}`}>
                  {props.enableCaptions ? 'ON' : 'OFF'}
                </span>
              </div>
              <p className="text-[10px] text-gray-500 mt-1">{props.enableCaptions ? 'Subtitles on video' : 'Clean visuals only'}</p>
            </button>
          </div>

          <div className="space-y-6 flex-1 overflow-y-auto custom-scrollbar pb-20 lg:pb-4">
            {props.enableVoiceover && (
              <div>
                <label className="text-xs font-bold text-gray-500 block mb-2">Voiceover</label>
                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                  {props.availableVoiceOptions.map(voice => (
                    <button 
                      key={voice.id} 
                      onClick={() => props.setSelectedVoiceId(voice.id)} 
                      className={`p-2 rounded border text-xs text-left relative group ${props.selectedVoiceId === voice.id ? 'border-insta-mid bg-insta-mid/10' : 'border-gray-700'}`}
                    >
                      <div className="font-bold pr-5">{voice.label}</div>
                      <div className="text-[10px] opacity-50">{voice.description || `${voice.locale} • ${props.voiceDetails[voice.id]?.gender}`}</div>
                      <div onClick={(e) => props.handleVoicePreview(voice, e)} className="absolute right-2 top-2 p-1 rounded-full hover:bg-white/10">
                        {props.playingVoicePreview === voice.id ? '⏹' : '▶'}
                      </div>
                    </button>
                  ))}
                </div>
                <div className="mt-2 text-center">
                  <span className="text-xs text-gray-500">- OR -</span>
                  <button
                    onClick={() => props.setShowVoiceRecorder(true)}
                    className="w-full mt-2 py-2 bg-red-500/10 text-red-400 border border-red-500/30 rounded-lg text-xs font-bold hover:bg-red-500/20"
                  >
                    🎙️ Record / Upload My Voice
                  </button>
                </div>
              </div>
            )}
            
            <div className="pt-4 border-t border-gray-700">
              <label className="text-xs font-bold text-gray-500 block mb-3">Music</label>
              <div className="flex text-xs mb-4 rounded-xl overflow-hidden border border-gray-700">
                {(['generate', 'upload'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => props.setMusicPanelTab(tab)}
                    className={`flex-1 py-2 font-bold uppercase tracking-wide ${props.musicPanelTab === tab ? 'bg-insta-purple text-white' : 'bg-black/30 text-gray-400'}`}
                  >
                    {tab === 'generate' ? 'Generate' : 'Upload'}
                  </button>
                ))}
              </div>

              {props.musicPanelTab === 'generate' ? (
                <div className="space-y-3">
                  <textarea 
                    className="w-full bg-dark-bg border border-gray-600 p-2 rounded text-xs h-20 resize-none" 
                    value={props.customMusicPrompt} 
                    onChange={e => props.setCustomMusicPrompt(e.target.value)} 
                    placeholder="Describe instruments, tempo, vibe" 
                  />
                  <button 
                    onClick={props.handleGenerateMusic} 
                    disabled={props.isGeneratingMusic} 
                    className="w-full py-2 bg-gray-700 rounded text-xs font-bold hover:bg-gray-600"
                  >
                    {props.isGeneratingMusic ? 'Composing…' : '✨ Generate Track'}
                  </button>
                  <p className="text-[11px] text-gray-500">We'll blend your prompt with the script mood to build a custom loop.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="flex flex-col items-center justify-center gap-2 border border-dashed border-gray-600 rounded-xl p-6 text-sm text-gray-400 cursor-pointer hover:border-insta-purple/60 transition">
                    <span>Drag in your track</span>
                    <span className="text-[11px] text-gray-500">WAV/MP3 up to 60s</span>
                    <input type="file" hidden accept="audio/*" onChange={props.handleMusicUpload} />
                  </label>
                  {props.isAnalyzingMusic && (
                    <div className="text-xs text-gray-400 flex items-center gap-2">
                      <span className="animate-spin inline-block w-3 h-3 border-2 border-white/40 border-t-transparent rounded-full"></span>
                      Analyzing vibe & beats…
                    </div>
                  )}
                  {props.uploadedMusicAnalysis && (
                    <div className="bg-black/30 border border-white/10 rounded-xl p-4 text-xs space-y-2">
                      <div className="flex justify-between text-[11px] uppercase tracking-widest text-white/40">
                        <span>Vibe</span><span>{props.uploadedMusicAnalysis.vibe}</span>
                      </div>
                      <p className="text-white/70">{props.uploadedMusicAnalysis.pacingAdvice}</p>
                      <div className="text-white/50 text-[11px]">
                        Beat cues: {props.uploadedMusicAnalysis.beatMoments.slice(0, 3).map(t => `${Math.round(t)} s`).join(', ')}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="mt-auto pt-6 border-t border-white/10">
            <button
              onClick={() => script && props.onNext(script, sceneDrafts, media)}
              disabled={props.isGeneratingAudio}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-insta-mid via-insta-purple to-insta-blue text-white font-bold text-lg hover:shadow-[0_0_30px_rgba(131,58,180,0.5)] transition flex items-center justify-center gap-3 disabled:opacity-50"
            >
              {props.isGeneratingAudio ? (
                <div className="flex flex-col items-center gap-2 w-full">
                  <div className="flex items-center gap-3">
                    <span className="animate-spin inline-block w-5 h-5 border-2 border-white/40 border-t-white rounded-full"></span>
                    <span>Processing Audio{props.audioProgress && props.audioProgress.total > 0 ? ` (${props.audioProgress.completed}/${props.audioProgress.total})` : ''}...</span>
                  </div>
                  {props.audioProgress && props.audioProgress.total > 0 && (
                    <div className="w-full bg-white/10 rounded-full h-1.5">
                      <div className="bg-insta-purple h-1.5 rounded-full transition-all" style={{ width: `${(props.audioProgress.completed / props.audioProgress.total) * 100}%` }} />
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <span>Finalize & Mix</span>
                  <span className="text-xl">→</span>
                </>
              )}
            </button>
            <p className="text-[10px] text-center text-white/30 mt-3 uppercase tracking-widest">
              {props.targetDuration && props.targetDuration > 0
                ? `${props.targetDuration}s target · ${sceneDrafts.length} scene${sceneDrafts.length === 1 ? '' : 's'} · clean voice sync`
                : `${sceneDrafts.length} scene${sceneDrafts.length === 1 ? '' : 's'} · clean voice sync`}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ScriptStudio;
