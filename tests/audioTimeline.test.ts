import { describe, expect, it } from 'vitest';
import { placeAudioSegmentsInTimeline } from '../utils/audioHelper';

class TestAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly duration: number;
  private readonly channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel];
  }
}

const context = {
  createBuffer: (channels: number, length: number, sampleRate: number) =>
    new TestAudioBuffer(channels, length, sampleRate),
} as unknown as AudioContext;

describe('clean voice timeline placement', () => {
  it('preserves voice samples and inserts silence between scenes', () => {
    const source = new TestAudioBuffer(1, 5, 1);
    source.getChannelData(0).set([1, 2, 3, 4, 5]);

    const result = placeAudioSegmentsInTimeline(
      source as unknown as AudioBuffer,
      context,
      [2, 3],
      [4, 3],
    );

    expect(Array.from(result.getChannelData(0))).toEqual([1, 2, 0, 0, 3, 4, 5]);
    expect(result.duration).toBe(7);
  });

  it('never shortens a segment when stale slot metadata is too small', () => {
    const source = new TestAudioBuffer(1, 4, 1);
    source.getChannelData(0).set([0.1, 0.2, 0.3, 0.4]);

    const result = placeAudioSegmentsInTimeline(
      source as unknown as AudioBuffer,
      context,
      [4],
      [2],
    );

    expect(result.duration).toBe(4);
    expect(Array.from(result.getChannelData(0))).toEqual(Array.from(source.getChannelData(0)));
  });
});
