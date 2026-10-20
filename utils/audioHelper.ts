import { MusicMetadata } from '../types';

export const fileToBase64 = (file: File | Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
  });
};

const normalizeBase64Audio = (input: string): string => {
  if (!input) return '';
  const trimmed = input.trim();
  const payload = trimmed.startsWith('data:') ? (trimmed.split(',')[1] || '') : trimmed;
  return payload.replace(/\s+/g, '');
};

// Base64 decoding for raw binary data
function decode(base64: string): Uint8Array {
  const normalized = normalizeBase64Audio(base64);
  if (!normalized) return new Uint8Array(0);
  const binaryString = atob(normalized);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

const hasAsciiSignature = (bytes: Uint8Array, offset: number, signature: string): boolean => {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature.charCodeAt(i)) return false;
  }
  return true;
};

const looksLikeEncodedAudioFile = (bytes: Uint8Array): boolean => {
  if (bytes.length < 4) return false;

  if (hasAsciiSignature(bytes, 0, 'RIFF') && hasAsciiSignature(bytes, 8, 'WAVE')) return true;
  if (hasAsciiSignature(bytes, 0, 'OggS')) return true;
  if (hasAsciiSignature(bytes, 0, 'fLaC')) return true;
  if (hasAsciiSignature(bytes, 0, 'ID3')) return true;
  if (hasAsciiSignature(bytes, 4, 'ftyp')) return true;

  const first = bytes[0];
  const second = bytes[1];
  const isMp3Frame =
    first === 0xff &&
    (second === 0xfb || second === 0xf3 || second === 0xf2);
  return isMp3Frame;
};

// Convert raw PCM to AudioBuffer
export async function decodeAudioData(
  base64Data: string,
  ctx: AudioContext,
  sampleRate = 24000,
  numChannels = 1
): Promise<AudioBuffer> {
  const bytes = decode(base64Data);
  
  // Safety check: if no data, return a minimum valid buffer to prevent createBuffer(..., 0, ...) error
  if (bytes.length === 0) {
      return ctx.createBuffer(numChannels, 1, sampleRate);
  }

  if (looksLikeEncodedAudioFile(bytes)) {
      const arrayBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(arrayBuffer).set(bytes);
      return await ctx.decodeAudioData(arrayBuffer);
  }

  const dataInt16 = new Int16Array(bytes.buffer);
  const frameCount = dataInt16.length / numChannels;
  
  if (frameCount === 0) {
      return ctx.createBuffer(numChannels, 1, sampleRate);
  }

  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// Decode WebM/Ogg Blob from MediaRecorder to AudioBuffer
export const blobToAudioBuffer = async (blob: Blob, ctx: AudioContext): Promise<AudioBuffer> => {
  if (blob.size === 0) {
      return ctx.createBuffer(1, 1, 24000);
  }
  const arrayBuffer = await blob.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuffer);
};

// Helper to check if string is valid JSON
export const tryParseJSON = <T>(jsonString: string): T | null => {
  try {
    return JSON.parse(jsonString) as T;
  } catch (e) {
    return null;
  }
};

// Get Video Duration
export const getVideoDuration = (file: File): Promise<number> => {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.src = URL.createObjectURL(file);
        video.onloadedmetadata = () => {
            URL.revokeObjectURL(video.src);
            resolve(video.duration);
        };
        video.onerror = () => resolve(0);
    });
};

// Generate a thumbnail from a video URL (Blob URL)
export const generateVideoThumbnail = (videoUrl: string): Promise<string> => {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = videoUrl;

    // Timeout fallback in case video fails to load
    const timeout = setTimeout(() => {
      resolve('');
    }, 2000);

    video.onloadeddata = () => {
       // Seek to 0.5s to likely get a non-black frame
       video.currentTime = 0.5;
    };

    video.onseeked = () => {
      clearTimeout(timeout);
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            resolve(dataUrl);
        } catch (e) {
            resolve('');
        }
      } else {
        resolve('');
      }
      video.remove();
    };

    video.onerror = () => {
        clearTimeout(timeout);
        resolve('');
    };
  });
};

