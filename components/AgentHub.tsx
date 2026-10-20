/**
 * AgentHub — public entry for autonomous ad production.
 *
 * Path: intent / form → launch ad-agent → AgentConsole → AutonomousAgent
 * Ad Creator UI is Prompt Writer–inspired (AdCreatorStudio).
 */

import React, { useState, useEffect, useRef } from 'react';
import { getAgentsWithAvailability, type AgentAvailability } from '../runtime/agentRegistry';
import { routeIntent, mergeExtractedParams } from '../runtime/intentRouter';
import { resolvePromptUrlRoles } from '../services/promptUrlRoles';
import type { AgentDefinition } from '../runtime/agentDefinitions';
import AdCreatorStudio from './AdCreatorStudio';
import type { AdAgentResearchSeed } from './AdAgentResearchPanel';
import type { CreativeReferenceUpload } from '../services/creativeReferenceDirector';
import { buildAdCreatorLaunchParams } from '../services/adCreatorLaunch';

type AgentLaunchParams = Record<string, unknown>;

interface Props {
  onBack: () => void;
  onLaunchAgent: (agentId: string, params: AgentLaunchParams) => void;
}

export const getCompatiblePlatform = (format: string, platform: string): string => {
  if (format === 'carousel') return 'instagram_carousel';
  if (format === 'static_image') return 'instagram_feed';
  if (platform === 'instagram_feed' || platform === 'instagram_carousel') return 'instagram_reels';
  return platform;
};

export const getVisibleAdAgentFieldIds = (format: string): string[] => {
  const common = ['productUrl', 'adFormat', 'platform', 'style', 'reviewMode'];
  if (format === 'static_image' || format === 'carousel') return common;
  if (format === 'veo3_video') {
    return [...common.slice(0, 3), 'durationSec', 'style', 'vibe', 'voice', 'reviewMode', 'plannerModel'];
  }
  return [...common.slice(0, 3), 'durationSec', 'preferLiveMotion', 'liveMotionModelId', 'style', 'vibe', 'voice', 'reviewMode', 'plannerModel'];
};

