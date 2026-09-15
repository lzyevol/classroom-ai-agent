"""Pre-synthesize lecture narration so students never wait on TTS.

Audio is stored under data/audio, keyed by a hash of (provider, voice, rate,
text), and served by /api/tts/cached/{key}. Running this for a chapter makes the
classroom open instantly for every student.

Usage:
    python -m scripts.seed_audio --chapter 3 --dry-run
    python -m scripts.seed_audio --chapter 3
    python -m scripts.seed_audio --all --voice zh-CN-YunxiNeural
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "classroom.db"

DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural"
CONCURRENCY = 4
# Edge TTS throttles aggressive callers, so back off instead of hammering it.
RETRY_DELAYS = [2, 5, 12]


def load_narrations(chapter: int | None) -> list[tuple[str, str]]:
    """Collect (section_number, narration) pairs, skipping blanks."""
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    rows = connection.execute(
        "SELECT section_key, slides_json FROM lessons ORDER BY section_key"
    ).fetchall()
    connection.close()

    items: list[tuple[str, str]] = []
    for row in rows:
        section = row["section_key"].split(":")[-1]
        if chapter is not None and section.split(".")[0] != str(chapter):
            continue
        for slide in json.loads(row["slides_json"]):
            text = (slide.get("narration") or "").strip()
            if text:
                items.append((section, text))
    return items


async def synthesize_one(
    text: str,
    voice: str,
    rate: int,
    provider: str,
) -> tuple[bool, bool]:
    """Return (ok, was_cached) for one narration."""
    from app.api.tts import TTSRequest, synthesize_edge, synthesize_qwen
    from app.services import tts_cache

    key = tts_cache.cache_key(text, provider=provider, voice=voice, rate=rate)
    if tts_cache.find(key):
        return True, True

    request = TTSRequest(text=text, voice=voice, rate=rate, provider=provider)
    for attempt, delay in enumerate([0, *RETRY_DELAYS]):
        if delay:
            await asyncio.sleep(delay)
        try:
            if provider == "edge":
                audio, media_type = await synthesize_edge(
                    request.text, request.voice, request.rate
                )
            else:
                audio, media_type = await synthesize_qwen(
                    request.text, request.voice, request.rate
                )
            tts_cache.store(key, audio, media_type)
            return True, False
        except Exception as exc:
            if attempt == len(RETRY_DELAYS):
                print(f"    失败：{type(exc).__name__} {str(exc)[:60]}")
                return False, False
    return False, False


async def main() -> None:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--chapter", type=int)
    group.add_argument("--all", action="store_true")
    parser.add_argument("--voice", default=DEFAULT_VOICE)
    parser.add_argument("--provider", choices=["edge", "qwen"], default="edge")
    parser.add_argument("--rate", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    sys.path.insert(0, str(ROOT))
    from app.services import tts_cache

    chapter = None if args.all else args.chapter
    items = load_narrations(chapter)
    if not items:
        raise SystemExit("没有找到讲稿，请先生成课件")

    scope = "全部章节" if args.all else f"第 {chapter} 章"
    print(f"{scope}：{len(items)} 段讲稿")
    print(f"音色 {args.voice} · provider {args.provider} · rate {args.rate}")

    pending = [
        (section, text)
        for section, text in items
        if not tts_cache.find(
            tts_cache.cache_key(
                text, provider=args.provider, voice=args.voice, rate=args.rate
            )
        )
    ]
    print(f"已缓存 {len(items) - len(pending)} 段，待生成 {len(pending)} 段")

    if args.dry_run or not pending:
        before = tts_cache.stats()
        print(f"当前缓存：{before['files']} 个文件 / {before['bytes'] / 1e6:.1f} MB")
        return

    done = 0
    failed = 0
    lock = asyncio.Lock()
    queue = list(pending)

    async def worker() -> None:
        nonlocal done, failed
        while True:
            async with lock:
                if not queue:
                    return
                section, text = queue.pop(0)
            ok, _ = await synthesize_one(text, args.voice, args.rate, args.provider)
            async with lock:
                if ok:
                    done += 1
                else:
                    failed += 1
                total = done + failed
                if total % 10 == 0 or total == len(pending):
                    print(f"  {total}/{len(pending)} 完成（失败 {failed}）")

    await asyncio.gather(*(worker() for _ in range(CONCURRENCY)))

    after = tts_cache.stats()
    print()
    print(f"生成 {done} 段，失败 {failed} 段")
    print(f"缓存共 {after['files']} 个文件 / {after['bytes'] / 1e6:.1f} MB")


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
