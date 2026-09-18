import type { UIMessage, UIMessageChunk } from "ai";
import { MAX_RESPONSE } from "./protocol.ts";

// Retain one bounded snapshot. SDK's eager readUIMessageStream would queue a
// growing full message for every token when a downstream pipe stops reading.
export class Snapshot {
  readonly message: UIMessage;
  readonly blocks = new Map<
    string,
    { index: number; type: "text" | "reasoning"; open: boolean }
  >();
  private bytes = 0;
  constructor(id: string) {
    this.message = { id, role: "assistant", parts: [] };
  }
  accept(chunk: UIMessageChunk) {
    this.bytes += Buffer.byteLength(JSON.stringify(chunk));
    if (this.bytes > MAX_RESPONSE || this.blocks.size > 1024)
      throw new Error("response-limit");
    if (chunk.type === "text-start" || chunk.type === "reasoning-start") {
      if (this.blocks.has(chunk.id)) throw new Error("protocol");
      const type = chunk.type === "text-start" ? "text" : "reasoning";
      this.blocks.set(chunk.id, {
        index: this.message.parts.length,
        type,
        open: true,
      });
      this.message.parts.push({ type, text: "", state: "streaming" });
    } else if (
      chunk.type === "text-delta" ||
      chunk.type === "reasoning-delta" ||
      chunk.type === "text-end" ||
      chunk.type === "reasoning-end"
    ) {
      const block = this.blocks.get(chunk.id);
      if (!block?.open) throw new Error("protocol");
      const part = this.message.parts[block.index];
      if (part.type !== "text" && part.type !== "reasoning")
        throw new Error("protocol");
      if ("delta" in chunk) part.text += chunk.delta;
      else {
        part.state = "done";
        block.open = false;
      }
    }
  }
  value() {
    return { message: this.message, blocks: Object.fromEntries(this.blocks) };
  }
}
