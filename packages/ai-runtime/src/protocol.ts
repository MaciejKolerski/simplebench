import { z } from "zod";

export const VERSION = 1;
export const MAX_CONTEXT = 40 * 1024 * 1024;
export const MAX_FRAME = 96 * 1024;
export const MAX_RESPONSE = 2 * 1024 * 1024;
export const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const part = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("text"), text: z.string().max(MAX_CONTEXT) })
    .strict(),
  z
    .object({
      type: z.literal("file"),
      mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
      url: z
        .string()
        .max(14 * 1024 * 1024)
        .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/),
      filename: z.string().max(255).optional(),
    })
    .strict(),
]);
export const generation = z
  .object({
    operation: z
      .enum(["generate", "test-connection", "list-models"])
      .default("generate"),
    provider: z.enum([
      "openai",
      "anthropic",
      "google",
      "xai",
      "openrouter",
      "deepseek",
      "nvidia",
    ]),
    apiKey: z.string().min(1).max(8192),
    model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/),
    assistantId: id,
    messages: z
      .array(
        z
          .object({
            id,
            role: z.enum(["user", "assistant"]),
            parts: z.array(part).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
    system: z
      .string()
      .max(128 * 1024)
      .default(""),
    maxOutputTokens: z.number().int().min(1).max(32768).default(4096),
    temperature: z.number().min(0).max(2).optional(),
  })
  .strict();
export type Generation = z.infer<typeof generation>;
export const frame = z
  .object({
    protocolVersion: z.literal(VERSION),
    requestId: id,
    type: z.enum([
      "hello",
      "begin",
      "append",
      "generate",
      "cancel",
      "shutdown",
    ]),
    payload: z
      .object({
        data: z
          .string()
          .max(48 * 1024)
          .regex(/^[A-Za-z0-9+/]*={0,2}$/)
          .optional(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
export interface Event {
  protocolVersion: 1;
  requestId: string;
  sequence: number;
  type:
    | "models"
    | "ready"
    | "chunk"
    | "message-snapshot"
    | "completed"
    | "cancelled"
    | "failed";
  payload: unknown;
}
export type Emit = (event: Event) => Promise<void>;

export function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "process";
  const value = error as {
    statusCode?: number;
    name?: string;
    data?: { error?: { code?: string } };
  };
  if (value.name === "AbortError") return "cancelled";
  if (value.name === "TimeoutError") return "timeout";
  if (value.data?.error?.code === "insufficient_quota") return "quota";
  if (value.data?.error?.code === "context_length_exceeded")
    return "context-limit";
  switch (value.statusCode) {
    case 401:
      return "auth";
    case 403:
      return "permission";
    case 404:
      return "model";
    case 429:
      return "rate-limit";
    case 400:
      return "unsupported-input";
    default:
      return "network";
  }
}
