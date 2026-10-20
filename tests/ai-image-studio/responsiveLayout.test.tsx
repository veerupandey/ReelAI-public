import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AIImageStudioScreen from '../../components/AIImageStudio/AIImageStudioScreen';

// Mock the service modules
vi.mock('../../components/AIImageStudio/studioService', () => ({
  generateStudioImage: vi.fn(),
  enhanceStudioPrompt: vi.fn(),
}));

vi.mock('../../components/AIImageStudio/assetIngestion', () => ({
  importFiles: vi.fn(),
  importFromUrl: vi.fn(),
}));

import { importFiles } from '../../components/AIImageStudio/assetIngestion';
const mockImportFiles = vi.mocked(importFiles);

// Mock crypto.randomUUID
Object.defineProperty(globalThis, 'crypto', {
  value: { randomUUID: vi.fn(() => 'test-uuid-1234') },
});

describe('AIImageStudioScreen - Responsive Layout', () => {
  let originalInnerWidth: number;

  beforeEach(() => {
    vi.clearAllMocks();
    originalInnerWidth = window.innerWidth;
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    });
  });

  function setViewportWidth(width: number) {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: width,
    });
    window.dispatchEvent(new Event('resize'));
  }

  async function setupWithAsset() {
    const mockAsset = {
      id: 'asset-1',
      name: 'test.png',
      description: '',
      base64: 'abc123',
      mimeType: 'image/png' as const,
      width: 100,
      height: 100,
      source: 'upload' as const,
      createdAt: '2024-01-01T00:00:00.000Z',
    };

    mockImportFiles.mockResolvedValue({
      assets: [mockAsset],
      errors: [],
    });

    render(<AIImageStudioScreen />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(screen.getByRole('toolbar')).toBeTruthy();
    });
  }

  describe('Desktop layout (>= 768px)', () => {
    beforeEach(() => {
      setViewportWidth(1024);
    });

    it('shows side panel with GenerationPanel on desktop', async () => {
      await setupWithAsset();

      // The generation panel should be visible (prompt input)
      expect(screen.getByPlaceholderText(/Describe the image/i)).toBeTruthy();
    });

    it('does not show FAB on desktop', async () => {
      await setupWithAsset();

      expect(screen.queryByRole('button', { name: /Open generation panel/i })).toBeNull();
    });
  });

  describe('Mobile layout (< 768px)', () => {
    beforeEach(() => {
      setViewportWidth(600);
    });

    it('hides side panel and shows FAB on mobile', async () => {
      await setupWithAsset();

      // FAB should be visible
      expect(screen.getByRole('button', { name: /Open generation panel/i })).toBeTruthy();
    });

    it('opens bottom sheet when FAB is clicked', async () => {
      await setupWithAsset();

      const fab = screen.getByRole('button', { name: /Open generation panel/i });
      await act(async () => {
        fireEvent.click(fab);
      });

      // Bottom sheet dialog should appear
      expect(screen.getByRole('dialog', { name: /Panel/i })).toBeTruthy();

      // Generation panel content should be visible inside bottom sheet
      expect(screen.getByPlaceholderText(/Describe the image/i)).toBeTruthy();
    });

    it('closes bottom sheet when close button is clicked', async () => {
      await setupWithAsset();

      // Open bottom sheet
      const fab = screen.getByRole('button', { name: /Open generation panel/i });
      await act(async () => {
        fireEvent.click(fab);
      });

      expect(screen.getByRole('dialog', { name: /Panel/i })).toBeTruthy();

      // Close it
      const closeBtn = screen.getByRole('button', { name: /Close panel/i });
      await act(async () => {
        fireEvent.click(closeBtn);
      });

      // Dialog should be gone
      expect(screen.queryByRole('dialog', { name: /Panel/i })).toBeNull();

      // FAB should reappear
      expect(screen.getByRole('button', { name: /Open generation panel/i })).toBeTruthy();
    });

    it('closes bottom sheet when backdrop is clicked', async () => {
      await setupWithAsset();

      // Open bottom sheet
      const fab = screen.getByRole('button', { name: /Open generation panel/i });
      await act(async () => {
        fireEvent.click(fab);
      });

      const dialog = screen.getByRole('dialog', { name: /Panel/i });
      expect(dialog).toBeTruthy();

      // Click the backdrop (first child of the dialog container)
      const backdrop = dialog.querySelector('[aria-hidden="true"]');
      expect(backdrop).not.toBeNull();
      await act(async () => {
        fireEvent.click(backdrop!);
      });

      // Dialog should be gone
      expect(screen.queryByRole('dialog', { name: /Panel/i })).toBeNull();
    });
  });

  describe('WCAG 2.1 AA compliance', () => {
    it('FAB meets minimum touch target size (48x48px)', async () => {
      setViewportWidth(600);
      await setupWithAsset();

      const fab = screen.getByRole('button', { name: /Open generation panel/i });
      // Check that the FAB has min-w-[48px] and min-h-[48px] classes
      expect(fab.className).toContain('min-w-[48px]');
      expect(fab.className).toContain('min-h-[48px]');
    });

    it('FAB has visible focus indicator', async () => {
      setViewportWidth(600);
      await setupWithAsset();

      const fab = screen.getByRole('button', { name: /Open generation panel/i });
      // Check for focus ring classes
      expect(fab.className).toContain('focus:ring-2');
      expect(fab.className).toContain('focus:ring-offset-2');
    });

    it('bottom sheet close button meets minimum touch target (24x24px)', async () => {
      setViewportWidth(600);
      await setupWithAsset();

      // Open bottom sheet
      const fab = screen.getByRole('button', { name: /Open generation panel/i });
      await act(async () => {
        fireEvent.click(fab);
      });

      const closeBtn = screen.getByRole('button', { name: /Close panel/i });
      expect(closeBtn.className).toContain('min-w-[24px]');
      expect(closeBtn.className).toContain('min-h-[24px]');
    });

    it('bottom sheet close button has visible focus indicator', async () => {
      setViewportWidth(600);
      await setupWithAsset();

      // Open bottom sheet
      const fab = screen.getByRole('button', { name: /Open generation panel/i });
      await act(async () => {
        fireEvent.click(fab);
      });

      const closeBtn = screen.getByRole('button', { name: /Close panel/i });
      expect(closeBtn.className).toContain('focus:ring-2');
      expect(closeBtn.className).toContain('focus:ring-offset-2');
    });

    it('toast dismiss button meets minimum touch target (24x24px)', async () => {
      setViewportWidth(1024);

      const { generateStudioImage } = await import('../../components/AIImageStudio/studioService');
      vi.mocked(generateStudioImage).mockRejectedValue(new Error('Test error'));

      await setupWithAsset();

      // Type prompt and generate to trigger error toast
      const promptInput = screen.getByPlaceholderText(/Describe the image/i);
      await act(async () => {
        fireEvent.change(promptInput, { target: { value: 'test prompt' } });
      });

      const generateBtn = screen.getByRole('button', { name: /Generate image/i });
      await act(async () => {
        fireEvent.click(generateBtn);
      });

      await waitFor(() => {
        const dismissBtn = screen.getByRole('button', { name: /Dismiss notification/i });
        expect(dismissBtn.className).toContain('min-w-[24px]');
        expect(dismissBtn.className).toContain('min-h-[24px]');
      });
    });
  });
});
