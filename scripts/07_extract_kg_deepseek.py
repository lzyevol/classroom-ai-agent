from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import time
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


API_URL = "https://api.deepseek.com/chat/completions"


def iter_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path} 第 {line_number} 行不是有效JSON") from exc


def processed_chunk_ids(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {str(record["chunk_id"]) for record in iter_jsonl(path)}


def build_user_payload(chunks: list[dict[str, Any]], ontology: dict[str, Any]) -> str:
    payload = {
        "entity_types": ontology["entity_types"],
        "relation_types": ontology["relation_types"],
        "chunks": [
            {
                "chunk_id": chunk["chunk_id"],
                "chapter": chunk["citation_label"],
                "content_clean": chunk["content_clean"],
            }
            for chunk in chunks
        ],
    }
    return "请按系统要求抽取并输出 JSON。输入如下：\n" + json.dumps(
        payload, ensure_ascii=False
    )


def call_api(
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    timeout: int,
    retries: int,
) -> dict[str, Any]:
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "thinking": {"type": "disabled"},
        "stream": False,
        "response_format": {"type": "json_object"},
        "max_tokens": 8192,
    }
    encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
    last_error = ""
    for attempt in range(retries + 1):
        request = Request(
            API_URL,
            data=encoded,
            method="POST",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "User-Agent": "classroom-ai-agent/0.1",
            },
        )
        try:
            with urlopen(request, timeout=timeout) as response:
                result = json.loads(response.read().decode("utf-8"))
            content = result["choices"][0]["message"].get("content") or ""
            if not content.strip():
                raise ValueError("DeepSeek返回了空content")
            parsed = json.loads(content)
            if not isinstance(parsed.get("results"), list):
                raise ValueError("DeepSeek JSON缺少results数组")
            return {"response": result, "parsed": parsed}
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:1000]
            last_error = f"HTTP {exc.code}: {detail}"
            if exc.code in {400, 401, 403, 404}:
                break
        except (URLError, TimeoutError, json.JSONDecodeError, KeyError, ValueError) as exc:
            last_error = f"{type(exc).__name__}: {exc}"
        if attempt < retries:
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(last_error)


def append_results(
    output_path: Path,
    batch_chunks: list[dict[str, Any]],
    api_result: dict[str, Any],
    model: str,
) -> tuple[int, list[str]]:
    expected = {chunk["chunk_id"] for chunk in batch_chunks}
    results_by_id = {
        str(result.get("chunk_id")): result
        for result in api_result["parsed"]["results"]
        if str(result.get("chunk_id")) in expected
    }
    missing = sorted(expected - set(results_by_id))
    if not results_by_id:
        raise ValueError(f"模型响应未包含任何预期chunk_id：{sorted(expected)}")
    response = api_result["response"]
    usage = response.get("usage") or {}
    with output_path.open("a", encoding="utf-8", newline="\n") as handle:
        for chunk in batch_chunks:
            if chunk["chunk_id"] not in results_by_id:
                continue
            record = {
                "chunk_id": chunk["chunk_id"],
                "model": response.get("model") or model,
                "api_response_id": response.get("id"),
                "extraction": results_by_id[chunk["chunk_id"]],
                "batch_usage": usage,
            }
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    return len(results_by_id), missing


def main() -> None:
    parser = argparse.ArgumentParser(description="使用DeepSeek抽取知识图谱候选")
    parser.add_argument("--chunks", type=Path, default=Path("data/processed/chunks.jsonl"))
    parser.add_argument("--ontology", type=Path, default=Path("config/kg_ontology.json"))
    parser.add_argument("--prompt", type=Path, default=Path("prompts/kg_extraction_system.txt"))
    parser.add_argument("--output", type=Path, default=Path("data/interim/kg_extractions.jsonl"))
    parser.add_argument("--report", type=Path, default=Path("data/reports/kg_extraction_report.json"))
    parser.add_argument("--model", default="deepseek-v4-flash")
    parser.add_argument("--batch-size", type=int, default=6)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.batch_size < 1 or args.batch_size > 12:
        parser.error("batch-size必须在1到12之间")

    ontology = json.loads(args.ontology.read_text(encoding="utf-8"))
    system_prompt = args.prompt.read_text(encoding="utf-8")
    done = processed_chunk_ids(args.output)
    chunks = [chunk for chunk in iter_jsonl(args.chunks) if chunk["chunk_id"] not in done]
    if args.limit is not None:
        chunks = chunks[: args.limit]
    if args.dry_run:
        preview = build_user_payload(chunks[: args.batch_size], ontology)
        print(json.dumps({"selected_chunks": len(chunks), "prompt_chars": len(preview)}, ensure_ascii=True))
        return

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        raise SystemExit("缺少环境变量DEEPSEEK_API_KEY；密钥不能写入项目文件。")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    completed = 0
    usage_totals: dict[str, int] = {}
    started = time.time()
    pending = list(chunks)
    missing_attempts: dict[str, int] = {}
    while pending:
        batch = pending[: args.batch_size]
        pending = pending[args.batch_size :]
        result = call_api(
            api_key,
            args.model,
            system_prompt,
            build_user_payload(batch, ontology),
            args.timeout,
            args.retries,
        )
        written, missing = append_results(args.output, batch, result, args.model)
        completed += written
        if missing:
            by_id = {chunk["chunk_id"]: chunk for chunk in batch}
            retry_chunks: list[dict[str, Any]] = []
            for chunk_id in missing:
                missing_attempts[chunk_id] = missing_attempts.get(chunk_id, 0) + 1
                if missing_attempts[chunk_id] > args.retries + 1:
                    raise RuntimeError(f"模型连续遗漏chunk_id：{chunk_id}")
                retry_chunks.append(by_id[chunk_id])
            # 缺失项放到下一批最前方；通常会缩小为单条重试。
            pending = retry_chunks + pending
        for key, value in (result["response"].get("usage") or {}).items():
            if isinstance(value, int):
                usage_totals[key] = usage_totals.get(key, 0) + value
        print(
            json.dumps(
                {
                    "completed_this_run": completed,
                    "remaining_selected": len(chunks) - completed,
                    "response_missing_requeued": len(missing),
                }
            ),
            flush=True,
        )

    total_records = len(processed_chunk_ids(args.output))
    report = {
        "model_requested": args.model,
        "api_url": API_URL,
        "thinking": "disabled",
        "completed_this_run": completed,
        "total_extraction_records": total_records,
        "remaining_chunks": max(0, sum(1 for _ in iter_jsonl(args.chunks)) - total_records),
        "usage_this_run": usage_totals,
        "elapsed_seconds": round(time.time() - started, 2),
        "api_key_persisted": False,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
