import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Dispatch } from 'react';
import type { StudioAction } from '../../components/AIImageStudio/useStudioReducer';
import type { ProductTruth, StudioAsset } from '../../components/AIImageStudio/types';
import {
  mergeProductAssets,
  refreshProductTruth,
} from '../../components/AIImageStudio/productTruthOrchestration';

vi.mock('../../components/AIImageStudio/productTruthService', () => ({
  buildPreliminaryProductTruth: vi.fn(
    (assets: StudioAsset[], signals?: { productName?: string }) => ({
      id: 'prelim-id',
      productName: signals?.productName || assets[0]?.name || 'Unknown product',
      protectedAssetIds: assets.map((a) => a.id),
      preservationRules: ['Preserve identity'],
      verifiedFacts: signals?.productName ? [`Product name: ${signals.productName}`] : [],
      unresolvedQuestions: ['Full visual analysis in progress…'],
      userCorrections: [],
    }),
  ),
  analyzeProductTruth: vi.fn(async (opts: { productAssets: StudioAsset[] }) => ({
    id: 'analyzed-id',
    productName: opts.productAssets[0]?.name || 'Analyzed',
    protectedAssetIds: opts.productAssets.map((a) => a.id),
    preservationRules: ['Preserve: label'],
    verifiedFacts: ['Detected: matte tin'],
    unresolvedQuestions: [],
    userCorrections: [],
  })),
}));

function makeAsset(id: string, name = id): StudioAsset {
  return {
    id,
    name,
    description: '',
    base64: 'abc',
    mimeType: 'image/png',
    width: 1,
    height: 1,
    source: 'upload',
    createdAt: new Date().toISOString(),
  };
}

describe('productTruthOrchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges product assets by id without duplicates', () => {
    const a = makeAsset('a');
    const b = makeAsset('b');
    const a2 = makeAsset('a', 'a-renamed');
    expect(mergeProductAssets([a], [b, a2]).map((x) => x.id)).toEqual(['a', 'b']);
    expect(mergeProductAssets([a], [b, a2]).find((x) => x.id === 'a')?.name).toBe('a-renamed');
  });

  it('dispatches preliminary then analyzed truth preserving id and corrections', async () => {
    const actions: StudioAction[] = [];
    const dispatch = ((action: StudioAction) => {
      actions.push(action);
    }) as Dispatch<StudioAction>;

    const existing: ProductTruth = {
      id: 'keep-me',
      productName: 'Old',
      protectedAssetIds: ['old'],
      preservationRules: [],
      verifiedFacts: [],
      unresolvedQuestions: [],
      userCorrections: ['Keep matte finish'],
    };

    await refreshProductTruth(dispatch, [makeAsset('new', 'Serum')], undefined, existing);

    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({
      type: 'SET_PRODUCT_TRUTH',
      productTruth: {
        id: 'keep-me',
        userCorrections: ['Keep matte finish'],
      },
    });
    expect(actions[1]).toMatchObject({
      type: 'SET_PRODUCT_TRUTH',
      productTruth: {
        id: 'keep-me',
        userCorrections: ['Keep matte finish'],
        preservationRules: ['Preserve: label'],
      },
    });
  });

  it('clears product truth when no assets remain', async () => {
    const actions: StudioAction[] = [];
    const dispatch = ((action: StudioAction) => {
      actions.push(action);
    }) as Dispatch<StudioAction>;

    await refreshProductTruth(
      dispatch,
      [],
      undefined,
      {
        id: 'x',
        productName: 'Gone',
        protectedAssetIds: [],
        preservationRules: [],
        verifiedFacts: [],
        unresolvedQuestions: [],
        userCorrections: [],
      },
    );

    expect(actions).toEqual([{ type: 'CLEAR_PRODUCT_TRUTH' }]);
  });
});
