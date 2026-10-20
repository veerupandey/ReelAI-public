import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import InstagramPostPanel from '../../components/AIImageStudio/InstagramPostPanel';
import type { StudioAsset, StudioCaptionPack } from '../../components/AIImageStudio/types';

vi.mock('../../services/instagramPublishService', () => ({
  isInstagramConfigured: () => false,
  publishCarousel: vi.fn(),
  publishSingleImage: vi.fn(),
}));

vi.mock('../../components/AIImageStudio/studioImageHostService', () => ({
  isStudioImageHostingConfigured: () => false,
  hostStudioImagesForPublish: vi.fn(),
}));

function makeAsset(id: string, name: string): StudioAsset {
  return {
    id,
    name,
    description: '',
    base64: btoa(id),
    mimeType: 'image/png',
    width: 100,
    height: 100,
    source: 'generated',
    createdAt: new Date().toISOString(),
  };
}

const samplePack: StudioCaptionPack = {
  caption: 'Summer sale starts now.',
  hashtags: ['summer', 'sale'],
  generatedAt: new Date().toISOString(),
  usedWebResearch: true,
  researchSummary: 'Used seasonal summer angle.',
  tone: 'viral',
};

describe('InstagramPostPanel', () => {
  it('generates captions without Instagram tokens', () => {
    const onGenerateCaption = vi.fn();
    render(
      <InstagramPostPanel
        assets={[makeAsset('a', 'A'), makeAsset('b', 'B'), makeAsset('c', 'C')]}
        postQueueIds={['c', 'a']}
        onClose={vi.fn()}
        onReorder={vi.fn()}
        onRemoveFromQueue={vi.fn()}
        onClearQueue={vi.fn()}
        onGenerateCaption={onGenerateCaption}
        onReviseCaption={vi.fn()}
        onCaptionChange={vi.fn()}
        onExportOrderedPack={vi.fn()}
      />,
    );

    expect(screen.getByText(/2 slides in selection order/i)).toBeTruthy();
    expect(screen.getByText(/without Instagram tokens/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Generate viral caption/i }));
    expect(onGenerateCaption).toHaveBeenCalledWith({
      tone: 'viral',
      forceWebResearch: true,
    });
  });

  it('supports edit, copy, retry, and revise', () => {
    const onGenerateCaption = vi.fn();
    const onReviseCaption = vi.fn();
    const onCaptionChange = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <InstagramPostPanel
        assets={[makeAsset('a', 'A')]}
        postQueueIds={['a']}
        captionPack={samplePack}
        onClose={vi.fn()}
        onReorder={vi.fn()}
        onRemoveFromQueue={vi.fn()}
        onClearQueue={vi.fn()}
        onGenerateCaption={onGenerateCaption}
        onReviseCaption={onReviseCaption}
        onCaptionChange={onCaptionChange}
        onExportOrderedPack={vi.fn()}
      />,
    );

    expect(screen.getByText(/Research: Used seasonal summer angle/i)).toBeTruthy();

    fireEvent.change(screen.getByDisplayValue(/Summer sale starts now/i), {
      target: { value: 'Edited caption' },
    });
    expect(onCaptionChange).toHaveBeenCalledWith(
      expect.objectContaining({ caption: 'Edited caption' }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(onGenerateCaption).toHaveBeenCalledWith({
      tone: 'viral',
      forceWebResearch: true,
    });

    fireEvent.click(screen.getByRole('button', { name: /^Revise$/i }));
    fireEvent.change(screen.getByPlaceholderText(/Shorter hook/i), {
      target: { value: 'Make it punchier' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Apply revise/i }));
    expect(onReviseCaption).toHaveBeenCalledWith('Make it punchier');

    fireEvent.click(screen.getByRole('button', { name: /Copy caption \+ tags/i }));
  });

  it('keeps Post to Instagram disabled without tokens', () => {
    render(
      <InstagramPostPanel
        assets={[makeAsset('a', 'A')]}
        postQueueIds={['a']}
        captionPack={samplePack}
        onClose={vi.fn()}
        onReorder={vi.fn()}
        onRemoveFromQueue={vi.fn()}
        onClearQueue={vi.fn()}
        onGenerateCaption={vi.fn()}
        onReviseCaption={vi.fn()}
        onCaptionChange={vi.fn()}
        onExportOrderedPack={vi.fn()}
      />,
    );

    expect(
      (screen.getByRole('button', { name: /Post to Instagram/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: /Copy caption \+ tags/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('blocks copying a failed caption and surfaces the provider error', () => {
    render(
      <InstagramPostPanel
        assets={[makeAsset('a', 'A')]}
        postQueueIds={['a']}
        captionPack={{
          ...samplePack,
          generationStatus: 'failed',
          generationError: 'Selected slides could not be analyzed.',
        }}
        onClose={vi.fn()}
        onReorder={vi.fn()}
        onRemoveFromQueue={vi.fn()}
        onClearQueue={vi.fn()}
        onGenerateCaption={vi.fn()}
        onReviseCaption={vi.fn()}
        onCaptionChange={vi.fn()}
        onExportOrderedPack={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain(
      'Selected slides could not be analyzed.',
    );
    expect(
      (screen.getByRole('button', { name: /Copy caption \+ tags/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: /^Copy caption$/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
