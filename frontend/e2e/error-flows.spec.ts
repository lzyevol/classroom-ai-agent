import { expect, test } from "@playwright/test";

test("教材问答区分无证据与 503 服务错误", async ({ page }) => {
  await page.goto("/qa");

  await page.getByLabel("Mock 验证场景").selectOption("no-evidence");
  await page.getByRole("button", { name: "提交问题" }).click();
  await expect(page.getByText("当前没有找到足够的教材证据。本结果不能作为教材依据。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "教材引用" })).toHaveCount(0);

  await page.getByLabel("Mock 验证场景").selectOption("service-error");
  await page.getByRole("button", { name: "提交问题" }).click();
  await expect(page.locator("main [role=alert]")).toContainText("HTTP 503");
  await expect(page.getByLabel("请求诊断")).toContainText("HTTP 错误");
});

test("教材问答可以取消请求", async ({ page }) => {
  await page.goto("/qa");
  await page.getByRole("button", { name: "提交问题" }).click();
  await page.getByRole("button", { name: "取消" }).click();

  await expect(page.locator("main [role=alert]")).toHaveText("请求已取消");
  await expect(page.getByLabel("请求诊断")).toContainText("用户已取消");
});

test("课堂区分服务端 error 与无终结事件断流", async ({ page }) => {
  await page.goto("/classroom");

  await page.getByLabel("Mock 场景").selectOption("service-error");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator("main [role=alert]")).toContainText("模拟课堂服务失败");
  await expect(page.getByLabel("请求诊断")).toContainText("服务端流错误");

  await page.getByLabel("Mock 场景").selectOption("interrupted");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator("main [role=alert]")).toContainText("终结事件到达前中断");
  await expect(page.getByLabel("请求诊断")).toContainText("连接中断");
});

test("课堂取消后停止继续消费事件", async ({ page }) => {
  await page.goto("/classroom");
  await page.getByRole("button", { name: "发送" }).click();
  await page.getByRole("button", { name: "停止" }).click();

  await expect(page.locator("main [role=alert]")).toHaveText("请求已取消");
  await expect(page.getByLabel("请求诊断")).toContainText("用户已取消");
  await expect(page.getByText("本轮角色数：1；动作数：0")).toHaveCount(0);
});

test("课堂白板动作去重并显示执行记录", async ({ page }) => {
  await page.goto("/classroom");
  await page.getByLabel("Mock 场景").selectOption("whiteboard");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByRole("heading", { name: "Mock 白板" })).toBeVisible();
  await expect(page.getByText("感知 → 决策 → 行动 → 环境反馈")).toBeVisible();
  await expect(page.getByText(/action-text-001 · duplicate/)).toBeVisible();
  await expect(page.getByText("这条重复动作不应再次执行")).toHaveCount(0);
});

test("练习阻止漏答并报告题库不足", async ({ page }) => {
  await page.goto("/practice");
  await page.getByRole("button", { name: "开始练习" }).click();
  await page.getByRole("button", { name: "提交答案" }).click();
  await expect(page.locator("main [role=alert]")).toContainText("还有 3 道题未作答");

  await page.getByLabel("Mock 验证场景").selectOption("generate-error");
  await page.getByRole("button", { name: "重新开始" }).click();
  await expect(page.locator("main [role=alert]")).toContainText("HTTP 422");
  await expect(page.getByLabel("请求诊断")).toContainText("HTTP 错误");
});

test("练习显示重复提交冲突且保留当前会话", async ({ page }) => {
  await page.goto("/practice");
  await page.getByLabel("Mock 验证场景").selectOption("submit-error");
  await page.getByRole("button", { name: "开始练习" }).click();

  for (const index of [1, 2, 3]) {
    await page.getByRole("group", { name: `第 ${index} 题选项` }).getByRole("radio").first().check();
  }
  await page.getByRole("button", { name: "提交答案" }).click();

  await expect(page.locator("main [role=alert]")).toContainText("HTTP 409");
  await expect(page.getByRole("button", { name: "提交答案" })).toBeEnabled();
  await expect(page.getByText(/会话 mock-session-001/)).toBeVisible();
});

test("创建练习时可以取消", async ({ page }) => {
  await page.goto("/practice");
  await page.getByRole("button", { name: "开始练习" }).click();
  await page.getByRole("button", { name: "取消" }).click();

  await expect(page.locator("main [role=alert]")).toHaveText("请求已取消");
  await expect(page.getByLabel("请求诊断")).toContainText("用户已取消");
  await expect(page.getByRole("button", { name: "提交答案" })).toHaveCount(0);
});
