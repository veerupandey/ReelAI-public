import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
import {
  SubAgentConfig,
  SubAgentState,
  AgentFinding,
  SharedContext,
  TaskType,
  generateId,
  taskTypeEmoji,
} from './types';
import { validateTaskContract } from './contracts';
import { renderSkillGuidance } from './skills';
import { getWorkerProfile } from './workerProfiles';
import { usageTracker } from '../utils/usageTracker';
import {
  buildBrandMemoryFromBrand,
  buildRenderManifestFromSceneContracts,
  buildSceneContractsFromConcept,
  getRenderApprovalThreshold,
  isExportReviewReady,
  markRenderManifestReady,
} from '../services/campaignBlueprintService';

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY || '' });
const FALLBACK_MODEL = import.meta.env.VITE_SUBAGENT_MODEL || 'gemini-3.8-flash';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function retryCall<T>(fn: () => Promise<T>, retries = 3, backoff = 2000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const isQuota =
      error.status === 429 ||
      error.code === 429 ||
      error.status === 500 ||
      error.status === 503 ||
      error.message?.includes('RESOURCE_EXHAUSTED') ||
      error.message?.includes('High Demand') ||
      error.message?.includes('429');
    if (isQuota && retries > 0) {
      console.warn(`[SubAgent] Service busy or quota hit, retrying in ${backoff}ms (${retries} left)`);
      await wait(backoff);
      return retryCall(fn, retries - 1, backoff * 1.5);
    }
    throw error;
  }
}

// System prompt templates per task type
const SYSTEM_PROMPTS: Record<TaskType, string> = {
  web_search: `You are a thorough web research agent. Your job is to deeply research a topic using search.
Find specific facts, data, quotes, images described, and insights. Be detailed and cite sources.
Structure your findings clearly with headers and bullet points.`,

  social_analysis: `You are a social media intelligence analyst. Your job is to analyze a brand's social media presence.
Look at their posting patterns, visual aesthetic, engagement tactics, hashtag strategy, and content pillars.
Be specific — describe actual posts you find, not generic advice.`,

  competitor_study: `You are a competitive intelligence analyst for advertising. Your job is to study how specific brands create ads.
Analyze their ad formats, hooks, visual styles, messaging strategies, and what makes them effective.
Focus on concrete examples and actionable patterns.`,

  market_research: `You are a market research specialist. Your job is to understand a target market deeply.
Research demographics, buying behavior, cultural preferences, trends, and regulatory considerations.
Provide actionable insights, not generic demographics.`,

  brand_synthesis: `You are a brand strategist. Your job is to synthesize multiple research findings into a cohesive Brand DNA profile.
Create a complete brand identity including visual identity, messaging, positioning, and personality.
Every element must be grounded in the research findings provided.`,

  creative: `You are a Disney Imagineer. Your job is to create advertising that transports viewers into immersive, imaginative worlds.
Think like the creative minds behind Disney theme parks, Pixar films, and Apple product reveals.
Build the world first: create a sense of wonder, emotional journey, and memorable "moments of delight" that make viewers smile.
Then weave the product naturally into the narrative as a meaningful part of the story — never as a hard sell.
Surprise the audience with unexpected visual poetry. Every scene should feel like a tiny world viewers want to step into.
Balance imagination with clarity: the product should feel like a natural, desirable part of this world.`,

  review: `You are the harshest, most demanding ad critic in the industry. Think of yourself as the Gordon Ramsay of advertising.
Score concepts ruthlessly on a 1-10 scale across multiple dimensions.
Only give 9+ to truly exceptional work. Provide specific, actionable fixes for anything below 9.
Your job is to push the creative team to produce award-winning work.`,

  image_gen: `You are a visual art director. Your job is to create precise, detailed image generation prompts
that produce stunning, brand-consistent visuals for video ads.`,

  video_production: `You are a video production engineer. Your job is to assemble scene clips, voiceover audio, and captions into a final MP4.
Use ffmpeg for video assembly, Python PIL for caption rendering. Always use absolute file paths. Preserve product identity exactly.`,

  custom: `You are a specialist agent. Follow your specific instructions carefully and report findings in detail.`,
};

export interface SubAgentCallbacks {
  onStatusUpdate: (agentId: string, updates: Partial<SubAgentState>) => void;
  onFinding: (agentId: string, finding: AgentFinding) => void;
  onSpawnRequest: (parentId: string, config: {
    goal: string;
    taskType: TaskType;
    instructions: string;
    priority?: 'high' | 'normal' | 'low';
  }) => Promise<string>; // returns child agent ID
}

