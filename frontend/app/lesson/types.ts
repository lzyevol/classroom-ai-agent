export interface SlideImage {
  src: string;
  caption?: string;
}

export interface SlideQuiz {
  stem: string;
  opts: string[];
  answer: number;
  pass: string;
  fail: string;
}

export interface Slide {
  slide_id: string;
  order: number;
  title: string;
  subtitle: string;
  bullets: string[];
  narration: string;
  cite: string;
  image: SlideImage | null;
  quote: string | null;
  layout: string | null;
  compare: { name: string; desc: string }[] | null;
  quiz: SlideQuiz | null;
}

export interface LessonData {
  section_key: string;
  chapter_title: string;
  section_title: string;
  slides: Slide[];
  generated_at: string;
  cached: boolean;
  status: string;
}

export interface TocItem {
  section_key: string;
  chapter_number: number;
  chapter_title: string;
  section_number: string;
  section_title: string;
}
