import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import EmptyState from '../../components/AIImageStudio/EmptyState';

describe('EmptyState', () => {
  const defaultProps = {
    onUpload: vi.fn(),
    onImportUrl: vi.fn(),
    onGenerateFresh: vi.fn(),
  };

  it('renders the heading', () => {
    render(<EmptyState {...defaultProps} />);
    expect(screen.getByText('Image Studio')).toBeTruthy();
  });

  it('renders the subtitle', () => {
    render(<EmptyState {...defaultProps} />);
    expect(screen.getByText(/Generate and edit professional product images/)).toBeTruthy();
  });

  it('renders Start Creating button', () => {
    render(<EmptyState {...defaultProps} />);
    expect(screen.getByRole('button', { name: /Start with a prompt/i })).toBeTruthy();
  });

  it('renders Upload Images button', () => {
    render(<EmptyState {...defaultProps} />);
    expect(screen.getByRole('button', { name: /Upload/i })).toBeTruthy();
  });

  it('renders Import Product URL button', () => {
    render(<EmptyState {...defaultProps} />);
    expect(screen.getByRole('button', { name: /Product URL/i })).toBeTruthy();
  });

  it('calls onUpload when Upload Images button is clicked', () => {
    render(<EmptyState {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Upload/i }));
    expect(defaultProps.onUpload).toHaveBeenCalledTimes(1);
  });

  it('calls onImportUrl when Import Product URL button is clicked', () => {
    render(<EmptyState {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Product URL/i }));
    expect(defaultProps.onImportUrl).toHaveBeenCalledTimes(1);
  });

  it('calls onGenerateFresh when Start Creating button is clicked', () => {
    render(<EmptyState {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Start with a prompt/i }));
    expect(defaultProps.onGenerateFresh).toHaveBeenCalledTimes(1);
  });

  it('renders three action buttons', () => {
    render(<EmptyState {...defaultProps} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
  });

  it('buttons have minimum touch targets', () => {
    render(<EmptyState {...defaultProps} />);
    const buttons = screen.getAllByRole('button');
    buttons.forEach((button) => {
      expect(
        button.className.includes('min-h-[48px]') ||
        button.className.includes('min-h-[40px]') ||
        button.className.includes('min-h-[44px]')
      ).toBeTruthy();
    });
  });

  it('buttons are keyboard accessible', () => {
    render(<EmptyState {...defaultProps} />);
    const buttons = screen.getAllByRole('button');
    buttons.forEach((button) => {
      expect(button.getAttribute('type')).toBe('button');
    });
  });

  it('shows drag and drop hint', () => {
    render(<EmptyState {...defaultProps} />);
    expect(screen.getByText(/Drag & drop images anywhere/)).toBeTruthy();
  });
});
