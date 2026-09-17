"""Generate courseware for every section of a chapter that still lacks it.

Each section is one async job, run sequentially so the model and the SQLite
writer are not contended. Sections that already have slides are skipped unless
--force is given.

Usage:
    python -m scripts.seed_lessons --chapter 3 --dry-run
    python -m scripts.seed_lessons --chapter 3
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"
JOB_TIMEOUT = 240.0


def call(
    path: str,
    body: dict | None = None,
    token: str | None = None,
) -> tuple[int, dict | None]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        BASE + path,
        data=data,
        headers=headers,
        method="POST" if data is not None else "GET",
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


async def wait_for_job(token: str, job_id: str) -> dict:
    waited = 0.0
    while waited < JOB_TIMEOUT:
        await asyncio.sleep(5)
        waited += 5
        _, job = call(f"/api/jobs/{job_id}", token=token)
        if job and job["status"] in {"done", "failed"}:
            return job
    return {"status": "failed", "error": f"任务超过 {JOB_TIMEOUT:.0f}s 未完成"}


async def generate_section(
    token: str,
    section_key: str,
    label: str,
    title: str,
    force: bool,
) -> dict:
    status, accepted = call(
        "/api/lesson/generate-async",
        {"section_key": section_key, "force_regenerate": force},
        token=token,
    )
    if status != 202 or not accepted:
        detail = accepted.get("detail") if isinstance(accepted, dict) else None
        print(f"  {label:<7} 入队失败 HTTP {status} {detail or ''}")
        return {"section": label, "slides": 0, "ok": False}

    job = await wait_for_job(token, accepted["job_id"])
    if job["status"] == "failed":
        print(f"  {label:<7} {title[:18]:<20} 失败：{job.get('error')}")
        return {"section": label, "slides": 0, "ok": False}

    result = job.get("result") or {}
    slides = len(result.get("slides") or [])
    quizzes = sum(1 for s in (result.get("slides") or []) if s.get("quiz"))
    images = sum(1 for s in (result.get("slides") or []) if s.get("image"))
    print(
        f"  {label:<7} {title[:18]:<20} {slides} 张"
        f"（小测 {quizzes}、配图 {images}）"
    )
    return {"section": label, "slides": slides, "ok": slides > 0}


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--chapter", type=int, required=True)
    parser.add_argument("--username", default="teacher")
    parser.add_argument("--password", default="teacher123")
    parser.add_argument(
        "--force",
        action="store_true",
        help="regenerate sections that already have slides",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    token = login(args.username, args.password)
    toc = json.load(urllib.request.urlopen(f"{BASE}/api/course/toc"))
    sections = [t for t in toc if t["chapter_number"] == args.chapter]
    if not sections:
        raise SystemExit(f"目录中没有第 {args.chapter} 章")

    _, existing = call("/api/lesson/list", token=token)
    have = {item["section_key"]: item for item in (existing or [])}

    pending = [
        item
        for item in sections
        if args.force or item["section_key"] not in have
    ]

    print(f"第 {args.chapter} 章 {sections[0]['chapter_title']} — {len(sections)} 节")
    print(f"已有课件 {len(sections) - len(pending)} 节，待生成 {len(pending)} 节")
    if args.dry_run:
        for item in pending:
            print(f"  {item['section_number']:<7} {item['section_title']}")
        return
    print()

    results = []
    for index, item in enumerate(pending, start=1):
        print(f"[{index}/{len(pending)}]", end=" ")
        results.append(
            await generate_section(
                token,
                item["section_key"],
                item["section_number"],
                item["section_title"],
                args.force,
            )
        )

    ok = [r for r in results if r["ok"]]
    print()
    print(f"完成 {len(ok)}/{len(results)} 节，共 {sum(r['slides'] for r in ok)} 张幻灯片")
    failed = [r["section"] for r in results if not r["ok"]]
    if failed:
        print(f"失败：{' '.join(failed)}")


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
