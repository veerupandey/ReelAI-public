import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import type { SceneDraft, ReelScript, UploadedMedia, TransitionEffect } from '../../types';
import { applySceneTextEdit, deriveScriptFromSceneDrafts } from '../../utils/sceneDrafts';

interface ScriptStudioState {
  script: ReelScript | null;
  sceneDrafts: SceneDraft[];
  media: UploadedMedia[];
  visualEditorOpen: Record<number, boolean>;
  isAddingScene: boolean;
  addScenePrompt: string;
  regeneratingImageIndex: number | null;
  rewritingIndex: number | null;
}

type Action =
  | { type: 'INIT_STUDIO'; payload: { script: ReelScript; sceneDrafts: SceneDraft[]; media: UploadedMedia[] } }
  | { type: 'SET_VISUAL_EDITOR_OPEN'; payload: { index: number; isOpen: boolean } }
  | { type: 'SET_SCENE_DRAFTS'; payload: SceneDraft[] }
  | { type: 'UPDATE_SCENE_TEXT'; payload: { index: number; text: string; mode: 'voiceoverText' | 'onScreenText' | 'both' } }
  | { type: 'UPDATE_SCENE_VISUALS'; payload: { index: number; updates: Partial<SceneDraft> } }
  | { type: 'SET_ADD_SCENE_PROMPT'; payload: string }
  | { type: 'SET_IS_ADDING_SCENE'; payload: boolean }
  | { type: 'SET_REGENERATING_IMAGE_INDEX'; payload: number | null }
  | { type: 'SET_REWRITING_INDEX'; payload: number | null }
  | { type: 'UPDATE_SCRIPT_HOOK'; payload: string }
  | { type: 'DELETE_SCENE'; payload: number };

const initialState: ScriptStudioState = {
  script: null,
  sceneDrafts: [],
  media: [],
  visualEditorOpen: {},
  isAddingScene: false,
  addScenePrompt: '',
  regeneratingImageIndex: null,
  rewritingIndex: null,
};

function scriptStudioReducer(state: ScriptStudioState, action: Action): ScriptStudioState {
  switch (action.type) {
    case 'INIT_STUDIO':
      return {
        ...state,
        script: action.payload.script,
        sceneDrafts: action.payload.sceneDrafts,
        media: action.payload.media,
      };
    case 'SET_VISUAL_EDITOR_OPEN':
      return {
        ...state,
        visualEditorOpen: { ...state.visualEditorOpen, [action.payload.index]: action.payload.isOpen },
      };
    case 'SET_SCENE_DRAFTS':
      return {
        ...state,
        sceneDrafts: action.payload,
        script: state.script ? deriveScriptFromSceneDrafts(state.script, action.payload) : state.script,
      };
    case 'UPDATE_SCENE_TEXT':
      return {
        ...state,
        sceneDrafts: state.sceneDrafts.map((draft, idx) =>
          idx === action.payload.index ? applySceneTextEdit(draft, action.payload.text, action.payload.mode) : draft
        ),
      };
    case 'UPDATE_SCENE_VISUALS':
      return {
        ...state,
        sceneDrafts: state.sceneDrafts.map((draft, idx) =>
          idx === action.payload.index ? { ...draft, ...action.payload.updates } : draft
        ),
      };
    case 'SET_ADD_SCENE_PROMPT':
      return { ...state, addScenePrompt: action.payload };
    case 'SET_IS_ADDING_SCENE':
      return { ...state, isAddingScene: action.payload };
    case 'SET_REGENERATING_IMAGE_INDEX':
      return { ...state, regeneratingImageIndex: action.payload };
    case 'SET_REWRITING_INDEX':
      return { ...state, rewritingIndex: action.payload };
    case 'UPDATE_SCRIPT_HOOK':
      return {
        ...state,
        script: state.script ? { ...state.script, hook: action.payload } : null,
      };
    case 'DELETE_SCENE':
      const newDrafts = [...state.sceneDrafts];
      newDrafts.splice(action.payload, 1);
      
      const newMedia = [...state.media];
      newMedia.splice(action.payload, 1);

      const newScript = state.script ? { ...state.script, segments: state.script.segments.filter((_, i) => i !== action.payload) } : null;

      // Adjust visualEditorOpen mapping
      const newVisualEditorOpen: Record<number, boolean> = {};
      Object.keys(state.visualEditorOpen).forEach(key => {
        const k = Number(key);
        if (k < action.payload) newVisualEditorOpen[k] = state.visualEditorOpen[k];
        if (k > action.payload) newVisualEditorOpen[k - 1] = state.visualEditorOpen[k];
      });

      return {
        ...state,
        sceneDrafts: newDrafts,
        media: newMedia,
        script: newScript,
        visualEditorOpen: newVisualEditorOpen,
        rewritingIndex: null,
        regeneratingImageIndex: null,
      };
    default:
      return state;
  }
}

const ScriptStudioContext = createContext<{
  state: ScriptStudioState;
  dispatch: React.Dispatch<Action>;
} | undefined>(undefined);

export const ScriptStudioProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(scriptStudioReducer, initialState);
  return <ScriptStudioContext.Provider value={{ state, dispatch }}>{children}</ScriptStudioContext.Provider>;
};

export const useScriptStudio = () => {
  const context = useContext(ScriptStudioContext);
  if (!context) throw new Error('useScriptStudio must be used within ScriptStudioProvider');
  return context;
};
