import React from 'react';
import { useScriptStudio } from './ScriptStudioContext';

const ViralHook: React.FC = () => {
  const { state, dispatch } = useScriptStudio();
  const hook = state.script?.hook || '';

  return (
    <div className="bg-gradient-to-r from-insta-start/20 to-insta-purple/20 p-4 rounded-xl border border-insta-mid/30">
      <label className="text-[10px] uppercase font-bold text-insta-mid mb-1 block">Viral Hook</label>
      <textarea
        className="w-full bg-transparent text-xl font-bold italic outline-none resize-none"
        value={hook}
        onChange={e => dispatch({ type: 'UPDATE_SCRIPT_HOOK', payload: e.target.value })}
      />
    </div>
  );
};

export default ViralHook;
