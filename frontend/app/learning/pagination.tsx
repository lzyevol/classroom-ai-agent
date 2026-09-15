'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}

export function pageCount(totalItems: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

export function clampPage(page: number, totalItems: number, pageSize: number): number {
  return Math.min(Math.max(1, page), pageCount(totalItems, pageSize));
}

export function pageSlice<T>(items: T[], page: number, pageSize: number): T[] {
  const currentPage = clampPage(page, items.length, pageSize);
  const start = (currentPage - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

function visiblePages(page: number, totalPages: number): number[] {
  const visibleCount = Math.min(5, totalPages);
  const first = Math.min(
    Math.max(1, page - Math.floor(visibleCount / 2)),
    Math.max(1, totalPages - visibleCount + 1),
  );
  return Array.from({ length: visibleCount }, (_, index) => first + index);
}

export function Pagination({ page, pageSize, totalItems, onPageChange }: PaginationProps) {
  const totalPages = pageCount(totalItems, pageSize);
  const currentPage = clampPage(page, totalItems, pageSize);

  return (
    <div className="mt-auto flex min-h-12 flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 text-xs dark:border-gray-800">
      <span className="text-gray-400">共 {totalItems} 条 · 第 {totalItems ? currentPage : 0} / {totalItems ? totalPages : 0} 页</span>
      {totalItems > 0 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition hover:bg-violet-50 hover:text-violet-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-violet-950/30"
            aria-label="上一页"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {visiblePages(currentPage, totalPages).map((pageNumber) => (
            <button
              key={pageNumber}
              type="button"
              onClick={() => onPageChange(pageNumber)}
              className={
                'flex h-8 min-w-8 items-center justify-center rounded-lg px-2 font-bold transition ' +
                (pageNumber === currentPage
                  ? 'bg-violet-600 text-white'
                  : 'text-gray-500 hover:bg-violet-50 hover:text-violet-600 dark:hover:bg-violet-950/30')
              }
            >
              {pageNumber}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition hover:bg-violet-50 hover:text-violet-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-violet-950/30"
            aria-label="下一页"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
