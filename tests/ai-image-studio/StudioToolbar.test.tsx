import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import StudioToolbar from '../../components/AIImageStudio/StudioToolbar';

const defaultProps = {
  viewMode: 'default' as const,
  multiSelectEnabled: false,
  selectedCount: 0,
  totalAssetCount: 0,
  onViewModeChange: vi.fn(),
  onMultiSelectToggle: vi.fn(),
  onClearSelection: vi.fn(),
  onExportSelected: vi.fn(),
};

describe('StudioToolbar', () => {
  it('renders the toolbar with correct role', () => {
    render(<StudioToolbar {...defaultProps} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Studio toolbar' });
    expect(toolbar).toBeDefined();
  });

  it('renders view mode toggle buttons', () => {
    render(<StudioToolbar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Default view' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Compact view' })).toBeDefined();
  });

  it('highlights the active view mode button', () => {
    render(<StudioToolbar {...defaultProps} viewMode="compact" />);
    expect(screen.getByRole('button', { name: 'Compact view' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Default view' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('calls onViewModeChange when view mode buttons are clicked', () => {
    const onViewModeChange = vi.fn();
    render(<StudioToolbar {...defaultProps} onViewModeChange={onViewModeChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Compact view' }));
    expect(onViewModeChange).toHaveBeenCalledWith('compact');

    fireEvent.click(screen.getByRole('button', { name: 'Default view' }));
    expect(onViewModeChange).toHaveBeenCalledWith('default');
  });

  it('renders multi-select toggle button', () => {
    render(<StudioToolbar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Multi-select' })).toBeDefined();
  });

  it('highlights multi-select button when enabled', () => {
    render(<StudioToolbar {...defaultProps} multiSelectEnabled={true} />);
    expect(screen.getByRole('button', { name: 'Multi-select' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('calls onMultiSelectToggle when multi-select button is clicked', () => {
    const onMultiSelectToggle = vi.fn();
    render(<StudioToolbar {...defaultProps} onMultiSelectToggle={onMultiSelectToggle} />);

    fireEvent.click(screen.getByRole('button', { name: 'Multi-select' }));
    expect(onMultiSelectToggle).toHaveBeenCalledOnce();
  });

  it('shows selected count whenever images are selected', () => {
    render(<StudioToolbar {...defaultProps} selectedCount={3} />);
    expect(screen.getByText('3 selected')).toBeDefined();
  });

  it('shows selected count when multi-select is enabled and items are selected', () => {
    render(<StudioToolbar {...defaultProps} multiSelectEnabled={true} selectedCount={5} />);
    expect(screen.getByText('5 selected')).toBeDefined();
  });

  it('does not show selected count when count is 0', () => {
    render(<StudioToolbar {...defaultProps} multiSelectEnabled={true} selectedCount={0} />);
    expect(screen.queryByText('0 selected')).toBeNull();
  });

  it('shows clear selected images button when items are selected', () => {
    render(<StudioToolbar {...defaultProps} selectedCount={3} />);
    expect(screen.getByRole('button', { name: 'Clear selected images' })).toBeDefined();
  });

  it('does not show clear button when no items are selected', () => {
    render(<StudioToolbar {...defaultProps} multiSelectEnabled={true} selectedCount={0} />);
    expect(screen.queryByRole('button', { name: 'Clear selected images' })).toBeNull();
  });

  it('calls onClearSelection when clear button is clicked', () => {
    const onClearSelection = vi.fn();
    render(
      <StudioToolbar
        {...defaultProps}
        selectedCount={3}
        onClearSelection={onClearSelection}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear selected images' }));
    expect(onClearSelection).toHaveBeenCalledOnce();
  });

  it('all buttons have minimum 24x24px touch targets', () => {
    render(<StudioToolbar {...defaultProps} multiSelectEnabled={true} selectedCount={2} />);
    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn) => {
      // Check that min-w-[24px] and min-h-[24px] classes are applied
      expect(btn.className).toContain('min-w-[24px]');
      expect(btn.className).toContain('min-h-[24px]');
    });
  });

  it('toggles strict export mode and disables export when blocked', () => {
    const onMode = vi.fn();
    render(
      <StudioToolbar
        {...defaultProps}
        totalAssetCount={2}
        exportComplianceMode="off"
        onExportComplianceModeChange={onMode}
        exportBlocked
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Strict export compliance' }));
    expect(onMode).toHaveBeenCalledWith('strict');
    expect(
      (screen.getByRole('button', { name: 'Export Instagram pack' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
