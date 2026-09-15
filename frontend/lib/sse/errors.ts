export class SSEProtocolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SSEProtocolError";
  }
}

export class SSEInterruptedError extends Error {
  constructor(message = "SSE 连接在终结事件到达前中断") {
    super(message);
    this.name = "SSEInterruptedError";
  }
}

export function createAbortError(): DOMException {
  return new DOMException("SSE 消费已取消", "AbortError");
}
