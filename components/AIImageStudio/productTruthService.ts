/**
 * productTruthService — converts product images and page signal summaries into
 * a typed ProductTruth record with preservation rules, verified facts,
 * unresolved questions, and user corrections.
 *
 * The service is intentionally conservative: it only asserts what the evidence
 * supports and surfaces uncertainty explicitly rather than inventing facts.
 */

import type { StudioAsset, ProductTruth } from './types';
import {
  analyzeCreativeReferences,
  type CreativeReferenceUpload,
} from '../../services/creativeReferenceDirector';

/** Signals extracted from a product page import */
export interface ProductPageSignals {
  productName?: string;
  description?: string;
  ingredients?: string[];
  claims?: string[];
  benefits?: string[];
}

/** Options controlling Product Truth analysis */
export interface AnalyzeProductTruthOptions {
  productAssets: StudioAsset[];
  signals?: ProductPageSignals;
}

/** True when a label looks like an upload filename / slug, not a product title. */
export function isFilenameLikeProductName(value?: string | null): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/\.(jpe?g|png|gif|webp|heic|avif|bmp|svg)$/i.test(trimmed)) return true;
  if (/^[a-z0-9]+(?:-[a-z0-9]+){3,}$/i.test(trimmed) && !/\s/.test(trimmed)) return true;
  return false;
}

function resolveProductName(
  productAssets: StudioAsset[],
  signals?: ProductPageSignals,
): string {
  if (signals?.productName && !isFilenameLikeProductName(signals.productName)) {
    return signals.productName.trim();
  }
  const assetName = productAssets[0]?.name;
  if (assetName && !isFilenameLikeProductName(assetName)) {
    return assetName.trim();
  }
  return 'Unknown product';
}

/** Minimum confidence level required for a fact to be added to verifiedFacts */
const MIN_FACT_CONFIDENCE = 0.7;

/**
 * Builds a ProductTruth from product assets and optional page signals.
 *
 * Steps:
 * 1. Use analyzeCreativeReferences on the product images to extract visual facts.
 * 2. Merge with signal-derived facts from the product page.
 * 3. Produce preservation rules, verified facts, and unresolved questions.
 * 4. Return with empty userCorrections (applied by the user later).
 */
export async function analyzeProductTruth(
  options: AnalyzeProductTruthOptions,
): Promise<ProductTruth> {
  const { productAssets, signals } = options;

  const id = crypto.randomUUID();

  // Derive product name from signals — never from raw upload filenames.
  const productName = resolveProductName(productAssets, signals);

  const preservationRules: string[] = [];
  const verifiedFacts: string[] = [];
  const unresolvedQuestions: string[] = [];

  // --- Signal-derived facts (high confidence from structured data) ---
  if (signals?.productName && !isFilenameLikeProductName(signals.productName)) {
    verifiedFacts.push(`Product name: ${signals.productName}`);
    preservationRules.push(`Preserve the "${signals.productName}" name and branding`);
  }

  if (signals?.claims && signals.claims.length > 0) {
    for (const claim of signals.claims.slice(0, 5)) {
      verifiedFacts.push(`Claim: ${claim}`);
    }
  }

  if (signals?.benefits && signals.benefits.length > 0) {
    for (const benefit of signals.benefits.slice(0, 3)) {
      verifiedFacts.push(`Benefit: ${benefit}`);
    }
  }

  // --- Visual analysis from product images ---
  if (productAssets.length > 0) {
    try {
      const uploads: CreativeReferenceUpload[] = productAssets.slice(0, 4).map((a) => ({
        id: a.id,
        name: a.name,
        base64: a.base64,
        mimeType: a.mimeType,
        note: 'product image',
      }));

      const references = await analyzeCreativeReferences(uploads);

      for (const ref of references) {
        if (ref.role === 'product_identity' || ref.role === 'brand_identity') {
          preservationRules.push(`Preserve: ${ref.description}`);
          verifiedFacts.push(`Detected: ${ref.description}`);
        }
        if (ref.preserve && ref.preserve.length > 0) {
          for (const rule of ref.preserve) {
            const entry = `Preserve ${rule}`;
            if (!preservationRules.includes(entry)) {
              preservationRules.push(entry);
            }
          }
        }
        if (ref.avoid && ref.avoid.length > 0) {
          for (const avoidance of ref.avoid) {
            unresolvedQuestions.push(`Confirm: avoid changing ${avoidance}`);
          }
        }
      }
    } catch {
      unresolvedQuestions.push(
        'Visual analysis failed — preservation rules are based on page signals only.',
      );
    }
  }

  // --- Unresolved questions for multi-asset scenarios ---
  if (productAssets.length > 1) {
    unresolvedQuestions.push(
      `Confirm whether all ${productAssets.length} product variants should appear together in the same image.`,
    );
  }

  if (preservationRules.length === 0) {
    unresolvedQuestions.push(
      'No visual preservation rules could be detected. Consider adding product image URLs or images.',
    );
  }

  return {
    id,
    productName,
    protectedAssetIds: productAssets.map((a) => a.id),
    preservationRules,
    verifiedFacts,
    unresolvedQuestions,
    userCorrections: [],
  };
}

/**
 * Creates a minimal ProductTruth synchronously from assets and optional signals
 * without calling the AI, suitable as a quick initial state while analysis runs.
 */
export function buildPreliminaryProductTruth(
  productAssets: StudioAsset[],
  signals?: ProductPageSignals,
): ProductTruth {
  const productName = resolveProductName(productAssets, signals);

  const preservationRules: string[] = [
    `Preserve the identity and appearance of ${productName}`,
  ];

  const verifiedFacts: string[] = [];
  if (signals?.productName && !isFilenameLikeProductName(signals.productName)) {
    verifiedFacts.push(`Product name: ${signals.productName}`);
  }
  if (signals?.claims) {
    verifiedFacts.push(...signals.claims.slice(0, 3).map((c) => `Claim: ${c}`));
  }

  return {
    id: crypto.randomUUID(),
    productName,
    protectedAssetIds: productAssets.map((a) => a.id),
    preservationRules,
    verifiedFacts,
    unresolvedQuestions: ['Full visual analysis in progress…'],
    userCorrections: [],
  };
}
