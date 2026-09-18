import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import type { Generation } from "./protocol.ts";

export function modelFor(input: Generation) {
  switch (input.provider) {
    case "openai":
      return createOpenAI({ apiKey: input.apiKey }).responses(input.model);
    case "anthropic":
      return createAnthropic({ apiKey: input.apiKey })(input.model);
    case "google":
      return createGoogle({ apiKey: input.apiKey })(input.model);
  }
}