// Analyze AudioBuffer and remove silence from start and end
export const trimAudioSilence = (buffer: AudioBuffer, ctx: AudioContext, threshold = 0.01): AudioBuffer => {
    const rawData = buffer.getChannelData(0); // Assuming mono/stereo, check channel 0
    let start = 0;
    let end = rawData.length;

    // Find start
    for (let i = 0; i < rawData.length; i++) {
        if (Math.abs(rawData[i]) > threshold) {
            start = i;
            break;
        }
    }

    // Find end
    for (let i = rawData.length - 1; i >= 0; i--) {
        if (Math.abs(rawData[i]) > threshold) {
            end = i + 1;
            break;
        }
    }

    // Safety check
    if (start >= end) return buffer;

    const newLength = end - start;
    // If newLength is 0 (should be caught by start>=end, but safe guard), return original
    if (newLength <= 0) return buffer;

    const newBuffer = ctx.createBuffer(buffer.numberOfChannels, newLength, buffer.sampleRate);

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const oldChannelData = buffer.getChannelData(channel);
        const newChannelData = newBuffer.getChannelData(channel);
        for (let i = 0; i < newLength; i++) {
            newChannelData[i] = oldChannelData[start + i];
        }
    }

    return newBuffer;
};

// Concatenate multiple audio buffers into one sequential track
export const concatenateAudioBuffers = (
    buffers: AudioBuffer[],
    ctx: AudioContext
): { combinedBuffer: AudioBuffer, segmentDurations: number[] } => {
    let totalLength = buffers.reduce((acc, b) => acc + b.length, 0);
    
    // Handle empty case
    if (buffers.length === 0 || totalLength === 0) {
        const empty = ctx.createBuffer(1, 1, 24000);
        return { combinedBuffer: empty, segmentDurations: [] };
    }

    const numberOfChannels = buffers[0]?.numberOfChannels || 1;
    const sampleRate = buffers[0]?.sampleRate || 24000;

    const result = ctx.createBuffer(numberOfChannels, totalLength, sampleRate);
    const segmentDurations: number[] = [];
    let offset = 0;

    for (const buf of buffers) {
        segmentDurations.push(buf.duration);
        for (let channel = 0; channel < numberOfChannels; channel++) {
            // Ensure we don't exceed channels
            if (channel < result.numberOfChannels) {
                 const resultData = result.getChannelData(channel);
                 // Handle mono to stereo mismatch
                 const inputData = (channel < buf.numberOfChannels) ? buf.getChannelData(channel) : buf.getChannelData(0);
                 resultData.set(inputData, offset);
            }
        }
        offset += buf.length;
    }

    return { combinedBuffer: result, segmentDurations };
};

/**
 * Place concatenated voice segments at their scene boundaries without changing
 * the samples. Any visual slack becomes silence after the spoken segment.
 *
 * If a stale timeline contains a slot shorter than its measured voice, the
 * output grows to preserve the complete voice rather than compressing it.
 */
export const placeAudioSegmentsInTimeline = (
    buffer: AudioBuffer,
    ctx: AudioContext,
    segmentDurations: number[],
    slotDurations: number[],
): AudioBuffer => {
    const segmentCount = Math.min(segmentDurations.length, slotDurations.length);
    if (segmentCount === 0) return buffer;

    const sampleRate = buffer.sampleRate;
    const channelCount = buffer.numberOfChannels;
    const sourceRanges: Array<{ start: number; length: number }> = [];
    const outputStarts: number[] = [];
    let sourceOffset = 0;
    let outputOffset = 0;

    for (let index = 0; index < segmentCount; index += 1) {
        const requestedSamples = Math.max(0, Math.round((Number(segmentDurations[index]) || 0) * sampleRate));
        const segmentLength = Math.min(requestedSamples, Math.max(0, buffer.length - sourceOffset));
        const slotSamples = Math.max(segmentLength, Math.round((Number(slotDurations[index]) || 0) * sampleRate));
        sourceRanges.push({ start: sourceOffset, length: segmentLength });
        outputStarts.push(outputOffset);
        sourceOffset += segmentLength;
        outputOffset += Math.max(1, slotSamples);
    }

    // Preserve any trailing samples if metadata rounding undershoots the buffer.
    const trailingLength = Math.max(0, buffer.length - sourceOffset);
    const output = ctx.createBuffer(channelCount, Math.max(1, outputOffset + trailingLength), sampleRate);

    for (let channel = 0; channel < channelCount; channel += 1) {
        const source = buffer.getChannelData(channel);
        const destination = output.getChannelData(channel);
        sourceRanges.forEach((range, index) => {
            if (range.length > 0) {
                destination.set(source.subarray(range.start, range.start + range.length), outputStarts[index]);
            }
        });
        if (trailingLength > 0) {
            destination.set(source.subarray(sourceOffset), outputOffset);
        }
    }

    return output;
};

