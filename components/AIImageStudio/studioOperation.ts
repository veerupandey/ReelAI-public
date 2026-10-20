/**
 * Pure operation inference for the AI Image Studio.
 * Derives the appropriate generation strategy from the current session state
 * without any side effects.
 */

import type { ComposerReference, StudioDocument, StudioOperation } from './types';

export interface OperationContext {
  activeDocument?: StudioDocument;
  composerReferences: ComposerReference[];
}

/**
 * Infers the primary studio operation from explicit session state:
 *
 * - edit:      an active document is open
 * - composite: two or more `include` references are attached (no active document)
 * - generate:  no active document and fewer than two `include` references
 *
 * Style and composition references never affect the inferred operation.
 */
export function inferStudioOperation(ctx: OperationContext): StudioOperation {
  if (ctx.activeDocument) {
    return 'edit';
  }

  const includeRefs = ctx.composerReferences.filter((r) => r.role === 'include');
  if (includeRefs.length >= 2) {
    return 'composite';
  }

  return 'generate';
}

/**
 * Returns a human-readable primary action label for the inferred operation.
 */
export function getPrimaryActionLabel(operation: StudioOperation): string {
  switch (operation) {
    case 'edit':
      return 'Apply edit';
    case 'composite':
      return 'Create composite';
    case 'generate':
      return 'Create image';
  }
}
