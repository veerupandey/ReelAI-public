/**
 * Shell Tool Service — browser client for agent-shell-server on 127.0.0.1:3721.
 * All path-sensitive operations accept sessionDir so files stay organized.
 *
 * Prefer IPv4 loopback — the shell listens on 127.0.0.1 only; `localhost` can
 * resolve to ::1 and fail after shell restarts / dual-stack DNS changes.
 *
 * On remote hosts (e.g. Lightning Cloudspaces), the browser cannot reach the
 * studio's 127.0.0.1 — use Vite's `/agent-shell` proxy (same origin as :3000).
 */

/** Same-origin Vite proxy path → agent shell (see vite.config.ts). */
export const SHELL_PROXY_PATH = '/agent-shell';

export function resolveShellServerUrl(
  hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost',
  origin = typeof window !== 'undefined' ? window.location.origin : '',
): string {
  const fromEnv = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_SHELL_SERVER_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
    return origin ? `${origin.replace(/\/$/, '')}${SHELL_PROXY_PATH}` : SHELL_PROXY_PATH;
  }
  return 'http://127.0.0.1:3721';
}

export const SHELL_SERVER = resolveShellServerUrl();

export interface ShellArtifact {
  filename: string;
  url: string;
  mimeType: string;
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  artifacts: ShellArtifact[];
  workDir: string;
  ok: boolean;
}

export interface UploadResult {
  filename: string;
  path: string;
  url: string;
  mimeType: string;
  size: number;
}

export interface SessionInfo {
  sessionDir: string;
  sessionId: string;
  brandSlug: string;
  productSlug: string;
  flowSlug: string;
  baseUrl: string;
}

// ── Health ─────────────────────────────────────────────────────────────────

export const isShellServerRunning = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${SHELL_SERVER}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
};

// ── Session ────────────────────────────────────────────────────────────────

/** Create a session: ~/reelai-sessions/{brand}/{product}/{flow}/{sessionId}/ */
export const createSession = async (brand: string, product: string, flow = 'agent'): Promise<SessionInfo> => {
  const res = await fetch(`${SHELL_SERVER}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brand, product, flow }),
  });
  if (!res.ok) throw new Error(`Session create failed: ${await res.text()}`);
  return res.json() as Promise<SessionInfo>;
};

// ── PCM → WAV converter ────────────────────────────────────────────────────

/**
 * Gemini TTS returns raw PCM16 at 24kHz mono as base64.
 * This wraps it in a proper WAV header so ffmpeg can read it.
 */
export const pcmToWav = (
  base64Pcm: string,
  sampleRate = 24000,
  channels = 1,
  bitsPerSample = 16,
): string => {
  const pcmBytes = Uint8Array.from(atob(base64Pcm), (c) => c.charCodeAt(0));
  const dataLength = pcmBytes.length;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true);
  view.setUint16(32, channels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLength, true);
  new Uint8Array(buffer, 44).set(pcmBytes);

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

// ── Exec ───────────────────────────────────────────────────────────────────

export const execShell = async (
  command: string,
  sessionDir?: string,
  env?: Record<string, string>,
): Promise<ShellResult> => {
  const res = await fetch(`${SHELL_SERVER}/exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, sessionDir, env }),
  });
  const data = await res.json() as Omit<ShellResult, 'ok'>;
  return { ...data, ok: data.exitCode === 0 };
};

// ── Python ─────────────────────────────────────────────────────────────────

export const runPython = async (
  code: string,
  sessionDir?: string,
  filename?: string,
): Promise<ShellResult> => {
  const res = await fetch(`${SHELL_SERVER}/python`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, sessionDir, filename }),
  });
  const data = await res.json() as Omit<ShellResult, 'ok'>;
  return { ...data, ok: data.exitCode === 0 };
};

// ── Upload ─────────────────────────────────────────────────────────────────

