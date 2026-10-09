import { types } from "cassandra-driver";
import { PostMessageRequest } from "./types";
const levels: Record<string, number> = {
  ANY: types.consistencies.any,
  ONE: types.consistencies.one,
  TWO: types.consistencies.two,
  THREE: types.consistencies.three,
  QUORUM: types.consistencies.quorum,
  ALL: types.consistencies.all,
  LOCAL_ONE: types.consistencies.localOne,
  LOCAL_QUORUM: types.consistencies.localQuorum,
};
export function validateConsistency(consistency?: string): {
  value: number;
  warning?: string;
} {
  const fallback =
    levels[(process.env.DEFAULT_WRITE_CONSISTENCY || "ONE").toUpperCase()] ??
    levels.ONE;
  if (consistency === undefined) return { value: fallback };
  const value =
    typeof consistency === "string"
      ? levels[consistency.trim().toUpperCase()]
      : undefined;
  return value === undefined
    ? { value: fallback, warning: `Invalid consistency level '${consistency}'` }
    : { value };
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(
  body: Record<string, unknown>,
  key: string,
  max: number,
  errors: string[],
  optional = false,
) {
  const v = body[key];
  if (optional && v === undefined) return undefined;
  if (typeof v !== "string") {
    errors.push(`${key} is required and must be a string`);
    return undefined;
  }
  if (v.length > max || !v.trim())
    errors.push(`${key} must be between 1 and ${max} characters`);
  return v.trim();
}
function consistencyField(body: Record<string, unknown>, errors: string[]) {
  if (body.consistency === undefined) return undefined;
  if (
    typeof body.consistency !== "string" ||
    validateConsistency(body.consistency).warning
  )
    errors.push("Invalid consistency");
  return typeof body.consistency === "string"
    ? body.consistency.trim().toUpperCase()
    : undefined;
}
export function validatePostMessage(input: unknown): {
  valid: boolean;
  errors: string[];
  data?: PostMessageRequest;
} {
  if (!object(input))
    return { valid: false, errors: ["Body must be an object"] };
  const errors: string[] = [];
  const channel_id = text(input, "channel_id", 100, errors)!;
  const user_id = text(input, "user_id", 100, errors)!;
  const content = text(input, "content", 2000, errors)!;
  let client_msg_id = text(input, "client_msg_id", 100, errors, true);
  if (errors.some((e) => e.startsWith("client_msg_id"))) {
    errors.push("client_msg_id must be a string between 1 and 100 characters");
  }
  const consistency = consistencyField(input, errors);
  return {
    valid: !errors.length,
    errors,
    data: errors.length
      ? undefined
      : { channel_id, user_id, content, client_msg_id, consistency },
  };
}
export function validateChannel(input: unknown) {
  if (!object(input))
    return { valid: false, errors: ["Body must be an object"] };
  const errors: string[] = [];
  const name = text(input, "name", 60, errors)!;
  let description = "";
  if (input.description !== undefined) {
    if (typeof input.description !== "string" || input.description.length > 240)
      errors.push("description must be a string up to 240 characters");
    else description = input.description.trim();
  }
  if (
    name &&
    !name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]/g, "")
  )
    errors.push("name must contain letters or numbers");
  return { valid: !errors.length, errors, data: { name, description } };
}
export function validateGetMessages(input: unknown): {
  valid: boolean;
  errors: string[];
  data?: {
    limit: number;
    before?: string;
    after?: string;
    consistency?: string;
  };
} {
  const query = object(input) ? input : {};
  const errors: string[] = [];
  const limit =
    query.limit === undefined
      ? 50
      : typeof query.limit === "string" && /^[0-9]+$/.test(query.limit)
        ? Number(query.limit)
        : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    errors.push("limit must be a number between 1 and 100");
  if (query.before !== undefined && query.after !== undefined)
    errors.push("Cannot use both before and after parameters simultaneously");
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const key of ["before", "after"])
    if (
      query[key] !== undefined &&
      (typeof query[key] !== "string" || !uuid.test(query[key] as string))
    )
      errors.push(`${key} parameter must be a valid UUID`);
  const consistency = consistencyField(query, errors);
  return {
    valid: !errors.length,
    errors,
    data: errors.length
      ? undefined
      : {
          limit,
          before: query.before as string | undefined,
          after: query.after as string | undefined,
          consistency,
        },
  };
}
