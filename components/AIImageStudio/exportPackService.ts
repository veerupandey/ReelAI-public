import type {
  BrandKnowledge,
  ProductTruth,
  SocialPostDraft,
  StudioAsset,
  StudioCaptionPack,
} from './types';
import { base64ToUint8Array, buildZipBlob, downloadBlob, type ZipEntry } from './zipStore';
import {
  buildVariationSetScorecard,
  groupAssetsByVariationSet,
} from './variationSetScorecard';

export interface ExportPackInput {
  assets: StudioAsset[];
  socialPostDraft?: SocialPostDraft;
  captionPack?: StudioCaptionPack;
  brandName?: string;
  brandKnowledge?: BrandKnowledge | null;
  productTruth?: ProductTruth | null;
  /**
   * When true, include rights notes + brand report alongside masters.
   * Images are exported once at their generated aspect — no fake multi-size copies.
   */
  clientPack?: boolean;
}

/** Common Instagram deliverable sizes (for docs / adapt-format UI — not fake zip folders). */
export const CLIENT_PACK_SIZES = [
  { folder: '1x1', label: '1:1', aspectRatio: '1:1' as const },
  { folder: '4x5', label: '4:5', aspectRatio: '4:5' as const },
  { folder: '9x16', label: '9:16', aspectRatio: '9:16' as const },
] as const;

function extensionForMime(mimeType: StudioAsset['mimeType']): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

export function safeExportFilename(name: string, fallback: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function formatHashtags(tags: string[]): string {
  return tags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' ');
}

export function resolveExportCopy(input: ExportPackInput): {
  caption?: string;
  hashtags: string[];
  callToAction?: string;
  headline?: string;
  supportingText?: string;
  altText?: string;
  researchSummary?: string;
  platform?: string;
  objective?: string;
  source: 'caption_pack' | 'social_draft' | 'none';
} {
  if (input.captionPack?.caption?.trim()) {
    return {
      caption: input.captionPack.caption,
      hashtags: input.captionPack.hashtags,
      callToAction: input.captionPack.callToAction,
      altText: input.captionPack.altText,
      researchSummary: input.captionPack.researchSummary,
      source: 'caption_pack',
    };
  }
  if (input.socialPostDraft) {
    const draft = input.socialPostDraft;
    return {
      caption: draft.copy.caption,
      hashtags: draft.copy.hashtags,
      callToAction: draft.copy.callToAction,
      headline: draft.copy.headline,
      supportingText: draft.copy.supportingText,
      platform: draft.platform.replace('_', ' '),
      objective: draft.objective,
      source: 'social_draft',
    };
  }
  return { hashtags: [], source: 'none' };
}

