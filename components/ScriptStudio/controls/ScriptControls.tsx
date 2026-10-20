import React from 'react';
import { useScriptStudio } from '../ScriptStudioContext';

interface ScriptControlsProps {
  index: number;
  currentScriptText: string;
  handleSmartRewrite: (idx: number, instruction: string) => void;
  invalidateGeneratedVoicePreview: () => void;
  onUploadImage: () => void;
}

const ScriptControls: React.FC<ScriptControlsProps> = ({
  index,
  currentScriptText,
  handleSmartRewrite,
  invalidateGeneratedVoicePreview,
  onUploadImage,
}) => {
  const { state, dispatch } = useScriptStudio();
  const rewritingIndex = state.rewritingIndex;

  return (
    <div className="flex-1 flex flex-col">
      <textarea
        className="flex-1 bg-transparent resize-none outline-none text-sm leading-relaxed"
        value={currentScriptText}
        onChange={e => {
          invalidateGeneratedVoicePreview();
          dispatch({
            type: 'UPDATE_SCENE_TEXT',
            payload: { index, text: e.target.value, mode: 'both' }
          });
        }}
      />
      <div className="flex gap-2 mt-2 border-t border-white/5 pt-2">
        <button
          onClick={() => handleSmartRewrite(index, 'Refine')}
          disabled={rewritingIndex === index}
          className="text-[10px] bg-white/10 px-2 py-1 rounded hover:bg-white/20 disabled:opacity-50"
        >
          {rewritingIndex === index ? '...' : '✨ Refine'}
        </button>
        <button
          onClick={() => handleSmartRewrite(index, 'Shorten')}
          disabled={rewritingIndex === index}
          className="text-[10px] bg-white/10 px-2 py-1 rounded hover:bg-white/20 disabled:opacity-50"
        >
          {rewritingIndex === index ? '...' : '✂️ Shorten'}
        </button>
        <button
          onClick={() => handleSmartRewrite(index, 'Viralize')}
          disabled={rewritingIndex === index}
          className="text-[10px] bg-white/10 px-2 py-1 rounded hover:bg-white/20 disabled:opacity-50"
        >
          {rewritingIndex === index ? '...' : '🔥 Viralize'}
        </button>
        <button
          onClick={onUploadImage}
          className="text-[10px] bg-white/10 px-2 py-1 rounded hover:bg-white/20 ml-auto"
        >
          📷 Upload Image
        </button>
      </div>
    </div>
  );
};

export default ScriptControls;