export const uploadBase64 = async (
  base64: string,
  filename: string,
  mimeType?: string,
  sessionDir?: string,
): Promise<UploadResult> => {
  const res = await fetch(`${SHELL_SERVER}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64, filename, mimeType, sessionDir }),
  });
  if (!res.ok) throw new Error(`Upload failed: ${await res.text()}`);
  return res.json() as Promise<UploadResult>;
};

// ── Workspace ──────────────────────────────────────────────────────────────

export const listWorkspaceFiles = async (): Promise<ShellArtifact[]> => {
  const res = await fetch(`${SHELL_SERVER}/ls`);
  const data = await res.json() as { files: ShellArtifact[] };
  return data.files;
};

export const cleanWorkspace = async (): Promise<void> => {
  await fetch(`${SHELL_SERVER}/clean`, { method: 'DELETE' });
};

// ── FFmpeg helpers — all use absolute paths via sessionDir ─────────────────

/** Ken Burns zoom-in or zoom-out clip from a still image. All paths are absolute. */
export const buildKenBurnsClip = async (
  inputAbsPath: string,
  outputAbsPath: string,
  durationSec: number,
  zoomDirection: 'in' | 'out',
  sessionDir: string,
): Promise<ShellResult> => {
  const zoomExpr = zoomDirection === 'in'
    ? "min(1.18\\,zoom+0.001)"
    : "if(eq(on\\,1)\\,1.18\\,max(1.0\\,zoom-0.001))";
  const xExpr = "iw/2-(iw/zoom/2)+sin(on/18)*36";
  const yExpr = "ih/2-(ih/zoom/2)+cos(on/22)*24";

  const frames = Math.round(durationSec * 30);
  const cmd = [
    'ffmpeg -y',
    `-loop 1 -i "${inputAbsPath}"`,
    `-vf "scale=2160:3840,zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${frames}:s=1080x1920:fps=30,format=yuv420p"`,
    `-t ${durationSec.toFixed(3)}`,
    '-c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p',
    `"${outputAbsPath}"`,
  ].join(' ');

  return execShell(cmd, sessionDir);
};

/** Concatenate clips with xfade transitions. All paths are absolute. */
export const concatWithXfade = async (
  clips: Array<{ absPath: string; durationSec: number }>,
  outputAbsPath: string,
  sessionDir: string,
  fadeDuration = 0.5,
): Promise<ShellResult> => {
  if (clips.length === 0) throw new Error('No clips');
  if (clips.length === 1) {
    return execShell(`ffmpeg -y -i "${clips[0].absPath}" -c copy "${outputAbsPath}"`, sessionDir);
  }

  // Clamp fade so it never exceeds the shortest clip
  const minDur = Math.min(...clips.map((c) => c.durationSec));
  const fd = Math.min(fadeDuration, minDur * 0.4, 0.75);

  const inputs = clips.map((c) => `-i "${c.absPath}"`).join(' ');
  // Normalize EVERY input before xfade — Ken Burns is 1080x1920@30, Wan is 720x1280@~16.
  // Mismatched size/fps/timebase makes xfade keep only the first stream visually.
  const normParts = clips.map((_, i) => (
    `[${i}:v]scale=720:1280:force_original_aspect_ratio=decrease,`
    + `pad=720:1280:(ow-iw)/2:(oh-ih)/2,fps=24,format=yuv420p,setsar=1,setpts=PTS-STARTPTS[v${i}n]`
  ));

  const filterParts: string[] = [...normParts];
  let prevLabel = '[v0n]';
  let offset = 0;
  const transitions = ['fade', 'fadeblack', 'smoothup', 'wipeup', 'smoothleft'];

  for (let i = 1; i < clips.length; i++) {
    offset += clips[i - 1].durationSec - fd;
    const outLabel = `[v${i}]`;
    const transition = transitions[i % transitions.length];
    filterParts.push(
      `${prevLabel}[v${i}n]xfade=transition=${transition}:duration=${fd.toFixed(3)}:offset=${Math.max(0, offset).toFixed(3)}${outLabel}`,
    );
    prevLabel = outLabel;
  }

  const finalLabel = `v${clips.length - 1}`;
  // xfade overlaps by fd each join — output length is sum(durs) - fd*(n-1)
  const outDur = clips.reduce((sum, c) => sum + c.durationSec, 0) - fd * (clips.length - 1);
  const cmd = [
    'ffmpeg -y', inputs,
    `-filter_complex "${filterParts.join(';')}"`,
    `-map "[${finalLabel}]"`,
    '-an',
    '-c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p',
    `-t ${Math.max(0.5, outDur).toFixed(3)}`,
    `"${outputAbsPath}"`,
  ].join(' ');

  const xfadeResult = await execShell(cmd, sessionDir);
  if (xfadeResult.ok) return xfadeResult;

  // Fallback: hard cut concat after normalizing (more reliable than broken xfade offsets)
  const listPath = `${sessionDir}/concat_list.txt`;
  const normalized: string[] = [];
  for (let i = 0; i < clips.length; i++) {
    const out = `${sessionDir}/concat_norm_${i}.mp4`;
    const normCmd = [
      'ffmpeg -y',
      `-i "${clips[i].absPath}"`,
      `-vf "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,fps=24,format=yuv420p,setsar=1"`,
      `-t ${Math.max(0.1, clips[i].durationSec).toFixed(3)}`,
      '-an -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p',
      `"${out}"`,
    ].join(' ');
    const nr = await execShell(normCmd, sessionDir);
    if (!nr.ok) return xfadeResult;
    normalized.push(out);
  }
  const listBody = normalized.map((p) => `file '${p}'`).join('\n');
  await runPython(
    `open(${JSON.stringify(listPath)}, 'w').write(${JSON.stringify(listBody)})`,
    sessionDir,
  );
  return execShell(
    `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${outputAbsPath}"`,
    sessionDir,
  );
};

