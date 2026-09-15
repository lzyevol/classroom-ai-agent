import { describe, expect, it } from "vitest";
import { ClassroomActionExecutor } from "@/lib/classroom/action-executor";
import type { ActionEvent } from "@/lib/sse/types";

function action(
  actionId: string,
  actionName: string,
  params: Record<string, unknown>,
): ActionEvent["data"] {
  return { actionId, actionName, params, agentId: "default-1" };
}

describe("课堂动作安全执行层", () => {
  it("按顺序打开白板并绘制文本", () => {
    const executor = new ClassroomActionExecutor();

    expect(executor.execute(action("a-1", "wb_open", {})).status).toBe("executed");
    expect(
      executor.execute(
        action("a-2", "wb_draw_text", { content: "感知 → 行动", x: 100, y: 80 }),
      ).status,
    ).toBe("executed");

    expect(executor.getSnapshot()).toMatchObject({
      open: true,
      elements: [{ id: "a-2", content: "感知 → 行动", x: 100, y: 80 }],
    });
  });

  it("绘制动作会按照原项目行为自动打开白板", () => {
    const executor = new ClassroomActionExecutor();
    executor.execute(action("a-1", "wb_draw_text", { content: "状态", x: 10, y: 20 }));

    expect(executor.getSnapshot().open).toBe(true);
  });

  it("相同 actionId 不会执行两次", () => {
    const executor = new ClassroomActionExecutor();
    const draw = action("a-1", "wb_draw_text", { content: "一次", x: 10, y: 20 });

    expect(executor.execute(draw).status).toBe("executed");
    expect(executor.execute(draw).status).toBe("duplicate");
    expect(executor.getSnapshot().elements).toHaveLength(1);
  });

  it("拒绝未知动作和非法参数", () => {
    const executor = new ClassroomActionExecutor();

    expect(executor.execute(action("a-1", "delete_everything", {}))).toMatchObject({
      status: "rejected",
      reason: "当前阶段不允许动作 delete_everything",
    });
    expect(
      executor.execute(
        action("a-2", "wb_draw_text", { content: "越界", x: 1001, y: 20 }),
      ),
    ).toMatchObject({ status: "rejected" });
    expect(executor.getSnapshot().elements).toHaveLength(0);
  });

  it("reset 后清空去重记录和白板", () => {
    const executor = new ClassroomActionExecutor();
    const open = action("a-1", "wb_open", {});
    executor.execute(open);
    executor.reset();

    expect(executor.getSnapshot()).toEqual({ open: false, elements: [] });
    expect(executor.execute(open).status).toBe("executed");
  });
});
