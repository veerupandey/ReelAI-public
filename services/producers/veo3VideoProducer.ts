/**
 * Veo3 Video Producer
 * Generates per-scene video clips using Google Veo3 API, then stitches them together.
 *
 * COST PROTECTION:
 * - Hard confirmation gate before ANY Veo3 API call (shows estimated cost)
 * - Per-scene approval: user reviews each clip before next is generated
 * - Auto-approve is forcibly disabled for this format
 * - Clear "Veo3 API call" indicators in every status event
 *
 * PRODUCT GROUNDING:
 * - Product-required scenes MUST pass a real product image as Veo `image` (image-to-video).
 * - Text-only generation invents packaging — never do that when the product must appear.
 *
 * Pipeline:
 * 1. Cost confirmation gate (hard gate, no auto-approve)
 * 2. Per-scene: generate Veo3 clip → user approval gate → next scene
 * 3. Stitch clips via ffmpeg concat
 * 4. Optional: add separate TTS voiceover (or use Veo3 native audio)
 * 5. Platform export
 */

import { GoogleGenAI } from '@google/genai';
import { execShell, uploadBase64, type SessionInfo } from '../shellToolService';
import type { AgentEvent, ScenePlan, AgentConfig } from '../autonomousAgent';
import type { ProducerOutput } from '../formatRouter';
import { requiresProductReference } from '../../utils/productVisualRequirement';

// ── Veo3 model config ─────────────────────────────────────────────────────────

/**
 * Gemini API (API-key / @google/genai) model IDs — NOT Vertex AI IDs.
 * `veo-3.0-fast-generate-001` is Vertex-only and returns 404 on v1beta predictLongRunning.
 * Override with VITE_VEO_MODEL when Google renames preview models.
 */
const VEO3_MODEL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_VEO_MODEL)
  || 'veo-3.1-fast-generate-preview';

/** Clip durations supported by Veo */
type VeoClipDuration = 4 | 6 | 8;

export interface Veo3ClipResult {
  sceneIndex: number;
  clipPath: string;
  durationSec: number;
  hasAudio: boolean;
}

export interface Veo3ProducerInput {
  scenes: ScenePlan[];
  config: AgentConfig;
  session: SessionInfo;
  onEvent: (e: AgentEvent) => void;
  title?: string;
  brandName?: string;
}

export interface Veo3CostEstimate {
  sceneCount: number;
  clipDurationSec: VeoClipDuration;
  model: string;
  /** Human-readable cost warning */
  warning: string;
}

export interface VeoProductImage {
  base64: string;
  mimeType: string;
}

export interface VeoClipImageInput {
  /** First-frame / product lock image for image-to-video. */
  image?: VeoProductImage;
  /** Why this image was chosen (for logs / HITL). */
  source: 'locked_asset' | 'product_reference' | 'scene_still' | 'none';
  /** True when the scene requires a real product and we have no image — caller must block. */
  missingRequiredProduct: boolean;
}

const stripDataUrl = (value: string): string =>
  value.startsWith('data:') ? (value.split(',')[1] || '') : value;

/**
 * Resolve the first-frame image Veo should animate.
 * Prefer the approved scene still (still→animate), then locked asset, then packshot.
 */
export function resolveVeoClipImageInput(input: {
  scene: Pick<ScenePlan, 'imagePrompt' | 'role' | 'voiceoverText' | 'useProductAsReference' | 'visualMode' | 'preserveExactAsset' | 'lockedAssetBase64' | 'lockedAssetMimeType' | 'imageUrl'>;
  productBase64?: string | null;
  productMimeType?: string;
}): VeoClipImageInput {
  const { scene, productBase64, productMimeType = 'image/png' } = input;
  const needsProduct =
    scene.preserveExactAsset
    || scene.visualMode === 'product_locked'
    || scene.visualMode === 'product_composite'
    || scene.useProductAsReference
    || requiresProductReference(`${scene.role} ${scene.imagePrompt} ${scene.voiceoverText || ''}`);

  // 1) Approved generated/locked still — safest still→animate path (Google's recommended I2V flow)
  if (scene.imageUrl?.startsWith('data:')) {
    const [header, bytes] = scene.imageUrl.split(',');
    const mimeMatch = header.match(/data:([^;]+)/);
    if (bytes) {
      return {
        image: { base64: bytes, mimeType: mimeMatch?.[1] || 'image/png' },
        source: 'scene_still',
        missingRequiredProduct: false,
      };
    }
  }

  // 2) Agency locked asset bytes (before a still was materialised)
  if (scene.lockedAssetBase64) {
    return {
      image: {
        base64: stripDataUrl(scene.lockedAssetBase64),
        mimeType: scene.lockedAssetMimeType || 'image/jpeg',
      },
      source: 'locked_asset',
      missingRequiredProduct: false,
    };
  }

  // 3) Product packshot fallback
  if (productBase64) {
    return {
      image: {
        base64: stripDataUrl(productBase64),
        mimeType: productMimeType,
      },
      source: 'product_reference',
      missingRequiredProduct: false,
    };
  }

  return {
    source: 'none',
    missingRequiredProduct: needsProduct,
  };
}

/**
 * Estimate cost before running Veo3.
 * This is shown to the user in the cost confirmation gate.
 */
