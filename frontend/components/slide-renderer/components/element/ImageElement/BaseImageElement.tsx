'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PPTImageElement } from '@/lib/types/slides';
import { useElementShadow } from '../hooks/useElementShadow';
import { useElementFlip } from '../hooks/useElementFlip';
import { useClipImage } from './useClipImage';
import { useFilter } from './useFilter';
import { ImageOutline } from './ImageOutline';
import { useMediaGenerationStore, isMediaPlaceholder } from '@/lib/store/media-generation';
import { useSettingsStore } from '@/lib/store/settings';
import { useMediaStageId } from '@/lib/contexts/media-stage-context';
import { retryMediaTask } from '@/lib/media/media-orchestrator';
import { RotateCcw, Paintbrush, ShieldAlert, ImageOff, ZoomIn, X } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';

export interface BaseImageElementProps {
  elementInfo: PPTImageElement;
}

/**
 * Base image element component for read-only display
 */
export function BaseImageElement({ elementInfo }: BaseImageElementProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const { t } = useI18n();
  const { shadowStyle } = useElementShadow(elementInfo.shadow);
  const { flipStyle } = useElementFlip(elementInfo.flipH, elementInfo.flipV);
  const { clipShape, imgPosition } = useClipImage(elementInfo);
  const { filter } = useFilter(elementInfo.filters);

  // Only subscribe to media store when inside a classroom (stageId provided via context).
  // Homepage thumbnails have no stageId context → skip store to prevent cross-course contamination.
  const stageId = useMediaStageId();
  const isPlaceholder = !!stageId && isMediaPlaceholder(elementInfo.src);
  const task = useMediaGenerationStore((s) => {
    if (!isPlaceholder) return undefined;
    const t = s.tasks[elementInfo.src];
    // Only use task if it belongs to the current stage
    if (t && t.stageId !== stageId) return undefined;
    return t;
  });

  const imageGenerationEnabled = useSettingsStore((s) => s.imageGenerationEnabled);
  // Resolve actual src: use objectUrl from store if available, otherwise original src
  const resolvedSrc = task?.status === 'done' && task.objectUrl ? task.objectUrl : elementInfo.src;
  const showDisabled = isPlaceholder && !task && !imageGenerationEnabled;
  const showSkeleton =
    isPlaceholder &&
    !showDisabled &&
    (!task || task.status === 'pending' || task.status === 'generating');
  const showError = isPlaceholder && task?.status === 'failed';

  useEffect(() => {
    if (!lightboxOpen) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightboxOpen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [lightboxOpen]);

  return (
    <>
      <div
        className="absolute"
        style={{
          top: `${elementInfo.top}px`,
          left: `${elementInfo.left}px`,
          width: `${elementInfo.width}px`,
          height: `${elementInfo.height}px`,
        }}
      >
        <div className="w-full h-full" style={{ transform: `rotate(${elementInfo.rotate}deg)` }}>
          <div
            className="w-full h-full relative"
            style={{
              filter: shadowStyle ? `drop-shadow(${shadowStyle})` : '',
              transform: flipStyle,
            }}
          >
            <ImageOutline elementInfo={elementInfo} />

            <div
              className="group w-full h-full overflow-hidden relative bg-white/80 dark:bg-black/20"
              style={{ clipPath: clipShape.style }}
            >
              {showDisabled ? (
                <div className="w-full h-full bg-gray-50 dark:bg-gray-900/30 flex items-center justify-center">
                  <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-gray-500 dark:text-gray-400">
                    <ImageOff className="w-3 h-3 shrink-0" />
                    <span>{t('settings.mediaGenerationDisabled')}</span>
                  </div>
                </div>
              ) : showSkeleton ? (
                <div className="w-full h-full bg-gradient-to-br from-amber-50 via-orange-50/60 to-yellow-50 dark:from-amber-950/40 dark:via-orange-950/30 dark:to-yellow-950/20 flex items-center justify-center">
                  <style>{`
                  @keyframes img-pulse-ring { 0%, 100% { opacity: 0.15; transform: scale(0.85); } 50% { opacity: 0.35; transform: scale(1.1); } }
                `}</style>
                  <div className="relative w-12 h-12">
                    <div
                      className="absolute inset-0 rounded-full border-2 border-amber-300/40 dark:border-amber-500/30"
                      style={{
                        animation: 'img-pulse-ring 2.4s ease-in-out infinite',
                      }}
                    />
                    <Paintbrush
                      className="absolute inset-0 m-auto w-5 h-5 text-amber-400/80 dark:text-amber-500/70"
                      strokeWidth={1.5}
                    />
                  </div>
                </div>
              ) : showError ? (
                <div className="w-full h-full bg-red-50 dark:bg-red-900/20 flex flex-col items-center justify-center gap-1.5">
                  {task?.errorCode === 'CONTENT_SENSITIVE' ? (
                    <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                      <ShieldAlert className="w-3 h-3 shrink-0" />
                      <span>{t('settings.mediaContentSensitive')}</span>
                    </div>
                  ) : task?.errorCode === 'GENERATION_DISABLED' ? (
                    <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-gray-500 dark:text-gray-400">
                      <ImageOff className="w-3 h-3 shrink-0" />
                      <span>{t('settings.mediaGenerationDisabled')}</span>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        retryMediaTask(elementInfo.src);
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40 rounded hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" />
                      {t('settings.mediaRetry')}
                    </button>
                  )}
                </div>
              ) : resolvedSrc ? (
                <>
                  <img
                    src={resolvedSrc}
                    draggable={false}
                    style={{
                      position: 'absolute',
                      top: imgPosition.top,
                      left: imgPosition.left,
                      width: imgPosition.width,
                      height: imgPosition.height,
                      objectFit: elementInfo.clip ? undefined : 'contain',
                      filter,
                    }}
                    alt=""
                    className={stageId ? 'cursor-zoom-in' : undefined}
                    title={stageId ? '点击放大图片' : undefined}
                    onClick={(event) => {
                      if (!stageId) return;
                      event.stopPropagation();
                      setLightboxOpen(true);
                    }}
                    onDragStart={(e) => e.preventDefault()}
                  />
                  {stageId && (
                    <div className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/65 p-1.5 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                      <ZoomIn className="h-4 w-4" />
                    </div>
                  )}
                  {elementInfo.colorMask && (
                    <div
                      className="absolute inset-0"
                      style={{ backgroundColor: elementInfo.colorMask }}
                    />
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {lightboxOpen && stageId && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label="图片放大预览"
              className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
              onClick={() => setLightboxOpen(false)}
            >
              <button
                type="button"
                aria-label="关闭图片预览"
                className="absolute right-5 top-5 rounded-full bg-white/15 p-2 text-white transition-colors hover:bg-white/25"
                onClick={() => setLightboxOpen(false)}
              >
                <X className="h-6 w-6" />
              </button>
              <img
                src={resolvedSrc}
                alt=""
                className="max-h-[92vh] max-w-[96vw] object-contain shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
