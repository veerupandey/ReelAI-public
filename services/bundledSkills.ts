/**
 * Offline / Vite-bundled skill loader.
 *
 * Prefer the live shell `/skills` endpoint when available (includes dynamic
 * session skills). When the shell is down or returns nothing, fall back to
 * SKILL.md files shipped under skills/ via import.meta.glob.
 */

import type { SkillMeta } from './toolRegistry';

const SKILL_MD_MODULES = import.meta.glob('../skills/*/SKILL.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Paths of all files under skills/<id>/ (used for the `files` list). */
const SKILL_FILE_PATHS = Object.keys(
  import.meta.glob('../skills/*/*', { eager: true }),
);

function skillIdFromPath(modulePath: string): string | null {
  const match = modulePath.match(/\/skills\/([^/]+)\//);
  return match?.[1] ?? null;
}

function parseSkillFrontmatter(raw: string): { name?: string; description?: string } {
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return {};
  const frontmatter: Record<string, string> = {};
  for (const line of fmMatch[1].split('\n')) {
    const m = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (m) frontmatter[m[1]] = m[2].trim();
  }
  return {
    name: frontmatter.name,
    description: frontmatter.description,
  };
}

function supportingFilesByDir(): Map<string, string[]> {
  const byDir = new Map<string, string[]>();
  for (const filePath of SKILL_FILE_PATHS) {
    const id = skillIdFromPath(filePath);
    if (!id) continue;
    const base = filePath.split('/').pop();
    if (!base || base === 'SKILL.md') continue;
    const list = byDir.get(id) ?? [];
    list.push(base);
    byDir.set(id, list);
  }
  return byDir;
}

/** Parse SKILL.md content into SkillMeta (same shape as shell /skills). */
export function skillMetaFromMarkdown(id: string, raw: string, files: string[] = []): SkillMeta {
  const fm = parseSkillFrontmatter(raw);
  return {
    id,
    name: fm.name || id,
    description: fm.description || '',
    dir: id,
    files,
    content: raw,
  };
}

/** Skills embedded in the web bundle — works without agent-shell :3721. */
export function loadBundledSkills(): SkillMeta[] {
  const support = supportingFilesByDir();
  const skills: SkillMeta[] = [];

  for (const [modulePath, raw] of Object.entries(SKILL_MD_MODULES)) {
    const id = skillIdFromPath(modulePath);
    if (!id || typeof raw !== 'string') continue;
    skills.push(skillMetaFromMarkdown(id, raw, support.get(id) ?? []));
  }

  return skills.sort((a, b) => a.id.localeCompare(b.id));
}

export function bundledSkillCount(): number {
  return Object.keys(SKILL_MD_MODULES).length;
}
