import { describe, expect, it } from 'vitest';
import {
  buildTimeFitFfmpegArgs,
  resolveTimeFitStrategy,
} from '../services/producers/timeFitClip';

describe('resolveTimeFitStrategy', () => {
  it('copies when durations match within epsilon', () => {
    expect(resolveTimeFitStrategy(5.06, 5.05)).toBe('copy');
  });

  it('trims when source is longer than target', () => {
    expect(resolveTimeFitStrategy(5.06, 3)).toBe('trim');
  });

  it('pads when source is shorter than target', () => {
    expect(resolveTimeFitStrategy(5.06, 8)).toBe('pad');
  });
});

describe('buildTimeFitFfmpegArgs', () => {
  it('builds trim args with target duration', () => {
    const args = buildTimeFitFfmpegArgs({
      inputPath: '/tmp/in.mp4',
      outputPath: '/tmp/out.mp4',
      strategy: 'trim',
      targetDurationSec: 3.5,
    });
    expect(args).toContain('-t');
    expect(args).toContain('3.500');
    expect(args[args.length - 1]).toBe('/tmp/out.mp4');
  });

  it('builds pad args with tpad filter using source-relative pad', () => {
    const args = buildTimeFitFfmpegArgs({
      inputPath: '/tmp/in.mp4',
      outputPath: '/tmp/out.mp4',
      strategy: 'pad',
      targetDurationSec: 8,
      sourceDurationSec: 5,
    });
    const vf = args[args.indexOf('-vf') + 1];
    expect(vf).toContain('tpad=stop_mode=clone:stop_duration=3.000');
    expect(vf).toContain('trim=duration=8.000');
  });
});
