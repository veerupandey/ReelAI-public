import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import AssetDetailPanel from '../../components/AIImageStudio/AssetDetailPanel';
import { StudioAsset } from '../../components/AIImageStudio/types';

const makeAsset = (overrides: Partial<StudioAsset> = {}): StudioAsset => ({
  id: 'asset-1',
  name: 'Test Image',
  description: 'A test description',
  base64: 'dGVzdA==',
  mimeType: 'image/png',
  width: 1024,
  height: 768,
  source: 'upload',
  createdAt: '2024-01-15T10:30:00.000Z',
  ...overrides,
});

const makeGeneratedAsset = (overrides: Partial<StudioAsset> = {}): StudioAsset =>
  makeAsset({
    source: 'generated',
    generationPrompt: 'A beautiful sunset over mountains',
    creativeRoute: 'generate_fresh',
    aspectRatio: '16:9',
    ...overrides,
  });

const defaultProps = {
  asset: makeAsset(),
  onClose: vi.fn(),
  onDelete: vi.fn(),
  onDownload: vi.fn(),
  onRegenerate: vi.fn(),
  onRename: vi.fn(),
};

describe('AssetDetailPanel', () => {
  it('renders the detail panel with dialog role', () => {
    render(<AssetDetailPanel {...defaultProps} />);
    expect(screen.getByRole('dialog', { name: 'Asset detail panel' })).toBeDefined();
  });

  it('renders the close button', () => {
    render(<AssetDetailPanel {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Close detail panel' })).toBeDefined();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<AssetDetailPanel {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close detail panel' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders the full-size image preview', () => {
    render(<AssetDetailPanel {...defaultProps} />);
    const img = screen.getByRole('img', { name: 'Test Image' });
    expect(img).toBeDefined();
    expect(img.getAttribute('src')).toBe('data:image/png;base64,dGVzdA==');
  });

  it('displays asset dimensions', () => {
    render(<AssetDetailPanel {...defaultProps} />);
    expect(screen.getByText('1024 × 768')).toBeDefined();
  });

  it('displays creation timestamp', () => {
    render(<AssetDetailPanel {...defaultProps} />);
    const formattedDate = new Date('2024-01-15T10:30:00.000Z').toLocaleString();
    expect(screen.getByText(formattedDate)).toBeDefined();
  });

  it('displays source type', () => {
    render(<AssetDetailPanel {...defaultProps} />);
    expect(screen.getByText('upload')).toBeDefined();
  });

  it('displays the asset name', () => {
    render(<AssetDetailPanel {...defaultProps} />);
    expect(screen.getByText('Test Image')).toBeDefined();
  });

  it('displays the asset description', () => {
    render(<AssetDetailPanel {...defaultProps} />);
    expect(screen.getByText('A test description')).toBeDefined();
  });

  describe('AI-generated asset metadata', () => {
    it('shows generation prompt for generated assets', () => {
      render(<AssetDetailPanel {...defaultProps} asset={makeGeneratedAsset()} />);
      expect(screen.getByText('A beautiful sunset over mountains')).toBeDefined();
    });

    it('shows creative route for generated assets', () => {
      render(<AssetDetailPanel {...defaultProps} asset={makeGeneratedAsset()} />);
      expect(screen.getByText('generate fresh')).toBeDefined();
    });

    it('shows aspect ratio for generated assets', () => {
      render(<AssetDetailPanel {...defaultProps} asset={makeGeneratedAsset()} />);
      expect(screen.getByText('16:9')).toBeDefined();
    });

    it('does not show generation info section for uploaded assets', () => {
      render(<AssetDetailPanel {...defaultProps} />);
      expect(screen.queryByText('Generation Info')).toBeNull();
    });
  });

  describe('Re-generate button', () => {
    it('shows re-generate button for generated assets', () => {
      render(<AssetDetailPanel {...defaultProps} asset={makeGeneratedAsset()} />);
      expect(screen.getByRole('button', { name: 'Re-generate with same settings' })).toBeDefined();
    });

    it('does not show re-generate button for uploaded assets', () => {
      render(<AssetDetailPanel {...defaultProps} />);
      expect(screen.queryByRole('button', { name: 'Re-generate with same settings' })).toBeNull();
    });

    it('calls onRegenerate when re-generate button is clicked', () => {
      const onRegenerate = vi.fn();
      const asset = makeGeneratedAsset();
      render(<AssetDetailPanel {...defaultProps} asset={asset} onRegenerate={onRegenerate} />);
      fireEvent.click(screen.getByRole('button', { name: 'Re-generate with same settings' }));
      expect(onRegenerate).toHaveBeenCalledWith(asset);
    });
  });

  describe('Download button', () => {
    it('renders download button', () => {
      render(<AssetDetailPanel {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'Download asset' })).toBeDefined();
    });

    it('calls onDownload when download button is clicked', () => {
      const onDownload = vi.fn();
      const asset = makeAsset();
      render(<AssetDetailPanel {...defaultProps} asset={asset} onDownload={onDownload} />);
      fireEvent.click(screen.getByRole('button', { name: 'Download asset' }));
      expect(onDownload).toHaveBeenCalledWith(asset);
    });
  });

  describe('Delete with confirmation', () => {
    it('renders delete button', () => {
      render(<AssetDetailPanel {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'Delete asset' })).toBeDefined();
    });

    it('shows confirmation dialog when delete is clicked', () => {
      render(<AssetDetailPanel {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'Delete asset' }));
      expect(screen.getByRole('alertdialog')).toBeDefined();
      expect(screen.getByText('Delete Asset?')).toBeDefined();
    });

    it('calls onDelete when deletion is confirmed', () => {
      const onDelete = vi.fn();
      render(<AssetDetailPanel {...defaultProps} onDelete={onDelete} />);
      fireEvent.click(screen.getByRole('button', { name: 'Delete asset' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }));
      expect(onDelete).toHaveBeenCalledWith('asset-1');
    });

    it('hides confirmation dialog when cancel is clicked', () => {
      render(<AssetDetailPanel {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'Delete asset' }));
      expect(screen.getByRole('alertdialog')).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel deletion' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    it('does not call onDelete when cancel is clicked', () => {
      const onDelete = vi.fn();
      render(<AssetDetailPanel {...defaultProps} onDelete={onDelete} />);
      fireEvent.click(screen.getByRole('button', { name: 'Delete asset' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel deletion' }));
      expect(onDelete).not.toHaveBeenCalled();
    });
  });

  describe('Inline rename', () => {
    it('enters name editing mode on click', () => {
      render(<AssetDetailPanel {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'Edit asset name' }));
      expect(screen.getByRole('textbox', { name: 'Asset name' })).toBeDefined();
    });

    it('calls onRename when name is changed and blurred', () => {
      const onRename = vi.fn();
      render(<AssetDetailPanel {...defaultProps} onRename={onRename} />);
      fireEvent.click(screen.getByRole('button', { name: 'Edit asset name' }));
      const input = screen.getByRole('textbox', { name: 'Asset name' });
      fireEvent.change(input, { target: { value: 'New Name' } });
      fireEvent.blur(input);
      expect(onRename).toHaveBeenCalledWith('asset-1', 'New Name', 'A test description');
    });

    it('enters description editing mode on click', () => {
      render(<AssetDetailPanel {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'Edit asset description' }));
      expect(screen.getByRole('textbox', { name: 'Asset description' })).toBeDefined();
    });

    it('calls onRename with updated description on blur', () => {
      const onRename = vi.fn();
      render(<AssetDetailPanel {...defaultProps} onRename={onRename} />);
      fireEvent.click(screen.getByRole('button', { name: 'Edit asset description' }));
      const textarea = screen.getByRole('textbox', { name: 'Asset description' });
      fireEvent.change(textarea, { target: { value: 'Updated description' } });
      fireEvent.blur(textarea);
      expect(onRename).toHaveBeenCalledWith('asset-1', 'Test Image', 'Updated description');
    });
  });

  describe('Keyboard support', () => {
    it('calls onClose when Escape is pressed', () => {
      const onClose = vi.fn();
      render(<AssetDetailPanel {...defaultProps} onClose={onClose} />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('closes delete confirmation on Escape instead of panel', () => {
      const onClose = vi.fn();
      render(<AssetDetailPanel {...defaultProps} onClose={onClose} />);
      fireEvent.click(screen.getByRole('button', { name: 'Delete asset' }));
      fireEvent.keyDown(document, { key: 'Escape' });
      // Should close the dialog, not the panel
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  it('action buttons have minimum touch target size', () => {
    render(<AssetDetailPanel {...defaultProps} asset={makeGeneratedAsset()} />);
    const downloadBtn = screen.getByRole('button', { name: 'Download asset' });
    const regenBtn = screen.getByRole('button', { name: 'Re-generate with same settings' });
    const deleteBtn = screen.getByRole('button', { name: 'Delete asset' });
    const closeBtn = screen.getByRole('button', { name: 'Close detail panel' });

    [downloadBtn, regenBtn, deleteBtn, closeBtn].forEach((btn) => {
      const className = btn.className;
      const hasMinSize =
        className.includes('min-w-[24px]') || className.includes('min-h-[24px]') ||
        className.includes('min-h-[36px]');
      expect(hasMinSize).toBe(true);
    });
  });
});