export class SubAgent {
  public state: SubAgentState;
  private callbacks: SubAgentCallbacks;

  constructor(config: SubAgentConfig, callbacks: SubAgentCallbacks) {
    this.callbacks = callbacks;
    this.state = {
      ...config,
      contractVersion: '1',
      status: 'queued',
      progress: 0,
      statusText: 'Waiting to start...',
      displayName: `${taskTypeEmoji[config.taskType] || '🔧'} ${config.goal.slice(0, 50)}`,
      emoji: taskTypeEmoji[config.taskType] || '🔧',
      findings: [],
      childAgents: [],
      tokenUsage: { input: 0, output: 0 },
    };
  }

  private updateStatus(updates: Partial<SubAgentState>) {
    Object.assign(this.state, updates);
    this.callbacks.onStatusUpdate(this.state.id, updates);
  }

  private addFinding(type: AgentFinding['type'], title: string, content: string, confidence = 0.8, data?: any) {
    const finding: AgentFinding = {
      id: generateId(),
      agentId: this.state.id,
      timestamp: Date.now(),
      type, title, content, confidence, data,
    };
    this.state.findings.push(finding);
    this.callbacks.onFinding(this.state.id, finding);
    return finding;
  }

  async run(sharedContext: SharedContext): Promise<AgentFinding[]> {
    this.updateStatus({
      status: 'running',
      progress: 10,
      statusText: `Starting: ${this.state.goal}`,
      startedAt: Date.now(),
    });

    try {
      const workerProfile = getWorkerProfile(this.state.workerProfile);
      const contractValidation = validateTaskContract(
        {
          contractVersion: '1',
          taskId: this.state.id,
          parentTaskId: this.state.parentId,
          assignedBy: this.state.assignedBy,
          executionMode: sharedContext.campaignBrief.executionMode,
          workerProfile: this.state.workerProfile,
          objective: this.state.goal,
          loadedSkills: this.state.loadedSkills,
          allowedTools: this.state.allowedTools,
          readScopes: this.state.readScopes,
          writeScopes: this.state.writeScopes,
          hardConstraints: this.state.hardConstraints,
          outputSchema: this.state.outputSchema,
        },
        workerProfile,
      );
      if (!contractValidation.valid) {
        throw new Error(`Task contract rejected: ${contractValidation.errors.join(' ')}`);
      }

      // Build the prompt
      const prompt = this.buildPrompt(sharedContext);
      const useSearch = this.state.allowedTools.includes('web_search');

      this.updateStatus({
        progress: 30,
        statusText: useSearch ? `Searching the web: ${this.state.goal}` : `Analyzing: ${this.state.goal}`,
      });

      const imageParts: any[] = [];
      const shouldAttachBrandAssets =
        this.state.allowedTools.includes('image_analysis')
        && ['brand_synthesis', 'creative', 'image_gen'].includes(this.state.taskType);

      if (shouldAttachBrandAssets && sharedContext.brand?.assets && sharedContext.brand.assets.length > 0) {
        sharedContext.brand.assets.forEach(asset => {
          if (asset.base64) {
            try {
              const base64Data = asset.base64.includes(',') ? asset.base64.split(',')[1] : asset.base64;
              imageParts.push({
                inlineData: {
                  data: base64Data,
                  mimeType: asset.mimeType || 'image/jpeg'
                }
              });
            } catch (e) {
               console.error('[SubAgent] Failed to parse asset base64', e);
            }
          }
        });
      }

      // Call Gemini
      const response = await this.callGemini(prompt, useSearch, imageParts);
      const responseText = response.text || '';

      // Track tokens
      const inputTokens = response.usageMetadata?.promptTokenCount || 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
      this.state.tokenUsage.input += inputTokens;
      this.state.tokenUsage.output += outputTokens;
      sharedContext.totalTokensUsed += inputTokens + outputTokens;
      usageTracker.trackTokens(`Agent:${this.state.taskType}`, inputTokens, outputTokens);

      this.updateStatus({ progress: 60, statusText: 'Processing findings...' });

      // Parse findings from response
      const findings = this.parseFindings(responseText);

      // Check for spawn requests
      const spawnRequests = this.parseSpawnRequests(responseText);
      const canRequestChildren = workerProfile.canSpawnChildren && this.state.allowedTools.includes('subagent_request');
      if (spawnRequests.length > 0 && this.state.depth < 3 && canRequestChildren) {
        this.updateStatus({ progress: 70, statusText: `Spawning ${spawnRequests.length} sub-agents...` });

        for (const req of spawnRequests) {
          try {
            const childId = await this.callbacks.onSpawnRequest(this.state.id, req);
            this.state.childAgents.push(childId);
          } catch (e) {
            console.warn(`[SubAgent] Failed to spawn child: ${e}`);
          }
        }
      }

      // Store structured data based on task type
      this.storeToContext(sharedContext, responseText, findings);

      this.updateStatus({
        status: 'complete',
        progress: 100,
        statusText: `Complete: ${findings.length} findings`,
        completedAt: Date.now(),
      });

      return this.state.findings;
    } catch (error: any) {
      console.error(`[SubAgent:${this.state.id}] Error:`, error);
      this.updateStatus({
        status: 'error',
        progress: 100,
        statusText: `Error: ${error.message?.slice(0, 100)}`,
        error: error.message,
        completedAt: Date.now(),
      });
      this.addFinding('warning', 'Agent Error', error.message, 0.5);
      return this.state.findings;
    }
  }

