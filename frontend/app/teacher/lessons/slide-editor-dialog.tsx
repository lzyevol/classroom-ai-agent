'use client';

import { useCallback, useEffect, useState } from 'react';
import { Eye, Loader2, Save, X } from 'lucide-react';
import type { Slide } from '../../lesson/types';
import { SlideEditor } from './slide-editor';
import { SlidePreview } from './slide-preview';
import { SLIDE_FORM_ID, focusField } from './slide-fields';

interface SlideEditorDialogProps {
  readonly slide: Slide;
  readonly sectionLabel: string;
  readonly totalSlides: number;
  readonly saving: boolean;
  readonly onClose: () => void;
  readonly onSave: (slide: Slide) => void;
}

export function SlideEditorDialog({
  slide,
  sectionLabel,
  totalSlides,
  saving,
  onClose,
  onSave,
}: SlideEditorDialogProps) {
  const [draft, setDraft] = useState<Slide>(slide);
  // Compared against every draft change to tell real edits from the initial sync.
  const baseline = JSON.stringify(slide);
  const dirty = JSON.stringify(draft) !== baseline;

  const handleDraftChange = useCallback((next: Slide) => {
    setDraft(next);
  }, []);

  const requestClose = useCallback(() => {
    if (saving) return;
    if (dirty && !window.confirm('有未保存的修改，确定要关闭吗？')) return;
    onClose();
  }, [dirty, saving, onClose]);

  // Esc to close, and keep the page behind the dialog from scrolling.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [requestClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/40 backdrop-blur-sm p-0 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`编辑第 ${slide.order} 张幻灯片`}
        className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white shadow-2xl sm:rounded-3xl"
      >
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div className="min-w-0">
            <div className="truncate text-xs font-bold text-violet-600">{sectionLabel}</div>
            <div className="flex items-center gap-2 text-sm font-black text-slate-800">
              编辑第 {slide.order} 张 / 共 {totalSlides} 张
              {dirty && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                  未保存
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              form={SLIDE_FORM_ID}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-violet-200 transition hover:bg-violet-700 disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              保存修改
            </button>
            <button
              type="button"
              onClick={requestClose}
              disabled={saving}
              aria-label="关闭编辑器"
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-500 transition hover:bg-slate-50 disabled:opacity-60"
            >
              <X className="h-4 w-4" />
              关闭
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
          <div className="min-h-0 overflow-y-auto border-b border-slate-200 bg-slate-50 p-5 lg:border-b-0 lg:border-r">
            <div className="mb-3 flex items-center gap-1.5 text-xs font-bold text-slate-500">
              <Eye className="h-3.5 w-3.5" />
              实时预览 · 点击任意区域可跳到右侧对应输入框；带下划线的概念在课堂上可点击提问
            </div>
            <SlidePreview slide={draft} onFieldClick={focusField} />
          </div>

          <div className="min-h-0 overflow-y-auto p-5">
            <SlideEditor
              slide={slide}
              onDraftChange={handleDraftChange}
              onSave={onSave}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
