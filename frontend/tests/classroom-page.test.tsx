import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import ClassroomPage from "@/app/classroom/page";

describe("智能课堂页面", () => {
  it("消费 Mock SSE 并展示教师消息和等待状态", async () => {
    const user = userEvent.setup();
    render(<ClassroomPage />);

    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("我们先看教材中的定义。")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI教师" })).toBeInTheDocument();
    expect(await screen.findByText("等待用户")).toBeInTheDocument();
    expect(await screen.findByText("本轮角色数：1；动作数：0")).toBeInTheDocument();
  });

  it("error 事件显示错误并结束生成状态", async () => {
    const user = userEvent.setup();
    render(<ClassroomPage />);

    await user.selectOptions(screen.getByLabelText("Mock 场景"), "service-error");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("模拟课堂服务失败");
    expect(screen.getByText("生成失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送" })).toBeEnabled();
  });

  it("没有终结事件的断流显示为连接中断", async () => {
    const user = userEvent.setup();
    render(<ClassroomPage />);

    await user.selectOptions(screen.getByLabelText("Mock 场景"), "interrupted");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "SSE 连接在终结事件到达前中断",
    );
    expect(screen.getByText("连接中断", { selector: "span" })).toBeInTheDocument();
  });

  it("停止按钮通过 AbortSignal 取消消费", async () => {
    const user = userEvent.setup();
    render(<ClassroomPage />);

    await user.click(screen.getByRole("button", { name: "发送" }));
    await user.click(await screen.findByRole("button", { name: "停止" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("请求已取消");
    expect(screen.getByText("连接中断")).toBeInTheDocument();
    const interruptedLabels = screen.queryAllByText("已中断");
    if (screen.queryByRole("heading", { name: "AI教师" })) {
      expect(interruptedLabels).toHaveLength(1);
    }
  });

  it("校验并执行白板动作，同时记录重复 actionId", async () => {
    const user = userEvent.setup();
    render(<ClassroomPage />);

    await user.selectOptions(screen.getByLabelText("Mock 场景"), "whiteboard");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByRole("heading", { name: "Mock 白板" })).toBeInTheDocument();
    expect(await screen.findByText("感知 → 决策 → 行动 → 环境反馈")).toBeInTheDocument();
    expect(screen.queryByText("这条重复动作不应再次执行")).not.toBeInTheDocument();
    expect(
      await screen.findByText(/wb_draw_text · action-text-001 · duplicate/),
    ).toBeInTheDocument();
    const diagnostic = screen.getByLabelText("请求诊断");
    expect(await within(diagnostic).findByText("请求完成")).toBeInTheDocument();
  });
});