  private buildPrompt(ctx: SharedContext): string {
    const systemPrompt = SYSTEM_PROMPTS[this.state.taskType];
    const contextSummary = this.buildContextSummary(ctx);
    const skillGuidance = renderSkillGuidance(this.state.loadedSkills);
    const allowedTools = this.state.allowedTools.join(', ') || 'none';
    const hardConstraints = this.state.hardConstraints.map((item) => `- ${item}`).join('\n');

    let spawnInstructions = '';
    if (this.state.allowedTools.includes('subagent_request') && this.state.depth < 3) {
      spawnInstructions = `
IMPORTANT: If during your research you discover a topic that needs deeper investigation,
you can request spawning a child agent by including this EXACTLY in your response:

SPAWN_AGENT: {"goal": "description of what to research", "taskType": "web_search", "instructions": "detailed instructions"}

You can include multiple SPAWN_AGENT blocks. Available taskTypes: web_search, social_analysis, competitor_study, market_research, custom.
Only spawn if genuinely needed — don't over-decompose simple tasks.`;
    }

    return `${systemPrompt}

=== YOUR TASK ===
Goal: ${this.state.goal}

Instructions: ${this.state.instructions}

=== TASK CONTRACT ===
- Assigned by: ${this.state.assignedBy}
- Worker profile: ${this.state.workerProfile}
- Model: ${this.state.model}
- Allowed tools: ${allowedTools}
- Read scopes: ${this.state.readScopes.join(', ') || 'none'}
- Write scopes: ${this.state.writeScopes.join(', ') || 'none'}
- Output schema: ${this.state.outputSchema}

=== ACTIVE SKILLS ===
${skillGuidance || '- No explicit skills loaded'}

=== HARD CONSTRAINTS ===
${hardConstraints || '- None'}

${contextSummary ? `=== EXISTING CONTEXT (from other agents) ===\n${contextSummary}` : ''}

${spawnInstructions}

=== OUTPUT FORMAT ===
Structure your response with clear sections. Use these markers for key findings:

FINDING: [type] Title — Content
(type can be: data, insight, asset, recommendation, warning)

Example:
FINDING: data Brand Colors — Primary: #2D5F3E (forest green), Secondary: #F5E6D3 (warm cream)
FINDING: insight Content Strategy — The brand posts 3x/week with a focus on ingredient education

At the end, provide a SUMMARY section with the most important takeaways.

SUMMARY:
- Key point 1
- Key point 2
`;
  }