// Process file to ensure it's compatible with Gemini API (Convert SVG to PNG)
export const processCompatibleBase64 = async (file: File): Promise<{ base64: string, mimeType: string }> => {
    if (file.type === 'image/svg+xml') {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                // Use explicit size or default to reasonably large for logos
                canvas.width = img.width > 0 ? img.width : 1024;
                canvas.height = img.height > 0 ? img.height : 1024;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    URL.revokeObjectURL(url);
                    reject(new Error("Canvas context failed"));
                    return;
                }
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const pngData = canvas.toDataURL('image/png');
                URL.revokeObjectURL(url);
                resolve({
                    base64: pngData.split(',')[1],
                    mimeType: 'image/png'
                });
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                // Fallback to original if conversion fails
                fileToBase64(file).then(b64 => resolve({ base64: b64, mimeType: file.type })).catch(reject);
            };
            img.src = url;
        });
    }
    
    // Default for non-SVG
    const base64 = await fileToBase64(file);
    return { base64, mimeType: file.type };
};

export const extractMusicMetadata = (buffer: AudioBuffer): MusicMetadata => {
    const duration = buffer.duration;
    const sampleRate = buffer.sampleRate || 44100;
    const channelData = buffer.numberOfChannels > 0 ? buffer.getChannelData(0) : new Float32Array(0);
    const length = channelData.length || 1;

    let sumSquares = 0;
    for (let i = 0; i < length; i++) {
        const v = channelData[i];
        sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / length);

    const minBpm = 60;
    const maxBpm = 180;
    const minLag = Math.max(1, Math.floor(sampleRate * 60 / maxBpm));
    const maxLag = Math.max(minLag + 1, Math.floor(sampleRate * 60 / minBpm));
    let bestLag = minLag;
    let bestScore = 0;
    const step = 2;
    for (let lag = minLag; lag <= maxLag; lag += 20) {
        let sum = 0;
        for (let i = 0; i < length - lag; i += step) {
            sum += channelData[i] * channelData[i + lag];
        }
        if (sum > bestScore) {
            bestScore = sum;
            bestLag = lag;
        }
    }
    const estimatedBpm = Math.min(200, Math.max(40, Math.round((60 * sampleRate) / bestLag))) || 100;

    const windowSize = Math.max(1, Math.floor(sampleRate * 0.5));
    const peaks: { value: number; time: number }[] = [];
    for (let i = 0; i < length; i += windowSize) {
        let maxVal = 0;
        for (let j = 0; j < windowSize && i + j < length; j++) {
            const val = Math.abs(channelData[i + j]);
            if (val > maxVal) maxVal = val;
        }
        peaks.push({ value: maxVal, time: Math.min(duration, (i + windowSize / 2) / sampleRate) });
    }

    const peakMoments = peaks
        .sort((a, b) => b.value - a.value)
        .slice(0, 4)
        .map(p => p.time)
        .sort((a, b) => a - b);

    return {
        duration,
        rms,
        estimatedBpm,
        peakMoments,
    };
};

/**
 * Time-stretch an AudioBuffer to a target duration without changing pitch.
 * Uses a granular synthesis approach (phase vocoder-lite) that works entirely
 * in the browser without external dependencies.
 *
 * Uses 50% output overlap with Hann windowing for smooth, artifact-free
 * stretching at moderate ratios (0.5x–2x).  For extreme factors the quality
 * degrades gracefully.
 *
 * @param buffer  Source audio buffer
 * @param ctx     AudioContext (used to create the output buffer)
 * @param targetDuration  Desired output duration in seconds
 * @returns       New AudioBuffer stretched to targetDuration
 */
export const timeStretchAudio = (
    buffer: AudioBuffer,
    ctx: AudioContext,
    targetDuration: number,
): AudioBuffer => {
    const sourceDuration = buffer.duration;
    const ratio = sourceDuration / targetDuration;

    if (Math.abs(ratio - 1) < 0.01) return buffer;

    const safeRatio = Math.max(0.25, Math.min(4, ratio));
    const sampleRate = buffer.sampleRate;
    const numChannels = buffer.numberOfChannels;
    const outputLength = Math.max(1, Math.round(targetDuration * sampleRate));
    const output = ctx.createBuffer(numChannels, outputLength, sampleRate);

    const grainSize = Math.round(0.06 * sampleRate);

    if (buffer.length < grainSize) {
        for (let ch = 0; ch < numChannels; ch++) {
            const src = buffer.getChannelData(ch);
            const dst = output.getChannelData(ch);
            const scale = buffer.length / outputLength;
            for (let i = 0; i < outputLength; i++) {
                dst[i] = src[Math.min(Math.floor(i * scale), src.length - 1)];
            }
        }
        return output;
    }

    const overlap = 4;
    const hopOutput = Math.max(1, Math.round(grainSize / overlap));
    const hopSource = Math.max(1, Math.round(hopOutput * safeRatio));
    const HannWindow = new Float32Array(grainSize);
    for (let i = 0; i < grainSize; i++) {
        HannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (grainSize - 1)));
    }

    for (let ch = 0; ch < numChannels; ch++) {
        const src = buffer.getChannelData(ch);
        const dst = output.getChannelData(ch);
        const norm = new Float32Array(outputLength);
        let srcPos = 0;
        let dstPos = 0;

        while (dstPos + grainSize < outputLength && srcPos + grainSize < src.length) {
            for (let i = 0; i < grainSize; i++) {
                if (dstPos + i < outputLength) {
                    const w = HannWindow[i];
                    dst[dstPos + i] += src[srcPos + i] * w;
                    norm[dstPos + i] += w;
                }
            }
            srcPos += hopSource;
            dstPos += hopOutput;
        }

        for (let i = 0; i < outputLength; i++) {
            if (norm[i] > 0.0001) dst[i] /= norm[i];
        }
    }

    return output;
};

