import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReelPreview from '../components/ReelPreview';
import { DEFAULT_AUDIO_MIX_SETTINGS, DEFAULT_SUBTITLE_SETTINGS, UploadedMedia, VisualSettings } from '../types';

class MockMediaRecorder {
  public start = vi.fn();
  public stop = vi.fn();
  public ondataavailable: any;
  public onerror: any;
  public onstop: any;
  public state: string = 'inactive';

  constructor(public stream: any, public options: any) {
    MockMediaRecorder.lastInstance = this;
  }

  static lastInstance: MockMediaRecorder;
  static isTypeSupported = vi.fn(() => true);
}

global.MediaRecorder = MockMediaRecorder as any;
global.MediaStream = vi.fn().mockImplementation(() => ({
  getVideoTracks: () => [{ stop: vi.fn() }],
  getAudioTracks: () => [{ stop: vi.fn() }],
  active: true,
})) as any;

const mockAudioContext = {
  currentTime: 0,
  state: 'running',
  resume: vi.fn().mockResolvedValue(undefined),
  createBufferSource: vi.fn(() => ({
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    buffer: null,
    playbackRate: { value: 1 },
    loop: false,
  })),
  createGain: vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    gain: {
      value: 1,
      linearRampToValueAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn(),
    },
  })),
  createMediaStreamDestination: vi.fn(() => ({
    stream: {
      getVideoTracks: () => [],
      getAudioTracks: () => [{ stop: vi.fn() }],
      active: true,
    },
    connect: vi.fn(),
  })),
  createMediaElementSource: vi.fn(() => ({
    connect: vi.fn(),
  })),
  destination: {},
};

global.AudioContext = vi.fn(() => mockAudioContext) as any;

HTMLCanvasElement.prototype.captureStream = vi.fn(() => ({
  getVideoTracks: () => [{ stop: vi.fn() }],
  getAudioTracks: () => [],
  active: true,
})) as any;

HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  drawImage: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  rotate: vi.fn(),
  fillText: vi.fn(),
  strokeText: vi.fn(),
  measureText: vi.fn(() => ({ width: 0 })),
  createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  createPattern: vi.fn(() => ({})),
  arc: vi.fn(),
  beginPath: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  canvas: { width: 1080, height: 1920 },
})) as any;

global.URL.createObjectURL = vi.fn(() => 'blob:test');
global.URL.revokeObjectURL = vi.fn();
HTMLAudioElement.prototype.play = vi.fn().mockResolvedValue(undefined);
HTMLAudioElement.prototype.pause = vi.fn();
HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined);
HTMLVideoElement.prototype.pause = vi.fn();
window.alert = vi.fn();

const originalCreateElement = document.createElement.bind(document);

if (!global.performance) global.performance = {} as any;
(global.performance as any).now = vi.fn(() => Date.now());

describe('ReelPreview audio mix + caption defaults', () => {
  const mockVisualSettings: VisualSettings = {
    brightness: 1,
    contrast: 1,
    saturation: 1,
    enableZoom: false,
  };

  const videoMedia: UploadedMedia[] = [
    {
      id: 'v1',
      type: 'video',
      previewUrl: 'clip.mp4',
      description: 'product clip',
      duration: 4,
      startTime: 0,
      endTime: 4,
    } as any,
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    MockMediaRecorder.lastInstance = undefined as any;
    document.createElement = ((tagName: string, options?: any) => {
      const el = originalCreateElement(tagName, options);
      if (tagName.toLowerCase() === 'video') {
        Object.defineProperty(el, 'duration', { configurable: true, get: () => 4 });
        Object.defineProperty(el, 'videoWidth', { configurable: true, get: () => 1080 });
        Object.defineProperty(el, 'videoHeight', { configurable: true, get: () => 1920 });
        Object.defineProperty(el, 'readyState', { configurable: true, get: () => 4 });
      }
      return el;
    }) as typeof document.createElement;
  });

  afterEach(() => {
    document.createElement = originalCreateElement;
    cleanup();
  });

  it('exposes production caption defaults that are large and bold', () => {
    expect(DEFAULT_SUBTITLE_SETTINGS.fontSize).toBeGreaterThanOrEqual(36);
    expect(DEFAULT_SUBTITLE_SETTINGS.fontFamily).toBe('Montserrat');
    expect(DEFAULT_SUBTITLE_SETTINGS.style).toBe('viral');
    expect(DEFAULT_SUBTITLE_SETTINGS.strokeWidth).toBeGreaterThanOrEqual(6);
    expect(DEFAULT_SUBTITLE_SETTINGS.uppercase).toBe(true);
  });

  it('defaults clip volume below voice so narration stays readable', () => {
    expect(DEFAULT_AUDIO_MIX_SETTINGS.clipVolume).toBeGreaterThan(0);
    expect(DEFAULT_AUDIO_MIX_SETTINGS.clipVolume!).toBeLessThan(DEFAULT_AUDIO_MIX_SETTINGS.voiceVolume);
    expect(DEFAULT_AUDIO_MIX_SETTINGS.enableDucking).toBe(true);
  });

  it('routes clip media into the Web Audio graph when clipVolume > 0 and playing', async () => {
    render(
      <ReelPreview
        media={videoMedia}
        script={null}
        audioBuffer={null}
        isPlaying={true}
        videoSpeed={1}
        visualSettings={mockVisualSettings}
        audioMixSettings={{ ...DEFAULT_AUDIO_MIX_SETTINGS, clipVolume: 1, musicVolume: 0 }}
        onPlayToggle={() => {}}
        onRestart={() => {}}
      />,
    );

    await waitFor(() => {
      expect(mockAudioContext.createMediaElementSource).toHaveBeenCalled();
    }, { timeout: 3000 });
  });

  it('does not route clip audio when clipVolume is muted', async () => {
    render(
      <ReelPreview
        media={videoMedia}
        script={null}
        audioBuffer={null}
        isPlaying={true}
        videoSpeed={1}
        visualSettings={mockVisualSettings}
        audioMixSettings={{ ...DEFAULT_AUDIO_MIX_SETTINGS, clipVolume: 0 }}
        onPlayToggle={() => {}}
        onRestart={() => {}}
      />,
    );

    await new Promise((r) => setTimeout(r, 80));
    expect(mockAudioContext.createMediaElementSource).not.toHaveBeenCalled();
  });

  it('includes export audio tracks when only clip audio is enabled', async () => {
    render(
      <ReelPreview
        media={videoMedia}
        script={null}
        audioBuffer={null}
        isPlaying={false}
        videoSpeed={1}
        visualSettings={mockVisualSettings}
        audioMixSettings={{ ...DEFAULT_AUDIO_MIX_SETTINGS, clipVolume: 1, musicVolume: 0, voiceVolume: 0 }}
        onPlayToggle={() => {}}
        onRestart={() => {}}
      />,
    );

    fireEvent.click(screen.getByText('Download'));
    const exportBtns = screen.getAllByText(/MP4|WebM|Browser default/i);
    fireEvent.click(exportBtns[0]);

    await waitFor(() => expect(MockMediaRecorder.lastInstance).toBeDefined());
    expect(MockMediaRecorder.lastInstance.options.audioBitsPerSecond).toBeDefined();
  });
});
