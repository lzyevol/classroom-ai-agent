export type JsonRecord = Record<string, unknown>;

export class ContractValidationError extends Error {
  constructor(
    public readonly path: string,
    message: string,
  ) {
    super(`${path} ${message}`);
    this.name = "ContractValidationError";
  }
}

export function objectAt(value: unknown, path: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ContractValidationError(path, "必须是对象");
  }
  return value as JsonRecord;
}

export function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new ContractValidationError(path, "必须是字符串");
  }
  return value;
}

export function nonEmptyStringAt(value: unknown, path: string): string {
  const parsed = stringAt(value, path);
  if (!parsed.trim()) throw new ContractValidationError(path, "不能为空");
  return parsed;
}

export function numberAt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ContractValidationError(path, "必须是有限数字");
  }
  return value;
}

export function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new ContractValidationError(path, "必须是布尔值");
  }
  return value;
}

export function arrayAt(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ContractValidationError(path, "必须是数组");
  }
  return value;
}

export function optionalStringAt(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : stringAt(value, path);
}

export function nullableStringAt(value: unknown, path: string): string | null {
  return value === null ? null : stringAt(value, path);
}

export function stringArrayAt(value: unknown, path: string): string[] {
  return arrayAt(value, path).map((item, index) => stringAt(item, `${path}[${index}]`));
}
