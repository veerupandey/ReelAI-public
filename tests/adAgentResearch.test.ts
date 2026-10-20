import { describe, expect, it } from 'vitest';
import {
  formatAdAgentCreativeBrief,
  mapAgentPlatformToSocial,
} from '../services/adAgentResearch';
import type { CreativeConcept, StrategistBrief } from '../components/AIImageStudio/types';

const brief: StrategistBrief = {
  id: 'b1',
  campaignGoal: 'Calm luxury morning ritual',
  executionMode: 'original',
  summary: 'Lead with ceremony vs coffee.',
  brandFit: 'Quiet premium tone',
  productFit: 'Matcha tin hero',
  trendAngles: ['Ritual content rising'],
  preservationPriorities: ['Keep tin label readable'],
  creativeTerritories: ['Product-hero close-up'],
  constraints: ['No medical claims'],
  openQuestions: [],
  sourceInsightIds: [],
  createdAt: new Date().toISOString(),
};

const concept: CreativeConcept = {
  id: 'c1',
  title: 'Steam & Stillness',
  oneLineIdea: 'Whisk, pour, pause — matcha beats the rush.',
  visualDirection: 'Soft daylight, ceramic bowl, tin in frame',
  brandFitRationale: 'Matches calm luxury',
  productTruthNotes: [],
  suggestedReferenceRoles: [],
  sourceTrendInsightIds: [],
  status: 'candidate',
};

describe('adAgentResearch helpers', () => {
  it('maps agent platforms to Image Studio social platforms', () => {
    expect(mapAgentPlatformToSocial('instagram_reels')).toBe('instagram_story');
    expect(mapAgentPlatformToSocial('instagram_feed')).toBe('instagram_feed');
    expect(mapAgentPlatformToSocial('tiktok')).toBe('instagram_story');
  });

  it('formats a creative brief that includes concept + strategist + facts', () => {
    const text = formatAdAgentCreativeBrief({
      campaignGoal: 'Calm luxury morning ritual',
      strategistBrief: brief,
      concept,
      productTitle: 'Ceremonial Matcha',
      productFacts: ['Stone-milled', 'Ceremonial grade'],
      brandName: 'Kageha',
      trendTitles: ['Ritual content rising'],
    });
    expect(text).toContain('Steam & Stillness');
    expect(text).toContain('Strategist brief');
    expect(text).toContain('Ceremonial Matcha');
    expect(text).toContain('Stone-milled');
  });
});
