'use client';

import { CircleCheck, Image as ImageIcon, Quote } from 'lucide-react';
import type { Slide } from '../../lesson/types';
import { fieldId } from './slide-fields';

interface SlidePreviewProps {
  readonly slide: Slide;
  /** When provided, preview regions become buttons that focus their input. */
  readonly onFieldClick?: (targetFieldId: string) => void;
}

/** Bullets carry <span class="entity"> markup from the generator. */
function BulletText({ html }: { html: string }) {
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

interface EditableProps {
  target: string;
  label: string;
  className?: string;
  onActivate?: (targetFieldId: string) => void;
  children: React.ReactNode;
}

/** Wraps a preview region so clicking it focuses the matching form field. */
function Editable({ target, label, className = '', onActivate, children }: EditableProps) {
  if (!onActivate) return <div className={className}>{children}</div>;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`编辑${label}`}
      title={`点击编辑${label}`}
      onClick={() => onActivate(target)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate(target);
        }
      }}
      className={`cursor-pointer rounded-lg outline-none ring-offset-2 transition hover:bg-violet-50/70 hover:ring-2 hover:ring-violet-200 focus-visible:ring-2 focus-visible:ring-violet-400 ${className}`}
    >
      {children}
    </div>
  );
}

export function SlidePreview({ slide, onFieldClick }: SlidePreviewProps) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-7">
        <Editable target={fieldId.subtitle} label="副标题" className="-mx-1 px-1"
          onActivate={onFieldClick}
        >
          <div className="text-[11px] font-bold uppercase tracking-wide text-violet-500">
            {slide.subtitle || <span className="text-slate-300">（无副标题）</span>}
          </div>
        </Editable>

        <Editable target={fieldId.title} label="标题" className="-mx-1 mt-2 px-1"
          onActivate={onFieldClick}
        >
          <h4 className="text-2xl font-black leading-snug text-slate-900">{slide.title}</h4>
        </Editable>

        {slide.bullets.length > 0 && (
          <ul className="mt-5 space-y-2.5">
            {slide.bullets.map((bullet, index) => (
              <li key={index}>
                <Editable
                  target={fieldId.bullet(index)}
                  label={`第 ${index + 1} 条要点`}
                  className="-mx-1 px-1"
          onActivate={onFieldClick}
        >
                  <div className="flex gap-2.5 text-sm leading-relaxed text-slate-700">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
                    <BulletText html={bullet} />
                  </div>
                </Editable>
              </li>
            ))}
          </ul>
        )}

        {slide.quote && (
          <Editable target={fieldId.quote} label="引言" className="mt-5"
          onActivate={onFieldClick}
        >
            <blockquote className="flex gap-2 rounded-xl bg-violet-50/70 p-4 text-sm italic text-violet-900">
              <Quote className="h-4 w-4 shrink-0 text-violet-400" />
              {slide.quote}
            </blockquote>
          </Editable>
        )}

        {slide.compare && slide.compare.length > 0 && (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {slide.compare.map((item, index) => (
              <div key={index} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-bold text-slate-500">{item.name}</div>
                <div className="mt-1 text-sm text-slate-700">{item.desc}</div>
              </div>
            ))}
          </div>
        )}

        {slide.image && (
          <Editable target={fieldId.imageSrc} label="图片" className="mt-5"
          onActivate={onFieldClick}
        >
            <figure>
              {/* Generator-supplied path under /static/images; plain img avoids
                  next/image remote-pattern config for backend-served files. */}
              <img
                src={`/backend${slide.image.src}`}
                alt={slide.image.caption || slide.title}
                className="w-full rounded-xl border border-slate-200 object-contain"
              />
              {slide.image.caption && (
                <figcaption className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
                  <ImageIcon className="h-3.5 w-3.5" />
                  {slide.image.caption}
                </figcaption>
              )}
            </figure>
          </Editable>
        )}

        {slide.cite && (
          <Editable target={fieldId.cite} label="引用标注" className="mt-5 -mx-1 px-1"
          onActivate={onFieldClick}
        >
            <div className="border-t border-slate-100 pt-3 text-xs text-slate-400">
              {slide.cite}
            </div>
          </Editable>
        )}
      </div>

      <div>
        <div className="mb-2 text-xs font-bold text-slate-500">讲稿</div>
        <Editable target={fieldId.narration} label="讲稿"
          onActivate={onFieldClick}
        >
          <p className="rounded-2xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
            {slide.narration || <span className="text-slate-400">暂无讲稿</span>}
          </p>
        </Editable>
      </div>

      {slide.quiz && (
        <div>
          <div className="mb-2 text-xs font-bold text-slate-500">课中小测</div>
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
            <Editable target={fieldId.quizStem} label="小测题干" className="-mx-1 px-1"
          onActivate={onFieldClick}
        >
              <div className="text-sm font-bold text-slate-800">{slide.quiz.stem}</div>
            </Editable>
            <ul className="mt-3 space-y-1.5">
              {slide.quiz.opts.map((opt, index) => {
                const correct = index === slide.quiz!.answer;
                return (
                  <li key={index}>
                    <Editable target={fieldId.quizOption(index)} label={`选项 ${index + 1}`}
          onActivate={onFieldClick}
        >
                      <div
                        className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ${
                          correct
                            ? 'bg-emerald-100 font-bold text-emerald-800'
                            : 'text-slate-600'
                        }`}
                      >
                        {correct ? (
                          <CircleCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                        ) : (
                          <span className="h-4 w-4 shrink-0" />
                        )}
                        {opt}
                      </div>
                    </Editable>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
