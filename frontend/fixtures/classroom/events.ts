import type { StatelessEvent } from "@/lib/sse/types";

export const normalClassroomEvents: StatelessEvent[] = [
  {
    type: "agent_start",
    data: {
      messageId: "m-001",
      agentId: "default-1",
      agentName: "AI教师",
    },
  },
  {
    type: "text_delta",
    data: {
      messageId: "m-001",
      content: "我们先看教材中的定义。",
    },
  },
  {
    type: "agent_end",
    data: {
      messageId: "m-001",
      agentId: "default-1",
    },
  },
  {
    type: "cue_user",
    data: {},
  },
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

export const classroomErrorEvent = {
  type: "error",
  data: {
    message: "模拟课堂服务失败",
  },
} satisfies StatelessEvent;

export function encodeSSE(
  events: StatelessEvent[],
  lineEnding: "\n" | "\r\n" = "\n",
): Uint8Array {
  const text = events
    .map((event) => `data: ${JSON.stringify(event)}${lineEnding}${lineEnding}`)
    .join("");
  return new TextEncoder().encode(text);
}
