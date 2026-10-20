/**
 * Bridges legacy RoleAssignmentSheet roles with ComposerReference roles.
 */

import type {
  ComposerReference,
  ComposerReferenceRole,
  ReferenceRole,
  RoleAssignment,
} from './types';

export function referenceRoleToComposer(role: ReferenceRole): ComposerReferenceRole {
  switch (role) {
    case 'product':
      return 'product';
    case 'person':
    case 'environment':
      return 'include';
    case 'style_guide':
      return 'style';
  }
}

export function composerRoleToReference(role: ComposerReferenceRole): ReferenceRole {
  switch (role) {
    case 'product':
      return 'product';
    case 'include':
      return 'person';
    case 'style':
    case 'composition':
      return 'style_guide';
  }
}

export function roleAssignmentToInstructions(assignment: RoleAssignment): string | undefined {
  const parts = [
    assignment.preserve && `Preserve: ${assignment.preserve}`,
    assignment.modify && `Modify: ${assignment.modify}`,
  ].filter(Boolean) as string[];

  if (parts.length === 0) return undefined;
  return parts.join('. ').slice(0, 200);
}

export function seedRoleAssignment(
  assetId: string,
  composerReferences: ComposerReference[],
  roleAssignments: Map<string, RoleAssignment>,
): RoleAssignment {
  const legacy = roleAssignments.get(assetId);
  if (legacy) return legacy;

  const composer = composerReferences.find((r) => r.assetId === assetId);
  if (composer) {
    return { role: composerRoleToReference(composer.role) };
  }

  return { role: 'product' };
}
