import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import ProductionBriefPanel from '../../components/AIImageStudio/ProductionBriefPanel';
import type { ProductionBrief } from '../../components/AIImageStudio/productionBriefService';

function makeBrief(overrides: Partial<ProductionBrief> = {}): ProductionBrief {
  return {
    summary: 'Production brief for "Quiet Matcha Ritual" | Mode: recreate',
    generationPrompt: 'PRESERVATION REQUIREMENTS\n- CRITICAL: Preserve tin label',
    preservationInstructions: ['CRITICAL: Preserve tin label', 'STRATEGIST: Keep framing'],
    referenceRoles: [],
    recommendedAspectRatio: '9:16',
    avoidList: ['Avoid generic stock photo aesthetic', 'Honor constraint: No medical claims'],
    provenance: {
      preservationFrom: 'Product Truth',
      conceptFrom: 'Selected concept: Quiet Matcha Ritual',
    },
    ...overrides,
  };
}

describe('ProductionBriefPanel', () => {
  it('renders summary, prompt, preserve, and avoid lists', () => {
    render(
      <ProductionBriefPanel
        brief={makeBrief()}
        onApplyPrompt={vi.fn()}
        onDevelopInWriter={vi.fn()}
      />,
    );

    expect(screen.getByTestId('production-brief-panel')).toBeDefined();
    expect(screen.getByText(/Quiet Matcha Ritual/)).toBeDefined();
    expect(screen.getByLabelText('Generation prompt')).toHaveProperty(
      'value',
      expect.stringContaining('PRESERVATION REQUIREMENTS'),
    );
    expect(screen.getByText('CRITICAL: Preserve tin label')).toBeDefined();
    expect(screen.getByText('Avoid generic stock photo aesthetic')).toBeDefined();
  });

  it('calls apply and writer callbacks with the edited prompt', () => {
    const onApplyPrompt = vi.fn();
    const onDevelopInWriter = vi.fn();
    const onPromptChange = vi.fn();

    render(
      <ProductionBriefPanel
        brief={makeBrief()}
        onApplyPrompt={onApplyPrompt}
        onDevelopInWriter={onDevelopInWriter}
        onPromptChange={onPromptChange}
      />,
    );

    const textarea = screen.getByLabelText('Generation prompt');
    fireEvent.change(textarea, { target: { value: 'Edited production prompt' } });
    expect(onPromptChange).toHaveBeenCalledWith('Edited production prompt');

    fireEvent.click(screen.getByRole('button', { name: 'Apply to composer' }));
    expect(onApplyPrompt).toHaveBeenCalledWith('Edited production prompt');

    fireEvent.click(screen.getByRole('button', { name: 'Develop in Writer' }));
    expect(onDevelopInWriter).toHaveBeenCalledWith('Edited production prompt');
  });
});
