
import React, { useRef } from 'react';
import { CreationMode, UploadedMedia } from '../types';
import { fileToBase64, generateVideoThumbnail, getVideoDuration } from '../utils/audioHelper';
import { getMediaDisplayUrl } from '../utils/sceneDrafts';

interface MediaInputProps {
  onMediaUpload: (media: UploadedMedia[]) => void;
  media: UploadedMedia[];
  onRemove: (index: number) => void;
  creationMode?: CreationMode;
  onClearAll?: () => void;
}

const MediaInput: React.FC<MediaInputProps> = ({ onMediaUpload, media, onRemove, creationMode, onClearAll }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isEditExisting = creationMode === CreationMode.EDIT_EXISTING;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files) as File[];
      const newMedia: UploadedMedia[] = [];

      for (const file of files) {
        const previewUrl = URL.createObjectURL(file);
        const base64 = await fileToBase64(file);
        const type = file.type.startsWith('video/') ? 'video' : 'image';
        let thumbnailUrl: string | undefined = undefined;
        let duration = 3; // Default 3s for images

        if (type === 'video') {
            thumbnailUrl = await generateVideoThumbnail(previewUrl);
            duration = await getVideoDuration(file);
        }
        
        newMedia.push({
          file,
          previewUrl,
          thumbnailUrl,
          type,
          base64,
          mimeType: file.type,
          duration
        });
      }
      onMediaUpload(newMedia);
    }
  };

  return (
    <div className="w-full space-y-4">
      <div 
        className="border-2 border-dashed border-dark-border rounded-xl p-8 flex flex-col items-center justify-center hover:bg-dark-card/50 transition-colors cursor-pointer group"
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="w-16 h-16 bg-insta-mid/20 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
          <svg className="w-8 h-8 text-insta-mid" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </div>
        <p className="text-gray-300 font-medium text-lg">
          {isEditExisting ? 'Upload a finished reel to refine' : 'Drop clips or photos to build a reel'}
        </p>
        <p className="text-gray-500 text-sm mt-2">
          {isEditExisting ? 'Import MP4/MOV to add captions, voice, and music' : 'Supports JPG, PNG, MP4'}
        </p>
        {!isEditExisting && (
          <p className="text-gray-500 text-xs mt-1 flex items-center gap-2">
            <span className="px-2 py-1 rounded-full bg-white/5 border border-white/5 text-white/70">Up to 12 clips</span>
            <span className="px-2 py-1 rounded-full bg-white/5 border border-white/5 text-white/70">Images &amp; video</span>
          </p>
        )}
        <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          multiple 
          accept="image/*,video/*"
          onChange={handleFileChange}
        />
      </div>

      {media.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>{media.length} clip{media.length === 1 ? '' : 's'} added</span>
            {onClearAll && (
              <button
                onClick={onClearAll}
                className="text-white/70 hover:text-white underline-offset-2 hover:underline"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {media.map((item, idx) => (
              <div key={idx} className="relative group aspect-square rounded-lg overflow-hidden bg-dark-card border border-dark-border">
                {item.type === 'video' ? (
                   <div className="relative w-full h-full">
                      <img 
                          src={getMediaDisplayUrl(item)} 
                          alt="Video Thumbnail" 
                          className="w-full h-full object-cover opacity-80" 
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
                               <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M8 5v14l11-7z"/>
                               </svg>
                          </div>
                      </div>
                   </div>
                ) : (
                  <img src={getMediaDisplayUrl(item)} alt="preview" className="w-full h-full object-cover" />
                )}
                <button 
                  onClick={() => onRemove(idx)}
                  className="absolute top-2 right-2 bg-red-500/80 p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10"
                >
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/60 rounded text-xs text-white backdrop-blur-sm flex gap-2">
                  <span>{item.type === 'video' ? 'VIDEO' : 'IMAGE'}</span>
                  {item.type === 'video' && <span>{Math.round(item.duration)}s</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default MediaInput;