import type { AdFormat, CampaignPlatform } from '../../types/brand';

export interface TraceDecision {
  id: string;
  timestamp: string;
  phase: string;
  decisionType: string;
  decision: string;
  evidenceIds: string[];
  confidence: number;
}

export interface AdDecisionTrace {
  id: string;
  startedAt: string;
  completedAt?: string;
  prompt: string;
  productUrl: string;
  requestedFormat: AdFormat;
  deliveredFormat?: AdFormat;
  platform: CampaignPlatform;
  productFacts: string[];
  decisions: TraceDecision[];
  errors: string[];
}
