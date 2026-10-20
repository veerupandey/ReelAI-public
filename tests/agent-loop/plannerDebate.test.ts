import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeGeminiVision = vi.fn();

vi.mock('../../services/agentLoop/modelRouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/agentLoop/modelRouter')>();
  return { ...actual, routeGeminiVision };
});

const {
  debateScenePlan,
  debateTaskGraph,
  debateTranscriptMarkdown,
  shouldRunPlannerDebate,
  shouldReviewTaskGraphAfterIngest,
} = await import('../../services/agentLoop/plannerDebate');

const images = [
  { mimeType: 'image/png', data: 'aaaa', label: 'Product packshot' },
  { mimeType: 'image/png', data: 'bbbb', label: 'Reference frame — ref1.png' },
];

const graph = {
  skillPath: 'recreate_reference_video' as const,
  summary: 'Kimi draft',
  stopCriteria: ['all goals pass'],
  steps: [
    { id: 'ingest_ref', title: 'Ingest reference', tools: [], advances: ['reference_analyzed' as const] },
    { id: 'lock_product', title: 'Lock product', tools: [], advances: ['brand_product_locked' as const] },
    { id: 'plan', title: 'Plan scenes', tools: [], advances: ['scenes_planned' as const] },
  ],
};

const scenes = [
  { index: 0, role: 'hook', targetDurationSec: 5, imagePrompt: 'draft hook', voiceoverText: 'draft vo' },
  { index: 1, role: 'cta', targetDurationSec: 5, imagePrompt: 'draft cta', voiceoverText: 'buy now' },
];

beforeEach(() => {
  routeGeminiVision.mockReset();
});

describe('shouldRunPlannerDebate', () => {
  it('needs both a product image and a reference frame', () => {
    expect(shouldRunPlannerDebate(images)).toBe(true);
    expect(shouldRunPlannerDebate([images[0]])).toBe(false);
    expect(shouldRunPlannerDebate([images[1]])).toBe(false);
    expect(shouldRunPlannerDebate([])).toBe(false);
  });
});

describe('shouldReviewTaskGraphAfterIngest', () => {
  const images = [
    { label: 'Product packshot', data: 'aaa', mimeType: 'image/png' },
    { label: 'Reference frame 1', data: 'bbb', mimeType: 'image/jpeg' },
  ];

  it('reviews after ingest when bootstrap had nothing to look at', () => {
    expect(shouldReviewTaskGraphAfterIngest({
      images,
      bootstrapDebate: { skippedReason: 'no product or reference imagery' },
    })).toBe(true);
  });

  it('reviews after ingest when bootstrap never ran a debate', () => {
    expect(shouldReviewTaskGraphAfterIngest({ images })).toBe(true);
  });

  it('does not review twice when bootstrap already saw the images', () => {
    expect(shouldReviewTaskGraphAfterIngest({
      images,
      bootstrapDebate: {},
    })).toBe(false);
  });

  it('does not review when frames were never captured', () => {
    expect(shouldReviewTaskGraphAfterIngest({
      images: [{ label: 'Product packshot', data: 'aaa', mimeType: 'image/png' }],
    })).toBe(false);
  });
});

describe('debateTaskGraph', () => {
  it('skips the Pro call when there is nothing to look at', async () => {
    const out = await debateTaskGraph({ graph, goal: 'g', images: [images[0]] });
    expect(routeGeminiVision).not.toHaveBeenCalled();
    expect(out.merged).toBe(graph);
    expect(out.skippedReason).toBeTruthy();
  });

  it('applies revised steps and keeps goal ids valid', async () => {
    routeGeminiVision.mockResolvedValue({
      modelId: 'gemini-3.1-pro-preview',
      content: JSON.stringify({
        agree: false,
        notes: ['reference is faster than the draft'],
        productIdentityRisks: ['scene 1 shows a logo, not the product'],
        summary: 'Pro revised',
        steps: [
          { id: 'ingest_ref', title: 'Ingest reference', tools: [], advances: ['reference_analyzed'], producer: 'reference_ingest' },
          { id: 'lock_product', title: 'Lock product from shop page', tools: [], advances: ['brand_product_locked'] },
          { id: 'plan', title: 'Plan tighter beats', tools: [], advances: ['scenes_planned', 'not_a_goal'], producer: 'stills' },
        ],
      }),
    });

    const out = await debateTaskGraph({ graph, goal: 'g', images });
    expect(out.applied).toBe(true);
    expect(out.merged.summary).toBe('Pro revised');
    expect(out.merged.steps[2].advances).toEqual(['scenes_planned']);
    expect(out.merged.steps[2].producer).toBe('stills');
    expect(out.risks[0]).toMatch(/logo/);
  });

  it('rejects a revision that drops every goal advance', async () => {
    routeGeminiVision.mockResolvedValue({
      modelId: 'pro',
      content: JSON.stringify({
        agree: false,
        steps: [
          { id: 'a', title: 'A', advances: ['nope'] },
          { id: 'b', title: 'B', advances: [] },
          { id: 'c', title: 'C' },
        ],
      }),
    });

    const out = await debateTaskGraph({ graph, goal: 'g', images });
    expect(out.applied).toBe(false);
    expect(out.merged.steps).toEqual(graph.steps);
  });

  it('keeps the Kimi draft when Pro fails', async () => {
    routeGeminiVision.mockRejectedValue(new Error('quota exhausted'));
    const out = await debateTaskGraph({ graph, goal: 'g', images });
    expect(out.applied).toBe(false);
    expect(out.merged).toBe(graph);
    expect(out.skippedReason).toBe('quota exhausted');
  });
});

describe('debateScenePlan', () => {
  it('returns only revisions for real scene indexes with real content', async () => {
    routeGeminiVision.mockResolvedValue({
      modelId: 'pro',
      content: JSON.stringify({
        agree: false,
        notes: ['hook needs the product in frame'],
        productIdentityRisks: ['scene 2 shows packaging only'],
        revisions: [
          { index: 0, imagePrompt: 'hero the whisk in morning light', reason: 'match reference' },
          { index: 7, imagePrompt: 'out of range' },
          { index: 1, reason: 'no actual change' },
        ],
      }),
    });

    const out = await debateScenePlan({ scenes, productTitle: 'Matcha whisk', images });
    expect(out.applied).toBe(true);
    expect(out.merged).toHaveLength(1);
    expect(out.merged[0].index).toBe(0);
    expect(out.risks).toHaveLength(1);
  });

  it('skips when there are no images', async () => {
    const out = await debateScenePlan({ scenes, productTitle: 'x', images: [] });
    expect(routeGeminiVision).not.toHaveBeenCalled();
    expect(out.merged).toEqual([]);
  });
});

describe('debateTranscriptMarkdown', () => {
  it('reports a skip without pretending a review happened', () => {
    const md = debateTranscriptMarkdown('Planner debate · task graph', {
      merged: null,
      applied: false,
      notes: [],
      risks: [],
      transcript: '',
      skippedReason: 'no product + reference images',
    });
    expect(md).toContain('Skipped');
  });
});
