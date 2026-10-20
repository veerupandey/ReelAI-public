import { describe, expect, it } from 'vitest';
import {
  assignCreativeReferences,
  classifyCreativeReferenceFallback,
  resolveSceneVisualMode,
  type CreativeReference,
} from '../services/creativeReferenceDirector';

const ref = (id: string, role: CreativeReference['role'], note = ''): CreativeReference => ({
  id, name: `${id}.png`, base64: id, mimeType: 'image/png', note, role,
  description: note || role, preserve: [], avoid: [], confidence: .8,
});

describe('creativeReferenceDirector', () => {
  it('classifies explicit avoid and composition references from user direction', () => {
    expect(classifyCreativeReferenceFallback('bad-example.png', 'avoid this visual direction').role).toBe('avoid_reference');
    expect(classifyCreativeReferenceFallback('overhead-shot.png', 'use this camera angle and layout').role).toBe('composition_reference');
  });

  it('assigns at most two uploaded references and excludes avoid references', () => {
    const assignments = assignCreativeReferences(
      [{ index: 0, role: 'ritual', imagePrompt: 'Overhead preparation ritual', useProductAsReference: true }],
      [
        ref('product', 'product_identity'),
        ref('style', 'style_reference'),
        ref('composition', 'composition_reference', 'overhead preparation'),
        ref('avoid', 'avoid_reference', 'do not use'),
      ],
    );

    expect(assignments[0].references).toHaveLength(2);
    expect(assignments[0].references.map((item) => item.id)).not.toContain('avoid');
    expect(assignments[0].avoidConstraints).toContain('do not use');
  });

  it('prefers composition and lifestyle references for ritual scenes', () => {
    const assignments = assignCreativeReferences(
      [{ index: 1, role: 'ritual', imagePrompt: 'Person preparing matcha', useProductAsReference: false }],
      [ref('brand', 'brand_identity'), ref('composition', 'composition_reference'), ref('lifestyle', 'lifestyle_reference')],
    );

    expect(assignments[0].references.map((item) => item.id)).toEqual(['lifestyle', 'composition']);
  });

  it('does not assign product identity to a generated-fresh supporting slide', () => {
    const assignments = assignCreativeReferences(
      [{ index: 1, role: 'ritual', imagePrompt: 'Whisked matcha texture', useProductAsReference: false, visualMode: 'generated_fresh' }],
      [ref('product', 'product_identity'), ref('style', 'style_reference')],
    );
    expect(assignments[0].references.map((item) => item.id)).toEqual(['style']);
  });

  it('locks exact product heroes and composites product usage scenes', () => {
    expect(resolveSceneVisualMode({ index: 0, role: 'hook', imagePrompt: 'Exact product hero packshot', useProductAsReference: true })).toBe('product_locked');
    expect(resolveSceneVisualMode({ index: 1, role: 'ritual', imagePrompt: 'Morning preparation scene', useProductAsReference: true })).toBe('product_composite');
  });
});
