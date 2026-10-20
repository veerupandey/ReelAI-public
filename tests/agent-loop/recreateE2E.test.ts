/**
 * End-to-end recreate path (mocked models):
 * Direction → launch params → intent → goal card → task graph → debate timing → ingest → goals.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAdDirection } from '../../runtime/adDirectionParse';
import { buildAdCreatorLaunchParams } from '../../services/adCreatorLaunch';
import {
  missingProductIdentity,
  resolvePromptUrlRoles,
} from '../../services/promptUrlRoles';
import { classifyIntent } from '../../services/agentLoop/intentRouter';
import { createGoalCard, allRequiredPassed } from '../../services/agentLoop/goalCard';
import { templateTaskGraph } from '../../services/agentLoop/taskPlanner';
import {
  debateScenePlan,
  shouldReviewTaskGraphAfterIngest,
  shouldRunPlannerDebate,
} from '../../services/agentLoop/plannerDebate';
import { planRecreatePath, defaultMotionHint } from '../../services/agentLoop/recreateReferencePath';
import { executeRecreateIngest } from '../../services/agentLoop/recreateIngest';
import { completeStepById } from '../../services/agentLoop/stepRunner';
import { bootstrapLoop } from '../../services/agentLoop/loopController';
import type { LoopRunState } from '../../services/agentLoop/types';

const IG = 'https://www.instagram.com/reel/DK7xyz/';
const SHOP = 'https://kageha.ca/products/matcha-whisk';
const DIRECTION = `Recreate this Instagram reel for our brand: ${IG}
Product: ${SHOP}
15s Reels, quiet luxury, calm`;

const { routeGeminiVision, routePlanText } = vi.hoisted(() => ({
  routeGeminiVision: vi.fn(),
  routePlanText: vi.fn(),
}));
vi.mock('../../services/agentLoop/modelRouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/agentLoop/modelRouter')>();
  return { ...actual, routeGeminiVision, routePlanText };
});

const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('recreate E2E pipeline', () => {
  beforeEach(() => {
    routeGeminiVision.mockReset();
    routePlanText.mockReset();
    // Force the deterministic template path — this suite covers wiring, not Kimi.
    routePlanText.mockRejectedValue(new Error('offline planner'));
  });

  it('walks launch → roles → intent → plan → ingest → debate timing without mixing URLs', async () => {
    // 1. Studio parse
    const parsed = parseAdDirection({ text: DIRECTION });
    expect(parsed.isRecreate).toBe(true);
    expect(parsed.values.platform).toBe('instagram_reels');
    expect(parsed.values.durationSec).toBe(15);
    expect(parsed.values.productUrl).toBe(SHOP);
    expect(parsed.values.referenceUrl).toBe(IG);

    // 2. Launch params (IG first in prose must not become product)
    const params = buildAdCreatorLaunchParams({
      formValues: {
        adFormat: 'stitched_video',
        platform: String(parsed.values.platform),
        durationSec: Number(parsed.values.durationSec),
        style: String(parsed.values.style || 'luxe_minimalist'),
        productUrl: String(parsed.values.productUrl || ''),
        referenceUrl: String(parsed.values.referenceUrl || ''),
      },
      direction: DIRECTION,
      researchSeed: null,
      productPackshot: { base64: tinyPng, mimeType: 'image/png', name: 'whisk.png' },
    });
    expect(params.productUrl).toBe(SHOP);
    expect(params.referenceUrl).toBe(IG);
    expect(params.userDirection).toBe(DIRECTION);

    // 3. Guard: recreate without product identity fails
    const rolesOnlyRef = resolvePromptUrlRoles({ prompt: `Recreate ${IG}` });
    expect(missingProductIdentity(rolesOnlyRef, { hasPackshot: false })).toBe(true);
    expect(missingProductIdentity(
      resolvePromptUrlRoles({
        prompt: DIRECTION,
        explicitProductUrl: String(params.productUrl),
        explicitReferenceUrl: String(params.referenceUrl),
      }),
      { hasPackshot: true },
    )).toBe(false);

    // 4. Intent + goal card + template graph
    const intent = classifyIntent({
      prompt: DIRECTION,
      adFormat: 'stitched_video',
      productUrl: String(params.productUrl),
      referenceUrl: String(params.referenceUrl),
      referenceUploadCount: 0,
    });
    expect(intent.skillPath).toBe('recreate_reference_video');
    expect(intent.productUrl).toBe(SHOP);
    expect(intent.referenceUrl).toBe(IG);

    const goals = createGoalCard(DIRECTION, intent.skillPath);
    const graph = templateTaskGraph(intent.skillPath, DIRECTION);
    expect(graph.steps.some((s) => s.producer === 'reference_ingest')).toBe(true);
    expect(graph.steps.some((s) => s.producer === 'structure_analysis')).toBe(true);

    // 5. Bootstrap without images → debate skipped (frames arrive after ingest)
    const bootstrap = await bootstrapLoop({
      prompt: DIRECTION,
      adFormat: 'stitched_video',
      productUrl: SHOP,
      referenceUrl: IG,
      debateImages: [],
    });
    expect(bootstrap.intent.skillPath).toBe('recreate_reference_video');
    expect(Boolean(bootstrap.debate?.skippedReason) || !bootstrap.debate).toBe(true);

    // 6. Path + ingest (mock capture)
    const path = planRecreatePath({
      referenceUrl: IG,
      referenceUploads: [],
      taskGraph: graph,
    });
    expect(path.ingest).toBe('url_screenshot_carousel');
    // Template recreate graph prefers I2V producers → Live Motion default.
    expect(defaultMotionHint(path)).toBe('wan_i2v');
    expect(path.preferLiveMotionDefault).toBe(true);

    const ingest = await executeRecreateIngest({
      referenceUploads: [],
      referenceUrl: IG,
      ingest: path.ingest,
      capture: (async () => ({
        uploads: [{
          id: 'f1',
          name: 'ref1.png',
          base64: tinyPng,
          mimeType: 'image/png',
          note: 'captured',
        }],
        url: IG,
      })) as any,
    });
    expect(ingest.uploads).toHaveLength(1);

    // 7. After ingest, graph review should run once images exist
    const debateImages = [
      { label: 'Product packshot', data: tinyPng, mimeType: 'image/png' },
      { label: 'Reference frame 1', data: tinyPng, mimeType: 'image/png' },
    ];
    expect(shouldRunPlannerDebate(debateImages)).toBe(true);
    expect(shouldReviewTaskGraphAfterIngest({
      images: debateImages,
      bootstrapDebate: bootstrap.debate,
    })).toBe(true);

    // 8. Scene debate applies Pro revision
    routeGeminiVision.mockResolvedValueOnce({
      modelId: 'gemini-3.1-pro',
      content: JSON.stringify({
        agree: false,
        notes: ['Open on whisk, not logo'],
        productIdentityRisks: ['Product identity'],
        revisions: [{
          index: 0,
          imagePrompt: 'Hero whisk on linen, soft window light',
          voiceoverText: 'Ceremonial grade. Everyday ritual.',
        }],
      }),
    });
    const sceneDebate = await debateScenePlan({
      scenes: [{
        index: 0,
        role: 'hook',
        targetDurationSec: 3,
        imagePrompt: 'Generic lifestyle',
        voiceoverText: 'Buy now',
      }],
      productTitle: 'Matcha Whisk',
      facts: ['Bamboo', 'Ceremonial'],
      brief: DIRECTION,
      images: debateImages,
    });
    expect(sceneDebate.applied).toBe(true);
    expect(sceneDebate.merged[0].imagePrompt).toMatch(/whisk/i);

    // 9. Goal card advances through recreate steps
    let state: LoopRunState = {
      goalCard: goals,
      taskGraph: graph,
      stepIndex: 0,
      stepsExecuted: 0,
      spentUsd: 0,
      softMaxSteps: 24,
      softMaxUsd: 25,
      consecutiveNoProgress: 0,
      escalationContinues: 0,
    };
    for (const stepId of [
      'ingest_ref', 'structure', 'lock_product', 'plan_scenes',
      'stills', 'motion', 'assemble', 'verify', 'deliver',
    ]) {
      state = completeStepById(state, stepId, stepId).state;
    }
    expect(allRequiredPassed(state.goalCard)).toBe(true);
  });
});
