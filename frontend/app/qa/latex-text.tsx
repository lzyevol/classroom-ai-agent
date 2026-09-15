'use client';

import { useMemo } from 'react';
import katex from 'katex';

/**
 * The imported textbook uses Markdown headings. QA should show the source
 * text, not the Markdown control characters themselves.
 */
export function normalizeMarkdownText(text: string): string {
  return text.replace(/(^|\r?\n)\s{0,3}#{1,6}[ \t]+/g, '$1');
}

function renderLatex(text: string): string {
  return text.replace(
    /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g,
    (match, display, inline) => {
      const latex = display || inline;
      try {
        return katex.renderToString(latex.trim(), {
          displayMode: !!display,
          throwOnError: false,
        });
      } catch {
        return match;
      }
    },
  );
}

export function LatexText({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => renderLatex(normalizeMarkdownText(text)), [text]);
  return (
    <span
      className={['whitespace-pre-wrap', className].filter(Boolean).join(' ')}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
