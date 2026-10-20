/**
 * Image generation model picker — mirrors PlannerModelControls.
 * Image gen is always Gemini (Flash Image / nano banana); this control picks
 * the model id and persists an optional override (UI → localStorage → env).
 */
import React, { useEffect, useState } from 'react';
import {
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODEL_OPTIONS,
  getImageModelOption,
  getStoredImageModelOverride,
  setStoredImageModelOverride,
} from '../services/llm/imageModel';

type Props = {
  variant?: 'list' | 'chips';
  className?: string;
};

const ImageModelControls: React.FC<Props> = ({
  variant = 'list',
  className = '',
}) => {
  const [selected, setSelected] = useState(
    () => getStoredImageModelOverride() || DEFAULT_IMAGE_MODEL,
  );

  useEffect(() => {
    setSelected(getStoredImageModelOverride() || DEFAULT_IMAGE_MODEL);
  }, []);

  const option = getImageModelOption(selected);
  const [customId, setCustomId] = useState(
    () => IMAGE_MODEL_OPTIONS.some((o) => o.id === selected) ? '' : selected,
  );

  const selectModel = (id: string) => {
    setSelected(id);
    setStoredImageModelOverride(id);
    setCustomId(IMAGE_MODEL_OPTIONS.some((o) => o.id === id) ? '' : id);
  };

  const persistCustom = (next: string) => {
    setCustomId(next);
    const trimmed = next.trim();
    setSelected(trimmed || DEFAULT_IMAGE_MODEL);
    setStoredImageModelOverride(trimmed);
  };

  return (
    <div className={`space-y-2 ${className}`}>
      {variant === 'chips' ? (
        <div className="flex flex-wrap gap-2">
          {IMAGE_MODEL_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => selectModel(o.id)}
              className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
                selected === o.id
                  ? 'bg-white text-slate-950'
                  : 'bg-white/[0.04] text-gray-400 ring-1 ring-white/10 hover:text-white'
              }`}
              title={o.description}
            >
              {o.label}
            </button>
          ))}
          {customId && (
            <span className="rounded-full px-3 py-1.5 text-[11px] font-medium bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40">
              {customId}
            </span>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          {IMAGE_MODEL_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => selectModel(o.id)}
              className={`w-full py-1.5 px-2 rounded-lg text-[11px] text-left transition-all ${
                selected === o.id
                  ? 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-200'
                  : 'bg-dark-bg border border-dark-border text-gray-500 hover:text-white'
              }`}
            >
              <span className="font-medium">{o.label}</span>
              <span className="block text-[10px] text-gray-500">{o.description}</span>
            </button>
          ))}
        </div>
      )}

      <div className="space-y-1.5 rounded-lg border border-dark-border/80 bg-black/20 p-2">
        <label className="block space-y-1">
          <span className="text-[10px] text-gray-500">Image model id (override)</span>
          <input
            type="text"
            autoComplete="off"
            value={customId}
            onChange={(e) => persistCustom(e.target.value)}
            placeholder={option.id}
            className="w-full rounded-lg border border-dark-border bg-dark-bg px-2 py-1.5 text-[11px] text-white placeholder:text-gray-600 focus:border-cyan-500/50 focus:outline-none"
          />
        </label>
        <span className="block text-[9px] text-gray-600">
          Image generation always uses Gemini. Leave blank for {DEFAULT_IMAGE_MODEL} (nano banana). Applied on next generation.
        </span>
      </div>
    </div>
  );
};

export default ImageModelControls;
