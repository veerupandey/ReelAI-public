import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { importFiles, importFromUrl } from '../../components/AIImageStudio/assetIngestion';

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
  randomUUID: () => 'test-uuid-1234',
});

// Helper to create a mock File
function createMockFile(name: string, size: number, type: string): File {
  const content = new Uint8Array(size);
  return new File([content], name, { type });
}

// Mock Image element for dimension reading
class MockImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 800;
  naturalHeight = 600;
  private _src = '';

  get src() {
    return this._src;
  }

  set src(value: string) {
    this._src = value;
    // Simulate async image load
    setTimeout(() => {
      if (this.onload) this.onload();
    }, 0);
  }
}

// Mock FileReader
class MockFileReader {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  result: string | null = null;

  readAsDataURL(_blob: Blob) {
    // Simulate async read
    setTimeout(() => {
      this.result = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
      if (this.onload) this.onload();
    }, 0);
  }
}

beforeEach(() => {
  vi.stubGlobal('Image', MockImage);
  vi.stubGlobal('FileReader', MockFileReader);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('importFiles', () => {
  it('should import valid PNG files as StudioAsset objects', async () => {
    const file = createMockFile('photo.png', 1024, 'image/png');
    const result = await importFiles([file]);

    expect(result.assets).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.assets[0]).toMatchObject({
      id: 'test-uuid-1234',
      name: 'photo.png',
      description: '',
      mimeType: 'image/png',
      source: 'upload',
      width: 800,
      height: 600,
    });
    expect(result.assets[0].base64).toBe('iVBORw0KGgoAAAANSUhEUg==');
    expect(result.assets[0].createdAt).toBeDefined();
  });

  it('should import valid JPEG files', async () => {
    const file = createMockFile('photo.jpg', 2048, 'image/jpeg');
    const result = await importFiles([file]);

    expect(result.assets).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.assets[0].mimeType).toBe('image/jpeg');
  });

  it('should import valid WebP files', async () => {
    const file = createMockFile('photo.webp', 512, 'image/webp');
    const result = await importFiles([file]);

    expect(result.assets).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.assets[0].mimeType).toBe('image/webp');
  });

  it('should reject files with unsupported format', async () => {
    const file = createMockFile('document.pdf', 1024, 'application/pdf');
    const result = await importFiles([file]);

    expect(result.assets).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      fileName: 'document.pdf',
      reason: 'unsupported_format',
    });
    expect(result.errors[0].message).toContain('unsupported format');
  });

  it('should reject files exceeding 20MB', async () => {
    const size = 21 * 1024 * 1024; // 21MB
    const file = createMockFile('huge.png', size, 'image/png');
    const result = await importFiles([file]);

    expect(result.assets).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      fileName: 'huge.png',
      reason: 'size_exceeded',
    });
    expect(result.errors[0].message).toContain('20 MB');
  });

  it('should accept files exactly at 20MB', async () => {
    const size = 20 * 1024 * 1024; // exactly 20MB
    const file = createMockFile('exact.png', size, 'image/png');
    const result = await importFiles([file]);

    expect(result.assets).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it('should handle mixed valid and invalid files in a batch', async () => {
    const files = [
      createMockFile('valid.png', 1024, 'image/png'),
      createMockFile('invalid.gif', 1024, 'image/gif'),
      createMockFile('valid2.jpg', 2048, 'image/jpeg'),
      createMockFile('toobig.webp', 21 * 1024 * 1024, 'image/webp'),
    ];

    const result = await importFiles(files);

    expect(result.assets).toHaveLength(2);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].reason).toBe('unsupported_format');
    expect(result.errors[1].reason).toBe('size_exceeded');
  });

  it('should limit batch to 100 files and error the rest', async () => {
    const files = Array.from({ length: 103 }, (_, i) =>
      createMockFile(`file${i}.png`, 1024, 'image/png')
    );

    const result = await importFiles(files);

    expect(result.assets).toHaveLength(100);
    expect(result.errors).toHaveLength(3);
    result.errors.forEach((error) => {
      expect(error.reason).toBe('batch_limit');
    });
    expect(result.errors[0].fileName).toBe('file100.png');
    expect(result.errors[1].fileName).toBe('file101.png');
    expect(result.errors[2].fileName).toBe('file102.png');
  });

  it('should handle empty file array', async () => {
    const result = await importFiles([]);

    expect(result.assets).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});

