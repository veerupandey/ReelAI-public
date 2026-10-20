/**
 * Production Brief Service — Phase 3 Implementation
 *
 * Converts a selected concept into an inspectable, ready-to-generate
 * production brief per architecture spec.
 */

import type {
  CreativeConcept,
  BrandKnowledge,
  TrendResearchResult,
  ProductTruth,
  ComposerReference,
  AspectRatio,
  StrategistBrief,
} from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProductionBrief {
  /** Human-readable brief summary */
  summary: string;
  /** Detailed generation prompt */
  generationPrompt: string;
  /** What must be preserved (highest priority) */
  preservationInstructions: string[];
  /** Suggested reference roles with instructions */
  referenceRoles: ReferenceRoleInstruction[];
  /** Aspect ratio recommendation */
  recommendedAspectRatio: AspectRatio;
  /** Negative prompts / things to avoid */
  avoidList: string[];
  /** Source of each element */
  provenance: BriefProvenance;
}

export interface ReferenceRoleInstruction {
  assetId: string;
  role: ComposerReference['role'];
  priority: 1 | 2 | 3; // 1 = highest (Product Truth), 2 = concept, 3 = trend
  instruction: string;
  source: 'product_truth' | 'concept' | 'trend' | 'brand' | 'user';
}

export interface BriefProvenance {
  preservationFrom: string;
  conceptFrom: string;
  brandElementsFrom?: string;
  trendElementsFrom?: string;
  userDirectionFrom?: string;
}

export interface BriefGenerationInput {
  selectedConcept: CreativeConcept;
  brandKnowledge?: BrandKnowledge;
  trendResearch?: TrendResearchResult;
  productTruth?: ProductTruth;
  /** Optional strategist synthesis — execution mode + preservation feed the brief */
  strategistBrief?: Pick<
    StrategistBrief,
    'executionMode' | 'preservationPriorities' | 'summary' | 'constraints'
  >;
  userDirection: string;
  availableReferences: ComposerReference[];
  preferredAspectRatio?: AspectRatio;
}

// ---------------------------------------------------------------------------
// Brief Generation
// ---------------------------------------------------------------------------

export function generateProductionBrief(
  input: BriefGenerationInput,
): ProductionBrief {
  const provenance: BriefProvenance = {
    preservationFrom: 'Product Truth',
    conceptFrom: `Selected concept: ${input.selectedConcept.title}`,
  };

  // 1. Build preservation instructions (Priority 1: Product Truth + strategist)
  const preservationInstructions = buildPreservationInstructions(
    input.productTruth,
    input.strategistBrief,
  );

  // 2. Build reference role instructions with priority
  const referenceRoles = buildReferenceRoleInstructions(input);

  // 3. Build generation prompt with precedence
  const generationPrompt = buildGenerationPrompt(input, preservationInstructions);

  // 4. Build avoid list from contradictions
  const avoidList = buildAvoidList(input);

  // 5. Determine recommended aspect ratio
  const recommendedAspectRatio = input.preferredAspectRatio ?? '9:16';

  // 6. Build human-readable summary (includes execution mode when strategist present)
  const summary = buildSummary(input, preservationInstructions.length, referenceRoles.length);

  // Track provenance
  if (input.brandKnowledge) {
    provenance.brandElementsFrom = `Brand Knowledge: ${input.brandKnowledge.brandName.value}`;
  }
  if (input.trendResearch) {
    provenance.trendElementsFrom = `Trend Research: ${input.trendResearch.insights.length} insights`;
  }
  if (input.userDirection.trim()) {
    provenance.userDirectionFrom = `User direction: "${input.userDirection.slice(0, 50)}..."`;
  }

  return {
    summary,
    generationPrompt,
    preservationInstructions,
    referenceRoles,
    recommendedAspectRatio,
    avoidList,
    provenance,
  };
}

// ---------------------------------------------------------------------------
// Component Builders
// ---------------------------------------------------------------------------

function buildPreservationInstructions(
  productTruth?: ProductTruth,
  strategistBrief?: BriefGenerationInput['strategistBrief'],
): string[] {
  const instructions: string[] = [];
  const seen = new Set<string>();

  const pushUnique = (line: string) => {
    const key = line
      .replace(/^(CRITICAL|MUST SHOW|CORRECTED|STRATEGIST):\s*/i, '')
      .trim()
      .toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    instructions.push(line);
  };

  if (productTruth) {
    for (const rule of productTruth.preservationRules) {
      pushUnique(`CRITICAL: ${rule}`);
    }
    for (const fact of productTruth.verifiedFacts) {
      pushUnique(`MUST SHOW: ${fact}`);
    }
    for (const correction of productTruth.userCorrections) {
      pushUnique(`CORRECTED: ${correction}`);
    }
  } else {
    pushUnique('Preserve product identity, packaging, labels, and proportions');
  }

  if (strategistBrief?.preservationPriorities?.length) {
    for (const priority of strategistBrief.preservationPriorities) {
      pushUnique(`STRATEGIST: ${priority}`);
    }
  }

  return instructions;
}

