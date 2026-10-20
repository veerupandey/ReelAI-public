import React, { useState, useEffect, useRef } from 'react';

export interface CarouselSlideWithText {
  index: number;
  imageUrl: string;
  headline: string;
  body: string;
}

export interface TextOverlayStyle {
  fontSizeHeadline: number;
  fontSizeBody: number;
  positionX: number;
  positionY: number;
  textColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  fontFamily: string;
  textAlign: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing: number;
  textShadow: boolean;
  textShadowColor: string;
  textShadowBlur: number;
}

interface Props {
  slides: CarouselSlideWithText[];
  onExport: (slides: CarouselSlideWithText[], style: TextOverlayStyle) => Promise<void>;
  onCancel: () => void;
}

const FONT_OPTIONS = [
  { id: 'Helvetica', label: 'Helvetica' },
  { id: 'Georgia', label: 'Georgia' },
  { id: 'Arial', label: 'Arial' },
  { id: 'Times New Roman', label: 'Times New Roman' },
];

const DEFAULT_STYLE: TextOverlayStyle = {
  fontSizeHeadline: 52,
  fontSizeBody: 36,
  positionX: 50,
  positionY: 70,
  textColor: '#ffffff',
  backgroundColor: '#000000',
  backgroundOpacity: 0.6,
  fontFamily: 'Helvetica',
  textAlign: 'center',
  lineHeight: 1.2,
  letterSpacing: 0,
  textShadow: true,
  textShadowColor: '#000000',
  textShadowBlur: 4,
};