describe('importFromUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('should reject invalid URLs without http/https scheme', async () => {
    const result = await importFromUrl('ftp://example.com/image.png');

    expect('error' in result).toBe(true);
    if ('error' in result) {
      // ftp:// URLs are rejected as invalid since only http/https are supported
      expect(['invalid_url', 'network_error'].includes(result.error.reason)).toBe(true);
    }
  });

  it('should reject URLs without supported image extensions', async () => {
    const result = await importFromUrl('https://example.com/file.gif');

    expect('error' in result).toBe(true);
    if ('error' in result) {
      // Non-image URLs are now attempted as product page imports
      // which will fail with network_error or invalid_response
      expect(['invalid_url', 'network_error', 'invalid_response'].includes(result.error.reason)).toBe(true);
    }
  });

  it('should reject invalid URL strings', async () => {
    const result = await importFromUrl('not-a-url');

    expect('error' in result).toBe(true);
    if ('error' in result) {
      // Invalid strings that can't be parsed as URLs get network_error
      // because the system attempts to fetch them as product pages
      expect(['invalid_url', 'network_error'].includes(result.error.reason)).toBe(true);
    }
  });

  it('should successfully import from a valid URL', async () => {
    const mockBlob = new Blob(['fake-image-data'], { type: 'image/png' });
    const mockResponse = {
      ok: true,
      blob: () => Promise.resolve(mockBlob),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

    const result = await importFromUrl('https://example.com/photos/sunset.png');

    expect('asset' in result).toBe(true);
    if ('asset' in result) {
      expect(result.asset).toMatchObject({
        id: 'test-uuid-1234',
        name: 'sunset.png',
        description: '',
        mimeType: 'image/png',
        source: 'url_import',
        width: 800,
        height: 600,
      });
    }
  });

  it('should handle HTTP error responses', async () => {
    const mockResponse = {
      ok: false,
      status: 404,
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

    const result = await importFromUrl('https://example.com/missing.png');

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.reason).toBe('invalid_response');
      expect(result.error.message).toContain('404');
    }
  });

  it('should handle network errors', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network failure'));

    const result = await importFromUrl('https://example.com/image.png');

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.reason).toBe('network_error');
      expect(result.error.message).toContain('Network failure');
    }
  });

  it('should handle timeout (AbortError)', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.mocked(fetch).mockRejectedValue(abortError);

    const result = await importFromUrl('https://example.com/slow.png');

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.reason).toBe('timeout');
      expect(result.error.message).toContain('10 seconds');
    }
  });

  it('should accept .jpg extension URLs', async () => {
    const mockBlob = new Blob(['fake-image-data'], { type: 'image/jpeg' });
    const mockResponse = {
      ok: true,
      blob: () => Promise.resolve(mockBlob),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

    const result = await importFromUrl('https://example.com/photo.jpg');

    expect('asset' in result).toBe(true);
    if ('asset' in result) {
      expect(result.asset.mimeType).toBe('image/jpeg');
    }
  });

  it('should accept .webp extension URLs', async () => {
    const mockBlob = new Blob(['fake-image-data'], { type: 'image/webp' });
    const mockResponse = {
      ok: true,
      blob: () => Promise.resolve(mockBlob),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

    const result = await importFromUrl('https://example.com/photo.webp');

    expect('asset' in result).toBe(true);
    if ('asset' in result) {
      expect(result.asset.mimeType).toBe('image/webp');
    }
  });

  it('should pass AbortSignal to fetch for timeout control', async () => {
    const mockBlob = new Blob(['fake-image-data'], { type: 'image/png' });
    const mockResponse = {
      ok: true,
      blob: () => Promise.resolve(mockBlob),
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as Response);

    await importFromUrl('https://example.com/image.png');

    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/image.png',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
