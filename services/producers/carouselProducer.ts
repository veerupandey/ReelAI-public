/**
 * Carousel Producer
 * Generates multi-slide carousel images for Instagram Carousel (1:1 aspect ratio).
 * Each slide gets text burned onto the image (headline + body).
 *
 * Pipeline:
 * 1. Generate image per slide via Gemini (1:1 aspect ratio)
 * 2. Burn text overlay per slide (headline + body) via PIL
 * 3. Batch export all slides at 1080x1080
 */

import { generateImageAsset } from '../geminiService';
import {
  uploadBase64,
  runPython,
  type SessionInfo,
} from '../shellToolService';
import { resolveFormatSpec } from '../../types/brand';
import type { AgentEvent } from '../autonomousAgent';
import type { ProducerOutput } from '../formatRouter';
import type { SceneVisualMode } from '../creativeReferenceDirector';

const uid = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

const systemFontPath = (fontFamily: string): string => {
  if (fontFamily.includes('/')) return fontFamily;
  if (fontFamily === 'Georgia') return '/System/Library/Fonts/Supplemental/Georgia.ttf';
  if (fontFamily === 'Times New Roman') return '/System/Library/Fonts/Supplemental/Times New Roman.ttf';
  if (fontFamily === 'Arial') return '/System/Library/Fonts/Supplemental/Arial.ttf';
  return '/System/Library/Fonts/Helvetica.ttc';
};

export interface CarouselSlide {
  index: number;
  imagePrompt: string;
  headline: string;
  body?: string;
  useProductAsReference: boolean;
  visualMode?: SceneVisualMode;
  generatedImageBase64?: string;
  imageUrl?: string; // For when images are already generated
}

export interface TextOverlayStyle {
  fontSizeHeadline: number;
  fontSizeBody: number;
  positionX: number; // 0-100 percentage from left
  positionY: number; // 0-100 percentage from top
  textColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  fontFamily: string;
  textAlign: 'left' | 'center' | 'right';
  lineHeight: number; // 1.0-2.0
  letterSpacing: number; // -2 to 10
  textShadow: boolean;
  textShadowColor: string;
  textShadowBlur: number;
}

export interface CarouselProducerInput {
  slides: CarouselSlide[];
  session: SessionInfo;
  onEvent: (e: AgentEvent) => void;
  productBase64?: string;
  platform: string;
}

