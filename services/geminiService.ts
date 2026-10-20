import { GoogleGenAI, Modality, Type, GenerateContentResponse } from "@google/genai";
import { UploadedMedia, ReelScript, VoiceName, ScriptStyle, MusicComposition, VoiceMatchResponse, VideoSegment, ReelPlan, BrandKit, TrendReport, ResearchReport, ViralAnalysisReport, MusicMetadata, MusicAnalysis, ScenePlan, SongAnalysis, ViralTopicFinderResult, ViralTopicIdea, SocialCopySuggestion, SocialPlatform, HookIdeaBundle, BrandAssetCatalogEntry, ImageGenerationRequest, VoiceOption } from "../types";
import type { AdConcept, AdFormat, BrandAsset, CampaignBrief, CreativeStoryboardResult, ExecutionMode, ProductContext, SceneContract, SceneSourceMode, SceneVisualRecipe, SceneVisualTask, StoryboardScene, StoryboardSceneState } from "../types/brand";
import { tryParseJSON } from "../utils/audioHelper";
import { usageTracker } from "../utils/usageTracker";
import { toGeminiImageAspectRatio } from "../components/AIImageStudio/aspectRatioCatalog";
import { visualTaskToSceneRoute } from "./sceneRouter";
import { hashKey, KvCache } from "../utils/kvCache";
import { REEL_CAPTION_SYSTEM_PREFIX, REEL_VOICE_STYLE_PREFIX } from "../utils/geminiPromptPrefix";
import {
    allocateDurationsToTarget,
    buildMeasuredNarrationCorrectionPlan,
    cleanScriptText,
    countSpokenWords,
    isUsefulSpokenLine,
    maxWordsForSlot,
    SPOKEN_SCENE_MIN_SEC,
    truncateSpokenTextToBudget,
    WORDS_PER_SEC,
} from "../utils/sceneDrafts";
import { PRODUCT_PHOTO_REALISM_REVIEW_RULES } from "./productPhotoRealism";
import { generateAppText } from "./llm/appText";
import { resolveImageModel } from "./llm/imageModel";
import { SHELL_SERVER } from "./shellToolService";

const extractResponseText = (response: GenerateContentResponse, fallback = '{}') =>
    (response.text || fallback).replace(/```json|```/g, '').trim();

const stripJsonFences = (text: string, fallback = '{}') =>
    (text || fallback).replace(/```json|```/g, '').trim();


export interface ViralTopicFinderInput {
    persona?: string;
    creatorProfileUrl?: string;
    referenceUrls?: string[];
    baseTopic?: string;
    ideaCount?: number;
    remixIdea?: ViralTopicIdea;
    remixNotes?: string;
    productContext?: string[];
}

export interface CampaignBriefPromptRequest {
    brandName?: string;
    productUrl: string;
    platform: import('../types/brand').CampaignPlatform;
    objective: 'awareness' | 'consideration' | 'conversion' | 'ugc_style' | 'founder_story';
    durationSec?: 10 | 15 | 20 | 30 | 45 | 60;
    executionMode: 'fast' | 'balanced' | 'agency';
    audience?: string;
    callToAction?: string;
    tone?: string;
    existingPrompt?: string;
}

export interface SceneOrderSuggestionRequest {
    reorderPrompt?: string;
    scenes: Array<{
        id: string;
        text: string;
        visualDescription: string;
        imagePrompt: string;
    }>;
}

export interface SceneOrderSuggestionResult {
    orderedSceneIds: string[];
    reasoning: string;
}

export interface ResearchDrivenStoryboardScene {
    text: string;
    visualDescription: string;
    imagePrompt: string;
    visualTask: 'use_imported' | 'edit_imported' | 'overlay_on_product' | 'generate_new';
    visualTaskReason?: string;
    recommendedBaseAssetId?: string | null;
}

export interface ResearchDrivenStoryboardResult {
    narrativeArc?: string;
    creativeRationale?: string;
    scenes: ResearchDrivenStoryboardScene[];
}

export interface CreativeStoryboardPlannerProductInput {
    productId: string;
    productTitle: string;
    productUrl: string;
    productFacts?: string[];
    allowedClaims?: string[];
    signalSummary?: string;
    assets: Array<{
        id: string;
        description: string;
        verdict?: BrandAsset['verdict'];
        shotType?: BrandAsset['shotType'];
        quality?: BrandAsset['quality'];
    }>;
}

const getStoryboardSceneCount = (
    durationSec: CampaignBrief['durationSec'],
    executionMode: CampaignBrief['executionMode'],
): number => {
    const getBaseSceneCount = (duration: CampaignBrief['durationSec']): number => {
        switch (duration) {
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
                return 10;
            default:
                return 6;
        }
    };

    const baseCount = getBaseSceneCount(durationSec);
    if (executionMode === 'fast') {
        return Math.max(2, baseCount - (durationSec >= 20 ? 1 : 0));
    }
    if (executionMode === 'agency') {
        const maxForDuration = durationSec <= 10 ? 3 : durationSec <= 20 ? 5 : durationSec <= 30 ? 7 : durationSec <= 45 ? 9 : 11;
        return Math.min(maxForDuration, baseCount + (durationSec >= 20 ? 1 : 0));
    }
    return baseCount;
};

const normalizeStoryboardVisualTask = (value?: string): SceneVisualTask => {
    switch (value) {
        case 'use_imported':
        case 'edit_imported':
        case 'overlay_on_product':
        case 'generate_new':
            return value;
        default:
            return 'overlay_on_product';
    }
};

const normalizeStoryboardSourceMode = (
    value: string | undefined,
    visualTask: SceneVisualTask,
): SceneSourceMode => {
    if (value === 'use_exact_asset' || value === 'crop_reframe_asset' || value === 'edit_from_asset' || value === 'generate_matching_shot' || value === 'generate_fresh') {
        return value;
    }

    switch (visualTask) {
        case 'use_imported':
            return 'use_exact_asset';
        case 'edit_imported':
            return 'edit_from_asset';
        case 'overlay_on_product':
            return 'generate_matching_shot';
        case 'generate_new':
        default:
            return 'generate_fresh';
    }
};

const normalizeStoryboardRoute = (
    value: string | undefined,
    visualTask: SceneVisualTask,
): SceneVisualRecipe['route'] => {
    if (value === 'use_existing' || value === 'upgrade_existing' || value === 'composite_product' || value === 'generate_fresh' || value === 'continue_sequence') {
        return value;
    }
    return visualTaskToSceneRoute(visualTask);
};

/**
 * Research trending ad patterns for a product category + platform.
 * Uses Google Search grounding to find current viral patterns.
 */
export const researchTrendingAdPatterns = async (input: {
    productTitle: string;
    platform: string;
    objective: string;
    brief: string;
}): Promise<{
    trendingFormats: string[];
    viralHooks: string[];
    pacingPatterns: string[];
    contentStructures: string[];
    platformSpecifics: string;
    summary: string;
}> => {
    const prompt = `
You are a commercial product photography director and social media visual strategist.

Research the CURRENT trending STILL IMAGE styles and visual aesthetics for "${input.productTitle}" on ${input.platform}.

Brief context: ${input.brief || 'Product photography'}
Objective: ${input.objective}

Focus ONLY on still photography — NOT video, NOT reels, NOT motion content.

Use web search to find REAL, CURRENT trends. Look at:
- What still image photography styles are trending for this product category on ${input.platform}
- What visual hooks (composition, lighting, color, mood) are stopping the scroll in feed images
- What photography aesthetics (flat lay, editorial, lifestyle, macro, minimal, etc.) are performing best
- What visual content structures (hero packshot, texture detail, lifestyle context, before/after flat lay, etc.) are popular
- Platform-specific still image conventions (${input.platform} feed image ratios, color grading trends, typography overlays on static posts)

Return ONLY JSON — all fields must describe STILL IMAGE photography, never video:
{
    "trendingFormats": ["photography style 1", "photography style 2", "photography style 3"],
    "viralHooks": ["visual hook 1 (composition/lighting/mood, not text or audio)", "visual hook 2", "visual hook 3"],
    "pacingPatterns": ["image series type 1", "image series type 2"],
    "contentStructures": ["visual structure 1: description", "visual structure 2: description"],
    "platformSpecifics": "Key ${input.platform} still image conventions (aspect ratio, color tone, composition rules only — no audio or motion)",
    "summary": "2-3 sentence summary of what visual styles are working right now for still product images"
}
`;

    try {
        const result = await generateAppText({
            prompt,
            webSearch: true,
            json: true,
            temperature: 0.5,
            role: 'plan',
        });
        usageTracker.trackTokens('researchTrendingAdPatterns', 0, 0);
        const parsed = tryParseJSON<any>(stripJsonFences(result.content));
        return {
            trendingFormats: parsed?.trendingFormats || [],
            viralHooks: parsed?.viralHooks || [],
            pacingPatterns: parsed?.pacingPatterns || [],
            contentStructures: parsed?.contentStructures || [],
            platformSpecifics: parsed?.platformSpecifics || '',
            summary: parsed?.summary || '',
        };
    } catch (error) {
        console.warn('[geminiService] researchTrendingAdPatterns failed:', error);
        return {
            trendingFormats: [],
            viralHooks: [],
            pacingPatterns: [],
            contentStructures: [],
            platformSpecifics: '',
            summary: 'Trend research unavailable — using general best practices.',
        };
    }
};

export const planCreativeStoryboard = async (input: {
    brandName: string;
    rawPrompt: string;
    platform: CampaignBrief['platform'];
    objective: CampaignBrief['objective'];
    durationSec: CampaignBrief['durationSec'];
    executionMode: CampaignBrief['executionMode'];
    adFormat?: AdFormat;
    products: CreativeStoryboardPlannerProductInput[];
    useWebResearch?: boolean;
    /** Campaign settings that should influence creative direction */
    audience?: string;
    callToAction?: string;
    tone?: string;
    /** Pre-fetched trend research — if provided, injected into the creative prompt */
    trendResearch?: {
        trendingFormats: string[];
        viralHooks: string[];
        pacingPatterns: string[];
        contentStructures: string[];
        platformSpecifics: string;
        summary: string;
    };
}): Promise<CreativeStoryboardResult> => {
    const targetSceneCount = getStoryboardSceneCount(input.durationSec, input.executionMode);
    const safeProducts = input.products
        .filter((product) => product.assets.length > 0)
        .slice(0, 6)
        .map((product) => ({
            ...product,
            assets: product.assets.slice(
                0,
                input.executionMode === 'fast'
                    ? 4
                    : input.executionMode === 'balanced'
                        ? 6
                        : 8,
            ),
        }));

    if (!safeProducts.length) {
        throw new Error('Creative storyboard planner requires at least one product with usable assets.');
    }

    const productBlock = safeProducts.map((product, index) => {
        const assetLines = product.assets
            .map((asset, assetIndex) => `${assetIndex + 1}. id=${asset.id}; description=${asset.description}; verdict=${asset.verdict || 'unknown'}; shotType=${asset.shotType || 'unknown'}; quality=${asset.quality || 'unknown'}`)
            .join('\n');
        const facts = (product.productFacts || []).slice(0, 8).join(' | ') || 'None provided';
        const claims = (product.allowedClaims || []).slice(0, 8).join(' | ') || 'None provided';
        const signalSummary = (product.signalSummary || '').trim() || 'None provided';

        return `${index + 1}. productId=${product.productId}; title=${product.productTitle}; url=${product.productUrl}
Facts: ${facts}
Allowed claims: ${claims}
Signal summary: ${signalSummary}
Assets:
${assetLines || 'No assets provided.'}`;
    }).join('\n\n');

    const researchBlock = input.useWebResearch
        ? `\nUse web research only to sharpen broad category insights or myths. Do not invent brand-specific claims and do not override the provided product facts.`
        : '';

    // Inject trend research if available
    const trendBlock = input.trendResearch?.summary
        ? `
CURRENT TRENDING AD PATTERNS (from live research):
- Summary: ${input.trendResearch.summary}
- Trending formats: ${input.trendResearch.trendingFormats.slice(0, 3).join('; ')}
- Viral hooks: ${input.trendResearch.viralHooks.slice(0, 3).join('; ')}
- Pacing: ${input.trendResearch.pacingPatterns.slice(0, 2).join('; ')}
- Content structures: ${input.trendResearch.contentStructures.slice(0, 2).join('; ')}
- Platform specifics: ${input.trendResearch.platformSpecifics}

IMPORTANT: Use these trends to inform your creative decisions. Adapt the trending formats and hooks to this specific product — don't copy them verbatim, but let them shape the ad structure and pacing.
`
        : '';

    const prompt = `
You are a Disney Imagineer planning an immersive, imaginative storyboard for a short-form ad.
${trendBlock}
Mission:
- Build a world-first storyboard that transports viewers into memorable, imaginative scenes.
- Each scene should feel like a tiny world viewers want to step into.
- Think Disney Imagineering: create moments of delight, emotional journeys, and visual surprises.
- Then weave the product naturally into this world as a meaningful part of the story — never a hard sell.
- Each scene must be assigned to exactly one productId from the provided product list.
- For each scene, DECIDE whether to use an existing imported asset or generate a fresh image:
  - If an existing asset genuinely matches the scene's visual needs (same product, relevant shot type, good quality), assign it via recommendedBaseAssetId.
  - If NO existing asset is a good fit (e.g., scene needs a different product, a mood shot, a lifestyle context, or a comparison visual that wasn't uploaded), set visualTask = "generate_new", route = "generate_fresh", and recommendedBaseAssetId = null.
  - Do NOT force-fit an asset to a scene it doesn't match. A scene about coffee should use a coffee image, not a matcha tin. A scene about a lifestyle moment should generate fresh if no lifestyle shot was uploaded.
  - Write a detailed, production-ready imagePrompt for EVERY scene — especially for generate_new scenes where the prompt is the only creative direction.
- Use multiple products only when it improves the narrative (routine, bundle, comparison, hero + support product), not for random variety.
- Keep every scene production-ready for a vertical 9:16 ad.
- AD FORMAT GUIDANCE: ${input.adFormat === 'carousel' ? 'This is a CAROUSEL ad — plan each scene as a distinct swipeable slide with a self-contained visual that works as a static image. Each slide should have a clear focal point and text overlay potential.' : input.adFormat === 'static_image' ? 'This is a STATIC IMAGE ad — plan a single hero scene with maximum visual impact. The storyboard should focus on one powerful composition.' : input.adFormat === 'veo3_video' ? 'This is an AI VIDEO ad — plan scenes with rich motion descriptions (camera movement, product interaction, environmental dynamics). Each scene should describe what MOVES and how.' : 'This is a STITCHED VIDEO ad — plan scenes that flow with Ken Burns motion, crossfades, and audio pacing.'}

Hard constraints:
- Never invent a product not listed below.
- If a product is visible, keep its exact identity, packaging, label, and silhouette stable.
- Do not make unsupported medical or performance claims.
- The final scene should land on the primary hero product unless the brief strongly implies otherwise.
- Every scene must have one clear visual route.

Brief:
- Brand: ${input.brandName}
- User brief: ${(input.rawPrompt || 'None provided').slice(0, 2200)}
- Platform: ${input.platform}
- Ad format: ${input.adFormat || 'stitched_video'}
- Objective: ${input.objective}
- Duration: ${input.durationSec || 30}s
- Execution mode: ${input.executionMode}
${input.audience ? `- Target audience: ${input.audience}` : ''}
${input.callToAction ? `- Call to action: ${input.callToAction}` : ''}
${input.tone ? `- Creative tone: ${input.tone} — adapt the mood, language, and visual treatment to match this tone` : ''}

Creative framework (choose based on product category):
- BEAUTY/SKINCARE: Focus on transformation, sensory journey, ritual, self-care moments. Use intimate lighting, textures, and a sense of "becoming your best self."
- TECH/GADGETS: Focus on discovery, capability reveal, lifestyle elevation. Show the product as a portal to something better — discovery, connection, or effortless living.
- FOOD/BEVERAGES: Focus on sensory immersion, moment sharing, craft/heritage. Make viewers taste with their eyes, feel the warmth/comfort/freshness.
- HOME/LIFESTYLE: Focus on aspirational space, daily ritual improvement, sanctuary feeling. Create a "I want to live there" or "I want my mornings to feel like this" feeling.
- HEALTH/SUPPLEMENTS: Focus on wellness journey, trust building, vitality. Show subtle transformation, natural energy, and body-mind connection.
- FASHION/APPAREL: Focus on identity expression, confidence, aspirational lifestyle. Make viewers imagine themselves in the story.

SCENE EXAMPLES (inspiration, not templates):
- Cleanser: "That squeaky-clean feeling is NOT the flex you think it is" (subverts expectation)
- Serum: "Stop layering five steps when ONE serum can do the heavy lifting" (challenges status quo)
- Moisturizer: "Your morning ritual is about to get 3 minutes shorter" (specific benefit)
- Eye cream: "Nobody sees your 2AM scrolling. But your under-eyes do." (relatable pain)
- Toner: "The step everyone skips, but nobody should" (reframe the ordinary)
- Sunscreen: "The only SPF that survived my beach day" (social proof moment)

Each example is a STARTING POINT — adapt to the specific product, brand voice, and brief. The goal is surprising specificity, not template copying.

IMAGINATION GUIDELINES:
- Build a tiny world in each scene, not just show a product
- Include at least ONE "moment of delight" — a surprising, whimsical, or delightful visual element that makes viewers smile
- Let the product feel naturally magical in the context, like it belongs in this world
- Be specific and surprising — avoid generic ad language

NO TEMPLATE LANGUAGE - NEVER use these phrases:
- "Meet [product]" — too generic, find a more surprising opening
- "The product you've been waiting for" — cliché, be specific
- "Transform your routine" — overused, say HOW it transforms
- "Say goodbye to [problem]" — formulaic, make it more creative
- "Introducing..." — boring, start with a moment or question
- "Your skin will thank you" — vague, be specific about the feeling
- "Experience the difference" — meaningless, show the difference
- "Premium quality" — tell, don't sell
- "Designed for [audience]" — add the specific emotional context
- "The ultimate solution" — grandiose, be grounded

Instead of templates, lead with: a question, a surprising statement, a sensory moment, or a before/after contrast.

Approved products:
${productBlock}

Route rules:
- route = "use_existing": use an imported asset nearly as-is.
- route = "upgrade_existing": improve an imported asset while preserving product identity.
- route = "composite_product": use the real product as the anchor, but add or integrate extra scene elements.
- route = "generate_fresh": create a new scene-led shot from scratch.
- route = "continue_sequence": use the previous scene as a sequence continuation.

Visual task rules:
- visualTask = "use_imported": use an imported asset as-is or with crop/reframe only.
- visualTask = "edit_imported": elevate an imported shot while preserving the exact product.
- visualTask = "overlay_on_product": create a composite or scene-led extension where the product remains accurate.
- visualTask = "generate_new": create a fresh frame. If the product appears, still keep its identity exact.

Return ONLY strict JSON:
{
  "narrativeArc": "string",
  "creativeRationale": "string",
  "scenes": [
    {
      "sceneNumber": 1,
      "text": "short spoken line or on-screen line",
      "visualDescription": "what we see",
      "imagePrompt": "generator-friendly prompt",
      "durationSec": "appropriate duration for this scene based on its content complexity and pacing needs (e.g., 3-5s for quick hook, 8-12s for demo, 4-6s for transition)",
      "recipe": {
        "productId": "one of the provided productIds",
        "productTitle": "matching product title",
        "route": "use_existing | upgrade_existing | composite_product | generate_fresh | continue_sequence",
        "sourceMode": "use_exact_asset | crop_reframe_asset | edit_from_asset | generate_matching_shot | generate_fresh",
        "visualTask": "use_imported | edit_imported | overlay_on_product | generate_new",
        "visualTaskReason": "short reason",
        "routeReason": "short reason",
        "recommendedBaseAssetId": "asset id from the assigned product or null"
      }
    }
  ]
}

Scene planning requirements:
- Scene 1 must function as the hook with a compelling opening moment.
- Include at least one proof, demo, ingredient, or credibility beat.
- Include at least ONE "moment of delight" — a surprising, whimsical, or delightful visual element that makes viewers smile.
- End with a clear CTA or hero beat.
- Return exactly ${targetSceneCount} scenes.
- recommendedBaseAssetId must belong to the assigned productId.
- If visualTask is "generate_new", recommendedBaseAssetId must be null.
- Prefer distinct visual beats across the storyboard.
- Make each scene feel like a tiny world, not just a product shot.
- ASSET ASSIGNMENT IS PER-SCENE: only assign an existing asset when it genuinely fits the scene's visual intent. When in doubt, use generate_new with a detailed imagePrompt rather than forcing a mismatched asset.
- For generate_new scenes, the imagePrompt must be rich and specific: describe lighting, composition, camera angle, mood, product placement, background, and any props or environmental details. This prompt is what the image generator will use.

DURATION GUIDELINES (IMPORTANT):
- NOT all scenes should be the same length! Vary based on content complexity.
- Hook scenes (Scene 1): 3-5 seconds — punchy, attention-grabbing
- Demo/proof scenes: 8-12 seconds — show the product in action, needs more time
- Quick transitions: 2-4 seconds — brief bridging moments
- CTA/final scene: 4-6 seconds — land the message clearly
- Total must still approximate ${input.durationSec}s but don't force equal splits
- If you recommend durations, include "durationSec" field in each scene object (e.g., "durationSec": 5)
${researchBlock}
`;

      const generateStoryboard = async (useWebResearch: boolean): Promise<GenerateContentResponse> => {
          return await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
              model: PLAN_MODEL,
              tools: useWebResearch ? [{ googleSearch: {} }] : undefined,
              contents: { parts: [{ text: prompt }] },
              config: {
                  responseMimeType: 'application/json',
                  temperature: 0.7, // Reduced from 1.0 to get more consistent JSON output
                  maxOutputTokens: 6000, // Increased from 4000 to prevent cutoff
              }
          } as any));
      };

     let response: GenerateContentResponse;
     try {
         response = await generateStoryboard(Boolean(input.useWebResearch));
     } catch (error) {
         if (input.useWebResearch) {
             console.warn('[geminiService] planCreativeStoryboard web research failed; retrying without web tools.', error);
             response = await generateStoryboard(false);
         } else {
             throw error;
         }
     }

      usageTracker.trackTokens('planCreativeStoryboard', response.usageMetadata?.promptTokenCount || 0, response.usageMetadata?.candidatesTokenCount || 0);

      const jsonString = extractResponseText(response);
      const parsed = tryParseJSON<CreativeStoryboardResult>(jsonString);
      const productById = new Map(safeProducts.map((product) => [product.productId, product]));

    const fallbackProduct = safeProducts[0];

    const scenes = (parsed?.scenes || [])
        .filter((scene) => Boolean(scene?.text && scene?.visualDescription && scene?.imagePrompt))
        .map((scene, index): StoryboardScene => {
            const rawRecipe = (scene as any).recipe || {};
            const product = productById.get(rawRecipe.productId) || fallbackProduct;
            const visualTask = normalizeStoryboardVisualTask(rawRecipe.visualTask);
            const route = normalizeStoryboardRoute(rawRecipe.route, visualTask);
            const sourceMode = normalizeStoryboardSourceMode(rawRecipe.sourceMode, visualTask);
            const validAssetIds = new Set(product.assets.map((asset) => asset.id));
            const recommendedBaseAssetId = typeof rawRecipe.recommendedBaseAssetId === 'string' && validAssetIds.has(rawRecipe.recommendedBaseAssetId) && visualTask !== 'generate_new'
                ? rawRecipe.recommendedBaseAssetId
                : null;

            return {
                sceneNumber: Number(scene.sceneNumber) || index + 1,
                text: String(scene.text || '').trim(),
                visualDescription: String(scene.visualDescription || '').trim(),
                imagePrompt: String(scene.imagePrompt || '').trim(),
                // Store AI-suggested duration in recipe for later use (clamped to safe range)
                durationSec: scene.durationSec ? Math.max(1, Math.min(30, Number(scene.durationSec))) : undefined,
                recipe: {
                    productId: rawRecipe.productId || product.productId,
                    productTitle: rawRecipe.productTitle || product.productTitle,
                    route,
                    sourceMode,
                    visualTask,
                    visualTaskReason: rawRecipe.visualTaskReason || '',
                    routeReason: rawRecipe.routeReason || '',
                    recommendedBaseAssetId,
                },
            };
        })
        .slice(0, targetSceneCount);

    if (!scenes.length) {
        throw new Error('AI did not return a usable creative storyboard.');
    }

    return {
        narrativeArc: (parsed?.narrativeArc || '').trim() || undefined,
        creativeRationale: (parsed?.creativeRationale || '').trim() || undefined,
        scenes,
    };
};