export function estimateVeo3Cost(sceneCount: number): Veo3CostEstimate {
  const clipDuration: VeoClipDuration = 6; // default clip length
  return {
    sceneCount,
    clipDurationSec: clipDuration,
    model: VEO3_MODEL,
    warning: [
      `Pipeline: generate product-grounded stills → you approve → Veo animates each still (image-to-video).`,
      `This will make ${sceneCount} Veo3 API calls (model: ${VEO3_MODEL}).`,
      `Each call animates an approved still into a ${clipDuration}s clip — not a text-only invention.`,
      `Veo3 is a premium-priced API. Each clip may take 1-3 minutes to generate.`,
      `Total estimated Veo generation time: ${sceneCount * 2}-${sceneCount * 3} minutes.`,
      `You will be asked to approve each clip before the next is generated.`,
    ].join('\n'),
  };
}

/**
 * Generate a single video clip using Veo3 API.
 * Pass `productImage` to animate the real product (image-to-video) instead of inventing packaging.
 */
export async function generateVeo3Clip(
  prompt: string,
  aspectRatio: '16:9' | '9:16',
  durationSec: VeoClipDuration,
  outputPath: string,
  productImage?: VeoProductImage,
): Promise<{ clipPath: string; durationSec: number }> {
  const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY || '' });

  const groundedPrompt = productImage
    ? [
        prompt,
        '',
        'IMAGE-TO-VIDEO: Animate the supplied first-frame still.',
        'Keep the exact composition, product packaging, label, logo, and colors from the image.',
        'Add natural cinematic motion only (subtle camera move, light shift, product micro-motion).',
        'Do not redesign the product, invent a different pack, or add captions/on-screen text.',
      ].join('\n')
    : prompt;

  // Veo3 uses the async generateVideos API.
  // Do not set personGeneration — Gemini API rejects allow_adult on Veo preview models.
  // Pass `image` for image-to-video when we have a real product/locked still.
  let operation = await (ai.models as any).generateVideos({
    model: VEO3_MODEL,
    prompt: groundedPrompt,
    ...(productImage
      ? {
          image: {
            imageBytes: productImage.base64,
            mimeType: productImage.mimeType || 'image/png',
          },
        }
      : {}),
    config: {
      aspectRatio,
      numberOfVideos: 1,
      durationSeconds: durationSec,
      ...(productImage
        ? {
            negativePrompt:
              'different product, wrong packaging, fake label, invented brand, redesigned pack, unreadable logo, text overlays, captions, watermark',
          }
        : {}),
    },
  });

  // Poll for completion (Veo3 takes 1-3 minutes)
  const maxPollAttempts = 60; // 5 minutes max
  let attempts = 0;
  while (!operation.done && attempts < maxPollAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 5000)); // 5s polling interval
    operation = await (ai.operations as any).getVideosOperation({ operation });
    attempts++;
  }

  if (!operation.done) {
    throw new Error('Veo3 video generation timed out after 5 minutes.');
  }

  // Extract the generated video
  const generatedVideo = operation.response?.generatedVideos?.[0];
  if (!generatedVideo) {
    throw new Error('Veo3 returned no video output.');
  }

  // The video comes as base64 or a GCS URI depending on config
  if (generatedVideo.video?.uri) {
    const apiKey = import.meta.env.VITE_API_KEY || '';
    const separator = generatedVideo.video.uri.includes('?') ? '&' : '?';
    const response = await fetch(`${generatedVideo.video.uri}${separator}key=${encodeURIComponent(apiKey)}`);
    if (!response.ok) throw new Error(`Veo3 video download failed (${response.status}).`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    const filename = outputPath.split('/').pop() || 'veo3_clip.mp4';
    await uploadBase64(btoa(binary), filename, 'video/mp4', outputPath.slice(0, -filename.length - 1));
    return { clipPath: outputPath, durationSec };
  }

  if (generatedVideo.video?.videoBytes) {
    // Base64 video data -- write to file
    const filename = outputPath.split('/').pop() || 'veo3_clip.mp4';
    await uploadBase64(generatedVideo.video.videoBytes, filename, 'video/mp4', outputPath.slice(0, -filename.length - 1));
    return { clipPath: outputPath, durationSec };
  }

  throw new Error('Veo3 response contained neither URI nor video bytes.');
}

/**
 * Stitch multiple Veo3 clips into a single video using ffmpeg concat.
 * Unlike stitched video (Ken Burns + xfade), Veo3 clips already have motion,
 * so we use simple concat with optional crossfade.
 */
export async function stitchVeo3Clips(
  clips: Veo3ClipResult[],
  outputPath: string,
  session: SessionInfo,
): Promise<string> {
  if (clips.length === 0) throw new Error('No clips to stitch.');
  if (clips.length === 1) return clips[0].clipPath;

  // Create a concat file list
  const listContent = clips.map((c) => `file '${c.clipPath}'`).join('\n');
  const listPath = `${session.sessionDir}/veo3_concat_list.txt`;
  const listResult = await execShell(`printf '${listContent.replace(/'/g, "\\'")}' > "${listPath}"`, session.sessionDir);
  if (!listResult.ok) throw new Error(`Could not create Veo3 concat list: ${listResult.stderr}`);

  // Simple concat (no xfade -- Veo3 clips have natural transitions)
  const stitchResult = await execShell(
    `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${outputPath}"`,
    session.sessionDir,
  );
  if (!stitchResult.ok) throw new Error(`Veo3 clip stitching failed: ${stitchResult.stderr.slice(-300)}`);

  return outputPath;
}
