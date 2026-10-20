import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
import { TaskGraph, TaskDefinition, generateId } from './types';
import type { Brand, CampaignBrief } from '../types/brand';
import { usageTracker } from '../utils/usageTracker';

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY || '' });
const ORCHESTRATOR_MODEL = import.meta.env.VITE_ORCHESTRATOR_MODEL || 'gemini-2.5-pro';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function retryCall<T>(fn: () => Promise<T>, retries = 5, backoff = 2000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const isQuota = 
      error.status === 429 || 
      error.code === 429 || 
      error.status === 500 ||
      error.status === 503 ||
      error.message?.includes('429');
    if (isQuota && retries > 0) {
      console.warn(`[PlannerAgent] Service busy or quota hit, retrying in ${backoff}ms (${retries} left)`);
      await wait(backoff);
      return retryCall(fn, retries - 1, backoff * 1.5);
    }
    throw error;
  }
}

export class PlannerAgent {
  async plan(campaignBrief: CampaignBrief, brand?: Brand): Promise<TaskGraph> {
    const brief = campaignBrief.rawPrompt;
    const brandContext = brand?.dna
      ? `Existing brand data available: "${brand.name}" (${brand.websiteUrl}). Brand DNA already researched — may need updating or can skip basic research.`
      : brand?.websiteUrl
        ? `Brand website known: ${brand.websiteUrl} — needs full research.`
        : 'No brand context. Infer brand from the brief.';
    const targetSceneCount = getTargetSceneCount(campaignBrief.durationSec || 30);
    const researchBudget = campaignBrief.executionMode === 'fast'
      ? 'Lean research only. Prioritize speed and the minimum viable context.'
      : campaignBrief.executionMode === 'agency'
        ? 'Go deep. Expand research breadth, competitor coverage, and strategic rationale.'
        : 'Balanced research. Be thorough, but avoid slow research for marginal gains.';

    const prompt = `
You are the Chief Strategist of an AI ad agency. Your job is to plan what research and creative work needs to happen to create an award-winning ad.

=== CLIENT BRIEF ===
"${brief}"

=== CAMPAIGN PARAMETERS ===
- Platform: ${campaignBrief.platform}
- Objective: ${campaignBrief.objective}
- Ad Format: ${campaignBrief.adFormat}
- Duration: ${campaignBrief.durationSec || 'N/A (non-video format)'} seconds
- Execution Mode: ${campaignBrief.executionMode}
- Target Scene Count: ${targetSceneCount}
- Audience: ${campaignBrief.audience || 'Not specified'}
- Tone: ${campaignBrief.tone || 'Not specified'}
- CTA: ${campaignBrief.callToAction || 'Not specified'}
- Constraints: ${(campaignBrief.constraints || []).join('; ') || 'None provided'}

=== BRAND CONTEXT ===
${brandContext}

=== RESEARCH BUDGET ===
${researchBudget}

=== YOUR TASK ===
Create a TASK GRAPH — a list of research and creative tasks that sub-agents will execute.

Available task types:
- web_search: Research a website, topic, or URL via Google Search. Use this to find real data.
- social_analysis: Analyze a brand's social media presence (Instagram, TikTok, YouTube).
- competitor_study: Study how a specific competitor brand creates ads and markets products.
- market_research: Research a target market, demographics, cultural preferences, buying behavior.
- brand_synthesis: (Run AFTER research) Combine all research into a structured Brand DNA.
- creative: (Run AFTER synthesis) Create the actual ad concept and storyboard.
- review: (Run AFTER creative) Review and score the concept. Will loop with creative until score >= 9/10.
- custom: Any specialized task not covered above.

Rules:
1. Be THOROUGH. A real ad agency would do extensive research before creating anything.
2. Research tasks (web_search, social_analysis, competitor_study, market_research) run in PARALLEL.
3. brand_synthesis depends on ALL research completing first.
4. creative depends on brand_synthesis.
5. review loops with creative until quality is high enough.
6. Include SPECIFIC competitor names relevant to the brand's industry.
7. If a product URL is mentioned, add a dedicated agent to research it deeply.
8. If a region/market is mentioned or implied, add market research.
9. Add any "extra" tasks you think a top-tier agency would do (e.g., "award winning ads in this category", "color psychology for the product type", etc.).
10. Each task should have DETAILED instructions telling the agent exactly what to look for.
11. Respect execution mode:
   - fast: 2-3 core research tasks max before synthesis
   - balanced: 3-5 research tasks max before synthesis
   - agency: 5+ research tasks allowed when justified, and they should cover brand, product, market, competitors, category-winning creative, and asset/scene opportunities in parallel
12. Creative output must respect the target duration and scene count. Do not overproduce scenes.
13. In agency mode, explicitly plan for:
   - a cohesive, sensual narrative arc that builds a world first
   - which existing imported product assets naturally fit specific beats in that story
   - where to recommend 'imagined' shots (new generations) to enhance the story's visual quality
   - optional additive scenes that reinforce the sensual vibe without breaking the main flow

Return ONLY valid JSON:
{
  "reasoning": "Strategic rationale for chosen tasks...",
  "tasks": [
    {
      "id": "t1",
      "taskType": "web_search",
      "goal": "Research bareandfair.ca brand identity and story",
      "instructions": "Visit bareandfair.ca. Find: brand name, tagline, mission, founding story, core values, certifications, shipping info. Describe the visual aesthetic of the website. List all products you can find.",
      "priority": "high",
      "dependsOn": []
    },
    {
      "id": "t_synthesize",
      "taskType": "brand_synthesis",
      "goal": "Create comprehensive Brand DNA from all research",
      "instructions": "Synthesize all research agent findings into a structured Brand DNA JSON with: colors, typography, aesthetic, brandVoice, tagline, valuePropositions, targetAudience, products, keyIngredients, instagramAesthetic, competitorInsights, differentiators, marketPosition.",
      "priority": "high",
      "dependsOn": ["t1", "t2", "t3", "...all research task IDs"]
    },
    {
      "id": "t_creative",
      "taskType": "creative",
      "goal": "Create award-winning ad concept",
      "instructions": "Using the Brand DNA and all research, create a stunning ad concept...",
      "priority": "high",
      "dependsOn": ["t_synthesize"]
    },
    {
      "id": "t_review",
      "taskType": "review",
      "goal": "Review and score ad concept",
      "instructions": "Score the concept 1-10. Be harsh. Only 9+ passes.",
      "priority": "high",
      "dependsOn": ["t_creative"]
    }
  ],
  "phases": [
    { "type": "parallel", "taskIds": ["t1", "t2", "t3", "t4", "t5"] },
    { "type": "sequential", "taskIds": ["t_synthesize"] },
    { "type": "sequential", "taskIds": ["t_creative"] },
    { "type": "loop", "taskIds": ["t_review", "t_creative"], "condition": "score >= 9", "maxIterations": 5 }
  ]
}`;

    const response = await retryCall<GenerateContentResponse>(() =>
      ai.models.generateContent({
        model: ORCHESTRATOR_MODEL,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.5,
        },
      })
    );