export const planResearchDrivenLockedStoryboard = async (input: {
    productTitle: string;
    productUrl: string;
    brandName: string;
    platform: CampaignBrief['platform'];
    objective: CampaignBrief['objective'];
    durationSec: CampaignBrief['durationSec'];
    executionMode: CampaignBrief['executionMode'];
    productPageSignalSummary?: string;
    productFacts?: string[];
    allowedClaims?: string[];
    importedAssets: Array<{ id: string; description: string }>;
    useWebResearch?: boolean;
}): Promise<ResearchDrivenStoryboardResult> => {
    const targetSceneCount = getStoryboardSceneCount(input.durationSec, input.executionMode);
    const safeAssets = input.importedAssets.slice(0, 10);
    const assetBlock = safeAssets
        .map((asset, index) => `${index + 1}. id=${asset.id}; description=${asset.description}`)
        .join('\n');

    const researchBlock = input.useWebResearch
        ? `\nUse web research (via built-in search tool) to add 2-4 short, safe, non-medical insights about the product category and common myths. Do not invent clinical claims. Keep it grounded and conservative.`
        : '';

    const prompt = `
You are a senior performance creative director building a storyboard for a locked-product ad.

Mission:
- Build the story from product page analysis and research first (not from the image gallery).
- Then map the imported product images to each scene.
- If a scene needs an upgraded version of an imported product image, flag it.
- If a scene needs a composited visual (e.g., a model holding the product, glowing skin, ingredient/chemical metaphor), flag it.

Hard constraints:
- Keep the exact same product identity (label, bottle shape) whenever the product is visible.
- Do not invent medical claims.
- Prefer simple, production-ready prompts for vertical 9:16.
- Use concrete details from the product page signal summary; avoid generic filler lines.

Inputs:
- Brand: ${input.brandName}
- Product title: ${input.productTitle}
- Product URL: ${input.productUrl}
- Platform: ${input.platform}
- Objective: ${input.objective}
- Duration: ${input.durationSec}s
- Execution mode: ${input.executionMode}
- Allowed claims: ${(input.allowedClaims || []).join(' | ') || 'None provided'}
- Product facts: ${(input.productFacts || []).join(' | ') || 'None provided'}
- Product page signal summary:\n${(input.productPageSignalSummary || 'None provided').slice(0, 2600)}

Imported product assets (choose IDs when relevant):
${assetBlock || 'No imported assets provided.'}

Visual task rules:
- visualTask = "use_imported": use an imported asset as-is (or light crop/reframe).
- visualTask = "edit_imported": take an imported asset and improve it (lighting/composition) while preserving product identity.
- visualTask = "overlay_on_product": create a new scene image where the product remains accurate but extra subjects/elements are added (model, glowing face, harsh-chemical metaphor, ingredient props).
- visualTask = "generate_new": generate a fresh scene-led image (still keep product identity if visible).

Return ONLY strict JSON:
{
  "narrativeArc": "string",
  "creativeRationale": "string",
  "scenes": [
    {
      "text": "short spoken line / on-screen line",
      "visualDescription": "what we see",
      "imagePrompt": "generator-friendly prompt",
      "visualTask": "use_imported | edit_imported | overlay_on_product | generate_new",
      "visualTaskReason": "short reason",
      "recommendedBaseAssetId": "asset id or null"
    }
  ]
}

Scene planning requirements:
- Scene 1 must be a hook.
- Include at least one proof/demo beat.
- End with a clear CTA / hero.
- Prefer a distinct visual beat for each scene.
- Return exactly ${targetSceneCount} scenes.
- If visualTask is "generate_new", recommendedBaseAssetId must be null.
- If recommendedBaseAssetId is provided, it must match one of the Imported product asset IDs.
${researchBlock}
`;

    const generateStoryboard = async (useWebResearch: boolean): Promise<GenerateContentResponse> => {
        return await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model: PLAN_MODEL,
            tools: useWebResearch ? [{ googleSearch: {} }] : undefined,
            contents: { parts: [{ text: prompt }] },
            config: {
                responseMimeType: 'application/json',
                temperature: 0.35,
                maxOutputTokens: 1700,
            }
        } as any));
    };

    let response: GenerateContentResponse;
    try {
        response = await generateStoryboard(Boolean(input.useWebResearch));
    } catch (error) {
        if (input.useWebResearch) {
            console.warn('[geminiService] planResearchDrivenLockedStoryboard web research failed; retrying without web tools.', error);
            response = await generateStoryboard(false);
        } else {
            throw error;
        }
    }

    usageTracker.trackTokens('planResearchDrivenLockedStoryboard', response.usageMetadata?.promptTokenCount || 0, response.usageMetadata?.candidatesTokenCount || 0);
    const parsed = tryParseJSON<ResearchDrivenStoryboardResult>(extractResponseText(response));
    const validAssetIds = new Set(safeAssets.map((asset) => asset.id));
    const scenes = (parsed?.scenes || [])
        .filter((scene) => Boolean(scene?.text && scene?.visualDescription && scene?.imagePrompt && scene?.visualTask))
        .map((scene) => {
            const recommended = typeof scene.recommendedBaseAssetId === 'string' ? scene.recommendedBaseAssetId : null;
            const normalizedRecommended = recommended && validAssetIds.has(recommended) ? recommended : null;
            const shouldForceNull = scene.visualTask === 'generate_new';
            return {
                ...scene,
                recommendedBaseAssetId: shouldForceNull ? null : normalizedRecommended,
            };
        })
        .slice(0, targetSceneCount);
    if (scenes.length === 0) {
        throw new Error('AI did not return a usable storyboard plan.');
    }

    return {
        narrativeArc: (parsed?.narrativeArc || '').trim() || undefined,
        creativeRationale: (parsed?.creativeRationale || '').trim() || undefined,
        scenes,
    };
};

const buildFallbackCampaignBriefPrompt = (input: CampaignBriefPromptRequest): string => {
    const platformStyle =
        input.platform === 'tiktok'
            ? 'native, punchy, hook-first, and fast-moving'
            : input.platform === 'instagram_reels'
                ? 'premium, polished, and visually elevated'
                : 'clear, structured, spoken, and benefit-led';

    const creativeCues = extractCampaignBriefCreativeCues(input.existingPrompt, input.productUrl);
    const creativeCueSummary = creativeCues
        .map((cue) => cue.replace(/\s+/g, ' ').trim().replace(/[.?!]+$/, ''))
        .filter(Boolean)
        .join('; ');
    const toneLabel = normalizeCampaignBriefTone(input.tone);
    const objectiveLabel = input.objective.replace(/_/g, ' ');
    const lines = [
        `Create an ad for ${input.productUrl}`,
        creativeCueSummary
            ? `Preserve this creative direction from the brief: ${creativeCueSummary}.`
            : '',
        toneLabel
            ? creativeCueSummary
                ? `Tone: ${toneLabel}. Use it to sharpen the existing creative direction instead of replacing it with generic ad copy.`
                : `Keep the tone ${toneLabel} with ${platformStyle} execution.`
            : creativeCueSummary
                ? `Use ${platformStyle} pacing and structure only where it supports that direction.`
                : `Keep it ${platformStyle}.`,
        `Optimize it for ${objectiveLabel} in ${input.durationSec} seconds using ${input.executionMode} mode.`,
        input.audience ? `Target audience: ${input.audience}.` : '',
        input.callToAction ? `End with a CTA around "${input.callToAction}".` : '',
        'Use the product page copy, positioning, and imported product images as the source of truth before inventing any new visuals.',
        'Build a clear structure with a strong hook, product proof, and a conversion-focused closing beat without making unsupported claims.',
    ];

    return lines.filter(Boolean).join('\n');
};

const isUsableCampaignBriefPrompt = (value: string, productUrl: string): boolean => {
    const normalized = value.trim().toLowerCase();
    if (normalized.length < 120) return false;
    if (!normalized.includes(productUrl.toLowerCase())) return false;
    if (!normalized.includes('product page')) return false;
    return true;
};

const GENERATED_CAMPAIGN_BRIEF_LINE_PATTERNS = [
    /^create an ad for\b/i,
    /^keep it (native|premium|clear)\b/i,
    /^keep it\b.*\boptimize it for\b/i,
    /^keep the tone\b/i,
    /^tone:\b/i,
    /^optimize it for\b/i,
    /^target audience:\b/i,
    /^end with a cta\b/i,
    /^use the product page\b/i,
    /^use .* pacing and structure only where it supports that direction\b/i,
    /^build a clear structure\b/i,
    /^preserve this creative direction from the brief:\b/i,
];

const normalizeCampaignBriefTone = (value?: string): string | null => {
    const normalized = (value || '').trim().replace(/[-_]+/g, ' ');
    return normalized ? normalized : null;
};

const extractCampaignBriefCreativeCues = (existingPrompt?: string, productUrl?: string): string[] => {
    const normalizedProductUrl = (productUrl || '').trim().toLowerCase();

    return (existingPrompt || '')
        .split(/\r?\n/)
        .map((line) => line.trim().replace(/^[*-]\s*/, ''))
        .filter(Boolean)
        .filter((line) => {
            const lower = line.toLowerCase();
            if (!lower) return false;
            if (GENERATED_CAMPAIGN_BRIEF_LINE_PATTERNS.some((pattern) => pattern.test(line))) return false;
            if (normalizedProductUrl && (lower === normalizedProductUrl || lower === `create an ad for ${normalizedProductUrl}`)) return false;
            return true;
        })
        .slice(0, 3);
};

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY || '' });
const TEXT_MODEL = "gemini-3.8-flash";
const PLAN_MODEL = "gemini-3.1-pro-preview";
/**
 * Image generation model — config-driven via services/llm/imageModel.
 * Default is GA Gemini Nano Banana 2.1; overridable from
 * the UI (ImageModelControls), localStorage, or VITE_GEMINI_IMAGE_MODEL env.
 * Resolved per call so UI/env overrides apply without a reload.
 */
/** Latest low-latency Gemini TTS (Apr 2026). */
const TTS_MODEL = "gemini-3.1-flash-tts-preview";
const GOOGLE_TTS_FUNCTION_URL = (
    import.meta.env.VITE_GOOGLE_TTS_URL
    || (import.meta.env.VITE_GOOGLE_TTS_ENABLED === 'true' ? `${SHELL_SERVER}/tts` : '')
).trim();

/** Declared early so session KV caches can type against it. */
export interface CaptionStyleSuggestion {
    presetId: string;
    presetName: string;
    reasoning: string;
    colorScheme: {
        fillColor: string;
        outlineColor: string;
        highlightColor: string;
        glowColor?: string;
        gradientColors?: [string, string];
    };
    style: string;
    animation: string;
    fontFamily: string;
    displayMode: 'sentence' | 'word-by-word';
    mood: string;
    fontSize?: number;
    strokeWidth?: number;
    uppercase?: boolean;
}

/** Client KV caches — skip repeat Gemini calls within a session. */
const captionStyleCache = new KvCache<CaptionStyleSuggestion>(48, 45 * 60 * 1000);
const voiceoverCache = new KvCache<string>(96, 60 * 60 * 1000);

const trackGeminiUsage = (operation: string, response: GenerateContentResponse) => {
    const meta = response.usageMetadata as {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        cachedContentTokenCount?: number;
    } | undefined;
    usageTracker.trackTokens(
        operation,
        meta?.promptTokenCount || 0,
        meta?.candidatesTokenCount || 0,
        meta?.cachedContentTokenCount || 0,
    );
};

const isVoiceOption = (value: unknown): value is VoiceOption => {
    return Boolean(
        value &&
        typeof value === 'object' &&
        'provider' in value &&
        'id' in value
    );
};

export const hasConfiguredGeminiApiKey = (): boolean => {
    const key = `${import.meta.env.VITE_API_KEY || import.meta.env.GEMINI_API_KEY || ''}`.trim();
    if (!key) {
        console.warn('[geminiService] No Gemini API key configured');
        return false;
    }
    const normalized = key.toLowerCase();
    const isPlaceholder = 
        normalized === 'your_google_gemini_key' ||
        normalized === 'your-gemini-api-key' ||
        normalized === 'changeme' ||
        normalized.includes('your_google_gemini_key');
    
    if (isPlaceholder) {
        console.warn('[geminiService] Gemini API key appears to be a placeholder');
        return false;
    }
    
    return true;
};

// --- RETRY LOGIC ---
// Helper to retry operations on rate limit errors
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runWithRetry<T>(fn: () => Promise<T>, retries = 3, backoff = 2000): Promise<T> {
    try {
        return await fn();
    } catch (error: any) {
        // Check for Rate Limit (429) or Resource Exhausted errors
        const isQuotaError =
            error.status === 429 ||
            error.code === 429 ||
            error.message?.includes('RESOURCE_EXHAUSTED') ||
            error.message?.includes('Quota') ||
            error.message?.includes('429');

        if (isQuotaError && retries > 0) {
            console.warn(`API Quota hit. Retrying in ${backoff}ms... (${retries} attempts left)`);
            await wait(backoff);
            return runWithRetry(fn, retries - 1, backoff * 2);
        }
        throw error;
    }
}

// --- SOCIAL CAPTION & HASHTAG GENERATOR ---
export const generateSocialCopy = async (
    script: ReelScript | null,
    platform: SocialPlatform,
    persona?: string,
    baseTopic?: string
): Promise<SocialCopySuggestion> => {
    const safeScript = script?.fullText || script?.segments?.join(' ') || script?.hook || baseTopic || '';
    const safeTopic = baseTopic || script?.title || '';

    const prompt = `
You are a social copy chief for short-form video.

Goal: Produce one ${platform.toUpperCase()}-ready caption and a tight hashtag stack.

Inputs:
- Script / summary: "${safeScript.slice(0, 1200)}"
- Core topic: "${safeTopic}"
- Persona / channel vibe: ${persona || 'Not specified'}
- Platform: ${platform}

Rules:
- Captions should feel native to the platform: tone, pacing, emoji usage, line breaks.
- For Instagram: keep 2–3 short lines, end with CTA or curiosity hook. Keep hashtags 6–12, mix broad + niche; no banned terms; camelCase where needed.
- For YouTube Shorts: punchy first line, include a subtle CTA, avoid hashtag overload (use 3–6 best tags).
- For TikTok: conversational, 1–2 emojis max per line, keep hashtags 5–8; combine trending + niche; avoid punctuation clutter.
- For LinkedIn: professional, no slang, 2–3 lines, hashtags 3–6, industry-relevant.
- Always remove duplicates, keep hashtags lowercase except brand names, and strip whitespace.

Return strict JSON:
{
  "platform": "${platform}",
  "caption": "string",
  "hashtags": ["#tag1", "#tag2", "..."],
  "notes": "short reason for the hashtag/angle choices"
}
`;

    const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: TEXT_MODEL,
        contents: { parts: [{ text: prompt }] },
        config: {
            responseMimeType: "application/json",
        }
    }));

    usageTracker.trackTokens('generateSocialCopy', response.usageMetadata?.promptTokenCount || 0, response.usageMetadata?.candidatesTokenCount || 0);

    const text = extractResponseText(response);
    const parsed = tryParseJSON<SocialCopySuggestion>(text);

    return parsed || {
        platform,
        caption: safeTopic || 'New post',
        hashtags: ['#reels', '#content', '#creator'],
        notes: 'Fallback copy'
    };
};

export const generateHookIdeas = async (
    script: ReelScript | null,
    platform: SocialPlatform,
    baseTopic?: string
): Promise<HookIdeaBundle> => {
    const safeScript = script?.fullText || script?.segments?.join(' ') || script?.hook || baseTopic || '';
    const safeTopic = baseTopic || script?.title || '';

    const prompt = `
You are a hook doctor and cover-line copywriter for short-form.

Platform: ${platform}
Topic: "${safeTopic}"
Script gist: "${safeScript.slice(0, 800)}"

Return strict JSON:
{
  "hooks": ["punchy hook 1", "punchy hook 2", "punchy hook 3"],
  "coverLine": "short 3-5 word line for thumbnail/cover"
}

Rules:
- Hooks: 5-12 words, platform-native, avoid clickbait clichés, no hashtags.
- Cover line: max ~5 words, high-contrast phrasing, avoid punctuation clutter.
`;

    const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: TEXT_MODEL,
        contents: { parts: [{ text: prompt }] },
        config: { responseMimeType: "application/json" }
    }));

    usageTracker.trackTokens('generateHookIdeas', response.usageMetadata?.promptTokenCount || 0, response.usageMetadata?.candidatesTokenCount || 0);

    const text = extractResponseText(response);
    const parsed = tryParseJSON<HookIdeaBundle>(text);
    if (parsed?.hooks?.length) return parsed;

    return { hooks: ['Here’s a fresh hook', 'Second angle to test', 'Unexpected opener'], coverLine: 'Bold cover' };
};

export const suggestCampaignBriefPrompt = async (
    input: CampaignBriefPromptRequest
): Promise<string> => {
    const creativeCues = extractCampaignBriefCreativeCues(input.existingPrompt, input.productUrl);
    const toneLabel = normalizeCampaignBriefTone(input.tone);
    const prompt = `
You are a performance creative strategist writing a concise but high-signal campaign brief for a product ad workflow.

Return plain text only. Do not use markdown fences. Write the result as a ready-to-paste user brief.

Inputs:
- Brand: ${input.brandName || 'Unknown brand'}
- Product URL: ${input.productUrl}
- Platform: ${input.platform}
- Objective: ${input.objective}
- Duration: ${input.durationSec} seconds
- Execution mode: ${input.executionMode}
- Audience: ${input.audience || 'Not specified'}
- CTA: ${input.callToAction || 'Not specified'}
- Selected tone: ${toneLabel || 'Not specified'}
- Creative cues to preserve: ${creativeCues.join(' | ') || 'None provided'}
- Existing notes: ${input.existingPrompt || 'None'}

Requirements:
- Start with "Create an ad for ${input.productUrl}"
- Ground the brief in the product page URL as the source of truth.
- Tell the system to use the product page copy and imported images before inventing new visuals.
- Match the creative ask to the platform and objective.
- Mention the intended tone and structure.
- Preserve any user-supplied mood, pacing, texture, aesthetic, or hook language from the existing notes.
- If the user already gave creative wording, reuse those descriptors explicitly instead of replacing them with generic platform defaults.
- Use platform/objective defaults only to fill missing gaps, not to overwrite strong user direction.
- If a selected tone is provided, weave it in naturally while still prioritizing the user's own phrasing.
- Keep it compact: 4-7 short lines total.
- Do not invent product claims.
- If audience or CTA are provided, incorporate them naturally.
`;

    try {
        const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model: TEXT_MODEL,
            contents: { parts: [{ text: prompt }] },
            config: {
                maxOutputTokens: 220,
            }
        }));

        usageTracker.trackTokens('suggestCampaignBriefPrompt', response.usageMetadata?.promptTokenCount || 0, response.usageMetadata?.candidatesTokenCount || 0);
        const suggested = (response.text || '').trim();
        return isUsableCampaignBriefPrompt(suggested, input.productUrl)
            ? suggested
            : buildFallbackCampaignBriefPrompt(input);
    } catch (error) {
        console.warn('Campaign brief prompt suggestion failed', error);
        return buildFallbackCampaignBriefPrompt(input);
    }
};

export interface ImagePromptEnhancementReferenceImage {
  base64: string;
  mimeType: string;
  role?: string;
  label?: string;
}

export interface ImagePromptEnhancementRequest {
  rawPrompt: string;
  productTitle?: string;
  brandName?: string;
  route?: 'use_existing' | 'upgrade_existing' | 'composite_product' | 'generate_fresh' | 'continue_sequence';
  baseImageDescription?: string;
  baseImageBase64?: string;
  baseImageMimeType?: string;
  // Rich context (Phase 2 upgrade)
  aspectRatio?: string;
  brandPersonality?: string;
  brandVisualLanguage?: string;
  /** Full brand aesthetics brief (palette, type, lighting, composition, etc.) */
  brandAestheticsBrief?: string;
  productFacts?: string[];
  productClaims?: string[];
  productPreservationRules?: string[];
  trendInsights?: string[];
  referenceImageCount?: number;
  referenceRoles?: string[];
  /** Actual locked/reference stills for vision grounding */
  referenceImages?: ImagePromptEnhancementReferenceImage[];
  intent?: string;
  intentRationale?: string;
  intentDirectives?: string[];
  isAlreadyEnriched?: boolean;
}

export interface ImagePromptEnhancementResult {
  enhancedPrompt: string;
  negativePrompt?: string;
}

