import { createAbortError, SSEInterruptedError, SSEProtocolError } from "@/lib/sse/errors";
import {
  isStatelessEvent,
  isTerminalEvent,
  type StatelessEvent,
} from "@/lib/sse/types";

const recordSeparator = /\r\n\r\n|\n\n/;

function parseRecord(record: string): StatelessEvent | null {
  const dataLines = record
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data: ?/, ""));

  if (dataLines.length === 0) return null;

  const payload = dataLines.join("\n");
  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new SSEProtocolError("SSE data 不是有效 JSON", { cause: error });
  }

  if (!isStatelessEvent(parsed)) {
    throw new SSEProtocolError("SSE 事件类型或必要字段不符合课堂协议");
  }

  return parsed;
}

function takeCompleteRecords(buffer: string): {
  records: string[];
  remainder: string;
} {
  const records: string[] = [];
  let remainder = buffer;

  while (true) {
    const match = recordSeparator.exec(remainder);
    if (!match || match.index === undefined) break;

    records.push(remainder.slice(0, match.index));
    remainder = remainder.slice(match.index + match[0].length);
  }

  return { records, remainder };
}

/**
 * Convert an arbitrary byte-chunked SSE response into typed classroom events.
 * A valid stream must end with exactly one terminal event: done or error.
 */
export async function* parseSSEStream(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<StatelessEvent, void, undefined> {
  if (!response.body) {
    throw new SSEProtocolError("SSE 响应没有可读取的 body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminalReceived = false;

  const cancelReader = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", cancelReader, { once: true });

  try {
    while (true) {
      if (signal?.aborted) throw createAbortError();

      const { done, value } = await reader.read();
      if (signal?.aborted) throw createAbortError();

      if (done) {
        buffer += decoder.decode();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const { records, remainder } = takeCompleteRecords(buffer);
      buffer = remainder;

      for (const record of records) {
        const event = parseRecord(record);
        if (!event) continue;

        yield event;
        if (isTerminalEvent(event)) {
          terminalReceived = true;
          return;
        }
      }
    }

    if (buffer.trim()) {
      const event = parseRecord(buffer);
      if (event) {
        yield event;
        terminalReceived = isTerminalEvent(event);
      }
    }

    if (!terminalReceived) {
      throw new SSEInterruptedError();
    }
  } finally {
    signal?.removeEventListener("abort", cancelReader);
    reader.releaseLock();
  }
}
