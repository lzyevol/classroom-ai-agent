import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
      <p className="mb-3 text-sm font-semibold tracking-widest text-blue-700">
        CLASSROOM AI AGENT
      </p>
      <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
        从教材证据出发的智能课堂
      </h1>
      <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-600 dark:text-zinc-300">
        当前为复现项目 M1 阶段。先验证“提问、回答、教材引用”的最小链路，再逐步加入课堂对话与练习。
      </p>
      <div className="mt-10 flex flex-wrap gap-4">
        <Link
          className="rounded-xl bg-blue-700 px-6 py-3 font-medium text-white transition hover:bg-blue-800"
          href="/qa"
        >
          进入教材问答
        </Link>
        <Link
          className="rounded-xl border border-zinc-300 px-6 py-3 font-medium transition hover:border-blue-600 hover:text-blue-700 dark:border-zinc-700"
          href="/classroom"
        >
          进入智能课堂
        </Link>
        <span className="rounded-xl border border-zinc-300 px-6 py-3 text-zinc-500 dark:border-zinc-700">
          练习将在后续阶段开放
        </span>
      </div>
    </main>
  );
}