/** Concatenate audio files in order using ffmpeg concat demuxer. */
export const concatAudio = async (
  audioAbsPaths: string[],
  outputAbsPath: string,
  sessionDir: string,
): Promise<ShellResult> => {
  if (audioAbsPaths.length === 0) throw new Error('No audio files');
  if (audioAbsPaths.length === 1) {
    return execShell(`ffmpeg -y -i "${audioAbsPaths[0]}" -c copy "${outputAbsPath}"`, sessionDir);
  }

  // Build filter_complex approach — more reliable than concat demuxer for PCM-in-WAV
  const inputs = audioAbsPaths.map((p) => `-i "${p}"`).join(' ');
  const filterComplex = `${audioAbsPaths.map((_, i) => `[${i}:a]`).join('')}concat=n=${audioAbsPaths.length}:v=0:a=1[aout]`;

  const cmd = `ffmpeg -y ${inputs} -filter_complex "${filterComplex}" -map "[aout]" -c:a pcm_s16le "${outputAbsPath}"`;
  return execShell(cmd, sessionDir);
};

/** Add audio to a video file. Pads the shorter stream so neither gets cut. All paths absolute. */
export const addAudioToVideo = async (
  videoAbsPath: string,
  audioAbsPath: string,
  outputAbsPath: string,
  sessionDir: string,
): Promise<ShellResult> => {
  // Get both durations so we can decide which needs padding
  const [vidDur, audDur] = await Promise.all([
    getMediaDuration(videoAbsPath, sessionDir),
    getMediaDuration(audioAbsPath, sessionDir).then(async (d) => (
      d > 0.05 ? d : getAudioDuration(audioAbsPath, sessionDir)
    )),
  ]);

  const maxDur = Math.max(vidDur, audDur);
  const extraVid = Math.max(0, audDur - vidDur + 0.1); // freeze-frame pad needed on video

  if (extraVid > 0.05) {
    // Video is shorter than audio (xfade overlap effect) — freeze last frame to match
    const cmd = [
      'ffmpeg -y',
      `-i "${videoAbsPath}"`,
      `-i "${audioAbsPath}"`,
      `-vf "tpad=stop_mode=clone:stop_duration=${extraVid.toFixed(3)}"`,
      `-af "apad=pad_dur=0.2"`,
      `-t ${(maxDur + 0.1).toFixed(3)}`,
      '-c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k',
      `"${outputAbsPath}"`,
    ].join(' ');
    return execShell(cmd, sessionDir);
  }

  // Audio shorter or equal — simple mix, pad audio slightly
  const cmd = [
    'ffmpeg -y',
    `-i "${videoAbsPath}"`,
    `-i "${audioAbsPath}"`,
    `-af "apad=pad_dur=0.2"`,
    `-t ${(maxDur + 0.1).toFixed(3)}`,
    '-c:v copy -c:a aac -b:a 192k',
    `"${outputAbsPath}"`,
  ].join(' ');
  return execShell(cmd, sessionDir);
};

/**
 * Time-stretch audio to a target duration without changing pitch.
 * Uses ffmpeg `atempo` filter (supports 0.5–2.0 per instance; chains for larger ranges).
 * All paths are absolute.
 */
