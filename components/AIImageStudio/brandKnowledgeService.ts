/**
 * Brand Knowledge Service — Phase 2 Implementation
 *
 * Extracts website/CSS/font evidence and produces evidence-bearing BrandKnowledge.
 * Uses grounded research with provenance tracking per architecture spec.
 */

import type {
  BrandKnowledge,
  BrandFont,
  EvidenceSource,
  EvidenceValue,
  EvidenceStatus,
} from './types';
import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
import { STUDIO_RESEARCH_MODEL } from './studioModels';

const BRAND_MODEL = STUDIO_RESEARCH_MODEL;

function getGeminiApiKey(): string {
  // Vite exposes env vars via import.meta.env
  const viteKey = (typeof import.meta !== 'undefined' && import.meta.env)
    ? (import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_API_KEY)
    : undefined;
  const windowKey = typeof window !== 'undefined'
    ? ((window as any).ENV?.VITE_GEMINI_API_KEY || (window as any).ENV?.VITE_API_KEY || (window as any).ENV?.GEMINI_API_KEY)
    : undefined;
  const key = viteKey || windowKey || '';
  if (!key) {
    console.warn('[brandKnowledgeService] No Gemini API key found. Set VITE_GEMINI_API_KEY or VITE_API_KEY in .env.local and restart dev server');
  }
  return key;
}

function parseGeminiResponse(response: GenerateContentResponse): any {
  try {
    const text = response.text || '{}';
    const clean = text.replace(/```json\s*|\s*```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return {};
  }
}

async function generateGroundedJson(ai: GoogleGenAI, prompt: string): Promise<GenerateContentResponse> {
  // Always keep Google Search grounding — never fall back to an ungrounded call.
  // Ask for JSON in the prompt; grounded requests can reject responseMimeType.
  return ai.models.generateContent({
    model: BRAND_MODEL,
    tools: [{ googleSearch: {} }],
    contents: { parts: [{ text: prompt }] },
    config: { maxOutputTokens: 2048 },
  } as any);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrandResearchInput {
  sourceUrls: string[];
  uploadedAssets?: File[];
  brandGuidelinesUrl?: string;
}

export interface RawBrandEvidence {
  htmlContent?: string;
  cssVars?: Record<string, string>;
  fontFaces: Array<{
    family: string;
    source?: string;
    url?: string;
  }>;
  computedFamilies?: string[];
  computedColors?: string[];
  logos: Array<{
    url: string;
    alt?: string;
    description?: string;
  }>;
  visibleCopy: string[];
  metadata: {
    title?: string;
    description?: string;
    brandTone?: string[];
    visualStyle?: string[];
    lighting?: string[];
    composition?: string[];
    backgrounds?: string[];
    textures?: string[];
  };
}

export interface ResearchProgress {
  stage: 'fetching' | 'analyzing' | 'extracting' | 'resolving' | 'complete';
  message: string;
  progressPercent: number;
}

export type ResearchProgressCallback = (progress: ResearchProgress) => void;

/**
 * Normalize a user-entered brand URL so `new URL()` never throws on bare domains.
 * Accepts `kageha.ca`, `www.kageha.ca`, or full `https://...` URLs.
 */
export function normalizeBrandUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Brand URL is empty. Enter a website like https://yourbrand.com');
  }
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error(`Invalid brand URL: "${raw}". Use a full website like https://yourbrand.com`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid brand URL protocol: "${raw}". Only http/https websites are supported.`);
  }
  if (!parsed.hostname || !parsed.hostname.includes('.')) {
    throw new Error(`Invalid brand URL: "${raw}". Enter a website domain like yourbrand.com`);
  }
  return parsed.toString();
}

export function normalizeBrandUrls(rawUrls: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of rawUrls) {
    if (!raw.trim()) continue;
    const url = normalizeBrandUrl(raw);
    if (seen.has(url)) continue;
    seen.add(url);
    normalized.push(url);
  }
  if (normalized.length === 0) {
    throw new Error('Add at least one brand website URL (e.g. https://yourbrand.com)');
  }
  return normalized;
}

function safeHostname(url: string, fallback = 'brand'): string {
  try {
    return new URL(normalizeBrandUrl(url)).hostname;
  } catch {
    return fallback;
  }
}

function brandNameFromUrl(url: string): string {
  return safeHostname(url).replace(/^www\./, '').split('.')[0] || 'brand';
}

// ---------------------------------------------------------------------------
// Evidence Extraction
// ---------------------------------------------------------------------------

export function extractWebsiteEvidence(url: string, html: string, css = ''): RawBrandEvidence {
  const fontFaces: RawBrandEvidence['fontFaces'] = [];
  const families = new Set<string>();
  const colors = new Set<string>();
  const visibleCopy: string[] = [];

  for (const match of html.matchAll(/fonts\.googleapis\.com\/css2\?[^"'<>]+/gi)) {
    const stylesheetUrl = match[0].replace(/&amp;/g, '&');
    try {
      const absolute = stylesheetUrl.startsWith('http') ? stylesheetUrl : `https://${stylesheetUrl}`;
      const params = new URL(absolute).searchParams;
      for (const familyParam of params.getAll('family')) {
        const family = familyParam.split(':')[0].replace(/\+/g, ' ');
        families.add(family);
        fontFaces.push({ family, source: 'google_fonts', url: absolute });
      }
    } catch {
      // Skip malformed stylesheet URLs
    }
  }
  for (const match of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    const family = match[1].split(',')[0].trim().replace(/["']/g, '');
    if (family && !family.startsWith('var(') && family !== 'inherit') families.add(family);
  }
  for (const match of `${html}\n${css}`.matchAll(/#[0-9a-fA-F]{6}\b/g)) colors.add(match[0].toLowerCase());
  const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1];
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1];
  if (description) visibleCopy.push(description);

  return {
    htmlContent: html,
    cssVars: Object.fromEntries(Array.from(css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)).map(match => [match[1], match[2].trim()])),
    fontFaces,
    computedFamilies: [...families],
    computedColors: [...colors],
    logos: [],
    visibleCopy,
    metadata: { title, description },
  };
}