const AgentHub: React.FC<Props> = ({ onBack, onLaunchAgent }) => {
  const [agents, setAgents] = useState<AgentAvailability[]>([]);
  const [loading, setLoading] = useState(true);

  const [intentInput, setIntentInput] = useState('');
  const [routing, setRouting] = useState(false);
  const [routeReason, setRouteReason] = useState<string | null>(null);
  const [routeMessage, setRouteMessage] = useState<{ text: string; type: 'info' | 'warn' } | null>(null);

  const [selectedAgent, setSelectedAgent] = useState<AgentDefinition | null>(null);
  const [selectedAvailability, setSelectedAvailability] = useState<AgentAvailability | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string | number | boolean>>({});
  const [direction, setDirection] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [formErrorField, setFormErrorField] = useState<string | null>(null);
  const [productPackshot, setProductPackshot] = useState<CreativeReferenceUpload | null>(null);
  const [referenceUploads, setReferenceUploads] = useState<CreativeReferenceUpload[]>([]);
  const [researchSeed, setResearchSeed] = useState<AdAgentResearchSeed | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const intentRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const selectAgent = (
    avail: AgentAvailability,
    prefill: Record<string, string | number | boolean> = {},
    seedDirection = '',
  ) => {
    const defaults: Record<string, string | number | boolean> = {};
    for (const f of avail.agent.uiSchema) {
      if (f.defaultValue !== undefined) defaults[f.id] = f.defaultValue;
    }
    setSelectedAgent(avail.agent);
    setSelectedAvailability(avail);
    setFormValues({ ...defaults, ...prefill });
    setDirection(seedDirection);
    setProductPackshot(null);
    setReferenceUploads([]);
    setResearchSeed(null);
    setFormError(null);
    setFormErrorField(null);
  };

  useEffect(() => {
    getAgentsWithAvailability().then((avail) => {
      setAgents(avail);
      setLoading(false);
      if (avail.length === 1) {
        selectAgent(avail[0]);
      }
    });
  }, []);

  const handleIntentSubmit = async () => {
    if (!intentInput.trim() || routing) return;
    setRouting(true);
    setRouteReason(null);
    setRouteMessage(null);

    try {
      const adAvail = agents.find((a) => a.agent.id === 'ad-agent') || agents[0];

      const urlOnly = intentInput.trim().match(/^https?:\/\/\S+$/);
      if (urlOnly && adAvail) {
        const roles = resolvePromptUrlRoles({ prompt: urlOnly[0] });
        selectAgent(adAvail, {
          ...(roles.productUrl ? { productUrl: roles.productUrl } : {}),
          ...(roles.referenceUrl ? { referenceUrl: roles.referenceUrl } : {}),
        });
        setRouteReason(
          roles.productUrl
            ? 'Detected a product URL — opened Ad Creator.'
            : 'That link is a creative reference — add your product URL below.',
        );
        setRouting(false);
        return;
      }

      const response = await routeIntent(intentInput, agents);

      if (response.route) {
        const match = agents.find((a) => a.agent.id === response.route!.agentId) || adAvail;
        if (!match) {
          setRouteMessage({ text: 'No matching agent is registered.', type: 'warn' });
          setRouting(false);
          return;
        }
        const prefill = mergeExtractedParams(match.agent, response.route.extractedParams);
        if (match.agent.id === 'ad-agent') {
          const roles = resolvePromptUrlRoles({ prompt: intentInput });
          if (roles.productUrl) prefill.productUrl = roles.productUrl;
          else delete prefill.productUrl;
          if (roles.referenceUrl) prefill.referenceUrl = roles.referenceUrl;
          const withoutUrl = intentInput.replace(/https?:\/\/\S+/g, '').trim();
          selectAgent(match, prefill, withoutUrl || intentInput.trim());
        } else if (match.agent.id === 'general-agent') {
          if (!prefill.goal) prefill.goal = intentInput.trim();
          selectAgent(match, prefill, intentInput.trim());
        } else {
          selectAgent(match, prefill, intentInput.trim());
        }
        setRouteReason(response.route.reasoning || `Opened ${match.agent.name}.`);
      } else if (adAvail) {
        selectAgent(adAvail, {}, intentInput.trim());
        setRouteMessage({
          text: response.clarifyQuestion || 'Fill in the studio below.',
          type: 'info',
        });
      } else {
        setRouteMessage({ text: 'No production agent is registered.', type: 'warn' });
      }
    } catch {
      setRouteMessage({ text: 'Could not parse intent — open Ad Creator below.', type: 'warn' });
    }

    setRouting(false);
  };

  const handleFormChange = (id: string, val: string | number | boolean) => {
    setFormValues((prev) => {
      const next = { ...prev, [id]: val };
      if (id === formErrorField) {
        setFormError(null);
        setFormErrorField(null);
      }
      if (selectedAgent?.id === 'ad-agent' && id === 'adFormat') {
        next.platform = getCompatiblePlatform(String(val), String(prev.platform || 'instagram_reels'));
      }
      return next;
    });
  };

  const handleLaunch = () => {
    if (!selectedAgent) return;
    if (selectedAvailability && !selectedAvailability.available && selectedAgent.id === 'ad-agent') {
      setFormError('Shell server required for video assembly. Start it with: npm run agent:server');
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (selectedAgent.id === 'general-agent') {
      const goal = String(formValues.goal || direction || '').trim();
      if (!goal) {
        setFormError('Add a goal before launching the General Agent.');
        setFormErrorField('goal');
        setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
        return;
      }
      setFormError(null);
      setFormErrorField(null);
      onLaunchAgent('general-agent', {
        ...formValues,
        goal,
        reviewMode: Boolean(formValues.reviewMode),
        allowTools: formValues.allowTools !== false,
        maxWorkers: Number(formValues.maxWorkers || 3),
        plannerModel: String(formValues.plannerModel || 'glm_53_flash'),
      });
      return;
    }

    if (selectedAgent.id !== 'ad-agent') {
      setFormError('This agent is not wired for launch yet.');
      return;
    }
    for (const field of selectedAgent.uiSchema) {
      if (field.required && !formValues[field.id]) {
        setFormError(`"${field.label}" is required before launching.`);
        setFormErrorField(field.id);
        setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
        return;
      }
    }
    const productUrl = String(formValues.productUrl || '').trim();
    if (!productUrl && !productPackshot?.base64) {
      setFormError(
        String(formValues.referenceUrl || '').trim()
          ? 'That reference link is not a product. Add your Product URL or upload a packshot before launching.'
          : 'Add a Product URL or upload a packshot before launching.',
      );
      setFormErrorField('productUrl');
      setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      return;
    }
    setFormError(null);
    setFormErrorField(null);
    const launchParams = buildAdCreatorLaunchParams({
      formValues,
      direction,
      researchSeed,
      productPackshot: productPackshot
        ? { base64: productPackshot.base64, mimeType: productPackshot.mimeType, name: productPackshot.name }
        : null,
      referenceUploads,
    });
    onLaunchAgent('ad-agent', launchParams);
  };

  const handleResearchApply = (seed: AdAgentResearchSeed) => {
    setResearchSeed(seed);
    setFormError(null);
    if (seed.productBase64 && !productPackshot) {
      setProductPackshot({
        id: 'research-hero',
        name: seed.productTitle || 'Product',
        base64: seed.productBase64,
        mimeType: seed.productMimeType || 'image/png',
        previewUrl: `data:${seed.productMimeType || 'image/png'};base64,${seed.productBase64}`,
        note: 'From researcher',
      });
    }
  };

  const handleResearchBriefChange = (brief: string) => {
    setResearchSeed((prev) => (prev ? { ...prev, creativeBrief: brief } : prev));
  };

  const resetToIntent = () => {
    setSelectedAgent(null);
    setSelectedAvailability(null);
    setRouteReason(null);
    setRouteMessage(null);
    setDirection('');
    setResearchSeed(null);
  };

  return (
    <div className="min-h-screen bg-dark-bg flex flex-col">
      <div className="sticky top-0 z-50 backdrop-blur-xl bg-dark-bg/90 border-b border-white/10">
        <div className="max-w-3xl mx-auto px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-gray-400 hover:text-white transition-colors text-sm">
              ← Back
            </button>
            <div className="w-8 h-8 rounded-xl bg-teal-500/20 border border-teal-500/30 flex items-center justify-center text-sm text-teal-200">
              ✦
            </div>
            <div>
              <h1 className="text-sm font-bold text-white leading-tight">Agent Hub</h1>
              <p className="text-[10px] text-gray-500">Ad Creator · General Agent</p>
            </div>
          </div>
          {selectedAgent && agents.length > 1 && (
            <button
              onClick={resetToIntent}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Start over
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 max-w-3xl mx-auto w-full px-5 py-7 space-y-6">
        {!selectedAgent && (
          <>
            <div className="space-y-2">
              <div className="flex gap-3">
                <input
                  ref={intentRef}
                  type="text"
                  value={intentInput}
                  onChange={(e) => setIntentInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleIntentSubmit(); }}
                  placeholder="What do you want to make? Ads, research, tools, open-ended goals…"
                  className="flex-1 px-4 py-3 rounded-2xl bg-dark-card border border-white/10 text-white placeholder-gray-600 focus:border-teal-500/50 focus:outline-none focus:ring-2 focus:ring-teal-500/30 text-sm"
                />
                <button
                  onClick={() => void handleIntentSubmit()}
                  disabled={routing || !intentInput.trim()}
                  className="px-5 py-3 rounded-2xl bg-teal-500 text-black font-semibold text-sm disabled:opacity-40 hover:bg-teal-400 transition-all whitespace-nowrap"
                >
                  {routing ? '…' : 'Open'}
                </button>
              </div>
              {routeReason && <p className="text-[11px] text-teal-300/80 pl-1">✦ {routeReason}</p>}
              {routeMessage && (
                <p className={`text-[11px] pl-1 ${routeMessage.type === 'warn' ? 'text-amber-400/80' : 'text-gray-400'}`}>
                  {routeMessage.text}
                </p>
              )}
            </div>

            <div className="space-y-4">
              {loading ? (
                <p className="text-xs text-gray-600">Checking availability...</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
                  {agents.map((avail) => (
                    <button
                      key={avail.agent.id}
                      onClick={() => selectAgent(avail)}
                      className={`text-left p-5 rounded-2xl border transition-all cursor-pointer ${
                        avail.available
                          ? 'border-white/10 bg-dark-card hover:border-teal-500/40 hover:bg-teal-500/5'
                          : 'border-white/10 bg-dark-card hover:border-amber-500/40'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <span className="text-3xl">{avail.agent.icon}</span>
                        {!avail.available && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            needs shell
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-bold text-white mb-1">{avail.agent.name}</p>
                      <p className="text-xs text-gray-400 leading-relaxed">{avail.agent.tagline}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {selectedAgent?.id === 'ad-agent' && (
          <AdCreatorStudio
            agent={selectedAgent}
            availability={selectedAvailability}
            formValues={formValues}
            onChangeForm={handleFormChange}
            direction={direction}
            onDirectionChange={setDirection}
            productPackshot={productPackshot}
            onPackshotChange={(value) => {
              setProductPackshot(value);
              if (value && formErrorField === 'productUrl') {
                setFormError(null);
                setFormErrorField(null);
              }
            }}
            referenceUploads={referenceUploads}
            onReferenceUploadsChange={setReferenceUploads}
            researchSeed={researchSeed}
            onResearchApply={handleResearchApply}
            onResearchBriefChange={handleResearchBriefChange}
            formError={formError}
            formErrorField={formErrorField}
            isUploading={isUploading}
            onUploadingChange={setIsUploading}
            onLaunch={handleLaunch}
            onCancel={agents.length > 1 ? resetToIntent : onBack}
            formRef={formRef}
          />
        )}

        {selectedAgent?.id === 'general-agent' && (
          <div ref={formRef} className="rounded-2xl border border-white/10 bg-dark-card/80 p-5 sm:p-6 space-y-5">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">General Agent</p>
              <h2 className="text-lg font-bold text-white">Autonomous open-ended run</h2>
              <p className="text-xs text-gray-400 mt-1">
                Plan → fan-out specialist workers → optional shell/MCP tools → synthesize a deliverable.
              </p>
            </div>

            <label className="block space-y-2">
              <span className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">Goal</span>
              <textarea
                value={String(formValues.goal || direction || '')}
                onChange={(e) => {
                  setDirection(e.target.value);
                  handleFormChange('goal', e.target.value);
                }}
                rows={5}
                placeholder="Research competitors, inspect files, draft a brief — describe the outcome…"
                className={`w-full rounded-xl border bg-black/30 px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-teal-500/50 ${
                  formErrorField === 'goal' ? 'border-red-500/50' : 'border-white/10'
                }`}
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block space-y-1">
                <span className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">
                  Max parallel workers · {Number(formValues.maxWorkers || 3)}
                </span>
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={Number(formValues.maxWorkers || 3)}
                  onChange={(e) => handleFormChange('maxWorkers', Number(e.target.value))}
                  className="w-full"
                />
              </label>
              <div className="space-y-3 pt-1">
                <label className="flex items-center justify-between gap-3 text-xs text-gray-300">
                  <span>Allow shell / MCP tools</span>
                  <input
                    type="checkbox"
                    checked={formValues.allowTools !== false}
                    onChange={(e) => handleFormChange('allowTools', e.target.checked)}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-xs text-gray-300">
                  <span>Auto-approve plan</span>
                  <input
                    type="checkbox"
                    checked={Boolean(formValues.reviewMode)}
                    onChange={(e) => handleFormChange('reviewMode', e.target.checked)}
                  />
                </label>
              </div>
            </div>

            {formError && (
              <p className="text-xs text-red-300">{formError}</p>
            )}

            <div className="flex flex-wrap gap-2">
              {(selectedAgent.examplePrompts || []).slice(0, 3).map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => {
                    handleFormChange('goal', ex);
                    setDirection(ex);
                  }}
                  className="text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:border-teal-500/40"
                >
                  {ex.length > 48 ? `${ex.slice(0, 48)}…` : ex}
                </button>
              ))}
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={handleLaunch}
                className="px-5 py-2.5 rounded-xl bg-teal-500 text-black text-sm font-semibold hover:bg-teal-400"
              >
                Launch General Agent
              </button>
              <button
                type="button"
                onClick={agents.length > 1 ? resetToIntent : onBack}
                className="px-4 py-2.5 rounded-xl border border-white/10 text-sm text-gray-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {selectedAgent && selectedAgent.id !== 'ad-agent' && selectedAgent.id !== 'general-agent' && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            This agent is not wired for launch yet.
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentHub;