export const CarouselTextEditor: React.FC<Props> = ({ slides, onExport, onCancel }) => {
  const [selectedSlideIndex, setSelectedSlideIndex] = useState(0);
  const [style, setStyle] = useState<TextOverlayStyle>(DEFAULT_STYLE);
  const [editedSlides, setEditedSlides] = useState<CarouselSlideWithText[]>(slides);
  const [isExporting, setIsExporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedSlide = editedSlides[selectedSlideIndex];

  const updateSlideText = (index: number, field: 'headline' | 'body', value: string) => {
    setEditedSlides(prev => prev.map((slide, i) => 
      i === index ? { ...slide, [field]: value } : slide
    ));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedSlide) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      canvas.width = 1080;
      canvas.height = 1080;
      ctx.drawImage(img, 0, 0, 1080, 1080);

      const overlayHeight = 1080 * (1 - style.positionY / 100);
      const overlayY = 1080 - overlayHeight;

      ctx.fillStyle = `${style.backgroundColor}${Math.round(style.backgroundOpacity * 255).toString(16).padStart(2, '0')}`;
      ctx.fillRect(0, overlayY, 1080, overlayHeight);

      if (style.textShadow) {
        ctx.shadowColor = style.textShadowColor;
        ctx.shadowBlur = style.textShadowBlur;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 2;
      } else {
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      }

      const xPos = (style.positionX / 100) * 1080;

      if (selectedSlide.headline) {
        ctx.fillStyle = style.textColor;
        ctx.font = `bold ${style.fontSizeHeadline}px ${style.fontFamily}`;
        ctx.textAlign = style.textAlign;
        ctx.textBaseline = 'top';
        
        const headlineY = overlayY + 60;
        const lines = wrapText(ctx, selectedSlide.headline, 1080 - 120, style.fontSizeHeadline * style.lineHeight);
        lines.forEach((line, i) => {
          ctx.fillText(line, xPos, headlineY + i * style.fontSizeHeadline * style.lineHeight);
        });
      }

      if (selectedSlide.body) {
        ctx.fillStyle = style.textColor;
        ctx.font = `${style.fontSizeBody}px ${style.fontFamily}`;
        ctx.textAlign = style.textAlign;
        ctx.textBaseline = 'top';

        const headlineHeight = selectedSlide.headline ? 
          (wrapText(ctx, selectedSlide.headline, 1080 - 120, style.fontSizeHeadline * style.lineHeight).length * style.fontSizeHeadline * style.lineHeight) : 0;
        const bodyY = overlayY + 60 + headlineHeight + 30;
        
        const lines = wrapText(ctx, selectedSlide.body, 1080 - 120, style.fontSizeBody * style.lineHeight);
        lines.forEach((line, i) => {
          ctx.fillText(line, xPos, bodyY + i * style.fontSizeBody * style.lineHeight);
        });
      }

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    };
    img.src = selectedSlide.imageUrl;
  }, [selectedSlide, style]);

  const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number, lineHeight: number): string[] => {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = words[0] || '';

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const width = ctx.measureText(currentLine + ' ' + word).width;
      if (width < maxWidth) {
        currentLine += ' ' + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    lines.push(currentLine);
    return lines;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    setStyle(prev => ({
      ...prev,
      positionX: Math.max(5, Math.min(95, x)),
      positionY: Math.max(10, Math.min(90, y)),
    }));
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseDown = () => {
    setIsDragging(true);
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await onExport(editedSlides, style);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        <h2 className="text-white text-xl font-bold">Carousel Text Studio</h2>
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-800 rounded-lg p-1">
            <button
              onClick={() => setPreviewMode('desktop')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                previewMode === 'desktop' ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              Desktop
            </button>
            <button
              onClick={() => setPreviewMode('mobile')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                previewMode === 'mobile' ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              Mobile
            </button>
          </div>
          <button onClick={onCancel} className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600">
            Cancel
          </button>
          <button onClick={handleExport} disabled={isExporting} className="px-4 py-2 bg-gradient-to-r from-orange-500 to-pink-500 text-white rounded-lg hover:from-orange-600 hover:to-pink-600 disabled:opacity-50">
            {isExporting ? 'Exporting...' : 'Export Carousel'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-48 bg-slate-800 border-r border-slate-700 overflow-y-auto p-2">
          <h3 className="text-slate-400 text-xs uppercase tracking-wider mb-2">Slides</h3>
          {editedSlides.map((slide, index) => (
            <button
              key={index}
              onClick={() => setSelectedSlideIndex(index)}
              className={`w-full aspect-square rounded-lg overflow-hidden border-2 mb-2 transition-all ${
                selectedSlideIndex === index ? 'border-orange-500' : 'border-transparent hover:border-slate-600'
              }`}
            >
              <img src={slide.imageUrl} alt={`Slide ${index + 1}`} className="w-full h-full object-cover" />
            </button>
          ))}
        </div>

        <div className="flex-1 bg-slate-900 flex items-center justify-center p-8">
          <div ref={containerRef} className="relative" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              className={`rounded-lg shadow-2xl ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
              style={{ aspectRatio: '1/1', width: previewMode === 'mobile' ? '375px' : '600px' }}
            />
            <div className="absolute bottom-4 left-4 right-4 bg-black/50 text-white text-sm px-3 py-2 rounded-lg backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <span>Slide {selectedSlideIndex + 1} of {editedSlides.length}</span>
                {isDragging && <span className="text-orange-400 text-xs">Drag to reposition text</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="w-80 bg-slate-800 border-l border-slate-700 overflow-y-auto p-4">
          <div className="mb-6">
            <h3 className="text-white font-semibold mb-3">Text Content</h3>
            <div className="space-y-3">
              <div>
                <label className="text-slate-400 text-xs uppercase tracking-wider">Headline</label>
                <input
                  type="text"
                  value={selectedSlide.headline}
                  onChange={(e) => updateSlideText(selectedSlideIndex, 'headline', e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-slate-700 text-white rounded-lg border border-slate-600 focus:border-orange-500 focus:outline-none"
                  placeholder="Max 5 words"
                />
              </div>
              <div>
                <label className="text-slate-400 text-xs uppercase tracking-wider">Body</label>
                <textarea
                  value={selectedSlide.body}
                  onChange={(e) => updateSlideText(selectedSlideIndex, 'body', e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-slate-700 text-white rounded-lg border border-slate-600 focus:border-orange-500 focus:outline-none resize-none"
                  rows={2}
                  placeholder="Max 12 words"
                />
              </div>
            </div>
          </div>

          <div className="mb-6">
            <h3 className="text-white font-semibold mb-3">Typography</h3>
            <div className="space-y-3">
              <div>
                <label className="text-slate-400 text-xs uppercase tracking-wider">Font Family</label>
                <select
                  value={style.fontFamily}
                  onChange={(e) => setStyle({ ...style, fontFamily: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-slate-700 text-white rounded-lg border border-slate-600 focus:border-orange-500 focus:outline-none"
                >
                  {FONT_OPTIONS.map(opt => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-slate-400 text-xs uppercase tracking-wider">Headline Size: {style.fontSizeHeadline}px</label>
                <input
                  type="range"
                  min="32"
                  max="72"
                  value={style.fontSizeHeadline}
                  onChange={(e) => setStyle({ ...style, fontSizeHeadline: parseInt(e.target.value) })}
                  className="w-full mt-1"
                />
              </div>
              <div>
                <label className="text-slate-400 text-xs uppercase tracking-wider">Body Size: {style.fontSizeBody}px</label>
                <input
                  type="range"
                  min="24"
                  max="48"
                  value={style.fontSizeBody}
                  onChange={(e) => setStyle({ ...style, fontSizeBody: parseInt(e.target.value) })}
                  className="w-full mt-1"
                />
              </div>
              <div>
                <label className="text-slate-400 text-xs uppercase tracking-wider">Line Height: {style.lineHeight.toFixed(1)}</label>
                <input
                  type="range"
                  min="1.0"
                  max="2.0"
                  step="0.1"
                  value={style.lineHeight}
                  onChange={(e) => setStyle({ ...style, lineHeight: parseFloat(e.target.value) })}
                  className="w-full mt-1"
                />
              </div>
              <div>
                <label className="text-slate-400 text-xs uppercase tracking-wider">Letter Spacing: {style.letterSpacing}px</label>
                <input
                  type="range"
                  min="-2"
                  max="10"
                  step="0.5"
                  value={style.letterSpacing}
                  onChange={(e) => setStyle({ ...style, letterSpacing: parseFloat(e.target.value) })}
                  className="w-full mt-1"
                />
              </div>
              <div>
                <label className="text-slate-400 text-xs uppercase tracking-wider">Text Align</label>
                <div className="flex gap-2 mt-1">
                  {(['left', 'center', 'right'] as const).map(align => (
                    <button
                      key={align}
                      onClick={() => setStyle({ ...style, textAlign: align })}
                      className={`flex-1 px-3 py-2 rounded-lg border ${
                        style.textAlign === align ? 'bg-orange-500 border-orange-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      {align}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mb-6">
            <h3 className="text-white font-semibold mb-3">Colors</h3>
            <div className="space-y-3">
              <div>
                <label className="text-slate-400 text-xs uppercase tracking-wider">Text Color</label>
                <div className="flex gap-2 mt-1">
                  <input
                    type="color"
                    value={style.textColor}
                    onChange={(e) => setStyle({ ...style, textColor: e.target.value })}
                    className="w-12 h-10 rounded cursor-pointer"
                  />
                  <input
                    type="text"
                    value={style.textColor}
                    onChange={(e) => setStyle({ ...style, textColor: e.target.value })}
                    className="flex-1 px-3 py-2 bg-slate-700 text-white rounded-lg border border-slate-600 focus:border-orange-500 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-slate-400 text-xs uppercase tracking-wider">Background Color</label>
                <div className="flex gap-2 mt-1">
                  <input
                    type="color"
                    value={style.backgroundColor}
                    onChange={(e) => setStyle({ ...style, backgroundColor: e.target.value })}
                    className="w-12 h-10 rounded cursor-pointer"
                  />
                  <input
                    type="text"
                    value={style.backgroundColor}
                    onChange={(e) => setStyle({ ...style, backgroundColor: e.target.value })}
                    className="flex-1 px-3 py-2 bg-slate-700 text-white rounded-lg border border-slate-600 focus:border-orange-500 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-slate-400 text-xs uppercase tracking-wider">Background Opacity: {Math.round(style.backgroundOpacity * 100)}%</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={style.backgroundOpacity}
                  onChange={(e) => setStyle({ ...style, backgroundOpacity: parseFloat(e.target.value) })}
                  className="w-full mt-1"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="textShadow"
                  checked={style.textShadow}
                  onChange={(e) => setStyle({ ...style, textShadow: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                <label htmlFor="textShadow" className="text-slate-400 text-xs uppercase tracking-wider">Enable Text Shadow</label>
              </div>
              {style.textShadow && (
                <div className="space-y-2 ml-6">
                  <div>
                    <label className="text-slate-400 text-xs uppercase tracking-wider">Shadow Color</label>
                    <input
                      type="color"
                      value={style.textShadowColor}
                      onChange={(e) => setStyle({ ...style, textShadowColor: e.target.value })}
                      className="w-full mt-1 h-8 rounded cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 text-xs uppercase tracking-wider">Shadow Blur: {style.textShadowBlur}px</label>
                    <input
                      type="range"
                      min="0"
                      max="20"
                      value={style.textShadowBlur}
                      onChange={(e) => setStyle({ ...style, textShadowBlur: parseInt(e.target.value) })}
                      className="w-full mt-1"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-white font-semibold mb-3">Position</h3>
            <div className="space-y-3">
              <div>
                <label className="text-slate-400 text-xs uppercase tracking-wider">Horizontal: {Math.round(style.positionX)}%</label>
                <input
                  type="range"
                  min="5"
                  max="95"
                  value={style.positionX}
                  onChange={(e) => setStyle({ ...style, positionX: parseInt(e.target.value) })}
                  className="w-full mt-1"
                />
              </div>
              <div>
                <label className="text-slate-400 text-xs uppercase tracking-wider">Vertical: {Math.round(style.positionY)}%</label>
                <input
                  type="range"
                  min="10"
                  max="90"
                  value={style.positionY}
                  onChange={(e) => setStyle({ ...style, positionY: parseInt(e.target.value) })}
                  className="w-full mt-1"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
