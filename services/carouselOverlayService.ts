/**
 * Canvas-based text overlay system for carousel slides.
 * Burns brand-styled text onto generated images using HTML5 Canvas.
 * Replaces AI-rendered text (which hallucinates fonts/kerning) with pixel-perfect typography.
 */

// Polyfill for roundRect (not available in all browsers)
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x: number, y: number, w: number, h: number, r: number) {
    const radius = Math.min(r, w / 2, h / 2);
    this.beginPath();
    this.moveTo(x + radius, y);
    this.arcTo(x + w, y, x + w, y + h, radius);
    this.arcTo(x + w, y + h, x, y + h, radius);
    this.arcTo(x, y + h, x, y, radius);
    this.arcTo(x, y, x + w, y, radius);
    this.closePath();
    return this;
  };
}

export interface CarouselOverlayConfig {
  headline: string;
  bodyText?: string;
  slideNumber?: { current: number; total: number };
  brandColors: {
    primary: string;
    accent: string;
    background: string;
    text: string;
  };
  fontStyles: {
    headingFamily: string;
    bodyFamily: string;
    headingWeight: string;
    bodyWeight: string;
  };
  layout: 'hook' | 'value' | 'cta' | 'cover';
}

export interface CarouselOverlayResult {
  base64: string;
  mimeType: string;
  previewUrl: string;
}

const FONT_FALLBACKS = {
  heading: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  body: "'Helvetica Neue', Helvetica, Arial, sans-serif",
};

// Map brand DNA typography descriptions to web-safe font stacks
const FONT_MAP: { match: RegExp; family: string; weight: string }[] = [
  { match: /serif|elegant|classic|editorial|luxury|sophisticated|refined/i, family: "'Playfair Display', 'Times New Roman', Georgia, serif", weight: '700' },
  { match: /mono|technical|modern|minimal|clean|geometric|precise/i, family: "'SF Mono', 'JetBrains Mono', 'Fira Code', monospace", weight: '600' },
  { match: /condensed|bold|impact|strong|athletic|sport/i, family: "'Arial Narrow', 'Helvetica Neue Condensed', sans-serif", weight: '800' },
  { match: /script|handwritten|casual|friendly|playful|organic/i, family: "'Comic Sans MS', 'Segoe Print', cursive", weight: '600' },
  { match: /sans|clean|modern|contemporary|simple|neutral/i, family: "'Helvetica Neue', Helvetica, Arial, sans-serif", weight: '700' },
];

function mapFontFromDescription(desc: string, fallback: string): { family: string; weight: string } {
  for (const entry of FONT_MAP) {
    if (entry.match.test(desc)) {
      return { family: entry.family, weight: entry.weight };
    }
  }
  return { family: fallback, weight: '700' };
}

// Check if a hex color is light or dark (for contrast adjustment)
function isLightColor(hex: string): boolean {
  const c = hex.replace('#', '');
  if (c.length < 6) return false;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55;
}

interface LayoutConfig {
  headlineZone: { x: number; y: number; width: number; height: number };
  bodyZone?: { x: number; y: number; width: number; height: number } | null;
  slideNumZone?: { x: number; y: number } | null;
  headlineSize: number;
  bodySize?: number;
  headlineAlign: 'left' | 'center' | 'right';
  headlineColor: string;
  bodyColor?: string;
  overlayGradient: boolean;
  ctaBadge?: boolean;
}

const LAYOUT_CONFIGS: Record<'hook' | 'value' | 'cta' | 'cover', LayoutConfig> = {
  hook: {
    headlineZone: { x: 0.08, y: 0.12, width: 0.84, height: 0.35 },
    bodyZone: null,
    slideNumZone: { x: 0.85, y: 0.90 },
    headlineSize: 0.085,
    headlineAlign: 'left' as const,
    headlineColor: 'accent',
    overlayGradient: true,
  },
  value: {
    headlineZone: { x: 0.08, y: 0.08, width: 0.84, height: 0.18 },
    bodyZone: { x: 0.08, y: 0.72, width: 0.84, height: 0.20 },
    slideNumZone: { x: 0.85, y: 0.90 },
    headlineSize: 0.055,
    bodySize: 0.035,
    headlineAlign: 'left' as const,
    headlineColor: 'text',
    bodyColor: 'text',
    overlayGradient: true,
  },
  cta: {
    headlineZone: { x: 0.10, y: 0.35, width: 0.80, height: 0.30 },
    bodyZone: null,
    slideNumZone: null,
    headlineSize: 0.075,
    headlineAlign: 'center' as const,
    headlineColor: 'accent',
    overlayGradient: true,
    ctaBadge: true,
  },
  cover: {
    headlineZone: { x: 0.08, y: 0.15, width: 0.84, height: 0.40 },
    bodyZone: { x: 0.08, y: 0.60, width: 0.84, height: 0.20 },
    slideNumZone: { x: 0.85, y: 0.90 },
    headlineSize: 0.095,
    bodySize: 0.035,
    headlineAlign: 'left' as const,
    headlineColor: 'text',
    bodyColor: 'text',
    overlayGradient: true,
  },
};

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

function drawTextBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  zone: { x: number; y: number; width: number; height: number },
  fontSize: number,
  fontFamily: string,
  fontWeight: string,
  color: string,
  align: 'left' | 'center' | 'right',
  canvasSize: number,
  lineHeight: number = 1.35,
): void {
  const px = zone.x * canvasSize;
  const py = zone.y * canvasSize;
  const pw = zone.width * canvasSize;
  const ph = zone.height * canvasSize;
  const fontPx = fontSize * canvasSize;

  ctx.font = `${fontWeight} ${fontPx}px ${fontFamily}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';

  const alignX = align === 'center' ? px + pw / 2 : align === 'right' ? px + pw : px;

  const lines = wrapText(ctx, text, pw);
  const totalHeight = lines.length * fontPx * lineHeight;

  // Center vertically within zone
  let startY = py + (ph - totalHeight) / 2;
  if (startY < py) startY = py;

  // Text shadow for readability
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = canvasSize * 0.004;
  ctx.shadowOffsetY = canvasSize * 0.002;

  for (const line of lines) {
    ctx.fillText(line, alignX, startY);
    startY += fontPx * lineHeight;
  }

  // Reset shadow
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function drawSlideNumber(
  ctx: CanvasRenderingContext2D,
  current: number,
  total: number,
  zone: { x: number; y: number },
  color: string,
  canvasSize: number,
): void {
  const px = zone.x * canvasSize;
  const py = zone.y * canvasSize;
  const fontPx = canvasSize * 0.028;

  ctx.font = `600 ${fontPx}px ${FONT_FALLBACKS.body}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Draw pill background
  const text = `${current}/${total}`;
  const metrics = ctx.measureText(text);
  const pillW = metrics.width + canvasSize * 0.03;
  const pillH = fontPx * 1.6;
  const pillX = px - pillW / 2;
  const pillY = py - pillH / 2;

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.fillText(text, px, py);
}

function drawGradientOverlay(
  ctx: CanvasRenderingContext2D,
  canvasSize: number,
  layout: 'hook' | 'value' | 'cta' | 'cover',
): void {
  const cfg = LAYOUT_CONFIGS[layout];

  if (layout === 'hook' || layout === 'cover') {
    // Top gradient for headline readability
    const grad = ctx.createLinearGradient(0, 0, 0, canvasSize * 0.55);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvasSize, canvasSize * 0.55);
  }

  if (layout === 'value') {
    // Top gradient for headline
    const topGrad = ctx.createLinearGradient(0, 0, 0, canvasSize * 0.30);
    topGrad.addColorStop(0, 'rgba(0,0,0,0.50)');
    topGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, canvasSize, canvasSize * 0.30);

    // Bottom gradient for body text
    const bottomGrad = ctx.createLinearGradient(0, canvasSize * 0.65, 0, canvasSize);
    bottomGrad.addColorStop(0, 'rgba(0,0,0,0)');
    bottomGrad.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = bottomGrad;
    ctx.fillRect(0, canvasSize * 0.65, canvasSize, canvasSize * 0.35);
  }

  if (layout === 'cta') {
    // Full dark overlay for CTA slide
    const grad = ctx.createLinearGradient(0, 0, 0, canvasSize);
    grad.addColorStop(0, 'rgba(0,0,0,0.35)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvasSize, canvasSize);
  }
}

function drawCtaBadge(
  ctx: CanvasRenderingContext2D,
  canvasSize: number,
  accentColor: string,
): void {
  const badgeW = canvasSize * 0.35;
  const badgeH = canvasSize * 0.08;
  const badgeX = (canvasSize - badgeW) / 2;
  const badgeY = canvasSize * 0.70;

  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, badgeW, badgeH, badgeH / 2);
  ctx.fill();

  ctx.font = `700 ${canvasSize * 0.032}px ${FONT_FALLBACKS.body}`;
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SWIPE →', canvasSize / 2, badgeY + badgeH / 2);
}

/**
 * Burns brand-styled text overlay onto a carousel slide image.
 * @param imageBase64 - Base64 image data (without data: prefix)
 * @param config - Overlay configuration with brand colors, fonts, and text
 * @returns Base64 image with text overlay burned in
 */
