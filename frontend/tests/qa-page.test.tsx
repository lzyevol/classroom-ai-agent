import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QAPage from "@/app/qa/page";
import { mockQANoEvidence, mockQASuccess } from "@/fixtures/qa/responses";
import { ApiError } from "@/lib/api/errors";

const askQuestionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/qa-client", () => ({
  apiMode: "mock",
  askQuestion: askQuestionMock,
}));

describe("教材问答页面", () => {
  beforeEach(() => {
    askQuestionMock.mockReset();
  });

  it("提交问题后展示回答和教材引用", async () => {
    const user = userEvent.setup();
    askQuestionMock.mockResolvedValue(mockQASuccess);

    render(<QAPage />);
    await user.click(screen.getByRole("button", { name: "提交问题" }));

    expect(await screen.findByText(mockQASuccess.answer)).toBeInTheDocument();
    expect(screen.getByText(mockQASuccess.citations[0].quote)).toBeInTheDocument();
    expect(screen.getByText(/mock:1\.1:chunk-001/)).toBeInTheDocument();
    expect(askQuestionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "什么是具身智能？",
        mockScenario: "success",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("证据不足时显示警告且不展示引用区", async () => {
    const user = userEvent.setup();
    askQuestionMock.mockResolvedValue(mockQANoEvidence);

    render(<QAPage />);
    await user.selectOptions(screen.getByLabelText("Mock 验证场景"), "no-evidence");
    await user.click(screen.getByRole("button", { name: "提交问题" }));

    expect(
      await screen.findByText("当前没有找到足够的教材证据。本结果不能作为教材依据。"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "教材引用" })).not.toBeInTheDocument();
  });

  it("服务不可用时显示状态码和可理解的错误", async () => {
    const user = userEvent.setup();
    askQuestionMock.mockRejectedValue(new ApiError("模拟检索服务暂不可用", 503));

    render(<QAPage />);
    await user.selectOptions(screen.getByLabelText("Mock 验证场景"), "service-error");
    await user.click(screen.getByRole("button", { name: "提交问题" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "模拟检索服务暂不可用（HTTP 503）",
    );
  });

  it("可以取消正在进行的请求", async () => {
    const user = userEvent.setup();
    askQuestionMock.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("请求已取消", "AbortError")),
            { once: true },
          );
        }),
    );

    render(<QAPage />);
    await user.click(screen.getByRole("button", { name: "提交问题" }));
    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("请求已取消");
  });

  it("问题为空时禁止提交", async () => {
    const user = userEvent.setup();

    render(<QAPage />);
    await user.clear(screen.getByLabelText("你的问题"));

    expect(screen.getByRole("button", { name: "提交问题" })).toBeDisabled();
    expect(askQuestionMock).not.toHaveBeenCalled();
  });
});
