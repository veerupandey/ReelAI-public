import { afterEach, describe, expect, it, vi } from 'vitest';
import { bundledSkillCount, loadBundledSkills, skillMetaFromMarkdown } from '../services/bundledSkills';
import { clearSkillsCache, loadSkills } from '../services/toolRegistry';

describe('bundledSkills', () => {
  it('embeds project SKILL.md files via import.meta.glob', () => {
    expect(bundledSkillCount()).toBeGreaterThanOrEqual(10);
    const skills = loadBundledSkills();
    expect(skills.some((s) => s.id === 'product-research')).toBe(true);
    expect(skills.some((s) => s.id === 'video-assembly')).toBe(true);
    const product = skills.find((s) => s.id === 'product-research')!;
    expect(product.description.toLowerCase()).toContain('product');
    expect(product.content).toContain('# Product Research');
    expect(product.files).toContain('references.md');
  });

  it('parses YAML frontmatter like the shell /skills handler', () => {
    const meta = skillMetaFromMarkdown(
      'demo-skill',
      '---\nname: Demo Skill\ndescription: Does a thing\n---\n\n# Demo\n',
      ['notes.md'],
    );
    expect(meta).toEqual({
      id: 'demo-skill',
      name: 'Demo Skill',
      description: 'Does a thing',
      dir: 'demo-skill',
      files: ['notes.md'],
      content: '---\nname: Demo Skill\ndescription: Does a thing\n---\n\n# Demo\n',
    });
  });
});

describe('loadSkills offline fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearSkillsCache();
  });

  it('falls back to bundled skills when shell fetch fails', async () => {
    clearSkillsCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('shell offline');
      }),
    );

    const skills = await loadSkills();
    expect(skills.length).toBeGreaterThanOrEqual(10);
    expect(skills.some((s) => s.id === 'ad-copywriting')).toBe(true);
  });

  it('uses shell skills when the endpoint returns a non-empty list', async () => {
    clearSkillsCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          skills: [
            {
              id: 'dynamic-only',
              name: 'Dynamic',
              description: 'from shell',
              dir: 'dynamic-only',
              files: [],
              content: '# Dynamic',
            },
          ],
        }),
      })),
    );

    const skills = await loadSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe('dynamic-only');
  });
});