export async function burnCarouselOverlay(
  imageBase64: string,
  config: CarouselOverlayConfig,
): Promise<CarouselOverlayResult> {
  const canvasSize = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');

  // Load the source image
  const img = new Image();
  img.crossOrigin = 'anonymous';

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load carousel image'));
    // Handle both raw base64 and data URLs
    img.src = imageBase64.startsWith('data:') ? imageBase64 : `data:image/png;base64,${imageBase64}`;
  });

  // Draw image to fill canvas (cover)
  const imgRatio = img.width / img.height;
  const canvasRatio = canvas.width / canvas.height;
  let drawW: number, drawH: number, drawX: number, drawY: number;

  if (imgRatio > canvasRatio) {
    drawH = canvas.height;
    drawW = drawH * imgRatio;
    drawX = (canvas.width - drawW) / 2;
    drawY = 0;
  } else {
    drawW = canvas.width;
    drawH = drawW / imgRatio;
    drawX = 0;
    drawY = (canvas.height - drawH) / 2;
  }

  ctx.drawImage(img, drawX, drawY, drawW, drawH);

  // Draw gradient overlay for text readability
  drawGradientOverlay(ctx, canvasSize, config.layout);

  const cfg = LAYOUT_CONFIGS[config.layout];
  const headingFont = config.fontStyles.headingFamily || FONT_FALLBACKS.heading;
  const bodyFont = config.fontStyles.bodyFamily || FONT_FALLBACKS.body;
  const textColor = config.brandColors.text || '#FFFFFF';
  const accentColor = config.brandColors.accent || config.brandColors.primary || '#FFFFFF';

  // Draw headline
  if (config.headline) {
    drawTextBlock(
      ctx,
      config.headline,
      cfg.headlineZone,
      cfg.headlineSize,
      headingFont,
      config.fontStyles.headingWeight || '800',
      cfg.headlineColor === 'accent' ? accentColor : textColor,
      cfg.headlineAlign,
      canvasSize,
    );
  }

  // Draw body text
  if (config.bodyText && cfg.bodyZone && cfg.bodySize) {
    drawTextBlock(
      ctx,
      config.bodyText,
      cfg.bodyZone,
      cfg.bodySize,
      bodyFont,
      config.fontStyles.bodyWeight || '400',
      cfg.bodyColor === 'accent' ? accentColor : textColor,
      cfg.headlineAlign,
      canvasSize,
      1.45,
    );
  }

  // Draw slide number
  if (config.slideNumber && cfg.slideNumZone) {
    drawSlideNumber(
      ctx,
      config.slideNumber.current,
      config.slideNumber.total,
      cfg.slideNumZone,
      textColor,
      canvasSize,
    );
  }

  // Draw CTA badge
  if (cfg.ctaBadge) {
    drawCtaBadge(ctx, canvasSize, accentColor);
  }

  // Export
  const dataUrl = canvas.toDataURL('image/png');
  const base64 = dataUrl.split(',')[1];

  return {
    base64,
    mimeType: 'image/png',
    previewUrl: dataUrl,
  };
}

/**
 * Determines the slide layout type based on position in the carousel.
 */
export function inferSlideLayout(index: number, total: number): 'hook' | 'value' | 'cta' | 'cover' {
  if (index === 0) return total > 3 ? 'hook' : 'cover';
  if (index === total - 1) return 'cta';
  return 'value';
}

/**
 * Extracts brand color configuration from BrandDNA.
 * Uses brand palette for text colors when appropriate.
 */
export function extractBrandColors(dna: {
  colors?: {
    primary?: string;
    secondary?: string;
    accent?: string;
    palette?: string[];
  };
}): CarouselOverlayConfig['brandColors'] {
  const colors = dna.colors;
  const primary = colors?.primary || '#FFFFFF';
  const accent = colors?.accent || colors?.secondary || colors?.primary || '#FFFFFF';

  // If the primary brand color is light, use dark text; if dark, use white text
  const primaryIsLight = isLightColor(primary);
  const text = primaryIsLight ? '#1A1A1A' : '#FFFFFF';

  return {
    primary,
    accent,
    background: primaryIsLight ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.5)',
    text,
  };
}

/**
 * Extracts font style configuration from BrandDNA typography.
 * Maps brand typography descriptions (e.g. "elegant serif", "modern sans") to actual font stacks.
 */
export function extractFontStyles(typography?: {
  headingStyle?: string;
  bodyStyle?: string;
  characterTraits?: string;
}): CarouselOverlayConfig['fontStyles'] {
  const headingDesc = typography?.headingStyle || '';
  const bodyDesc = typography?.bodyStyle || typography?.characterTraits || '';

  const heading = mapFontFromDescription(headingDesc, FONT_FALLBACKS.heading);
  const body = mapFontFromDescription(bodyDesc, FONT_FALLBACKS.body);

  return {
    headingFamily: heading.family,
    bodyFamily: body.family,
    headingWeight: heading.weight,
    bodyWeight: '400',
  };
}