function toEnhanceInlineData(base64: string, mimeType?: string): { mimeType: string; data: string } {
  const dataUrl = base64.match(/^data:([^;,]+);base64,(.+)$/s);
  if (dataUrl) {
    return { mimeType: dataUrl[1], data: dataUrl[2].replace(/\s/g, '') };
  }
  return {
    mimeType: mimeType || 'image/jpeg',
    data: base64.replace(/\s/g, ''),
  };
}

export const enhanceImagePrompt = async (
  input: ImagePromptEnhancementRequest
): Promise<ImagePromptEnhancementResult> => {
  const referenceImages = input.referenceImages?.filter((img) => Boolean(img.base64)) || [];
  const intentDirectives = (input.intentDirectives || []).filter(Boolean);

  const systemPrompt = `You are a world-class AI image generation prompt engineer and creative director. Your job is to transform a user's raw prompt into a professional, structured, production-ready prompt that will produce stunning results.

${input.isAlreadyEnriched ? 'NOTE: The prompt may already be partially enriched. Preserve all existing detail and only add what is missing.' : ''}

## Context

- **Raw prompt:** "${input.rawPrompt}"
- **Product:** ${input.productTitle || 'Product'}
- **Brand:** ${input.brandName || 'Brand'}
- **Creative route:** ${input.route || 'generate_fresh'}
- **Aspect ratio:** ${input.aspectRatio || '1:1'}
${input.intent ? `- **Parsed intent:** ${input.intent}${input.intentRationale ? ` (${input.intentRationale})` : ''}` : ''}
${input.baseImageBase64 ? '- **Base image:** (attached for visual reference — analyze its composition, lighting, color palette, product identity)' : ''}
${input.baseImageDescription ? `- **Base image description:** ${input.baseImageDescription}` : ''}
${referenceImages.length > 0
    ? `- **Reference images attached:** ${referenceImages.length} image(s) — roles: ${referenceImages.map((img) => img.role || 'reference').join(', ')}. Analyze packaging, materials, color, and composition from the pixels.`
    : input.referenceImageCount
      ? `- **Reference images (count only):** ${input.referenceImageCount} image(s) with roles: ${input.referenceRoles?.join(', ') || 'product/style'}`
      : ''}
${input.brandPersonality ? `- **Brand personality:** ${input.brandPersonality}` : ''}
${input.brandVisualLanguage ? `- **Brand visual language:** ${input.brandVisualLanguage}` : ''}
${input.brandAestheticsBrief ? `\n## BRAND AESTHETICS (must apply)\n${input.brandAestheticsBrief}\n` : ''}
${input.productFacts?.length ? `- **Product facts:** ${input.productFacts.join('; ')}` : ''}
${input.productClaims?.length ? `- **Product claims:** ${input.productClaims.join('; ')}` : ''}
${input.productPreservationRules?.length ? `- **Product preservation rules:** ${input.productPreservationRules.join('; ')}` : ''}
${input.trendInsights?.length ? `- **Trend insights (advisory):** ${input.trendInsights.join('; ')}` : ''}
${intentDirectives.length ? `\n## INTENT DIRECTIVES\n${intentDirectives.map((d) => `- ${d}`).join('\n')}\n` : ''}

## Instructions

Transform the raw prompt into a structured, professional image generation prompt following this proven structure:

**[Subject]** — What is the main subject? Be specific about the product, its placement, and pose.
**[Environment/Setting]** — Where does the scene take place? Describe the setting, background, and atmosphere.
**[Style/Medium]** — Artistic direction (photorealistic, editorial, cinematic, illustration, etc.)
**[Lighting]** — Specific lighting setup (golden hour, studio softbox, dramatic side light, etc.)
**[Camera/Composition]** — Shot type, lens, angle, framing, depth of field
**[Color/Mood]** — Color palette, grading, emotional tone
**[Quality Modifiers]** — Technical quality cues (8K, highly detailed, sharp focus, etc.)

### Critical rules
1. **PRESERVE the user's full original intent** — never shorten or remove what they wrote
2. **Output must be LONGER than input** — add richness, never strip detail
3. **Do NOT invent product claims** not supported by the provided facts
4. **If reference images are attached**, ground product identity, packaging, materials, and colors in what you SEE — describe the scene around the product; do not invent a different SKU
5. **For composite routes**: describe how elements should be combined and positioned
6. **For upgrade/edit routes**: describe enhancements while preserving the original composition
7. **Match the aspect ratio** — composition should work for ${input.aspectRatio || '1:1'}
8. **Stay on-brand** when brand aesthetics are provided — apply palette, lighting, composition, typography cues, and tone from BRAND AESTHETICS
9. **Honor INTENT DIRECTIVES** when present — they encode the parsed creative intent

### Output format

Return your response as JSON:
\`\`\`json
{
  "enhancedPrompt": "The full structured prompt text here...",
  "negativePrompt": "blurry, low quality, distorted, watermark, text overlay, deformed, extra limbs, oversaturated, cartoon style (unless specified), artificial looking, plastic skin, wrong proportions"
}
\`\`\`

The negativePrompt should list things to AVOID in the generation — common artifacts, style mismatches, off-brand colors, and anything that would detract from the intended result. Keep it focused and practical (10-20 items max).`;

  try {
    const parts: any[] = [];

    if (input.baseImageBase64) {
      const inline = toEnhanceInlineData(input.baseImageBase64, input.baseImageMimeType);
      parts.push({ text: 'BASE IMAGE (edit/upgrade ground truth):' });
      parts.push({ inlineData: inline });
    }

    for (const [index, img] of referenceImages.entries()) {
      const inline = toEnhanceInlineData(img.base64, img.mimeType);
      const role = img.role || 'reference';
      const label = img.label || `reference ${index + 1}`;
      parts.push({ text: `REFERENCE IMAGE (${role}): ${label}` });
      parts.push({ inlineData: inline });
    }

    parts.push({ text: systemPrompt });

    // Text-only enhance → GLM 5.3 Flash (Coding Plan) with Gemini fallback.
    // Vision enhance (base/reference images) stays on Gemini Flash.
    const hasVision = Boolean(input.baseImageBase64) || referenceImages.length > 0;
    let raw = '';
    if (!hasVision) {
      const result = await generateAppText({
        prompt: systemPrompt,
        json: true,
        temperature: 0.7,
        maxTokens: 1600,
        role: 'worker',
      });
      usageTracker.trackTokens('enhanceImagePrompt', 0, 0);
      raw = (result.content || '').trim();
    } else {
      const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: TEXT_MODEL,
        contents: { parts },
        config: {
          maxOutputTokens: 1600,
          responseMimeType: 'application/json',
        }
      }));
      usageTracker.trackTokens('enhanceImagePrompt', response.usageMetadata?.promptTokenCount || 0, response.usageMetadata?.candidatesTokenCount || 0);
      raw = (response.text || '').trim();
    }

    // Parse JSON response
    try {
      const parsed = JSON.parse(stripJsonFences(raw, raw));
      return {
        enhancedPrompt: (parsed.enhancedPrompt || raw).trim(),
        negativePrompt: parsed.negativePrompt?.trim() || undefined,
      };
    } catch {
      // Fallback: treat raw text as the enhanced prompt
      return {
        enhancedPrompt: raw || input.rawPrompt,
      };
    }
  } catch (error) {
    console.warn('Image prompt enhancement failed', error);
    return { enhancedPrompt: input.rawPrompt };
  }
};

export const suggestSceneOrder = async (
    input: SceneOrderSuggestionRequest
): Promise<SceneOrderSuggestionResult> => {
    if (input.scenes.length <= 1) {
        return {
            orderedSceneIds: input.scenes.map((scene) => scene.id),
            reasoning: 'Only one scene was available, so no reorder was needed.',
        };
    }

    const prompt = `
You are a short-form creative director reordering storyboard scenes.

Return strict JSON only:
{
  "orderedSceneIds": ["scene-id-1", "scene-id-2"],
  "reasoning": "short explanation of the ordering logic"
}

Goal:
- Reorder the scenes into the strongest sequence for a product ad.
- Respect this optional direction: ${input.reorderPrompt || 'No extra direction provided. Use the strongest default ad order.'}

Use these principles:
- Lead with the strongest hook.
- Follow with problem, proof, demo, transformation, or product logic where relevant.
- End with the cleanest closing or CTA beat.
- Keep the product story coherent.

Scenes:
${JSON.stringify(input.scenes, null, 2)}
`;

    try {
        const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model: TEXT_MODEL,
            contents: { parts: [{ text: prompt }] },
            config: {
                responseMimeType: "application/json",
                maxOutputTokens: 220,
            }
        }));

        usageTracker.trackTokens('suggestSceneOrder', response.usageMetadata?.promptTokenCount || 0, response.usageMetadata?.candidatesTokenCount || 0);
        const parsed = tryParseJSON<{ orderedSceneIds?: string[]; reasoning?: string }>(extractResponseText(response));
        const ordered = parsed?.orderedSceneIds || [];
        const validIds = new Set(input.scenes.map((scene) => scene.id));
        const filtered = ordered.filter((id) => validIds.has(id));
        const missing = input.scenes.map((scene) => scene.id).filter((id) => !filtered.includes(id));
        return {
            orderedSceneIds: filtered.length ? [...filtered, ...missing] : input.scenes.map((scene) => scene.id),
            reasoning: (parsed?.reasoning || 'Reordered scenes to improve hook, flow, proof, and payoff.').trim(),
        };
    } catch (error) {
        console.warn('Scene order suggestion failed', error);
        return {
            orderedSceneIds: input.scenes.map((scene) => scene.id),
            reasoning: 'AI reorder fell back to the current sequence.',
        };
    }
};

export interface SceneTrimSuggestionResult {
    sceneIdToRemove: string;
    reasoning: string;
}

export const suggestSceneTrims = async (
    scenes: Array<{ id: string; text: string; visualDescription: string }>
): Promise<SceneTrimSuggestionResult[]> => {
    if (scenes.length <= 1) return [];

    const prompt = `
You are a ruthless short-form creative director reviewing a storyboard for pacing and redundancy.

Return strict JSON only. Analyze the scenes below and return an array of scenes that should be trimmed/deleted because they are redundant, slow down the pacing, or add no value to the core product proposition.

{
  "trims": [
    {
      "sceneIdToRemove": "exact-scene-id",
      "reasoning": "short explanation of why this scene is unnecessary"
    }
  ]
}

Scenes:
${JSON.stringify(scenes.map(s => ({ id: s.id, text: s.text, visualDescription: s.visualDescription })), null, 2)}
`;

    try {
        const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model: TEXT_MODEL,
            contents: { parts: [{ text: prompt }] },
            config: {
                responseMimeType: "application/json",
            }
        }));

        usageTracker.trackTokens('suggestSceneTrims', response.usageMetadata?.promptTokenCount || 0, response.usageMetadata?.candidatesTokenCount || 0);
        const parsed = tryParseJSON<{ trims?: SceneTrimSuggestionResult[] }>(extractResponseText(response));
        return parsed?.trims || [];
    } catch (error) {
        console.warn('Scene trim suggestion failed', error);
        return [];
    }
};

// Suggest context based on visuals
export const analyzeMediaContext = async (mediaItems: UploadedMedia[]): Promise<string> => {
    const parts = [];

    // Take up to 3 media items to save tokens/bandwidth
    const itemsToAnalyze = mediaItems.slice(0, 3);

    for (const item of itemsToAnalyze) {
        if (item.base64) {
            parts.push({
                inlineData: {
                    data: item.base64,
                    mimeType: item.mimeType,
                },
            });
        }
    }

    const prompt = `
        Look at these visual assets for an Instagram Reel. 
        What is the specific topic or activity shown? 
        
        Provide a concise, 1-sentence description suitable for a script prompt.
        Examples:
        - "A DIY tutorial for making turmeric face mask"
        - "Unboxing a luxury handbag"
        - "Cooking a vegan pasta recipe"
        - "Travel highlights from Bali"

        Output ONLY the description. No intro or filler.
    `;

    parts.push({ text: prompt });

    const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: TEXT_MODEL,
        contents: { parts },
        config: {
            maxOutputTokens: 50,
        }
    }));

    // Track usage
    const inputTokens = response.usageMetadata?.promptTokenCount || 0;
    const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
    usageTracker.trackTokens('Media Context Analysis', inputTokens, outputTokens);

    return response.text?.trim() || "";
};

export const agentViralTopicFinder = async (input: ViralTopicFinderInput): Promise<ViralTopicFinderResult> => {
    const {
        persona,
        creatorProfileUrl,
        referenceUrls,
        baseTopic,
        ideaCount = 6,
        remixIdea,
        remixNotes,
        productContext
    } = input;

    const safeCount = remixIdea ? 1 : Math.min(10, Math.max(1, ideaCount));
    const personaBlock = persona ? `Persona / Channel vibe: ${persona}` : 'Persona / Channel vibe: Not specified';
    const creatorBlock = creatorProfileUrl ? `Creator Profile: ${creatorProfileUrl}` : 'Creator Profile: Not provided';
    const referenceBlock = referenceUrls && referenceUrls.length
        ? `Reference Library:\n${referenceUrls.map((url, idx) => `   ${idx + 1}. ${url}`).join('\n')}`
        : 'Reference Library: none supplied';
    const topicBlock = baseTopic ? `Existing Topic Prompt: ${baseTopic}` : 'Existing Topic Prompt: Not provided';
    const remixBlock = remixIdea ? `REMIX THIS IDEA JSON: ${JSON.stringify(remixIdea)}` : '';
    const remixNotesBlock = remixNotes ? `Manual user edits / constraints: ${remixNotes}` : '';

    const productBlock = productContext && productContext.length
        ? `Product Context (use this in ideas/hooks/angles):\n${productContext.map((p, i) => `   ${i + 1}. ${p}`).join('\n')}`
        : 'Product Context: None provided';

    const taskBlock = remixIdea
        ? `
        TASK: Produce exactly 1 upgraded viral topic inspired by the supplied idea.
        - Keep the core promise but make it fresher, bolder, or more platform native.
        - Respect any manual edits.
        - Highlight why the remix is trend-aligned right now.`
        : `
        TASK: Produce ${safeCount} viral-ready content ideas tailored to the persona/platform.
        - Blend insights from the link/persona with current TikTok/IG/YT short-form trends.
        - Each idea must feel distinct (different hooks, angles, visual styles).
        - If product context exists, lean into product-driven hooks, demos, transformations, before/after, and clear value props.`;

    const prompt = `
        You are "Viral Topic Radar", a trend strategist for short-form creators.
        ${personaBlock}
        ${creatorBlock}
        ${referenceBlock}
        ${topicBlock}
        ${productBlock}
        ${remixBlock}
        ${remixNotesBlock}
        ${taskBlock}

        For context, surface:
        1. Persona Snapshot: label, tone, audience, pain points, preferred platforms, recommended moves.
        2. 3-5 global hashtags that are heating up for this persona.
        3. 3 trend insights (headlines, challenges, cultural moments).
        4. A "freshness radar" list summarizing whether the space is surging, stable, or cooling.

        For each idea include:
        {
            "id": "unique-id",
            "title": "compelling title",
            "hook": "scroll-stopping hook sentence",
            "angle": "unique angle",
            "trendReason": "why this is hot now",
            "hashtagStack": ["#Tag1", "#Tag2"],
            "referenceCreators": ["@handle1", "@handle2"],
            "callToAction": "CTA suggestion",
            "personaNotes": { "tone": "...", "vibe": "...", "audience": "..." },
            "storyStarter": "cold open idea",
            "scriptStarter": "first line of VO",
            "rawTopicLine": "ready-to-use topic sentence"
        }

        Constraints:
        - Study the creator profile/reference library to understand their catalog and tone.
        - Do NOT pitch topics that closely mirror releases already visible in those links—keep it fresh.
        - Call out if an idea is intentionally remixing an older hit, otherwise assume net-new.

        Return valid JSON:
        {
            "personaSummary": { ... },
            "globalHashtags": [],
            "freshnessRadar": [],
            "trendInsights": [],
            "ideas": [ ... ]
        }
    `;

    const result = await generateAppText({
        prompt,
        webSearch: true,
        json: true,
        temperature: 0.75,
        role: 'plan',
    });
    usageTracker.trackTokens('Viral Topic Finder', 0, 0);

    const text = stripJsonFences(result.content);
    const parsed = tryParseJSON<ViralTopicFinderResult>(text);

    if (parsed && parsed.personaSummary && Array.isArray(parsed.ideas)) {
        return parsed;
    }

    return {
        personaSummary: {
            personaLabel: persona || 'Creator',
            tone: 'Authentic',
            audience: 'Social video viewers',
            painPoints: ['Needs fresh hooks'],
            preferredPlatforms: ['Instagram', 'TikTok'],
            recommendedMoves: ['Leverage current audio trends']
        },
        globalHashtags: ['#viral', '#reels'],
        freshnessRadar: ['No live radar data'],
        trendInsights: ['Trend data unavailable, showing fallback ideas.'],
        ideas: []
    };
};

// New function to analyze video and break it into viral segments
export const analyzeVideoStructure = async (
    fileBase64: string,
    mimeType: string,
    duration: number
): Promise<VideoSegment[]> => {
    const prompt = `
        You are a professional Video Editor for viral Instagram Reels.
        Analyze this video footage. It is ${duration} seconds long.
        
        Your task is to segment this single video into 3 to 5 distinct "Viral Moments" or scenes.
        
        For DIY/Herbal/Product videos, look for this narrative arc:
        1. The Hook / Ingredients (Raw materials, opening shot)
        2. The Process (Mixing, grinding, pouring - ASMR focus)
        3. The Texture (Close ups, sensory details)
        4. The Result (Final product, application)
        
        Return a JSON object with a "segments" array.
        Each segment must have:
        - startTime: number (seconds)
        - endTime: number (seconds)
        - description: string (what is happening)
        - reasoning: string (why this is a viral moment)
        
        Ensure the segments cover the most interesting parts of the video.
        Do not overlap segments.
    `;

    const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: TEXT_MODEL,
        contents: {
            parts: [
                { inlineData: { data: fileBase64, mimeType: mimeType } },
                { text: prompt }
            ]
        },
        config: {
            responseMimeType: "application/json",
        }
    }));

    const inputTokens = response.usageMetadata?.promptTokenCount || 0;
    const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
    usageTracker.trackTokens('analyzeVideoStructure', inputTokens, outputTokens);

    const text = extractResponseText(response);
    const result = tryParseJSON<{ segments: VideoSegment[] }>(text);

    if (!result || !result.segments) {
        return [
            { startTime: 0, endTime: duration / 3, description: "Part 1", reasoning: "Automatic split" },
            { startTime: duration / 3, endTime: (duration / 3) * 2, description: "Part 2", reasoning: "Automatic split" },
            { startTime: (duration / 3) * 2, endTime: duration, description: "Part 3", reasoning: "Automatic split" }
        ];
    }

    return result.segments;
};

// --- AGENT 0: TOPIC REFINER (The Gatekeeper) ---
export interface TopicRefinerContext {
    persona?: string;
    creatorProfileUrl?: string;
    referenceUrls?: string[];
    ideaHook?: string;
    ideaAngle?: string;
    ideaTrendReason?: string;
    ideaPersonaNotes?: { tone: string; vibe: string; audience: string };
}

export const agentTopicRefiner = async (rawTopic: string, context?: TopicRefinerContext): Promise<string> => {
    const personaBlock = context?.persona ? `\n        Persona / Channel Vibe: "${context.persona}"` : '';
    const creatorBlock = context?.creatorProfileUrl ? `\n        Creator Profile: ${context.creatorProfileUrl}` : '';
    const referenceBlock = context?.referenceUrls?.length
        ? `\n        Reference Library:\n${context.referenceUrls.map((url, i) => `          ${i + 1}. ${url}`).join('\n')}`
        : '';
    const ideaBlock = context?.ideaHook || context?.ideaAngle || context?.ideaTrendReason
        ? `\n        Scouted Idea Context:\n          Hook: ${context.ideaHook || 'N/A'}\n          Angle: ${context.ideaAngle || 'N/A'}\n          Trend Reason: ${context.ideaTrendReason || 'N/A'}${context.ideaPersonaNotes ? `\n          Persona: tone=${context.ideaPersonaNotes.tone}, vibe=${context.ideaPersonaNotes.vibe}, audience=${context.ideaPersonaNotes.audience}` : ''}`
        : '';

    const prompt = `
        You are a Creative Director refining a brief for a video production team.
        
        Raw User Input: "${rawTopic}"${personaBlock}${creatorBlock}${referenceBlock}${ideaBlock}
        
        Task: Rewrite this input into a specific, engaging, and detailed video topic.
        
        Guidelines:
        1. **ENRICH WITH RESEARCH**: If the input is vague (e.g. "Herbal Tea"), expand it with a specific goal, benefit, or angle (e.g. "DIY Chamomile & Lavender Tea for Deep Sleep & Anxiety Relief").
        2. **USER FEEDBACK**: If the input contains "USER FEEDBACK FOR REVISION", prioritize that instruction above all else.
        3. **VIRAL ANGLE**: Add a hook or promise (e.g. "How to...", "Stop doing this...", "The secret to...").
        4. **NICHE**: Identify the niche (e.g. Skincare, Tech, Cooking).
        5. **PERSONA ALIGNMENT**: If a persona or channel vibe is provided, tailor the tone and angle to match that creator's voice and audience.
        6. **REFERENCE INSPIRATION**: If reference links are provided, draw inspiration from their formats and styles but do NOT copy them directly.
        7. **SCOUTED IDEA**: If scouted idea context is provided, incorporate the hook, angle, and trend reason into the refined topic.
        
        Output ONLY the refined topic sentence.
    `;

    const result = await generateAppText({
        prompt,
        temperature: 0.7,
        role: 'worker',
    });
    usageTracker.trackTokens('Topic Refiner', 0, 0);

    return result.content?.trim() || rawTopic;
};

