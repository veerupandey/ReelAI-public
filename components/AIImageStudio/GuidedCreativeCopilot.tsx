import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AspectRatio,
  CreativeConcept,
  CreativeExecutionMode,
  OutputIntent,
  SocialObjective,
  SocialPostDraft,
  StrategistBrief,
  StudioState,
} from './types';
import {
  extractCampaignGoal,
  generateMoreConcepts,
  getCopilotWarnings,
  mergeLockedReferences,
  regenerateConceptsFromBrief,
  runCreativeCopilot,
} from './creativeCopilotService';
import { createSocialPostDraft } from './socialPostDirectorService';
import { researchBrand, normalizeBrandUrls } from './brandKnowledgeService';
import { polishStrategistBrief } from './strategistBriefService';
import { generateProductionBrief } from './productionBriefService';
import StrategistBriefPanel from './StrategistBriefPanel';
import ProductionBriefPanel from './ProductionBriefPanel';

export interface GenerateOverrides {
  aspectRatio?: AspectRatio;
  outputIntent?: OutputIntent;
}

interface Props {
  state: StudioState;
  onDispatch: (action: unknown) => void;
  onGenerate?: (overrides?: GenerateOverrides) => void;
  onDevelopInWriter?: (concept: CreativeConcept) => void;
  /** Open Writer seeded with an arbitrary production prompt */
  onDevelopPromptInWriter?: (prompt: string) => void;
  onClose?: () => void;
}

