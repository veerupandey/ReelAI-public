import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReelPreview from '../components/ReelPreview';
import { UploadedMedia, VisualSettings } from '../types';

// Mock browser APIs that are missing in JSDOM
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

// Global mocks
global.MediaRecorder = MockMediaRecorder as any;
global.MediaStream = vi.fn().mockImplementation(() => ({
  getVideoTracks: () => [{ stop: vi.fn() }],
  getAudioTracks: () => [{ stop: vi.fn() }],
  getTracks: () => [{ stop: vi.fn() }],
  active: true,
})) as any;

const mockAudioBuffer = {
  duration: 10,
  length: 441000,
  sampleRate: 44100,
  numberOfChannels: 2,
  getChannelData: () => new Float32Array(10),
  copyFromChannel: vi.fn(),
  copyToChannel: vi.fn(),
} as any;

const mockAudioContext = {
  currentTime: 0,
  state: 'suspended',
  resume: vi.fn().mockResolvedValue(undefined),
  createBufferSource: vi.fn(() => ({
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    buffer: null,
    playbackRate: { value: 1 },
  })),
  createGain: vi.fn(() => ({
    connect: vi.fn(),
    gain: { value: 1, linearRampToValueAtTime: vi.fn() },
  })),
  createMediaStreamDestination: vi.fn(() => ({
    stream: new (global as any).MediaStream(),
    connect: vi.fn(),
  })),
  createBuffer: vi.fn(() => mockAudioBuffer),
  createMediaElementSource: vi.fn(() => ({
    connect: vi.fn(),
  })),
};

global.AudioContext = vi.fn(() => mockAudioContext) as any;

// Mock canvas captureStream and getContext
HTMLCanvasElement.prototype.captureStream = vi.fn(() => ({
  getVideoTracks: () => [{ stop: vi.fn() }],
  getAudioTracks: () => [],
  getTracks: () => [{ stop: vi.fn() }],
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
  measureText: vi.fn(() => ({ width: 0 })),
  createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  createPattern: vi.fn(() => ({})),
  arc: vi.fn(),
  beginPath: vi.fn(),
  fill: vi.fn(),
  canvas: { width: 1080, height: 1920 }
})) as any;

// Mock URL APIs
global.URL.createObjectURL = vi.fn(() => 'blob:test');
global.URL.revokeObjectURL = vi.fn();

// Mock HTMLAudioElement for motion engine audio
HTMLAudioElement.prototype.play = vi.fn().mockResolvedValue(undefined);
HTMLAudioElement.prototype.pause = vi.fn();

// Mock performance.now for motion engine
if (!global.performance) global.performance = {} as any;
(global.performance as any).now = vi.fn(() => Date.now());