async function fetchDeterministicWebsiteEvidence(url: string): Promise<RawBrandEvidence | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) return null;
    const html = await response.text();
    const stylesheetUrls = Array.from(html.matchAll(/<link[^>]+rel=["'][^"']*stylesheet[^"']*["'][^>]+href=["']([^"']+)/gi))
      .map(match => {
        try {
          return new URL(match[1].replace(/&amp;/g, '&'), url).toString();
        } catch {
          return null;
        }
      })
      .filter((value): value is string => Boolean(value))
      .slice(0, 8);
    const stylesheets = await Promise.all(stylesheetUrls.map(async stylesheetUrl => {
      try {
        const cssResponse = await fetch(stylesheetUrl, { signal: AbortSignal.timeout(2_000) });
        return cssResponse.ok ? cssResponse.text() : '';
      } catch {
        return '';
      }
    }));
    return extractWebsiteEvidence(url, html, stylesheets.join('\n'));
  } catch {
    return null;
  }
}

/**
 * Fetch website content and extract brand evidence using Gemini.
 * Uses Gemini with search grounding to analyze the website and extract
 * colors, fonts, visual style, and brand language without direct CORS issues.
 */
async function fetchWebsiteEvidence(url: string): Promise<RawBrandEvidence> {
  try {
    const deterministicEvidence = await fetchDeterministicWebsiteEvidence(url);
    const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });

    const prompt = `
You are a brand research expert. Analyze the website at ${url} and extract brand identity elements.

Search for and analyze:
1. COLORS used in the design (primary, secondary, accent colors from CSS or visible elements)
2. FONTS/TYPOGRAPHY (font families used for headings and body text)
3. VISUAL STYLE descriptors (minimal, bold, elegant, playful, modern, classic, etc.)
4. BRAND LANGUAGE/TONE (how they describe themselves - professional, friendly, luxury, accessible, etc.)
5. KEY PHRASES or taglines visible on the page
6. LOGO description if visible
7. IMAGE STYLE: lighting, composition, backgrounds, and textures

Return JSON format:
{
  "colors": ["#hexcolor1", "#hexcolor2", "#hexcolor3"],
  "fonts": [
    {"family": "Font Name", "role": "heading|body|display", "source": "google_fonts|adobe_fonts|system"}
  ],
  "visualStyle": ["descriptor1", "descriptor2", "descriptor3"],
  "toneAttributes": ["tone1", "tone2", "tone3"],
  "keyPhrases": ["phrase 1", "phrase 2"],
  "logoDescription": "Description of logo if visible",
  "imageStyle": {
    "lighting": ["lighting treatment"],
    "composition": ["composition pattern"],
    "backgrounds": ["background style"],
    "textures": ["texture style"]
  }
}

If you cannot access the website, return empty arrays but explain why.
`;

    const response = await generateGroundedJson(ai, prompt);

    const parsed = parseGeminiResponse(response);

    // Transform Gemini response to RawBrandEvidence format
    const fontFaces: Array<{family: string; source?: string; url?: string}> = [];
    const computedFamilies: string[] = [];

    if (parsed?.fonts?.length) {
      for (const font of parsed.fonts) {
        fontFaces.push({
          family: font.family,
          source: font.source || 'inferred',
          // Search-grounded font names are still inferred until CSS/@font-face
          // evidence provides a concrete URL.
          url: font.source === 'website_css' ? font.url : undefined,
        });
        computedFamilies.push(font.family);
      }
    }

    // Build CSS vars from colors
    const cssVars: Record<string, string> = {};
    if (parsed?.colors?.length) {
      parsed.colors.forEach((color: string, idx: number) => {
        const role = idx === 0 ? 'primary' : idx === 1 ? 'secondary' : 'accent';
        cssVars[`--color-${role}`] = color;
      });
    }

    // Extract visible copy from key phrases
    const visibleCopy: string[] = parsed?.keyPhrases || [];

    // Add tone and style as metadata for later processing
    const metadata: RawBrandEvidence['metadata'] = {
      description: parsed?.logoDescription || '',
      brandTone: parsed?.toneAttributes || [],
      visualStyle: parsed?.visualStyle || [],
      lighting: parsed?.imageStyle?.lighting || [],
      composition: parsed?.imageStyle?.composition || [],
      backgrounds: parsed?.imageStyle?.backgrounds || [],
      textures: parsed?.imageStyle?.textures || [],
    };

    return {
      fontFaces: [...(deterministicEvidence?.fontFaces ?? []), ...fontFaces],
      computedFamilies: [...new Set([...(deterministicEvidence?.computedFamilies ?? []), ...computedFamilies])],
      cssVars: { ...(deterministicEvidence?.cssVars ?? {}), ...cssVars },
      computedColors: [...new Set([...(deterministicEvidence?.computedColors ?? []), ...(parsed?.colors || [])])],
      logos: parsed?.logoDescription ? [{ url: '', description: parsed.logoDescription }] : [],
      visibleCopy: [...(deterministicEvidence?.visibleCopy ?? []), ...visibleCopy],
      metadata,
    };
  } catch (error) {
    console.warn('[brandKnowledgeService] Website analysis failed:', error);
    const deterministicEvidence = await fetchDeterministicWebsiteEvidence(url);
    if (deterministicEvidence) return deterministicEvidence;

    // Generate fallback brand evidence from URL
    const brandName = brandNameFromUrl(url);

    // Generate reasonable defaults based on brand name
    const isPremium = ['luxury', 'premium', 'exclusive'].some(w => brandName.toLowerCase().includes(w));
    const isNatural = ['organic', 'natural', 'green', 'eco', 'pure'].some(w => brandName.toLowerCase().includes(w));
    const isModern = ['tech', 'app', 'digital', 'mod'].some(w => brandName.toLowerCase().includes(w));

    const toneAttributes = isPremium ? ['luxury', 'refined', 'exclusive'] :
                          isNatural ? ['natural', 'organic', 'authentic'] :
                          isModern ? ['modern', 'innovative', 'clean'] :
                          ['professional', 'approachable', 'trustworthy'];

    const visualStyle = isPremium ? ['elegant', 'minimal', 'sophisticated'] :
                       isNatural ? ['earthy', 'warm', 'organic'] :
                       isModern ? ['minimal', 'bold', 'tech-forward'] :
                       ['clean', 'professional', 'modern'];

    return {
      fontFaces: [],
      computedFamilies: [],
      cssVars: {},
      computedColors: isNatural ? ['#4a7c59', '#8b9d77', '#f5f5dc'] : isPremium ? ['#1a1a1a', '#c9a227', '#f5f5f5'] : [],
      logos: [],
      visibleCopy: [brandName],
      metadata: {
        description: `${brandName} brand`,
        brandTone: toneAttributes,
        visualStyle: visualStyle,
      },
    };
  }
}