const GuidedCreativeCopilot: React.FC<Props> = ({
  state,
  onDispatch,
  onGenerate,
  onDevelopInWriter,
  onDevelopPromptInWriter,
  onClose,
}) => {
  const [goal, setGoal] = useState(extractCampaignGoal(state.prompt));
  const brandUrls = state.brandUrlInput;
  const setBrandUrls = useCallback(
    (text: string) => {
      onDispatch({ type: 'SET_BRAND_URL_INPUT', text });
    },
    [onDispatch],
  );
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [socialRunning, setSocialRunning] = useState(false);
  const [socialStage, setSocialStage] = useState('');
  const [moreRunning, setMoreRunning] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [regenRunning, setRegenRunning] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [socialDirection, setSocialDirection] = useState('');
  const socialSectionRef = useRef<HTMLElement>(null);
  const lockedReferences = mergeLockedReferences(state.composerReferences, state.gallerySelectionIds);
  const lockedProductReferences = lockedReferences.filter((reference) => reference.role === 'product');
  const planningStale = Boolean(state.productTruthStale || state.strategistBriefStale);

  const runResearch = useCallback(async () => {
    let urls: string[] = [];
    if (brandUrls.trim()) {
      try {
        urls = normalizeBrandUrls(brandUrls.split('\n'));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Enter a valid brand website URL.');
        return;
      }
    }
    if (!goal.trim()) return;
    if (urls.length === 0 && lockedReferences.length === 0) {
      setError('Add a brand website or lock at least one product image.');
      return;
    }
    setRunning(true);
    setError('');
    setWarnings([]);
    onDispatch({ type: 'CLEAR_CONCEPT_CANDIDATES' });
    onDispatch({ type: 'CLEAR_SOCIAL_POST_DRAFT' });
    onDispatch({ type: 'CLEAR_STRATEGIST_BRIEF' });
    onDispatch({ type: 'CLEAR_PRODUCTION_BRIEF' });
    try {
      const result = await runCreativeCopilot(
        {
          brandUrls: urls,
          campaignGoal: goal,
          productName: state.productTruth?.productName,
          platform: 'instagram_feed',
          references: lockedReferences,
          assets: state.assets,
          aspectRatio: state.aspectRatio,
          existingProductTruth: state.productTruth,
        },
        setStage,
      );
      if (result.productTruth) {
        onDispatch({ type: 'SET_PRODUCT_TRUTH', productTruth: result.productTruth });
      }
      if (result.brand?.knowledge) {
        onDispatch({ type: 'SET_BRAND_KNOWLEDGE', brandKnowledge: result.brand.knowledge });
      }
      onDispatch({ type: 'SET_TREND_RESEARCH', trendResearch: result.trends.result });
      onDispatch({ type: 'SET_STRATEGIST_BRIEF', brief: result.strategistBrief.brief });
      onDispatch({ type: 'SET_CONCEPT_CANDIDATES', concepts: result.concepts.concepts });
      setWarnings(getCopilotWarnings(result));
      const trendCount = result.trends.result.insights.length;
      const grounded = result.trends.result.sources.some((s) => Boolean(s.url));
      setStage(
        `Brief ready · ${result.concepts.concepts.length} concepts · ${trendCount} trend${trendCount === 1 ? '' : 's'}${grounded ? ' (web)' : ''}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Copilot research failed.');
    } finally {
      setRunning(false);
    }
  }, [brandUrls, goal, state.productTruth, lockedReferences, state.assets, state.aspectRatio, onDispatch]);

  const requestMoreConcepts = useCallback(async () => {
    const effectiveGoal =
      goal.trim() ||
      state.conceptCandidates[0]?.oneLineIdea ||
      state.brandKnowledge?.brandName.value ||
      '';
    if (!effectiveGoal) {
      setError('Add a campaign goal in section 1 to generate more ideas.');
      return;
    }
    setMoreRunning(true);
    setError('');
    try {
      const result = await generateMoreConcepts({
        campaignGoal: effectiveGoal,
        brandKnowledge: state.brandKnowledge,
        trendResearch: state.trendResearch,
        productTruth: state.productTruth,
        strategistBrief: state.strategistBrief,
        references: lockedReferences,
        assets: state.assets,
        existingConcepts: state.conceptCandidates,
        conceptCount: 3,
        aspectRatio: state.aspectRatio,
      });
      if (!result.concepts.length) {
        setError('No new concepts were generated. Try adjusting the campaign goal.');
      } else {
        onDispatch({ type: 'APPEND_CONCEPT_CANDIDATES', concepts: result.concepts });
        setStage(`Added ${result.concepts.length} fresh concepts`);
      }
      if (result.warnings.length) setWarnings((prev) => [...prev, ...result.warnings]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate more concepts.');
    } finally {
      setMoreRunning(false);
    }
  }, [
    goal,
    state.brandKnowledge,
    state.trendResearch,
    state.productTruth,
    state.strategistBrief,
    state.conceptCandidates,
    state.assets,
    state.aspectRatio,
    lockedReferences,
    onDispatch,
  ]);

  const regenerateFromBrief = useCallback(async () => {
    const effectiveGoal = goal.trim() || state.strategistBrief?.campaignGoal || '';
    if (!effectiveGoal) {
      setError('Add a campaign goal before regenerating concepts.');
      return;
    }
    setRegenRunning(true);
    setError('');
    try {
      const result = await regenerateConceptsFromBrief({
        campaignGoal: effectiveGoal,
        brandKnowledge: state.brandKnowledge,
        trendResearch: state.trendResearch,
        productTruth: state.productTruth,
        strategistBrief: state.strategistBrief,
        references: lockedReferences,
        assets: state.assets,
        platform: 'instagram_feed',
        aspectRatio: state.aspectRatio,
        conceptCount: Math.max(3, state.conceptCandidates.length || 3),
      });
      onDispatch({ type: 'SET_STRATEGIST_BRIEF', brief: result.strategistBrief.brief });
      onDispatch({ type: 'SET_CONCEPT_CANDIDATES', concepts: result.concepts.concepts });
      onDispatch({ type: 'CLEAR_PRODUCTION_BRIEF' });
      if (result.warnings.length) setWarnings((prev) => [...prev, ...result.warnings]);
      setStage(`Regenerated ${result.concepts.concepts.length} concepts from brief`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not regenerate concepts.');
    } finally {
      setRegenRunning(false);
    }
  }, [
    goal,
    state.brandKnowledge,
    state.trendResearch,
    state.productTruth,
    state.strategistBrief,
    state.conceptCandidates.length,
    state.assets,
    state.aspectRatio,
    lockedReferences,
    onDispatch,
  ]);

  const polishBrief = useCallback(async () => {
    if (!state.strategistBrief) return;
    setPolishing(true);
    setError('');
    try {
      const polished = await polishStrategistBrief(state.strategistBrief, {
        brandKnowledge: state.brandKnowledge,
        productTruth: state.productTruth,
        trendResearch: state.trendResearch,
      });
      onDispatch({ type: 'SET_STRATEGIST_BRIEF', brief: polished });
      setStage('Strategist brief polished');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Brief polish failed.');
    } finally {
      setPolishing(false);
    }
  }, [state.strategistBrief, state.brandKnowledge, state.productTruth, state.trendResearch, onDispatch]);

  const updateBrief = useCallback(
    (updates: Partial<StrategistBrief>) => {
      onDispatch({ type: 'UPDATE_STRATEGIST_BRIEF', updates });
    },
    [onDispatch],
  );

  const changeExecutionMode = useCallback(
    (mode: CreativeExecutionMode) => {
      onDispatch({ type: 'UPDATE_STRATEGIST_BRIEF', updates: { executionMode: mode } });
    },
    [onDispatch],
  );

  const selectConcept = useCallback(
    (concept: CreativeConcept, andGenerate = false) => {
      onDispatch({ type: 'SELECT_CONCEPT', conceptId: concept.id });
      const fullPrompt = concept.negativePrompt
        ? `${concept.visualDirection}\n\nNEGATIVE PROMPT (things to avoid): ${concept.negativePrompt}`
        : concept.visualDirection;
      onDispatch({ type: 'SET_PROMPT_ENRICHED', text: fullPrompt, enriched: true });

      const brief = generateProductionBrief({
        selectedConcept: concept,
        brandKnowledge: state.brandKnowledge,
        trendResearch: state.trendResearch,
        productTruth: state.productTruth,
        strategistBrief: state.strategistBrief,
        userDirection: goal.trim() || state.strategistBrief?.campaignGoal || concept.oneLineIdea,
        availableReferences: lockedReferences,
        preferredAspectRatio: state.aspectRatio,
      });
      onDispatch({ type: 'SET_PRODUCTION_BRIEF', brief });

      if (andGenerate) {
        onGenerate?.({ outputIntent: 'image' });
      }
    },
    [
      onDispatch,
      onGenerate,
      state.brandKnowledge,
      state.trendResearch,
      state.productTruth,
      state.strategistBrief,
      state.aspectRatio,
      goal,
      lockedReferences,
    ],
  );

  const createSocial = useCallback(async () => {
    const heroAssetId = lockedProductReferences[0]?.assetId;
    if (!heroAssetId) return;
    setSocialRunning(true);
    setSocialStage('Preparing locked images...');
    setError('');
    try {
      let brandKnowledge = state.brandKnowledge;
      if (!brandKnowledge) {
        let urls: string[];
        try {
          urls = normalizeBrandUrls(brandUrls.split('\n'));
        } catch {
          throw new Error(
            'Add a brand website URL so Social Post can research brand fonts and aesthetics first.',
          );
        }
        setSocialStage('Researching brand fonts and aesthetics...');
        const brandResult = await researchBrand({ sourceUrls: urls }, (progress) =>
          setSocialStage(progress.message),
        );
        brandKnowledge = brandResult.knowledge;
        onDispatch({ type: 'SET_BRAND_KNOWLEDGE', brandKnowledge });
        if (brandResult.warnings.length) setWarnings((previous) => [...previous, ...brandResult.warnings]);
      }
      const selected = state.conceptCandidates.find((concept) => concept.id === state.selectedConceptId);
      const objective: SocialObjective = /\b(educat|inform|teach|guide|explain|learn|advanced)\b/i.test(
        goal,
      )
        ? 'education'
        : /\b(shop|buy|sale|convert|conversion|purchase)\b/i.test(goal)
          ? 'conversion'
          : /\b(comment|engage|question|community)\b/i.test(goal)
            ? 'engagement'
            : 'awareness';
      const result = await createSocialPostDraft(
        {
          platform: state.trendResearch?.platform ?? 'instagram_feed',
          objective,
          heroAssetId,
          supportingAssetIds: lockedProductReferences
            .filter((reference) => reference.assetId !== heroAssetId)
            .map((reference) => reference.assetId),
          brandKnowledge,
          productTruth: state.productTruth,
          selectedConcept: selected,
          trendResearch: state.trendResearch,
          availableReferences: lockedProductReferences,
          assets: state.assets,
          userDirection: socialDirection.trim() || undefined,
        },
        (progress) => setSocialStage(progress.message),
      );
      onDispatch({ type: 'SET_SOCIAL_POST_DRAFT', draft: result.draft });
      if (result.warnings.length) setWarnings((previous) => [...previous, ...result.warnings]);
      setSocialStage('Social post draft ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Social post creation failed.');
      setSocialStage('');
    } finally {
      setSocialRunning(false);
    }
  }, [state, brandUrls, lockedProductReferences, goal, socialDirection, onDispatch]);

  const selectedConcept = state.conceptCandidates.find((concept) => concept.id === state.selectedConceptId);
  const draft: SocialPostDraft | undefined = state.socialPostDraft;

  useEffect(() => {
    if (!onClose) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="h-full min-h-0 flex flex-col bg-studio-surface">
      <div className="px-4 py-3.5 border-b border-studio-border/80 flex items-center justify-between bg-studio-bg/30">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-studio-ink">Creative Assistant</h2>
          <p className="text-[11px] text-studio-mist mt-0.5">Research → brief → concepts → Writer</p>
        </div>
        <button
          type="button"
          onClick={() => onClose?.()}
          disabled={!onClose}
          className="h-7 w-7 rounded-md text-studio-mist hover:text-studio-ink hover:bg-white/8 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Close assistant"
        >
          ✕
        </button>
      </div>

      <div className="flex items-center gap-2 border-b border-studio-border px-4 py-2">
        <button
          type="button"
          onClick={() => socialSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="rounded-md border border-studio-accent/30 bg-studio-accent/10 px-3 py-1.5 text-xs font-medium text-teal-100 hover:bg-studio-accent/20"
        >
          Social Post ({lockedProductReferences.length})
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-5">
        <section className="space-y-3">
          <div className="text-xs uppercase tracking-widest text-teal-200">1. Research & Create Concepts</div>
          <textarea
            value={brandUrls}
            onChange={(event) => setBrandUrls(event.target.value)}
            placeholder="Brand website (e.g. yourbrand.com or https://yourbrand.com)"
            className="w-full h-16 bg-studio-panel border border-studio-border rounded-lg p-3 text-sm text-white resize-none"
            aria-label="Brand website URL"
          />
          <p className="text-[10px] text-studio-mist/70">
            Shared across Import, Prompt Writer, and Assistant — edit anytime.
          </p>
          <textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="What are you promoting and who is it for?"
            className="w-full h-24 bg-studio-panel border border-studio-border rounded-lg p-3 text-sm text-white resize-none"
          />
          <div className="text-xs text-studio-mist/80">
            {lockedReferences.length} locked image{lockedReferences.length === 1 ? '' : 's'} will be
            analyzed for Product Truth.
          </div>
          {planningStale && (
            <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              Locked images changed — Product Truth / brief may be stale. Re-research or regenerate
              concepts from the brief.
            </div>
          )}
          <button
            onClick={runResearch}
            disabled={running || !goal.trim() || (!brandUrls.trim() && lockedReferences.length === 0)}
            className="w-full py-3 bg-gradient-to-r from-insta-start via-insta-mid to-insta-end rounded-lg text-white font-semibold disabled:opacity-40"
          >
            {running ? stage || 'Working...' : 'Research, Plan & Create Concepts'}
          </button>
          {stage && !running && !polishing && !regenRunning && (
            <div className="text-xs text-green-300">{stage}</div>
          )}
          {error && (
            <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded p-3">
              {error}
            </div>
          )}
          {warnings.length > 0 && (
            <div className="text-xs text-yellow-300 bg-yellow-500/10 border border-yellow-500/20 rounded p-3">
              {warnings.join(' ')}
            </div>
          )}
        </section>

        {state.strategistBrief && (
          <StrategistBriefPanel
            brief={state.strategistBrief}
            stale={planningStale}
            isPolishing={polishing}
            isRegeneratingConcepts={regenRunning || moreRunning}
            onChange={updateBrief}
            onPolish={polishBrief}
            onRegenerateConcepts={regenerateFromBrief}
            onExecutionModeChange={changeExecutionMode}
          />
        )}

        {state.trendResearch && state.trendResearch.insights.length > 0 && (
          <section className="space-y-2" data-testid="assistant-trend-insights">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs uppercase tracking-widest text-teal-200">
                Recent market trends
              </div>
              <span className="text-[10px] text-studio-mist/70">
                {new Date(state.trendResearch.researchedAt).toLocaleDateString()}
                {state.trendResearch.sources.some((s) => s.url) ? ' · web search' : ''}
              </span>
            </div>
            <ul className="space-y-2">
              {state.trendResearch.insights.slice(0, 4).map((insight) => (
                <li
                  key={insight.id}
                  className="rounded-lg border border-studio-border/80 bg-studio-panel/60 px-3 py-2"
                >
                  <p className="text-xs font-medium text-studio-ink">{insight.title}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-studio-mist line-clamp-3">
                    {insight.description}
                  </p>
                  {insight.applicability && (
                    <p className="mt-1 text-[10px] text-teal-200/80">{insight.applicability}</p>
                  )}
                </li>
              ))}
            </ul>
            {state.trendResearch.sources.filter((s) => s.url).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {state.trendResearch.sources
                  .filter((s) => s.url)
                  .slice(0, 4)
                  .map((source) => (
                    <a
                      key={source.id}
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate max-w-[160px] text-[10px] text-teal-300/90 underline hover:text-teal-200"
                    >
                      {source.label}
                    </a>
                  ))}
              </div>
            )}
          </section>
        )}

        {state.conceptCandidates.length > 0 && (
          <section className="space-y-3">
            <div className="text-xs uppercase tracking-widest text-teal-200">2. Choose A Grounded Concept</div>
            {state.conceptCandidates.map((concept) => (
              <button
                key={concept.id}
                onClick={() => selectConcept(concept)}
                className={`w-full text-left rounded-lg border p-3 ${
                  concept.id === state.selectedConceptId
                    ? 'border-green-400 bg-green-500/10'
                    : 'border-studio-border bg-studio-panel'
                }`}
              >
                <div className="font-medium text-white">{concept.title}</div>
                <div className="text-sm text-studio-mist mt-1">{concept.oneLineIdea}</div>
                <div className="text-xs text-studio-mist/80 mt-2">{concept.visualDirection}</div>
                {concept.negativePrompt && (
                  <div className="text-xs text-red-400/60 mt-1">
                    Avoid: {concept.negativePrompt.slice(0, 80)}
                    {concept.negativePrompt.length > 80 ? '…' : ''}
                  </div>
                )}
                <div className="text-xs text-teal-200 mt-2">
                  {concept.id === state.selectedConceptId
                    ? 'Selected — review production brief next'
                    : 'Select concept'}
                </div>
              </button>
            ))}
            <button
              onClick={requestMoreConcepts}
              disabled={moreRunning || running || regenRunning}
              className="w-full py-2.5 bg-studio-panel border border-studio-accent/40 rounded-lg text-teal-100 text-sm font-medium hover:bg-studio-accent/10 disabled:opacity-40"
            >
              {moreRunning ? 'Generating fresh ideas...' : '+ Generate More Ideas'}
            </button>
            {selectedConcept && (
              <div className="flex flex-col gap-2">
                {onDevelopInWriter && (
                  <button
                    type="button"
                    onClick={() => onDevelopInWriter(selectedConcept)}
                    className="w-full py-3 rounded-lg bg-gradient-to-r from-studio-accent to-studio-accent-strong text-sm font-semibold text-white hover:shadow-lg hover:shadow-studio-accent/25"
                  >
                    Develop in Prompt Writer
                  </button>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => selectConcept(selectedConcept, true)}
                    disabled={!onGenerate}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium disabled:opacity-40 ${
                      onDevelopInWriter
                        ? 'bg-studio-panel border border-studio-accent/40 text-teal-100 hover:bg-studio-accent/10'
                        : 'bg-studio-accent text-white font-semibold'
                    }`}
                  >
                    Select & Generate
                  </button>
                  <button
                    onClick={() => onGenerate?.({ outputIntent: 'image' })}
                    disabled={!onGenerate}
                    className="px-4 py-2.5 bg-studio-panel border border-studio-border rounded-lg text-studio-mist text-sm font-medium hover:bg-studio-panel disabled:opacity-40"
                  >
                    Generate
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {state.productionBrief && (
          <ProductionBriefPanel
            brief={state.productionBrief}
            onPromptChange={(prompt) =>
              onDispatch({ type: 'UPDATE_PRODUCTION_BRIEF', updates: { generationPrompt: prompt } })
            }
            onApplyPrompt={(prompt) =>
              onDispatch({ type: 'SET_PROMPT_ENRICHED', text: prompt, enriched: true })
            }
            onDevelopInWriter={(prompt) => {
              if (onDevelopPromptInWriter) {
                onDevelopPromptInWriter(prompt);
                return;
              }
              onDispatch({ type: 'SET_PROMPT_ENRICHED', text: prompt, enriched: true });
              if (selectedConcept && onDevelopInWriter) onDevelopInWriter(selectedConcept);
            }}
            onClear={() => onDispatch({ type: 'CLEAR_PRODUCTION_BRIEF' })}
          />
        )}

        <section ref={socialSectionRef} className="scroll-mt-4 space-y-3">
          <div className="text-xs uppercase tracking-widest text-teal-200">3. Social Post From Locked Images</div>
          <textarea
            value={socialDirection}
            onChange={(event) => setSocialDirection(event.target.value)}
            placeholder='Optional: creative direction (e.g. "bold headline", "no text, minimalist")'
            className="w-full h-14 bg-studio-panel border border-studio-border rounded-lg p-3 text-sm text-white resize-none placeholder:text-studio-mist/80"
          />
          <button
            onClick={createSocial}
            disabled={socialRunning || lockedProductReferences.length === 0}
            className="w-full py-3 bg-studio-panel border border-studio-border rounded-lg text-white font-medium disabled:opacity-40"
          >
            {socialRunning ? socialStage || 'Creating Social Post...' : 'Create Social Post From Locked Images'}
          </button>
          {socialStage && (
            <div
              className={`rounded-lg border px-3 py-2 text-xs ${
                socialRunning
                  ? 'border-studio-accent/30 bg-studio-accent/10 text-teal-100'
                  : 'border-green-500/20 bg-green-500/10 text-green-300'
              }`}
              role="status"
              aria-live="polite"
            >
              {socialRunning && (
                <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-teal-300" />
              )}
              {socialStage}
            </div>
          )}
          {draft && (
            <div className="rounded-lg border border-studio-border bg-studio-panel p-3 space-y-2">
              {draft.artDirectionPlan?.textDecision === 'none' ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
                    <span className="text-xs font-medium text-green-300">Text-free design</span>
                  </div>
                  <div className="text-sm text-white">{draft.artDirectionPlan.visualStrategy}</div>
                </>
              ) : (
                <>
                  {draft.copy.headline && <div className="font-medium text-white">{draft.copy.headline}</div>}
                  {draft.copy.supportingText && (
                    <div className="text-sm text-studio-mist">{draft.copy.supportingText}</div>
                  )}
                </>
              )}
              <div className="text-xs text-studio-mist mt-1">{draft.copy.caption}</div>
              {draft.copy.hashtags.length > 0 && (
                <div className="text-xs text-studio-mist/80">
                  {draft.copy.hashtags.map((h) => `#${h}`).join(' ')}
                </div>
              )}
              {draft.artDirectionPlan && (
                <div className="text-xs text-studio-mist/80 border-t border-studio-border pt-2 mt-2">
                  {draft.platform.replace('_', ' ')} · {draft.objective} · {draft.aspectRatio}
                </div>
              )}
              <button
                onClick={() =>
                  onGenerate?.({ aspectRatio: draft.aspectRatio, outputIntent: 'social_post' })
                }
                className="w-full py-2 bg-studio-accent rounded text-white text-sm font-medium"
              >
                Generate Social Post Image
              </button>
            </div>
          )}
        </section>

        <section>
          <button
            onClick={() => setDetailsOpen((value) => !value)}
            className="text-sm text-studio-mist hover:text-white"
          >
            {detailsOpen ? 'Hide' : 'Show'} Research Details
          </button>
          {detailsOpen && (
            <div className="mt-3 space-y-3 text-xs text-studio-mist">
              <div>Brand: {state.brandKnowledge?.brandName.value ?? 'Not researched'}</div>
              <div>Product truth: {state.productTruth?.productName ?? 'Not established'}</div>
              <div>
                Planning stale:{' '}
                {planningStale ? 'yes — re-research or regenerate concepts' : 'no'}
              </div>
              <div>Strategist mode: {state.strategistBrief?.executionMode ?? 'None'}</div>
              <div>
                Fonts:{' '}
                {state.brandKnowledge?.fonts.map((font) => font.value.family).join(', ') ||
                  'None verified'}
              </div>
              <div>
                Market insights:{' '}
                {state.trendResearch?.insights.map((insight) => insight.title).join(', ') ||
                  'Not researched'}
              </div>
              <div>
                Sources:{' '}
                {[...(state.brandKnowledge?.sources ?? []), ...(state.trendResearch?.sources ?? [])]
                  .map((source) => source.label)
                  .join(', ') || 'None'}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default GuidedCreativeCopilot;
