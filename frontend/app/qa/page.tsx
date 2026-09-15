'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Link from 'next/link';
import {
  BookOpen,
  Send,
  Plus,
  MessageSquare,
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  BookMarked,
  X,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { askQuestion } from './qa-client';
import { LatexText, normalizeMarkdownText } from './latex-text';
import { ZoomableImage } from './zoomable-image';
import type {
  Citation,
  ChatMessage,
  QAHistoryMessage,
  QASession,
  QAResponse,
} from './types';

const SESSION_STORAGE_KEY = 'classroom-ai.qa-sessions.v1';

const HINTS = [
  '什么是具身智能？',
  '海鞘的例子说明了什么？',
  '莫拉维克悖论是什么？',
  '具身智能和离身智能的区别？',
];

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function truncate(text: string, max = 24) {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

export default function QAPage() {
  const [sessions, setSessions] = useState<QASession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<Citation | null>(null);
  const [panelWidth, setPanelWidth] = useState(400);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const draggingRef = useRef(false);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  );

  const isStreaming = useMemo(
    () => activeSession?.messages.some((m) => m.loading) ?? false,
    [activeSession],
  );

  const lastMessageContent =
    activeSession?.messages[activeSession.messages.length - 1]?.content ?? '';

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as {
          sessions?: QASession[];
          activeId?: string | null;
        };
        const restored = Array.isArray(saved.sessions)
          ? saved.sessions.map((session) => ({
              ...session,
              messages: Array.isArray(session.messages)
                ? session.messages.filter((message) => !message.loading)
                : [],
            }))
          : [];
        setSessions(restored);
        setActiveId(
          saved.activeId && restored.some((session) => session.id === saved.activeId)
            ? saved.activeId
            : restored[0]?.id ?? null,
        );
      }
    } catch {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    } finally {
      setStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    const compactSessions = sessions.slice(0, 20).map((session) => ({
      ...session,
      messages: session.messages.slice(-50),
    }));
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ sessions: compactSessions, activeId }),
    );
  }, [activeId, sessions, storageReady]);

  // Auto scroll to bottom when messages change
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [activeSession?.messages.length, lastMessageContent]);

  const createSession = useCallback((firstQuestion?: string): string => {
    const id = newId('sess');
    const now = Date.now();
    const session: QASession = {
      id,
      title: firstQuestion ? truncate(firstQuestion) : '新对话',
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    setSessions((prev) => [session, ...prev]);
    setActiveId(id);
    return id;
  }, []);

  const updateSession = useCallback((id: string, updater: (s: QASession) => QASession) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? updater(s) : s)));
  }, []);

  const handleSend = useCallback(
    async (text?: string) => {
      const question = (text ?? input).trim();
      if (!question || isStreaming) return;
      setInput('');

      let sid = activeId;
      if (!sid) {
        sid = createSession(question);
      } else if (activeSession?.messages.length === 0) {
        updateSession(sid, (s) => ({ ...s, title: truncate(question) }));
      }

      const userMsg: ChatMessage = {
        id: newId('u'),
        role: 'user',
        content: question,
        createdAt: Date.now(),
      };
      const aiMsgId = newId('a');
      const aiMsg: ChatMessage = {
        id: aiMsgId,
        role: 'ai',
        content: '',
        loading: true,
        createdAt: Date.now(),
      };
      updateSession(sid, (s) => ({
        ...s,
        messages: [...s.messages, userMsg, aiMsg],
        updatedAt: Date.now(),
      }));

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const history: QAHistoryMessage[] = (activeSession?.messages ?? [])
          .filter((message) => !message.loading && !message.error && message.content)
          .slice(-12)
          .map((message) => ({
            role: message.role === 'ai' ? 'assistant' : 'user',
            content: message.content,
          }));
        const resp: QAResponse = await askQuestion(
          question,
          history,
          3,
          controller.signal,
        );
        updateSession(sid, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === aiMsgId
              ? {
                  ...m,
                  loading: false,
                  content: resp.answer,
                  response: resp,
                }
              : m,
          ),
        }));
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        const message = err instanceof Error ? err.message : '未知错误';
        updateSession(sid, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === aiMsgId ? { ...m, loading: false, error: message } : m,
          ),
        }));
        toast.error(`问答失败: ${message}`);
      }
    },
    [activeId, activeSession, createSession, input, isStreaming, updateSession],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Top Header */}
      <header className="h-16 px-6 flex items-center border-b border-gray-100/80 dark:border-gray-800 bg-white/70 dark:bg-gray-900/70 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="w-8 h-8 rounded-lg bg-white/60 border border-gray-200/60 backdrop-blur-xl flex items-center justify-center text-gray-600 hover:text-violet-600 hover:bg-white transition-all shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </Link>
          <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-md shadow-purple-200/50">
            <BookOpen className="w-4 h-4 text-white" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[10px] uppercase tracking-widest font-bold text-gray-400">
              Course Assistant
            </span>
            <h1 className="text-base font-bold text-gray-800 dark:text-gray-100">
              具身智能 · 专门问答
            </h1>
          </div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2 bg-white/60 dark:bg-gray-800/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-gray-100/80 dark:border-gray-800 shadow-sm">
          <Sparkles className="w-3.5 h-3.5 text-violet-500" />
          <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
            RAG · Neo4j + DeepSeek
          </span>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Session List */}
        <aside className="w-[260px] shrink-0 border-r border-gray-100/80 dark:border-gray-800 bg-white/40 dark:bg-gray-900/40 backdrop-blur-md flex flex-col">
          <div className="p-3 border-b border-gray-100/60 dark:border-gray-800">
            <button
              onClick={() => createSession()}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 text-white text-sm font-semibold shadow-md shadow-violet-200/50 hover:shadow-lg hover:shadow-violet-300/60 transition-all hover:-translate-y-0.5 active:scale-[0.98]"
            >
              <Plus className="w-4 h-4" />
              新对话
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {sessions.length === 0 && (
              <div className="text-center text-xs text-gray-400 py-8 px-4">
                还没有对话，点击「新对话」开始
              </div>
            )}
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveId(s.id)}
                className={`w-full flex items-start gap-2 px-3 py-2.5 rounded-lg text-left transition-all border ${
                  s.id === activeId
                    ? 'bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-900/20 dark:to-purple-900/20 border-violet-200/60 shadow-sm'
                    : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800/50'
                }`}
              >
                <MessageSquare
                  className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                    s.id === activeId ? 'text-violet-500' : 'text-gray-400'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-[13px] font-medium truncate ${
                      s.id === activeId
                        ? 'text-violet-700 dark:text-violet-300'
                        : 'text-gray-700 dark:text-gray-200'
                    }`}
                  >
                    {s.title}
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    {s.messages.length} 条消息
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* Center: Chat */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Message list */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-8 py-6">
            {!activeSession && (
              <EmptyState onPick={(q) => handleSend(q)} />
            )}
            {activeSession && activeSession.messages.length === 0 && (
              <EmptyState onPick={(q) => handleSend(q)} />
            )}
            <div className="max-w-3xl mx-auto space-y-6">
              {activeSession?.messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  onOpenCitation={(c) => setPreview(c)}
                  onQuickAsk={(q) => handleSend(q)}
                />
              ))}
            </div>
          </div>

          {/* Input */}
          <div className="border-t border-gray-100/80 dark:border-gray-800 bg-white/60 dark:bg-gray-900/60 backdrop-blur-md px-8 py-4">
            <div className="max-w-3xl mx-auto flex items-end gap-3">
              <div className="flex-1 relative rounded-2xl bg-white dark:bg-gray-800 border border-gray-200/80 dark:border-gray-700 shadow-sm focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-200/60 transition-all">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isStreaming}
                  rows={1}
                  placeholder="问点关于具身智能的问题… (Enter 发送，Shift+Enter 换行)"
                  className="w-full resize-none bg-transparent px-4 py-3 pr-12 text-[14px] leading-relaxed outline-none placeholder:text-gray-400 max-h-32"
                />
              </div>
              <button
                onClick={() => handleSend()}
                disabled={isStreaming || !input.trim()}
                className="h-11 px-5 rounded-2xl bg-gradient-to-r from-violet-500 to-purple-500 text-white font-medium shadow-md shadow-violet-200/50 hover:shadow-lg hover:shadow-violet-300/60 transition-all hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:translate-y-0 flex items-center gap-2"
              >
                {isStreaming ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                <span className="text-sm">{isStreaming ? '思考中' : '发送'}</span>
              </button>
            </div>
          </div>
        </main>

        {/* Right: Citation Preview */}
        <AnimatePresence>
          {preview && (
            <motion.aside
              initial={{ x: panelWidth, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: panelWidth, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              style={{ width: panelWidth }}
              className="shrink-0 border-l border-gray-100/80 dark:border-gray-800 bg-white/60 dark:bg-gray-900/60 backdrop-blur-md flex flex-col relative"
            >
              {/* Drag handle */}
              <div
                className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-violet-400/30 active:bg-violet-400/50 transition-colors z-10"
                onMouseDown={(e) => {
                  e.preventDefault();
                  draggingRef.current = true;
                  const startX = e.clientX;
                  const startW = panelWidth;
                  const onMove = (ev: MouseEvent) => {
                    if (!draggingRef.current) return;
                    const delta = startX - ev.clientX;
                    setPanelWidth(Math.min(700, Math.max(280, startW + delta)));
                  };
                  const onUp = () => {
                    draggingRef.current = false;
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                  };
                  document.addEventListener('mousemove', onMove);
                  document.addEventListener('mouseup', onUp);
                }}
              />
              <div className="h-14 px-4 flex items-center justify-between border-b border-gray-100/80 dark:border-gray-800">
                <div className="flex items-center gap-2">
                  <BookMarked className="w-4 h-4 text-violet-500" />
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                    教材原文
                  </span>
                </div>
                <button
                  onClick={() => setPreview(null)}
                  className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center text-gray-500"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <div className="text-[11px] font-semibold text-violet-600 mb-3 flex flex-wrap gap-1 items-center">
                  <span className="px-2 py-0.5 bg-violet-50 dark:bg-violet-900/20 rounded-full">
                    {preview.book}
                  </span>
                  <span className="text-gray-400">·</span>
                  <span>{preview.chapter_title}</span>
                  <span className="text-gray-400">·</span>
                  <span>{preview.section_number} {preview.section_title}</span>
                </div>
                <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-100/80 dark:border-gray-700 p-4 text-[13.5px] leading-[1.85] text-gray-700 dark:text-gray-200">
                  <LatexText text={preview.quote} />
                </div>
                {preview.image_urls.length > 0 && (
                  <div className="mt-4 space-y-3">
                    {preview.image_urls.map((url) => (
                      <ZoomableImage
                        key={url}
                        src={`/backend${url}`}
                        alt="教材配图"
                      />
                    ))}
                  </div>
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900/30 dark:to-purple-900/30 flex items-center justify-center mb-4 shadow-inner">
        <Sparkles className="w-8 h-8 text-violet-500" />
      </div>
      <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-2">
        关于《具身智能导论》，随便问
      </h2>
      <p className="text-sm text-gray-500 mb-6 max-w-md">
        AI 只会依据教材内容回答，每条回答都会附上教材原文引用；无依据时会明确告知。
      </p>
      <div className="grid grid-cols-2 gap-2 w-full max-w-lg">
        {HINTS.map((h) => (
          <button
            key={h}
            onClick={() => onPick(h)}
            className="px-4 py-2.5 text-left text-[13px] rounded-xl bg-white dark:bg-gray-800 border border-gray-200/60 dark:border-gray-700 hover:border-violet-400 hover:shadow-md hover:shadow-violet-100/60 dark:hover:shadow-violet-900/20 transition-all hover:-translate-y-0.5 text-gray-700 dark:text-gray-200"
          >
            {h}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onOpenCitation,
  onQuickAsk,
}: {
  message: ChatMessage;
  onOpenCitation: (c: Citation) => void;
  onQuickAsk: (q: string) => void;
}) {
  if (message.role === 'user') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="flex justify-end"
      >
        <div className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-br-sm bg-gradient-to-br from-violet-500 to-purple-600 text-white text-[14px] leading-relaxed shadow-md shadow-purple-200/40 ring-1 ring-purple-500/20">
          {message.content}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex items-start gap-3"
    >
      <div className="w-9 h-9 shrink-0 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white shadow-md shadow-purple-200/40 ring-2 ring-white dark:ring-gray-800">
        <Sparkles className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        {message.loading && (
          <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl rounded-tl-sm bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm">
            <Loader2 className="w-3.5 h-3.5 text-violet-500 animate-spin" />
            <span className="text-[13px] text-gray-500">
              正在检索教材并生成回答…
            </span>
          </div>
        )}
        {message.error && (
          <div className="inline-flex items-start gap-2 px-4 py-3 rounded-2xl rounded-tl-sm bg-red-50 dark:bg-red-900/20 border border-red-200 text-red-700 text-[13px] max-w-[90%]">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{message.error}</span>
          </div>
        )}
        {!message.loading && !message.error && message.response && (
          <div className="space-y-3">
            {/* Answer */}
            <div className="max-w-[90%] px-4 py-3 rounded-2xl rounded-tl-sm bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm">
              {message.response.insufficient_evidence && (
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-amber-600">
                  <AlertCircle className="w-3.5 h-3.5" />
                  教材依据不足
                </div>
              )}
              <div className="text-[14.5px] leading-[1.85] text-gray-800 dark:text-gray-100">
                <LatexText text={message.response.answer} />
              </div>

              {/* Related knowledge tags */}
              {message.response.matched_entities.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex flex-wrap gap-1.5">
                  <span className="text-[11px] text-gray-400 mr-1 py-0.5">
                    相关知识点：
                  </span>
                  {message.response.matched_entities.slice(0, 6).map((e) => (
                    <button
                      key={e.entity_id}
                      onClick={() => onQuickAsk(`详细讲讲 ${e.name}`)}
                      className="text-[11px] px-2 py-0.5 rounded-full bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors"
                    >
                      {e.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Citations */}
            {message.response.citations.length > 0 && (
              <div className="max-w-[90%] space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500">
                  <BookMarked className="w-3.5 h-3.5" />
                  教材依据 ({message.response.citations.length})
                </div>
                {message.response.citations.map((c, i) => (
                  <button
                    key={c.chunk_id + i}
                    onClick={() => onOpenCitation(c)}
                    className="w-full text-left px-3 py-2 rounded-xl bg-gradient-to-br from-violet-50/60 to-purple-50/40 dark:from-violet-900/10 dark:to-purple-900/5 border border-violet-100/80 dark:border-violet-900/30 hover:border-violet-300 hover:shadow-sm transition-all group"
                  >
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 text-[10px] font-bold text-violet-500 bg-white dark:bg-gray-800 rounded px-1.5 py-0.5 shrink-0">
                        [{i + 1}]
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-violet-600 font-semibold">
                          {c.chapter_title} · {c.section_number} {c.section_title}
                        </div>
                        <div className="text-[12px] text-gray-600 dark:text-gray-300 line-clamp-2 mt-0.5">
                          {normalizeMarkdownText(c.quote)}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 text-[11px] text-gray-400 pl-1">
              <button className="flex items-center gap-1 hover:text-violet-600 transition-colors">
                <ThumbsUp className="w-3 h-3" />
                有帮助
              </button>
              <button className="flex items-center gap-1 hover:text-violet-600 transition-colors">
                <ThumbsDown className="w-3 h-3" />
                没帮助
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
