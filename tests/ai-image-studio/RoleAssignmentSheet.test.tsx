import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import RoleAssignmentSheet from '../../components/AIImageStudio/RoleAssignmentSheet';
import { StudioAsset, RoleAssignment } from '../../components/AIImageStudio/types';

const makeAsset = (overrides: Partial<StudioAsset> = {}): StudioAsset => ({
  id: 'asset-1',
  name: 'Product Shot',
  description: 'A product image',
  base64: 'dGVzdA==',
  mimeType: 'image/png',
  width: 800,
  height: 600,
  source: 'upload',
  createdAt: '2024-01-15T10:30:00.000Z',
  ...overrides,
});

const makeAssets = (): StudioAsset[] => [
  makeAsset({ id: 'asset-1', name: 'Product Shot' }),
  makeAsset({ id: 'asset-2', name: 'Model Photo' }),
  makeAsset({ id: 'asset-3', name: 'Background Scene' }),
];

const defaultProps = {
  assets: makeAssets(),
  roleAssignments: new Map<string, RoleAssignment>([
    ['asset-1', { role: 'product' as const }],
    ['asset-2', { role: 'person' as const }],
    ['asset-3', { role: 'environment' as const }],
  ]),
  onUpdateRole: vi.fn(),
  onUpdateInstructions: vi.fn(),
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

describe('RoleAssignmentSheet', () => {
  it('renders as a modal dialog', () => {
    render(<RoleAssignmentSheet {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('displays the title "Assign Reference Roles"', () => {
    render(<RoleAssignmentSheet {...defaultProps} />);
    expect(screen.getByText('Assign Reference Roles')).toBeDefined();
  });

  it('renders each asset with its name', () => {
    render(<RoleAssignmentSheet {...defaultProps} />);
    expect(screen.getByText('Product Shot')).toBeDefined();
    expect(screen.getByText('Model Photo')).toBeDefined();
    expect(screen.getByText('Background Scene')).toBeDefined();
  });

  it('renders thumbnails for each asset', () => {
    render(<RoleAssignmentSheet {...defaultProps} />);
    const images = screen.getAllByRole('img');
    expect(images.length).toBe(3);
    expect(images[0].getAttribute('src')).toBe('data:image/png;base64,dGVzdA==');
  });

  it('displays role dropdowns with correct current values', () => {
    render(<RoleAssignmentSheet {...defaultProps} />);
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(3);
    expect((selects[0] as HTMLSelectElement).value).toBe('product');
    expect((selects[1] as HTMLSelectElement).value).toBe('person');
    expect((selects[2] as HTMLSelectElement).value).toBe('environment');
  });

  it('defaults to product role for assets without assignment', () => {
    const props = {
      ...defaultProps,
      roleAssignments: new Map<string, RoleAssignment>(),
    };
    render(<RoleAssignmentSheet {...props} />);
    const selects = screen.getAllByRole('combobox');
    selects.forEach((select) => {
      expect((select as HTMLSelectElement).value).toBe('product');
    });
  });

  it('calls onUpdateRole when role is changed', () => {
    const onUpdateRole = vi.fn();
    render(<RoleAssignmentSheet {...defaultProps} onUpdateRole={onUpdateRole} />);
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'style_guide' } });
    expect(onUpdateRole).toHaveBeenCalledWith('asset-1', 'style_guide');
  });

  it('renders preserve and modify input fields for each asset', () => {
    render(<RoleAssignmentSheet {...defaultProps} />);
    const preserveInputs = screen.getAllByPlaceholderText('What to keep...');
    const modifyInputs = screen.getAllByPlaceholderText('What to change...');
    expect(preserveInputs.length).toBe(3);
    expect(modifyInputs.length).toBe(3);
  });

  it('calls onUpdateInstructions when preserve field changes', () => {
    const onUpdateInstructions = vi.fn();
    render(<RoleAssignmentSheet {...defaultProps} onUpdateInstructions={onUpdateInstructions} />);
    const preserveInputs = screen.getAllByPlaceholderText('What to keep...');
    fireEvent.change(preserveInputs[0], { target: { value: 'Keep the logo' } });
    expect(onUpdateInstructions).toHaveBeenCalledWith('asset-1', 'Keep the logo', undefined);
  });

  it('calls onUpdateInstructions when modify field changes', () => {
    const onUpdateInstructions = vi.fn();
    render(<RoleAssignmentSheet {...defaultProps} onUpdateInstructions={onUpdateInstructions} />);
    const modifyInputs = screen.getAllByPlaceholderText('What to change...');
    fireEvent.change(modifyInputs[1], { target: { value: 'Change background' } });
    expect(onUpdateInstructions).toHaveBeenCalledWith('asset-2', undefined, 'Change background');
  });

  it('displays character count for preserve field', () => {
    const assignments = new Map<string, RoleAssignment>([
      ['asset-1', { role: 'product', preserve: 'Keep colors' }],
      ['asset-2', { role: 'person' }],
      ['asset-3', { role: 'environment' }],
    ]);
    render(<RoleAssignmentSheet {...defaultProps} roleAssignments={assignments} />);
    expect(screen.getByText('11/200')).toBeDefined();
  });

  it('displays character count for modify field', () => {
    const assignments = new Map<string, RoleAssignment>([
      ['asset-1', { role: 'product', modify: 'Change bg' }],
      ['asset-2', { role: 'person' }],
      ['asset-3', { role: 'environment' }],
    ]);
    render(<RoleAssignmentSheet {...defaultProps} roleAssignments={assignments} />);
    expect(screen.getByText('9/200')).toBeDefined();
  });

  it('enforces 200 character limit on preserve field', () => {
    const onUpdateInstructions = vi.fn();
    render(<RoleAssignmentSheet {...defaultProps} onUpdateInstructions={onUpdateInstructions} />);
    const preserveInputs = screen.getAllByPlaceholderText('What to keep...');
    const longText = 'a'.repeat(250);
    fireEvent.change(preserveInputs[0], { target: { value: longText } });
    expect(onUpdateInstructions).toHaveBeenCalledWith('asset-1', 'a'.repeat(200), undefined);
  });

  it('enforces 200 character limit on modify field', () => {
    const onUpdateInstructions = vi.fn();
    render(<RoleAssignmentSheet {...defaultProps} onUpdateInstructions={onUpdateInstructions} />);
    const modifyInputs = screen.getAllByPlaceholderText('What to change...');
    const longText = 'b'.repeat(250);
    fireEvent.change(modifyInputs[0], { target: { value: longText } });
    expect(onUpdateInstructions).toHaveBeenCalledWith('asset-1', undefined, 'b'.repeat(200));
  });

  it('allows multiple assets to share the same role', () => {
    const assignments = new Map<string, RoleAssignment>([
      ['asset-1', { role: 'product' }],
      ['asset-2', { role: 'product' }],
      ['asset-3', { role: 'product' }],
    ]);
    render(<RoleAssignmentSheet {...defaultProps} roleAssignments={assignments} />);
    const selects = screen.getAllByRole('combobox');
    selects.forEach((select) => {
      expect((select as HTMLSelectElement).value).toBe('product');
    });
  });

  describe('Action buttons', () => {
    it('renders Confirm button', () => {
      render(<RoleAssignmentSheet {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'Confirm role assignments' })).toBeDefined();
    });

    it('renders Cancel button', () => {
      render(<RoleAssignmentSheet {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'Cancel role assignment' })).toBeDefined();
    });

    it('calls onConfirm when Confirm is clicked', () => {
      const onConfirm = vi.fn();
      render(<RoleAssignmentSheet {...defaultProps} onConfirm={onConfirm} />);
      fireEvent.click(screen.getByRole('button', { name: 'Confirm role assignments' }));
      expect(onConfirm).toHaveBeenCalledOnce();
    });

    it('calls onCancel when Cancel is clicked', () => {
      const onCancel = vi.fn();
      render(<RoleAssignmentSheet {...defaultProps} onCancel={onCancel} />);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel role assignment' }));
      expect(onCancel).toHaveBeenCalledOnce();
    });
  });

  describe('Keyboard support', () => {
    it('calls onCancel when Escape is pressed', () => {
      const onCancel = vi.fn();
      render(<RoleAssignmentSheet {...defaultProps} onCancel={onCancel} />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onCancel).toHaveBeenCalledOnce();
    });
  });

  describe('Backdrop click', () => {
    it('calls onCancel when backdrop is clicked', () => {
      const onCancel = vi.fn();
      render(<RoleAssignmentSheet {...defaultProps} onCancel={onCancel} />);
      const backdrop = screen.getByRole('dialog');
      fireEvent.click(backdrop);
      expect(onCancel).toHaveBeenCalledOnce();
    });
  });

  describe('Accessibility', () => {
    it('has aria-modal attribute', () => {
      render(<RoleAssignmentSheet {...defaultProps} />);
      const dialog = screen.getByRole('dialog');
      expect(dialog.getAttribute('aria-modal')).toBe('true');
    });

    it('has aria-labelledby pointing to the title', () => {
      render(<RoleAssignmentSheet {...defaultProps} />);
      const dialog = screen.getByRole('dialog');
      expect(dialog.getAttribute('aria-labelledby')).toBe('role-assignment-title');
      expect(document.getElementById('role-assignment-title')?.textContent).toBe('Assign Reference Roles');
    });

    it('role dropdowns have aria-labels', () => {
      render(<RoleAssignmentSheet {...defaultProps} />);
      expect(screen.getByLabelText('Role for Product Shot')).toBeDefined();
      expect(screen.getByLabelText('Role for Model Photo')).toBeDefined();
      expect(screen.getByLabelText('Role for Background Scene')).toBeDefined();
    });

    it('instruction fields have aria-labels', () => {
      render(<RoleAssignmentSheet {...defaultProps} />);
      expect(screen.getByLabelText('Preserve instructions for Product Shot')).toBeDefined();
      expect(screen.getByLabelText('Modify instructions for Product Shot')).toBeDefined();
    });
  });
});
