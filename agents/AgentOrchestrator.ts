import {
  SubAgentConfig,
  SubAgentState,
  AgentFinding,
  SharedContext,
  TaskGraph,
  TaskDefinition,
  TaskType,
  OrchestratorEvent,
  generateId,
} from './types';
import { SubAgent } from './SubAgent';
import { PlannerAgent } from './PlannerAgent';
import { resolveSkillsForTask } from './skills';
import { constrainTools, getWorkerProfile, resolveWorkerProfileForTask } from './workerProfiles';
import type { CampaignBrief, Brand, ProductContext } from '../types/brand';
import type { AdConcept } from '../types/brand';
import {
  buildBrandMemoryFromBrand,
  buildRenderManifestFromSceneContracts,
  buildSceneContractsFromConcept,
  ensureVideoRenderArtifacts,
  getRenderApprovalThreshold,
  markRenderManifestReady,
} from '../services/campaignBlueprintService';
import { combineReviewFeedback, reviewSceneBindings } from '../services/reviewService';
import { buildStableProductConcept, canUseStableProductCampaign } from '../services/stableProductCampaignService';
import { planLockedProductSceneBindings } from '../services/geminiService';

export class AgentOrchestrator {
  private agents: Map<string, SubAgent> = new Map();
  private agentStates: Map<string, SubAgentState> = new Map();
  private sharedContext: SharedContext;
  private listeners: ((event: OrchestratorEvent) => void)[] = [];
  private taskGraph: TaskGraph | null = null;
  private _running = false;

  constructor() {
    this.sharedContext = this.createEmptyContext({
      rawPrompt: '',
      adFormat: 'stitched_video',
      platform: 'tiktok',
      objective: 'awareness',
      durationSec: 30,
      executionMode: 'balanced',
    });
  }

  // === PUBLIC API ===

  get isRunning(): boolean {
    return this._running;
  }

  get allAgentStates(): SubAgentState[] {
    return Array.from(this.agentStates.values());
  }

  get context(): SharedContext {
    return this.sharedContext;
  }

  get currentTaskGraph(): TaskGraph | null {
    return this.taskGraph;
  }

