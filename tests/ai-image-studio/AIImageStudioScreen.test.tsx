import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AIImageStudioScreen from '../../components/AIImageStudio/AIImageStudioScreen';

// Mock the service modules
vi.mock('../../components/AIImageStudio/studioService', () => ({
  generateStudioImage: vi.fn(),
  enhanceStudioPrompt: vi.fn(),
  buildStudioGenerationRequest: vi.fn(() => ({
    mode: 'generate',
    imagePrompt: 'test prompt',
    aspectRatio: '9:16',
  })),
  executeGeneration: vi.fn(),
}));

vi.mock('../../components/AIImageStudio/assetIngestion', () => ({
  importFiles: vi.fn(),
  importFromUrl: vi.fn(),
}));

vi.mock('../../components/AIImageStudio/brandComplianceService', () => ({
  evaluateBrandCompliance: vi.fn(),
}));

vi.mock('../../components/AIImageStudio/diskSaveService', () => ({
  saveAssetToDisk: vi.fn(),
}));

vi.mock('../../components/AIImageStudio/PromptWriter', () => ({
  default: ({ onGenerateAllSlides }: { onGenerateAllSlides?: (slides: any[]) => void }) => (
    <button
      type="button"
      onClick={() =>
        onGenerateAllSlides?.([
          {
            slideNumber: 1,
            title: 'Hook',
            prompt: 'Opening carousel slide',
            negativePrompt: 'clutter',
            copy: {},
            designNotes: '',
          },
          {
            slideNumber: 2,
            title: 'Payoff',
            prompt: 'Closing carousel slide',
            copy: {},
            designNotes: '',
          },
        ])
      }
    >
      Generate mock carousel
    </button>
  ),
}));

// Mock crypto.randomUUID
const mockUUID = vi.fn(() => 'test-uuid-1234');
Object.defineProperty(globalThis, 'crypto', {
  value: { randomUUID: mockUUID },
});

