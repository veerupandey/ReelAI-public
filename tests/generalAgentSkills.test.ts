import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  selectContractSkillsForGoal,
  selectDiskSkillsForGoal,
  selectSkillsForWorker,
} from '../services/generalAgentSkills';

vi.mock('../services/toolRegistry', () => ({
  loadSkills: vi.fn(async () => [
    { id: 'product-research', name: 'Product Research', description: 'd', content: '# Product research' },
    { id: 'trend-analysis', name: 'Trend Analysis', description: 'd', content: '# Trends' },
    { id: 'ad-copywriting', name: 'Ad Copywriting', description: 'd', content: '# Copy' },
    { id: 'video-assembly', name: 'Video Assembly', description: 'd', content: '# Video' },
    { id: 'creative-review', name: 'Creative Review', description: 'd', content: '# Review' },
  ]),
  formatSkillsForPrompt: vi.fn(async (ids?: string[]) =>
    `SKILL CONTEXT:\n${(ids || []).join(',')}`,
  ),
}));

describe('generalAgentSkills routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes competitor goals to competitor + research contract skills', () => {
    const ids = selectContractSkillsForGoal('Research 3 competitors for ceremonial matcha ads');
    expect(ids).toContain('competitor_ad_analysis');
    expect(ids).toContain('research_methodology');
  });

  it('routes video assembly goals to video disk skills', () => {
    const ids = selectDiskSkillsForGoal('Inspect MP4 files and assemble a video with ffmpeg', {
      available: ['video-assembly', 'platform-export', 'voiceover-production', 'product-research'],
    });
    expect(ids).toContain('video-assembly');
    expect(ids.indexOf('video-assembly')).toBeLessThan(ids.indexOf('product-research'));
  });

  it('picks worker skills from role + run pack', () => {
    const picked = selectSkillsForWorker({
      role: 'copywriter',
      instructions: 'Write punchy TikTok hooks and captions',
      runContractIds: ['research_methodology', 'creative_storyboarding', 'structured_json_delivery'],
      runDiskIds: ['ad-copywriting', 'trend-analysis', 'product-research'],
      explicit: ['ad-copywriting'],
    });
    expect(picked.diskSkillIds).toContain('ad-copywriting');
    expect(picked.contractSkillIds.length).toBeGreaterThan(0);
  });
});