    usageTracker.trackTokens(
      'PlannerAgent',
      response.usageMetadata?.promptTokenCount || 0,
      response.usageMetadata?.candidatesTokenCount || 0
    );

    const raw = (response.text || '{}').replace(/```json|```/g, '');
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error('[PlannerAgent] Failed to parse task graph:', raw);
      return this.getFallbackTaskGraph(campaignBrief);
    }

    // Validate and fix the task graph
    if (!parsed.tasks || !Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
      return this.getFallbackTaskGraph(campaignBrief);
    }

    // Ensure IDs are unique
    const usedIds = new Set<string>();
    for (const task of parsed.tasks) {
      if (!task.id || usedIds.has(task.id)) {
        task.id = `t_${generateId()}`;
      }
      usedIds.add(task.id);
    }

    if (campaignBrief.executionMode === 'fast') {
      parsed.tasks = this.pruneFastModeResearchTasks(parsed.tasks, campaignBrief);
    }

    // Ensure synthesis, creative, and review tasks exist
    const hasType = (type: string) => parsed.tasks.some((t: TaskDefinition) => t.taskType === type);

    const researchIds = parsed.tasks
      .filter((t: TaskDefinition) => ['web_search', 'social_analysis', 'competitor_study', 'market_research', 'custom'].includes(t.taskType))
      .map((t: TaskDefinition) => t.id);

    if (!hasType('brand_synthesis')) {
      parsed.tasks.push({
        id: 't_synthesize',
        taskType: 'brand_synthesis',
        goal: 'Synthesize all research into Brand DNA',
        instructions: 'Combine all research findings into a comprehensive Brand DNA profile. Output as JSON with: colors, typography, aesthetic, brandVoice, tagline, valuePropositions, targetAudience, products, keyIngredients, competitorInsights, differentiators, marketPosition, visualSignature.',
        priority: 'high',
        dependsOn: researchIds,
      });
    }

    if (!hasType('creative')) {
      const synthId = parsed.tasks.find((t: TaskDefinition) => t.taskType === 'brand_synthesis')?.id || 't_synthesize';
      parsed.tasks.push({
        id: 't_creative',
        taskType: 'creative',
        goal: 'Create award-winning ad concept and storyboard',
        instructions: `Using Brand DNA and all research, create a scene-by-scene ad concept for a ${campaignBrief.durationSec}s ${campaignBrief.platform} ad. Target ${targetSceneCount} scenes. Focus on a cohesive, sensual narrative arc first. For each scene, explicitly decide whether to use an existing imported product asset, edit one, or recommend a new 'imagined' shot to enhance the story's visual quality. Output JSON with: title, hook, narrativeArc (summarize the story), scenes (array with sceneNumber, visualDescription, imagePrompt, voiceoverText, onScreenText, durationSec, cameraMovement, brandAssetRef, brandImageIndex, brandAssetEditAction), musicDirection, captionStyle, estimatedDuration, creativeRationale.`,
        priority: 'high',
        dependsOn: [synthId],
      });
    }

    if (!hasType('review')) {
      const creativeId = parsed.tasks.find((t: TaskDefinition) => t.taskType === 'creative')?.id || 't_creative';
      parsed.tasks.push({
        id: 't_review',
        taskType: 'review',
        goal: 'Review and score ad concept for award-worthiness',
        instructions: 'Score the ad concept 1-10 on: brandConsistency, hookStrength, narrativeFlow, visualImpact, marketFit, and overall. Only give 9+ to truly exceptional work. Output JSON with: overallScore, brandConsistency, hookStrength, narrativeFlow, visualImpact, marketFit, verdict ("approved" or "needs_revision"), critiques, mandatoryFixes, suggestions.',
        priority: 'high',
        dependsOn: [creativeId],
      });
    }

    // Ensure phases exist
    if (!parsed.phases || !Array.isArray(parsed.phases) || parsed.phases.length === 0) {
      const synthTask = parsed.tasks.find((t: TaskDefinition) => t.taskType === 'brand_synthesis');
      const creativeTask = parsed.tasks.find((t: TaskDefinition) => t.taskType === 'creative');
      const reviewTask = parsed.tasks.find((t: TaskDefinition) => t.taskType === 'review');

      parsed.phases = [
        { type: 'parallel', taskIds: researchIds },
        { type: 'sequential', taskIds: [synthTask?.id || 't_synthesize'] },
        { type: 'sequential', taskIds: [creativeTask?.id || 't_creative'] },
        {
          type: 'loop',
          taskIds: [reviewTask?.id || 't_review', creativeTask?.id || 't_creative'],
          condition: 'score >= 9',
          maxIterations: 5,
        },
      ];
    }

    parsed.tasks = this.normalizeTaskDependencies(parsed.tasks);
    parsed.phases = this.normalizePhases(parsed.phases, parsed.tasks);

    return parsed as TaskGraph;
  }

  private pruneFastModeResearchTasks(tasks: TaskDefinition[], campaignBrief: CampaignBrief): TaskDefinition[] {
    const researchTypes = new Set<TaskDefinition['taskType']>([
      'web_search',
      'social_analysis',
      'competitor_study',
      'market_research',
      'custom',
    ]);
    const researchTasks = tasks.filter((task) => researchTypes.has(task.taskType));
    if (researchTasks.length <= 2) {
      return tasks;
    }

    const scoreTask = (task: TaskDefinition): number => {
      const haystack = `${task.goal} ${task.instructions}`.toLowerCase();
      let score = 0;

      if (task.taskType === 'web_search') score += 100;
      if (task.taskType === 'competitor_study') score += 80;
      if (task.taskType === 'market_research') score += 50;
      if (task.taskType === 'social_analysis') score += 20;

      if (campaignBrief.productUrl && haystack.includes('product')) score += 25;
      if (campaignBrief.productUrl && haystack.includes('url')) score += 20;
      if (haystack.includes('brand')) score += 10;
      if (haystack.includes('ingredient') || haystack.includes('benefit') || haystack.includes('price')) score += 10;
      if (haystack.includes('tiktok') || haystack.includes('ad strateg')) score += 8;

      return score;
    };

    const isProductFocused = (task: TaskDefinition): boolean => {
      const haystack = `${task.goal} ${task.instructions}`.toLowerCase();
      return /(product|ingredients?|benefits?|pricing|reviews?|landing page|product page|sku|serum)/.test(haystack);
    };

    const isSocialHeavy = (task: TaskDefinition): boolean => {
      const haystack = `${task.goal} ${task.instructions}`.toLowerCase();
      return /(social|instagram|tiktok presence|content pillars|posting patterns)/.test(haystack);
    };

    const prioritized: TaskDefinition[] = [];

    const productTask = [...researchTasks]
      .filter((task) => task.taskType === 'web_search' && isProductFocused(task))
      .sort((a, b) => scoreTask(b) - scoreTask(a))[0];
    if (productTask) prioritized.push(productTask);

    const competitorTask = [...researchTasks]
      .filter((task) => task.taskType === 'competitor_study')
      .sort((a, b) => scoreTask(b) - scoreTask(a))[0];
    if (competitorTask && !prioritized.some((task) => task.id === competitorTask.id)) {
      prioritized.push(competitorTask);
    }

    const fallbackCandidates = [...researchTasks]
      .filter((task) => !prioritized.some((entry) => entry.id === task.id))
      .sort((a, b) => {
        const socialPenaltyA = isSocialHeavy(a) ? 25 : 0;
        const socialPenaltyB = isSocialHeavy(b) ? 25 : 0;
        return (scoreTask(b) - socialPenaltyB) - (scoreTask(a) - socialPenaltyA);
      });

    for (const task of fallbackCandidates) {
      if (prioritized.length >= 2) break;
      prioritized.push(task);
    }

    const keptResearchIds = new Set(prioritized.map((task) => task.id));

    return tasks.filter((task) => !researchTypes.has(task.taskType) || keptResearchIds.has(task.id));
  }

  private normalizeTaskDependencies(tasks: TaskDefinition[]): TaskDefinition[] {
    const taskIds = new Set(tasks.map((task) => task.id));
    return tasks.map((task) => ({
      ...task,
      dependsOn: (task.dependsOn || []).filter((dependencyId) => taskIds.has(dependencyId)),
    }));
  }

  private normalizePhases(phases: TaskGraph['phases'], tasks: TaskDefinition[]): TaskGraph['phases'] {
    const taskIds = new Set(tasks.map((task) => task.id));
    return (phases || [])
      .map((phase) => ({
        ...phase,
        taskIds: (phase.taskIds || []).filter((taskId) => taskIds.has(taskId)),
      }))
      .filter((phase) => (phase.taskIds || []).length > 0);
  }

  private getFallbackTaskGraph(campaignBrief: CampaignBrief): TaskGraph {
    const brief = campaignBrief.rawPrompt;
    // Extract URL from brief if present
    const urlMatch = brief.match(/https?:\/\/[^\s]+/);
    const url = campaignBrief.productUrl || (urlMatch ? urlMatch[0] : '');
    let domain = '';
    try {
      domain = url ? new URL(url).hostname.replace('www.', '') : '';
    } catch {
      domain = url.replace(/^https?:\/\//, '').split('/')[0];
    }
    const targetSceneCount = getTargetSceneCount(campaignBrief.durationSec || 30);

    const researchTasks: TaskDefinition[] = [
      {
        id: 't1',
        taskType: 'web_search',
        goal: url ? `Research ${domain} brand identity` : 'Research brand from brief',
        instructions: url
          ? `Research ${url}. Find brand name, tagline, products, brand story, visual aesthetic, certifications.`
          : `Research the brand mentioned in: "${brief}". Find everything about them.`,
        priority: 'high',
        dependsOn: [],
      },
      {
        id: 't2',
        taskType: 'web_search',
        goal: 'Research product details',
        instructions: `Deep dive into the specific product mentioned in the brief: "${brief}". Find ingredients, benefits, pricing, reviews, unique selling points.`,
        priority: 'high',
        dependsOn: [],
      },
    ];

    if (campaignBrief.executionMode !== 'fast') {
      researchTasks.push({
        id: 't3',
        taskType: 'competitor_study',
        goal: 'Study competitor ad strategies',
        instructions: `Find 3-5 competitor brands in the same product category as "${brief}". Analyze their ad styles, hooks, visual approaches. What works? What doesn't?`,
        priority: 'normal',
        dependsOn: [],
      });
    }

    if (campaignBrief.executionMode === 'agency') {
      researchTasks.push({
        id: 't4',
        taskType: 'web_search',
        goal: 'Research award-winning ads in this category',
        instructions: `Search for the best, most creative ads in this product category. What makes them stand out? What patterns do award-winning ads share?`,
        priority: 'normal',
        dependsOn: [],
      });
      researchTasks.push({
        id: 't5',
        taskType: 'custom',
        goal: 'Plan scene-to-asset strategy from existing product visuals',
        instructions: `Using the product URL, imported product images, and brief, map the strongest existing asset candidates for hook, proof, demo, and CTA. Identify where an edited or newly generated asset should be created from an existing imported product image instead of relying only on the source gallery.`,
        priority: 'high',
        dependsOn: [],
      });
    }

    const tasks: TaskDefinition[] = [
      ...researchTasks,
      {
        id: 't_synthesize',
        taskType: 'brand_synthesis',
        goal: 'Create comprehensive Brand DNA',
        instructions: 'Combine all research findings into a structured Brand DNA. Output as JSON.',
        priority: 'high',
        dependsOn: researchTasks.map((task) => task.id),
      },
      {
        id: 't_creative',
        taskType: 'creative',
        goal: 'Create award-winning ad concept',
        instructions: `Create a ${campaignBrief.durationSec}s ${campaignBrief.platform} ad concept with about ${targetSceneCount} scenes. Prioritize a sensual narrative first, then map stored assets or recommend new 'imagined' generations where they improve the story. Output JSON with narrativeArc and scenes array.`,
        priority: 'high',
        dependsOn: ['t_synthesize'],
      },
      {
        id: 't_review',
        taskType: 'review',
        goal: 'Review ad concept',
        instructions: 'Score 1-10, be harsh. Output JSON with overallScore and verdict.',
        priority: 'high',
        dependsOn: ['t_creative'],
      },
    ];

    return {
      reasoning: 'Fallback task graph with basic research, synthesis, creative, and review phases.',
      tasks,
      phases: [
        { type: 'parallel', taskIds: researchTasks.map((task) => task.id) },
        { type: 'sequential', taskIds: ['t_synthesize'] },
        { type: 'sequential', taskIds: ['t_creative'] },
        { type: 'loop', taskIds: ['t_review', 't_creative'], condition: 'score >= 9', maxIterations: 5 },
      ],
    };
  }
}

const getTargetSceneCount = (durationSec: CampaignBrief['durationSec']): number => {
  switch (durationSec) {
    case 10:
      return 2;
    case 15:
      return 3;
    case 20:
      return 4;
    case 30:
      return 6;
    case 45:
      return 8;
    case 60:
    default:
      return 10;
  }
};
