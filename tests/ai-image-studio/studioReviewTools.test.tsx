import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import GenerationPanel from '../../components/AIImageStudio/GenerationPanel';
import AssetDetailPanel from '../../components/AIImageStudio/AssetDetailPanel';
import StudioCompareView from '../../components/AIImageStudio/StudioCompareView';
import StudioLightbox, {
  getLightboxReviewAssets,
  ITERATE_PROMPTS,
} from '../../components/AIImageStudio/StudioLightbox';
import type { StudioAsset } from '../../components/AIImageStudio/types';

function makeAsset(overrides: Partial<StudioAsset>): StudioAsset {
  return {
    id: 'asset',
    name: 'Asset',
    description: '',
    base64: 'iVBORw0KGgo=',
    mimeType: 'image/png',
    width: 100,
    height: 100,
    source: 'generated',
    createdAt: '2026-07-12T00:00:00.000Z',
    generationPrompt: 'Test prompt',
    ...overrides,
  };
}

describe('Studio review tools', () => {
  it('defines iterate actions used by the lightbox', () => {
    expect(Object.keys(ITERATE_PROMPTS)).toEqual([
      'more_like_this',
      'slight_variation',
      'stronger_brand',
      'less_text',
    ]);
    for (const action of Object.values(ITERATE_PROMPTS)) {
      expect(action.label.length).toBeGreaterThan(0);
      expect(action.instruction.length).toBeGreaterThan(20);
    }
  });

  it('groups and orders assets from the active variation set', () => {
    const assets = [
      makeAsset({ id: 'upload', source: 'upload' }),
      makeAsset({ id: 'v2', variationSetId: 'set-1', variationIndex: 2 }),
      makeAsset({ id: 'other', variationSetId: 'set-2', variationIndex: 1 }),
      makeAsset({ id: 'v1', variationSetId: 'set-1', variationIndex: 1 }),
    ];

    expect(
      getLightboxReviewAssets(assets, 'v2').map((asset) => asset.id),
    ).toEqual(['v1', 'v2']);
    expect(getLightboxReviewAssets(assets, 'upload')).toEqual(assets);
  });

  it('navigates a set and exposes favorite controls', () => {
    const onToggleFavorite = vi.fn();
    const onKeepFavorites = vi.fn();
    const assets = [
      makeAsset({
        id: 'v1',
        name: 'Variation one',
        variationSetId: 'set-1',
        variationIndex: 1,
        isFavorite: true,
      }),
      makeAsset({
        id: 'v2',
        name: 'Variation two',
        variationSetId: 'set-1',
        variationIndex: 2,
      }),
    ];

    render(
      <StudioLightbox
        assets={assets}
        initialAssetId="v1"
        onClose={vi.fn()}
        onToggleFavorite={onToggleFavorite}
        onKeepFavorites={onKeepFavorites}
      />,
    );

    expect(screen.getByText('1 / 2 · variation set')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
    expect(screen.getByText('Variation two')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
    fireEvent.click(screen.getByRole('button', { name: '☆ Favorite' }));
    expect(onToggleFavorite).toHaveBeenCalledWith('v2');
    fireEvent.click(
      screen.getByRole('button', { name: 'Keep 1 favorite' }),
    );
    expect(onKeepFavorites).toHaveBeenCalledWith('set-1');
  });

  it('keeps review image-first with compact controls and safe dismissal', () => {
    const onClose = vi.fn();
    const onIterate = vi.fn();
    render(
      <StudioLightbox
        assets={[makeAsset({ id: 'review', name: 'Review image' })]}
        initialAssetId="review"
        onClose={onClose}
        onIterate={onIterate}
      />,
    );

    const preview = screen.getByAltText('Review image');
    expect(preview.className).toContain('object-contain');
    expect(screen.getByRole('button', { name: 'Fit' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    expect(screen.getByRole('button', { name: '100%' }).getAttribute('aria-pressed')).toBe('true');

    expect(screen.queryByRole('button', { name: 'More like this' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Iterate ▾' }));
    fireEvent.click(screen.getByRole('button', { name: 'More like this' }));
    expect(onIterate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'review' }),
      'more_like_this',
    );

    fireEvent.click(screen.getByRole('dialog', { name: 'Image lightbox' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close lightbox' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses one frame control and explains social framing honestly', () => {
    render(
      <StudioLightbox
        assets={[makeAsset({ id: 'review', name: 'Review image' })]}
        initialAssetId="review"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getAllByLabelText('Frame mode')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Frame mode'), { target: { value: 'feed' } });
    expect(
      screen.getByText('IG Feed mock · full image letterboxed · publishing may crop edges'),
    ).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Review zoom' })).toBeNull();
  });

  it('provides safe Fit and 100% controls in asset full preview', () => {
    const onClose = vi.fn();
    render(
      <AssetDetailPanel
        asset={makeAsset({ id: 'detail', name: 'Detail image' })}
        onClose={onClose}
        onDelete={vi.fn()}
        onDownload={vi.fn()}
        onRegenerate={vi.fn()}
        onRename={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'View full-size image' }));
    const dialog = screen.getByRole('dialog', { name: 'Full-size image preview' });
    fireEvent.click(dialog);
    expect(screen.getByRole('group', { name: 'Full preview zoom' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    expect(screen.getByRole('button', { name: '100%' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('exposes research & generate caption controls', async () => {
    const onGenerateCaption = vi.fn();
    const onCaptionChange = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <StudioLightbox
        assets={[makeAsset({ id: 'v1', name: 'Final post', source: 'generated' })]}
        initialAssetId="v1"
        onClose={vi.fn()}
        captionPack={{
          caption: 'Sip slowly. Feel better.',
          hashtags: ['matcha'],
          altText: 'Matcha tin',
          generatedAt: '2026-07-12T00:00:00.000Z',
          usedWebResearch: false,
          sourceAssetId: 'v1',
          tone: 'story',
        }}
        onGenerateCaption={onGenerateCaption}
        onCaptionChange={onCaptionChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Caption' }));
    expect(screen.getByText('Write Instagram caption for this image (optional)')).toBeTruthy();
    expect(screen.getByDisplayValue('Sip slowly. Feel better.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Short' }));
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(onGenerateCaption).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'v1' }),
      expect.objectContaining({ tone: 'short', forceWebResearch: false }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('Sip slowly. Feel better.\n\n#matcha');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: 'Force research' }));
    expect(onGenerateCaption).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'v1' }),
      expect.objectContaining({ forceWebResearch: true, tone: 'short' }),
    );

    fireEvent.change(screen.getByLabelText('Instagram caption'), {
      target: { value: 'Edited caption' },
    });
    expect(onCaptionChange).toHaveBeenCalledWith({ caption: 'Edited caption' });
  });

  it('shows carousel caption helper for variation sets', () => {
    render(
      <StudioLightbox
        assets={[
          makeAsset({
            id: 'v1',
            name: 'Slide 1',
            variationSetId: 'set-1',
            variationIndex: 1,
          }),
          makeAsset({
            id: 'v2',
            name: 'Slide 2',
            variationSetId: 'set-1',
            variationIndex: 2,
          }),
          makeAsset({
            id: 'v3',
            name: 'Slide 3',
            variationSetId: 'set-1',
            variationIndex: 3,
          }),
        ]}
        initialAssetId="v2"
        onClose={vi.fn()}
        onGenerateCaption={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Caption' }));
    expect(screen.getByText('Caption for 3-slide set')).toBeTruthy();
  });

  it('toggles compare ghost overlay and alignment', () => {
    render(
      <StudioCompareView
        left={makeAsset({ id: 'left', name: 'Reference', source: 'upload' })}
        right={makeAsset({ id: 'right', name: 'Generated' })}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Ghost overlay off' }),
    );
    expect(screen.getByAltText('Ghost reference overlay')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'cover' }));
    expect(
      screen.getByRole('radio', { name: 'cover' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.getByRole('button', { name: 'Fit' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    expect(screen.getByRole('button', { name: '100%' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('renders lightbox and compare from previewUrl when base64 is empty', () => {
    const remote = makeAsset({
      id: 'remote',
      name: 'CDN shot',
      base64: '',
      previewUrl: 'https://cdn.example.com/shot.jpg',
      source: 'url_import',
    });

    const { unmount } = render(
      <StudioLightbox
        assets={[remote]}
        initialAssetId="remote"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByAltText('CDN shot').getAttribute('src')).toBe(
      'https://cdn.example.com/shot.jpg',
    );
    unmount();

    render(
      <StudioCompareView
        left={remote}
        right={makeAsset({
          id: 'remote-2',
          name: 'CDN shot 2',
          base64: '',
          previewUrl: 'https://cdn.example.com/shot-2.jpg',
        })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByAltText('CDN shot').getAttribute('src')).toBe(
      'https://cdn.example.com/shot.jpg',
    );
    expect(screen.getByAltText('CDN shot 2').getAttribute('src')).toBe(
      'https://cdn.example.com/shot-2.jpg',
    );
  });

  it('shows accurate batch progress and failures', () => {
    render(
      <GenerationPanel
        prompt="Create a premium product post"
        creativeRoute="generate_fresh"
        aspectRatio="4:5"
        selectedAssets={[]}
        allAssets={[]}
        composerReferences={[]}
        isGenerating
        isEnhancing={false}
        onPromptChange={vi.fn()}
        onApplyEnrichedPrompt={vi.fn()}
        onApplyAndGenerate={vi.fn()}
        onRouteChange={vi.fn()}
        onAspectRatioChange={vi.fn()}
        onEnhance={vi.fn()}
        onGenerate={vi.fn()}
        onGenerateBatch={vi.fn()}
        onOpenRoleAssignment={vi.fn()}
        variationCount={4}
        onVariationCountChange={vi.fn()}
        batchProgress={{
          completed: 2,
          total: 4,
          failed: 1,
          running: true,
        }}
      />,
    );

    expect(screen.getByText('Generating 2/4')).toBeTruthy();
    expect(screen.getByText('1 failed')).toBeTruthy();
  });

  it('shows compliance score and sends a selected fix', () => {
    const onFixCompliance = vi.fn();
    const asset = makeAsset({
      id: 'reviewed',
      brandCompliance: {
        score: 58,
        status: 'fail',
        summary: 'Typography is off-brand.',
        evaluatedAt: '2026-07-12T00:00:00.000Z',
        evaluationMode: 'visual_ai',
        checks: [
          {
            category: 'typography',
            label: 'Typography',
            score: 30,
            status: 'fail',
            finding: 'The visible font is too playful.',
            recommendation: 'Use a restrained sans-serif treatment.',
          },
        ],
      },
    });

    render(
      <StudioLightbox
        assets={[asset]}
        initialAssetId="reviewed"
        brandName="Kageha"
        onClose={vi.fn()}
        onFixCompliance={onFixCompliance}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Tools' }));
    expect(
      screen.getByLabelText('Brand compliance score 58 out of 100'),
    ).toBeTruthy();
    fireEvent.click(screen.getByText('Brand compliance'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Fix Typography' }),
    );
    expect(onFixCompliance).toHaveBeenCalledWith(
      asset,
      asset.brandCompliance?.checks[0],
    );
  });
});