export function buildExportCaptionsText(input: ExportPackInput): string {
  const lines: string[] = [];
  const brand = input.brandName || 'Brand';
  const copy = resolveExportCopy(input);
  lines.push(`# Instagram Export Pack — ${brand}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  if (copy.source !== 'none') {
    lines.push('## Post Copy');
    if (copy.platform) lines.push(`Platform: ${copy.platform}`);
    if (copy.objective) lines.push(`Objective: ${copy.objective}`);
    if (copy.headline) lines.push(`Headline: ${copy.headline}`);
    if (copy.supportingText) lines.push(`Supporting: ${copy.supportingText}`);
    if (
      input.captionPack?.slideCount &&
      input.captionPack.slideCount >= 2 &&
      copy.source === 'caption_pack'
    ) {
      lines.push(
        `Carousel: ${input.captionPack.slideCount}-slide set` +
          (input.captionPack.variationSetId
            ? ` (${input.captionPack.variationSetId.slice(0, 8)})`
            : ''),
      );
    }
    lines.push('');
    lines.push('Caption:');
    lines.push(copy.caption || '(none)');
    lines.push('');
    if (copy.callToAction) lines.push(`CTA: ${copy.callToAction}`);
    if (copy.hashtags.length > 0) {
      lines.push(`Hashtags: ${formatHashtags(copy.hashtags)}`);
    }
    if (copy.altText) {
      lines.push('');
      lines.push('Alt text:');
      lines.push(copy.altText);
    }
    if (copy.researchSummary) {
      lines.push('');
      lines.push(`Caption notes: ${copy.researchSummary}`);
    }
    lines.push('');
  }

  lines.push('## Assets');
  input.assets.forEach((asset, index) => {
    const filename = `${String(index + 1).padStart(2, '0')}_${safeExportFilename(asset.name, `image_${index + 1}`)}.${extensionForMime(asset.mimeType)}`;
    lines.push(`### ${filename}`);
    lines.push(`Source: ${asset.source}`);
    if (asset.aspectRatio) lines.push(`Aspect: ${asset.aspectRatio}`);
    if (asset.carouselSetId) {
      lines.push(
        `Slide: ${asset.carouselSlideIndex ?? '?'} (${asset.carouselSetId.slice(0, 8)})${
          asset.carouselSlideTitle ? ` — ${asset.carouselSlideTitle}` : ''
        }`,
      );
    } else if (asset.variationSetId) {
      lines.push(`Variation: ${asset.variationIndex ?? '?'} (${asset.variationSetId.slice(0, 8)})`);
    }
    if (asset.brandCompliance) {
      lines.push(
        `Brand compliance: ${asset.brandCompliance.score}/100 (${asset.brandCompliance.status})`,
      );
      const unresolved = asset.brandCompliance.checks.filter(
        (check) => check.status !== 'pass',
      );
      if (unresolved.length > 0) {
        lines.push(
          `Compliance notes: ${unresolved
            .map((check) => `${check.label}: ${check.finding}`)
            .join(' | ')}`,
        );
      }
    }
    if (asset.generationPrompt) {
      lines.push('Prompt:');
      lines.push(asset.generationPrompt);
    }
    lines.push('');
  });

  return lines.join('\n');
}

export function buildRightsNotesText(input: ExportPackInput): string {
  const lines: string[] = [
    `# Usage & Rights Notes — ${input.brandName || 'Brand'}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Disclaimer',
    'Assets in this pack may include AI-generated imagery. Confirm trademark, likeness, and packaging accuracy before paid media.',
    '',
  ];

  if (input.brandKnowledge) {
    const k = input.brandKnowledge;
    lines.push('## Brand guidance');
    lines.push(`Brand: ${k.brandName.value}`);
    if (k.colors.length > 0) {
      lines.push(`Colors: ${k.colors.map((c) => c.value).join(', ')}`);
    }
    if (k.fonts.length > 0) {
      lines.push(
        `Fonts: ${k.fonts.map((f) => `${f.value.family} (${f.value.role})`).join(', ')}`,
      );
    }
    if (k.logoRules.length > 0) {
      lines.push('Logo rules:');
      k.logoRules.forEach((rule) => lines.push(`- ${rule.value}`));
    }
    if (k.prohibitedLanguage.length > 0) {
      lines.push(
        `Avoid language: ${k.prohibitedLanguage.map((p) => p.value).join(', ')}`,
      );
    }
    lines.push('');
  }

  if (input.productTruth) {
    lines.push('## Product truth');
    lines.push(`Product: ${input.productTruth.productName}`);
    input.productTruth.preservationRules.forEach((rule) =>
      lines.push(`- Preserve: ${rule}`),
    );
    lines.push('');
  }

  lines.push('## Deliverable sizes');
  lines.push(
    'Images are exported at the aspect ratio they were generated (or adapted) to.',
  );
  lines.push(
    'To create additional platform sizes, use Adapt format in the lightbox (Gemini reframe) — do not assume cropped duplicates.',
  );
  lines.push('Common Instagram targets:');
  CLIENT_PACK_SIZES.forEach((size) => {
    lines.push(`- ${size.label}`);
  });
  lines.push('');
  lines.push('Masters are included under images/.');

  return lines.join('\n');
}

export function buildBrandReportMarkdown(input: ExportPackInput): string {
  const lines: string[] = [
    `# Brand Report — ${input.brandName || 'Brand'}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    `Assets exported: ${input.assets.length}`,
    '',
  ];

  const groups = groupAssetsByVariationSet(input.assets);
  if (groups.size > 0) {
    lines.push('## Variation set scorecards');
    for (const [setId, setAssets] of groups) {
      const card = buildVariationSetScorecard(setAssets, setId);
      if (!card) continue;
      lines.push(`### Set ${setId.slice(0, 8)}`);
      lines.push(
        `- Avg score: ${card.averageScore ?? 'n/a'} · Pass/Warn/Fail: ${card.passCount}/${card.warningCount}/${card.failCount}`,
      );
      if (card.recommendedWinnerId) {
        const winner = setAssets.find((a) => a.id === card.recommendedWinnerId);
        lines.push(`- Recommended: ${winner?.name || card.recommendedWinnerId}`);
      }
      lines.push('');
    }
  }

  lines.push('## Asset compliance');
  input.assets.forEach((asset, index) => {
    lines.push(`### ${index + 1}. ${asset.name}`);
    if (!asset.brandCompliance) {
      lines.push('- Compliance: not evaluated');
    } else {
      lines.push(
        `- Score: ${asset.brandCompliance.score}/100 (${asset.brandCompliance.status})`,
      );
      lines.push(`- Summary: ${asset.brandCompliance.summary}`);
      asset.brandCompliance.checks
        .filter((c) => c.status !== 'pass')
        .forEach((c) => lines.push(`- ${c.label}: ${c.finding}`));
    }
    lines.push('');
  });

  if (input.socialPostDraft) {
    lines.push('## Social copy snapshot');
    lines.push(input.socialPostDraft.copy.caption || '(none)');
    lines.push('');
  }

  return lines.join('\n');
}