  private buildContextSummary(ctx: SharedContext): string {
    const parts: string[] = [];

    if (ctx.brief) parts.push(`Campaign Brief: ${ctx.brief}`);
    parts.push(`Platform: ${ctx.campaignBrief.platform}`);
    parts.push(`Objective: ${ctx.campaignBrief.objective}`);
    if (ctx.campaignBrief.durationSec) parts.push(`Duration Target: ${ctx.campaignBrief.durationSec}s`);
    parts.push(`Ad Format: ${ctx.adFormat}`);
    parts.push(`Execution Mode: ${ctx.campaignBrief.executionMode}`);
    if (ctx.productUrl) parts.push(`Product URL: ${ctx.productUrl}`);
    if (ctx.intentAnalysis) {
      parts.push(`Intent: ${ctx.intentAnalysis.adType} ad for ${ctx.intentAnalysis.productFocus} targeting ${ctx.intentAnalysis.targetMarket}`);
    }

    if (ctx.brand && ctx.brand.assets && ctx.brand.assets.length > 0) {
      parts.push(`\n=== ATTACHED BRAND ASSETS ===`);
      parts.push(`The user has provided ${ctx.brand.assets.length} visual assets which are attached visually to this prompt in the exact order below.`);
      ctx.brand.assets.forEach((asset, idx) => {
        parts.push(`[Asset ID ${asset.id} | Legacy Index ${idx}]: ${asset.type} - "${asset.description}"`);
      });
      parts.push(`When creating scenes, prefer brandAssetRef using the stable Asset ID. Use brandImageIndex only as a legacy fallback if needed.`);
      if (ctx.productUrl) {
        parts.push(`This campaign is for a specific product URL. The attached product assets are the required visual anchor.`);
        if (ctx.campaignBrief.executionMode === 'agency') {
          parts.push(`In Agency Mode, prioritize the narrative arc and sensual vibe. Use product assets where they naturally fit the story, but don't hesitate to recommend new, high-end 'imagined' shots to maintain the premium feel.`);
        } else {
          parts.push(`At least half of the scenes must visibly feature the actual product or a continuity edit of it.`);
        }
        parts.push(`Do not replace the product with abstract nature, forest, texture, or ingredient-only imagery unless the product is still clearly present and recognizable.`);
      }
    }

    // Include findings from other agents (summarized)
    const otherFindings = Object.entries(ctx.findings)
      .filter(([agentId]) => agentId !== this.state.id)
      .flatMap(([, findings]) => findings)
      .slice(0, 20); // Limit to prevent token overflow

    if (otherFindings.length > 0) {
      parts.push('Findings from other agents:');
      for (const f of otherFindings) {
        parts.push(`  - [${f.type}] ${f.title}: ${f.content.slice(0, 200)}`);
      }
    }

    if (ctx.brandDNA) {
      parts.push(`Brand DNA (already synthesized): ${JSON.stringify(ctx.brandDNA).slice(0, 500)}`);
    }

    if (ctx.brandMemory) {
      parts.push(`Brand Memory Summary: ${JSON.stringify({
        name: ctx.brandMemory.name,
        approvedClaims: ctx.brandMemory.approvedClaims.slice(0, 6),
        evidenceSummary: ctx.brandMemory.evidenceSummary.slice(0, 6),
        assetCount: ctx.brandMemory.assets.length,
      }).slice(0, 500)}`);
    }

    if (ctx.sceneContracts.length > 0) {
      parts.push(`Scene Contracts: ${ctx.sceneContracts.length} scenes planned.`);
    }

    if (ctx.reviewHistory.length > 0) {
      const latest = ctx.reviewHistory[ctx.reviewHistory.length - 1];
      parts.push(`Latest Review Score: ${latest.overallScore}/10`);
      parts.push(`Mandatory Fixes: ${latest.mandatoryFixes.join('; ')}`);
    }

    return parts.join('\n');
  }

  private parseFindings(text: string): AgentFinding[] {
    const findings: AgentFinding[] = [];
    const findingRegex = /FINDING:\s*(\w+)\s+(.+?)\s*—\s*(.+?)(?=\nFINDING:|\nSUMMARY:|\nSPAWN_AGENT:|\n\n|$)/gs;

    let match;
    while ((match = findingRegex.exec(text)) !== null) {
      const [, type, title, content] = match;
      const validTypes = ['data', 'insight', 'asset', 'recommendation', 'warning'] as const;
      const findingType = validTypes.includes(type as any) ? (type as AgentFinding['type']) : 'data';
      this.addFinding(findingType, title.trim(), content.trim());
      findings.push(this.state.findings[this.state.findings.length - 1]);
    }

    if (this.state.findings.length === 0 && text.trim().length > 50) {
      const summaryMatch = text.match(/SUMMARY:\s*([\s\S]+?)$/i);
      const summaryText = summaryMatch ? summaryMatch[1].trim() : text.slice(0, 500);
      const f = this.addFinding('data', `${this.state.goal} — Results`, summaryText, 0.7);
      findings.push(f);
    }

    return findings;
  }

  private parseSpawnRequests(text: string): { goal: string; taskType: TaskType; instructions: string; priority?: 'high' | 'normal' | 'low' }[] {
    const requests: any[] = [];
    const spawnRegex = /SPAWN_AGENT:\s*(\{[\s\S]*?\})/g;

    let match;
    while ((match = spawnRegex.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.goal && parsed.taskType) {
          requests.push({
            goal: parsed.goal,
            taskType: parsed.taskType as TaskType,
            instructions: parsed.instructions || parsed.goal,
            priority: parsed.priority || 'normal',
          });
        }
      } catch {
        // Failed to parse spawn request, skip
      }
    }

