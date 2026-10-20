import React, { useEffect, useCallback, useRef } from 'react';
import { StudioAsset, ReferenceRole, RoleAssignment } from './types';

export interface RoleAssignmentSheetProps {
  assets: StudioAsset[];
  roleAssignments: Map<string, RoleAssignment>;
  onUpdateRole: (assetId: string, role: ReferenceRole) => void;
  onUpdateInstructions: (assetId: string, preserve?: string, modify?: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const ROLE_OPTIONS: { value: ReferenceRole; label: string }[] = [
  { value: 'product', label: 'Product' },
  { value: 'person', label: 'Person' },
  { value: 'environment', label: 'Environment' },
  { value: 'style_guide', label: 'Style Guide' },
];

const MAX_INSTRUCTION_LENGTH = 200;

/**
 * RoleAssignmentSheet — modal/bottom-sheet for assigning Reference Roles
 * and preserve/modify instructions to selected assets before composite generation.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */
const RoleAssignmentSheet: React.FC<RoleAssignmentSheetProps> = ({
  assets,
  roleAssignments,
  onUpdateRole,
  onUpdateInstructions,
  onConfirm,
  onCancel,
}) => {
  const sheetRef = useRef<HTMLDivElement>(null);
  const firstFocusableRef = useRef<HTMLButtonElement>(null);

  // Escape key to cancel
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    },
    [onCancel]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Focus the first focusable element on mount
  useEffect(() => {
    firstFocusableRef.current?.focus();
  }, []);

  const getAssignment = (assetId: string): RoleAssignment => {
    return roleAssignments.get(assetId) || { role: 'product' };
  };

  const handleRoleChange = (assetId: string, role: ReferenceRole) => {
    onUpdateRole(assetId, role);
  };

  const handlePreserveChange = (assetId: string, value: string) => {
    const assignment = getAssignment(assetId);
    onUpdateInstructions(assetId, value.slice(0, MAX_INSTRUCTION_LENGTH), assignment.modify);
  };

  const handleModifyChange = (assetId: string, value: string) => {
    const assignment = getAssignment(assetId);
    onUpdateInstructions(assetId, assignment.preserve, value.slice(0, MAX_INSTRUCTION_LENGTH));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-studio-canvas/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="role-assignment-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={sheetRef}
        className="bg-studio-surface border border-studio-border rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-studio-border shrink-0">
          <h2
            id="role-assignment-title"
            className="text-white font-semibold text-lg"
          >
            Assign Reference Roles
          </h2>
          <button
            ref={firstFocusableRef}
            type="button"
            onClick={onCancel}
            className="min-w-[24px] min-h-[24px] p-1 rounded text-gray-400 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            aria-label="Close role assignment"
          >
            ✕
          </button>
        </div>

        {/* Asset list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {assets.map((asset) => {
            const assignment = getAssignment(asset.id);
            const preserveLength = (assignment.preserve || '').length;
            const modifyLength = (assignment.modify || '').length;

            return (
              <div
                key={asset.id}
                className="flex flex-col gap-3 p-4 rounded-lg bg-studio-canvas/20 border border-studio-border"
              >
                {/* Asset info row */}
                <div className="flex items-center gap-3">
                  {/* Thumbnail */}
                  <img
                    src={`data:${asset.mimeType};base64,${asset.base64}`}
                    alt={asset.name || 'Asset thumbnail'}
                    className="w-12 h-12 object-cover rounded-md border border-studio-border shrink-0"
                  />

                  {/* Name and role */}
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">
                      {asset.name || 'Untitled'}
                    </p>
                  </div>

                  {/* Role dropdown */}
                  <select
                    value={assignment.role}
                    onChange={(e) => handleRoleChange(asset.id, e.target.value as ReferenceRole)}
                    className="min-w-[130px] min-h-[36px] px-3 py-1.5 rounded-lg bg-studio-canvas/30 border border-studio-border text-white text-sm appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                    aria-label={`Role for ${asset.name || 'asset'}`}
                  >
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Instruction fields */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Preserve field */}
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor={`preserve-${asset.id}`}
                      className="text-xs text-gray-400 font-medium"
                    >
                      Preserve
                    </label>
                    <input
                      id={`preserve-${asset.id}`}
                      type="text"
                      value={assignment.preserve || ''}
                      onChange={(e) => handlePreserveChange(asset.id, e.target.value)}
                      placeholder="What to keep..."
                      maxLength={MAX_INSTRUCTION_LENGTH}
                      className="w-full px-3 py-2 rounded-lg bg-studio-canvas/30 border border-studio-border text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                      aria-label={`Preserve instructions for ${asset.name || 'asset'}`}
                    />
                    <span className="text-xs text-gray-500 self-end">
                      {preserveLength}/{MAX_INSTRUCTION_LENGTH}
                    </span>
                  </div>

                  {/* Modify field */}
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor={`modify-${asset.id}`}
                      className="text-xs text-gray-400 font-medium"
                    >
                      Modify
                    </label>
                    <input
                      id={`modify-${asset.id}`}
                      type="text"
                      value={assignment.modify || ''}
                      onChange={(e) => handleModifyChange(asset.id, e.target.value)}
                      placeholder="What to change..."
                      maxLength={MAX_INSTRUCTION_LENGTH}
                      className="w-full px-3 py-2 rounded-lg bg-studio-canvas/30 border border-studio-border text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                      aria-label={`Modify instructions for ${asset.name || 'asset'}`}
                    />
                    <span className="text-xs text-gray-500 self-end">
                      {modifyLength}/{MAX_INSTRUCTION_LENGTH}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer with action buttons */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-studio-border shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="min-w-[24px] min-h-[36px] px-4 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            aria-label="Cancel role assignment"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-w-[24px] min-h-[36px] px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            aria-label="Confirm role assignments"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

export default RoleAssignmentSheet;