export const timeStretchAudio = async (
  inputAbsPath: string,
  outputAbsPath: string,
  targetDuration: number,
  sessionDir: string,
): Promise<ShellResult> => {
  const currentDuration = await getAudioDuration(inputAbsPath, sessionDir);
  if (currentDuration <= 0) {
    return execShell(`ffmpeg -y -i "${inputAbsPath}" -c copy "${outputAbsPath}"`, sessionDir);
  }

  const ratio = currentDuration / targetDuration;
  const safeRatio = Math.max(0.25, Math.min(4, ratio));

  if (Math.abs(safeRatio - 1) < 0.01) {
    return execShell(`ffmpeg -y -i "${inputAbsPath}" -c copy "${outputAbsPath}"`, sessionDir);
  }

  const buildAtempoChain = (rate: number): string => {
    if (rate <= 0.5) {
      const fullSteps = Math.floor(Math.log2(1 / rate));
      const remainder = rate * Math.pow(2, fullSteps);
      const full = Array(fullSteps).fill('atempo=0.5').join(',');
      return full + (remainder > 0.01 ? `,atempo=${remainder.toFixed(4)}` : '');
    }
    if (rate >= 2) {
      const fullSteps = Math.floor(Math.log2(rate));
      const remainder = rate / Math.pow(2, fullSteps);
      const full = Array(fullSteps).fill('atempo=2.0').join(',');
      return full + (Math.abs(remainder - 1) > 0.01 ? `,atempo=${remainder.toFixed(4)}` : '');
    }
    return `atempo=${safeRatio.toFixed(4)}`;
  };

  const atempoFilter = buildAtempoChain(safeRatio);
  const cmd = `ffmpeg -y -i "${inputAbsPath}" -af "${atempoFilter}" -c:a pcm_s16le "${outputAbsPath}"`;
  return execShell(cmd, sessionDir);
};

/**
 * Burn captions using Python PIL + ffmpeg overlay.
 * Works even when ffmpeg is built without libfreetype (no drawtext filter).
 * For each caption: PIL renders text → PNG → ffmpeg overlays it at the right time.
 */
