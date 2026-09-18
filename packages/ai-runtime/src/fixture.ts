import { MockLanguageModelV4 } from "ai/test";
import { Writable } from "node:stream";
import { serve } from "./server.ts";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const measuredOutput = new Writable({
  write(bytes, _encoding, complete) {
    const event = JSON.parse(bytes.toString());
    if (event.type === "chunk") event.payload.probeSentAt = Date.now();
    process.stdout.write(JSON.stringify(event) + "\n", complete);
  },
});
void serve(
  process.stdin,
  measuredOutput,
  (input) =>
    new MockLanguageModelV4({
      doStream: async ({ abortSignal }) => ({
        stream: new ReadableStream({
          async start(controller) {
            controller.enqueue({
              type: "stream-start",
              warnings: [{ type: "other", message: "FIXTURE_PRIVATE_WARNING" }],
            });
            controller.enqueue({ type: "text-start", id: "block-1" });
            const count =
              input.model === "fixture-fast"
                ? 10000
                : input.model === "fixture-large"
                  ? 100
                  : 40;
            for (let i = 0; i < count && !abortSignal?.aborted; i++) {
              controller.enqueue({
                type: "text-delta",
                id: "block-1",
                delta:
                  input.model === "fixture-large"
                    ? "x".repeat(32768)
                    : "Zażółć 日本語 👩🏽‍💻\n",
              });
              await new Promise((resolve) =>
                setTimeout(resolve, input.model === "fixture-fast" ? 0 : 10),
              );
            }
            controller.enqueue({ type: "text-end", id: "block-1" });
            if (input.model === "fixture-error")
              controller.enqueue({
                type: "error",
                error: new Error("FIXTURE_PRIVATE_ERROR"),
              });
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage,
            });
            controller.close();
          },
        }),
      }),
    }),
).then(
  () => process.exit(0),
  () => process.exit(1),
);
