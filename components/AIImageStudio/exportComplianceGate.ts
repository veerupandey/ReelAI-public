/**
 * Export compliance gate — optional strict mode blocks fail/pending assets.
 */

import type { StudioAsset } from './types';
import { EXPORT_COMPLIANCE_MODE_KEY } from './studioProjectService';

export type ExportComplianceMode = 'off' | 'strict';

export interface ExportComplianceIssue {
  assetId: string;
  assetName: string;
  kind: 'fail' | 'pending';
  score?: number;
  summary?: string;
}

export interface ExportComplianceGateResult {
  mode: ExportComplianceMode;
  issues: ExportComplianceIssue[];
  canExport: boolean;
}

export function evaluateExportCompliance(
  assets: StudioAsset[],
  mode: ExportComplianceMode,
): ExportComplianceGateResult {
  const issues: ExportComplianceIssue[] = [];

  for (const asset of assets) {
    if (asset.brandCompliancePending) {
      issues.push({
        assetId: asset.id,
        assetName: asset.name,
        kind: 'pending',
      });
      continue;
    }
    if (asset.brandCompliance?.status === 'fail') {
      issues.push({
        assetId: asset.id,
        assetName: asset.name,
        kind: 'fail',
        score: asset.brandCompliance.score,
        summary: asset.brandCompliance.summary,
      });
    }
  }

  return {
    mode,
    issues,
    canExport: mode !== 'strict' || issues.length === 0,
  };
}

export function formatExportComplianceMessage(result: ExportComplianceGateResult): string {
  if (result.issues.length === 0) return 'All selected assets passed compliance review.';
  const fails = result.issues.filter((i) => i.kind === 'fail').length;
  const pending = result.issues.filter((i) => i.kind === 'pending').length;
  const parts: string[] = [];
  if (fails > 0) parts.push(`${fails} failed compliance`);
  if (pending > 0) parts.push(`${pending} still reviewing`);
  const detail = parts.join(', ');
  if (!result.canExport) {
    return `Export blocked (strict mode): ${detail}. Fix or deselect those assets.`;
  }
  return `Exporting with compliance issues: ${detail}.`;
}

export function readExportComplianceMode(): ExportComplianceMode {
  if (typeof localStorage === 'undefined') return 'off';
  const raw = localStorage.getItem(EXPORT_COMPLIANCE_MODE_KEY);
  return raw === 'strict' ? 'strict' : 'off';
}

export function writeExportComplianceMode(mode: ExportComplianceMode): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(EXPORT_COMPLIANCE_MODE_KEY, mode);
}