// --- AGENT 1: BRAND ANALYST ---
export const analyzeBrandAesthetics = async (brandKit: BrandKit): Promise<string> => {
    const parts = [];

    if (brandKit.logo) {
        parts.push({
            inlineData: { data: brandKit.logo.base64, mimeType: brandKit.logo.mimeType }
        });
        parts.push({ text: "Image 1: Brand Logo." });
    }

    if (brandKit.productImages && brandKit.productImages.length > 0) {
        brandKit.productImages.forEach((prod, idx) => {
            parts.push({
                inlineData: { data: prod.base64, mimeType: prod.mimeType }
            });
            parts.push({ text: `Image ${idx + 2}: Product Shot.` });
        });
    }

    const prompt = `
        Analyze the brand aesthetic based on the provided inputs (Logo and Products).
        
        Brand Inputs:
        - Color: ${brandKit.hexColor || 'Not specified'}
        - Website: ${brandKit.websiteUrl || 'Not specified'}

        Task:
        1. Describe the "Brand Vibe" (3 adjectives).
        2. **VISUAL IDENTITY (CRITICAL)**: Describe the specific physical appearance of the logo and products.
           - Geometry (Cylindrical, Boxy, Round)
           - Material (Glass, Matte Plastic, Kraft Paper)
           - Exact Colors & Finishes (Gold foil, Pastel Pink, Amber Glass)
        3. Create a "Visual Signature" summary that can be passed to an image generator to recreate the product.
        4. If product images are provided, list them as: "Available Images - Image 0: [Description], Image 1: [Description]" so the downstream agent can reference them.
        
        Output format: "Vibe: [Adjectives]. Visual Signature: [Detailed Physical Description]. Setting: [Suggested Environment]. [Available Images]"
    `;
    parts.push({ text: prompt });

    const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: TEXT_MODEL,
        contents: { parts },
        config: { maxOutputTokens: 300 }
    }));

    // Track usage
    usageTracker.trackTokens('Brand Analysis', response.usageMetadata?.promptTokenCount || 0, response.usageMetadata?.candidatesTokenCount || 0);

    return response.text?.trim() || "Clean and professional style.";
};

export const catalogBrandAssets = async (brandKit: BrandKit): Promise<BrandAssetCatalogEntry[]> => {
    const inputAssets = [
        ...(brandKit.logo ? [{ ...brandKit.logo, source: 'logo' as const, imageIndex: 0 }] : []),
        ...((brandKit.productImages || []).map((asset, index) => ({
            ...asset,
            source: 'product' as const,
            imageIndex: index
        })))
    ];

    if (!inputAssets.length) return [];

    const parts: any[] = [];
    inputAssets.forEach((asset, index) => {
        parts.push({
            inlineData: {
                data: asset.base64,
                mimeType: asset.mimeType
            }
        });
        parts.push({
            text: `Asset ${index}: source=${asset.source}, originalImageIndex=${asset.imageIndex}.`
        });
    });

    const prompt = `
        Analyze the attached brand assets and return ONLY valid JSON as:
        {
          "assets": [
            {
              "assetId": "string",
              "source": "logo" | "product",
              "semanticDescription": "short concrete description",
              "productIdentity": "stable product identity",
              "shotType": "logo" | "packshot" | "lifestyle" | "detail" | "unknown",
              "imageIndex": number,
              "framingMode": "cover" | "contain",
              "framingFocusY": number,
              "presentationReason": "why this should be cropped or fitted"
            }
          ]
        }

        Rules:
        - Keep productIdentity stable across similar product shots.
        - Prefer "packshot" for clean bottle/product photos on simple backgrounds.
        - Prefer "detail" for close-ups and texture shots.
        - Use "contain" when important text, labels, claims, ingredient callouts, pricing, or product edges would be lost by a vertical crop.
        - Use "cover" when the image is a lifestyle or ambient shot where filling the frame is more important than preserving full boundaries.
        - framingFocusY must be 0..1 and only meaningfully different from 0.5 when cover is the better choice.
        - Use the provided source and imageIndex values.
    `;
    parts.push({ text: prompt });

    try {
        const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model: TEXT_MODEL,
            contents: { parts },
            config: { responseMimeType: "application/json", maxOutputTokens: 600 }
        }));

        usageTracker.trackTokens('catalogBrandAssets', response.usageMetadata?.promptTokenCount || 0, response.usageMetadata?.candidatesTokenCount || 0);

        const parsed = tryParseJSON<{ assets?: BrandAssetCatalogEntry[] }>(extractResponseText(response));
        if (parsed?.assets?.length) {
            return parsed.assets.map((asset, index) => ({
                assetId: asset.assetId || inputAssets[index]?.assetId || `brand-asset-${index}`,
                source: asset.source || inputAssets[index]?.source || 'product',
                semanticDescription: asset.semanticDescription || inputAssets[index]?.description || `Brand asset ${index + 1}`,
                productIdentity: asset.productIdentity || brandKit.visualSignature || 'Uploaded brand product',
                shotType: asset.shotType || 'unknown',
                imageIndex: typeof asset.imageIndex === 'number' ? asset.imageIndex : inputAssets[index]?.imageIndex,
                framingMode: asset.framingMode === 'contain' ? 'contain' : 'cover',
                framingFocusY: typeof asset.framingFocusY === 'number' ? Math.min(1, Math.max(0, asset.framingFocusY)) : 0.5,
                presentationReason: asset.presentationReason || asset.semanticDescription || inputAssets[index]?.description
            }));
        }
    } catch (error) {
        console.warn('Brand asset cataloging failed, falling back to local metadata', error);
    }

    return inputAssets.map((asset, index) => ({
        assetId: asset.assetId || `brand-asset-${index}`,
        source: asset.source,
        semanticDescription: asset.description || `${asset.source === 'logo' ? 'Brand logo' : 'Uploaded product image'} ${index + 1}`,
        productIdentity: asset.productIdentity || brandKit.visualSignature || 'Uploaded brand product',
        shotType: asset.shotType as BrandAssetCatalogEntry['shotType'] || (asset.source === 'logo' ? 'logo' : 'packshot'),
        imageIndex: asset.imageIndex,
        framingMode: asset.source === 'logo' ? 'contain' : 'cover',
        framingFocusY: 0.5,
        presentationReason: asset.source === 'logo'
            ? 'Keep the full logo visible in frame.'
            : 'Default product framing.'
    }));
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const inferProductAssetHeuristics = (
    asset: BrandAsset,
    index: number,
    productTitle?: string,
    brandName?: string,
): BrandAsset => {
    const text = `${asset.description || ''} ${asset.sourceProductTitle || productTitle || ''}`.toLowerCase();
    const normalizedBrand = (brandName || '').toLowerCase();
    const normalizedProduct = (productTitle || asset.sourceProductTitle || '').toLowerCase();

    const shotType: NonNullable<BrandAsset['shotType']> =
        /bundle|kit|set/.test(text) ? 'bundle'
        : /before|after|compare|comparison|versus|vs\b/.test(text) ? 'comparison'
        : /infographic|chart|claim|benefit|ingredient list|how to use|directions|label callout|text/.test(text) ? 'infographic'
        : /ingredient|botanical|vitamin|oat|honey|chamomile|niacinamide|ceramide/.test(text) ? 'ingredient'
        : /texture|foam|lather|drop|swatch|macro|close up|close-up/.test(text) ? 'texture'
        : /hand|holding|woman|man|face|model|bathroom|sink|mirror|routine/.test(text) ? 'model_with_product'
        : /lifestyle|counter|shelf|vanity|ambient|scene/.test(text) ? 'lifestyle'
        : /detail/.test(text) ? 'detail'
        : 'packshot';

    const framingMode: NonNullable<BrandAsset['framingMode']> =
        shotType === 'infographic' || /label|text|claims|box|packaging|full bottle/.test(text)
            ? 'contain'
            : shotType === 'model_with_product' || shotType === 'lifestyle'
                ? 'cover'
                : 'cover';

    const framingFocusY =
        shotType === 'model_with_product' || shotType === 'lifestyle'
            ? 0.45
            : 0.5;

    const productVisibility = clamp01(
        shotType === 'packshot' ? 0.95
        : shotType === 'bundle' ? 0.9
        : shotType === 'detail' ? 0.82
        : shotType === 'model_with_product' ? 0.7
        : shotType === 'lifestyle' ? 0.62
        : shotType === 'comparison' ? 0.58
        : shotType === 'ingredient' ? 0.42
        : shotType === 'texture' ? 0.28
        : shotType === 'infographic' ? 0.35
        : 0.5
    );

    const labelReadability = clamp01(
        framingMode === 'contain' && shotType === 'packshot' ? 0.9
        : shotType === 'packshot' ? 0.78
        : shotType === 'bundle' ? 0.66
        : shotType === 'detail' ? 0.55
        : shotType === 'comparison' ? 0.52
        : shotType === 'model_with_product' ? 0.42
        : shotType === 'lifestyle' ? 0.32
        : shotType === 'infographic' ? 0.88
        : 0.18
    );

    const quality: NonNullable<BrandAsset['quality']> =
        index === 0 && (shotType === 'packshot' || shotType === 'bundle') ? 'hero'
        : shotType === 'packshot' || shotType === 'bundle' || shotType === 'detail' ? 'strong'
        : shotType === 'model_with_product' || shotType === 'lifestyle' || shotType === 'comparison' ? 'usable'
        : 'weak';

    const editability: NonNullable<BrandAsset['editability']> =
        shotType === 'packshot' || shotType === 'detail' || shotType === 'texture'
            ? 'safe_to_edit'
            : shotType === 'model_with_product' || shotType === 'lifestyle' || shotType === 'bundle'
                ? 'safe_to_outpaint'
                : 'reference_only';

    const identityRisk: NonNullable<BrandAsset['identityRisk']> =
        shotType === 'packshot' || shotType === 'bundle'
            ? 'low'
            : shotType === 'detail' || shotType === 'comparison' || shotType === 'model_with_product'
                ? 'medium'
                : 'high';

    const bestSceneRoles =
        shotType === 'packshot' ? ['hook hero', 'cta close-up', 'product truth']
        : shotType === 'bundle' ? ['bundle reveal', 'cta anchor']
        : shotType === 'detail' ? ['proof beat', 'texture demo']
        : shotType === 'texture' ? ['ingredient metaphor', 'proof support']
        : shotType === 'ingredient' ? ['ingredient support', 'visual metaphor']
        : shotType === 'model_with_product' ? ['social proof', 'lifestyle proof']
        : shotType === 'lifestyle' ? ['world-building', 'supporting scene']
        : shotType === 'comparison' ? ['before/after', 'proof beat']
        : shotType === 'infographic' ? ['reference only']
        : ['supporting scene'];

    const verdict: NonNullable<BrandAsset['verdict']> =
        shotType === 'infographic'
            ? 'do_not_use'
            : (quality === 'hero' || (quality === 'strong' && shotType === 'packshot'))
                ? 'use_as_is'
                : editability === 'reference_only'
                    ? 'good_reference'
                    : 'can_upgrade';

    const verdictReason =
        verdict === 'use_as_is'
            ? 'Strong product-first shot that can anchor a scene without heavy transformation.'
            : verdict === 'can_upgrade'
                ? 'Good base image that can be improved with tighter framing, lighting, or scene extension.'
                : verdict === 'good_reference'
                    ? 'Useful for style, ingredient, or continuity reference, but weak as a final frame.'
                    : 'Text-heavy or structurally awkward for vertical ad scenes.';

    const semanticDescription = asset.semanticDescription
        || asset.description
        || `${normalizedProduct || normalizedBrand || 'product'} ${shotType}`;
    const productIdentity = asset.productIdentity
        || asset.sourceProductTitle
        || productTitle
        || brandName
        || 'Imported product';

    return {
        ...asset,
        semanticDescription,
        productIdentity,
        shotType,
        framingMode,
        framingFocusY,
        presentationReason: asset.presentationReason || (
            framingMode === 'contain'
                ? 'Preserve the full product, label, or text hierarchy in frame.'
                : 'Fill the vertical frame and prioritize visual impact.'
        ),
        quality,
        editability,
        identityRisk,
        productVisibility,
        labelReadability,
        bestSceneRoles,
        verdict,
        verdictReason,
    };
};

const getProductAssetAnalysisLimit = (executionMode: ExecutionMode = 'balanced'): number => {
    switch (executionMode) {
        case 'fast':
            return 4;
        case 'agency':
            return 8;
        case 'balanced':
        default:
            return 6;
    }
};

export const analyzeProductAssets = async ({
    assets,
    productTitle,
    brandName,
    executionMode = 'balanced',
}: {
    assets: BrandAsset[];
    productTitle?: string;
    brandName?: string;
    executionMode?: ExecutionMode;
}): Promise<BrandAsset[]> => {
    const baseAssets = assets.map((asset, index) => inferProductAssetHeuristics(asset, index, productTitle, brandName));
    if (!baseAssets.length || !hasConfiguredGeminiApiKey()) {
        return baseAssets;
    }

    const analyzableAssets = baseAssets
        .filter((asset) => Boolean(asset.base64))
        .slice(0, getProductAssetAnalysisLimit(executionMode));

    if (!analyzableAssets.length) {
        return baseAssets;
    }

    const parts: any[] = [];
    analyzableAssets.forEach((asset, index) => {
        parts.push({
            inlineData: {
                data: asset.base64,
                mimeType: asset.mimeType || 'image/jpeg',
            }
        });
        parts.push({
            text: `Asset ${index}: assetId=${asset.id}; existingDescription=${asset.description || 'Not provided'}; sourceProductTitle=${asset.sourceProductTitle || productTitle || 'Not provided'}.`
        });
    });

    const prompt = `
        Analyze the attached imported product assets for a short-form ad system.

        Return ONLY valid JSON:
        {
          "assets": [
            {
              "assetId": "string",
              "semanticDescription": "short concrete description",
              "productIdentity": "stable product identity",
              "shotType": "packshot" | "lifestyle" | "detail" | "texture" | "ingredient" | "model_with_product" | "infographic" | "comparison" | "bundle" | "unknown",
              "framingMode": "cover" | "contain",
              "framingFocusY": number,
              "presentationReason": "string",
              "quality": "hero" | "strong" | "usable" | "weak",
              "editability": "safe_to_edit" | "safe_to_outpaint" | "reference_only",
              "identityRisk": "low" | "medium" | "high",
              "productVisibility": number,
              "labelReadability": number,
              "bestSceneRoles": ["string"],
              "verdict": "use_as_is" | "can_upgrade" | "good_reference" | "do_not_use",
              "verdictReason": "string"
            }
          ]
        }

        Context:
        - Brand name: ${brandName || 'Not provided'}
        - Product title: ${productTitle || 'Not provided'}

        Rules:
        - Keep productIdentity stable across similar shots.
        - Use numbers 0..1 for framingFocusY, productVisibility, and labelReadability.
        - "use_as_is" means it can plausibly ship as a final scene image with crop/reframe only.
        - "can_upgrade" means the asset is a strong base for edits or scene extension.
        - "good_reference" means useful for grounding, texture, ingredients, or continuity, but weak as the final frame.
        - "do_not_use" means poor fit for direct scene use in a vertical ad.
        - Prefer "contain" when labels, claims, or product edges would be lost by aggressive vertical cropping.
        - Prefer "cover" when the image is atmospheric or lifestyle-oriented.
    `;
    parts.push({ text: prompt });

    try {
        const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model: TEXT_MODEL,
            contents: { parts },
            config: { responseMimeType: "application/json", maxOutputTokens: 1200 }
        }));

        usageTracker.trackTokens('analyzeProductAssets', response.usageMetadata?.promptTokenCount || 0, response.usageMetadata?.candidatesTokenCount || 0);
        const parsed = tryParseJSON<{ assets?: Array<Partial<BrandAsset> & { assetId?: string }> }>(extractResponseText(response));
        const byId = new Map((parsed?.assets || []).map((asset) => [asset.assetId, asset]));

        return baseAssets.map((asset) => {
            const aiAsset = byId.get(asset.id);
            if (!aiAsset) return asset;

            return {
                ...asset,
                semanticDescription: aiAsset.semanticDescription || asset.semanticDescription,
                productIdentity: aiAsset.productIdentity || asset.productIdentity,
                shotType: aiAsset.shotType || asset.shotType,
                framingMode: aiAsset.framingMode === 'contain' ? 'contain' : (aiAsset.framingMode === 'cover' ? 'cover' : asset.framingMode),
                framingFocusY: typeof aiAsset.framingFocusY === 'number' ? clamp01(aiAsset.framingFocusY) : asset.framingFocusY,
                presentationReason: aiAsset.presentationReason || asset.presentationReason,
                quality: aiAsset.quality || asset.quality,
                editability: aiAsset.editability || asset.editability,
                identityRisk: aiAsset.identityRisk || asset.identityRisk,
                productVisibility: typeof aiAsset.productVisibility === 'number' ? clamp01(aiAsset.productVisibility) : asset.productVisibility,
                labelReadability: typeof aiAsset.labelReadability === 'number' ? clamp01(aiAsset.labelReadability) : asset.labelReadability,
                bestSceneRoles: Array.isArray(aiAsset.bestSceneRoles) && aiAsset.bestSceneRoles.length ? aiAsset.bestSceneRoles.filter(Boolean) as string[] : asset.bestSceneRoles,
                verdict: aiAsset.verdict || asset.verdict,
                verdictReason: aiAsset.verdictReason || asset.verdictReason,
            };
        });
    } catch (error) {
        console.warn('Product asset analysis failed, falling back to heuristics', error);
        return baseAssets;
    }
};

export const analyzeImagePresentation = async (
    image: Pick<UploadedMedia, 'base64' | 'mimeType' | 'description' | 'imagePrompt'>,
    context?: { sceneText?: string; sourceHint?: string }
): Promise<Pick<UploadedMedia, 'aiFramingMode' | 'aiFramingFocusY' | 'aiPresentationReason'>> => {
    if (!image.base64) {
        return {
            aiFramingMode: 'cover',
            aiFramingFocusY: 0.5,
            aiPresentationReason: 'No inline image data available for analysis.'
        };
    }

    const parts: any[] = [
        {
            inlineData: {
                data: image.base64,
                mimeType: image.mimeType
            }
        }
    ];

    const prompt = `
        Analyze this image for short-form vertical video framing.

        Context:
        - Description: ${image.description || 'Not provided'}
        - Image prompt: ${image.imagePrompt || 'Not provided'}
        - Scene text: ${context?.sceneText || 'Not provided'}
        - Source hint: ${context?.sourceHint || 'Not provided'}

        Return ONLY valid JSON:
        {
          "framingMode": "cover" | "contain",
          "framingFocusY": number,
          "presentationReason": "short explanation"
        }

        Decision rules:
        - Choose "contain" if text, labels, claims, ingredient callouts, UI-like layouts, product edges, or infographic content must remain fully visible.
        - Choose "contain" for tall product page images, posters, screenshots, or catalog cards where crop loss would hurt comprehension.
        - Choose "cover" for lifestyle, atmospheric, model, or abstract shots where immersion matters more than preserving every edge.
        - framingFocusY must be between 0 and 1.
        - If framingMode is "contain", use framingFocusY = 0.5.
      `;
    parts.push({ text: prompt });

    try {
        const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model: TEXT_MODEL,
            contents: { parts },
            config: { responseMimeType: "application/json", maxOutputTokens: 200 }
        }));

        usageTracker.trackTokens('analyzeImagePresentation', response.usageMetadata?.promptTokenCount || 0, response.usageMetadata?.candidatesTokenCount || 0);
        const parsed = tryParseJSON<{
            framingMode?: 'cover' | 'contain';
            framingFocusY?: number;
            presentationReason?: string;
        }>(extractResponseText(response));

        return {
            aiFramingMode: parsed?.framingMode === 'contain' ? 'contain' : 'cover',
            aiFramingFocusY: typeof parsed?.framingFocusY === 'number' ? Math.min(1, Math.max(0, parsed.framingFocusY)) : 0.5,
            aiPresentationReason: parsed?.presentationReason || 'Gemini-selected framing.'
        };
    } catch (error) {
        console.warn('Image presentation analysis failed', error);
        return {
            aiFramingMode: 'cover',
            aiFramingFocusY: 0.5,
            aiPresentationReason: 'Fallback framing applied after analysis failure.'
        };
    }
};

export const suggestSceneImageEdit = async (
    image: Pick<UploadedMedia, 'base64' | 'mimeType' | 'description' | 'imagePrompt'>,
    context?: {
        sceneText?: string;
        previousSceneText?: string;
        nextSceneText?: string;
        brandContext?: string;
        sourceHint?: string;
    }
): Promise<{
    imagePrompt: string;
    reasoning: string;
    framingMode: 'cover' | 'contain';
    framingFocusY: number;
}> => {
    if (!image.base64) {
        throw new Error('Cannot suggest image edit: no inline image data is available for this scene. Upload or generate an image first.');
    }

    const parts: any[] = [
        {
            inlineData: {
                data: image.base64,
                mimeType: image.mimeType
            }
        }
    ];

    const prompt = `
        You are an art director improving an existing scene image for a vertical short-form video.

        Analyze the image itself, then return ONLY valid JSON with:
        {
          "imagePrompt": "a production-ready edit prompt",
          "reasoning": "why this edit direction makes the scene better",
          "framingMode": "cover" | "contain",
          "framingFocusY": number
        }

        Context:
        - Scene text: ${context?.sceneText || 'Not provided'}
        - Previous scene text: ${context?.previousSceneText || 'Not provided'}
        - Next scene text: ${context?.nextSceneText || 'Not provided'}
        - Brand context: ${context?.brandContext || 'Not provided'}
        - Existing prompt: ${image.imagePrompt || 'Not provided'}
        - Visual description: ${image.description || 'Not provided'}
        - Source hint: ${context?.sourceHint || 'Not provided'}

        Editing rules:
        - Prioritize a sensual, high-end aesthetic: emphasize intimate lighting, evocative textures, and a premium "world-building" feel.
        - Preserve the core subject and product identity if the image is product-based.
        - If the image doesn't fit the 'sensual' narrative of the scene, suggest an 'imagined' edit that elevates the mood.
        - If the image is text-heavy, a product card, a screenshot, a benefit graphic, or a tall catalog-style asset, prefer contain and preserve the full readable content.
        - If the image is a lifestyle or atmospheric shot, prefer cover and make the composition more cinematic, energetic, and usable in a 9:16 reel.
        - The prompt should describe an improved version of the existing image, not a random new concept.
        - Include "NO TEXT, NO WATERMARKS" only when the scene does not need to preserve embedded readable text.
        - Keep the prompt concise, specific, and generator-friendly.
    `;
    parts.push({ text: prompt });

    try {
        const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model: TEXT_MODEL,
            contents: { parts },
            config: { responseMimeType: "application/json", maxOutputTokens: 220 }
        }));

        usageTracker.trackTokens('suggestSceneImageEdit', response.usageMetadata?.promptTokenCount || 0, response.usageMetadata?.candidatesTokenCount || 0);
        const parsed = tryParseJSON<{
            imagePrompt?: string;
            reasoning?: string;
            framingMode?: 'cover' | 'contain';
            framingFocusY?: number;
        }>(extractResponseText(response));

        return {
            imagePrompt: (parsed?.imagePrompt || image.imagePrompt || image.description || 'Vertical 9:16 scene, NO TEXT, NO WATERMARKS').trim(),
            reasoning: parsed?.reasoning || 'Gemini suggested a more usable edit direction.',
            framingMode: parsed?.framingMode === 'contain' ? 'contain' : 'cover',
            framingFocusY: typeof parsed?.framingFocusY === 'number' ? Math.min(1, Math.max(0, parsed.framingFocusY)) : 0.5,
        };
    } catch (error) {
        console.warn('Scene image edit suggestion failed', error);
        return {
            imagePrompt: image.imagePrompt || image.description || 'Vertical 9:16 scene, NO TEXT, NO WATERMARKS',
            reasoning: 'Fallback edit suggestion after AI analysis failure.',
            framingMode: 'cover',
            framingFocusY: 0.5,
        };
    }
};

