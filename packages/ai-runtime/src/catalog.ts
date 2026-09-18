import type { Generation, Emit } from "./protocol.ts";
import { errorCode } from "./protocol.ts";

export async function catalog(
  input: Generation,
  requestId: string,
  controller: AbortController,
  emit: Emit,
) {
  let sequence = 0;
  const send = (type: Parameters<Emit>[0]["type"], payload: unknown) =>
    emit({
      protocolVersion: 1,
      requestId,
      sequence: ++sequence,
      type,
      payload,
    });
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const url = {
      openai: "https://api.openai.com/v1/models",
      anthropic: "https://api.anthropic.com/v1/models?limit=1000",
      google:
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
    }[input.provider];
    const headers: Record<string, string> =
      input.provider === "openai"
        ? { Authorization: `Bearer ${input.apiKey}` }
        : input.provider === "anthropic"
          ? { "x-api-key": input.apiKey, "anthropic-version": "2023-06-01" }
          : { "x-goog-api-key": input.apiKey };
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) throw { statusCode: response.status };
    if (!response.body) throw new Error("network");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      if ((bytes += chunk.length) > 2 * 1024 * 1024) {
        controller.abort();
        throw new Error("catalog-limit");
      }
      chunks.push(chunk);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const values: unknown[] = data.data ?? data.models;
    if (!Array.isArray(values)) throw new Error("protocol");
    const models = values
      .flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const item = value as {
          id?: string;
          name?: string;
          supportedGenerationMethods?: string[];
        };
        if (
          input.provider === "google" &&
          !item.supportedGenerationMethods?.includes("generateContent")
        )
          return [];
        const id = (item.id ?? item.name ?? "").replace(/^models\//, "");
        return /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(id) ? [id] : [];
      })
      .slice(0, 1000)
      .sort();
    await send("models", {
      models,
      fetchedAt: Date.now(),
      truncated: values.length >= 1000,
    });
    await send("completed", {});
  } catch (error) {
    await send(controller.signal.aborted ? "cancelled" : "failed", {
      code: controller.signal.aborted ? "timeout" : errorCode(error),
    });
  } finally {
    clearTimeout(timer);
  }
}
