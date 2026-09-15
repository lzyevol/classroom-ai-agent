import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import PracticePage from "@/app/practice/page";

async function beginPractice(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "开始练习" }));
  await screen.findByRole("heading", {
    name: "1. 具身智能系统最强调哪种能力？",
  });
}

async function answerAll(user: ReturnType<typeof userEvent.setup>) {
  const groups = [
    "第 1 题选项",
    "第 2 题选项",
    "第 3 题选项",
  ];
  for (const group of groups) {
    const fieldset = screen.getByRole("group", { name: group });
    await user.click(fieldset.querySelector("input") as HTMLInputElement);
  }
}

describe("章节练习页面", () => {
  it("创建练习后展示三道公开题目", async () => {
    const user = userEvent.setup();
    render(<PracticePage />);

    await beginPractice(user);

    expect(screen.getAllByRole("group")).toHaveLength(3);
    expect(screen.getByText(/会话 mock-session-001/)).toBeInTheDocument();
    expect(screen.queryByText(/正确答案/)).not.toBeInTheDocument();
  });

  it("未完成全部题目时阻止提交", async () => {
    const user = userEvent.setup();
    render(<PracticePage />);
    await beginPractice(user);

    await user.click(screen.getByRole("button", { name: "提交答案" }));

    expect(screen.getByRole("alert")).toHaveTextContent("还有 3 道题未作答");
    expect(screen.queryByText("练习完成")).not.toBeInTheDocument();
  });

  it("提交后展示部分答错 fixture、总分和引用", async () => {
    const user = userEvent.setup();
    render(<PracticePage />);
    await beginPractice(user);
    await answerAll(user);

    await user.click(screen.getByRole("button", { name: "提交答案" }));

    expect(await screen.findByText("20.00 / 30.00")).toBeInTheDocument();
    expect(screen.getByText("答对 2 / 3 题")).toBeInTheDocument();
    expect(screen.getByText("回答错误，正确答案：A")).toBeInTheDocument();
    expect(screen.getAllByText(/具身智能导论（Mock）/)).toHaveLength(3);
  });

  it("题库不足时展示 422 错误", async () => {
    const user = userEvent.setup();
    render(<PracticePage />);

    await user.selectOptions(screen.getByLabelText("Mock 验证场景"), "generate-error");
    await user.click(screen.getByRole("button", { name: "开始练习" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "模拟题库暂时不足，无法创建练习（HTTP 422）",
    );
    expect(within(screen.getByLabelText("请求诊断")).getByText("422")).toBeInTheDocument();
  });

  it("可以取消正在创建的练习", async () => {
    const user = userEvent.setup();
    render(<PracticePage />);

    await user.click(screen.getByRole("button", { name: "开始练习" }));
    await user.click(await screen.findByRole("button", { name: "取消" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("请求已取消");
    expect(screen.queryByRole("button", { name: "提交答案" })).not.toBeInTheDocument();
  });

  it("提交冲突时展示 409 且保留作答页面", async () => {
    const user = userEvent.setup();
    render(<PracticePage />);
    await user.selectOptions(screen.getByLabelText("Mock 验证场景"), "submit-error");
    await beginPractice(user);
    await answerAll(user);

    await user.click(screen.getByRole("button", { name: "提交答案" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "模拟会话已经提交，请重新开始练习（HTTP 409）",
    );
    expect(screen.getByRole("button", { name: "提交答案" })).toBeEnabled();
  });
});