export async function produceCarousel(input: CarouselProducerInput): Promise<ProducerOutput> {
  const { slides, session, onEvent, productBase64, platform } = input;
  const spec = resolveFormatSpec('carousel', platform as any);

  const slideUrls: string[] = [];
  const sceneImages: Array<{ url: string; label: string }> = [];

  for (const slide of slides) {
    // Step 1: Generate image
    const imagePrompt = `${slide.imagePrompt}. Square 1:1 format, high resolution, suitable for Instagram carousel slide.`;
    const needsProduct = slide.useProductAsReference || slide.visualMode === 'product_locked' || slide.visualMode === 'product_composite';
    if (needsProduct && !productBase64 && !slide.generatedImageBase64) {
      throw new Error(
        `Carousel slide ${slide.index + 1} requires a real product image reference, but none was provided.`,
      );
    }
    const base64 = slide.generatedImageBase64 || await generateImageAsset({
      imagePrompt,
      mode: slide.visualMode === 'product_composite' && productBase64
        ? 'composite'
        : slide.useProductAsReference && productBase64 ? 'edit' : 'generate',
      primaryReference: slide.useProductAsReference && productBase64 ? { data: productBase64 } : undefined,
      aspectRatio: spec.aspectRatio,
    });

    const rawPath = `${session.sessionDir}/carousel_slide_${slide.index}_raw.png`;
    await uploadBase64(base64, 'image/png', rawPath);

    // Step 2: Burn text overlay
    const finalPath = `${session.sessionDir}/carousel_slide_${slide.index}.png`;
    const headlineLiteral = JSON.stringify(slide.headline || '');
    const bodyLiteral = JSON.stringify(slide.body || '');

    console.log(`[carouselProducer] Burning text overlay for slide ${slide.index}: headline="${slide.headline}", body="${slide.body}"`);

    const code = `
from PIL import Image, ImageDraw, ImageFont
import sys

img = Image.open("${rawPath}")
W, H = img.size

# Semi-transparent overlay bar at bottom third
overlay = Image.new('RGBA', (W, int(H * 0.3)), (0, 0, 0, 150))
img_rgba = img.convert('RGBA')
img_rgba.paste(overlay, (0, int(H * 0.7)), overlay)

try:
    font_headline = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 48)
    font_body = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 32)
except Exception as e:
    print(f"Font load error: {e}", file=sys.stderr)
    font_headline = ImageFont.load_default()
    font_body = ImageFont.load_default()

draw_rgba = ImageDraw.Draw(img_rgba)

headline = ${headlineLiteral}
if headline:
    lines = []
    words = headline.split()
    current = ''
    for word in words:
        candidate = (current + ' ' + word).strip()
        if not current or draw_rgba.textbbox((0, 0), candidate, font=font_headline)[2] <= W - 120:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current: lines.append(current)
    y = int(H * 0.73)
    for line in lines[:2]:
        bbox = draw_rgba.textbbox((0, 0), line, font=font_headline)
        draw_rgba.text(((W - (bbox[2] - bbox[0])) // 2, y), line, fill="white", font=font_headline)
        y += 58
    print(f"Drew headline: {headline}")

body = ${bodyLiteral}
if body:
    bbox = draw_rgba.textbbox((0, 0), body, font=font_body)
    tw = bbox[2] - bbox[0]
    x = (W - tw) // 2
    y = int(H * 0.83)
    draw_rgba.text((x, y), body, fill=(255, 255, 255, 200), font=font_body)
    print(f"Drew body: {body}")

img_rgba.convert('RGB').save("${finalPath}")
print("OK")
`;
    const pyResult = await runPython(code, session.sessionDir);
    if (!pyResult.ok || !pyResult.stdout.includes('OK')) {
      console.error(`[carouselProducer] Text overlay failed for slide ${slide.index}:`, pyResult.stderr);
      onEvent({ id: uid(), timestamp: Date.now(), type: 'error', phase: 'export_carousel', message: `Text overlay failed for slide ${slide.index}: ${pyResult.stderr}` });
    } else {
      console.log(`[carouselProducer] Text overlay succeeded for slide ${slide.index}`);
    }

    slideUrls.push(finalPath);
    sceneImages.push({ url: finalPath, label: `Slide ${slide.index + 1}: ${slide.headline}` });
  }

  return {
    adFormat: 'carousel',
    carouselImageUrls: slideUrls,
    sceneImages,
    durationSec: 0,
  };
}

/** Generate carousel images only (no text overlay) */
export async function generateCarouselImages(input: CarouselProducerInput): Promise<{ imageUrls: string[]; baseUrl: string }> {
  const { slides, session, productBase64, platform } = input;
  const spec = resolveFormatSpec('carousel', platform as any);

  const imageUrls: string[] = [];

  for (const slide of slides) {
    const imagePrompt = `${slide.imagePrompt}. Square 1:1 format, high resolution, suitable for Instagram carousel slide.`;
    const needsProduct = slide.useProductAsReference || slide.visualMode === 'product_locked' || slide.visualMode === 'product_composite';
    if (needsProduct && !productBase64 && !slide.generatedImageBase64) {
      throw new Error(
        `Carousel slide ${slide.index + 1} requires a real product image reference, but none was provided.`,
      );
    }
    const base64 = slide.generatedImageBase64 || await generateImageAsset({
      imagePrompt,
      mode: slide.visualMode === 'product_composite' && productBase64
        ? 'composite'
        : slide.useProductAsReference && productBase64 ? 'edit' : 'generate',
      primaryReference: slide.useProductAsReference && productBase64 ? { data: productBase64 } : undefined,
      aspectRatio: spec.aspectRatio,
    });

    const rawPath = `${session.sessionDir}/carousel_slide_${slide.index}_raw.png`;
    await uploadBase64(base64, 'image/png', rawPath);
    imageUrls.push(rawPath);
  }

  return { imageUrls, baseUrl: session.baseUrl };
}

