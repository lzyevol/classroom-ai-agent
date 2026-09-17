from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config import settings
from app.db.neo4j import close_driver, init_driver
from app.db.sqlite import close_db, get_db
from app.schemas.practice import PracticeGenerateRequest
from app.services.practice_service import generate_question_bank


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="预生成章节练习题库")
    parser.add_argument(
        "--target",
        type=int,
        default=10,
        help="每个小节至少保留的启用题目数，默认 10",
    )
    parser.add_argument(
        "--section-key",
        action="append",
        default=[],
        help="只生成指定小节，可重复传入；默认处理所有已生成课件的小节",
    )
    parser.add_argument(
        "--max-attempts",
        type=int,
        default=2,
        help="单个小节最多补题次数，默认 2",
    )
    return parser.parse_args()


async def seed_section(section_key: str, target: int, max_attempts: int) -> tuple[int, int]:
    db = get_db()
    existing = db.execute(
        "SELECT COUNT(*) FROM question_bank WHERE section_key = ? AND status = 'active'",
        (section_key,),
    ).fetchone()[0]
    attempts = 0
    while existing < target and attempts < max_attempts:
        attempts += 1
        request = PracticeGenerateRequest(
            section_key=section_key,
            question_types=["single_choice", "true_false", "short_answer"],
            difficulty="medium",
            question_count=min(10, target - existing),
        )
        result = await generate_question_bank(request, mixed_difficulty=True)
        inserted = int(result["inserted_count"])
        existing += inserted
        print(
            f"  第 {attempts} 次：模型返回 {result['generated_count']} 题，"
            f"新增 {inserted} 题，当前共 {existing} 题"
        )
        if inserted == 0:
            break
    return existing, attempts


async def main() -> None:
    args = parse_args()
    if not 1 <= args.target <= 100:
        raise SystemExit("--target 必须在 1 到 100 之间")
    if not settings.deepseek_api_key:
        raise SystemExit("未配置 DEEPSEEK_API_KEY，无法预生成题库")

    init_driver(settings.neo4j_uri, settings.neo4j_username, settings.neo4j_password)
    db = get_db()
    try:
        if args.section_key:
            section_keys = list(dict.fromkeys(args.section_key))
        else:
            section_keys = [
                row[0]
                for row in db.execute(
                    "SELECT section_key FROM lessons WHERE status = 'generated' ORDER BY section_key"
                ).fetchall()
            ]
        if not section_keys:
            raise SystemExit("没有找到可生成题库的小节")

        print(f"准备处理 {len(section_keys)} 个小节，每节目标 {args.target} 题。")
        completed = 0
        for index, section_key in enumerate(section_keys, 1):
            print(f"[{index}/{len(section_keys)}] {section_key}")
            try:
                count, _ = await seed_section(section_key, args.target, args.max_attempts)
                if count >= args.target:
                    completed += 1
            except Exception as exc:
                print(f"  生成失败：{type(exc).__name__}: {exc}")

        total = db.execute(
            "SELECT COUNT(*) FROM question_bank WHERE status = 'active'"
        ).fetchone()[0]
        print(f"完成：{completed}/{len(section_keys)} 个小节达到目标，题库共 {total} 题。")
    finally:
        close_driver()
        close_db()


if __name__ == "__main__":
    asyncio.run(main())
