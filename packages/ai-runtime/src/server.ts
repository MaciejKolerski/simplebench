import {
  frame,
  generation,
  VERSION,
  MAX_FRAME,
  MAX_CONTEXT,
  type Emit,
  type Generation,
} from "./protocol.ts";
import { catalog } from "./catalog.ts";
import { generate } from "./generate.ts";
import type { LanguageModel } from "ai";
import type { Writable, Readable } from "node:stream";

export async function serve(
  input: Readable,
  output: Writable,
  modelFor: (input: Generation) => LanguageModel,
) {
  const transfers = new Map<string, { bytes: number; chunks: Buffer[] }>();
  const active = new Map<string, AbortController>();
  const retired = new Set<string>();
  let writes = Promise.resolve();
  let stopping = false;
  const emit: Emit = (event) => {
    const line = JSON.stringify(event) + "\n";
    // At most one awaiting write per active request plus bounded control replies.
    const next = writes.then(
      () =>
        new Promise<void>((resolve, reject) =>
          output.write(line, (error) => (error ? reject(error) : resolve())),
        ),
    );
    writes = next.catch(() => {});
    return next;
  };
  const retire = (id: string) => {
    retired.add(id);
    if (retired.size > 256) retired.delete(retired.values().next().value!);
  };
  let pending = Buffer.alloc(0);
  try {
    for await (const data of input) {
      const buffer = Buffer.concat([pending, data]);
      let start = 0;
      for (;;) {
        const end = buffer.indexOf(10, start);
        if (end < 0) break;
        if (end - start > MAX_FRAME) throw new Error("protocol");
        // Decode only complete frames, preserving UTF-8 across pipe reads.
        const parsed = frame.safeParse(
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              buffer.subarray(start, end),
            ),
          ),
        );
        if (!parsed.success) throw new Error("protocol");
        const { type, requestId, payload } = parsed.data;
        start = end + 1;
        if (type === "shutdown") {
          stopping = true;
          break;
        }
        if (type === "cancel") {
          if (retired.has(requestId)) continue;
          const controller = active.get(requestId);
          if (controller) controller.abort();
          else {
            transfers.delete(requestId);
            retire(requestId);
            await emit({
              protocolVersion: VERSION,
              requestId,
              sequence: 1,
              type: "cancelled",
              payload: {},
            });
          }
          continue;
        }
        if (type === "hello") {
          await emit({
            protocolVersion: VERSION,
            requestId,
            sequence: 0,
            type: "ready",
            payload: { node: process.versions.node },
          });
          continue;
        }
        if (retired.has(requestId)) continue;
        if (type === "begin") {
          if (
            transfers.has(requestId) ||
            active.has(requestId) ||
            transfers.size + active.size >= 4
          )
            throw new Error("protocol");
          transfers.set(requestId, { bytes: 0, chunks: [] });
        } else if (type === "append") {
          const transfer = transfers.get(requestId);
          if (!transfer || !payload?.data) throw new Error("protocol");
          const chunk = Buffer.from(payload.data, "base64");
          if ((transfer.bytes += chunk.length) > MAX_CONTEXT)
            throw new Error("protocol");
          if (transfer.chunks.length >= 2048) throw new Error("protocol");
          transfer.chunks.push(chunk);
        } else if (type === "generate") {
          const transfer = transfers.get(requestId);
          if (!transfer) throw new Error("protocol");
          transfers.delete(requestId);
          const parsed = generation.safeParse(
            JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(
                Buffer.concat(transfer.chunks),
              ),
            ),
          );
          if (!parsed.success) throw new Error("protocol");
          const controller = new AbortController();
          active.set(requestId, controller);
          void (
            parsed.data.operation === "list-models"
              ? catalog(parsed.data, requestId, controller, emit)
              : generate(
                  parsed.data,
                  requestId,
                  controller,
                  emit,
                  modelFor(parsed.data),
                )
          )
            .catch(() => {
              stopping = true;
              input.destroy();
            })
            .finally(() => {
              active.delete(requestId);
              retire(requestId);
            });
        }
      }
      if (stopping) break;
      pending = Buffer.from(buffer.subarray(start));
      if (pending.length > MAX_FRAME) throw new Error("protocol");
    }
  } finally {
    for (const controller of active.values()) controller.abort();
    transfers.clear();
  }
}
