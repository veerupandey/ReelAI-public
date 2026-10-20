/**
 * Shared planner / main-agent model picker.
 * OpenAI-compatible (GLM / SiliconFlow / OpenAI / Codex) + Gemini.
 */
import React, { useEffect, useState } from 'react';
import {
  PLANNER_MODEL_OPTIONS,
  getPlannerModelOption,
} from '../services/llm/catalog';
import {
  getStoredBaseUrl,
  getStoredModelOverride,
  getStoredProviderApiKey,
  setStoredBaseUrl,
  setStoredModelOverride,
  setStoredPreferredPlannerModel,
  setStoredProviderApiKey,
} from '../services/llm/apiKeys';
import {
  DEFAULT_PLANNER_MODEL,
  type PlannerModelId,
  coercePlannerModelId,
} from '../services/llm/types';

type Props = {
  value?: PlannerModelId;
  onChange: (id: PlannerModelId) => void;
  variant?: 'list' | 'chips';
  className?: string;
};

const PlannerModelControls: React.FC<Props> = ({
  value,
  onChange,
  variant = 'list',
  className = '',
}) => {
  const selected = coercePlannerModelId(value, DEFAULT_PLANNER_MODEL);
  const option = getPlannerModelOption(selected);
  const [apiKey, setApiKey] = useState(() => getStoredProviderApiKey(option.keySlot));
  const [baseUrl, setBaseUrl] = useState(
    () => getStoredBaseUrl(selected) || option.defaultBaseUrl || '',
  );
  const [modelId, setModelId] = useState(
    () => getStoredModelOverride(selected) || option.modelId,
  );

  useEffect(() => {
    const next = getPlannerModelOption(selected);
    setApiKey(getStoredProviderApiKey(next.keySlot));
    setBaseUrl(getStoredBaseUrl(selected) || next.defaultBaseUrl || '');
    setModelId(getStoredModelOverride(selected) || next.modelId);
  }, [selected]);

  const selectModel = (id: PlannerModelId) => {
    setStoredPreferredPlannerModel(id);
    onChange(id);
  };

  const persistKey = (next: string) => {
    setApiKey(next);
    setStoredProviderApiKey(option.keySlot, next);
  };

  const persistBase = (next: string) => {
    setBaseUrl(next);
    setStoredBaseUrl(selected, next);
  };

  const persistModel = (next: string) => {
    setModelId(next);
    setStoredModelOverride(selected, next === option.modelId ? '' : next);
  };

  return (
    <div className={`space-y-2 ${className}`}>
      {variant === 'chips' ? (
        <div className="flex flex-wrap gap-2">
          {PLANNER_MODEL_OPTIONS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => selectModel(p.id)}
              className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
                selected === p.id
                  ? 'bg-white text-slate-950'
                  : 'bg-white/[0.04] text-gray-400 ring-1 ring-white/10 hover:text-white'
              }`}
              title={p.description}
            >
              {p.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {PLANNER_MODEL_OPTIONS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => selectModel(p.id)}
              className={`w-full py-1.5 px-2 rounded-lg text-[11px] text-left transition-all ${
                selected === p.id
                  ? 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-200'
                  : 'bg-dark-bg border border-dark-border text-gray-500 hover:text-white'
              }`}
            >
              <span className="font-medium">{p.label}</span>
              <span className="block text-[10px] text-gray-500">{p.description}</span>
            </button>
          ))}
        </div>
      )}

      {option.needsApiKey && (
        <div className="space-y-1.5 rounded-lg border border-dark-border/80 bg-black/20 p-2">
          <label className="block space-y-1">
            <span className="text-[10px] text-gray-500">{option.label} API key</span>
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => persistKey(e.target.value)}
              placeholder={option.apiKeyHint || 'Paste API key'}
              className="w-full rounded-lg border border-dark-border bg-dark-bg px-2 py-1.5 text-[11px] text-white placeholder:text-gray-600 focus:border-cyan-500/50 focus:outline-none"
            />
          </label>

          {option.transport === 'openai_compatible' && (
            <>
              <label className="block space-y-1">
                <span className="text-[10px] text-gray-500">Base URL (OpenAI-compatible)</span>
                <input
                  type="url"
                  autoComplete="off"
                  value={baseUrl}
                  onChange={(e) => persistBase(e.target.value)}
                  placeholder={option.defaultBaseUrl}
                  className="w-full rounded-lg border border-dark-border bg-dark-bg px-2 py-1.5 text-[11px] text-white placeholder:text-gray-600 focus:border-cyan-500/50 focus:outline-none"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] text-gray-500">Model id</span>
                <input
                  type="text"
                  autoComplete="off"
                  value={modelId}
                  onChange={(e) => persistModel(e.target.value)}
                  placeholder={option.modelId}
                  className="w-full rounded-lg border border-dark-border bg-dark-bg px-2 py-1.5 text-[11px] text-white placeholder:text-gray-600 focus:border-cyan-500/50 focus:outline-none"
                />
              </label>
            </>
          )}

          <span className="block text-[9px] text-gray-600">
            {option.transport === 'openai_compatible'
              ? 'Uses OpenAI-compatible /chat/completions. Fallback is always Gemini. Images stay on Gemini Flash Image.'
              : 'Fallback target / direct Gemini. Images stay on Gemini Flash Image.'}
          </span>
        </div>
      )}
    </div>
  );
};

export default PlannerModelControls;
