/**
 * Fit a Wan (~5s) clip to a scene's on-screen duration.
 * Shorter target → trim. Longer target → freeze last frame pad.
 */
import { execShell } from '../shellToolService';

export type TimeFitStrategy = 'copy' | 'trim' | 'pad';

export function resolveTimeFitStrategy(
  sourceDurationSec: number,
  targetDurationSec: number,
  epsilonSec = 0.05,
): TimeFitStrategy {
  const src = Math.max(0.1, sourceDurationSec);
  const tgt = Math.max(0.1, targetDurationSec);
  if (Math.abs(src - tgt) <= epsilonSec) return 'copy';
  if (src > tgt) return 'trim';
  return 'pad';
}

export function buildTimeFitFfmpegArgs(args: {
  inputPath: string;
  outputPath: string;
  strategy: TimeFitStrategy;
  targetDurationSec: number;
  /** Required for accurate pad (seconds of freeze to append). */
  sourceDurationSec?: number;
}): string[] {
  const { inputPath, outputPath, strategy, targetDurationSec } = args;
  const dur = Math.max(0.1, targetDurationSec).toFixed(3);
  const commonVfTail = 'fps=24,format=yuv420p,setsar=1,setpts=PTS-STARTPTS';

  if (strategy === 'copy') {
    // Still re-encode so concat/xfade see uniform fps/pix_fmt
    return [
      '-y', '-i', inputPath,
      '-t', dur,
      '-vf', `scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,${commonVfTail}`,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      '-an',
      outputPath,
    ];
  }
  if (strategy === 'trim') {
    return [
      '-y', '-i', inputPath,
      '-t', dur,
      '-vf', `scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,${commonVfTail}`,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      '-an',
      outputPath,
    ];
  }
  const src = Math.max(0.1, args.sourceDurationSec || 0);
  const padSec = Math.max(0.05, targetDurationSec - src).toFixed(3);
  return [
    '-y', '-i', inputPath,
    '-vf', `tpad=stop_mode=clone:stop_duration=${padSec},trim=duration=${dur},scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,${commonVfTail}`,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-an',
    outputPath,
  ];
}

export async function timeFitClip(args: {
  inputPath: string;
  outputPath: string;
  sourceDurationSec: number;
  targetDurationSec: number;
  sessionDir: string;
}): Promise<{ outputPath: string; strategy: TimeFitStrategy; durationSec: number }> {
  const strategy = resolveTimeFitStrategy(args.sourceDurationSec, args.targetDurationSec);
  const ffmpegArgs = buildTimeFitFfmpegArgs({
    inputPath: args.inputPath,
    outputPath: args.outputPath,
    strategy,
    targetDurationSec: args.targetDurationSec,
    sourceDurationSec: args.sourceDurationSec,
  });
  const shellQuote = (a: string) => `'${a.replace(/'/g, `'\\''`)}'`;
  const cmd = `ffmpeg ${ffmpegArgs.map(shellQuote).join(' ')}`;
  const result = await execShell(cmd, args.sessionDir);
  if (!result.ok) {
    throw new Error(`timeFitClip failed (${strategy}): ${result.stderr.slice(-300)}`);
  }
  return {
    outputPath: args.outputPath,
    strategy,
    durationSec: Math.max(0.1, args.targetDurationSec),
  };
}