export const planLockedProductSceneBindings = async (
    brief: CampaignBrief,
    concept: AdConcept,
    productContext: ProductContext,
): Promise<SceneContract[]> => {
    const productAssets = productContext.productAssets || [];
    if (!concept.scenes.length || !productAssets.length) return [];

    const parts: any[] = [];
    productAssets.slice(0, 6).forEach((asset, index) => {
        parts.push({
            inlineData: {
                data: asset.base64,
                mimeType: asset.mimeType
            }
        });
        parts.push({
            text: `Locked product asset ${index + 1}: assetId=${asset.id}; description=${asset.description}; sourceUrl=${asset.sourceUrl || 'n/a'}.`
        });
    });

    const prompt = `
You are a product-lock scene binding director for short-form ads.

Mission:
- Keep ONE exact locked product identity across every scene.
- Decide whether each scene should:
  1. "use_exact_asset"
  2. "crop_reframe_asset"
  3. "edit_from_asset"
  4. "generate_matching_shot"
  5. "generate_fresh"

Inputs:
- Product title: ${productContext.productTitle}
- Product URL: ${productContext.productUrl}
- Brand: ${productContext.brandName}
- Platform: ${brief.platform}
- Duration: ${brief.durationSec || 'N/A'}s
- Ad Format: ${brief.adFormat || 'stitched_video'}
- Allowed claims: ${productContext.allowedClaims.join(' | ') || 'None provided'}
- Product facts: ${productContext.productFacts.join(' | ') || 'None provided'}
- Concept title: ${concept.title}
- Narrative: ${concept.narrative}
- Creative rationale: ${concept.creativeRationale}
- Scenes JSON: ${JSON.stringify(concept.scenes)}

- Preferred scene plan (honor these when present): ${JSON.stringify((brief.preferredScenes || []).map((scene) => ({
  sceneNumber: scene.sceneNumber,
  sourceMode: scene.sourceMode,
  assetId: scene.assetId || null,
  visualDescription: scene.visualDescription,
  imagePrompt: scene.imagePrompt,
})))}

Rules:
- No silent product switching. Only use the locked product and its references.
- If preferred sourceMode is "generate_fresh" and no preferred assetId, set assetId to null — do not invent a catalog binding.
- Prioritize the 'Sensual Narrative Arc': if a scene is better served by a new visual beat than a strictly bound asset, favor 'generate_matching_shot' or 'generate_fresh'.
- Use the Brand DNA Aesthetic Tags to inform the 'imagePrompt' and 'visualIntent'.
- Provide a 'directorsNote' for every scene explaining the creative choice (e.g. "This scene builds tension using a macro texture shot before the product reveal").

Return ONLY valid JSON:
{
  "scenes": [
    {
      "sceneNumber": 1,
      "sourceMode": "use_exact_asset",
      "assetId": "string or null",
      "reason": "short explanation",
      "visualIntent": "updated visual intent",
      "imagePrompt": "prompt for edit/generation",
      "directorsNote": "creative rationale for this scene",
      "cameraMovement": "string"
    }
  ]
}
`;
    parts.push({ text: prompt });

    const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: PLAN_MODEL,
        contents: { parts },
        config: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 1800 }
    }));

    usageTracker.trackTokens('planLockedProductSceneBindings', response.usageMetadata?.promptTokenCount || 0, response.usageMetadata?.candidatesTokenCount || 0);
    const parsed = tryParseJSON<{
        scenes?: Array<{
            sceneNumber?: number;
            sourceMode?: SceneSourceMode;
            assetId?: string | null;
            reason?: string;
            visualIntent?: string;
            imagePrompt?: string;
            directorsNote?: string;
            cameraMovement?: string;
        }>
    }>(extractResponseText(response));

    if (!parsed?.scenes?.length) return [];

    return concept.scenes.map((scene, index) => {
        const aiScene = parsed.scenes?.find((entry) => entry.sceneNumber === (scene.sceneNumber || index + 1));
        const preferred = brief.preferredScenes?.find((entry) => entry.sceneNumber === (scene.sceneNumber || index + 1))
            || brief.preferredScenes?.[index];
        const fallbackAsset = productAssets[Math.min(index, productAssets.length - 1)] || productAssets[0];
        const sourceMode = preferred?.sourceMode
            || aiScene?.sourceMode
            || (index === concept.scenes.length - 1 ? 'use_exact_asset' : 'edit_from_asset');
        let boundAssetId: string | undefined = preferred?.assetId
            || aiScene?.assetId
            || undefined;
        if (sourceMode === 'generate_fresh') {
            // Keep only an explicit preferred/generated asset; never invent a catalog thumb.
            boundAssetId = preferred?.assetId || undefined;
        } else if (!boundAssetId) {
            boundAssetId = fallbackAsset?.id;
        }
        // Reject AI inventing an asset id that is not in the locked set.
        if (boundAssetId && !productAssets.some((asset) => asset.id === boundAssetId)) {
            boundAssetId = sourceMode === 'generate_fresh' ? undefined : fallbackAsset?.id;
        }
        return {
            sceneId: `scene_${scene.sceneNumber || index + 1}`,
            sceneNumber: scene.sceneNumber || index + 1,
            role: index === 0 ? 'HOOK' : index === concept.scenes.length - 1 ? 'CTA' : 'SCENE',
            // Use AI-suggested duration if provided (clamped), otherwise calculate from total duration
            durationTargetSec: scene.durationSec 
                ? Math.max(1, Math.min(30, Number(scene.durationSec)))
                : Math.max(3, (brief.durationSec || 30) / Math.max(1, concept.scenes.length)),
            platform: brief.platform,
            objective: brief.objective,
            adFormat: brief.adFormat || 'stitched_video',
            voiceoverText: scene.voiceoverText || '',
            onScreenText: scene.onScreenText || scene.voiceoverText || '',
            visualIntent: aiScene?.visualIntent || scene.visualDescription || '',
            imagePrompt: aiScene?.imagePrompt || scene.imagePrompt || scene.visualDescription || '',
            directorsNote: aiScene?.directorsNote || '',
            sourceMode,
            assetBindings: boundAssetId ? [{
                assetId: boundAssetId,
                mode: sourceMode,
                reason: preferred?.assetId
                    ? 'Honored preferred storyboard asset binding.'
                    : aiScene?.reason || 'Bound to the locked product asset for identity-safe generation.',
                required: sourceMode !== 'generate_fresh',
            }] : [],
            cameraMovement: aiScene?.cameraMovement || scene.cameraMovement,
            status: 'planned',
        };
    });
};

// --- MERGED RESEARCH AGENT ---
// Replaces the 3 separate agents (Trend Scout, Deep Research, Viral Analyzer) with a single
// Google Search-grounded call. Same data, 2 fewer API calls, ~2x faster.
export interface CombinedResearchResult {
    trendReport: TrendReport;
    researchReport: ResearchReport;
    viralReport: ViralAnalysisReport;
}

export const agentResearch = async (topic: string): Promise<CombinedResearchResult> => {
    const prompt = `
You are a combined Social Media Research Agent with three specialties.
Topic: "${topic}".

Using web research, return ALL of the following in a single JSON object:

1. TREND ANALYSIS (Instagram/TikTok viral patterns):
   - 3 specific viral hooks (opening lines that stop the scroll)
   - Trending visual style for this niche
   - Trending audio vibe
   - Optimal video duration: Educational/Storytelling = 30-50s, Quick tips/Memes = 10-20s. Max 60s.

2. DEEP RESEARCH (subject matter expertise):
   - 3 specific key facts or "did you know?" stats (not generic advice)
   - Common myths to debunk
   - Logical step-by-step flow if applicable
   - Depth score 1-10: 1-4=surface level, 5-7=moderate specifics, 8-10=complex/academic. Most social content is 4-6.

3. VIRAL FORMAT ANALYSIS (top-performing reel structure):
   - Winning narrative format (e.g. "Problem -> Agitation -> Solution")
   - Specific visual hooks (shot types, transitions, moments)
   - Audio signature
   - Mistakes to avoid

Return ONLY strict JSON:
{
    "trendReport": {
        "viralHooks": ["Hook 1", "Hook 2", "Hook 3"],
        "visualStyle": "string",
        "trendingAudio": "string",
        "optimalDuration": 30
    },
    "researchReport": {
        "keyFacts": ["Fact 1", "Fact 2", "Fact 3"],
        "commonMyths": ["Myth 1"],
        "stepByStep": ["Step 1", "Step 2"],
        "depthScore": 5
    },
    "viralReport": {
        "winningFormat": "string",
        "visualHooks": ["string", "string"],
        "audioSignature": "string",
        "mistakesToAvoid": ["string", "string"]
    }
}
    `;

    const result = await generateAppText({
        prompt,
        webSearch: true,
        json: true,
        temperature: 0.6,
        role: 'plan',
    });
    usageTracker.trackTokens('agentResearch', 0, 0);

    const text = stripJsonFences(result.content);
    const parsed = tryParseJSON<CombinedResearchResult>(text);
    return {
        trendReport: parsed?.trendReport || { viralHooks: [], visualStyle: '', trendingAudio: '', optimalDuration: 30 },
        researchReport: parsed?.researchReport || { keyFacts: [], commonMyths: [], depthScore: 0 },
        viralReport: parsed?.viralReport || { winningFormat: 'Standard', visualHooks: [], audioSignature: 'Upbeat', mistakesToAvoid: [] },
    };
};

const reviewAndRefineReelScript = async (params: {
    userPrompt: string;
    style: ScriptStyle;
    userMusicVibe?: string;
    mediaDescriptions: string[];
    script: ReelScript;
}): Promise<ReelScript> => {
    const { userPrompt, style, userMusicVibe, mediaDescriptions, script } = params;

    let styleInstruction = "Professional, engaging, and clear social media tone.";
    if (style === ScriptStyle.IndianDesi) styleInstruction = "Write in 'Hinglish'. Use popular Indian slang (e.g., 'Yaar', 'Bhai').";
    else if (style === ScriptStyle.GenZ) styleInstruction = "Use Gen Z slang. Keep it very fast-paced.";
    else if (style === ScriptStyle.Funny) styleInstruction = "Be witty, sarcastic, and self-deprecating.";
    else if (style === ScriptStyle.Motivational) styleInstruction = "Use short, punchy, high-energy sentences.";

    const count = Math.max(0, mediaDescriptions.length);

    const prompt = `
        You are an Internal QA Reviewer for Instagram Reel scripts.

        Your job: Critique and then FIX the script so it is high-retention, non-generic, and synced for talking-head delivery.

        HARD RULES:
        - Return ONLY valid JSON (no markdown).
        - Output must follow the SAME schema as the input script.
        - You MUST return EXACTLY ${count} segmentPlans items (index 0..${Math.max(0, count - 1)}).
        - Every segment must add NEW information; no filler.
        - Preserve useful specifics, claims, and explanation already present in the script instead of over-compressing it.

        TALKING-HEAD RULES:
        - voiceoverText is what will be spoken. Usually 12-32 words, and may go longer if needed for a clear thought.
        - onScreenText should closely mirror voiceoverText (near-verbatim), split into 1-2 short lines, without stripping out the core meaning.
        - Use ALL CAPS for only 1-2 keywords.
        - visualBeat must include delivery notes (pause/gesture/expression) + simple framing note.
        - durationSec must be between 1.0 and 6.0.

        TONE:
        - Infer the best tone from the topic/intent ("${userPrompt}") and keep it consistent.
        - If STYLE conflicts, prefer STYLE but keep talking-head pacing.
        - STYLE: ${styleInstruction}
        - Music request: ${userMusicVibe || "None provided"}

        Media context (one per segment):
        ${mediaDescriptions.map((d, i) => `${i}: ${d || ''}`).join('\n')}

        Input Script JSON:
        ${JSON.stringify(script)}
    `;

    const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: TEXT_MODEL,
        contents: { parts: [{ text: prompt }] },
        config: { responseMimeType: "application/json" }
    }));

    usageTracker.trackTokens('reviewAndRefineReelScript', response.usageMetadata?.promptTokenCount || 0, response.usageMetadata?.candidatesTokenCount || 0);

    const text = extractResponseText(response);
    return tryParseJSON<ReelScript>(text) || script;
};

const reviewAndRefineImagePrompt = async (params: {
    imagePrompt: string;
    visualDescription?: string;
    brandContext?: string;
    aspectRatio?: string;
    allowedOnImageText?: string[];
}): Promise<string> => {
    const { imagePrompt, visualDescription, brandContext } = params;
    const aspectRatio = params.aspectRatio || '9:16';
    const allowedText = (params.allowedOnImageText || []).map((t) => t.trim()).filter(Boolean);

    const textRules = allowedText.length > 0
        ? `
        - This image IS allowed to contain on-image text. It must render EXACTLY the following copy, verbatim, and no other text:
${allowedText.map((t) => `          * "${t}"`).join('\n')}
        - Keep that copy legible at mobile size with high contrast, placed according to any layout/safe-zone instructions in the prompt.
        - Do not render captions, hashtags, watermarks, or any text beyond the copy listed above.
        - MUST include: "NO WATERMARKS, no text other than the specified copy".`
        : `
        - DO NOT include any instruction that asks the image model to render text.
        - Remove phrases like "text overlay", "caption", "title", "words", "typography", "watermark".
        - MUST include: "NO TEXT, NO WATERMARKS".`;

    const prompt = `
        You are an Internal QA Reviewer for AI image prompts used in social media creative.

        Task: Rewrite the image prompt to produce a strong ${aspectRatio} visual that matches the scene, while enforcing strict safety/quality constraints.

        HARD RULES:
        - Return ONLY valid JSON (no markdown).
        - The final image MUST be composed for a ${aspectRatio} frame. Keep or add composition guidance for that aspect ratio; never instruct a different aspect ratio.
        - Preserve ALL product truth, brand guidance, locked-product, layout, and output-format constraints from the input prompt. Do not drop sections.${textRules}
        - If the input contains a "VARIATION BRIEF" section, preserve it nearly verbatim near the top of refinedPrompt. Do not dilute, summarize away, or reconcile it into a generic single composition — that brief is the required divergence for this take.
        - Keep the style photorealistic unless the prompt explicitly requests illustration.${PRODUCT_PHOTO_REALISM_REVIEW_RULES}
        - Keep it specific: subject, action, setting, lighting, composition.
        - Keep any brand visual signature if present.

        Scene visual description:
        ${visualDescription || ""}

        Branding context:
        ${brandContext || "None provided"}

        Input image prompt:
        ${imagePrompt}

        Output JSON:
        { "refinedPrompt": "..." }
    `;

    try {
        const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model: TEXT_MODEL,
            contents: { parts: [{ text: prompt }] },
            config: { responseMimeType: "application/json", maxOutputTokens: 1024 }
        }));

        usageTracker.trackTokens('reviewAndRefineImagePrompt', response.usageMetadata?.promptTokenCount || 0, response.usageMetadata?.candidatesTokenCount || 0);

        const text = extractResponseText(response);
        const parsed = tryParseJSON<{ refinedPrompt?: string }>(text);
        const refined = (parsed?.refinedPrompt || '').trim();
        if (refined) return refined;
    } catch (e) {
        console.warn('Image prompt QA failed, using original prompt', e);
    }

    const allowsText = allowedText.length > 0;
    const base = (imagePrompt || '').trim();
    if (!base) {
        return `Real product photography, natural imperfect light, ${aspectRatio} composition, tactile detail, ${allowsText ? '' : 'NO TEXT, '}NO WATERMARKS`;
    }
    const hasNoText = /\bNO TEXT\b/i.test(base);
    const hasNoWatermarks = /\bNO WATERMARKS\b/i.test(base);
    const hasRealism = /\bPHOTOGRAPHY REALISM\b|\breal product photography\b/i.test(base);
    const suffix = `${allowsText || hasNoText ? '' : ', NO TEXT'}${hasNoWatermarks ? '' : ', NO WATERMARKS'}${hasRealism ? '' : ', real product photography, natural imperfect light, no CGI or AI-gloss'}`;
    return `${base}${suffix}`;
};

const reviewAndRefineReelPlan = async (params: {
    topic: string;
    duration: number;
    targetSceneCount: number;
    trendReport: TrendReport;
    researchReport: ResearchReport;
    viralReport: ViralAnalysisReport;
    brandContext?: string;
    musicContext?: string;
    plan: ReelPlan;
}): Promise<ReelPlan> => {
    const {
        topic,
        duration,
        targetSceneCount,
        trendReport,
        researchReport,
        viralReport,
        brandContext,
        musicContext,
        plan
    } = params;

    const prompt = `
        You are an Internal QA Reviewer for cinematic Instagram Reel storyboards.

        Your job: Critique and then FIX the plan so it feels like ONE short film — captivating, continuous storytelling — not a random collage of tips.

        HARD RULES:
        - Return ONLY valid JSON (no markdown).
        - Output must follow the SAME schema as the input plan.
        - You MUST return EXACTLY ${targetSceneCount} scenes (sceneNumber 1..${targetSceneCount}).
        - The sum of all scene "estimatedDuration" values MUST equal ${duration} seconds. Do NOT exceed this total.
        - Each scene must CONTINUE the previous scene (cause → effect, question → answer, tension → reveal). Reject disconnected beats.
        - Spoken lines must read as one continuous voiceover story if concatenated in order.
        - Visuals must feel like successive shots of the same film (shared subject, lighting language, and camera geography). Each imagePrompt should briefly note how it continues from the previous shot.
        - Keep image prompts consistent with brand context and negative prompt rules.
        - NO montage of unrelated b-roll. NO generic filler.

        REQUIRED STORY ARC (merge roles when scene count is low):
          1) HOOK (pattern interrupt that opens the story)
          2) CONTEXT (what this story is about)
          3) MESSAGE/CLAIM (the turning point)
          4) COUNTERPOINT (twist / what people get wrong)
          5) PROOF (concrete evidence in-story)
          6) TAKEAWAY (resolution)
          7) CTA (final beat / next step)
        - Prefix scriptGuidance with the role label, e.g. "HOOK: ...".

        INPUTS (for grounding):
        - Topic: "${topic}"
        - Target Duration: ${duration}s
        - Trends: ${JSON.stringify(trendReport)}
        - Research: ${JSON.stringify(researchReport)}
        - Viral Analysis: ${JSON.stringify(viralReport)}
        - Branding: ${brandContext || "None provided"}
        - Music/Vibe: ${musicContext || "Not specified"}

        Current Plan JSON:
        ${JSON.stringify(plan)}
    `;

    const result = await generateAppText({
        prompt,
        json: true,
        temperature: 0.35,
        role: 'plan',
    });
    usageTracker.trackTokens('reviewAndRefineReelPlan', 0, 0);

    const text = stripJsonFences(result.content);
    return tryParseJSON<ReelPlan>(text) || plan;
};

// --- AGENT 4: STRATEGIST ---
export interface ReelPlanContext {
    persona?: string;
    creatorProfileUrl?: string;
    referenceUrls?: string[];
    ideaHook?: string;
    ideaAngle?: string;
    ideaTrendReason?: string;
    ideaCallToAction?: string;
    ideaHashtagStack?: string[];
    ideaPersonaNotes?: { tone: string; vibe: string; audience: string };
    scriptStyle?: string;
}

/**
 * Normalize scene estimatedDuration values so they sum exactly to the target.
 * Uses role-weighted allocation (hook shorter, CTA longer) instead of equal splits.
 */
export const normalizePlanDurations = (
    plan: ReelPlan,
    targetDuration: number,
    options?: { minSec?: number },
): ReelPlan => {
    if (!plan.scenes || plan.scenes.length === 0 || !(targetDuration > 0)) return plan;

    // Prefer the spoken-scene floor only when the requested total can support
    // it. Short reels must still honor their target instead of silently growing.
    const minSec = options?.minSec
        ?? Math.min(SPOKEN_SCENE_MIN_SEC, targetDuration / plan.scenes.length);
    const allocated = allocateDurationsToTarget(
        plan.scenes.map((scene) => ({
            scriptGuidance: scene.scriptGuidance,
            estimatedDuration: scene.estimatedDuration,
        })),
        targetDuration,
        { preserveRelative: true, minSec },
    );

    return {
        ...plan,
        scenes: plan.scenes.map((scene, index) => ({
            ...scene,
            estimatedDuration: allocated[index] ?? scene.estimatedDuration,
        })),
    };
};