describe('AIImageStudioScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUUID.mockReturnValue('test-uuid-1234');
    // Clear localStorage to ensure tests start fresh
    localStorage.clear();
  });

  describe('Landing Step', () => {
    it('renders the landing page with Image Studio heading', () => {
      render(<AIImageStudioScreen />);
      expect(screen.getByText('Image Studio')).toBeTruthy();
    });

    it('renders Upload button', () => {
      render(<AIImageStudioScreen />);
      expect(screen.getByRole('button', { name: /Upload/i })).toBeTruthy();
    });

    it('renders Product URL button', () => {
      render(<AIImageStudioScreen />);
      expect(screen.getByRole('button', { name: /Product URL/i })).toBeTruthy();
    });

    it('renders Start with a prompt button', () => {
      render(<AIImageStudioScreen />);
      expect(screen.getByRole('button', { name: /Start with a prompt/i })).toBeTruthy();
    });
  });

  describe('Navigation', () => {
    it('navigates to import step when Upload is clicked', async () => {
      render(<AIImageStudioScreen />);
      fireEvent.click(screen.getByRole('button', { name: /Upload/i }));

      await waitFor(() => {
        expect(screen.getByText('Import Assets')).toBeTruthy();
      });
    });

    it('navigates to import step when Product URL is clicked', async () => {
      render(<AIImageStudioScreen />);
      fireEvent.click(screen.getByRole('button', { name: /Product URL/i }));

      await waitFor(() => {
        expect(screen.getByText('Import Assets')).toBeTruthy();
      });
    });

    it('import step shows URL textarea and file upload area', async () => {
      render(<AIImageStudioScreen />);
      fireEvent.click(screen.getByRole('button', { name: /Upload/i }));

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/store.com\/products/i)).toBeTruthy();
        expect(screen.getByText(/Click to upload or drag & drop/i)).toBeTruthy();
      });
    });

    it('import step shows Back and Next buttons', async () => {
      render(<AIImageStudioScreen />);
      fireEvent.click(screen.getByRole('button', { name: /Upload/i }));

      await waitFor(() => {
        expect(screen.getByText('← Back')).toBeTruthy();
        expect(screen.getByText('Open Studio →')).toBeTruthy();
      });
    });

    it('import step Next button is disabled when no assets', async () => {
      render(<AIImageStudioScreen />);
      fireEvent.click(screen.getByRole('button', { name: /Upload/i }));

      await waitFor(() => {
        const nextBtn = screen.getByText('Open Studio →');
        expect(nextBtn.hasAttribute('disabled') || nextBtn.className.includes('disabled')).toBeTruthy();
      });
    });

    it('Back button on import step returns to landing', async () => {
      render(<AIImageStudioScreen />);
      fireEvent.click(screen.getByRole('button', { name: /Upload/i }));

      await waitFor(() => {
        expect(screen.getByText('Import Assets')).toBeTruthy();
      });

      fireEvent.click(screen.getByText('← Back'));

      await waitFor(() => {
        expect(screen.getByText('Image Studio')).toBeTruthy();
      });
    });

    it('does not restore a stale generating state from localStorage', async () => {
      localStorage.setItem('ai-image-studio-step-v1', 'studio');
      localStorage.setItem('ai-image-studio-session-v1', JSON.stringify({
        assets: [{
          id: 'asset-1',
          name: 'Imported matcha tin',
          description: '',
          base64: 'iVBORw0KGgo=',
          mimeType: 'image/png',
          width: 1,
          height: 1,
          source: 'upload',
          createdAt: '2026-06-23T00:00:00.000Z',
        }],
                roleAssignments: [],
        gallerySelectionIds: [],
        prompt: 'Create a clean product image',
        creativeRoute: 'generate_fresh',
        aspectRatio: '9:16',
        viewMode: 'default',
        isGenerating: true,
        isEnhancing: true,
        history: [],
        composerReferences: [],
        versions: [],
        conceptCandidates: [],
        outputIntent: 'image',
      }));

      render(<AIImageStudioScreen />);

      expect(screen.queryByText('Generating…')).toBeNull();
      expect(screen.queryByText('Enhancing…')).toBeNull();
      expect(screen.getByRole('button', { name: /Generate image/i }).hasAttribute('disabled')).toBe(false);
    });

    it('automatically checks brand compliance after generation', async () => {
      const { executeGeneration } = await import(
        '../../components/AIImageStudio/studioService'
      );
      const { evaluateBrandCompliance } = await import(
        '../../components/AIImageStudio/brandComplianceService'
      );
      vi.mocked(executeGeneration).mockResolvedValue({
        base64: 'iVBORw0KGgo=',
        mimeType: 'image/png',
      } as any);
      vi.mocked(evaluateBrandCompliance).mockResolvedValue({
        score: 88,
        status: 'pass',
        summary: 'Strong brand alignment.',
        evaluatedAt: '2026-07-12T00:00:00.000Z',
        evaluationMode: 'visual_ai',
        checks: [],
      });

      localStorage.setItem('ai-image-studio-step-v1', 'studio');
      localStorage.setItem(
        'ai-image-studio-session-v1',
        JSON.stringify({
          assets: [],
                    roleAssignments: [],
          gallerySelectionIds: [],
          prompt: 'Create a premium branded product post',
          creativeRoute: 'generate_fresh',
          aspectRatio: '4:5',
          viewMode: 'default',
          history: [],
          composerReferences: [],
          versions: [],
          conceptCandidates: [],
          outputIntent: 'image',
          brandKnowledge: {
            id: 'brand-1',
            brandName: {
              value: 'Kageha',
              status: 'verified',
              confidence: 1,
              sourceIds: [],
            },
            sourceUrls: [],
            sources: [],
            fonts: [],
            colors: [],
            logoRules: [],
            visualPrinciples: [],
            toneAttributes: [],
            approvedLanguage: [],
            prohibitedLanguage: [],
            imageStyle: {
              lighting: [],
              composition: [],
              backgrounds: [],
              textures: [],
            },
            updatedAt: '2026-07-12T00:00:00.000Z',
          },
        }),
      );

      render(<AIImageStudioScreen />);
      fireEvent.click(
        screen.getByRole('button', { name: 'Generate image' }),
      );

      await waitFor(() => {
        expect(evaluateBrandCompliance).toHaveBeenCalledOnce();
      });
      expect(evaluateBrandCompliance).toHaveBeenCalledWith(
        expect.objectContaining({
          asset: expect.objectContaining({
            source: 'generated',
            brandCompliancePending: true,
          }),
          brandKnowledge: expect.objectContaining({ id: 'brand-1' }),
        }),
      );
    });

    it('generates Prompt Writer slides as a carousel, not variations', async () => {
      const { executeGeneration } = await import(
        '../../components/AIImageStudio/studioService'
      );
      vi.mocked(executeGeneration).mockResolvedValue({
        base64: 'iVBORw0KGgo=',
        mimeType: 'image/png',
      } as any);
      mockUUID
        .mockReturnValueOnce('carousel-set')
        .mockReturnValueOnce('slide-1')
        .mockReturnValueOnce('history-1')
        .mockReturnValueOnce('slide-2')
        .mockReturnValueOnce('history-2');

      localStorage.setItem('ai-image-studio-step-v1', 'studio');
      localStorage.setItem('ai-image-studio-session-v1', JSON.stringify({
        assets: [],
        roleAssignments: [],
        gallerySelectionIds: [],
        postQueueIds: ['manual-asset'],
        prompt: 'Carousel prompt',
        creativeRoute: 'generate_fresh',
        aspectRatio: '4:5',
        viewMode: 'default',
        history: [],
        composerReferences: [],
        versions: [],
        conceptCandidates: [],
        outputIntent: 'image',
      }));

      render(<AIImageStudioScreen />);
      fireEvent.click(screen.getByRole('button', { name: 'AI Prompt Writer' }));
      fireEvent.click(screen.getByRole('button', { name: 'Generate mock carousel' }));

      await waitFor(() => {
        expect(screen.getByText('Slide 1 · Hook')).toBeTruthy();
        expect(screen.getByText('Slide 2 · Payoff')).toBeTruthy();
      });
      expect(screen.getByText('Slide 1')).toBeTruthy();
      expect(screen.getByText('Slide 2')).toBeTruthy();
      expect(screen.queryByText('V1')).toBeNull();
      expect(screen.queryByText('V2')).toBeNull();

      await waitFor(() => {
        const persisted = JSON.parse(
          localStorage.getItem('ai-image-studio-session-v1') || '{}',
        );
        const slides = persisted.assets.filter((asset: any) => asset.carouselSetId);
        expect(slides).toHaveLength(2);
        expect(slides.map((asset: any) => asset.carouselSlideIndex).sort()).toEqual([1, 2]);
        expect(slides.every((asset: any) => asset.variationSetId == null)).toBe(true);
        expect(persisted.postQueueIds).toEqual(['manual-asset']);
      });
    });
  });
});
