import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import StoryboardScreen from '../../components/StoryboardScreen';
import type { BrandAsset, ProductContext, StoryboardSceneState } from '../../types/brand';

const asset: BrandAsset = {
  id: 'asset_1',
  type: 'product',
  base64: 'ZmFrZQ==',
  mimeType: 'image/jpeg',
  description: 'Hero bottle',
  previewUrl: 'data:image/jpeg;base64,ZmFrZQ==',
};

const lockedProduct: ProductContext = {
  productId: 'prod_1',
  productUrl: 'https://example.com/p',
  productTitle: 'Saffron Oil',
  brandName: 'Bare and Fair',
  productAssets: [asset],
  productFacts: [],
  allowedClaims: [],
  signalSummary: '',
  platform: 'tiktok',
  durationSec: 15,
};

const baseScene: StoryboardSceneState = {
  id: 'scene_1',
  sceneNumber: 1,
  text: 'Hook opening beat',
  visualDescription: 'Hero packshot',
  imagePrompt: 'Bottle on stone',
  route: 'use_existing',
  visualTask: 'use_imported',
  recipe: {
    productId: 'prod_1',
    productTitle: 'Saffron Oil',
    route: 'use_existing',
    sourceMode: 'use_exact_asset',
    visualTask: 'use_imported',
  },
};

const renderScreen = (overrides: Partial<React.ComponentProps<typeof StoryboardScreen>> = {}) => {
  const props: React.ComponentProps<typeof StoryboardScreen> = {
    platform: 'tiktok',
    setPlatform: vi.fn(),
    adFormat: 'stitched_video',
    setAdFormat: vi.fn(),
    objective: 'conversion',
    setObjective: vi.fn(),
    durationSec: 15,
    setDurationSec: vi.fn(),
    executionMode: 'balanced',
    setExecutionMode: vi.fn(),
    audience: '',
    setAudience: vi.fn(),
    callToAction: '',
    setCallToAction: vi.fn(),
    tone: '',
    setTone: vi.fn(),
    briefText: 'Premium saffron oil ad',
    setBriefText: vi.fn(),
    sceneCount: 1,
    scenes: [baseScene],
    lockedProduct,
    availableAssets: [asset],
    excludedAssetIds: [],
    toAssetPreviewUrl: (a) => a?.previewUrl,
    onGenerateStoryboard: vi.fn(),
    isGeneratingStoryboard: false,
    onBack: vi.fn(),
    onNext: vi.fn(),
    onAssignSceneBaseAsset: vi.fn(),
    onAddScene: vi.fn(),
    ...overrides,
  };
  return render(<StoryboardScreen {...props} />);
};

describe('StoryboardScreen', () => {
  it('keeps Generate Ad enabled with brief + scenes and shows readiness warnings', () => {
    renderScreen();
    expect((screen.getByRole('button', { name: 'Generate Ad →' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/Storyboard readiness/i)).toBeTruthy();
    expect(screen.getByText(/Needs image/i)).toBeTruthy();
  });

  it('disables next without scenes and labels carousel next action', () => {
    renderScreen({
      scenes: [],
      sceneCount: 0,
      adFormat: 'carousel',
      briefText: 'Carousel brief',
    });
    expect((screen.getByRole('button', { name: 'Review Carousel →' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/at least one scene/i)).toBeTruthy();
  });

  it('offers Add Scene manually when the timeline is empty', () => {
    const onAddScene = vi.fn();
    renderScreen({
      scenes: [],
      sceneCount: 0,
      onAddScene,
    });
    fireEvent.click(screen.getByRole('button', { name: '+ Add Scene manually' }));
    expect(onAddScene).toHaveBeenCalled();
  });

  it('opens empty asset picker messaging when library is empty', () => {
    renderScreen({
      availableAssets: [],
      lockedProduct: { ...lockedProduct, productAssets: [] },
    });
    fireEvent.click(screen.getByTitle('Click to assign an image'));
    expect(screen.getByText(/No images available/i)).toBeTruthy();
  });

  it('syncs platform selection to carousel format', () => {
    const setPlatform = vi.fn();
    const setAdFormat = vi.fn();
    renderScreen({ setPlatform, setAdFormat });
    fireEvent.click(screen.getByRole('button', { name: /IG Carousel/i }));
    expect(setPlatform).toHaveBeenCalledWith('instagram_carousel');
    expect(setAdFormat).toHaveBeenCalledWith('carousel');
  });

  it('lets the user set per-scene Live Motion', () => {
    const onUpdateSceneMotionMode = vi.fn();
    renderScreen({ onUpdateSceneMotionMode, plannerModel: 'kimi_k3', setPlannerModel: vi.fn() });
    // Scene editor opens with first scene selected by default when present.
    fireEvent.click(screen.getByRole('button', { name: 'Live Motion' }));
    expect(onUpdateSceneMotionMode).toHaveBeenCalledWith('scene_1', 'live_motion');
  });
});