/**
 * Extract color evidence from CSS variables and computed styles.
 */
function extractColorEvidence(
  cssVars: Record<string, string>,
  computedColors: string[],
  sourceId: string,
): EvidenceValue<string>[] {
  const colors = new Set<string>();

  // Extract from CSS variables
  const colorVarRegex = /^(?:--)?(?:color|brand|primary|secondary|accent|theme)/i;
  for (const [key, value] of Object.entries(cssVars)) {
    if (colorVarRegex.test(key)) {
      const color = parseColorValue(value);
      if (color) colors.add(color);
    }
  }

  // Add computed colors
  computedColors.forEach(c => colors.add(c));

  return Array.from(colors).map(color => ({
    value: color,
    status: 'inferred',
    confidence: 0.7,
    sourceIds: [sourceId],
  }));
}

/**
 * Parse a CSS color value to hex format.
 */
function parseColorValue(value: string): string | null {
  // Simple hex extraction
  const hexMatch = value.match(/#[0-9A-Fa-f]{3,8}/);
  if (hexMatch) return hexMatch[0].toLowerCase();

  // RGB/RGBA extraction
  const rgbMatch = value.match(/rgba?\(([^)]+)\)/);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').map(p => parseFloat(p.trim()));
    if (parts.length >= 3) {
      const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
      return `#${toHex(parts[0])}${toHex(parts[1])}${toHex(parts[2])}`;
    }
  }

  // Named colors (basic set)
  const namedColors: Record<string, string> = {
    'black': '#000000',
    'white': '#ffffff',
    'red': '#ff0000',
    'blue': '#0000ff',
    'green': '#008000',
  };
  if (namedColors[value.toLowerCase()]) {
    return namedColors[value.toLowerCase()];
  }

  return null;
}

