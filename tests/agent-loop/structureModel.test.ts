import { describe, expect, it } from 'vitest';
import {
  HARD_MULTIMODAL_MODEL,
  WORKER_MODEL,
  structureAnalysisRole,
} from '../../services/agentLoop/modelRouter';

describe('structureAnalysisRole', () => {
  it('uses worker (Flash) for fewer than 4 frames', () => {
    expect(structureAnalysisRole(1)).toBe('worker');
    expect(structureAnalysisRole(3)).toBe('worker');
  });

  it('uses hard_multimodal (Pro) for 4+ frames', () => {
    expect(structureAnalysisRole(4)).toBe('hard_multimodal');
    expect(structureAnalysisRole(8)).toBe('hard_multimodal');
  });

  it('maps roles to expected model ids', () => {
    const role = structureAnalysisRole(5);
    const model = role === 'hard_multimodal' ? HARD_MULTIMODAL_MODEL : WORKER_MODEL;
    expect(model).toBe(HARD_MULTIMODAL_MODEL);
    expect(WORKER_MODEL).toBe('gemini-3.8-flash');
  });
});
