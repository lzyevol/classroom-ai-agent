import type { TocItem } from '../../lesson/types';

export interface LessonListItem {
  section_key: string;
  section_title: string;
  chapter_title: string;
  slide_count: number;
  generated_at: string;
  status: string;
}

/** A TOC section annotated with its courseware state. */
export interface SectionNode extends TocItem {
  slideCount: number;
  /** 'none' when no courseware exists yet. */
  lessonStatus: 'none' | 'generated' | 'edited' | string;
}

export interface ChapterNode {
  chapterNumber: number;
  chapterTitle: string;
  sections: SectionNode[];
  generatedCount: number;
}