export const burnCaptions = async (
  inputAbsPath: string,
  outputAbsPath: string,
  captions: Array<{ text: string; startSec: number; endSec: number }>,
  sessionDir: string,
): Promise<ShellResult> => {
  if (captions.length === 0) {
    return execShell(`ffmpeg -y -i "${inputAbsPath}" -c copy "${outputAbsPath}"`, sessionDir);
  }

  // Step 1: Generate caption PNG images via Python PIL
  const captionPngs: string[] = [];
  for (let i = 0; i < captions.length; i++) {
    const { text } = captions[i];
    const pngPath = `${sessionDir}/caption_${i}.png`;
    const code = `
from PIL import Image, ImageDraw, ImageFont
import textwrap

text = ${JSON.stringify(text)}
W, H = 1080, 1920
MAX_TEXT_W = W - 120  # 60px margin each side

def load_font(size):
    for p in ['/System/Library/Fonts/Helvetica.ttc',
              '/System/Library/Fonts/Arial.ttf',
              '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']:
        try: return ImageFont.truetype(p, size)
        except: pass
    return ImageFont.load_default()

def wrap_to_pixel_width(draw, text, font, max_w):
    """Wrap text so that every line fits within max_w pixels."""
    words = text.split()
    lines, cur = [], ''
    for w in words:
        test = (cur + ' ' + w).strip()
        bw = draw.textbbox((0,0), test, font=font)[2]
        if bw <= max_w:
            cur = test
        else:
            if cur: lines.append(cur)
            cur = w
    if cur: lines.append(cur)
    return lines or [text]

img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)
pad = 20

# Fit by both width and total height so long captions are not trimmed
font, lines = None, [text]
for fsize in [68, 60, 52, 46, 40, 34, 28, 24, 22, 20, 18]:
    f = load_font(fsize)
    ls = wrap_to_pixel_width(draw, text, f, MAX_TEXT_W)
    line_h_try = fsize + 14
    total_h_try = len(ls) * line_h_try + pad * 2
    if all(draw.textbbox((0,0), l, font=f)[2] <= MAX_TEXT_W for l in ls) and total_h_try <= (H - 120):
        font, lines, font_size = f, ls, fsize
        break
if font is None:
    font = load_font(18)
    lines = wrap_to_pixel_width(draw, text, font, MAX_TEXT_W)
    font_size = 18

line_h = font_size + 14
total_h = len(lines) * line_h + pad * 2
y_start = max(40, min(int(H * 0.78), H - total_h - 40))  # stay inside frame

for j, line in enumerate(lines):
    bbox = draw.textbbox((0, 0), line, font=font)
    tw = bbox[2] - bbox[0]
    x = max(60, (W - tw) // 2)
    y = y_start + pad + j * line_h
    for dx, dy in [(-2,-2),(2,-2),(-2,2),(2,2)]:
        draw.text((x+dx, y+dy), line, font=font, fill=(0,0,0,210))
    draw.text((x, y), line, font=font, fill=(255,255,255,255))

img.save(${JSON.stringify(pngPath)})
print('ok')
`;
    const result = await runPython(code, sessionDir);
    if (result.stdout.trim() === 'ok') captionPngs.push(pngPath);
    else captionPngs.push(''); // skip this caption if PIL failed
  }

  // Step 2: Build ffmpeg overlay chain
  // Each caption PNG is overlaid during its time window using ffmpeg overlay+enable
  const validCaptions = captions.map((c, i) => ({ ...c, pngPath: captionPngs[i] })).filter((c) => !!c.pngPath);

  if (validCaptions.length === 0) {
    return execShell(`ffmpeg -y -i "${inputAbsPath}" -c copy "${outputAbsPath}"`, sessionDir);
  }

  const inputs = [`-i "${inputAbsPath}"`, ...validCaptions.map((c) => `-i "${c.pngPath}"`)].join(' ');
  // Build filter_complex: chain overlays
  let filterParts: string[] = [];
  let prevLabel = '[0:v]';
  validCaptions.forEach((cap, idx) => {
    const inIdx = idx + 1;
    const outLabel = idx < validCaptions.length - 1 ? `[v${idx}]` : '';
    filterParts.push(
      `${prevLabel}[${inIdx}:v]overlay=0:0:enable='between(t,${cap.startSec.toFixed(2)},${cap.endSec.toFixed(2)})'${outLabel}`
    );
    prevLabel = `[v${idx}]`;
  });

  const cmd = `ffmpeg -y ${inputs} -filter_complex "${filterParts.join(';')}" -c:v libx264 -preset fast -crf 18 -c:a copy "${outputAbsPath}"`;
  return execShell(cmd, sessionDir);
};