describe('ReelPreview Export', () => {
  const mockMedia: UploadedMedia[] = [
    {
      id: '1',
      type: 'image',
      previewUrl: 'test.jpg',
      description: 'test',
    } as any,
  ];

  const mockVisualSettings: VisualSettings = {
    brightness: 1,
    contrast: 1,
    saturation: 1,
    enableZoom: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('alert', vi.fn());
    MockMediaRecorder.lastInstance = undefined as any;
  });

  afterEach(() => {
    cleanup();
  });

  it('triggers export and configures MediaRecorder correctly when no audio is present', async () => {
    const { getByLabelText, getByText } = render(
      <ReelPreview
        media={mockMedia}
        script={null}
        audioBuffer={null} // NO AUDIO
        isPlaying={false}
        videoSpeed={1}
        visualSettings={mockVisualSettings}
        onPlayToggle={() => {}}
        onRestart={() => {}}
      />
    );

    // Open export modal
    const downloadBtn = screen.getByText('Download');
    fireEvent.click(downloadBtn);

    // Select format and start export (formatsToShow should have entries from the useEffect)
    const exportBtns = screen.getAllByText(/MP4|WebM|Browser default/i);
    fireEvent.click(exportBtns[0]);

    await waitFor(() => expect(MockMediaRecorder.lastInstance).toBeDefined());
    
    const recorder = MockMediaRecorder.lastInstance;
    
    // VERIFY: audioBitsPerSecond should NOT be in options if no audio tracks
    expect(recorder.options.audioBitsPerSecond).toBeUndefined();
    
    // VERIFY: recorder.start() was called without arguments (no timeslice)
    await waitFor(() => expect(recorder.start).toHaveBeenCalledWith());
    expect(recorder.start).not.toHaveBeenCalledWith(expect.anything());
  });

  it('includes audioBitsPerSecond when audio is present', async () => {
    // Modify the captureStream mock to return an audio track for this test
    (mockAudioContext.createMediaStreamDestination as any).mockReturnValueOnce({
        stream: {
            getVideoTracks: () => [],
            getAudioTracks: () => [{ stop: vi.fn() }],
            active: true,
        },
        connect: vi.fn(),
    });

    render(
      <ReelPreview
        media={mockMedia}
        script={null}
        audioBuffer={mockAudioBuffer} // WITH AUDIO
        isPlaying={false}
        videoSpeed={1}
        visualSettings={mockVisualSettings}
        slideDurations={[10]}
        onPlayToggle={() => {}}
        onRestart={() => {}}
      />
    );

    const downloadBtn = screen.getByText('Download');
    fireEvent.click(downloadBtn);

    const exportBtns = screen.getAllByText(/MP4|WebM|Browser default/i);
    fireEvent.click(exportBtns[0]);

    await waitFor(() => expect(MockMediaRecorder.lastInstance).toBeDefined());
    
    const recorder = MockMediaRecorder.lastInstance;
    
    // VERIFY: audioBitsPerSecond SHOULD be present
    expect(recorder.options.audioBitsPerSecond).toBeDefined();
  });

  it('uses the same speed-adjusted duration for preview audio and export', async () => {
    render(
      <ReelPreview
        media={mockMedia}
        script={null}
        audioBuffer={mockAudioBuffer}
        isPlaying={false}
        videoSpeed={2}
        visualSettings={mockVisualSettings}
        slideDurations={[10]}
        onPlayToggle={() => {}}
        onRestart={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('Download'));
    fireEvent.click(screen.getAllByText(/MP4|WebM|Browser default/i)[0]);

    await waitFor(() => expect(MockMediaRecorder.lastInstance).toBeDefined());
    expect(global.alert).not.toHaveBeenCalled();
  });

  it('blocks invalid export with measured minimum and recovery actions', async () => {
    render(
      <ReelPreview
        media={mockMedia}
        script={null}
        audioBuffer={mockAudioBuffer}
        isPlaying={false}
        videoSpeed={1}
        visualSettings={mockVisualSettings}
        slideDurations={[8]}
        onPlayToggle={() => {}}
        onRestart={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('Download'));
    fireEvent.click(screen.getAllByText(/MP4|WebM|Browser default/i)[0]);

    await waitFor(() => expect(global.alert).toHaveBeenCalledWith(expect.stringContaining('measured narration needs at least 10.0s')));
    expect(global.alert).toHaveBeenCalledWith(expect.stringContaining('shorten the offending lines'));
  });

  it('uses the same validity gate for stale preview and export timing', async () => {
    const onPlayToggle = vi.fn();
    render(
      <ReelPreview
        media={mockMedia}
        script={null}
        audioBuffer={mockAudioBuffer}
        audioSegmentDurations={[10]}
        isPlaying={false}
        videoSpeed={1}
        visualSettings={mockVisualSettings}
        slideDurations={[8]}
        onPlayToggle={onPlayToggle}
        onRestart={() => {}}
      />,
    );

    const warning = screen.getByText('Narration does not fit the current timeline.');
    fireEvent.click(warning);
    expect(onPlayToggle).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Download'));
    fireEvent.click(screen.getAllByText(/MP4|WebM|Browser default/i)[0]);
    await waitFor(() => expect(global.alert).toHaveBeenCalledWith(expect.stringContaining('scene 1')));
    expect(MockMediaRecorder.lastInstance).toBeUndefined();
  });
});
