import { describe, expect, it } from 'vitest';
import {
  appendProductPhotoRealism,
  PRODUCT_PHOTO_REALISM_PLANNER_RULE,
  PRODUCT_PHOTO_REALISM_REVIEW_RULES,
} from '../services/productPhotoRealism';

describe('appendProductPhotoRealism', () => {
  it('appends photography realism block to prompts', () => {
    const out = appendProductPhotoRealism('Macro of matcha tin in soft window light');
    expect(out).toContain('Macro of matcha tin');
    expect(out).toMatch(/PHOTOGRAPHY REALISM/i);
    expect(out).toMatch(/real product photography/i);
    expect(out).toMatch(/CGI|fake HDR|oversmooth/i);
  });

  it('does not double-append when already present', () => {
    const once = appendProductPhotoRealism('packshot');
    const twice = appendProductPhotoRealism(once);
    expect(twice.match(/PHOTOGRAPHY REALISM/gi)?.length).toBe(1);
  });

  it('exports planner and review rule strings', () => {
    expect(PRODUCT_PHOTO_REALISM_PLANNER_RULE).toMatch(/PHOTOGRAPHY REALISM/);
    expect(PRODUCT_PHOTO_REALISM_PLANNER_RULE).toMatch(/HAND \+ PHYSICS SAFETY|PHOTOGRAPHABLE ACTIONS/i);
    expect(PRODUCT_PHOTO_REALISM_REVIEW_RULES).toMatch(/real product photography/i);
    expect(PRODUCT_PHOTO_REALISM_REVIEW_RULES).toMatch(/PHYSICS|floating foam/i);
  });

  it('includes anti-impossible-physics negatives', () => {
    const out = appendProductPhotoRealism('Matcha whisk in ceramic bowl');
    expect(out).toMatch(/floating foam|cream bridges|impossible physics/i);
  });
});
