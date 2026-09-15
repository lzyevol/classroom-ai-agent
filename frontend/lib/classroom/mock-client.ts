import { classroomErrorEvent, normalClassroomEvents } from "@/fixtures/classroom/events";
import type { StatelessEvent } from "@/lib/sse/types";

export type MockClassroomScenario =
  | "teacher"
  | "assistant"
  | "ack"
  | "stop"
  | "whiteboard"
  | "service-error"
  | "interrupted";

const assistantEvents: StatelessEvent[] = [
  {
    type: "agent_start",
    data: { messageId: "m-002", agentId: "default-2", agentName: "AI助教" },
  },
  {
    type: "text_delta",
    data: { messageId: "m-002", content: "我们换一个更直观的角度来理解。" },
  },
  {
    type: "agent_end",
    data: { messageId: "m-002", agentId: "default-2" },
  },
  { type: "cue_user", data: { fromAgentId: "default-2", prompt: "现在清楚一些了吗？" } },
  {
    type: "done",
    data: {
      totalActions: 0,
      totalAgents: 1,
      agentHadContent: true,
      sessionStatus: "waiting_for_user",
    },
  },
];

const whiteboardEvents: StatelessEvent[] = [
  {
    type: "agent_start",
    data: { messageId: "m-003", agentId: "default-1", agentName: "AI教师" },
  },
  {
    type: "text_delta",
    data: { messageId: "m-003", content: "我们在白板上画出感知与行动的闭环。" },
  },
  {
    type: "action",
    data: {
      actionId: "action-open-001",
      actionName: "wb_open",
      params: {},
      agentId: "default-1",
      messageId: "m-003",
    },
  },
  {
    type: "action",
    data: {
      actionId: "action-text-001",
      actionName: "wb_draw_text",
      params: { content: "感知 → 决策 → 行动 → 环境反馈", x: 90, y: 80, fontSize: 26 },
      agentId: "default-1",
      messageId: "m-003",
    },
  },
  {
    type: "action",
    data: {
      actionId: "action-text-001",
      actionName: "wb_draw_text",
      params: { content: "这条重复动作不应再次执行", x: 90, y: 180 },
      agentId: "default-1",
      messageId: "m-003",
    },
  },
  { type: "agent_end", data: { messageId: "m-003", agentId: "default-1" } },
  { type: "cue_user", data: { prompt: "请观察这个闭环。" } },
  {
    type: "done",
    data: { totalActions: 2, totalAgents: 1, sessionStatus: "waiting_for_user" },
  },
];

function eventsForScenario(scenario: MockClassroomScenario): StatelessEvent[] {
  switch (scenario) {
    case "teacher":
      return normalClassroomEvents;
    case "assistant":
      return assistantEvents;
    case "ack":
      return [
        { type: "cue_user", data: { prompt: "已收到，请继续提问。" } },
        {
          type: "done",
          data: { totalActions: 0, totalAgents: 0, sessionStatus: "waiting_for_user" },
        },
      ];
    case "stop":
      return [
        {
          type: "done",
          data: { totalActions: 0, totalAgents: 0, sessionStatus: "ended" },
        },
      ];
    case "whiteboard":
      return whiteboardEvents;
    case "service-error":
      return [classroomErrorEvent];
    case "interrupted":
      return normalClassroomEvents.slice(0, 2);
  }
}

function encodeEvent(event: StatelessEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export function createMockClassroomResponse(
  scenario: MockClassroomScenario,
  delayMs = 100,
): Response {
  const chunks = eventsForScenario(scenario).map(encodeEvent);
  let index = 0;
  let cancelled = false;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
      if (cancelled) return;

      if (index >= chunks.length) {
        controller.close();
        return;
      }

      controller.enqueue(chunks[index]);
      index += 1;
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}