function buildReferenceRoleInstructions(
  input: BriefGenerationInput,
): ReferenceRoleInstruction[] {
  const instructions: ReferenceRoleInstruction[] = [];
  const { selectedConcept, productTruth, availableReferences, userDirection } = input;

  for (const ref of availableReferences) {
    let priority: ReferenceRoleInstruction['priority'] = 2;
    let instruction: string;
    let source: ReferenceRoleInstruction['source'];

    // Priority 1: Product Truth protected references
    if (ref.role === 'product' && productTruth) {
      priority = 1;
      source = 'product_truth';
      instruction = productTruth.preservationRules[0] ?? 'Preserve exact product identity';
      if (productTruth.verifiedFacts.length > 0) {
        instruction += `. Show: ${productTruth.verifiedFacts[0]}`;
      }
    }
    // Priority 2: User direction and concept
    else if (userDirection.trim()) {
      priority = 2;
      source = 'user';
      instruction = `Use as ${ref.role} per user direction: ${userDirection.slice(0, 100)}`;

      // Add concept-specific guidance
      if (selectedConcept.suggestedReferenceRoles.find(r => r.assetId === ref.assetId)) {
        const conceptRef = selectedConcept.suggestedReferenceRoles.find(r => r.assetId === ref.assetId);
        if (conceptRef?.instructions) {
          instruction += `. Concept guidance: ${conceptRef.instructions}`;
          source = 'concept';
        }
      }
    }
    // Priority 3: Trend and brand style
    else {
      priority = 3;
      source = 'trend';
      instruction = `Use as ${ref.role} with trend-compatible styling`;
    }

    instructions.push({
      assetId: ref.assetId,
      role: ref.role,
      priority,
      instruction,
      source,
    });
  }

  return instructions;
}

function buildGenerationPrompt(
  input: BriefGenerationInput,
  preservationInstructions: string[],
): string {
  const parts: string[] = [];
  const { selectedConcept, brandKnowledge, trendResearch, userDirection, strategistBrief } = input;

  // 1. Product Truth preservation (highest priority)
  if (preservationInstructions.length > 0) {
    parts.push('PRESERVATION REQUIREMENTS (MUST FOLLOW):');
    for (const instruction of preservationInstructions) {
      parts.push(`- ${instruction}`);
    }
  }

  if (strategistBrief) {
    parts.push('\nSTRATEGIST CONTEXT:');
    parts.push(`Execution mode: ${strategistBrief.executionMode}`);
    if (strategistBrief.summary.trim()) {
      parts.push(`Brief: ${strategistBrief.summary}`);
    }
    if (strategistBrief.constraints?.length) {
      parts.push(`Constraints: ${strategistBrief.constraints.join('; ')}`);
    }
  }

  // 2. User direction
  if (userDirection.trim()) {
    parts.push('\nUSER CREATIVE DIRECTION:');
    parts.push(userDirection);
  }

  // 3. Selected concept
  parts.push('\nSELECTED CONCEPT:');
  parts.push(`Title: ${selectedConcept.title}`);
  parts.push(`Visual Direction: ${selectedConcept.visualDirection}`);
  if (selectedConcept.hook) {
    parts.push(`Hook: ${selectedConcept.hook}`);
  }

  // 4. Brand knowledge
  if (brandKnowledge) {
    parts.push('\nBRAND GUIDANCE:');
    parts.push(`Brand: ${brandKnowledge.brandName.value}`);

    if (brandKnowledge.toneAttributes.length > 0) {
      const tones = brandKnowledge.toneAttributes
        .filter(t => t.status !== 'rejected')
        .map(t => t.value)
        .join(', ');
      if (tones) parts.push(`Tone: ${tones}`);
    }

    if (brandKnowledge.visualPrinciples.length > 0) {
      const principles = brandKnowledge.visualPrinciples
        .filter(p => p.status !== 'rejected')
        .map(p => p.value)
        .join(', ');
      if (principles) parts.push(`Visual: ${principles}`);
    }

    if (brandKnowledge.colors.length > 0) {
      const colors = brandKnowledge.colors
        .filter(c => c.status !== 'rejected')
        .slice(0, 3)
        .map(c => c.value)
        .join(', ');
      if (colors) parts.push(`Colors: ${colors}`);
    }
  }

  // 5. Trend research
  if (trendResearch && selectedConcept.sourceTrendInsightIds.length > 0) {
    const relevantInsights = trendResearch.insights.filter(i =>
      selectedConcept.sourceTrendInsightIds.includes(i.id)
    );

    if (relevantInsights.length > 0) {
      parts.push('\nTREND INSIGHTS:');
      for (const insight of relevantInsights) {
        parts.push(`- ${insight.title}: ${insight.description}`);
        if (insight.applicability) {
          parts.push(`  Applicability: ${insight.applicability}`);
        }
      }
    }
  }

  // 6. Concept rationale
  if (selectedConcept.brandFitRationale || selectedConcept.trendFitRationale) {
    parts.push('\nRATIONALE:');
    if (selectedConcept.brandFitRationale) {
      parts.push(`Brand fit: ${selectedConcept.brandFitRationale}`);
    }
    if (selectedConcept.trendFitRationale) {
      parts.push(`Trend fit: ${selectedConcept.trendFitRationale}`);
    }
  }

  // 7. Product truth notes
  if (selectedConcept.productTruthNotes.length > 0) {
    parts.push('\nPRODUCT NOTES:');
    for (const note of selectedConcept.productTruthNotes) {
      parts.push(`- ${note}`);
    }
  }

  return parts.join('\n');
}

