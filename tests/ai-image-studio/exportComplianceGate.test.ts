import { describe, expect, it } from 'vitest';
import {
  evaluateExportCompliance,
  formatExportComplianceMessage,
} from '../../components/AIImageStudio/exportComplianceGate';
import type { StudioAsset } from '../../components/AIImageStudio/types';

function asset(partial: Partial<StudioAsset> & { id: string }): StudioAsset {
  return {
    name: partial.name || partial.id,
    description: '',
    base64: 'YWJj',
    mimeType: 'image/png',
    width: 1,
    height: 1,
    source: 'generated',
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

describe('exportComplianceGate', () => {
  it('allows export in off mode even with failing assets', () => {
    const result = evaluateExportCompliance(
      [
        asset({
          id: 'fail',
          brandCompliance: {
            score: 40,
            status: 'fail',
            summary: 'Off brand',
            checks: [],
            evaluatedAt: new Date().toISOString(),
            evaluationMode: 'visual_ai',
          },
        }),
      ],
      'off',
    );
    expect(result.canExport).toBe(true);
    expect(result.issues).toHaveLength(1);
  });

  it('blocks strict mode for fail and pending assets', () => {
    const fail = evaluateExportCompliance(
      [
        asset({
          id: 'fail',
          brandCompliance: {
            score: 40,
            status: 'fail',
            summary: 'Off brand',
            checks: [],
            evaluatedAt: new Date().toISOString(),
            evaluationMode: 'visual_ai',
          },
        }),
      ],
      'strict',
    );
    expect(fail.canExport).toBe(false);
    expect(formatExportComplianceMessage(fail)).toContain('Export blocked');

    const pending = evaluateExportCompliance(
      [asset({ id: 'p', brandCompliancePending: true })],
      'strict',
    );
    expect(pending.canExport).toBe(false);
  });

  it('allows warnings and unreviewed assets in strict mode', () => {
    const result = evaluateExportCompliance(
      [
        asset({
          id: 'warn',
          brandCompliance: {
            score: 65,
            status: 'warning',
            summary: 'Minor',
            checks: [],
            evaluatedAt: new Date().toISOString(),
            evaluationMode: 'visual_ai',
          },
        }),
        asset({ id: 'upload', source: 'upload' }),
      ],
      'strict',
    );
    expect(result.canExport).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});