export const generateReelPlan = async (
    topic: string,
    trendReport: TrendReport,
    researchReport: ResearchReport,
    viralReport: ViralAnalysisReport,
    brandContext?: string,
    musicContext?: string,
    userTargetDuration: number = 0,
    planContext?: ReelPlanContext,
    skipQA: boolean = false,
): Promise<ReelPlan> => {

    let duration = 0;
    if (userTargetDuration > 0) {
        duration = userTargetDuration;
    } else {
        duration = Math.min(60, trendReport.optimalDuration || 45); // Hard cap at 60s for Auto
    }

    // Dynamic Scene Count Logic (respect user duration)
    let targetSceneCount = 6;

    const minScenesForArc = duration >= 22 ? 7 : duration >= 16 ? 6 : duration >= 10 ? 5 : 3;

    if (userTargetDuration > 0) {
        // If user specified duration, scale scenes ~1 per 5s, min arc, max 12
        targetSceneCount = Math.max(minScenesForArc, Math.min(12, Math.round(duration / 5)));
    } else {
        // Auto logic
        if (researchReport.depthScore >= 9 || (researchReport.stepByStep && researchReport.stepByStep.length > 7)) {
            // High complexity: Allow up to 10 scenes (Only for very deep topics)
            targetSceneCount = 10;
        } else if (researchReport.depthScore >= 6) {
            // Medium complexity: 8 scenes
            targetSceneCount = 8;
        } else {
            // Low/Normal complexity: 6 scenes
            targetSceneCount = 6;
        }
        // Allow faster jump-cut pacing (approx 2s per scene minimum)
        targetSceneCount = Math.min(targetSceneCount, Math.max(3, Math.floor(duration / 2)));
    }

    targetSceneCount = Math.max(targetSceneCount, minScenesForArc);

    const personaBlock = planContext?.persona ? `\n        - PERSONA / CHANNEL VIBE: ${planContext.persona}` : '';
    const creatorBlock = planContext?.creatorProfileUrl ? `\n        - CREATOR PROFILE: ${planContext.creatorProfileUrl}` : '';
    const referenceBlock = planContext?.referenceUrls?.length
        ? `\n        - REFERENCE LIBRARY:\n${planContext.referenceUrls.map((url, i) => `          ${i + 1}. ${url}`).join('\n')}`
        : '';
    const ideaBlock = (planContext?.ideaHook || planContext?.ideaAngle || planContext?.ideaTrendReason)
        ? `\n        - SCOUTED IDEA:\n          Hook: ${planContext.ideaHook || 'N/A'}\n          Angle: ${planContext.ideaAngle || 'N/A'}\n          Trend Reason: ${planContext.ideaTrendReason || 'N/A'}\n          CTA: ${planContext.ideaCallToAction || 'N/A'}${planContext.ideaHashtagStack?.length ? `\n          Hashtags: ${planContext.ideaHashtagStack.join(', ')}` : ''}${planContext.ideaPersonaNotes ? `\n          Persona: tone=${planContext.ideaPersonaNotes.tone}, vibe=${planContext.ideaPersonaNotes.vibe}, audience=${planContext.ideaPersonaNotes.audience}` : ''}`
        : '';
    const styleBlock = planContext?.scriptStyle ? `\n        - SCRIPT STYLE: ${planContext.scriptStyle}` : '';

    const prompt = `
        You are a Cinematic Story Director for short-form Reels (not a tip-list generator).
        
        OBJECTIVE: Create a scene-by-scene STORYBOARD that feels like a mini movie about "${topic}".
        The viewer should feel one continuous narrative: each slide continues the previous slide — like cutting from shot to shot in a film, then the next card sliding over the last.
        TARGET DURATION: ${duration} seconds.
        TARGET SCENES: EXACTLY ${targetSceneCount} scenes (enforce count — do not exceed).
        DURATION CONSTRAINT: The sum of all scene "estimatedDuration" values MUST equal ${duration} seconds. Do NOT exceed ${duration}s total.
        PACING (CRITICAL — do NOT use equal scene lengths):
           - HOOK scenes: shorter punch but never under ~${SPOKEN_SCENE_MIN_SEC}s (~${Math.max(SPOKEN_SCENE_MIN_SEC, duration * 0.12).toFixed(1)}–${Math.max(SPOKEN_SCENE_MIN_SEC + 0.5, duration * 0.18).toFixed(1)}s)
           - BODY / PROOF scenes: medium, varied lengths
           - CTA / TAKEAWAY: slightly longer (~${Math.max(3, duration * 0.18).toFixed(1)}–${Math.max(4, duration * 0.22).toFixed(1)}s)
           - Script word budget ≈ ${WORDS_PER_SEC} words per second of estimatedDuration. Write COMPLETE useful spoken lines (not fragments).
        
        INPUTS:
        - TRENDS: ${JSON.stringify(trendReport)}
        - RESEARCH: ${JSON.stringify(researchReport)}
        - VIRAL ANALYSIS: ${JSON.stringify(viralReport)}
        - BRANDING: ${brandContext || "None provided"}
        - MUSIC/VIBE: ${musicContext || "Not specified"}${personaBlock}${creatorBlock}${referenceBlock}${ideaBlock}${styleBlock}
        
        STORYTELLING RULES (CRITICAL):
        1. **One story, not random scenes.** If you read scriptGuidance 1→N aloud, it must sound like one continuous narration.
        2. **Causal continuity.** Scene N must answer, escalate, or reveal from scene N-1 (question→answer, problem→twist→proof→payoff). Never jump to an unrelated tip.
        3. **Hook (Scene 1)** opens a story promise (curiosity or tension), not a generic topic title.
        4. **Narrative Arc** (merge roles if scene count is low):
           - HOOK -> CONTEXT -> MESSAGE/CLAIM -> COUNTERPOINT -> PROOF -> TAKEAWAY -> CTA.
           - Prefix scriptGuidance with the role label, e.g. "HOOK: ...", "COUNTERPOINT: ...", "CTA: ...".
        5. **Visual continuity (film grammar):**
           - Keep the same world: subject, color grade, lighting, and environment family across scenes.
           - Each visualDescription/imagePrompt should feel like the NEXT SHOT after the previous one (push-in, reveal, reaction, detail insert) — not a new random location.
           - In imagePrompt, include a short continuity cue like "continues from previous shot:" when sceneNumber > 1.
           - NEGATIVE PROMPT: NO TEXT, NO WATERMARKS, CLEAN IMAGE.
           - BRANDING: If a "Visual Signature" is in the branding context, YOU MUST USE IT in the imagePrompt for relevant scenes.
           - BRAND IMAGES: If "Available Images" exist, you may set brandImageIndex + brandAssetEditAction ("use_as_is" when packaging must stay recognizable; "edit" only for true interaction/environment needs).
        6. **Music**: Match emotional arc (tension → release), not random cuts.
        
        OUTPUT JSON Schema:
        {
            "topic": "${topic}",
            "vibe": "Mood of the short film",
            "strategicReasoning": "Why this story arc captivates",
            "scenes": [
                {
                    "sceneNumber": 1,
                    "visualDescription": "Opening shot that starts the story",
                    "imagePrompt": "Detailed AI prompt: Photorealistic, 8k, [Brand Visual Signature], [Action], NO TEXT...",
                    "brandImageIndex": 0,
                    "brandAssetEditAction": "edit",
                    "scriptGuidance": "HOOK: spoken opening that starts the story",
                    "estimatedDuration": 2.8
                },
                {
                    "sceneNumber": 2,
                    "visualDescription": "Next shot that continues the previous moment",
                    "imagePrompt": "continues from previous shot: ...",
                    "scriptGuidance": "CONTEXT: spoken line that answers the hook",
                    "estimatedDuration": 4.5
                },
                {
                    "sceneNumber": 3,
                    "visualDescription": "Payoff / CTA shot in the same world",
                    "imagePrompt": "continues from previous shot: ...",
                    "scriptGuidance": "CTA: spoken closing that resolves the story",
                    "estimatedDuration": 4.0
                }
            ]
        }
    `;

    const result = await generateAppText({
        prompt,
        webSearch: true,
        json: true,
        temperature: 0.7,
        role: 'plan',
    });
    usageTracker.trackTokens('generateReelPlan', 0, 0);

    const text = stripJsonFences(result.content);
    const plan = tryParseJSON<ReelPlan>(text);
    if (!plan || !plan.scenes) throw new Error("Failed to generate reel plan");

    // Normalize scene durations to sum to target duration (spoken-scene floor).
    let normalizedPlan = normalizePlanDurations(plan, duration);

    if (!skipQA) {
        try {
            const reviewed = await reviewAndRefineReelPlan({
                topic,
                duration,
                targetSceneCount,
                trendReport,
                researchReport,
                viralReport,
                brandContext,
                musicContext,
                plan: normalizedPlan
            });
            if (reviewed?.scenes && reviewed.scenes.length === targetSceneCount) {
                // Also normalize the reviewed plan
                normalizedPlan = normalizePlanDurations(reviewed, duration);
            }
        } catch (e) {
            console.warn('Plan QA failed, using original plan', e);
        }
    }

    // Keep plan generation responsive and preserve editable copy. Spoken lines
    // are fitted once, immediately before TTS, after the user finishes editing.
    return normalizedPlan;
};

// --- AGENT 5: VISUALIZER ---
export const generateImageAsset = async (
    request: ImageGenerationRequest
): Promise<string> => {
    let contextualPrompt = request.imagePrompt;

    if (request.currentSceneText) {
        contextualPrompt = `
            ${contextualPrompt}

            CURRENT SCENE INTENT:
            - Narration / on-screen context: "${request.currentSceneText}"
        `;
    }

    if (request.prevSceneReference || request.nextSceneReference) {
        contextualPrompt = `
            ${contextualPrompt}

            VISUAL CONTINUITY INSTRUCTIONS:
            - This scene is part of a sequence.
            ${request.prevSceneReference ? `- Previous scene context: "${request.prevSceneText || 'Maintain continuity from the previous scene.'}"` : ''}
            ${request.nextSceneReference ? `- Next scene context: "${request.nextSceneText || 'Transition naturally into the next scene.'}"` : ''}
            - Keep product identity, lighting, wardrobe, and framing continuity across the attached references.
        `;
    }

    if (request.mode === 'composite' && request.references?.length) {
        const compositeReferenceLines = request.references.map((reference, index) => (
            `- Attached reference ${index + 1} is the ${reference.role.replace('_', ' ')} reference. `
            + `Preserve: ${(reference.preserve || []).join(', ') || 'overall character and key identity cues'}. `
            + `${reference.modify ? `Modify / use it for: ${reference.modify}.` : ''}`
        )).join('\n');
        contextualPrompt = `
            ${contextualPrompt}

            MULTI-REFERENCE COMPOSITE INSTRUCTIONS:
            - Combine the attached references into one coherent vertical scene.
            - Preserve the exact product identity, label, packaging, and proportions for any product reference.
            - Use person, environment, and style references only for scene composition guidance.
            - Do not replace or hallucinate brand text, packaging art, or logo placement.
            ${compositeReferenceLines}
        `;
    }

    if (request.mode === 'edit' && request.primaryReference) {
        if (request.continuityDomain === 'character') {
            contextualPrompt = `
                ${contextualPrompt}

                CHARACTER CONTINUITY INSTRUCTIONS:
                - Treat the first attached image as the character / look reference.
                - Keep the same person identity: face structure, age, skin tone, hair, and wardrobe vibe.
                - Evolve the pose, framing, environment, and action to match the new scene prompt.
                - Do not swap to a different person, ethnicity, or unrelated costume unless the prompt explicitly changes them.
                - No on-image text, logos, or watermarks.
            `;
        } else {
            contextualPrompt = `
                ${contextualPrompt}

                IMAGE EDIT INSTRUCTIONS:
                - Treat the first attached image as the primary source image to preserve.
                - Modify or outpaint that image to match the prompt instead of inventing a different product.
                - Preserve the product bottle, pack, and visual identity unless the prompt explicitly changes them.
                - Preserve the exact label, logo, packaging artwork, text placement, and bottle proportions from the source image.
                - Do not blank, remove, simplify, hallucinate, or replace the brand label.
            `;
        }
    }

    // When allowedOnImageText is provided, skip the QA reviewer entirely.
    // The QA reviewer (text model) strips/rephrases text rendering directives,
    // which breaks carousel slides that need exact text baked in.
    // We trust the caller's prompt and send it directly to the image model.
    const allowedText = (request.allowedOnImageText || []).map(t => t.trim()).filter(Boolean);
    const finalPrompt = allowedText.length > 0 || request.skipPromptReview
        ? (allowedText.length > 0
            ? `${contextualPrompt}\n\nON-IMAGE TEXT INSTRUCTIONS:\n- Render EXACTLY this text on the image, verbatim:\n${allowedText.map(t => `  * "${t}"`).join('\n')}\n- Text must be crisp, high-contrast, legible at mobile size.\n- Style text according to brand font/color directives above.\n- Do NOT add any other text, watermarks, or captions.`
            : contextualPrompt)
        : await reviewAndRefineImagePrompt({
            imagePrompt: contextualPrompt,
            visualDescription: request.visualDescription,
            brandContext: request.brandContext,
            aspectRatio: request.aspectRatio,
            allowedOnImageText: request.allowedOnImageText,
        });

    const parts: any[] = [{ text: finalPrompt }];

    const pushImagePart = (reference?: { data: string; mimeType?: string }) => {
        if (!reference?.data) return;
        parts.push({
            inlineData: {
                mimeType: reference.mimeType || "image/png",
                data: reference.data
            }
        });
    };

    pushImagePart(request.primaryReference);
    pushImagePart(request.prevSceneReference);
    pushImagePart(request.nextSceneReference);
    request.references?.forEach((reference) => pushImagePart(reference.input));

    const callImageModel = async (promptText: string, attemptParts: any[]): Promise<string> => {
        const imageModel = resolveImageModel();
        const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model: imageModel,
            contents: { parts: [{ text: promptText }, ...attemptParts.slice(1)] },
            config: {
                responseModalities: ['Image'],
                imageConfig: { aspectRatio: toGeminiImageAspectRatio(request.aspectRatio || '9:16') },
            } as any,
        }));

        usageTracker.trackImage('Image Generation');

        const candidates = response.candidates || [];
        for (const candidate of candidates) {
            for (const part of candidate.content?.parts || []) {
                if (part.inlineData?.data) return part.inlineData.data;
            }
        }

        const candidate0: any = candidates[0] || {};
        const finishReason = candidate0.finishReason || candidate0.finish_reason || 'none';
        const blockReason = (response as any).promptFeedback?.blockReason
            || (response as any).promptFeedback?.block_reason
            || '';
        const safety = (candidate0.safetyRatings || candidate0.safety_ratings || [])
            .filter((r: any) => String(r.probability || r.severity || '').match(/MEDIUM|HIGH|SEVERE/i))
            .map((r: any) => `${r.category || r.categoryType || 'safety'}:${r.probability || r.severity}`)
            .slice(0, 4)
            .join(', ');
        const detail = [
            `finishReason=${finishReason}`,
            blockReason && `blockReason=${blockReason}`,
            safety && `safety=${safety}`,
            `candidates=${candidates.length}`,
            `model=${imageModel}`,
            `mode=${request.mode || 'generate'}`,
        ].filter(Boolean).join(' · ');
        throw new Error(`No image generated (${detail})`);
    };

    try {
        // parts[0] is the text prompt; remaining are image refs.
        return await callImageModel(finalPrompt, parts);
    } catch (err: any) {
        const msg = String(err?.message || err);
        // Empty/blocked image responses are often transient — one simplified retry.
        if (!/No image generated/i.test(msg)) throw err;
        const retryPrompt = [
            finalPrompt,
            '',
            'RETRY DIRECTIVE: Output a single image only. Do not reply with text.',
            'Keep the product recognizable if a product reference is attached. Prefer a clean vertical 9:16 composition.',
        ].join('\n');
        return await callImageModel(retryPrompt, parts);
    }
};


export const analyzeMediaAndCreateScript = async (
    mediaItems: UploadedMedia[],
    userPrompt: string,
    style: ScriptStyle,
    userMusicVibe?: string,
    skipQA?: boolean
): Promise<ReelScript> => {
    const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
    const estimateDurationSec = (text: string) => {
        const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
        return clamp(words * 0.34, 1.0, 6.0);
    };

    const parts = [];

    for (const item of mediaItems) {
        if (item.base64) {
            parts.push({
                inlineData: {
                    data: item.base64,
                    mimeType: item.mimeType,
                },
            });
        }
    }

    let styleInstruction = "Professional, engaging, and clear social media tone.";
    if (style === ScriptStyle.IndianDesi) styleInstruction = "Write in 'Hinglish'. Use popular Indian slang (e.g., 'Yaar', 'Bhai').";
    else if (style === ScriptStyle.GenZ) styleInstruction = "Use Gen Z slang. Keep it very fast-paced.";
    else if (style === ScriptStyle.Funny) styleInstruction = "Be witty, sarcastic, and self-deprecating.";
    else if (style === ScriptStyle.Motivational) styleInstruction = "Use short, punchy, high-energy sentences.";

    const promptText = `
    You are a Viral Content Architect and Reel Director.

    Task: Create a beat-by-beat Reel script plan from the provided visuals + intent: "${userPrompt}".

    HARD RULES:
    - Output MUST be valid JSON (no markdown).
    - Create EXACTLY ${mediaItems.length} segmentPlans items (one per media item).
    - Every segment must be easy to speak fast and easy to read.

    STYLE: ${styleInstruction}

    Viral structure guidance:
    - Hook in the first segment (pattern interrupt).
    - Escalate curiosity each segment.
    - Prefer concrete specifics, numbers, or contrasts.
    - Avoid generic filler.

    Segment plan constraints (keep it short but STORY-LIKE):
    - onScreenText: usually <= 110 characters; may be 1-2 short clauses joined with “because/so/then” to show cause → effect.
    - voiceoverText: usually 14-36 words (what the TTS speaks); must advance the story (setup → turn → payoff) with complete thoughts, not slogans.
    - durationSec: 1.0 to 6.0 seconds (match voiceover pace)
    - visualBeat: describe what the viewer sees / camera move / emphasis

    TALKING-HEAD MODE (voiceover-driven):
    - The reel is primarily a face-cam / talking-head delivery with jump cuts.
    - onScreenText should closely mirror voiceoverText (near-verbatim), broken into 1-2 short lines, and include connective words (“because”, “so”, “then”, “which means”) to keep it story-like.
    - Let each segment land a full idea before cutting away. Do not aggressively compress into fragments if the spoken line needs more detail.
    - Use emphasis with ALL CAPS for 1-2 keywords only (not the whole sentence).
    - visualBeat must include delivery notes: pause, gesture, facial expression, and a simple framing note (e.g., "tight shot", "lean in").
    - Avoid b-roll as the primary storytelling device; use it only as optional flavor.

    TONE (auto from topic):
    - Infer the best talking-head tone from the intent/topic and visuals.
    - Choose ONE primary tone and keep it consistent across segments:
      1) "Fast & decisive" (for business, productivity, how-to, growth, money, strong opinions)
      2) "Friendly educator" (for explainers, tutorials, reviews, learning, tech concepts)
      3) "Storytime/confessional" (for personal journeys, failures, drama, emotional topics)
    - If the selected STYLE conflicts with the inferred tone, prefer STYLE, but keep the pacing talking-head.

    MUSIC STRATEGY (WILD & CREATIVE):
      - User Request: "${userMusicVibe || "None provided"}"
      - Visual Context: Analyze visual rhythm.
      - FUSION TASK: Suggest a unique musical fusion (e.g. "Cyberpunk Sitar", "Lo-fi Bhangra").
      - Output detailed description in musicSuggestion.

    Output JSON schema:
    {
      "title": "Title",
      "hook": "Hook",
      "body": "Body",
      "callToAction": "CTA",
      "fullText": "Full Text",
      "segments": ["Caption 1", "Caption 2"],
      "segmentPlans": [
        {
          "index": 0,
          "onScreenText": "...",
          "voiceoverText": "...",
          "visualBeat": "...",
          "durationSec": 2.2,
          "brollKeywords": ["..."]
        }
      ],
      "suggestedSpeed": 1.5,
      "musicSuggestion": {
        "mood": "Mood",
        "genre": "Genre",
        "description": "DETAILED creative prompt describing instruments and fusion",
        "searchQuery": "Search"
      },
      "suggestedVisuals": {
        "brightness": 1.1,
        "contrast": 1.2,
        "saturation": 1.3,
        "enableZoom": true,
        "reasoning": "Reason"
      }
    }
  `;

    parts.push({ text: promptText });

    const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: TEXT_MODEL,
        contents: { parts },
        config: {
            responseMimeType: "application/json",
            systemInstruction: "You are an expert Instagram Reel director. Prioritize sync."
        },
    }));

    usageTracker.trackTokens('analyzeMediaAndCreateScript', response.usageMetadata?.promptTokenCount || 0, response.usageMetadata?.candidatesTokenCount || 0);

    const text = extractResponseText(response);
    const script = tryParseJSON<ReelScript>(text);

    if (!script) throw new Error("Failed to generate a valid JSON script.");

    const desiredCount = mediaItems.length;

    const plans = Array.isArray(script.segmentPlans) ? script.segmentPlans : [];
    const segmentsFromPlans = plans.length === desiredCount
        ? plans.map(p => (p?.voiceoverText || p?.onScreenText || '').trim())
        : [];

    if (!script.segments || script.segments.length !== desiredCount) {
        const adjustedSegments = [] as string[];
        const sentences = script.fullText?.match(/[^.!?]+[.!?]+/g) || [script.fullText || ''];
        for (let i = 0; i < desiredCount; i++) {
            adjustedSegments.push(segmentsFromPlans[i] || script.segments?.[i] || sentences[i] || " ");
        }
        script.segments = adjustedSegments;
    }

    if (!script.segmentPlans || script.segmentPlans.length !== desiredCount) {
        script.segmentPlans = Array.from({ length: desiredCount }, (_, i) => {
            const existing = plans[i];
            const voiceoverText = (existing?.voiceoverText || script.segments[i] || '').trim();
            const onScreenText = (existing?.onScreenText || script.segments[i] || voiceoverText).trim();
            const durationSec = typeof existing?.durationSec === 'number' && Number.isFinite(existing.durationSec)
                ? clamp(existing.durationSec, 1.0, 6.0)
                : estimateDurationSec(voiceoverText);
            return {
                index: typeof existing?.index === 'number' ? existing.index : i,
                onScreenText,
                voiceoverText,
                visualBeat: (existing?.visualBeat || mediaItems[i]?.description || '').trim(),
                durationSec,
                brollKeywords: Array.isArray(existing?.brollKeywords) ? existing.brollKeywords : undefined,
            };
        });
    } else {
        script.segmentPlans = script.segmentPlans.map((p, i) => {
            const voiceoverText = (p?.voiceoverText || script.segments[i] || '').trim();
            const onScreenText = (p?.onScreenText || script.segments[i] || voiceoverText).trim();
            const durationSec = typeof p?.durationSec === 'number' && Number.isFinite(p.durationSec)
                ? clamp(p.durationSec, 1.0, 6.0)
                : estimateDurationSec(voiceoverText);
            return {
                index: typeof p?.index === 'number' ? p.index : i,
                onScreenText,
                voiceoverText,
                visualBeat: (p?.visualBeat || mediaItems[i]?.description || '').trim(),
                durationSec,
                brollKeywords: Array.isArray(p?.brollKeywords) ? p.brollKeywords : undefined,
            };
        });
        script.segments = script.segmentPlans.map(p => (p.voiceoverText || p.onScreenText || '').trim() || ' ');
    }

    if (!skipQA) {
        try {
            const mediaDescriptions = mediaItems.map(m => (m.description || '').trim());
            const reviewed = await reviewAndRefineReelScript({
                userPrompt,
                style,
                userMusicVibe,
                mediaDescriptions,
                script
            });
            if (reviewed && Array.isArray(reviewed.segmentPlans) && reviewed.segmentPlans.length === desiredCount) {
                return reviewed;
            }
        } catch (e) {
            console.warn('Script QA failed, using original script', e);
        }
    }

    return script;
};

export type RewriteScriptOptions = {
    maxWords?: number;
    targetDurationSec?: number;
};

