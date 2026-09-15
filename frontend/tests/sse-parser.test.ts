import { describe, expect, it } from "vitest";
import {
  classroomErrorEvent,
  encodeSSE,
  normalClassroomEvents,
} from "@/fixtures/classroom/events";
import { SSEInterruptedError, SSEProtocolError } from "@/lib/sse/errors";
import { parseSSEStream } from "@/lib/sse/parser";
import type { StatelessEvent } from "@/lib/sse/types";

function responseFromChunks(chunks: Uint8Array[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

async function collect(response: Response, signal?: AbortSignal) {
  const events: StatelessEvent[] = [];
  for await (const event of parseSSEStream(response, signal)) {
    events.push(event);
  }
  return events;
}

describe("课堂 SSE 解析器", () => {
  it("解析正常事件流并保持顺序", async () => {
    const events = await collect(responseFromChunks([encodeSSE(normalClassroomEvents)]));
    expect(events).toEqual(normalClassroomEvents);
  });

  it("一次读取中可以解析多个事件", async () => {
    const oneChunk = encodeSSE(normalClassroomEvents);
    const events = await collect(responseFromChunks([oneChunk]));

    expect(events).toHaveLength(5);
    expect(events.map((event) => event.type)).toEqual([
      "agent_start",
      "text_delta",
      "agent_end",
      "cue_user",
      "done",
    ]);
  });

  it("每个 UTF-8 字节单独分片时仍能还原中文", async () => {
    const encoded = encodeSSE(normalClassroomEvents);
    const chunks = Array.from(encoded, (byte) => Uint8Array.of(byte));
    const events = await collect(responseFromChunks(chunks));

    expect(events).toEqual(normalClassroomEvents);
    expect(events[1]).toMatchObject({
      type: "text_delta",
      data: { content: "我们先看教材中的定义。" },
    });
  });

  it("兼容 CRLF 分隔的 SSE", async () => {
    const events = await collect(
      responseFromChunks([encodeSSE(normalClassroomEvents, "\r\n")]),
    );
    expect(events).toEqual(normalClassroomEvents);
  });

  it("error 事件可以正常结束流", async () => {
    const events = await collect(responseFromChunks([encodeSSE([classroomErrorEvent])]));
    expect(events).toEqual([classroomErrorEvent]);
  });

  it("没有 done 或 error 就关闭时报告中断", async () => {
    const incomplete = encodeSSE(normalClassroomEvents.slice(0, 2));
    await expect(collect(responseFromChunks([incomplete]))).rejects.toBeInstanceOf(
      SSEInterruptedError,
    );
  });

  it("非法 JSON 报告协议错误", async () => {
    const invalid = new TextEncoder().encode("data: {not-json}\n\n");
    await expect(collect(responseFromChunks([invalid]))).rejects.toBeInstanceOf(
      SSEProtocolError,
    );
  });

  it("AbortSignal 可以停止等待中的读取", async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
        },
      }),
    );
    const abortController = new AbortController();
    const collecting = collect(response, abortController.signal);

    abortController.abort();
    await expect(collecting).rejects.toMatchObject({ name: "AbortError" });
    expect(streamController).toBeDefined();
  });
});