/** Apply custom text overlays to existing carousel images */
export async function applyTextOverlays(
  slides: CarouselSlide[],
  style: TextOverlayStyle,
  session: SessionInfo,
  onEvent: (e: AgentEvent) => void,
): Promise<string[]> {
  const finalUrls: string[] = [];

  for (const slide of slides) {
    const rawPath = slide.imageUrl || `${session.sessionDir}/carousel_slide_${slide.index}_raw.png`;
    const finalPath = `${session.sessionDir}/carousel_slide_${slide.index}_final.png`;
    const headlineLiteral = JSON.stringify(slide.headline || '');
    const bodyLiteral = JSON.stringify(slide.body || '');
    const fontPath = systemFontPath(style.fontFamily);

    const positionYPercent = style.positionY / 100;
    const positionXPercent = style.positionX / 100;
    const overlayHeight = 1 - positionYPercent;
    const bgOpacity = Math.round(style.backgroundOpacity * 255);

    const textAlignX = style.textAlign === 'center' ? 'W * ' + positionXPercent.toFixed(2) : style.textAlign === 'left' ? '60' : 'W - 60';
    const textAlignAnchor = style.textAlign === 'center' ? 'mm' : style.textAlign === 'left' ? 'lm' : 'rm';

    const code = `
from PIL import Image, ImageDraw, ImageFont, ImageEnhance
import sys

img = Image.open("${rawPath}")
W, H = img.size

# Semi-transparent overlay bar
overlay = Image.new('RGBA', (W, int(H * ${overlayHeight})), (${parseInt(style.backgroundColor.slice(1, 3), 16)}, ${parseInt(style.backgroundColor.slice(3, 5), 16)}, ${parseInt(style.backgroundColor.slice(5, 7), 16)}, ${bgOpacity}))
img_rgba = img.convert('RGBA')
img_rgba.paste(overlay, (0, int(H * ${positionYPercent})), overlay)

try:
    font_headline = ImageFont.truetype(${JSON.stringify(fontPath)}, ${style.fontSizeHeadline})
    font_body = ImageFont.truetype(${JSON.stringify(fontPath)}, ${style.fontSizeBody})
except Exception as e:
    print(f"Font load error: {e}", file=sys.stderr)
    font_headline = ImageFont.load_default()
    font_body = ImageFont.load_default()

draw_rgba = ImageDraw.Draw(img_rgba)

headline = ${headlineLiteral}
if headline:
    x = ${textAlignX}
    y = int(H * ${positionYPercent}) + 60
    # Text shadow
    if ${style.textShadow}:
        shadow_color = (${parseInt(style.textShadowColor.slice(1, 3), 16)}, ${parseInt(style.textShadowColor.slice(3, 5), 16)}, ${parseInt(style.textShadowColor.slice(5, 7), 16)}, ${Math.round(style.textShadowBlur * 25)})
        draw_rgba.text((x + 2, y + 2), headline, fill=shadow_color, font=font_headline, anchor="${textAlignAnchor}")
    draw_rgba.text((x, y), headline, fill="${style.textColor}", font=font_headline, anchor="${textAlignAnchor}")
    print(f"Drew headline: {headline}")

body = ${bodyLiteral}
if body:
    # Estimate headline height for body positioning
    headline_height = ${style.fontSizeHeadline} * ${style.lineHeight} if headline else 0
    x = ${textAlignX}
    y = int(H * ${positionYPercent}) + 60 + headline_height + 30
    # Text shadow
    if ${style.textShadow}:
        shadow_color = (${parseInt(style.textShadowColor.slice(1, 3), 16)}, ${parseInt(style.textShadowColor.slice(3, 5), 16)}, ${parseInt(style.textShadowColor.slice(5, 7), 16)}, ${Math.round(style.textShadowBlur * 25)})
        draw_rgba.text((x + 2, y + 2), body, fill=shadow_color, font=font_body, anchor="${textAlignAnchor}")
    draw_rgba.text((x, y), body, fill="${style.textColor}", font=font_body, anchor="${textAlignAnchor}")
    print(f"Drew body: {body}")

img_rgba.convert('RGB').save("${finalPath}")
print("OK")
`;

    const pyResult = await runPython(code, session.sessionDir);
    if (!pyResult.ok || !pyResult.stdout.includes('OK')) {
      console.error(`[carouselProducer] Text overlay failed for slide ${slide.index}:`, pyResult.stderr);
      onEvent({ id: uid(), timestamp: Date.now(), type: 'error', phase: 'export_carousel', message: `Text overlay failed for slide ${slide.index}: ${pyResult.stderr}` });
      throw new Error(`Text overlay failed for slide ${slide.index}`);
    }

    finalUrls.push(finalPath);
  }

  return finalUrls;
}
