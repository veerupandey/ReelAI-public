import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ExportComplianceMode } from './exportComplianceGate';
import type { AspectRatio } from './types';
import {
  formatAdaptTargetDetail,
  formatAdaptTargetLabel,
  getBatchAdaptFormatTargets,
} from './adaptFormatService';

export interface StudioToolbarProps {
  viewMode: 'default' | 'compact';
  multiSelectEnabled: boolean;
  selectedCount: number;
  postQueueCount?: number;
  onViewModeChange: (mode: 'default' | 'compact') => void;
  onMultiSelectToggle: () => void;
  onClearSelection: () => void;
  onClearPostQueue?: () => void;
  onOpenPostComposer?: () => void;
  onExportSelected: () => void;
  onCompareSelected?: () => void;
  /** Batch regenerate selected images into a target canvas (A+, 4:5, etc.). */
  onAdaptSelectedFormat?: (target: AspectRatio) => void;
  isAdaptingSelected?: boolean;
  totalAssetCount: number;
  exportComplianceMode?: ExportComplianceMode;
  onExportComplianceModeChange?: (mode: ExportComplianceMode) => void;
  exportBlocked?: boolean;
}

const toolBtn =
  'inline-flex items-center justify-center gap-1.5 min-w-[24px] min-h-[24px] h-8 px-2.5 rounded-md text-[11px] font-medium tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-studio-accent/50 focus:ring-offset-1 focus:ring-offset-studio-surface';

const toolBtnIdle = `${toolBtn} text-studio-mist hover:text-studio-ink hover:bg-white/8`;
const toolBtnActive = `${toolBtn} bg-studio-accent/90 text-white shadow-sm shadow-studio-accent/20`;

/**
 * StudioToolbar — visual chrome for gallery controls.
 * Behavior unchanged; icons/labels polished for a product feel.
 */