/** Probe media duration (video or audio) via ffprobe. */
export const getMediaDuration = async (absPath: string, sessionDir: string): Promise<number> => {
  const cmd = `ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 '${absPath.replace(/'/g, `'\\''`)}'`;
  const result = await execShell(cmd, sessionDir);
  const n = Number(result.stdout.trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Check WAV duration using Python wave module. absPath must be a valid WAV file. */
export const getAudioDuration = async (absPath: string, sessionDir: string): Promise<number> => {
  // Prefer ffprobe — works for WAV and also if callers pass video by mistake.
  const probed = await getMediaDuration(absPath, sessionDir);
  if (probed > 0.05) return probed;

  const code = `
import wave, sys
try:
    with wave.open(r'${absPath}', 'rb') as w:
        print(f'{w.getnframes() / float(w.getframerate()):.3f}')
except Exception as e:
    sys.stderr.write(str(e))
    print('0.0')
`;
  const result = await runPython(code, sessionDir);
  return parseFloat(result.stdout.trim()) || 0;
};

// ── Platform export presets ────────────────────────────────────────────────────

export type AdPlatform = 'instagram_reels' | 'tiktok' | 'youtube_shorts';

const PLATFORM_PRESETS: Record<AdPlatform, { videoBitrate: string; audioBitrate: string; maxSizeMB: number; label: string }> = {
  instagram_reels: { videoBitrate: '3500k', audioBitrate: '128k', maxSizeMB: 650, label: 'Instagram Reels' },
  tiktok:          { videoBitrate: '1000k', audioBitrate: '128k', maxSizeMB: 287, label: 'TikTok' },
  youtube_shorts:  { videoBitrate: '2000k', audioBitrate: '192k', maxSizeMB: 256, label: 'YouTube Shorts' },
};

/**
 * Final platform-optimised export pass.
 * Re-encodes to exact platform bitrate, ensures yuv420p, embeds metadata.
 */
export const exportForPlatform = async (
  inputAbsPath: string,
  outputAbsPath: string,
  platform: AdPlatform,
  sessionDir: string,
): Promise<ShellResult> => {
  const preset = PLATFORM_PRESETS[platform] ?? PLATFORM_PRESETS.instagram_reels;
  const cmd = [
    'ffmpeg -y',
    `-i "${inputAbsPath}"`,
    '-vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p"',
    `-c:v libx264 -preset slow -crf 20 -b:v ${preset.videoBitrate} -maxrate ${preset.videoBitrate} -bufsize ${parseInt(preset.videoBitrate) * 2}k`,
    `-c:a aac -b:a ${preset.audioBitrate} -ar 44100 -ac 2`,
    `-movflags +faststart`,
    `-metadata comment="${preset.label} optimised by ReelAI"`,
    `"${outputAbsPath}"`,
  ].join(' ');
  return execShell(cmd, sessionDir);
};

// ── Brand colour extraction + caption style previews ─────────────────────────

export interface CaptionStyle {
  id: string;
  label: string;
  textColor: string;        // hex
  bgColor: string;          // hex or 'transparent'
  bgOpacity: number;        // 0–1
  borderColor: string;      // hex
  previewPngPath: string;
  previewUrl: string;
}

/**
 * Extracts dominant palette from the product image, then generates 3 caption style previews.
 * Returns style options for the user to choose from.
 */
export const generateCaptionStylePreviews = async (
  productImageAbsPath: string,
  sampleText: string,
  sessionDir: string,
  sessionBaseUrl: string,
): Promise<CaptionStyle[]> => {
  const code = `
import json, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import textwrap

product_path = ${JSON.stringify(productImageAbsPath)}
session_dir  = ${JSON.stringify(sessionDir)}
sample_text  = ${JSON.stringify(sampleText)}
W, H = 1080, 1920

# ── Extract dominant palette ───────────────────────────────────────────────────
img = Image.open(product_path).convert('RGB').resize((100, 100))
pixels = list(img.getdata())
# Simple k-means-lite: bucket by region
from collections import Counter
buckets = [(r//32*32, g//32*32, b//32*32) for r,g,b in pixels]
top = Counter(buckets).most_common(10)
# Pick most saturated non-white/non-black colour as brand colour
def saturation(c): r,g,b=c; mx,mn=max(r,g,b),min(r,g,b); return (mx-mn)/max(mx,1)
brand_rgb = max(
    [(c,v) for c,v in top if saturation(c) > 0.1 and max(c) < 240 and min(c) > 10],
    key=lambda x: x[1],
    default=(top[0][0], 1)
)[0]
brand_hex = '#{:02x}{:02x}{:02x}'.format(*brand_rgb)

# Complementary light version (tint)
tint = tuple(min(255, int(c * 0.4 + 220)) for c in brand_rgb)
tint_hex = '#{:02x}{:02x}{:02x}'.format(*tint)

def load_font(size):
    for path in ['/System/Library/Fonts/Helvetica.ttc',
                 '/System/Library/Fonts/Arial.ttf',
                 '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']:
        try: return ImageFont.truetype(path, size)
        except: pass
    return ImageFont.load_default()

MAX_TEXT_W = W - 120

def wrap_to_pixel_width(draw, text, font, max_w):
    words = text.split()
    lines, cur = [], ''
    for w in words:
        test = (cur + ' ' + w).strip()
        bw = draw.textbbox((0,0), test, font=font)[2]
        if bw <= max_w:
            cur = test
        else:
            if cur: lines.append(cur)
            cur = w
    if cur: lines.append(cur)
    return lines or [text]

def fit_text(draw, text, max_w):
    for fsize in [68, 60, 52, 46, 40, 34, 28]:
        f = load_font(fsize)
        ls = wrap_to_pixel_width(draw, text, f, max_w)
        if all(draw.textbbox((0,0), l, font=f)[2] <= max_w for l in ls):
            return f, ls, fsize
    f = load_font(28)
    return f, wrap_to_pixel_width(draw, text, f, max_w), 28

def draw_caption_preview(filename, text_color, bg_color, bg_opacity, border_color):
    canvas = Image.new('RGBA', (W, H), (0,0,0,0))
    draw = ImageDraw.Draw(canvas)
    font, lines, font_size = fit_text(draw, sample_text, MAX_TEXT_W)
    line_h = font_size + 14
    pad = 24
    total_h = len(lines) * line_h + pad * 2
    y_base = min(int(H * 0.76), H - total_h - 60)
    if bg_color != 'transparent':
        r,g,b = tuple(int(bg_color.lstrip('#')[i:i+2],16) for i in (0,2,4))
        bar = Image.new('RGBA', (W, total_h), (r,g,b,int(bg_opacity*255)))
        canvas.paste(bar, (0, y_base - pad), bar)
    tr,tg,tb = tuple(int(text_color.lstrip('#')[i:i+2],16) for i in (0,2,4))
    br,bg2,bb = tuple(int(border_color.lstrip('#')[i:i+2],16) for i in (0,2,4))
    for j, line in enumerate(lines):
        bbox = draw.textbbox((0,0), line, font=font)
        tw = bbox[2]-bbox[0]
        x = max(60, (W - tw) // 2)
        y = y_base + pad + j * line_h
        for dx,dy in [(-2,-2),(2,-2),(-2,2),(2,2)]:
            draw.text((x+dx,y+dy), line, font=font, fill=(br,bg2,bb,220))
        draw.text((x,y), line, font=font, fill=(tr,tg,tb,255))
    out = os.path.join(session_dir, filename)
    canvas.save(out)
    return out

styles = [
    draw_caption_preview('caption_style_a.png', '#ffffff', '#000000', 0.55, brand_hex),
    draw_caption_preview('caption_style_b.png', brand_hex, 'transparent', 0, '#ffffff'),
    draw_caption_preview('caption_style_c.png', tint_hex,  '#000000', 0.70, brand_hex),
]
print(json.dumps({'brand_hex': brand_hex, 'tint_hex': tint_hex, 'files': styles}))
`;

  const result = await runPython(code, sessionDir);
  if (!result.ok) return [];

  try {
    const parsed = JSON.parse(result.stdout.trim());
    const { brand_hex, tint_hex, files } = parsed as { brand_hex: string; tint_hex: string; files: string[] };

    const styles: CaptionStyle[] = [
      {
        id: 'a', label: 'Bold Dark Bar',
        textColor: '#ffffff', bgColor: '#000000', bgOpacity: 0.55, borderColor: brand_hex,
        previewPngPath: files[0], previewUrl: `${sessionBaseUrl}/caption_style_a.png`,
      },
      {
        id: 'b', label: `Brand Colour (${brand_hex})`,
        textColor: brand_hex, bgColor: 'transparent', bgOpacity: 0, borderColor: '#ffffff',
        previewPngPath: files[1], previewUrl: `${sessionBaseUrl}/caption_style_b.png`,
      },
      {
        id: 'c', label: 'Tinted Bar',
        textColor: tint_hex, bgColor: '#000000', bgOpacity: 0.70, borderColor: brand_hex,
        previewPngPath: files[2], previewUrl: `${sessionBaseUrl}/caption_style_c.png`,
      },
    ];
    return styles;
  } catch {
    return [];
  }
};

/**
 * Burn captions with a specific style (from CaptionStyle). Uses PIL for rendering.
 */
export const burnCaptionsStyled = async (
  inputAbsPath: string,
  outputAbsPath: string,
  captions: Array<{ text: string; startSec: number; endSec: number }>,
  style: Pick<CaptionStyle, 'textColor' | 'bgColor' | 'bgOpacity' | 'borderColor'>,
  sessionDir: string,
): Promise<ShellResult> => {
  if (captions.length === 0) {
    return execShell(`ffmpeg -y -i "${inputAbsPath}" -c copy "${outputAbsPath}"`, sessionDir);
  }

  const captionPngs: string[] = [];
  for (let i = 0; i < captions.length; i++) {
    const { text } = captions[i];
    const pngPath = `${sessionDir}/cap_styled_${i}.png`;
    const code = `
from PIL import Image, ImageDraw, ImageFont

text       = ${JSON.stringify(text)}
text_color = ${JSON.stringify(style.textColor)}
bg_color   = ${JSON.stringify(style.bgColor)}
bg_opacity = ${style.bgOpacity}
border_col = ${JSON.stringify(style.borderColor)}
W, H = 1080, 1920
MAX_TEXT_W = W - 120  # 60px margin each side

def load_font(size):
    for p in ['/System/Library/Fonts/Helvetica.ttc',
              '/System/Library/Fonts/Arial.ttf',
              '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']:
        try: return ImageFont.truetype(p, size)
        except: pass
    return ImageFont.load_default()

def wrap_to_pixel_width(draw, text, font, max_w):
    words = text.split()
    lines, cur = [], ''
    for w in words:
        test = (cur + ' ' + w).strip()
        bw = draw.textbbox((0,0), test, font=font)[2]
        if bw <= max_w:
            cur = test
        else:
            if cur: lines.append(cur)
            cur = w
    if cur: lines.append(cur)
    return lines or [text]

canvas = Image.new('RGBA', (W, H), (0,0,0,0))
draw   = ImageDraw.Draw(canvas)

pad = 24
font, lines, font_size = None, [text], 52
for fsize in [68, 60, 52, 46, 40, 34, 28, 24, 22, 20, 18]:
    f = load_font(fsize)
    ls = wrap_to_pixel_width(draw, text, f, MAX_TEXT_W)
    line_h_try = fsize + 14
    total_h_try = len(ls) * line_h_try + pad * 2
    if all(draw.textbbox((0,0), l, font=f)[2] <= MAX_TEXT_W for l in ls) and total_h_try <= (H - 120):
        font, lines, font_size = f, ls, fsize
        break
if font is None:
    font = load_font(18)
    lines = wrap_to_pixel_width(draw, text, font, MAX_TEXT_W)
    font_size = 18

line_h = font_size + 14
total_h = len(lines) * line_h + pad * 2
y_base = max(40, min(int(H * 0.76), H - total_h - 40))

if bg_color != 'transparent':
    r,g,b = tuple(int(bg_color.lstrip('#')[i:i+2],16) for i in (0,2,4))
    bar = Image.new('RGBA', (W, total_h), (r,g,b,int(bg_opacity*255)))
    canvas.paste(bar, (0, y_base - pad), bar)

def hex2rgb(h): return tuple(int(h.lstrip('#')[i:i+2],16) for i in (0,2,4))
tr,tg,tb = hex2rgb(text_color)
br,bg2,bb = hex2rgb(border_col)

for j, line in enumerate(lines):
    bbox = draw.textbbox((0,0), line, font=font)
    tw = bbox[2]-bbox[0]
    x = max(60, (W-tw)//2)
    y = y_base + pad + j*line_h
    for dx,dy in [(-2,-2),(2,-2),(-2,2),(2,2)]:
        draw.text((x+dx,y+dy), line, font=font, fill=(br,bg2,bb,220))
    draw.text((x,y), line, font=font, fill=(tr,tg,tb,255))

canvas.save(${JSON.stringify(pngPath)})
print('ok')
`;
    const r = await runPython(code, sessionDir);
    captionPngs.push(r.stdout.trim() === 'ok' ? pngPath : '');
  }

  const validCaps = captions.map((c, i) => ({ ...c, pngPath: captionPngs[i] })).filter((c) => !!c.pngPath);
  if (validCaps.length === 0) return execShell(`ffmpeg -y -i "${inputAbsPath}" -c copy "${outputAbsPath}"`, sessionDir);

  const inputs = [`-i "${inputAbsPath}"`, ...validCaps.map((c) => `-i "${c.pngPath}"`)].join(' ');
  const filterParts: string[] = [];
  let prevLabel = '[0:v]';
  validCaps.forEach((cap, idx) => {
    const outLabel = idx < validCaps.length - 1 ? `[v${idx}]` : '';
    filterParts.push(`${prevLabel}[${idx + 1}:v]overlay=0:0:enable='between(t,${cap.startSec.toFixed(2)},${cap.endSec.toFixed(2)})'${outLabel}`);
    prevLabel = `[v${idx}]`;
  });

  const cmd = `ffmpeg -y ${inputs} -filter_complex "${filterParts.join(';')}" -c:v libx264 -preset fast -crf 18 -c:a copy "${outputAbsPath}"`;
  return execShell(cmd, sessionDir);
};
