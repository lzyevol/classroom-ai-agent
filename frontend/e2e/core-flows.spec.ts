import { expect, test } from "@playwright/test";

test("首页可以进入三个核心功能", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "从教材证据出发的智能课堂" })).toBeVisible();
  await expect(page.getByRole("link", { name: "进入教材问答" })).toHaveAttribute("href", "/qa");
  await expect(page.getByRole("link", { name: "进入智能课堂" })).toHaveAttribute(
    "href",
    "/classroom",
  );
  await expect(page.getByRole("link", { name: "进入章节练习" })).toHaveAttribute(
    "href",
    "/practice",
  );
});

test("教材问答显示 Mock 回答和引用", async ({ page }) => {
  await page.goto("/qa");
  await page.getByRole("button", { name: "提交问题" }).click();

  await expect(page.getByRole("heading", { name: "回答" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "教材引用" })).toBeVisible();
  await expect(page.getByText("chunk_id: mock:1.1:chunk-001")).toBeVisible();
});

test("智能课堂消费 SSE 并进入等待用户状态", async ({ page }) => {
  await page.goto("/classroom");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByRole("heading", { name: "AI教师" })).toBeVisible();
  await expect(page.getByText("我们先看教材中的定义。")).toBeVisible();
  await expect(page.getByText("等待用户", { exact: true })).toBeVisible();
});

test("章节练习完成作答并展示批改汇总", async ({ page }) => {
  await page.goto("/practice");
  await page.getByRole("button", { name: "开始练习" }).click();
  await expect(
    page.getByRole("heading", { name: "1. 具身智能系统最强调哪种能力？" }),
  ).toBeVisible();

  for (const index of [1, 2, 3]) {
    await page.getByRole("group", { name: `第 ${index} 题选项` }).getByRole("radio").first().check();
  }
  await page.getByRole("button", { name: "提交答案" }).click();

  await expect(page.getByRole("heading", { name: "练习完成" })).toBeVisible();
  await expect(page.getByText("20.00 / 30.00")).toBeVisible();
  await expect(page.getByText("答对 2 / 3 题")).toBeVisible();
});
