/**
 * Ad Creator researcher — Image Studio–style research before Launch.
 * Reuses brand / trend / strategist / concept services via researchForAdAgent.
 */

import React, { useEffect, useState } from 'react';
import type { CreativeConcept } from './AIImageStudio/types';
import {
  formatAdAgentCreativeBrief,
  mapAgentPlatformToSocial,
  researchForAdAgent,
  type AdAgentPackshot,
  type AdAgentResearchResult,
} from '../services/adAgentResearch';
import {
  coerceVideoVibe,
  defaultVibeForPlatform,
  isVideoAdFormat,
} from '../services/adAgentVideoTreatment';

export interface AdAgentResearchSeed {
  creativeBrief: string;
  productTitle?: string;
  productFacts?: string[];
  productBase64?: string;
  productMimeType?: string;
  selectedConceptTitle?: string;
}

interface Props {
  productUrl: string;
  platform: string;
  packshot: AdAgentPackshot | null;
  /** Prefill from Hub direction / intent */
  defaultGoal: string;
  onApply: (seed: AdAgentResearchSeed) => void;
  /** Fired after a successful apply (parent can scroll / show banner). */
  onApplied?: (seed: AdAgentResearchSeed) => void;
  /** When true, drop outer chrome (parent section already frames it). */
  embedded?: boolean;
  /** Video formats trigger a video-treatment research pass (hook / beats / motion). */
  adFormat?: string;
  durationSec?: number;
  vibe?: string;
}

