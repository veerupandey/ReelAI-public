import { describe, it, expect } from 'vitest';
import {
  truncateText,
  validatePrompt,
  validateUrl,
  validateFileType,
  validateFileSize,
  getColumnCount,
  validateFieldLength,
  checkAspectRatioConformance,
  resolveStudioAssetSrc,
} from '../../components/AIImageStudio/utils';

describe('resolveStudioAssetSrc', () => {
  it('builds a data URL from base64', () => {
    expect(
      resolveStudioAssetSrc({
        base64: 'abc',
        mimeType: 'image/jpeg',
      }),
    ).toBe('data:image/jpeg;base64,abc');
  });

  it('falls back to previewUrl when base64 is empty', () => {
    expect(
      resolveStudioAssetSrc({
        base64: '',
        mimeType: 'image/jpeg',
        previewUrl: 'https://cdn.example.com/a.jpg',
      }),
    ).toBe('https://cdn.example.com/a.jpg');
  });
});

describe('truncateText', () => {
  it('returns original string when length ≤ maxLength', () => {
    expect(truncateText('hello', 10)).toBe('hello');
    expect(truncateText('exact', 5)).toBe('exact');
  });

  it('truncates and appends ellipsis when length > maxLength', () => {
    expect(truncateText('hello world', 5)).toBe('hello…');
  });

  it('handles empty string', () => {
    expect(truncateText('', 10)).toBe('');
  });
});

describe('validatePrompt', () => {
  it('accepts strings with non-whitespace chars within 10000 length', () => {
    expect(validatePrompt('a')).toBe(true);
    expect(validatePrompt('generate a cat')).toBe(true);
  });

  it('rejects empty strings', () => {
    expect(validatePrompt('')).toBe(false);
  });

  it('rejects whitespace-only strings', () => {
    expect(validatePrompt('   ')).toBe(false);
    expect(validatePrompt('\t\n')).toBe(false);
  });

  it('rejects strings exceeding 10000 characters', () => {
    expect(validatePrompt('a'.repeat(10001))).toBe(false);
  });

  it('accepts strings at exactly 10000 characters', () => {
    expect(validatePrompt('a'.repeat(10000))).toBe(true);
  });
});

describe('validateUrl', () => {
  it('accepts valid http/https URLs with supported extensions', () => {
    expect(validateUrl('https://example.com/image.png')).toBe(true);
    expect(validateUrl('http://example.com/photo.jpg')).toBe(true);
    expect(validateUrl('https://cdn.site.io/path/to/file.jpeg')).toBe(true);
    expect(validateUrl('https://example.com/img.webp')).toBe(true);
  });

  it('rejects URLs without supported extensions', () => {
    expect(validateUrl('https://example.com/image.gif')).toBe(false);
    expect(validateUrl('https://example.com/file.svg')).toBe(false);
    expect(validateUrl('https://example.com/page')).toBe(false);
  });

  it('rejects non-http/https schemes', () => {
    expect(validateUrl('ftp://example.com/image.png')).toBe(false);
    expect(validateUrl('file:///local/image.png')).toBe(false);
  });

  it('rejects invalid URLs', () => {
    expect(validateUrl('not a url')).toBe(false);
    expect(validateUrl('')).toBe(false);
  });
});

describe('validateFileType', () => {
  it('accepts supported MIME types', () => {
    expect(validateFileType('image/png')).toBe(true);
    expect(validateFileType('image/jpeg')).toBe(true);
    expect(validateFileType('image/webp')).toBe(true);
  });

  it('rejects unsupported MIME types', () => {
    expect(validateFileType('image/gif')).toBe(false);
    expect(validateFileType('image/svg+xml')).toBe(false);
    expect(validateFileType('application/pdf')).toBe(false);
  });
});

describe('validateFileSize', () => {
  it('accepts files at or below 20MB', () => {
    expect(validateFileSize(0)).toBe(true);
    expect(validateFileSize(1024)).toBe(true);
    expect(validateFileSize(20 * 1024 * 1024)).toBe(true);
  });

  it('rejects files exceeding 20MB', () => {
    expect(validateFileSize(20 * 1024 * 1024 + 1)).toBe(false);
  });
});

describe('getColumnCount', () => {
  it('returns 2 columns below 640px in default mode', () => {
    expect(getColumnCount(320, 'default')).toBe(2);
    expect(getColumnCount(639, 'default')).toBe(2);
  });

  it('returns 3 columns between 640–1024px in default mode', () => {
    expect(getColumnCount(640, 'default')).toBe(3);
    expect(getColumnCount(1023, 'default')).toBe(3);
  });

  it('returns 4 columns between 1024–1440px in default mode', () => {
    expect(getColumnCount(1024, 'default')).toBe(4);
    expect(getColumnCount(1439, 'default')).toBe(4);
  });

  it('returns 6 columns above 1440px in default mode', () => {
    expect(getColumnCount(1440, 'default')).toBe(6);
    expect(getColumnCount(1920, 'default')).toBe(6);
  });

  it('adds 2 columns in compact mode', () => {
    expect(getColumnCount(320, 'compact')).toBe(4);
    expect(getColumnCount(640, 'compact')).toBe(5);
    expect(getColumnCount(1024, 'compact')).toBe(6);
    expect(getColumnCount(1440, 'compact')).toBe(8);
  });
});

describe('validateFieldLength', () => {
  it('accepts strings within the limit', () => {
    expect(validateFieldLength('hello', 100)).toBe(true);
    expect(validateFieldLength('a'.repeat(100), 100)).toBe(true);
  });

  it('rejects strings exceeding the limit', () => {
    expect(validateFieldLength('a'.repeat(101), 100)).toBe(false);
  });

  it('accepts empty strings', () => {
    expect(validateFieldLength('', 100)).toBe(true);
  });
});

describe('checkAspectRatioConformance', () => {
  it('passes for exact aspect ratio match', () => {
    expect(checkAspectRatioConformance(1080, 1920, '9:16')).toBe(true);
    expect(checkAspectRatioConformance(1000, 1000, '1:1')).toBe(true);
    expect(checkAspectRatioConformance(1920, 1080, '16:9')).toBe(true);
    expect(checkAspectRatioConformance(800, 1000, '4:5')).toBe(true);
  });

  it('passes within 1-pixel rounding tolerance', () => {
    // 9:16 ratio = 0.5625. For 1080x1920, tolerance = 1/1080 ≈ 0.000926
    // 1081/1920 = 0.563021 — diff from 0.5625 = 0.000521, within tolerance
    expect(checkAspectRatioConformance(1081, 1920, '9:16')).toBe(true);
  });

  it('fails when outside tolerance', () => {
    // 500x500 is 1:1, not 9:16
    expect(checkAspectRatioConformance(500, 500, '9:16')).toBe(false);
    // 1920x1080 is 16:9, not 1:1
    expect(checkAspectRatioConformance(1920, 1080, '1:1')).toBe(false);
  });

  it('returns false for zero or negative dimensions', () => {
    expect(checkAspectRatioConformance(0, 100, '1:1')).toBe(false);
    expect(checkAspectRatioConformance(100, 0, '1:1')).toBe(false);
    expect(checkAspectRatioConformance(-1, 100, '1:1')).toBe(false);
  });
});