function buildAvoidList(input: BriefGenerationInput): string[] {
  const avoidList: string[] = [];
  const { productTruth, brandKnowledge, strategistBrief } = input;

  // From prohibited language in brand knowledge
  if (brandKnowledge?.prohibitedLanguage.length) {
    for (const prohibited of brandKnowledge.prohibitedLanguage) {
      if (prohibited.status !== 'rejected') {
        avoidList.push(`Avoid language: "${prohibited.value}"`);
      }
    }
  }

  // From Product Truth contradictions
  if (productTruth?.unresolvedQuestions.length) {
    for (const question of productTruth.unresolvedQuestions) {
      avoidList.push(`Avoid uncertain claims: "${question}"`);
    }
  }

  if (strategistBrief?.constraints?.length) {
    for (const constraint of strategistBrief.constraints) {
      avoidList.push(`Honor constraint: ${constraint}`);
    }
  }

  // Standard avoid list
  avoidList.push('Avoid generic stock photo aesthetic');
  avoidList.push('Avoid text overlays unless specified');

  return avoidList;
}

function buildSummary(
  input: BriefGenerationInput,
  preservationCount: number,
  referenceCount: number,
): string {
  const { selectedConcept, brandKnowledge, trendResearch, strategistBrief } = input;

  const parts: string[] = [];

  // Core concept
  parts.push(`Production brief for "${selectedConcept.title}"`);

  if (strategistBrief?.executionMode) {
    parts.push(`Mode: ${strategistBrief.executionMode}`);
  }

  // Key hook
  if (selectedConcept.hook) {
    parts.push(`Hook: "${selectedConcept.hook.slice(0, 80)}..."`);
  }

  // Constraints count
  parts.push(`${preservationCount} preservation rules, ${referenceCount} reference roles`);

  // Knowledge sources
  const sources: string[] = [];
  if (brandKnowledge) sources.push('Brand Knowledge');
  if (trendResearch) sources.push('Trend Research');
  if (strategistBrief) sources.push('Strategist Brief');
  sources.push('Product Truth');

  parts.push(`Sources: ${sources.join(', ')}`);

  return parts.join(' | ');
}

// ---------------------------------------------------------------------------
// Brief Validation
// ---------------------------------------------------------------------------

export interface BriefValidationResult {
  valid: boolean;
  issues: string[];
  warnings: string[];
}

export function validateProductionBrief(brief: ProductionBrief): BriefValidationResult {
  const issues: string[] = [];
  const warnings: string[] = [];

  // Must have preservation instructions
  if (brief.preservationInstructions.length === 0) {
    warnings.push('No preservation instructions - generation may alter product identity');
  }

  // Generation prompt must not be empty
  if (!brief.generationPrompt.trim()) {
    issues.push('Generation prompt is empty');
  }

  // Check for Product Truth in preservation
  const hasProductTruth = brief.preservationInstructions.some(i =>
    i.toLowerCase().includes('critical') || i.toLowerCase().includes('must show')
  );

  if (!hasProductTruth) {
    warnings.push('No explicit Product Truth constraints in preservation');
  }

  // Check reference role priorities
  const hasPriority1 = brief.referenceRoles.some(r => r.priority === 1);
  if (!hasPriority1 && brief.referenceRoles.length > 0) {
    warnings.push('No Priority 1 (Product Truth) reference roles assigned');
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Export Helpers
// ---------------------------------------------------------------------------

/**
 * Format brief for display in UI.
 */
export function formatBriefForDisplay(brief: ProductionBrief): string {
  return brief.generationPrompt;
}

/**
 * Get brief statistics for debugging.
 */
export function getBriefStats(brief: ProductionBrief): {
  preservationCount: number;
  referenceCount: number;
  promptLength: number;
  priority1Count: number;
} {
  return {
    preservationCount: brief.preservationInstructions.length,
    referenceCount: brief.referenceRoles.length,
    promptLength: brief.generationPrompt.length,
    priority1Count: brief.referenceRoles.filter(r => r.priority === 1).length,
  };
}