function assetFilename(asset: StudioAsset, index: number): string {
  return `${String(index + 1).padStart(2, '0')}_${safeExportFilename(asset.name, `image_${index + 1}`)}.${extensionForMime(asset.mimeType)}`;
}

/** Prefer raw base64; accept data-URL previewUrl as a fallback payload. */
export function resolveExportBase64(asset: StudioAsset): string {
  if (asset.base64) {
    if (asset.base64.startsWith('data:')) {
      const comma = asset.base64.indexOf(',');
      return comma >= 0 ? asset.base64.slice(comma + 1) : '';
    }
    return asset.base64;
  }
  if (asset.previewUrl?.startsWith('data:')) {
    const comma = asset.previewUrl.indexOf(',');
    return comma >= 0 ? asset.previewUrl.slice(comma + 1) : '';
  }
  return '';
}

export function buildExportZipEntries(input: ExportPackInput): ZipEntry[] {
  const exportable = input.assets.filter((asset) => resolveExportBase64(asset));
  if (exportable.length === 0) {
    throw new Error(
      'No exportable image data. Select images with downloaded payloads, or generate new ones first.',
    );
  }

  const entries: ZipEntry[] = [];

  if (input.clientPack) {
    exportable.forEach((asset, index) => {
      const name = assetFilename(asset, index);
      const bytes = base64ToUint8Array(resolveExportBase64(asset));
      // One master per asset at its real generated/adapted aspect — no duplicated size folders.
      entries.push({ path: `images/${name}`, data: bytes });
    });
    entries.push({
      path: 'rights-notes.txt',
      data: new TextEncoder().encode(buildRightsNotesText({ ...input, assets: exportable })),
    });
    entries.push({
      path: 'brand-report.md',
      data: new TextEncoder().encode(buildBrandReportMarkdown({ ...input, assets: exportable })),
    });
  } else {
    exportable.forEach((asset, index) => {
      entries.push({
        path: `images/${assetFilename(asset, index)}`,
        data: base64ToUint8Array(resolveExportBase64(asset)),
      });
    });
  }

  entries.push({
    path: 'captions.txt',
    data: new TextEncoder().encode(buildExportCaptionsText({ ...input, assets: exportable })),
  });

  return entries;
}

/**
 * Build and download a zip with images + captions/prompts for Instagram posting.
 */
export function downloadStudioExportPack(input: ExportPackInput): { fileCount: number } {
  const entries = buildExportZipEntries(input);
  const brandSlug = safeExportFilename(input.brandName || 'studio', 'studio').toLowerCase();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const suffix = input.clientPack ? 'client-pack' : 'instagram-pack';
  downloadBlob(buildZipBlob(entries), `${brandSlug}-${suffix}-${stamp}.zip`);
  return { fileCount: entries.length };
}

/** Alias for full client deliverable pack. */
export function downloadClientPack(input: ExportPackInput): { fileCount: number } {
  return downloadStudioExportPack({ ...input, clientPack: true });
}
