'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Pencil, Search } from 'lucide-react';
import type { ChapterNode, SectionNode } from './types';

interface ChapterTreeProps {
  readonly chapters: ChapterNode[];
  readonly selectedKey: string | null;
  readonly onSelect: (section: SectionNode) => void;
}

function SectionStateIcon({ status }: { status: SectionNode['lessonStatus'] }) {
  if (status === 'edited') {
    return <Pencil className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="已编辑" />;
  }
  if (status === 'none') {
    return <Circle className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-label="未生成" />;
  }
  return (
    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-label="已生成" />
  );
}

export function ChapterTree({ chapters, selectedKey, onSelect }: ChapterTreeProps) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return chapters;
    return chapters
      .map((chapter) => ({
        ...chapter,
        sections: chapter.sections.filter(
          (section) =>
            section.section_title.toLowerCase().includes(keyword) ||
            section.section_number.includes(keyword) ||
            chapter.chapterTitle.toLowerCase().includes(keyword),
        ),
      }))
      .filter((chapter) => chapter.sections.length > 0);
  }, [chapters, query]);

  const toggle = (chapterNumber: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(chapterNumber)) next.delete(chapterNumber);
      else next.add(chapterNumber);
      return next;
    });
  };

  // While searching, show every match rather than honouring collapse state.
  const searching = query.trim().length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="relative shrink-0">
        <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索章节"
          aria-label="搜索章节"
          className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-violet-400"
        />
      </div>

      <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {filtered.map((chapter) => {
          const isCollapsed = !searching && collapsed.has(chapter.chapterNumber);
          return (
            <div key={chapter.chapterNumber}>
              <button
                type="button"
                onClick={() => toggle(chapter.chapterNumber)}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition hover:bg-slate-50"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-700">
                  第{chapter.chapterNumber}章 {chapter.chapterTitle}
                </span>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">
                  {chapter.generatedCount}/{chapter.sections.length}
                </span>
              </button>

              {!isCollapsed && (
                <div className="ml-3 border-l border-slate-100 pl-2">
                  {chapter.sections.map((section) => {
                    const active = section.section_key === selectedKey;
                    return (
                      <button
                        key={section.section_key}
                        type="button"
                        onClick={() => onSelect(section)}
                        aria-current={active ? 'true' : undefined}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition ${
                          active
                            ? 'bg-violet-50 font-bold text-violet-700'
                            : 'text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <SectionStateIcon status={section.lessonStatus} />
                        <span className="w-9 shrink-0 text-xs text-slate-400">
                          {section.section_number}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{section.section_title}</span>
                        {section.slideCount > 0 && (
                          <span className="shrink-0 text-[11px] text-slate-400">
                            {section.slideCount}张
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-400">
            没有匹配的章节
          </div>
        )}
      </div>
    </div>
  );
}
