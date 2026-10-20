import { describe, expect, it } from 'vitest';
import {
  composerRoleToReference,
  referenceRoleToComposer,
  roleAssignmentToInstructions,
  seedRoleAssignment,
} from '../../components/AIImageStudio/referenceRoleMapping';
import type { RoleAssignment } from '../../components/AIImageStudio/types';

describe('referenceRoleMapping', () => {
  it('maps legacy and composer roles in both directions', () => {
    expect(referenceRoleToComposer('product')).toBe('product');
    expect(referenceRoleToComposer('person')).toBe('include');
    expect(referenceRoleToComposer('environment')).toBe('include');
    expect(referenceRoleToComposer('style_guide')).toBe('style');

    expect(composerRoleToReference('product')).toBe('product');
    expect(composerRoleToReference('include')).toBe('person');
    expect(composerRoleToReference('style')).toBe('style_guide');
    expect(composerRoleToReference('composition')).toBe('style_guide');
  });

  it('builds instructions from preserve/modify fields', () => {
    expect(
      roleAssignmentToInstructions({
        role: 'product',
        preserve: 'label',
        modify: 'background',
      }),
    ).toBe('Preserve: label. Modify: background');
    expect(roleAssignmentToInstructions({ role: 'style_guide' })).toBeUndefined();
  });

  it('seeds from legacy map then composer references then product default', () => {
    const legacy = new Map<string, RoleAssignment>([
      ['a', { role: 'style_guide', preserve: 'palette' }],
    ]);
    expect(seedRoleAssignment('a', [], legacy)).toEqual({
      role: 'style_guide',
      preserve: 'palette',
    });
    expect(
      seedRoleAssignment('b', [{ assetId: 'b', role: 'include' }], new Map()),
    ).toEqual({ role: 'person' });
    expect(seedRoleAssignment('c', [], new Map())).toEqual({ role: 'product' });
  });
});
