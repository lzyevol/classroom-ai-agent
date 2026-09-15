import type { ActionEvent } from "@/lib/sse/types";

export interface WhiteboardTextElement {
  id: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  color: string;
}

export interface WhiteboardSnapshot {
  open: boolean;
  elements: WhiteboardTextElement[];
}

export interface ActionExecutionResult {
  actionId: string;
  actionName: string;
  status: "executed" | "duplicate" | "rejected";
  reason?: string;
}

const DRAW_TEXT_KEYS = new Set([
  "elementId",
  "content",
  "x",
  "y",
  "width",
  "height",
  "fontSize",
  "color",
]);

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function optionalString(value: unknown, maximumLength: number): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length <= maximumLength);
}

function rejected(action: ActionEvent["data"], reason: string): ActionExecutionResult {
  return {
    actionId: action.actionId,
    actionName: action.actionName,
    status: "rejected",
    reason,
  };
}

/**
 * Browser-side safety boundary for the first whiteboard milestone.
 * Only actions confirmed by the reference project and the team contract are accepted.
 */
export class ClassroomActionExecutor {
  private readonly seenActionIds = new Set<string>();
  private snapshot: WhiteboardSnapshot = { open: false, elements: [] };

  reset(): void {
    this.seenActionIds.clear();
    this.snapshot = { open: false, elements: [] };
  }

  getSnapshot(): WhiteboardSnapshot {
    return {
      open: this.snapshot.open,
      elements: this.snapshot.elements.map((element) => ({ ...element })),
    };
  }

  execute(action: ActionEvent["data"]): ActionExecutionResult {
    if (!action.actionId.trim()) return rejected(action, "actionId 不能为空");
    if (this.seenActionIds.has(action.actionId)) {
      return {
        actionId: action.actionId,
        actionName: action.actionName,
        status: "duplicate",
        reason: "相同 actionId 已处理",
      };
    }
    this.seenActionIds.add(action.actionId);

    if (action.actionName === "wb_open") {
      if (Object.keys(action.params).length > 0) {
        return rejected(action, "wb_open 不接受参数");
      }
      this.snapshot = { ...this.snapshot, open: true };
      return { actionId: action.actionId, actionName: action.actionName, status: "executed" };
    }

    if (action.actionName !== "wb_draw_text") {
      return rejected(action, `当前阶段不允许动作 ${action.actionName}`);
    }

    const params = action.params;
    const unknownKey = Object.keys(params).find((key) => !DRAW_TEXT_KEYS.has(key));
    if (unknownKey) return rejected(action, `wb_draw_text 包含未知参数 ${unknownKey}`);
    if (typeof params.content !== "string" || !params.content.trim() || params.content.length > 2_000) {
      return rejected(action, "content 必须是 1–2000 字符的文本");
    }
    if (!finiteInRange(params.x, 0, 1_000) || !finiteInRange(params.y, 0, 562)) {
      return rejected(action, "x/y 超出白板 1000×562 坐标范围");
    }
    if (params.width !== undefined && !finiteInRange(params.width, 1, 1_000)) {
      return rejected(action, "width 必须在 1–1000 之间");
    }
    if (params.height !== undefined && !finiteInRange(params.height, 1, 562)) {
      return rejected(action, "height 必须在 1–562 之间");
    }
    if (params.fontSize !== undefined && !finiteInRange(params.fontSize, 8, 96)) {
      return rejected(action, "fontSize 必须在 8–96 之间");
    }
    if (!optionalString(params.elementId, 120)) {
      return rejected(action, "elementId 必须是不超过 120 字符的文本");
    }
    if (
      params.color !== undefined &&
      (typeof params.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(params.color))
    ) {
      return rejected(action, "color 当前只接受六位十六进制颜色");
    }

    const element: WhiteboardTextElement = {
      id: params.elementId || action.actionId,
      content: params.content,
      x: params.x,
      y: params.y,
      width: typeof params.width === "number" ? params.width : 400,
      height: typeof params.height === "number" ? params.height : 100,
      fontSize: typeof params.fontSize === "number" ? params.fontSize : 18,
      color: typeof params.color === "string" ? params.color : "#333333",
    };
    this.snapshot = {
      open: true,
      elements: [...this.snapshot.elements, element],
    };
    return { actionId: action.actionId, actionName: action.actionName, status: "executed" };
  }
}
