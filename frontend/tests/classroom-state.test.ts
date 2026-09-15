import { describe, expect, it } from "vitest";
import {
  classroomErrorEvent,
  normalClassroomEvents,
} from "@/fixtures/classroom/events";
import {
  ClassroomStateError,
  createInitialClassroomState,
  markClassroomInterrupted,
  reduceClassroomEvent,
  reduceClassroomEvents,
} from "@/lib/classroom/state";
import type { StatelessEvent } from "@/lib/sse/types";

describe("课堂事件状态层", () => {
  it("把正常事件流归约为一条完整教师消息", () => {
    const state = reduceClassroomEvents(normalClassroomEvents);

    expect(state.status).toBe("waiting_for_user");
    expect(state.currentMessageId).toBeNull();
    expect(state.messages).toEqual([
      expect.objectContaining({
        id: "m-001",
        agentId: "default-1",
        agentName: "AI教师",
        content: "我们先看教材中的定义。",
        status: "complete",
      }),
    ]);
    expect(state.done).toMatchObject({ totalAgents: 1, totalActions: 0 });
  });

  it("多个 text_delta 按到达顺序追加而不是覆盖", () => {
    const events: StatelessEvent[] = [
      {
        type: "agent_start",
        data: { messageId: "m-002", agentId: "default-2", agentName: "AI助教" },
      },
      { type: "text_delta", data: { content: "换个" } },
      { type: "text_delta", data: { content: "角度解释。" } },
    ];

    const state = reduceClassroomEvents(events);
    expect(state.messages[0].content).toBe("换个角度解释。");
  });

  it("done 的 ended 状态结束课堂", () => {
    const state = reduceClassroomEvent(createInitialClassroomState(), {
      type: "done",
      data: { totalActions: 0, totalAgents: 0, sessionStatus: "ended" },
    });

    expect(state.status).toBe("ended");
  });

  it("cue_user 后的 done 即使不带状态也保持等待用户", () => {
    const state = reduceClassroomEvents([
      { type: "cue_user", data: { prompt: "请继续提问" } },
      { type: "done", data: { totalActions: 0, totalAgents: 0 } },
    ]);

    expect(state.status).toBe("waiting_for_user");
    expect(state.cue?.prompt).toBe("请继续提问");
  });

  it("error 事件保存错误并退出流式状态", () => {
    const state = reduceClassroomEvent(createInitialClassroomState(), classroomErrorEvent);

    expect(state.status).toBe("error");
    expect(state.error).toBe("模拟课堂服务失败");
    expect(state.currentMessageId).toBeNull();
  });

  it("相同 actionId 只进入队列一次", () => {
    const action: StatelessEvent = {
      type: "action",
      data: {
        actionId: "action-001",
        actionName: "wb_open",
        params: {},
        agentId: "default-1",
      },
    };

    const once = reduceClassroomEvent(createInitialClassroomState(), action);
    const twice = reduceClassroomEvent(once, action);
    expect(twice.actions).toHaveLength(1);
  });

  it("消息开始前收到 text_delta 时报告状态错误", () => {
    expect(() =>
      reduceClassroomEvent(createInitialClassroomState(), {
        type: "text_delta",
        data: { content: "没有消息归属" },
      }),
    ).toThrow(ClassroomStateError);
  });

  it("重复 messageId 不会覆盖已有消息", () => {
    const start: StatelessEvent = {
      type: "agent_start",
      data: { messageId: "m-003", agentId: "default-1", agentName: "AI教师" },
    };
    const state = reduceClassroomEvent(createInitialClassroomState(), start);

    expect(() => reduceClassroomEvent(state, start)).toThrow("消息被重复创建：m-003");
  });

  it("异常断线可以显式标记为 interrupted", () => {
    const streaming = reduceClassroomEvent(createInitialClassroomState(), {
      type: "agent_start",
      data: { messageId: "m-004", agentId: "default-1", agentName: "AI教师" },
    });

    const interrupted = markClassroomInterrupted(streaming);
    expect(interrupted.status).toBe("interrupted");
    expect(interrupted.error).toBe("课堂连接意外中断");
    expect(interrupted.currentMessageId).toBeNull();
    expect(interrupted.messages[0].status).toBe("interrupted");
  });
});