const StudioToolbar: React.FC<StudioToolbarProps> = ({
  viewMode,
  multiSelectEnabled,
  selectedCount,
  postQueueCount = 0,
  onViewModeChange,
  onMultiSelectToggle,
  onClearSelection,
  onClearPostQueue,
  onOpenPostComposer,
  onExportSelected,
  onCompareSelected,
  onAdaptSelectedFormat,
  isAdaptingSelected = false,
  totalAssetCount,
  exportComplianceMode = 'off',
  onExportComplianceModeChange,
  exportBlocked = false,
}) => {
  const [adaptOpen, setAdaptOpen] = useState(false);
  const [adaptMenuPos, setAdaptMenuPos] = useState<{ top: number; left: number } | null>(null);
  const adaptTriggerRef = useRef<HTMLButtonElement>(null);
  const adaptMenuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!adaptOpen || !adaptTriggerRef.current) {
      setAdaptMenuPos(null);
      return;
    }
    const update = () => {
      const rect = adaptTriggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAdaptMenuPos({
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 240)),
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [adaptOpen]);

  useEffect(() => {
    if (!adaptOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (adaptMenuRef.current?.contains(t) || adaptTriggerRef.current?.contains(t)) return;
      setAdaptOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAdaptOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [adaptOpen]);

  useEffect(() => {
    if (selectedCount === 0) setAdaptOpen(false);
  }, [selectedCount]);

  return (
    <div
      className="relative z-40 flex items-center gap-1.5 px-2 py-1.5 bg-studio-surface/90 backdrop-blur-sm border border-studio-border/80 rounded-xl shadow-sm shadow-black/20 overflow-visible"
      role="toolbar"
      aria-label="Studio toolbar"
    >
      <div
        className="flex items-center rounded-lg bg-studio-canvas/50 p-0.5 border border-studio-border/60"
        role="group"
        aria-label="View mode"
      >
        <button
          type="button"
          onClick={() => onViewModeChange('default')}
          className={viewMode === 'default' ? toolBtnActive : toolBtnIdle}
          aria-pressed={viewMode === 'default'}
          aria-label="Default view"
          title="Default grid"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
          </svg>
          <span className="hidden sm:inline">Grid</span>
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange('compact')}
          className={viewMode === 'compact' ? toolBtnActive : toolBtnIdle}
          aria-pressed={viewMode === 'compact'}
          aria-label="Compact view"
          title="Compact grid"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5" />
          </svg>
          <span className="hidden sm:inline">Compact</span>
        </button>
      </div>

      <div className="w-px h-5 bg-studio-border/70" aria-hidden="true" />

      <button
        type="button"
        onClick={onMultiSelectToggle}
        className={multiSelectEnabled ? toolBtnActive : toolBtnIdle}
        aria-pressed={multiSelectEnabled}
        aria-label="Multi-select"
        title="Multi-select"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="hidden sm:inline">Select</span>
      </button>

      {selectedCount > 0 && (
        <span className="text-[11px] text-teal-100/90 tabular-nums" aria-live="polite">
          {selectedCount} selected
        </span>
      )}

      {selectedCount > 0 && (
        <button
          type="button"
          onClick={onClearSelection}
          className={toolBtnIdle}
          aria-label="Clear selected images"
          title="Clear selection"
        >
          Clear
        </button>
      )}

      {onAdaptSelectedFormat && selectedCount > 0 && (
        <>
          <button
            ref={adaptTriggerRef}
            type="button"
            onClick={() => setAdaptOpen((v) => !v)}
            disabled={isAdaptingSelected}
            className={`${toolBtn} border border-cyan-500/35 bg-cyan-500/15 text-cyan-50 hover:bg-cyan-500/25 disabled:opacity-40`}
            aria-expanded={adaptOpen}
            aria-haspopup="menu"
            aria-label="Regenerate selected in format"
            title="Regenerate each selected image in a target format (same content, new canvas)"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
            <span className="hidden sm:inline">
              {isAdaptingSelected ? 'Adapting…' : 'Adapt format'}
            </span>
          </button>
          {adaptOpen && !isAdaptingSelected && adaptMenuPos && createPortal(
            <div
              ref={adaptMenuRef}
              role="menu"
              className="fixed z-[100] w-56 rounded-xl border border-studio-border bg-studio-surface shadow-2xl shadow-black/60 overflow-hidden"
              style={{ top: adaptMenuPos.top, left: adaptMenuPos.left }}
            >
              <p className="px-3 pt-2.5 pb-1 text-[10px] uppercase tracking-widest text-gray-500 font-semibold">
                Regenerate {selectedCount} → format
              </p>
              <p className="px-3 pb-2 text-[10px] text-gray-600 leading-snug">
                Same images, reframed for the new canvas (not a crop).
              </p>
              {getBatchAdaptFormatTargets().map((target) => (
                <button
                  key={target}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAdaptOpen(false);
                    onAdaptSelectedFormat(target);
                  }}
                  className="w-full px-3 py-2 text-left text-[11px] text-gray-200 hover:bg-cyan-500/15 hover:text-cyan-50 transition-colors"
                >
                  <span className="font-semibold">{formatAdaptTargetLabel(target)}</span>
                  <span className="block text-[10px] text-gray-500 mt-0.5">
                    {formatAdaptTargetDetail(target)}
                  </span>
                </button>
              ))}
            </div>,
            document.body,
          )}
        </>
      )}

      {onCompareSelected && selectedCount >= 2 && (
        <button
          type="button"
          onClick={onCompareSelected}
          className={`${toolBtn} border border-emerald-500/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20`}
          aria-label="Compare selected"
          title="Compare selected"
        >
          Compare
        </button>
      )}

      {postQueueCount > 0 && (
        <>
          <div className="w-px h-5 bg-studio-border/70" aria-hidden="true" />
          <span className="text-[11px] text-rose-200/90 tabular-nums" aria-live="polite">
            Queue {postQueueCount}
          </span>
          {onOpenPostComposer && (
            <button
              type="button"
              onClick={onOpenPostComposer}
              className={`${toolBtn} bg-gradient-to-r from-[#f09433] to-[#dc2743] text-white hover:opacity-90`}
              aria-label="Open Instagram post composer"
              title="Compose Instagram post"
            >
              Instagram
            </button>
          )}
          {onClearPostQueue && (
            <button
              type="button"
              onClick={onClearPostQueue}
              className={toolBtnIdle}
              aria-label="Clear Instagram post queue"
              title="Clear post queue"
            >
              Clear queue
            </button>
          )}
        </>
      )}

      <div className="flex-1" />

      {onExportComplianceModeChange && totalAssetCount > 0 && (
        <button
          type="button"
          onClick={() =>
            onExportComplianceModeChange(exportComplianceMode === 'strict' ? 'off' : 'strict')
          }
          className={
            exportComplianceMode === 'strict'
              ? `${toolBtn} bg-amber-500/90 text-white`
              : toolBtnIdle
          }
          aria-pressed={exportComplianceMode === 'strict'}
          aria-label="Strict export compliance"
          title="Block export when selected assets fail brand compliance"
        >
          Strict
        </button>
      )}

      {totalAssetCount > 0 && (
        <button
          type="button"
          onClick={onExportSelected}
          disabled={exportBlocked}
          className={`${toolBtnIdle} disabled:opacity-40 disabled:cursor-not-allowed`}
          aria-label={
            selectedCount > 0
              ? `Export pack for ${selectedCount} selected`
              : 'Export Instagram pack'
          }
          title={
            exportBlocked
              ? 'Export blocked — fix failing compliance assets or turn off Strict export'
              : 'Export pack'
          }
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          <span className="hidden sm:inline">
            {selectedCount > 0 ? `Pack (${selectedCount})` : 'Export'}
          </span>
        </button>
      )}
    </div>
  );
};

export default StudioToolbar;