const AdAgentResearchPanel: React.FC<Props> = ({
  productUrl,
  platform,
  packshot,
  defaultGoal,
  onApply,
  onApplied,
  embedded = false,
  adFormat = 'stitched_video',
  durationSec = 30,
  vibe,
}) => {
  // Prefills from Ad Creator direction; editable for research (tracks dirty so edits aren't overwritten).
  const [localGoal, setLocalGoal] = useState(defaultGoal);
  const [goalDirty, setGoalDirty] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [applied, setApplied] = useState(false);
  const [result, setResult] = useState<AdAgentResearchResult | null>(null);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const [briefText, setBriefText] = useState('');

  useEffect(() => {
    if (!goalDirty) setLocalGoal(defaultGoal);
  }, [defaultGoal, goalDirty]);

  const campaignGoal = localGoal.trim();
  const directionPrompt = defaultGoal.trim();
  const differsFromDirection = embedded && campaignGoal !== directionPrompt;

  const syncFromDirection = () => {
    setLocalGoal(defaultGoal);
    setGoalDirty(false);
    setError('');
  };

  const selectedConcept: CreativeConcept | null =
    result?.concepts.find((c) => c.id === selectedConceptId) || result?.concepts[0] || null;

  const runResearch = async () => {
    if (!campaignGoal) {
      setError(embedded
        ? 'Enter or edit the research prompt — it starts from your direction in step 01.'
        : 'Describe what you want the ad to achieve (goal / concept direction).');
      return;
    }
    if (!productUrl.trim() && !packshot?.base64) {
      setError('Add a Product URL or upload a packshot first.');
      return;
    }
    setRunning(true);
    setError('');
    setApplied(false);
    setStage('Starting research…');
    setResult(null);
    try {
      const research = await researchForAdAgent(
        {
          campaignGoal,
          productUrl: productUrl.trim() || undefined,
          platform: mapAgentPlatformToSocial(platform),
          packshot: packshot || undefined,
          videoContext: isVideoAdFormat(adFormat)
            ? {
                adFormat,
                agentPlatform: platform,
                durationSec,
                vibe: coerceVideoVibe(vibe, defaultVibeForPlatform(platform)),
              }
            : undefined,
        },
        setStage,
      );
      setResult(research);
      setSelectedConceptId(research.concepts[0]?.id || null);
      setBriefText(research.creativeBrief);
      setStage('Research ready — review brief & pick a concept');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Research failed.');
      setStage('');
    } finally {
      setRunning(false);
    }
  };

  const refreshBriefFromConcept = (conceptId: string) => {
    if (!result) return;
    setSelectedConceptId(conceptId);
    const concept = result.concepts.find((c) => c.id === conceptId) || null;
    setBriefText(
      formatAdAgentCreativeBrief({
        campaignGoal,
        strategistBrief: result.strategistBrief,
        concept,
        productTitle: result.productTitle,
        productFacts: result.productFacts,
        brandName: result.brandName,
        trendTitles: result.trendTitles,
        videoTreatment: result.videoTreatment,
        videoContext: result.videoContext,
      }),
    );
  };

  const applyToLaunch = () => {
    if (!briefText.trim()) {
      setError('Research a brief first, or edit the creative brief below.');
      return;
    }
    // Keep the research prompt as-is — don't pull the long applied brief back into this field.
    setGoalDirty(true);
    setError('');
    const seed: AdAgentResearchSeed = {
      creativeBrief: briefText.trim(),
      productTitle: result?.productTitle,
      productFacts: result?.productFacts,
      productBase64: result?.productBase64,
      productMimeType: result?.productMimeType,
      selectedConceptTitle: selectedConcept?.title,
    };
    onApply(seed);
    setApplied(true);
    setStage(
      selectedConcept?.title
        ? `Applied — “${selectedConcept.title}” locked for Launch`
        : 'Applied — locked brief ready for Launch',
    );
    onApplied?.(seed);
  };

  const shell = (
    <div className="space-y-4">
      {!embedded && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-200">Researcher</p>
          <p className="mt-1 text-[11px] text-gray-400 leading-relaxed">
            Product truth → brand → trends → brief → concepts. Apply to Launch when ready.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">
            {embedded ? 'Research prompt' : 'Campaign goal / concept'}
          </label>
          {embedded && differsFromDirection && (
            <button
              type="button"
              onClick={syncFromDirection}
              className="text-[10px] text-teal-300 hover:text-teal-200 underline underline-offset-2"
            >
              Reset to direction
            </button>
          )}
        </div>
        <textarea
          value={localGoal}
          onChange={(e) => {
            setLocalGoal(e.target.value);
            setGoalDirty(true);
          }}
          rows={embedded ? 3 : 2}
          placeholder={
            embedded
              ? 'Starts from your direction above — edit freely for research'
              : 'e.g. 30s Instagram reel — morning matcha ritual vs coffee, calm luxury'
          }
          className="w-full px-3 py-2.5 rounded-xl bg-black/25 border border-white/10 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500/40 resize-none leading-relaxed"
        />
        {embedded && !directionPrompt && !campaignGoal && (
          <p className="text-[11px] text-amber-300/90">
            Tip: write your ad direction in step 01 — it will fill this prompt automatically.
          </p>
        )}
        {embedded && directionPrompt && !goalDirty && (
          <p className="text-[10px] text-gray-600">Synced from your direction · edit anytime</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void runResearch()}
          disabled={running || !campaignGoal}
          className="px-4 py-2 rounded-xl bg-teal-500 text-black text-xs font-bold hover:bg-teal-400 disabled:opacity-50 transition-colors"
        >
          {running ? 'Researching…' : 'Research product & concepts'}
        </button>
        {stage && (
          <span className="text-[10px] text-teal-300/80">{stage}</span>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
      )}

      {result && (
        <div className="space-y-4 pt-2 border-t border-teal-500/20">
          {(result.brandName || result.productTitle) && (
            <p className="text-[11px] text-gray-300">
              {result.brandName && <span className="text-teal-200">{result.brandName}</span>}
              {result.brandName && result.productTitle ? ' · ' : ''}
              {result.productTitle}
              {result.trendTitles[0] ? ` · Trend: ${result.trendTitles[0]}` : ''}
            </p>
          )}

          {result.productFacts.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">Product facts</p>
              <ul className="space-y-1 max-h-28 overflow-y-auto">
                {result.productFacts.slice(0, 8).map((fact) => (
                  <li key={fact} className="text-[11px] text-gray-400 leading-snug">• {fact}</li>
                ))}
              </ul>
            </div>
          )}

          {result.concepts.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Pick a concept</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {result.concepts.map((concept) => {
                  const selected = (selectedConceptId || result.concepts[0]?.id) === concept.id;
                  return (
                    <button
                      key={concept.id}
                      type="button"
                      onClick={() => refreshBriefFromConcept(concept.id)}
                      className={`text-left rounded-xl border p-3 transition-colors ${
                        selected
                          ? 'border-teal-400/60 bg-teal-500/15'
                          : 'border-dark-border bg-dark-bg hover:border-teal-500/30'
                      }`}
                    >
                      <p className="text-xs font-semibold text-white">{concept.title}</p>
                      <p className="mt-1 text-[10px] text-gray-400 leading-snug">{concept.oneLineIdea}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-wider text-gray-500">Creative brief (editable)</label>
            <textarea
              value={briefText}
              onChange={(e) => setBriefText(e.target.value)}
              rows={6}
              className="w-full px-3 py-2.5 rounded-xl bg-dark-bg border border-dark-border text-[11px] text-gray-200 placeholder-gray-600 focus:border-teal-500 focus:outline-none resize-y font-mono leading-relaxed"
            />
          </div>

          {result.warnings.length > 0 && (
            <p className="text-[10px] text-amber-300/80">
              {result.warnings.slice(0, 3).join(' · ')}
            </p>
          )}

          <button
            type="button"
            onClick={applyToLaunch}
            className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all ${
              applied
                ? 'bg-emerald-500 text-black'
                : 'bg-teal-500 text-black hover:bg-teal-400'
            }`}
          >
            {applied ? 'Research applied ✓' : 'Use this research'}
          </button>
          {applied && (
            <p className="text-[11px] text-emerald-300/90 text-center">
              Locked brief saved — your direction words stay unchanged. Review the Locked brief card, then Launch.
            </p>
          )}
        </div>
      )}
    </div>
  );

  if (embedded) return shell;
  return (
    <div className="rounded-2xl border border-teal-500/25 bg-teal-500/5 p-5">
      {shell}
    </div>
  );
};

export default AdAgentResearchPanel;