    return requests.slice(0, 3); // Max 3 children per agent
  }

  private storeToContext(ctx: SharedContext, responseText: string, _findings: AgentFinding[]) {
    // Store findings in shared context
    if (!ctx.findings[this.state.id]) {
      ctx.findings[this.state.id] = [];
    }
    ctx.findings[this.state.id] = [...this.state.findings];

    // Task-type-specific structured storage
    if (this.state.taskType === 'brand_synthesis') {
      try {
        const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/) || responseText.match(/\{[\s\S]*"colors"[\s\S]*\}/);
        if (jsonMatch) {
          const raw = jsonMatch[1] || jsonMatch[0];
          const dna = JSON.parse(raw.replace(/```json|```/g, ''));
          if (dna && (dna.colors || dna.brandVoice || dna.aesthetic)) {
            ctx.brandDNA = dna;
            const evidenceSummary = Object.values(ctx.findings)
              .flat()
              .slice(0, 8)
              .map((finding) => `${finding.title}: ${finding.content.slice(0, 160)}`);
            const baseMemory = buildBrandMemoryFromBrand(ctx.brand, ctx.productUrl, evidenceSummary);
            ctx.brandMemory = {
              ...(baseMemory || {
                name: ctx.brand?.name || 'Ad hoc brand',
                assets: [],
                approvedClaims: [],
                evidenceSummary,
              }),
              dna,
              approvedClaims: dna.valuePropositions || baseMemory?.approvedClaims || [],
              evidenceSummary,
            };
          }
        }
      } catch { /* non-JSON response, use findings */ }
    }

    if (this.state.taskType === 'creative') {
      try {
        const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/) || responseText.match(/\{[\s\S]*"scenes"[\s\S]*\}/);
        if (jsonMatch) {
          const raw = jsonMatch[1] || jsonMatch[0];
          const concept = JSON.parse(raw.replace(/```json|```/g, ''));
          if (concept && concept.scenes) {
            ctx.adConcept = concept;
            ctx.sceneContracts = buildSceneContractsFromConcept(concept, ctx.campaignBrief, ctx.brand);
            ctx.renderManifest = buildRenderManifestFromSceneContracts(
              ctx.sceneContracts,
              ctx.campaignBrief,
              ctx.reviewHistory,
            );
          }
        }
      } catch { /* non-JSON response, use findings */ }
    }

    if (this.state.taskType === 'review') {
      try {
        const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/) || responseText.match(/\{[\s\S]*"overallScore"[\s\S]*\}/);
        if (jsonMatch) {
          const raw = jsonMatch[1] || jsonMatch[0];
          const review = JSON.parse(raw.replace(/```json|```/g, ''));
          if (review && typeof review.overallScore === 'number') {
            ctx.reviewHistory.push({
              stage: 'concept',
              ...review,
            });
            if (ctx.renderManifest) {
              const threshold = getRenderApprovalThreshold(ctx.campaignBrief.executionMode);
              const stagedReview = {
                stage: 'concept' as const,
                ...review,
              };
              ctx.renderManifest = isExportReviewReady(stagedReview, threshold)
                ? markRenderManifestReady(ctx.renderManifest)
                : {
                    ...ctx.renderManifest,
                    exportStatus: 'blocked' as const,
                    blockers: review.mandatoryFixes?.length
                      ? review.mandatoryFixes
                      : [`Concept scored ${review.overallScore}/10; needs ${threshold}+ or approval before export.`],
                  };
            }
          }
        }
      } catch { /* non-JSON response */ }
    }
  }

  private async callGemini(prompt: string, useSearch: boolean, imageParts: any[] = []): Promise<GenerateContentResponse> {
    const model = this.state.model || FALLBACK_MODEL;
    const config: any = model.startsWith('gemini-3.8-flash') ? {} : {
      temperature: this.state.taskType === 'creative' ? 0.8 : this.state.taskType === 'review' ? 0.3 : 0.4,
    };

    if (useSearch) {
      config.tools = [{ googleSearch: {} }];
    }

    const contents = [{ parts: [{ text: prompt }, ...imageParts] }];

    return retryCall(() =>
      ai.models.generateContent({
        model,
        contents,
        config,
      })
    );
  }
}