  onEvent(listener: (event: OrchestratorEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  async runCampaign(brief: CampaignBrief | string, brand?: Brand): Promise<AdConcept | null> {
    this._running = true;
    this.agents.clear();
    this.agentStates.clear();
    const normalizedBrief: CampaignBrief = typeof brief === 'string'
      ? {
          rawPrompt: brief,
          adFormat: 'stitched_video',
          platform: 'tiktok',
          objective: 'awareness',
          durationSec: 30,
          executionMode: 'balanced',
        }
      : brief;
    this.sharedContext = this.createEmptyContext(normalizedBrief);

    if (brand) {
      this.sharedContext.brand = brand;
      this.sharedContext.brandId = brand.id;
      if (brand.dna) {
        this.sharedContext.brandDNA = brand.dna;
      }
      this.sharedContext.brandMemory = buildBrandMemoryFromBrand(brand, normalizedBrief.productUrl);
    }

    // Extract product URL from brief
    this.sharedContext.productUrl = normalizedBrief.productUrl || brand?.websiteUrl;

    try {
      if (brand && canUseStableProductCampaign(normalizedBrief, brand)) {
        this.emit({
          type: 'phase_changed',
          phase: 'product_first',
          description: '📦 Building a product-first storyboard from the imported product shots...',
        });

        const { concept, review } = buildStableProductConcept(normalizedBrief, brand);
        this.sharedContext.adConcept = concept;
        const lockedProductContext = normalizedBrief.productContext as ProductContext | undefined;
        const deterministicContracts = buildSceneContractsFromConcept(concept, normalizedBrief, brand);
        let sceneContracts = deterministicContracts;

        if (lockedProductContext) {
          try {
            const aiPlannedContracts = await planLockedProductSceneBindings(normalizedBrief, concept, lockedProductContext);
            if (aiPlannedContracts.length > 0) {
              const aiBindingReview = reviewSceneBindings(normalizedBrief, aiPlannedContracts, brand);
              // Keep deterministic bindings when AI planning fails grounding checks —
              // otherwise Render Readiness stays blocked on an otherwise approved concept.
              if (!aiBindingReview || (aiBindingReview.mandatoryFixes?.length || 0) === 0) {
                sceneContracts = aiPlannedContracts;
              } else {
                console.warn(
                  '[Orchestrator] AI scene bindings failed grounding review; keeping deterministic product bindings',
                  aiBindingReview.mandatoryFixes,
                );
              }
            }
          } catch (error) {
            console.warn('[Orchestrator] Gemini scene binding failed, falling back to deterministic bindings', error);
          }
        }

        const sceneBindingReview = reviewSceneBindings(normalizedBrief, sceneContracts, brand);
        const effectiveReview = combineReviewFeedback(review, sceneBindingReview) || review;

        this.sharedContext.sceneContracts = sceneContracts;
        this.sharedContext.reviewHistory = [effectiveReview];
        this.finalizeRenderManifest();

        this._running = false;
        this.emit({ type: 'campaign_complete', concept });
        return concept;
      }

      // Phase 0: Planning
      this.emit({ type: 'phase_changed', phase: 'planning', description: '🧠 Planning research strategy...' });

      const planner = new PlannerAgent();
      this.taskGraph = await planner.plan(normalizedBrief, brand);

      console.log('[Orchestrator] Task graph:', JSON.stringify(this.taskGraph, null, 2));

      // Create agents for all tasks
      for (const task of this.taskGraph.tasks) {
        this.createAgent(this.buildAgentConfig(task, null, 0));
      }

      // Execute phases
      for (const phase of this.taskGraph.phases) {
        if (!this._running) break;

        if (phase.type === 'parallel') {
          this.emit({
            type: 'phase_changed',
            phase: 'research',
            description: `🔍 Researching in parallel (${phase.taskIds?.length || 0} agents)...`,
          });
          await this.executeParallel(phase.taskIds || []);
        } else if (phase.type === 'sequential') {
          const taskId = phase.taskIds?.[0];
          const task = this.taskGraph.tasks.find(t => t.id === taskId);
          this.emit({
            type: 'phase_changed',
            phase: task?.taskType || 'sequential',
            description: `${task?.goal || 'Processing...'}`,
          });
          await this.executeSequential(phase.taskIds || []);
        } else if (phase.type === 'loop') {
          this.emit({
            type: 'phase_changed',
            phase: 'review_loop',
            description: '🔄 Creative → Review iteration loop...',
          });
          await this.executeLoop(phase);
        }
      }

      // Wait for any remaining child agents
      await this.waitForAllChildren();

      // Fallback synthesis if normal flow failed and we have some findings
      if (!this.sharedContext.adConcept && Object.keys(this.sharedContext.findings).length > 0) {
        this.emit({ type: 'phase_changed', phase: 'fallback', description: '🚑 High Load: Creating safety concept...' });
        await this.runFallbackSynthesis();
      }

      this.finalizeRenderManifest();
      this._running = false;

      if (this.sharedContext.adConcept) {
        this.emit({ type: 'campaign_complete', concept: this.sharedContext.adConcept });
      }

      return this.sharedContext.adConcept;
    } catch (error: any) {
      console.error('[Orchestrator] Campaign failed:', error);
      try {
        this.finalizeRenderManifest();
      } catch (finalizeError) {
        console.warn('[Orchestrator] Failed to finalize render artifacts after error', finalizeError);
      }
      this._running = false;
      this.emit({ type: 'error', agentId: 'orchestrator', error: error.message });
      // Return a partial concept when available so the UI can still hand off a blueprint.
      return this.sharedContext.adConcept;
    }
  }

  stop() {
    this._running = false;
  }

  // === AGENT MANAGEMENT ===

  private createAgent(config: SubAgentConfig): SubAgent {
    const agent = new SubAgent(config, {
      onStatusUpdate: (agentId, updates) => {
        const state = this.agentStates.get(agentId);
        if (state) {
          Object.assign(state, updates);
          this.emit({ type: 'agent_updated', agentId, updates });
        }
      },
      onFinding: (agentId, finding) => {
        this.emit({ type: 'finding_added', agentId, finding });
      },
      onSpawnRequest: async (parentId, childConfig) => {
        return this.spawnChildAgent(parentId, childConfig);
      },
    });

    this.agents.set(config.id, agent);
    this.agentStates.set(config.id, agent.state);
    this.emit({ type: 'agent_spawned', agent: agent.state });

    return agent;
  }

  private async spawnChildAgent(
    parentId: string,
    config: { goal: string; taskType: TaskType; instructions: string; priority?: 'high' | 'normal' | 'low' }
  ): Promise<string> {
    const parent = this.agentStates.get(parentId);
    if (!parent) throw new Error(`Parent agent ${parentId} not found`);
    if (parent.depth >= 3) throw new Error('Max agent depth reached');

    const childId = `child_${generateId()}`;
    const childConfig: SubAgentConfig = {
      id: childId,
      parentId,
      taskType: config.taskType,
      goal: config.goal,
      instructions: config.instructions,
      ...this.buildAgentEnvelope(config.taskType, config.goal, config.instructions),
      depth: parent.depth + 1,
      priority: config.priority || 'normal',
      dependsOn: [],
    };

    const child = this.createAgent(childConfig);
    parent.childAgents.push(childId);

    this.emit({ type: 'child_spawned', parentId, child: child.state });

    // Execute child immediately in background
    child.run(this.sharedContext).catch(e => {
      console.error(`[Orchestrator] Child agent ${childId} failed:`, e);
    });

    return childId;
  }

  // === EXECUTION ===

  private async executeParallel(taskIds: string[]) {
    const promises = taskIds.map(async id => {
      const agent = this.agents.get(id);
      if (!agent) {
        console.warn(`[Orchestrator] Agent ${id} not found, skipping`);
        return;
      }
      await agent.run(this.sharedContext);
    });

    await Promise.allSettled(promises);
  }

  private async executeSequential(taskIds: string[]) {
    for (const id of taskIds) {
      if (!this._running) break;
      const agent = this.agents.get(id);
      if (!agent) {
        console.warn(`[Orchestrator] Agent ${id} not found, skipping`);
        continue;
      }
      await agent.run(this.sharedContext);
    }
  }

  private async executeLoop(phase: { taskIds?: string[]; condition?: string; maxIterations?: number }) {
    const executionMode = this.sharedContext.campaignBrief.executionMode;
    const maxIter = executionMode === 'fast'
      ? Math.min(phase.maxIterations || 2, 2)
      : executionMode === 'balanced'
        ? Math.min(phase.maxIterations || 3, 3)
        : (phase.maxIterations || 5);
    const approvalThreshold = getRenderApprovalThreshold(executionMode);
    const taskIds = phase.taskIds || [];

    // Loop expects [review, creative] pattern
    // First iteration: creative already ran in previous sequential phase
    // So we start by running review, then creative if needed
    const creativeId = taskIds.find(id => {
      const agent = this.agents.get(id);
      return agent?.state.taskType === 'creative';
    });

    if (!this.sharedContext.adConcept && creativeId) {
      const creativeAgent = this.agents.get(creativeId);
      if (creativeAgent) {
        this.emit({
          type: 'phase_changed',
          phase: 'creative_bootstrap',
          description: '🎬 Creating initial concept before review...',
        });
        await creativeAgent.run(this.sharedContext);
      }
    }

    for (let i = 0; i < maxIter; i++) {
      if (!this._running) break;

      this.sharedContext.currentIteration = i + 1;
      this.emit({
        type: 'iteration_started',
        iteration: i + 1,
        feedback: i === 0 ? 'First review pass' : `Revision ${i} based on feedback`,
      });

      // Run review
      const reviewId = taskIds.find(id => {
        const agent = this.agents.get(id);
        return agent?.state.taskType === 'review';
      });

      if (reviewId) {
        // Reset review agent for re-run
        const reviewAgent = this.agents.get(reviewId);
        if (reviewAgent && i > 0) {
          // Create a fresh review agent for this iteration
          const freshReviewId = `${reviewId}_iter${i}`;
          const freshAgent = this.createAgent({
            ...reviewAgent.state,
            id: freshReviewId,
            status: 'queued' as any,
          } as SubAgentConfig);
          await freshAgent.run(this.sharedContext);
        } else if (reviewAgent) {
          await reviewAgent.run(this.sharedContext);
        }
      }

      // Check the latest review
      const latestConceptReview = this.sharedContext.reviewHistory[this.sharedContext.reviewHistory.length - 1];
      const sceneBindingReview = reviewSceneBindings(
        this.sharedContext.campaignBrief,
        this.sharedContext.sceneContracts,
        this.sharedContext.brand,
      );
      const effectiveReview = combineReviewFeedback(latestConceptReview, sceneBindingReview);

      if (effectiveReview) {
        // Rebuild manifest with the same threshold as the loop.
        if (!this.sharedContext.sceneContracts.length && this.sharedContext.adConcept) {
          this.sharedContext.sceneContracts = buildSceneContractsFromConcept(
            this.sharedContext.adConcept,
            this.sharedContext.campaignBrief,
            this.sharedContext.brand,
          );
        }
        const nextManifest = buildRenderManifestFromSceneContracts(
          this.sharedContext.sceneContracts,
          this.sharedContext.campaignBrief,
          [...this.sharedContext.reviewHistory.slice(0, -1), effectiveReview],
        );
        const accepted = effectiveReview.overallScore >= approvalThreshold
          || effectiveReview.verdict === 'approved';
        this.sharedContext.renderManifest = accepted
          ? markRenderManifestReady(nextManifest)
          : nextManifest;
      }

      if (effectiveReview) {
        console.log(`[Orchestrator] Review iteration ${i + 1}: Effective score ${effectiveReview.overallScore}/10`);

        if (effectiveReview.overallScore >= approvalThreshold || effectiveReview.verdict === 'approved') {
          console.log('[Orchestrator] Concept approved! 🎉');
          this.emit({
            type: 'phase_changed',
            phase: 'approved',
            description: `✅ Concept approved with score ${effectiveReview.overallScore}/10!`,
          });
          return;
        }

        if (executionMode === 'fast') {
          this.emit({
            type: 'phase_changed',
            phase: 'draft_ready',
            description: `⚡ Fast mode returning first reviewed draft (${effectiveReview.overallScore}/10).`,
          });
          return;
        }

        // Need revision — run creative again
        if (creativeId && i < maxIter - 1) {
          this.emit({
            type: 'phase_changed',
            phase: 'revising',
            description: `📝 Revising concept (score was ${effectiveReview.overallScore}/10)...`,
          });

          // Create a fresh creative agent for revision
          const freshCreativeId = `${creativeId}_iter${i + 1}`;
          const originalCreative = this.agents.get(creativeId);
          if (originalCreative) {
            const freshCreative = this.createAgent({
              ...originalCreative.state,
              id: freshCreativeId,
              instructions: `${originalCreative.state.instructions}\n\nPREVIOUS REVIEW FEEDBACK (MUST ADDRESS):\nScore: ${effectiveReview.overallScore}/10\nMandatory Fixes: ${effectiveReview.mandatoryFixes.join('; ')}\nCritiques: ${effectiveReview.critiques.join('; ')}\nSuggestions: ${effectiveReview.suggestions.join('; ')}`,
            } as SubAgentConfig);
            await freshCreative.run(this.sharedContext);
          }
        }
      }
    }

    // If we exhausted iterations, use best concept
    console.log(`[Orchestrator] Max iterations (${maxIter}) reached. Using best concept.`);
    this.emit({
      type: 'phase_changed',
      phase: 'max_iterations',
      description: `⚡ Max iterations reached. Using best concept (score: ${this.sharedContext.reviewHistory[this.sharedContext.reviewHistory.length - 1]?.overallScore || 'N/A'}/10)`,
    });
  }

  private async waitForAllChildren() {
    // Wait for any child agents still running
    const runningChildren = Array.from(this.agentStates.values()).filter(
      a => a.status === 'running' || a.status === 'spawning'
    );

    if (runningChildren.length > 0) {
      console.log(`[Orchestrator] Waiting for ${runningChildren.length} child agents...`);
      // Simple poll wait
      let maxWait = 60000; // 60s max
      const interval = 500;
      while (maxWait > 0) {
        const stillRunning = Array.from(this.agentStates.values()).filter(
          a => a.status === 'running' || a.status === 'spawning'
        );
        if (stillRunning.length === 0) break;
        await new Promise(r => setTimeout(r, interval));
        maxWait -= interval;
      }
    }
  }

  private async runFallbackSynthesis() {
    console.log('[Orchestrator] Running fallback synthesis due to missing AdConcept.');
    const fallbackId = `fallback_${generateId()}`;
    const fallbackAgent = this.createAgent({
      id: fallbackId,
      parentId: null,
      taskType: 'creative',
      goal: 'Fallback Synthesis from partial research',
      instructions: 'The primary process stalled due to high API demand. Use ALL gathered findings in the context to synthesize a complete ad concept immediately. Ignore missing tasks. YOU MUST OUTPUT VALID JSON with the following structure: { "title": string, "hook": string, "narrative": string, "scenes": [ { "sceneNumber": number, "visualDescription": string, "imagePrompt": string, "voiceoverText": string, "onScreenText": string, "durationSec": number, "cameraMovement": string, "brandAssetRef": string, "brandImageIndex": number, "brandAssetEditAction": string } ], "musicDirection": string, "captionStyle": string, "estimatedDuration": number, "creativeRationale": string }. Prefer brandAssetRef using a stable asset ID; use brandImageIndex only as a legacy fallback.',
      ...this.buildAgentEnvelope('creative', 'Fallback Synthesis from partial research', 'Synthesize a complete ad concept from current findings.'),
      depth: 0,
      priority: 'high',
      dependsOn: [],
    });
    
    await fallbackAgent.run(this.sharedContext);
  }

  // === HELPERS ===

  /** Ensure scene contracts + renderManifest exist and reflect current review readiness. */
  private finalizeRenderManifest() {
    if (!this.sharedContext.adConcept) return;
    if (this.sharedContext.campaignBrief.adFormat === 'carousel'
      || this.sharedContext.campaignBrief.adFormat === 'static_image') {
      this.sharedContext.renderManifest = null;
      return;
    }

    const artifacts = ensureVideoRenderArtifacts({
      concept: this.sharedContext.adConcept,
      brief: this.sharedContext.campaignBrief,
      brand: this.sharedContext.brand,
      sceneContracts: this.sharedContext.sceneContracts,
      reviewHistory: this.sharedContext.reviewHistory,
    });
    this.sharedContext.sceneContracts = artifacts.sceneContracts;

    // Match executeLoop approval: score/verdict acceptance clears export blockers so
    // Render Readiness does not stay "blocked" after the agency accepts a draft.
    const threshold = getRenderApprovalThreshold(this.sharedContext.campaignBrief.executionMode);
    const latestReview = this.sharedContext.reviewHistory[this.sharedContext.reviewHistory.length - 1];
    const accepted = Boolean(
      latestReview
      && (latestReview.overallScore >= threshold || latestReview.verdict === 'approved'),
    );
    this.sharedContext.renderManifest = accepted
      ? markRenderManifestReady(artifacts.renderManifest)
      : artifacts.renderManifest;
  }

  private createEmptyContext(campaignBrief: CampaignBrief): SharedContext {
    return {
      brief: campaignBrief.rawPrompt,
      campaignBrief,
      adFormat: campaignBrief.adFormat,
      findings: {},
      brandMemory: null,
      intentAnalysis: null,
      brandDNA: null,
      adConcept: null,
      sceneContracts: [],
      renderManifest: null,
      reviewHistory: [],
      generatedAssets: [],
      currentIteration: 0,
      maxIterations: 5,
      totalTokensUsed: 0,
    };
  }

  private buildAgentConfig(task: TaskDefinition, parentId: string | null, depth: number): SubAgentConfig {
    return {
      id: task.id,
      parentId,
      taskType: task.taskType,
      goal: task.goal,
      instructions: task.instructions,
      ...this.buildAgentEnvelope(
        task.taskType,
        task.goal,
        task.instructions,
        task.workerProfile,
        task.requiredSkills,
        task.allowedTools,
        task.readsFrom,
        task.writesTo,
        task.outputSchema,
      ),
      depth,
      priority: task.priority,
      dependsOn: task.dependsOn,
    };
  }

  private buildAgentEnvelope(
    taskType: TaskType,
    goal: string,
    _instructions: string,
    workerProfileId?: TaskDefinition['workerProfile'],
    requiredSkills?: TaskDefinition['requiredSkills'],
    allowedTools?: TaskDefinition['allowedTools'],
    readsFrom?: string[],
    writesTo?: string[],
    outputSchema?: string,
  ) {
    const resolvedProfileId = workerProfileId || resolveWorkerProfileForTask(taskType);
    const workerProfile = getWorkerProfile(resolvedProfileId);
    const loadedSkills = requiredSkills?.length
      ? requiredSkills
      : resolveSkillsForTask(taskType, this.sharedContext.campaignBrief);

    return {
      assignedBy: 'orchestrator' as const,
      workerProfile: resolvedProfileId,
      model: workerProfile.defaultModel,
      loadedSkills,
      allowedTools: constrainTools(allowedTools, workerProfile),
      readScopes: readsFrom?.length ? readsFrom : workerProfile.defaultReadScopes,
      writeScopes: writesTo?.length ? writesTo : workerProfile.defaultWriteScopes,
      hardConstraints: [
        ...workerProfile.hardConstraints,
        `Primary objective: ${goal}`,
      ],
      outputSchema: outputSchema || this.defaultOutputSchema(taskType),
    };
  }

  private defaultOutputSchema(taskType: TaskType): string {
    switch (taskType) {
      case 'brand_synthesis':
        return 'Valid JSON BrandDNA object with visual, messaging, audience, product, and market fields.';
      case 'creative':
        return 'Valid JSON AdConcept object with title, hook, scenes, durations, and creative rationale.';
      case 'review':
        return 'Valid JSON review object with overallScore, verdict, critiques, mandatoryFixes, and suggestions.';
      default:
        return 'Structured findings plus a concise SUMMARY section.';
    }
  }

  private emit(event: OrchestratorEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('[Orchestrator] Event listener error:', e);
      }
    }
  }
}