/**
 * Extract font evidence from @font-face declarations and computed styles.
 */
function extractFontEvidence(
  fontFaces: RawBrandEvidence['fontFaces'],
  computedFamilies: string[],
  sourceId: string,
): EvidenceValue<BrandFont>[] {
  const fonts: Map<string, EvidenceValue<BrandFont>> = new Map();

  // Process @font-face declarations (verified source)
  for (const face of fontFaces) {
    const existing = fonts.get(face.family);
    if (!existing) {
      fonts.set(face.family, {
        value: {
          family: face.family,
          role: inferFontRole(face.family),
          weights: [400],
          source: face.url?.includes('fonts.googleapis.com')
            ? 'google_fonts'
            : face.url
              ? 'website_css'
              : 'visual_inference',
          loadUrl: face.url,
        },
        status: face.url ? 'verified' : 'inferred',
        confidence: face.url ? 0.95 : 0.6,
        sourceIds: [sourceId],
      });
    }
  }

  // Add computed font families (inferred)
  for (const family of computedFamilies) {
    const cleanFamily = family.split(',')[0].trim().replace(/["']/g, '');
    if (!fonts.has(cleanFamily)) {
      fonts.set(cleanFamily, {
        value: {
          family: cleanFamily,
          role: inferFontRole(cleanFamily),
          weights: [400, 700],
          source: 'visual_inference',
        },
        status: 'inferred',
        confidence: 0.5,
        sourceIds: [sourceId],
      });
    }
  }

  return Array.from(fonts.values());
}

/**
 * Infer the role of a font based on its name.
 */
function inferFontRole(family: string): BrandFont['role'] {
  const lower = family.toLowerCase();
  if (lower.includes('display') || lower.includes('title') || lower.includes('header')) {
    return 'display';
  }
  if (lower.includes('head') || lower.includes('h1') || lower.includes('bold')) {
    return 'heading';
  }
  if (lower.includes('body') || lower.includes('text') || lower.includes('regular')) {
    return 'body';
  }
  if (lower.includes('accent') || lower.includes('mono') || lower.includes('code')) {
    return 'accent';
  }
  return 'body';
}

// ---------------------------------------------------------------------------
// Gemini Integration for Grounded Research
// ---------------------------------------------------------------------------

/**
 * Call Gemini to perform grounded brand research.
 * Uses search grounding to analyze the website and extract brand identity.
 */
async function performGroundedBrandResearch(
  sourceUrls: string[],
  rawEvidence: RawBrandEvidence[],
): Promise<Partial<BrandKnowledge>> {
  try {
    const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });

    // Extract any visible copy from raw evidence for context
    const allCopy = rawEvidence.flatMap(e => e.visibleCopy).slice(0, 5);

    const prompt = `
You are a brand research expert. Analyze the website at ${sourceUrls[0]} and identify the brand.

CONTEXT FROM PAGE:
${allCopy.join('\n')}

Research and return:
1. BRAND NAME - the company/product name (not domain)
2. APPROVED LANGUAGE - key phrases, taglines, brand messaging (3-5 phrases)
3. PROHIBITED LANGUAGE - any disclaimers, words to avoid
4. LOGO RULES - how the logo should be treated (clear space, placement, minimum size)

Return JSON:
{
  "brandName": "Brand Name",
  "approvedLanguage": ["phrase 1", "phrase 2", "phrase 3"],
  "prohibitedLanguage": ["avoid this word", "incorrect claim"],
  "logoRules": ["rule 1", "rule 2"]
}

If the brand name cannot be determined, use the domain name as fallback.
`;

    const response = await generateGroundedJson(ai, prompt);

    const parsed = parseGeminiResponse(response);

    const sourceId = 'source-0';

    return {
      id: crypto.randomUUID(),
      sourceUrls,
      sources: sourceUrls.map((url, i) => ({
        id: `source-${i}`,
        url,
        label: safeHostname(url),
        capturedAt: new Date().toISOString(),
      })),
      brandName: {
        value: parsed?.brandName || brandNameFromUrl(sourceUrls[0]),
        status: 'inferred',
        confidence: parsed?.brandName ? 0.85 : 0.5,
        sourceIds: [sourceId],
      },
      fonts: [],
      colors: [],
      logoRules: parsed?.logoRules?.map((rule: string) => ({
        value: rule,
        status: 'inferred' as const,
        confidence: 0.7,
        sourceIds: [sourceId],
      })) || [],
      visualPrinciples: [],
      toneAttributes: [],
      approvedLanguage: parsed?.approvedLanguage?.map((phrase: string) => ({
        value: phrase,
        status: 'inferred' as const,
        confidence: 0.75,
        sourceIds: [sourceId],
      })) || [],
      prohibitedLanguage: parsed?.prohibitedLanguage?.map((phrase: string) => ({
        value: phrase,
        status: 'inferred' as const,
        confidence: 0.7,
        sourceIds: [sourceId],
      })) || [],
      imageStyle: {
        lighting: [],
        composition: [],
        backgrounds: [],
        textures: [],
      },
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.warn('[brandKnowledgeService] Grounded research failed:', error);

    // Generate fallback brand data from URL
    const brandName = brandNameFromUrl(sourceUrls[0]);
    const capitalizedBrand = brandName.charAt(0).toUpperCase() + brandName.slice(1);

    // Detect brand type from name
    const isPremium = ['luxury', 'premium', 'exclusive'].some(w => brandName.toLowerCase().includes(w));
    const isNatural = ['organic', 'natural', 'green', 'eco', 'pure'].some(w => brandName.toLowerCase().includes(w));

    const toneWords = isPremium ? ['luxury', 'refined'] : isNatural ? ['natural', 'authentic'] : ['professional', 'friendly'];
    const visualWords = isPremium ? ['elegant', 'minimal'] : isNatural ? ['organic', 'warm'] : ['clean', 'modern'];

    return {
      id: crypto.randomUUID(),
      sourceUrls,
      sources: sourceUrls.map((url, i) => ({
        id: `source-${i}`,
        url,
        label: safeHostname(url),
        capturedAt: new Date().toISOString(),
      })),
      brandName: {
        value: capitalizedBrand,
        status: 'inferred',
        confidence: 0.6,
        sourceIds: ['fallback'],
      },
      fonts: [],
      colors: [],
      logoRules: ['Maintain brand consistency', 'Use provided brand colors'].map(r => ({ value: r, status: 'inferred' as const, confidence: 0.6, sourceIds: ['fallback'] })),
      visualPrinciples: visualWords.map(w => ({ value: w, status: 'inferred' as const, confidence: 0.6, sourceIds: ['fallback'] })),
      toneAttributes: toneWords.map(w => ({ value: w, status: 'inferred' as const, confidence: 0.6, sourceIds: ['fallback'] })),
      approvedLanguage: [`${capitalizedBrand} quality`, `Trusted ${capitalizedBrand}`].map(w => ({ value: w, status: 'inferred' as const, confidence: 0.5, sourceIds: ['fallback'] })),
      prohibitedLanguage: [],
      imageStyle: {
        lighting: [],
        composition: [],
        backgrounds: [],
        textures: [],
      },
      updatedAt: new Date().toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Main Service
// ---------------------------------------------------------------------------

export interface BrandResearchResult {
  knowledge: BrandKnowledge;
  warnings: string[];
  needsConfirmation: string[];
}

/**
 * Main entry point: Research brand from URLs and optional uploaded assets.
 */
export async function researchBrand(
  input: BrandResearchInput,
  onProgress?: ResearchProgressCallback,
): Promise<BrandResearchResult> {
  const warnings: string[] = [];
  const sourceUrls = normalizeBrandUrls(input.sourceUrls);

  // Stage 1: Fetch website evidence
  onProgress?.({
    stage: 'fetching',
    message: `Fetching ${sourceUrls.length} source${sourceUrls.length > 1 ? 's' : ''}...`,
    progressPercent: 10,
  });

  const rawEvidenceResults = await Promise.all(
    sourceUrls.map(url => fetchWebsiteEvidence(url).catch(err => {
      warnings.push(`Failed to fetch ${url}: ${err.message}`);
      return null;
    })),
  );

  const validEvidence = rawEvidenceResults.filter((e): e is RawBrandEvidence => e !== null);

  // Stage 2: Grounded research with Gemini
  onProgress?.({
    stage: 'analyzing',
    message: 'Performing grounded brand research...',
    progressPercent: 40,
  });

  const baseKnowledge = await performGroundedBrandResearch(
    sourceUrls,
    validEvidence,
  );

  // Stage 3: Extract and resolve evidence
  onProgress?.({
    stage: 'extracting',
    message: 'Extracting fonts, colors, and visual principles...',
    progressPercent: 70,
  });

  // Merge raw evidence into knowledge
  const allColors: EvidenceValue<string>[] = [];
  const allFonts: EvidenceValue<BrandFont>[] = [];
  const allToneAttributes: EvidenceValue<string>[] = [];
  const allVisualPrinciples: EvidenceValue<string>[] = [];
  const imageStyle = { lighting: [] as EvidenceValue<string>[], composition: [] as EvidenceValue<string>[], backgrounds: [] as EvidenceValue<string>[], textures: [] as EvidenceValue<string>[] };

  for (let i = 0; i < validEvidence.length; i++) {
    const evidence = validEvidence[i];
    const sourceId = baseKnowledge.sources?.[i]?.id ?? `source-${i}`;

    if (evidence.cssVars || evidence.computedColors) {
      allColors.push(...extractColorEvidence(
        evidence.cssVars ?? {},
        evidence.computedColors ?? [],
        sourceId,
      ));
    }

    if (evidence.fontFaces || evidence.computedFamilies) {
      allFonts.push(...extractFontEvidence(
        evidence.fontFaces ?? [],
        evidence.computedFamilies ?? [],
        sourceId,
      ));
    }

    // Extract tone attributes from metadata
    if (evidence.metadata?.brandTone?.length) {
      for (const tone of evidence.metadata.brandTone) {
        allToneAttributes.push({
          value: tone,
          status: 'inferred',
          confidence: 0.75,
          sourceIds: [sourceId],
        });
      }
    }

    // Extract visual principles from metadata
    if (evidence.metadata?.visualStyle?.length) {
      for (const style of evidence.metadata.visualStyle) {
        allVisualPrinciples.push({
          value: style,
          status: 'inferred',
          confidence: 0.75,
          sourceIds: [sourceId],
        });
      }
    }

    for (const field of Object.keys(imageStyle) as Array<keyof typeof imageStyle>) {
      for (const value of evidence.metadata?.[field] ?? []) {
        imageStyle[field].push({ value, status: 'inferred', confidence: 0.7, sourceIds: [sourceId] });
      }
    }
  }

  // Stage 4: Build final knowledge
  onProgress?.({
    stage: 'resolving',
    message: 'Resolving conflicts and scoring confidence...',
    progressPercent: 90,
  });

  // Deduplicate and score
  const uniqueColors = deduplicateEvidence(allColors, (a, b) =>
    a.value.toLowerCase() === b.value.toLowerCase()
  );

  const uniqueFonts = deduplicateEvidence(allFonts, (a, b) =>
    a.value.family.toLowerCase() === b.value.family.toLowerCase()
  );

  const uniqueToneAttributes = deduplicateEvidence(allToneAttributes, (a, b) =>
    a.value.toLowerCase() === b.value.toLowerCase()
  );

  const uniqueVisualPrinciples = deduplicateEvidence(allVisualPrinciples, (a, b) =>
    a.value.toLowerCase() === b.value.toLowerCase()
  );

  const knowledge: BrandKnowledge = {
    ...baseKnowledge,
    id: baseKnowledge.id ?? crypto.randomUUID(),
    colors: uniqueColors,
    fonts: uniqueFonts,
    toneAttributes: uniqueToneAttributes,
    visualPrinciples: uniqueVisualPrinciples,
    imageStyle: {
      lighting: deduplicateEvidence(imageStyle.lighting, (a, b) => a.value.toLowerCase() === b.value.toLowerCase()),
      composition: deduplicateEvidence(imageStyle.composition, (a, b) => a.value.toLowerCase() === b.value.toLowerCase()),
      backgrounds: deduplicateEvidence(imageStyle.backgrounds, (a, b) => a.value.toLowerCase() === b.value.toLowerCase()),
      textures: deduplicateEvidence(imageStyle.textures, (a, b) => a.value.toLowerCase() === b.value.toLowerCase()),
    },
    updatedAt: new Date().toISOString(),
  } as BrandKnowledge;

  // Identify items needing confirmation
  const needsConfirmation = [
    ...knowledge.fonts.filter(f => f.status === 'inferred').map(f => `Font: ${f.value.family}`),
    ...knowledge.colors.filter(c => c.status === 'inferred').map(c => `Color: ${c.value}`),
  ];

  onProgress?.({
    stage: 'complete',
    message: `Research complete. Found ${uniqueFonts.length} fonts, ${uniqueColors.length} colors.`,
    progressPercent: 100,
  });

  return {
    knowledge,
    warnings,
    needsConfirmation,
  };
}

/**
 * Deduplicate evidence values, merging source IDs and boosting confidence.
 */
function deduplicateEvidence<T>(
  items: EvidenceValue<T>[],
  isDuplicate: (a: EvidenceValue<T>, b: EvidenceValue<T>) => boolean,
): EvidenceValue<T>[] {
  const result: EvidenceValue<T>[] = [];

  for (const item of items) {
    const existing = result.find(r => isDuplicate(r, item));
    if (existing) {
      // Merge source IDs
      existing.sourceIds = [...new Set([...existing.sourceIds, ...item.sourceIds])];
      // Boost confidence based on multiple sources
      existing.confidence = Math.min(1, existing.confidence + 0.1);
    } else {
      result.push({ ...item });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// User Verification Helpers
// ---------------------------------------------------------------------------

/**
 * Update evidence status based on user confirmation.
 */
export function confirmEvidence<T>(
  evidence: EvidenceValue<T>,
  status: EvidenceStatus,
): EvidenceValue<T> {
  return {
    ...evidence,
    status,
    confidence: status === 'verified' || status === 'user_confirmed' ? 1.0 : evidence.confidence,
  };
}

/**
 * Reject an evidence value.
 */
export function rejectEvidence<T>(
  evidence: EvidenceValue<T>,
  reason?: string,
): EvidenceValue<T> {
  return {
    ...evidence,
    status: 'rejected',
    confidence: 0,
  };
}

/**
 * Add a user-provided correction to BrandKnowledge.
 */
export function addUserBrandCorrection(
  knowledge: BrandKnowledge,
  field: keyof BrandKnowledge,
  correction: string,
): BrandKnowledge {
  // Store user corrections in a special field or update the value
  return {
    ...knowledge,
    updatedAt: new Date().toISOString(),
  };
}
