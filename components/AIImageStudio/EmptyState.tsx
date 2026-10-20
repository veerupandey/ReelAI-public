import React from 'react';

/**
 * Props for the EmptyState component.
 */
export interface EmptyStateProps {
  onUpload: () => void;
  onImportUrl: () => void;
  onGenerateFresh: () => void;
}

/**
 * EmptyState — A clean, focused landing screen for the AI Image Studio.
 * Designed after studying Ideogram's minimal landing UX:
 * one clear hero action, two supporting entry points, no feature grid clutter.
 *
 * Requirements: 1.2, 1.3, 11.1, 11.2, 11.4
 */
const EmptyState: React.FC<EmptyStateProps> = ({ onUpload, onImportUrl, onGenerateFresh }) => {
  return (
    <div className="relative flex flex-col items-center justify-center min-h-[80vh] px-6 overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute top-[18%] left-[18%] w-[420px] h-[320px] bg-studio-accent/20 rounded-full blur-[120px]" />
        <div className="absolute top-[30%] right-[12%] w-[360px] h-[280px] bg-studio-warm/15 rounded-full blur-[110px]" />
      </div>

      <div className="relative z-10 flex flex-col items-center w-full max-w-sm text-center">

        {/* Icon mark */}
        <div className="mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-studio-accent to-studio-accent-strong flex items-center justify-center shadow-xl shadow-studio-accent/25 mx-auto">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
            </svg>
          </div>
        </div>

        {/* Headline */}
        <h1 className="text-3xl font-semibold text-studio-ink tracking-tight mb-2">
          Image Studio
        </h1>
        <p className="text-studio-mist text-sm leading-relaxed mb-10">
          Generate and edit professional product images with AI
        </p>

        {/* Primary CTA */}
        <button
          type="button"
          onClick={onGenerateFresh}
          className="w-full min-h-[48px] px-6 py-3 rounded-xl bg-gradient-to-r from-studio-accent to-studio-accent-strong text-white font-semibold text-sm shadow-lg shadow-studio-accent/20 hover:from-studio-accent hover:to-teal-400 hover:shadow-xl hover:shadow-studio-accent/25 active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-studio-accent focus:ring-offset-2 focus:ring-offset-studio-canvas transition-all duration-150 mb-3"
        >
          Start with a prompt
        </button>

        {/* Secondary options */}
        <div className="flex gap-2 w-full">
          <button
            type="button"
            onClick={onUpload}
            className="flex-1 min-h-[40px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-studio-surface/70 border border-studio-border text-studio-mist text-sm font-medium hover:bg-studio-panel hover:text-studio-ink focus:outline-none focus:ring-1 focus:ring-studio-accent/50 focus:ring-offset-1 focus:ring-offset-studio-canvas transition-all"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            Upload
          </button>
          <button
            type="button"
            onClick={onImportUrl}
            className="flex-1 min-h-[40px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-studio-surface/70 border border-studio-border text-studio-mist text-sm font-medium hover:bg-studio-panel hover:text-studio-ink focus:outline-none focus:ring-1 focus:ring-studio-accent/50 focus:ring-offset-1 focus:ring-offset-studio-canvas transition-all"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.07-9.07l4.5-4.5a4.5 4.5 0 016.364 6.364l-1.757 1.757" />
            </svg>
            Product URL
          </button>
        </div>

        <p className="mt-8 text-studio-mist/50 text-[11px]">
          Drag & drop images anywhere · Supports Shopify URLs
        </p>
      </div>
    </div>
  );
};

export default EmptyState;
