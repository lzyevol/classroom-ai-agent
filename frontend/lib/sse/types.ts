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

export function isStatelessEvent(value: unknown): value is StatelessEvent {
  if (!value || typeof value !== "object") return false;

  const candidate = value as { type?: unknown; data?: unknown };
  return (
    typeof candidate.type === "string" &&
    eventTypes.has(candidate.type as StatelessEvent["type"]) &&
    candidate.data !== null &&
    typeof candidate.data === "object" &&
    !Array.isArray(candidate.data)
  );
}

export function isTerminalEvent(event: StatelessEvent): event is TerminalEvent {
  return event.type === "done" || event.type === "error";
}
