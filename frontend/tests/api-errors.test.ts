import { describe, expect, it } from "vitest";
import { responseToApiError } from "@/lib/api/errors";

describe("FastAPI 错误适配器", () => {
  it("读取字符串 detail", async () => {
    const error = await responseToApiError(
      new Response(JSON.stringify({ detail: "检索服务不可用" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
      "请求失败",
    );

    expect(error.status).toBe(503);
    expect(error.message).toBe("检索服务不可用");
  });

  it("合并 FastAPI 参数校验错误", async () => {
    const error = await responseToApiError(
      new Response(
        JSON.stringify({
          detail: [{ msg: "问题不能为空" }, { msg: "引用数量超出范围" }],
        }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      ),
      "请求失败",
    );

    expect(error.status).toBe(422);
    expect(error.message).toBe("问题不能为空；引用数量超出范围");
  });

  it("非 JSON 错误使用友好兜底文案", async () => {
    const error = await responseToApiError(
      new Response("upstream failed", { status: 500 }),
      "问答请求失败",
    );

    expect(error.status).toBe(500);
    expect(error.message).toBe("问答请求失败");
  });
});
