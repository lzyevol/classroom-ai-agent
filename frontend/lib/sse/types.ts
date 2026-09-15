export interface AgentStartEvent {
  type: "agent_start";
  data: {
    messageId: string;
    agentId: string;
    agentName: string;
    agentAvatar?: string;
    agentColor?: string;
  };
}

export interface TextDeltaEvent {
  type: "text_delta";
  data: {
    messageId?: string;
    content: string;
  };
}

export interface AgentEndEvent {
  type: "agent_end";
  data: {
    messageId: string;
    agentId: string;
  };
}

export interface ActionEvent {
  type: "action";
  data: {
    actionId: string;
    actionName: string;
    params: Record<string, unknown>;
    agentId: string;
    messageId?: string;
  };
}

export interface ThinkingEvent {
  type: "thinking";
  data: Record<string, unknown>;
}

export interface CueUserEvent {
  type: "cue_user";
  data: {
    fromAgentId?: string;
    prompt?: string;
  };
}

export interface DoneEvent {
  type: "done";
  data: {
    totalActions: number;
    totalAgents: number;
    agentHadContent?: boolean;
    sessionStatus?: string;
    directorState?: unknown;
    classroomTrace?: unknown;
  };
}

export interface ErrorEvent {
  type: "error";
  data: {
    message: string;
  };
}

export type StatelessEvent =
  | AgentStartEvent
  | TextDeltaEvent
  | AgentEndEvent
  | ActionEvent
  | ThinkingEvent
  | CueUserEvent
  | DoneEvent
  | ErrorEvent;

export type TerminalEvent = DoneEvent | ErrorEvent;

const eventTypes = new Set<StatelessEvent["type"]>([
  "agent_start",
  "text_delta",
  "agent_end",
  "action",
  "thinking",
  "cue_user",
  "done",
  "error",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isStatelessEvent(value: unknown): value is StatelessEvent {
  if (!isObject(value) || !isString(value.type) || !eventTypes.has(value.type as StatelessEvent["type"])) {
    return false;
  }
  if (!isObject(value.data)) return false;
  const data = value.data;

  switch (value.type) {
    case "agent_start":
      return (
        isString(data.messageId) &&
        isString(data.agentId) &&
        isString(data.agentName) &&
        isOptionalString(data.agentAvatar) &&
        isOptionalString(data.agentColor)
      );
    case "text_delta":
      return isString(data.content) && isOptionalString(data.messageId);
    case "agent_end":
      return isString(data.messageId) && isString(data.agentId);
    case "action":
      return (
        isString(data.actionId) &&
        isString(data.actionName) &&
        isObject(data.params) &&
        isString(data.agentId) &&
        isOptionalString(data.messageId)
      );
    case "thinking":
      return true;
    case "cue_user":
      return isOptionalString(data.fromAgentId) && isOptionalString(data.prompt);
    case "done":
      return (
        isFiniteNumber(data.totalActions) &&
        isFiniteNumber(data.totalAgents) &&
        isOptionalString(data.sessionStatus)
      );
    case "error":
      return isString(data.message);
    default:
      return false;
  }
}

export function isTerminalEvent(event: StatelessEvent): event is TerminalEvent {
  return event.type === "done" || event.type === "error";
}
