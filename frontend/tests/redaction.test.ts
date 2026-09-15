import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { diagnosticFromError } from "@/lib/diagnostics/request";
import { redactSensitiveText } from "@/lib/security/redact";

describe("前端错误脱敏", () => {
  it("隐藏 Bearer、Provider Key 和常见凭据赋值", () => {
    const providerKey = `sk-${"1234567890abcdef"}`;
    const source =
      `Authorization: Bearer abc.def.ghi api_key=secret-value password: hunter2 ${providerKey}`;
    const redacted = redactSensitiveText(source);

    expect(redacted).not.toContain("abc.def.ghi");
    expect(redacted).not.toContain("secret-value");
    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain(providerKey);
    expect(redacted).toContain("[REDACTED]");
  });

  it("ApiError 和请求诊断不会重新暴露服务端秘密", () => {
    const error = new ApiError("token=private-token upstream failed", 500);
    const diagnostic = diagnosticFromError("qa.ask", "real", error);

    expect(error.message).toBe("token=[REDACTED] upstream failed");
    expect(diagnostic.detail).toBe("token=[REDACTED] upstream failed");
    expect(diagnostic.httpStatus).toBe(500);
  });

  it("限制诊断文本长度", () => {
    expect(redactSensitiveText("a".repeat(800))).toHaveLength(501);
  });
});
