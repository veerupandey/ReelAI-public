import { describe, expect, it } from 'vitest';
import {
  isImageReferenceFile,
  isVideoReferenceFile,
  sampleVideoFrameTimes,
  scaleToLongEdge,
  VIDEO_REF_MAX_FRAMES,
  VIDEO_REF_MAX_LONG_EDGE,
} from '../services/videoReferenceFrames';

describe('videoReferenceFrames helpers', () => {
  it('samples fixed fractions and dedupes short clips', () => {
    const times = sampleVideoFrameTimes(20);
    expect(times.length).toBe(VIDEO_REF_MAX_FRAMES);
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBeLessThan(20);

    const short = sampleVideoFrameTimes(0.2);
    expect(short.length).toBeGreaterThanOrEqual(1);
    expect(short.length).toBeLessThanOrEqual(VIDEO_REF_MAX_FRAMES);
  });

  it('scales down to max long edge without upscaling', () => {
    expect(scaleToLongEdge(1920, 1080, VIDEO_REF_MAX_LONG_EDGE)).toEqual({
      width: 512,
      height: 288,
    });
    expect(scaleToLongEdge(400, 300, VIDEO_REF_MAX_LONG_EDGE)).toEqual({
      width: 400,
      height: 300,
    });
  });

  it('classifies image vs video files by mime and extension', () => {
    expect(isVideoReferenceFile(new File([], 'a.mp4', { type: 'video/mp4' }))).toBe(true);
    expect(isVideoReferenceFile(new File([], 'clip.MOV', { type: '' }))).toBe(true);
    expect(isImageReferenceFile(new File([], 'x.png', { type: 'image/png' }))).toBe(true);
    expect(isVideoReferenceFile(new File([], 'x.png', { type: 'image/png' }))).toBe(false);
  });
});
