import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The studio pulls the whole agent runtime in through these two children.
// Stub them so this test covers the intent wiring, not the production stack.
vi.mock('../components/AgentConsole', () => ({
  ingestCreativeReferenceFiles: vi.fn(async () => ({ uploads: [], errors: [] })),
  readCreativeReferenceFile: vi.fn(async () => null),
}));
vi.mock('../components/AdAgentResearchPanel', () => ({
  default: () => null,
}));
vi.mock('../services/referencePostCapture', () => ({
  captureReferencePostUrl: vi.fn(async () => ({ uploads: [], warning: null })),
}));

const AdCreatorStudio = (await import('../components/AdCreatorStudio')).default;

const agent = {
  id: 'ad-agent',
  name: 'Ad Creator',
  icon: '*',
  description: '',
  capabilities: [],
  examplePrompts: [],
  uiSchema: [],
} as any;

function renderStudio(overrides: Record<string, unknown> = {}) {
  const onChangeForm = vi.fn();
  const formValues: Record<string, string | number | boolean> = {
    adFormat: 'stitched_video',
    platform: 'instagram_reels',
    style: 'luxe_minimalist',
    durationSec: 30,
    ...(overrides.formValues as Record<string, string | number | boolean> | undefined),
  };
  const utils = render(
    <AdCreatorStudio
      agent={agent}
      availability={null}
      formValues={formValues}
      onChangeForm={onChangeForm}
      direction={(overrides.direction as string) ?? ''}
      onDirectionChange={vi.fn()}
      productPackshot={null}
      onPackshotChange={vi.fn()}
      referenceUploads={[]}
      onReferenceUploadsChange={vi.fn()}
      researchSeed={null}
      onResearchApply={vi.fn()}
      onResearchBriefChange={vi.fn()}
      formError={null}
      formErrorField={null}
      isUploading={false}
      onUploadingChange={vi.fn()}
      onLaunch={vi.fn()}
      onCancel={vi.fn()}
      formRef={React.createRef()}
    />,
  );
  return { ...utils, onChangeForm, formValues };
}

/** Let the 600ms debounce fire. */
async function flushParse() {
  await act(async () => {
    vi.advanceTimersByTime(700);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('AdCreatorStudio intent prefill', () => {
  it('fills settings from the direction text', async () => {
    const { onChangeForm } = renderStudio({
      direction: '15s TikTok video ad, UGC creator energy',
    });
    await flushParse();

    const applied = Object.fromEntries(onChangeForm.mock.calls);
    expect(applied.platform).toBe('tiktok');
    expect(applied.durationSec).toBe(15);
    expect(applied.style).toBe('ugc_style');
  });

  it('never overwrites a setting the user chose by hand', async () => {
    const { onChangeForm, rerender } = renderStudio({
      direction: 'A calm brand film',
    });
    await flushParse();
    onChangeForm.mockClear();

    // User picks TikTok explicitly.
    if (!screen.queryByText('Format & platform')) {
      fireEvent.click(screen.getByText(/^(Adjust|Hide) settings$/));
    }
    fireEvent.click(screen.getByText('TikTok'));
    expect(onChangeForm).toHaveBeenCalledWith('platform', 'tiktok');
    onChangeForm.mockClear();

    // Direction now says Reels — the hand-picked platform must survive.
    rerender(
      <AdCreatorStudio
        agent={agent}
        availability={null}
        formValues={{
          adFormat: 'stitched_video',
          platform: 'tiktok',
          style: 'luxe_minimalist',
          durationSec: 30,
        }}
        onChangeForm={onChangeForm}
        direction="A calm brand film for Instagram Reels"
        onDirectionChange={vi.fn()}
        productPackshot={null}
        onPackshotChange={vi.fn()}
        referenceUploads={[]}
        onReferenceUploadsChange={vi.fn()}
        researchSeed={null}
        onResearchApply={vi.fn()}
        onResearchBriefChange={vi.fn()}
        formError={null}
        formErrorField={null}
        isUploading={false}
        onUploadingChange={vi.fn()}
        onLaunch={vi.fn()}
        onCancel={vi.fn()}
        formRef={React.createRef()}
      />,
    );
    await flushParse();

    const keysWritten = onChangeForm.mock.calls.map(([key]) => key);
    expect(keysWritten).not.toContain('platform');
  });

  it('keeps settings collapsed for a confident direction', async () => {
    renderStudio({ direction: '30s Instagram Reels video ad, luxe minimalist, premium calm' });
    await flushParse();
    expect(screen.getByText('Adjust settings')).toBeTruthy();
    expect(screen.queryByText('Format & platform')).toBeNull();
  });

  it('opens settings when the direction is too vague to parse', async () => {
    renderStudio({ direction: 'something nice' });
    await flushParse();
    expect(screen.getByText('Format & platform')).toBeTruthy();
  });
});