/**
 * Split an AudioBuffer into per-scene segments, time-stretch each segment
 * to its corresponding target duration, and concatenate the results.
 *
 * This preserves per-scene audio/visual alignment even when original audio
 * durations differ across scenes — something a single global stretch cannot do.
 *
 * @param buffer            Source audio buffer (concatenated)
 * @param ctx               AudioContext
 * @param segmentDurations  Original per-scene audio durations (seconds)
 * @param targetDurations   Desired per-scene output durations (seconds)
 * @returns                 New AudioBuffer with per-scene stretching applied
 */
export const stretchAudioSegments = (
    buffer: AudioBuffer,
    ctx: AudioContext,
    segmentDurations: number[],
    targetDurations: number[],
): AudioBuffer => {
    const sampleRate = buffer.sampleRate;
    const numChannels = buffer.numberOfChannels;
    const numSegments = Math.min(segmentDurations.length, targetDurations.length);

    if (numSegments === 0) return buffer;

    const segmentBoundaries: number[] = [0];
    for (let i = 0; i < numSegments; i++) {
        const prev = segmentBoundaries[i];
        const segSamples = Math.round(segmentDurations[i] * sampleRate);
        segmentBoundaries.push(Math.min(prev + segSamples, buffer.length));
    }

    const stretchedSegments: AudioBuffer[] = [];

    for (let i = 0; i < numSegments; i++) {
        const startSample = segmentBoundaries[i];
        const endSample = Math.min(segmentBoundaries[i + 1], buffer.length);
        const segLength = endSample - startSample;

        const targetDur = Math.max(0.1, targetDurations[i]);

        if (segLength <= 0) {
            const silenceLength = Math.max(1, Math.round(targetDur * sampleRate));
            stretchedSegments.push(ctx.createBuffer(numChannels, silenceLength, sampleRate));
            continue;
        }

        const segBuffer = ctx.createBuffer(numChannels, segLength, sampleRate);
        for (let ch = 0; ch < numChannels; ch++) {
            const src = buffer.getChannelData(ch);
            const dst = segBuffer.getChannelData(ch);
            for (let j = 0; j < segLength; j++) {
                dst[j] = src[startSample + j];
            }
        }

        const segRatio = segBuffer.duration / targetDur;
        if (Math.abs(segRatio - 1) < 0.01) {
            stretchedSegments.push(segBuffer);
        } else {
            stretchedSegments.push(timeStretchAudio(segBuffer, ctx, targetDur));
        }
    }

    const totalLength = stretchedSegments.reduce((s, b) => s + b.length, 0);
    const output = ctx.createBuffer(numChannels, totalLength, sampleRate);
    let offset = 0;
    for (const seg of stretchedSegments) {
        for (let ch = 0; ch < numChannels; ch++) {
            const src = seg.getChannelData(ch);
            const dst = output.getChannelData(ch);
            for (let i = 0; i < seg.length; i++) {
                dst[offset + i] += src[i];
            }
        }
        offset += seg.length;
    }

    return output;
};

export const audioBufferToWavBlob = (buffer: AudioBuffer): Blob => {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const bytesPerSample = 2;
    const dataSize = buffer.length * numChannels * bytesPerSample;
    const arrayBuffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(arrayBuffer);

    const writeString = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
    view.setUint16(32, numChannels * bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) channels.push(buffer.getChannelData(ch));

    let off = 44;
    for (let i = 0; i < buffer.length; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
            const s = Math.max(-1, Math.min(1, channels[ch][i]));
            view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            off += 2;
        }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
};
