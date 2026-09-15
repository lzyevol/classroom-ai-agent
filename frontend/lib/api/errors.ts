export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function detailToMessage(detail: unknown): string | null {
  if (typeof detail === "string") return detail;

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: unknown }).msg);
        }
        return null;
      })
      .filter((item): item is string => Boolean(item));

    return messages.length > 0 ? messages.join("；") : null;
  }

  if (detail && typeof detail === "object" && "message" in detail) {
    return String((detail as { message: unknown }).message);
  }

  return null;
}

export async function responseToApiError(
  response: Response,
  fallback: string,
): Promise<ApiError> {
  try {
    const body = (await response.json()) as {
      detail?: unknown;
      message?: unknown;
    };
    const message = detailToMessage(body.detail) ?? detailToMessage(body.message);
    return new ApiError(message ?? fallback, response.status);
  } catch {
    return new ApiError(fallback, response.status);
  }
}
