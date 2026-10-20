import React from 'react';

interface Props {
  sceneReadiness: { isReady: boolean; message: string };
  sceneCount: number;
  onBack: () => void;
  onConfirm: () => void;
}

const ProductLockFooter: React.FC<Props> = ({
  sceneReadiness,
  sceneCount,
  onBack,
  onConfirm,
}) => {
  const handleBack = () => {
    if (sceneCount > 0) {
      if (window.confirm("Going back will not delete your work. You can return to this screen to continue. Are you sure you want to go back?")) {
        onBack();
      }
    } else {
      onBack();
    }
  };

  return (
    <div className="flex justify-end gap-3">
      <button
        onClick={handleBack}
        className="px-5 py-3 rounded-xl bg-dark-bg border border-dark-border text-gray-300 transition-colors hover:text-white"
      >
        Back
      </button>
      <div className="space-y-3 text-right">
        <div className="rounded-xl border border-dark-border bg-dark-bg px-4 py-3 text-left text-sm text-gray-300">
          <p className="font-semibold text-white">Next: Script Studio</p>
          <p className="text-xs text-gray-400 mt-1">
            We will re-check the full scene plan, open the script workflow, then continue to preview, video render, and download.
          </p>
        </div>
        {!sceneReadiness.isReady && sceneCount > 0 && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-left flex items-start gap-2">
            <span className="text-amber-400 mt-0.5">⚠️</span>
            <p className="text-xs text-amber-200/90 leading-relaxed">{sceneReadiness.message}</p>
          </div>
        )}
        <button
          onClick={onConfirm}
          disabled={!sceneReadiness.isReady}
          className="px-5 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 text-white font-bold disabled:opacity-50 transition-opacity hover:opacity-90"
        >
          Open in Script Studio
        </button>
      </div>
    </div>
  );
};

export default ProductLockFooter;
