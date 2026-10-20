import { describe, it, expect } from 'vitest';
import {
  inferStudioOperation,
  getPrimaryActionLabel,
} from '../../components/AIImageStudio/studioOperation';
import type { ComposerReference, StudioDocument } from '../../components/AIImageStudio/types';

function makeDoc(): StudioDocument {
  return {
    id: 'doc-1',
    rootAssetId: 'asset-1',
    activeVersionId: 'v-1',
    versionIds: ['v-1'],
  };
}

function makeRef(assetId: string, role: ComposerReference['role']): ComposerReference {
  return { assetId, role };
}

describe('inferStudioOperation', () => {
  describe('generate (default)', () => {
    it('returns generate when no active document and no references', () => {
      expect(inferStudioOperation({ composerReferences: [] })).toBe('generate');
    });

    it('returns generate with only one include reference', () => {
      expect(
        inferStudioOperation({ composerReferences: [makeRef('a1', 'include')] }),
      ).toBe('generate');
    });

    it('returns generate with product and style references but no include', () => {
      expect(
        inferStudioOperation({
          composerReferences: [makeRef('a1', 'product'), makeRef('a2', 'style')],
        }),
      ).toBe('generate');
    });

    it('returns generate with composition references only', () => {
      expect(
        inferStudioOperation({
          composerReferences: [makeRef('a1', 'composition'), makeRef('a2', 'composition')],
        }),
      ).toBe('generate');
    });
  });

  describe('edit', () => {
    it('returns edit when an active document is present', () => {
      expect(
        inferStudioOperation({ activeDocument: makeDoc(), composerReferences: [] }),
      ).toBe('edit');
    });

    it('returns edit even when there are include references if a document is active', () => {
      expect(
        inferStudioOperation({
          activeDocument: makeDoc(),
          composerReferences: [makeRef('a1', 'include'), makeRef('a2', 'include')],
        }),
      ).toBe('edit');
    });
  });

  describe('composite', () => {
    it('returns composite when there are two include references and no active document', () => {
      expect(
        inferStudioOperation({
          composerReferences: [makeRef('a1', 'include'), makeRef('a2', 'include')],
        }),
      ).toBe('composite');
    });

    it('returns composite with three include references', () => {
      expect(
        inferStudioOperation({
          composerReferences: [
            makeRef('a1', 'include'),
            makeRef('a2', 'include'),
            makeRef('a3', 'include'),
          ],
        }),
      ).toBe('composite');
    });

    it('does not count product references toward composite threshold', () => {
      expect(
        inferStudioOperation({
          composerReferences: [makeRef('a1', 'product'), makeRef('a2', 'include')],
        }),
      ).toBe('generate');
    });

    it('does not count style references toward composite threshold', () => {
      expect(
        inferStudioOperation({
          composerReferences: [makeRef('a1', 'style'), makeRef('a2', 'style')],
        }),
      ).toBe('generate');
    });
  });
});

describe('getPrimaryActionLabel', () => {
  it('returns "Create image" for generate', () => {
    expect(getPrimaryActionLabel('generate')).toBe('Create image');
  });

  it('returns "Apply edit" for edit', () => {
    expect(getPrimaryActionLabel('edit')).toBe('Apply edit');
  });

  it('returns "Create composite" for composite', () => {
    expect(getPrimaryActionLabel('composite')).toBe('Create composite');
  });
});
