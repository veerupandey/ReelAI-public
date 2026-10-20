import type { AdDecisionTrace, TraceDecision } from './types';

const id = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const createDecisionTrace = (
  input: Pick<AdDecisionTrace, 'prompt' | 'productUrl' | 'requestedFormat' | 'platform'>,
): AdDecisionTrace => ({
  id: id('trace'),
  startedAt: new Date().toISOString(),
  ...input,
  productFacts: [],
  decisions: [],
  errors: [],
});

export const recordTraceDecision = (
  trace: AdDecisionTrace,
  decision: Omit<TraceDecision, 'id' | 'timestamp'>,
): TraceDecision => {
  const recorded = { id: id('decision'), timestamp: new Date().toISOString(), ...decision };
  trace.decisions.push(recorded);
  return recorded;
};

export const completeDecisionTrace = (
  trace: AdDecisionTrace,
  deliveredFormat: AdDecisionTrace['requestedFormat'],
): AdDecisionTrace => {
  trace.deliveredFormat = deliveredFormat;
  trace.completedAt = new Date().toISOString();
  return trace;
};

export const validateTraceCompleteness = (trace: AdDecisionTrace): { complete: boolean; missing: string[] } => {
  const missing: string[] = [];
  if (!trace.completedAt) missing.push('completedAt');
  if (!trace.deliveredFormat) missing.push('deliveredFormat');
  if (!trace.productFacts.length) missing.push('productFacts');
  if (!trace.decisions.length) missing.push('decisions');
  return { complete: missing.length === 0, missing };
};

export const serializeDecisionTrace = (trace: AdDecisionTrace): string => JSON.stringify(trace, null, 2);
