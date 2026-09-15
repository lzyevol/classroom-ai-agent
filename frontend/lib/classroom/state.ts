import type {
  ActionEvent,
  DoneEvent,
  StatelessEvent,
} from "@/lib/sse/types";
import { redactSensitiveText } from "@/lib/security/redact";

export type ClassroomStatus =
  | "idle"
  | "streaming"
  | "waiting_for_user"
  | "ended"
  | "completed"
  | "error"
  | "interrupted";

export interface ClassroomMessage {
  id: string;
  agentId: string;
  agentName: string;
  agentAvatar?: string;
  agentColor?: string;
  content: string;
  status: "streaming" | "complete" | "interrupted";
}

export interface ClassroomCue {
  fromAgentId?: string;
  prompt?: string;
}

export interface ClassroomState {
  status: ClassroomStatus;
  messages: ClassroomMessage[];
  currentMessageId: string | null;
  actions: ActionEvent["data"][];
  thinking: Record<string, unknown>[];
  cue: ClassroomCue | null;
  done: DoneEvent["data"] | null;
  error: string | null;
}

export class ClassroomStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClassroomStateError";
  }
}

export function createInitialClassroomState(): ClassroomState {
  return {
    status: "idle",
    messages: [],
    currentMessageId: null,
    actions: [],
    thinking: [],
    cue: null,
    done: null,
    error: null,
  };
}

function updateMessage(
  state: ClassroomState,
  messageId: string,
  update: (message: ClassroomMessage) => ClassroomMessage,
): ClassroomMessage[] {
  let found = false;
  const messages = state.messages.map((message) => {
    if (message.id !== messageId) return message;
    found = true;
    return update(message);
  });

  if (!found) {
    throw new ClassroomStateError(`事件引用了不存在的消息：${messageId}`);
  }

  return messages;
}

function statusFromDone(
  data: DoneEvent["data"],
  currentStatus: ClassroomStatus,
): ClassroomStatus {
  if (data.sessionStatus === "waiting_for_user") return "waiting_for_user";
  if (data.sessionStatus === "ended") return "ended";
  if (currentStatus === "waiting_for_user") return "waiting_for_user";
  return "completed";
}

export function reduceClassroomEvent(
  state: ClassroomState,
  event: StatelessEvent,
): ClassroomState {
  switch (event.type) {
    case "agent_start": {
      if (state.messages.some((message) => message.id === event.data.messageId)) {
        throw new ClassroomStateError(`消息被重复创建：${event.data.messageId}`);
      }

      return {
        ...state,
        status: "streaming",
        currentMessageId: event.data.messageId,
        error: null,
        messages: [
          ...state.messages,
          {
            id: event.data.messageId,
            agentId: event.data.agentId,
            agentName: event.data.agentName,
            agentAvatar: event.data.agentAvatar,
            agentColor: event.data.agentColor,
            content: "",
            status: "streaming",
          },
        ],
      };
    }

    case "text_delta": {
      const messageId = event.data.messageId ?? state.currentMessageId;
      if (!messageId) {
        throw new ClassroomStateError("text_delta 到达时没有可追加的消息");
      }

      return {
        ...state,
        status: "streaming",
        messages: updateMessage(state, messageId, (message) => ({
          ...message,
          content: message.content + event.data.content,
        })),
      };
    }

    case "agent_end": {
      return {
        ...state,
        currentMessageId:
          state.currentMessageId === event.data.messageId ? null : state.currentMessageId,
        messages: updateMessage(state, event.data.messageId, (message) => ({
          ...message,
          status: "complete",
        })),
      };
    }

    case "action": {
      if (state.actions.some((action) => action.actionId === event.data.actionId)) {
        return state;
      }
      return { ...state, actions: [...state.actions, event.data] };
    }

    case "thinking":
      return { ...state, thinking: [...state.thinking, event.data] };

    case "cue_user":
      return {
        ...state,
        status: "waiting_for_user",
        cue: event.data,
      };

    case "done":
      return {
        ...state,
        status: statusFromDone(event.data, state.status),
        currentMessageId: null,
        done: event.data,
      };

    case "error":
      return markClassroomFailed(state, event.data.message);
  }
}

export function reduceClassroomEvents(
  events: StatelessEvent[],
  initialState = createInitialClassroomState(),
): ClassroomState {
  return events.reduce(reduceClassroomEvent, initialState);
}

export function markClassroomInterrupted(
  state: ClassroomState,
  message = "课堂连接意外中断",
): ClassroomState {
  return {
    ...state,
    status: "interrupted",
    currentMessageId: null,
    error: redactSensitiveText(message),
    messages: state.messages.map((classroomMessage) =>
      classroomMessage.status === "streaming"
        ? { ...classroomMessage, status: "interrupted" }
        : classroomMessage,
    ),
  };
}

export function markClassroomFailed(
  state: ClassroomState,
  message: string,
): ClassroomState {
  return {
    ...state,
    status: "error",
    currentMessageId: null,
    error: redactSensitiveText(message),
    messages: state.messages.map((classroomMessage) =>
      classroomMessage.status === "streaming"
        ? { ...classroomMessage, status: "interrupted" }
        : classroomMessage,
    ),
  };
}
