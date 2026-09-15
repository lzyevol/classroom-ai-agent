/**
 * Stable DOM ids shared by the editor form and the live preview.
 *
 * Clicking a region in the preview focuses its input by id rather than
 * threading a ref for every one of the ~12 editable fields.
 */

export const SLIDE_FORM_ID = 'slide-editor-form';

export const fieldId = {
  title: 'slide-field-title',
  subtitle: 'slide-field-subtitle',
  narration: 'slide-field-narration',
  cite: 'slide-field-cite',
  quote: 'slide-field-quote',
  imageSrc: 'slide-field-image-src',
  imageCaption: 'slide-field-image-caption',
  quizStem: 'slide-field-quiz-stem',
  bullet: (index: number) => `slide-field-bullet-${index}`,
  quizOption: (index: number) => `slide-field-quiz-opt-${index}`,
} as const;

/** Focus a field and bring it into view inside the scrollable form. */
export function focusField(id: string): void {
  const element = document.getElementById(id);
  if (!element) return;
  element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  (element as HTMLElement).focus({ preventScroll: true });
}
