import katex from 'katex';

const FORMULA_PATTERN = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\r\n]+?\$/g;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeFormulaEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function renderDelimitedLatex(value: string, renderPlainText: (text: string) => string): string {
  FORMULA_PATTERN.lastIndex = 0;
  let html = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = FORMULA_PATTERN.exec(value)) !== null) {
    html += renderPlainText(value.slice(lastIndex, match.index));

    const source = match[0];
    const displayMode = source.startsWith('$$') || source.startsWith('\\[');
    const delimitedLatex = source.startsWith('$$')
      ? source.slice(2, -2)
      : source.startsWith('\\[') || source.startsWith('\\(')
        ? source.slice(2, -2)
        : source.slice(1, -1);

    try {
      html += katex.renderToString(decodeFormulaEntities(delimitedLatex).trim(), {
        displayMode,
        throwOnError: false,
        output: 'html',
        strict: 'ignore',
      });
    } catch {
      html += renderPlainText(source);
    }

    lastIndex = match.index + source.length;
  }

  return html + renderPlainText(value.slice(lastIndex));
}

/** Render plain source text safely, converting supported LaTeX delimiters to KaTeX HTML. */
export function renderLatexText(value: string): string {
  return renderDelimitedLatex(value, escapeHtml);
}

/**
 * Upgrade previously generated slide HTML at display time. Existing markup is
 * preserved; only delimited formulas are replaced with KaTeX output.
 */
export function renderLatexInHtml(value: string): string {
  if (!value.includes('$') && !value.includes('\\(') && !value.includes('\\[')) return value;
  return renderDelimitedLatex(value, (text) => text);
}