export const rewriteScriptSegment = async (
    currentText: string,
    mediaDescription: string,
    modification: string,
    previousSceneText?: string,
    nextSceneText?: string,
    options?: RewriteScriptOptions,
): Promise<string> => {
    const normalizedInstruction = modification.trim().toLowerCase();
    const maxWords = typeof options?.maxWords === 'number' && options.maxWords > 0
        ? Math.floor(options.maxWords)
        : typeof options?.targetDurationSec === 'number' && options.targetDurationSec > 0
            ? maxWordsForSlot(options.targetDurationSec)
            : undefined;
    const budgetRule = maxWords
        ? `- HARD WORD BUDGET: at most ${maxWords} words (≈ ${WORDS_PER_SEC} words/sec for the scene slot).`
        : '';
    const rewriteGuidance = normalizedInstruction === 'shorten'
        ? 'Make it shorter, but still complete and natural. Return one concise sentence.'
        : normalizedInstruction === 'viralize'
            ? 'Keep the meaning, but make it punchier, more scroll-stopping, and still complete. Return one or two full sentences.'
            : 'Improve clarity, rhythm, and wording while preserving the meaning. Return one or two full sentences.';

    const contextPrompt = `
Context:
- This is one scene in a sequence.
${previousSceneText ? `- PREVIOUS scene text was: "${previousSceneText}"` : ''}
${nextSceneText ? `- NEXT scene text will be: "${nextSceneText}"` : ''}
- Ensure the rewritten text flows naturally within this sequence. Do not repeat what was just said or what is about to be said.
${budgetRule}
`;

    const cleanCandidate = (value: string): string => value
        .replace(/```json|```/g, '')
        .replace(/^"(.*)"$/s, '$1')
        .replace(/^(here is (?:the )?(?:json|data|response|result)s? you requested[:\s-]*)/i, '')
        .replace(/^(?:the )?(?:data|response|result)s? (?:you requested|you've been waiting for)(?:\s+(?:is|are))?[:\s-]*/i, '')
        .replace(/^rewrittentext[:\s-]*/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    const looksLikeVisualDirection = (value: string): boolean => {
        return /^(close[- ]up|medium shot|wide shot|macro shot|split screen|camera|zoom|pan|tilt|lean into the lens|hold the .* bottle|foreground|background|lighting|framing)\b/i.test(value)
            || /\b(close[- ]up|medium shot|wide shot|macro shot|foreground|background|lighting|framing|camera move|lens)\b/i.test(value);
    };

    const looksLikeBrokenRewriteOutput = (value: string): boolean => {
        const trimmed = value.trim();
        return /^here is (?:the )?(?:json|data|response|result)s? you requested[:\s-]*/i.test(trimmed)
            || /^rewrittentext[:\s]/i.test(trimmed.replace(/["{}]/g, ''))
            || /^(?:the )?data (you requested|you've been waiting for)(?:\s+is)?(?:[:\s-].*)?$/i.test(trimmed)
            || /^(?:the )?results? (you requested|you've been waiting for)(?:\s+is|(?:\s+are))?(?:[:\s-].*)?$/i.test(trimmed)
            || /^(?:the )?response (you requested|you've been waiting for)(?:\s+is)?(?:[:\s-].*)?$/i.test(trimmed);
    };

    const extractStructuredRewrite = (value: string): string => {
        const cleaned = cleanCandidate(value);
        const directParsed = tryParseJSON<{ rewrittenText?: string }>(cleaned);
        if (directParsed?.rewrittenText) {
            return cleanCandidate(directParsed.rewrittenText);
        }

        const objectMatch = cleaned.match(/\{[\s\S]*\}/);
        if (objectMatch) {
            const embeddedParsed = tryParseJSON<{ rewrittenText?: string }>(objectMatch[0]);
            if (embeddedParsed?.rewrittenText) {
                return cleanCandidate(embeddedParsed.rewrittenText);
            }
        }

        const fieldMatch = cleaned.match(/"rewrittenText"\s*:\s*"([\s\S]*?)"/);
        if (fieldMatch?.[1]) {
            return cleanCandidate(fieldMatch[1]);
        }

        return cleaned;
    };

    const isUnsafeCandidate = (candidate: string): boolean => {
        const lettersOnlyLength = candidate.replace(/[^A-Za-z]/g, '').length;
        const wordCount = candidate.split(/\s+/).filter(Boolean).length;
        if (!candidate) return true;
        if (/^[A-Za-z]{1,4}$/.test(candidate)) return true;
        if (lettersOnlyLength < 6) return true;
        if (normalizedInstruction !== 'shorten' && wordCount < 3) return true;
        if (/^here is (?:the )?(?:json|data|response|result)s? you requested[:\s-]*/i.test(candidate)) return true;
        if (/^rewrittentext[:\s]/i.test(candidate.replace(/["{}]/g, ''))) return true;
        if (candidate.trim().toLowerCase() === mediaDescription.trim().toLowerCase()) return true;
        if (looksLikeBrokenRewriteOutput(candidate)) return true;
        if (looksLikeVisualDirection(candidate) && !looksLikeVisualDirection(currentText)) return true;
        return false;
    };

    const jsonPrompt = `
        You are a Script Doctor rewriting SPOKEN COPY ONLY.
        Original Line: "${currentText}"
        Visual Context: "${mediaDescription}"
        USER INSTRUCTION: "${modification}"
        ${contextPrompt}
        Task: Rewrite the original line to satisfy the user instruction perfectly.
        Guidance: ${rewriteGuidance}
        HARD RULES:
        - Output only words a narrator or creator would actually say aloud.
        - Do NOT output camera directions, shot descriptions, framing notes, or visual instructions.
        - Do NOT mention close-up, medium shot, wide shot, foreground, background, lens, or lighting.
        - Maintain narrative flow with PREVIOUS and NEXT scenes.
        Return ONLY valid JSON:
        {
          "rewrittenText": "the fully rewritten line"
        }
    `;

    const jsonResult = await generateAppText({
        prompt: jsonPrompt,
        json: true,
        temperature: 0.5,
        maxTokens: 220,
        role: 'worker',
    });
    usageTracker.trackTokens('rewriteScriptSegment', 0, 0);

    const enforceBudget = (value: string): string => {
        if (!maxWords) return value;
        if (countSpokenWords(value) <= maxWords + 2) return value;
        const compressed = truncateSpokenTextToBudget(value, maxWords + 2);
        if (isUsefulSpokenLine(compressed)) return compressed;
        return isUsefulSpokenLine(value) ? value : compressed;
    };

    const structuredCandidate = extractStructuredRewrite(jsonResult.content || '');
    if (!isUnsafeCandidate(structuredCandidate) && structuredCandidate !== currentText.trim()) {
        return enforceBudget(structuredCandidate);
    }

    const plainTextPrompt = `
        Rewrite this spoken script line according to the instruction below.
        Keep the meaning grounded in the visual context.
        Return ONLY the rewritten line. No JSON. No quotes. No bullet points.
        Output only spoken words, never visual directions or shot instructions.
        ${budgetRule}

        Original Line: "${currentText}"
        Visual Context: "${mediaDescription}"
        Instruction: "${modification}"
        Guidance: ${rewriteGuidance}
    `;

    const plainTextResult = await generateAppText({
        prompt: plainTextPrompt,
        temperature: 0.55,
        maxTokens: 220,
        role: 'worker',
    });
    usageTracker.trackTokens('rewriteScriptSegment', 0, 0);

    const fallbackCandidate = cleanCandidate(plainTextResult.content || '');
    if (!isUnsafeCandidate(fallbackCandidate) && fallbackCandidate !== currentText.trim()) {
        return enforceBudget(fallbackCandidate);
    }

    return enforceBudget(currentText);
};

export type MeasuredScriptFitResult = {
    lines: string[];
    changedIndexes: number[];
    attemptedIndexes: number[];
};

const preservesSpokenMeaning = (original: string, candidate: string): boolean => {
    const stopWords = new Set(['that', 'this', 'with', 'from', 'your', 'into', 'have', 'will', 'just', 'more']);
    const tokens = (text: string) => (text.toLowerCase().match(/[a-z0-9]+/g) || [])
        .filter((token) => /\d/.test(token) || (token.length >= 4 && !stopWords.has(token)));
    const originalTokens = tokens(original);
    const candidateTokens = new Set(tokens(candidate));
    const originalNumbers = originalTokens.filter((token) => /\d/.test(token));
    if (originalNumbers.some((token) => !candidateTokens.has(token))) return false;
    const overlap = originalTokens.filter((token) => candidateTokens.has(token)).length;
    const requiredOverlap = Math.max(1, Math.ceil(originalTokens.length * 0.25));
    const ctaWords = ['save', 'follow', 'share', 'shop', 'buy', 'try', 'start', 'download'];
    const originalCta = ctaWords.filter((word) => original.toLowerCase().includes(word));
    if (originalCta.length > 0 && !originalCta.some((word) => candidate.toLowerCase().includes(word))) return false;
    return overlap >= requiredOverlap;
};

/**
 * One post-TTS correction pass based on observed voice cadence. This deliberately
 * touches only scenes whose measured voice overruns its slot.
 */
export const fitSceneScriptsToMeasuredDurations = async (
    scenes: Array<{
        voiceoverText?: string;
        onScreenText?: string;
        requestedDurationSec: number;
        visualDescription?: string;
        sceneNumber?: number;
        pacingLocked?: boolean;
    }>,
    measuredVoiceDurations: number[],
    targetDurationSec: number,
): Promise<MeasuredScriptFitResult> => {
    const baseTexts = scenes.map((scene) =>
        cleanScriptText(scene.voiceoverText || scene.onScreenText || '').trim(),
    );
    const corrections = buildMeasuredNarrationCorrectionPlan(
        scenes,
        measuredVoiceDurations,
        targetDurationSec,
    );
    const attemptedIndexes = corrections.map((correction) => correction.index);
    if (!corrections.length) {
        return { lines: baseTexts, changedIndexes: [], attemptedIndexes };
    }

    const payload = corrections.map((correction) => ({
        index: correction.index,
        sceneNumber: correction.sceneNumber,
        currentText: baseTexts[correction.index],
        visualDescription: scenes[correction.index]?.visualDescription || '',
        previousSpoken: correction.index > 0 ? baseTexts[correction.index - 1] : '',
        nextSpoken: correction.index < baseTexts.length - 1 ? baseTexts[correction.index + 1] : '',
        measuredVoiceSec: correction.measuredVoiceSec,
        slotSec: correction.slotSec,
        actualOverrunSec: correction.overrunSec,
        maxWords: correction.maxWords,
    }));
    const candidates = new Map<number, string>();

    try {
        const prompt = `
You are making one safe correction to measured Reel narration after TTS.
Rewrite ONLY the listed offending lines. Their measured duration and actual overrun are authoritative.
Each result must preserve the original meaning and be a complete, natural spoken sentence of at most maxWords.
Reject fragments, labels, camera directions, vague filler, and lines that no longer communicate the claim or CTA.
Use previousSpoken and nextSpoken only for continuity; do not rewrite those unaffected lines.

Return ONLY valid JSON:
{
  "scenes": [
    { "index": 0, "spokenText": "Complete meaningful replacement." }
  ]
}

MEASURED OFFENDERS:
${JSON.stringify(payload, null, 2)}
`;
        const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model: TEXT_MODEL,
            contents: { parts: [{ text: prompt }] },
            config: { responseMimeType: 'application/json', maxOutputTokens: 1200 },
        }));
        usageTracker.trackTokens(
            'fitSceneScriptsToMeasuredDurations',
            response.usageMetadata?.promptTokenCount || 0,
            response.usageMetadata?.candidatesTokenCount || 0,
        );
        const parsed = tryParseJSON<{ scenes?: Array<{ index?: number; spokenText?: string }> }>(
            extractResponseText(response),
        );
        parsed?.scenes?.forEach((entry) => {
            if (typeof entry.index !== 'number') return;
            const correction = corrections.find((item) => item.index === entry.index);
            if (!correction) return;
            const candidate = cleanScriptText(entry.spokenText || '').trim();
            if (!isUsefulSpokenLine(candidate, 4)) return;
            if (countSpokenWords(candidate) > correction.maxWords + 1) return;
            if (!preservesSpokenMeaning(baseTexts[entry.index], candidate)) return;
            if (candidate === baseTexts[entry.index]) return;
            candidates.set(entry.index, candidate);
        });
    } catch (error) {
        console.warn('Measured narration correction failed; preserving original copy', error);
    }

    const lines = [...baseTexts];
    candidates.forEach((candidate, index) => {
        lines[index] = candidate;
    });
    return {
        lines,
        changedIndexes: [...candidates.keys()].sort((a, b) => a - b),
        attemptedIndexes,
    };
};

const getGeminiVoiceId = (voiceId: string): string => {
    if (voiceId === VoiceName.Rishi) return VoiceName.Charon;
    if (voiceId === VoiceName.Mira) return VoiceName.Aoede;
    // Hikaru is a regional alias — map to a clear male prebuilt voice.
    if (voiceId === VoiceName.Hikaru) return VoiceName.Iapetus;
    return voiceId;
};

const buildVoicePrompt = (
    transcript: string,
    options?: { accentHint?: string; locale?: string; label?: string },
): string => {
    const styleBits = [
        REEL_VOICE_STYLE_PREFIX,
        options?.accentHint?.trim(),
        options?.locale ? `Locale: ${options.locale}.` : '',
        options?.label ? `Voice persona: ${options.label}.` : '',
    ].filter(Boolean);
    return `${styleBits.join(' ')}\n\nSay: ${transcript}`;
};

const generateGeminiVoiceover = async (
    text: string,
    voiceId: string,
    style?: { accentHint?: string; locale?: string; label?: string },
): Promise<string> => {
    const transcript = text.trim().length > 0 ? text.trim() : ' ';
    const prebuiltVoice = getGeminiVoiceId(voiceId);
    const cacheKey = hashKey(['tts', TTS_MODEL, prebuiltVoice, style?.accentHint || '', style?.locale || '', transcript]);

    return voiceoverCache.getOrSet(cacheKey, async () => {
        const prompt = buildVoicePrompt(transcript, style);
        const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
            model: TTS_MODEL,
            contents: [{ parts: [{ text: prompt }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: prebuiltVoice },
                    },
                },
            },
        }));

        const audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
        if (!audio || audio.length < 32) {
            throw new Error('TTS returned empty audio. Try another voice or shorten the line.');
        }
        usageTracker.trackTTS('TTS Voiceover', text.length);
        return audio;
    });
};

const generateGoogleVoiceover = async (text: string, voiceId: string): Promise<string> => {
    if (!GOOGLE_TTS_FUNCTION_URL) {
        throw new Error('Google TTS is not configured for this environment.');
    }

    const response = await fetch(GOOGLE_TTS_FUNCTION_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            text: text.trim().length > 0 ? text : " ",
            voiceId,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Google TTS synthesis failed.');
    }

    const payload = await response.json() as { audioContent?: string };
    usageTracker.trackTTS('Google TTS Voiceover', text.length);
    return payload.audioContent || "";
};

export const generateVoiceover = async (text: string, voice: VoiceOption | VoiceName | string): Promise<string> => {
    if (isVoiceOption(voice) && voice.provider === 'google') {
        return generateGoogleVoiceover(text, voice.id);
    }

    if (isVoiceOption(voice)) {
        return generateGeminiVoiceover(text, voice.id, {
            accentHint: voice.accentHint,
            locale: voice.locale,
            label: voice.label,
        });
    }

    return generateGeminiVoiceover(text, voice);
};

export const composeMusic = async (
    mood: string,
    genre: string,
    visualDescription?: string,
    userRequest?: string
): Promise<MusicComposition> => {
    const prompt = `
        Act as an expert Music Composer.
        CONTEXT: Suggested Mood: "${mood}". Genre: "${genre}".
        ${visualDescription ? `Visual Context: "${visualDescription}".` : ''}
        User Request: "${userRequest || 'Not specified'}".
        
        TASK: Compose a background music track (JSON).
        STRATEGY:
        1. **Fusion**: Mix elements (e.g. "Sitar + Hip Hop").
        2. **Identity**: Prefer INDIAN INSTRUMENTS if context allows.
        3. **Adaptation**: Match tempo to visual action.
        
        Compose a loopable 20s track.
        Return JSON Schema:
        {
            "trackName": "string",
            "bpm": number,
            "totalDuration": 20,
            "notes": [{"pitch": "string", "startTime": number, "duration": number, "velocity": number}]
        }
    `;

    const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: TEXT_MODEL,
        contents: { parts: [{ text: prompt }] },
        config: { responseMimeType: "application/json" }
    }));

    usageTracker.trackTokens('composeMusic', response.usageMetadata?.promptTokenCount || 0, response.usageMetadata?.candidatesTokenCount || 0);

    const text = extractResponseText(response);
    const composition = tryParseJSON<MusicComposition>(text);
    if (!composition) throw new Error("Failed to compose music.");
    return composition;
};

export const matchVoiceProfile = async (audioBase64: string, mimeType: string): Promise<VoiceMatchResponse> => {
    return { selectedVoice: VoiceName.Puck, detectedGender: "Male", detectedTone: "Neutral", reasoning: "Default match" };
};

export const analyzeMusicMood = async (metadata: MusicMetadata, scriptContext?: string): Promise<MusicAnalysis> => {
    const prompt = `You are a Viral Music Supervisor.
Metadata: ${JSON.stringify(metadata)}
Script Context: ${scriptContext || 'Not provided'}

Explain the vibe and pacing advice for syncing this music to a 9:16 reel.
Return JSON with schema:
{
  "vibe": "string",
  "pacingAdvice": "string",
  "bpmEstimate": number,
  "beatMoments": [seconds array],
  "sections": [{"label":"string","description":"string","timestamp":number}]
}`;

    const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: TEXT_MODEL,
        contents: { parts: [{ text: prompt }] },
        config: {
            responseMimeType: "application/json",
        }
    }));

    usageTracker.trackTokens('analyzeMusicMood', response.usageMetadata?.promptTokenCount || 0, response.usageMetadata?.candidatesTokenCount || 0);

    const text = extractResponseText(response);
    const parsed = tryParseJSON<MusicAnalysis>(text);
    return parsed || {
        vibe: "Energetic",
        pacingAdvice: "Keep cuts near the highlighted peaks for impact.",
        bpmEstimate: metadata.estimatedBpm,
        beatMoments: metadata.peakMoments,
        sections: metadata.peakMoments.map((time, idx) => ({ label: `Hit ${idx + 1}`, description: "Strong beat", timestamp: time }))
    };
};

// --- AI CAPTION STYLE SUGGESTION ---
const DEFAULT_CAPTION_STYLE_FALLBACK: CaptionStyleSuggestion = {
    presetId: 'tiktok_viral',
    presetName: 'TikTok Viral',
    reasoning: 'Classic high-contrast style that works for most content',
    colorScheme: {
        fillColor: '#FFFFFF',
        outlineColor: '#000000',
        highlightColor: '#FFFF00',
    },
    style: 'viral',
    animation: 'pop',
    fontFamily: 'Montserrat',
    displayMode: 'word-by-word',
    mood: 'energetic',
    fontSize: 38,
    strokeWidth: 8,
    uppercase: true,
};

export const suggestCaptionStyle = async (
    scriptContent: string,
    scriptStyle: string,
    options?: {
        brandColors?: string[];
        videoTopic?: string;
        brandAesthetic?: string;
        visualDescriptions?: string[];
    }
): Promise<CaptionStyleSuggestion> => {
    const topicBlock = options?.videoTopic ? `VIDEO TOPIC/THEME: ${options.videoTopic}` : '';
    const brandBlock = options?.brandAesthetic ? `BRAND AESTHETIC: ${options.brandAesthetic}` : '';
    const visualBlock = options?.visualDescriptions?.length
        ? `VISUAL SCENES: ${options.visualDescriptions.slice(0, 5).join(' | ')}`
        : '';
    const colorsBlock = options?.brandColors?.length
        ? `BRAND COLORS: ${options.brandColors.join(', ')}`
        : '';

    // Stable system prefix first → maximizes Gemini implicit KV-cache hits.
    const prompt = `${REEL_CAPTION_SYSTEM_PREFIX}

Your job: analyze the VIDEO THEME and content, then design a caption style that MATCHES the mood and aesthetic of the video — NOT a generic style.

${topicBlock}
SCRIPT: "${scriptContent.slice(0, 500)}"
SCRIPT STYLE: ${scriptStyle}
${colorsBlock}
${brandBlock}
${visualBlock}

CRITICAL RULES:
1. The caption style MUST match the video's visual mood — beauty content needs soft/elegant captions, tech needs clean/neon, food needs warm/inviting, fitness needs bold/energetic.
2. Colors should COMPLEMENT the video scenes, not clash with them.
3. If brand colors are provided, incorporate them into the highlight or glow color.
4. Match font to vertical (beauty→Playfair/Inter, tech→Montserrat/Oswald, fitness→Bebas/Oswald, comedy→Bangers, luxury→Playfair).
5. Professional/luxury → sentence mode; energetic/viral → word-by-word.
6. Be SPECIFIC in naming (e.g. "Golden Hour Glow", not "TikTok Viral").

Return JSON:
{
    "presetId": "theme_matched_id",
    "presetName": "Descriptive Theme Name",
    "reasoning": "Why this style matches",
    "colorScheme": {
        "fillColor": "#FFFFFF",
        "outlineColor": "#000000",
        "highlightColor": "#FFFF00",
        "glowColor": "#00FFFF",
        "gradientColors": ["#FF00FF", "#00FFFF"]
    },
    "style": "viral|neon|gradient|clean|cinematic|karaoke|highlight",
    "animation": "none|pop|bounce|fade|slide|shimmer|pulse",
    "fontFamily": "Montserrat|Bebas Neue|Inter|Oswald|Bangers|Playfair Display|Merriweather",
    "displayMode": "sentence|word-by-word",
    "mood": "energetic|calm|professional|playful|dramatic|warm|luxurious",
    "fontSize": 38,
    "strokeWidth": 8,
    "uppercase": true
}`;

    const cacheKey = hashKey(['captionStyle', TEXT_MODEL, scriptStyle, scriptContent.slice(0, 500), options || {}]);

    return captionStyleCache.getOrSet(cacheKey, async () => {
        try {
            const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
                model: TEXT_MODEL,
                contents: { parts: [{ text: prompt }] },
                config: {
                    responseMimeType: "application/json",
                    maxOutputTokens: 500,
                }
            }));

            trackGeminiUsage('suggestCaptionStyle', response);

            const text = extractResponseText(response);
            const parsed = tryParseJSON<CaptionStyleSuggestion>(text);
            if (parsed) return parsed;
        } catch (e) {
            console.warn('AI caption suggestion failed, using default', e);
        }
        return { ...DEFAULT_CAPTION_STYLE_FALLBACK };
    });
};

