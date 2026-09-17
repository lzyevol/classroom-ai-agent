"""Fill a chapter's question bank up to a target size, one section at a time.

Generation is capped at 10 questions per request, and duplicate stems are
rejected by UNIQUE(section_key, stem), so each section needs several rounds and
a stop condition for when the model runs out of distinct angles.

Usage:
    python -m scripts.seed_question_bank --chapter 3
    python -m scripts.seed_question_bank --chapter 3 --target 10 --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"
MAX_PER_REQUEST = 10
# Rough budget: below this many characters a section cannot sustain many
# distinct questions, so the target is scaled down instead of retried forever.
CHARS_PER_QUESTION = 200
# Consecutive rounds that add nothing before a section is declared exhausted.
DRY_ROUNDS_LIMIT = 2

TYPE_ROTATION = [
    ["single_choice", "true_false", "short_answer"],
    ["single_choice", "short_answer"],
    ["single_choice", "true_false"],
]
DIFFICULTY_ROTATION = ["medium", "easy", "hard"]


def call(
    path: str,
    body: dict | None = None,
    token: str | None = None,
    method: str | None = None,
) -> tuple[int, dict | None]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        BASE + path,
        data=data,
        headers=headers,
        method=method or ("POST" if data is not None else "GET"),
    )
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read())
        except Exception:
            return exc.code, None


def login(username: str, password: str) -> str:
    status, payload = call(
        "/api/auth/login", {"username": username, "password": password}
    )
    if status != 200 or not payload:
        raise SystemExit(f"登录失败：HTTP {status}")
    return payload["access_token"]


def section_material_chars(token: str, section_key: str) -> int:
    """Approximate how much source text a section has, via its questions' pool."""
    # The API does not expose raw material size, so fall back to Neo4j through
    # the same service the API uses.
    from app.config import settings
    from app.db.neo4j import get_driver

    query = """
    MATCH (c:Chunk)-[:BELONGS_TO]->(s:Section {section_key: $key})
    RETURN sum(size(coalesce(c.content_clean, c.quote_original, ''))) AS chars
    """
    with get_driver().session(database=settings.neo4j_database) as session:
        record = session.run(query, key=section_key).single()
    return int(record["chars"] or 0) if record else 0


async def wait_for_job(token: str, job_id: str, timeout: float = 180.0) -> dict:
    waited = 0.0
    while waited < timeout:
        await asyncio.sleep(4)
        waited += 4
        _, job = call(f"/api/jobs/{job_id}", token=token)
        if job and job["status"] in {"done", "failed"}:
            return job
    return {"status": "failed", "error": f"任务超过 {timeout:.0f}s 未完成"}


async def fill_section(
    token: str,
    section_key: str,
    label: str,
    target: int,
    material_chars: int,
    dry_run: bool,
) -> dict:
    _, page = call(f"/api/questions/section/{section_key}", token=token)
    current = page["active_count"] if page else 0

    # A short section cannot support the full target without duplicates.
    feasible = max(3, min(target, material_chars // CHARS_PER_QUESTION))
    goal = min(target, feasible)

    if current >= goal:
        print(f"  {label:<7} 已有 {current} 题，跳过（目标 {goal}）")
        return {"section": label, "before": current, "after": current, "rounds": 0}

    if dry_run:
        print(
            f"  {label:<7} 现有 {current} → 目标 {goal}"
            f"（材料 {material_chars} 字{'，已按材料量下调' if goal < target else ''}）"
        )
        return {"section": label, "before": current, "after": current, "rounds": 0}

    print(f"  {label:<7} 现有 {current} → 目标 {goal}（材料 {material_chars} 字）")
    dry_rounds = 0
    rounds = 0

    while current < goal and dry_rounds < DRY_ROUNDS_LIMIT:
        need = min(goal - current, MAX_PER_REQUEST)
        # Vary type mix and difficulty each round so the model is pushed toward
        # new angles rather than rephrasing what it already produced.
        types = TYPE_ROTATION[rounds % len(TYPE_ROTATION)]
        difficulty = DIFFICULTY_ROTATION[rounds % len(DIFFICULTY_ROTATION)]

        status, accepted = call(
            f"/api/questions/section/{section_key}/generate-async",
            {
                "question_types": types,
                "difficulty": difficulty,
                "question_count": need,
            },
            token=token,
        )
        if status != 202 or not accepted:
            detail = accepted.get("detail") if isinstance(accepted, dict) else None
            print(f"    第{rounds + 1}轮 入队失败 HTTP {status} {detail or ''}")
            break

        job = await wait_for_job(token, accepted["job_id"])
        rounds += 1

        if job["status"] == "failed":
            print(f"    第{rounds}轮 失败：{job.get('error')}")
            dry_rounds += 1
            continue

        result = job.get("result") or {}
        inserted = result.get("inserted_count", 0)
        skipped = result.get("skipped_count", 0)
        current += inserted
        dry_rounds = 0 if inserted else dry_rounds + 1
        print(
            f"    第{rounds}轮 {difficulty:<6} 请求{need} 入库{inserted} 重复{skipped}"
            f" → 累计 {current}"
        )

    if current < goal:
        print(f"    停止：连续 {DRY_ROUNDS_LIMIT} 轮无新题，最终 {current} 题")
    return {
        "section": label,
        "before": page["active_count"] if page else 0,
        "after": current,
        "rounds": rounds,
    }


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--chapter", type=int, required=True)
    parser.add_argument("--target", type=int, default=10)
    parser.add_argument("--username", default="teacher")
    parser.add_argument("--password", default="teacher123")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    from app.config import settings
    from app.db.neo4j import close_driver, init_driver

    init_driver(settings.neo4j_uri, settings.neo4j_username, settings.neo4j_password)
    try:
        token = login(args.username, args.password)
        toc = json.load(urllib.request.urlopen(f"{BASE}/api/course/toc"))
        sections = [t for t in toc if t["chapter_number"] == args.chapter]
        if not sections:
            raise SystemExit(f"目录中没有第 {args.chapter} 章")

        print(f"第 {args.chapter} 章 {sections[0]['chapter_title']} — {len(sections)} 节")
        print(f"目标每节 {args.target} 题{'（试运行）' if args.dry_run else ''}\n")

        results = []
        for item in sections:
            chars = section_material_chars(token, item["section_key"])
            results.append(
                await fill_section(
                    token,
                    item["section_key"],
                    item["section_number"],
                    args.target,
                    chars,
                    args.dry_run,
                )
            )

        print("\n完成：")
        gained = sum(r["after"] - r["before"] for r in results)
        for r in results:
            mark = "" if r["after"] >= args.target else "  ← 未达目标"
            print(f"  {r['section']:<7} {r['before']} → {r['after']}{mark}")
        print(f"\n新增 {gained} 题")
    finally:
        close_driver()


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
