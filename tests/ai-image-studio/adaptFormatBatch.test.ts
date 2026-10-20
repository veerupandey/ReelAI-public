import { describe, expect, it } from 'vitest';
import {
  formatAdaptTargetLabel,
  getBatchAdaptFormatTargets,
  getAdaptFormatTargets,
} from '../../components/AIImageStudio/adaptFormatService';

describe('batch adapt format targets', () => {
  it('includes Amazon A+ desktop and mobile', () => {
    const targets = getBatchAdaptFormatTargets();
    expect(targets).toContain('1464x600');
    expect(targets).toContain('600x450');
    expect(formatAdaptTargetLabel('1464x600')).toMatch(/A\+/i);
  });

  it('excludes current aspect from single-asset adapt list', () => {
    expect(getAdaptFormatTargets('1464x600')).not.toContain('1464x600');
    expect(getAdaptFormatTargets('1:1')).toContain('1464x600');
  });
});