// --- AGENT 6: SCENE ADDER (PLANNING) ---
export const generateSingleScenePlan = async (
    topic: string,
    existingScenes: ScenePlan[],
    userInstruction: string
): Promise<ScenePlan> => {
    const existingSceneSummary = existingScenes.length > 0
        ? existingScenes.map((scene, index) => (
            `${index + 1}. sceneNumber=${scene.sceneNumber}; visualDescription=${scene.visualDescription}; imagePrompt=${scene.imagePrompt}; estimatedDuration=${scene.estimatedDuration}; scriptGuidance=${scene.scriptGuidance}`
        )).join('\n')
        : 'No existing scenes provided.';

    const prompt = `
        You are a short-form storyboard director.

        Task: Create exactly one new scene that fits seamlessly into the current narrative and visual system.

        Topic / campaign context:
        ${topic}

        Existing scenes:
        ${existingSceneSummary}

        User instruction:
        ${userInstruction}

        Rules:
        - Prioritize a sensual, narrative-first flow. Build the 'world' of the ad before worrying about asset constraints.
        - The new scene must feel additive, not repetitive.
        - If an existing asset fits perfectly, use it. Otherwise, recommend a 'generate_matching_shot' or 'generate_fresh' with a high-end visual prompt.
        - If existing scenes are based on extracted product assets or URL-derived visuals, use them as reference for 'imagined' shots.
        - Make the imagePrompt concrete, production-ready, and focus on sensory details (lighting, texture, mood).
        - Keep scriptGuidance spoken and concise.
        - estimatedDuration should usually be between 2 and 5 seconds.

        Return ONLY valid JSON:
        {
          "sceneNumber": number,
          "visualDescription": "string",
          "imagePrompt": "string",
          "estimatedDuration": number,
          "scriptGuidance": "string",
          "suggestedAssetIndex": number (index from the "Retrieved product assets" list, starting at 1, or 0 if a new 'imagined' shot is better)
        }
    `;

    const result = await generateAppText({
        prompt,
        json: true,
        temperature: 0.7,
        role: 'plan',
    });
    usageTracker.trackTokens('generateSingleScenePlan', 0, 0);

    const text = stripJsonFences(result.content);
    const plan = tryParseJSON<ScenePlan>(text);
    if (!plan) throw new Error("Failed to generate scene plan");
    // Clamp estimatedDuration to safe range
    if (typeof plan.estimatedDuration === 'number' && Number.isFinite(plan.estimatedDuration)) {
        plan.estimatedDuration = Math.max(1, Math.min(30, plan.estimatedDuration));
    } else {
        plan.estimatedDuration = 3;
    }
    return plan;
};

// --- SONG TO VIDEO ANALYSIS ---

const normalizeAudioMimeType = (mimeType?: string): string => {
    const raw = (mimeType || '').trim().toLowerCase();
    if (!raw || raw === 'application/octet-stream') return 'audio/mpeg';
    if (raw === 'audio/mp3') return 'audio/mpeg';
    return raw;
};

const buildFallbackSongSegments = (duration: number, targetScenes: number) => {
    const safeDuration = Math.max(duration, targetScenes);
    const slice = safeDuration / targetScenes;
    return Array.from({ length: targetScenes }, (_, index) => {
        const startTime = Number((index * slice).toFixed(2));
        const endTime = Number((index === targetScenes - 1 ? safeDuration : (index + 1) * slice).toFixed(2));
        return {
            startTime,
            endTime,
            description: index === 0 ? 'Intro' : index === targetScenes - 1 ? 'Outro' : `Scene ${index + 1}`,
            visualPrompt: 'Cinematic music-video frame matching the song mood, photorealistic, no text',
        };
    });
};

/** Enforce exactly N contiguous segments covering [0, duration]. */
export const normalizeSongSegments = (
    segments: SongAnalysis['segments'] | undefined,
    duration: number,
    targetScenes: number
): SongAnalysis['segments'] => {
    const safeTarget = Math.max(1, Math.min(15, targetScenes || 5));
    const safeDuration = Math.max(duration, 1);
    const cleaned = (segments || [])
        .filter((segment) => Number.isFinite(segment.startTime) && Number.isFinite(segment.endTime))
        .map((segment) => ({
            startTime: Math.max(0, segment.startTime),
            endTime: Math.max(segment.startTime + 0.25, segment.endTime),
            description: segment.description || 'Scene',
            visualPrompt: segment.visualPrompt || 'Cinematic music-video frame, photorealistic, no text',
        }))
        .sort((a, b) => a.startTime - b.startTime);

    if (cleaned.length === 0) {
        return buildFallbackSongSegments(safeDuration, safeTarget);
    }

    let normalized = cleaned.slice(0, safeTarget);

    while (normalized.length < safeTarget) {
        const last = normalized[normalized.length - 1];
        const span = Math.max(0.5, (last.endTime - last.startTime) / 2);
        last.endTime = last.startTime + span;
        normalized.push({
            startTime: last.endTime,
            endTime: last.endTime + span,
            description: `Scene ${normalized.length + 1}`,
            visualPrompt: last.visualPrompt,
        });
    }

    normalized[0].startTime = 0;
    const slice = safeDuration / safeTarget;
    normalized = normalized.map((segment, index) => ({
        ...segment,
        startTime: Number((index * slice).toFixed(2)),
        endTime: Number((index === safeTarget - 1 ? safeDuration : (index + 1) * slice).toFixed(2)),
    }));

    return normalized;
};

export const analyzeSongCulturalContext = async (
    audioBase64: string,
    duration: number = 0,
    targetSceneCount?: number,
    musicMetadata?: MusicMetadata,
    audioMimeType?: string
): Promise<SongAnalysis> => {
    // Use user preference if provided, otherwise default to 1 scene per 8 seconds (max 15)
    const targetScenes = targetSceneCount || (duration > 0 ? Math.min(15, Math.max(5, Math.floor(duration / 8))) : 5);

    // Calculate approximate duration per segment to guide the AI
    const approxSegmentDuration = duration > 0 ? Math.round(duration / targetScenes) : 10;
    const mimeType = normalizeAudioMimeType(audioMimeType);

    const tempoHint = musicMetadata?.estimatedBpm ? `Detected tempo: ~${Math.round(musicMetadata.estimatedBpm)} BPM.` : '';
    const beatHint = musicMetadata?.peakMoments?.length
        ? `Key beat accents (seconds): ${musicMetadata.peakMoments.map(t => t.toFixed(1)).join(', ')}. Align segment boundaries near these moments when possible.`
        : '';

    const prompt = `
        You are a Cultural Musicologist and Visual Director for music videos.
        Analyze this audio clip. Use web research when helpful to ground cultural context,
        genre history, fashion/era references, and visual tropes — but stay faithful to what you hear.

        Task:
        1. Identify the Cultural Context (Region, Tradition, Era, Vibe).
        2. Describe the Mood and Imagery associated with this style.
        3. Create a consistent MAIN CHARACTER description that fits this song's vibe (e.g., "A young woman in 90s grunge fashion", "A futuristic cyberpunk hacker").
        4. Suggest 3-5 specific visual themes (suggestedVisuals) that form a cohesive music-video look bible.
        5. If vocals are intelligible, extract 2-5 short lyricHooks (chorus/hook lines). If instrumental, return [].
        6. Add brief structureNotes (intro / verse / chorus / drop / outro mapping with approximate times).
        7. Segment the song into EXACTLY ${targetScenes} logical parts.
           Each segment should be approximately ${approxSegmentDuration} seconds long.
           Ensure the total duration of segments covers the full song (approx ${duration}s).
           IMPORTANT: You MUST return exactly ${targetScenes} segments.
           Each visualPrompt must be a concrete cinematic shot description (camera, subject, lighting, environment) with NO on-image text.
        8. Respect musicality:
           ${tempoHint || 'If you can infer BPM, keep pacing consistent.'}
           ${beatHint || 'Keep segment transitions on natural beat changes when identifiable.'}

        Return JSON:
        {
            "culturalContext": "string",
            "mood": "string",
            "imagery": "string",
            "characterDescription": "string",
            "suggestedVisuals": ["string", "string"],
            "lyricHooks": ["string"],
            "structureNotes": "string",
            "segments": [
                {
                    "startTime": number,
                    "endTime": number,
                    "description": "string",
                    "visualPrompt": "string"
                }
            ]
        }
    `;

    const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
        model: PLAN_MODEL,
        tools: [{ googleSearch: {} }],
        contents: {
            parts: [
                { inlineData: { data: audioBase64, mimeType } },
                { text: prompt }
            ]
        },
        config: { responseMimeType: "application/json", temperature: 0.5 }
    } as any));

    usageTracker.trackTokens('analyzeSongCulturalContext', response.usageMetadata?.promptTokenCount || 0, response.usageMetadata?.candidatesTokenCount || 0);

    const text = extractResponseText(response);
    const analysis = tryParseJSON<SongAnalysis>(text);

    if (!analysis) {
        return {
            culturalContext: "Unknown",
            mood: "Upbeat",
            imagery: "Generic visuals",
            characterDescription: "A silhouette figure dancing",
            suggestedVisuals: ["Abstract colors", "Dancing figures", "Cinematic city night"],
            lyricHooks: [],
            structureNotes: "Fallback structure — analysis parse failed",
            segments: buildFallbackSongSegments(duration, targetScenes)
        };
    }

    analysis.suggestedVisuals = (analysis.suggestedVisuals || []).filter(Boolean).slice(0, 6);
    analysis.lyricHooks = (analysis.lyricHooks || []).filter(Boolean).slice(0, 6);
    analysis.segments = normalizeSongSegments(analysis.segments, duration, targetScenes);

    return analysis;
};

export const generateSongVisuals = async (
    context: string,
    segmentDescription: string,
    characterDescription?: string,
    previousImageBase64?: string,
    styleBible?: string[]
): Promise<string> => {
    const lookBook = (styleBible || []).filter(Boolean).slice(0, 5);
    const prompt = `
        Create a cinematic, high-quality still for a music video (vertical 9:16).
        Cultural Context: ${context}
        ${characterDescription ? `Main Character: ${characterDescription} (keep appearance consistent across scenes)` : ''}
        ${lookBook.length ? `Look bible / visual themes to honor:\n${lookBook.map((theme) => `- ${theme}`).join('\n')}` : ''}
        ${previousImageBase64 ? 'Reference the attached image for character identity and palette continuity.' : ''}
        Scene Description: ${segmentDescription}
        Style: Photorealistic, cinematic lighting, filmic color, no text, no watermarks, no logos.
    `;
    return generateImageAsset({
        mode: previousImageBase64 ? 'edit' : 'generate',
        imagePrompt: prompt,
        visualDescription: segmentDescription,
        continuityDomain: 'character',
        skipPromptReview: true,
        primaryReference: previousImageBase64 ? {
            data: previousImageBase64,
            mimeType: 'image/png',
        } : undefined,
        prevSceneText: previousImageBase64 ? segmentDescription : undefined,
        currentSceneText: segmentDescription,
    });
};


// --- AGENT 7: SCRIPT SEGMENT ADDER (SCRIPTING) ---
export interface SceneGenerationContext {
    prevSceneText?: string;
    prevVisualDescription?: string;
    nextSceneText?: string;
    nextVisualDescription?: string;
    insertPosition: number;
    totalScenes: number;
    brandContext?: string;
    allSegments?: string[];
}

export const generateSingleScriptSegment = async (
    currentScript: string,
    userInstruction: string,
    context?: SceneGenerationContext
): Promise<{ segmentText: string; visualDescription: string; imagePrompt: string }> => {
    const segmentsList = context?.allSegments?.length
        ? context.allSegments.map((s, i) => `  Scene ${i + 1}: "${s}"`).join('\n')
        : null;

    const scriptContext = segmentsList
        ? `Scene-by-scene breakdown:\n${segmentsList}`
        : `Script: "${currentScript.slice(0, 2000)}"`;

    const neighborContext = [
        context?.prevSceneText ? `Previous scene (Scene ${context.insertPosition}) narration: "${context.prevSceneText}"` : null,
        context?.prevVisualDescription ? `Previous scene visual: "${context.prevVisualDescription}"` : null,
        context?.nextSceneText ? `Next scene (Scene ${(context.insertPosition || 0) + 2}) narration: "${context.nextSceneText}"` : null,
        context?.nextVisualDescription ? `Next scene visual: "${context.nextVisualDescription}"` : null,
    ].filter(Boolean).join('\n');

    const positionHint = context
        ? `This new scene will be Scene ${context.insertPosition + 1} of ${context.totalScenes + 1} total.`
        : '';

    const prompt = `You are a Script Writer adding a new segment to a short-form video script.

${scriptContext}

${positionHint}
${neighborContext ? `\nNeighbor scene context:\n${neighborContext}` : ''}
${context?.brandContext ? `\nBrand/Product context: ${context.brandContext}` : ''}

User Instruction: "${userInstruction}"

Task: Write a short, punchy script line (1-2 sentences) that fits naturally between the neighboring scenes (if any) and matches the overall script tone. Also provide a matching visual description and a detailed image generation prompt.

Return JSON:
{
    "segmentText": "The actual spoken words for this scene",
    "visualDescription": "What is visually seen on screen",
    "imagePrompt": "Detailed AI image generation prompt (photorealistic, 9:16, NO TEXT, NO WATERMARKS)"
}`;

    const appText = await generateAppText({
        prompt,
        json: true,
        temperature: 0.7,
        role: 'worker',
    });
    usageTracker.trackTokens('generateSingleScriptSegment', 0, 0);

    const text = stripJsonFences(appText.content);
    const result = tryParseJSON<{ segmentText: string; visualDescription: string; imagePrompt: string }>(text);
    if (!result) throw new Error("Failed to generate script segment");
    return result;
};

// --- IMAGE ANALYSIS FOR UPLOADED ASSETS ---

export interface UploadedImageAnalysis {
  /** What the image depicts (concise description) */
  description: string;
  /** Key visual elements detected */
  visualElements: string[];
  /** Whether the product/bottle/packaging is visible */
  showsProduct: boolean;
  /** Whether there's a person in the image */
  showsPerson: boolean;
  /** Whether it's a lifestyle/context shot vs product-focused */
  isLifestyle: boolean;
  /** Suggested scene role this image fits best */
  suggestedRole: 'hook' | 'product_hero' | 'ingredients' | 'application' | 'results' | 'social_proof' | 'cta' | 'lifestyle' | 'any';
  /** Confidence in the match (0-1) */
  confidence: number;
  /** Why this image fits the suggested role */
  reasoning: string;
  /** Suggested visual description for scene planning */
  suggestedVisualDescription: string;
  /** Suggested image prompt for AI generation continuity */
  suggestedImagePrompt: string;
}

export interface SceneMatchResult {
  /** The scene index this image best matches (0-based) */
  sceneIndex: number;
  /** Confidence in the match (0-1) */
  confidence: number;
  /** Why this scene is the best fit */
  reasoning: string;
  /** Whether this image could work as an alternative for other scenes */
  alternativeScenes: number[];
}

export interface UploadedImageWithMatch {
  analysis: UploadedImageAnalysis;
  match: SceneMatchResult | null;
}

/**
 * Analyze an uploaded image using Gemini Vision and determine which scene it best fits.
 * Takes the full campaign context (brief, scenes, platform) for intelligent matching.
 */
export const analyzeUploadedImageForScenes = async (input: {
  imageBase64: string;
  imageMimeType: string;
  fileName: string;
  scenes: Array<{
    index: number;
    role: string;
    text: string;
    visualDescription: string;
    imagePrompt: string;
  }>;
  brief: string;
  productTitle: string;
  platform: string;
}): Promise<UploadedImageWithMatch> => {
  const parts: any[] = [
    {
      inlineData: {
        data: input.imageBase64,
        mimeType: input.imageMimeType
      }
    }
  ];

  const scenesContext = input.scenes.map(s =>
    `Scene ${s.index + 1} (${s.role}):\n` +
    `  - Text: ${s.text}\n` +
    `  - Visual: ${s.visualDescription}\n` +
    `  - Image prompt: ${s.imagePrompt}`
  ).join('\n');

  const prompt = `
You are a creative director analyzing an uploaded image for a ${input.platform} ad campaign.

PRODUCT: ${input.productTitle}
BRIEF: ${input.brief}

CURRENT SCENES:
${scenesContext}

Analyze the uploaded image and determine which scene it best matches.

Consider:
- What does the image actually show? (product, person, lifestyle, ingredients, results, etc.)
- Which scene's visual intent aligns with what this image depicts?
- Is this a product hero shot, lifestyle shot, application shot, results, etc.?
- For ${input.platform}, what type of content performs well? (hook-first, proof-driven, etc.)
- Does the image quality and composition fit the scene's needs?

Return ONLY a JSON object with this exact shape:
{
  "analysis": {
    "description": "Concise description of what the image shows",
    "visualElements": ["element1", "element2", "element3"],
    "showsProduct": true,
    "showsPerson": false,
    "isLifestyle": false,
    "suggestedRole": "hook",
    "confidence": 0.85,
    "reasoning": "Why this image fits the suggested role",
    "suggestedVisualDescription": "How this image could be described for scene planning",
    "suggestedImagePrompt": "How to describe this image for AI generation continuity"
  },
  "match": {
    "sceneIndex": 0,
    "confidence": 0.9,
    "reasoning": "Why this scene is the best fit for this image",
    "alternativeScenes": [1, 2]
  }
}

If the image doesn't clearly match any scene, set match to null.
`;

   const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
     model: PLAN_MODEL,
     contents: { parts },
     config: {
       responseMimeType: 'application/json',
       temperature: 0.3,
     }
   }));

  usageTracker.trackTokens('analyzeUploadedImage', response.usageMetadata?.promptTokenCount || 0, response.usageMetadata?.candidatesTokenCount || 0);

  const text = extractResponseText(response);
  const parsed = tryParseJSON<UploadedImageWithMatch>(text);
  if (!parsed || !parsed.analysis) {
    throw new Error('Failed to analyze uploaded image');
  }

  return parsed;
};

/**
 * Analyze all available images and suggest scene expansions or rewrites.
 * This helps when the user has uploaded/generated images that could support
 * additional scenes or better scene descriptions.
 */
export const suggestSceneExpansion = async (input: {
  brief: string;
  productTitle: string;
  platform: string;
  durationSec: number;
  currentScenes: Array<{
    index: number;
    role: string;
    text: string;
    visualDescription: string;
    imagePrompt: string;
    hasAsset: boolean;
    assetDescription?: string;
  }>;
  availableImages: Array<{
    description: string;
    visualElements: string[];
    showsProduct: boolean;
    isLifestyle: boolean;
    suggestedRole: string;
  }>;
}): Promise<{
  shouldExpand: boolean;
  reasoning: string;
  suggestedScenes?: Array<{
    role: string;
    text: string;
    visualDescription: string;
    imagePrompt: string;
    usesExistingImage: boolean;
    imageDescription: string;
  }>;
}> => {
  const scenesContext = input.currentScenes.map(s =>
    `Scene ${s.index + 1} (${s.role}): "${s.text}" - ${s.visualDescription} [has asset: ${s.hasAsset}]`
  ).join('\n');

  const imagesContext = input.availableImages.map((img, i) =>
    `Image ${i + 1}: ${img.description} - shows product: ${img.showsProduct}, lifestyle: ${img.isLifestyle}, suggested role: ${img.suggestedRole}`
  ).join('\n');

  const prompt = `
You are a creative director optimizing a ${input.platform} ad campaign.

PRODUCT: ${input.productTitle}
BRIEF: ${input.brief}
DURATION: ${input.durationSec} seconds

CURRENT SCENES:
${scenesContext}

AVAILABLE IMAGES:
${imagesContext}

Analyze whether the current scene plan should be expanded or rewritten based on:
1. The available images - are there images that don't fit any current scene?
2. The brief - are there claims or angles not covered by current scenes?
3. The platform - for ${input.platform}, what structure performs best right now?
4. The duration - is the scene count appropriate for ${input.durationSec}s?

For ${input.platform} ads specifically, consider:
- Hook must grab attention in first 1-2 seconds
- Proof/benefit should come early
- CTA must be clear
- Pacing should match platform conventions (fast for TikTok, polished for Reels, etc.)
- Current viral patterns for this product category

Return ONLY a JSON object:
{
  "shouldExpand": true,
  "reasoning": "Why expansion is recommended",
  "suggestedScenes": [
    {
      "role": "hook",
      "text": "Voiceover text for the scene",
      "visualDescription": "What the viewer sees",
      "imagePrompt": "AI image generation prompt",
      "usesExistingImage": true,
      "imageDescription": "Which existing image to use"
    }
  ]
}

If no expansion needed, set shouldExpand to false and omit suggestedScenes.
`;

   const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
     model: PLAN_MODEL,
     contents: [{ parts: [{ text: prompt }] }],
     config: {
       responseMimeType: "application/json",
       temperature: 0.5,
     }
   }));

  usageTracker.trackTokens('suggestSceneExpansion', response.usageMetadata?.promptTokenCount || 0, response.usageMetadata?.candidatesTokenCount || 0);

  const text = extractResponseText(response);
  const parsed = tryParseJSON<any>(text);
  if (!parsed) {
    return { shouldExpand: false, reasoning: 'Failed to analyze scene expansion' };
  }

  return parsed;
};

export const resolveFontFamily = (typography?: { headingStyle?: string; bodyStyle?: string; characterTraits?: string }): { heading: string; body: string } => {
  const FONT_NAME_MAP: { match: RegExp; name: string }[] = [
    // sans must be checked BEFORE serif, since 'sans-serif' contains 'serif'
    { match: /sans|clean|modern|contemporary|simple|neutral|minimal/i, name: 'Helvetica Neue' },
    { match: /serif|elegant|classic|editorial|luxury|sophisticated|refined/i, name: 'Playfair Display' },
    { match: /mono|technical|geometric|precise/i, name: 'JetBrains Mono' },
    { match: /condensed|impact|strong|athletic/i, name: 'Arial Narrow' },
    { match: /script|handwritten|casual|playful|organic/i, name: 'Brush Script MT' },
  ];

  const resolve = (desc: string): string => {
    for (const entry of FONT_NAME_MAP) {
      if (entry.match.test(desc)) return entry.name;
    }
    return 'Helvetica Neue';
  };

  return {
    heading: resolve(typography?.headingStyle || ''),
    body: resolve(typography?.bodyStyle || typography?.characterTraits || ''),
  };
};
