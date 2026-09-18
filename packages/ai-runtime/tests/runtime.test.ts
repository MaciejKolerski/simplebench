import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { VERSION, type Event } from "../src/protocol.ts";

function runtime() {
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      fileURLToPath(new URL("../src/fixture.ts", import.meta.url)),
    ],
    { stdio: "pipe" },
  );
  let stderr = "";
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  let pending = "";
  const events: Event[] = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (data) => {
    pending += data;
    for (;;) {
      const end = pending.indexOf("\n");
      if (end < 0) break;
      events.push(JSON.parse(pending.slice(0, end)));
      pending = pending.slice(end + 1);
    }
  });
  const send = (type: string, requestId = "request-1", payload?: unknown) =>
    child.stdin.write(
      JSON.stringify({ protocolVersion: VERSION, requestId, type, payload }) +
        "\n",
    );
  const waitFor = async (predicate: () => boolean) => {
    const end = Date.now() + 10000;
    while (!predicate()) {
      assert.ok(Date.now() < end, "Fixture deadline exceeded");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const start = (model = "fixture", requestId = "request-1") => {
    const data = Buffer.from(
      JSON.stringify({
        provider: "openai",
        apiKey: "FIXTURE_PRIVATE_KEY",
        model,
        assistantId: "assistant-1",
        messages: [
          {
            id: "user-1",
            role: "user",
            parts: [{ type: "text", text: "PRIVATE_QUESTION 日本語" }],
          },
        ],
      }),
    );
    send("begin", requestId);
    // Deliberately split the JSON's UTF-8 code points between transfer frames.
    for (let i = 0; i < data.length; i += 7)
      send("append", requestId, {
        data: data.subarray(i, i + 7).toString("base64"),
      });
    send("generate", requestId);
  };
  return { child, events, send, start, waitFor, stderr: () => stderr };
}

test("SDK stream preserves reserved IDs and UTF-8; stdout/stderr omit input and errors", async () => {
  const r = runtime();
  try {
    r.start("fixture-error");
    await r.waitFor(() => r.events.some((event) => event.type === "failed"));
    assert.equal(
      r.events.filter((event) =>
        ["completed", "failed", "cancelled"].includes(event.type),
      ).length,
      1,
    );
    assert.deepEqual(
      r.events.map((e) => e.sequence),
      r.events.map((_, i) => i + 1),
    );
    const snapshot = r.events.at(-2)?.payload as {
      message: { id: string; parts: { text: string }[] };
    };
    assert.equal(snapshot.message.id, "assistant-1");
    assert.equal(
      snapshot.message.parts[0].text,
      "Zażółć 日本語 👩🏽‍💻\n".repeat(40),
    );
    assert.ok(!JSON.stringify(r.events).includes("PRIVATE"));
    assert.ok(!r.stderr().includes("PRIVATE"));
    assert.equal(r.stderr(), "");
  } finally {
    r.child.kill();
  }
});

test("Stop aborts a started request with one terminal event and a final snapshot", async () => {
  const r = runtime();
  try {
    r.start();
    await r.waitFor(() =>
      r.events.some(
        (e) =>
          e.type === "chunk" &&
          (e.payload as { type: string }).type === "text-delta",
      ),
    );
    r.send("cancel");
    await r.waitFor(() => r.events.some((e) => e.type === "cancelled"));
    assert.equal(r.events.at(-2)?.type, "message-snapshot");
    const length = r.events.length;
    r.send("cancel");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(r.events.length, length);
  } finally {
    r.child.kill();
  }
});

test("cancel before generate prevents model dispatch; malformed input fails closed", async () => {
  const r = runtime();
  try {
    r.send("cancel");
    r.start();
    r.send("hello", "handshake");
    await r.waitFor(() => r.events.some((e) => e.type === "ready"));
    assert.deepEqual(
      r.events.filter((e) => e.requestId === "request-1").map((e) => e.type),
      ["cancelled"],
    );
    r.child.stdin.write("x".repeat(100000));
    const [code] = await once(r.child, "exit");
    assert.equal(code, 1);
    assert.equal(r.stderr(), "");
  } finally {
    r.child.kill();
  }
});

test("cancelling a context transfer leaves another generation running", async () => {
  const r = runtime();
  try {
    r.start("fixture-fast", "other");
    r.send("begin", "upload");
    r.send("append", "upload", {
      data: Buffer.from("partial").toString("base64"),
    });
    r.send("cancel", "upload");
    await r.waitFor(() =>
      r.events.some((e) => e.requestId === "upload" && e.type === "cancelled"),
    );
    await r.waitFor(
      () =>
        r.events.filter((e) => e.requestId === "other" && e.type === "chunk")
          .length > 10,
    );
    assert.equal(r.events.filter((e) => e.requestId === "upload").length, 1);
    r.send("cancel", "other");
    await r.waitFor(() =>
      r.events.some((e) => e.requestId === "other" && e.type === "cancelled"),
    );
  } finally {
    r.child.kill();
  }
});

test("a local response limit aborts generation and reports the limit once", async () => {
  const r = runtime();
  try {
    r.start("fixture-large");
    await r.waitFor(() => r.events.some((e) => e.type === "failed"));
    const terminal = r.events.filter((e) =>
      ["completed", "failed", "cancelled"].includes(e.type),
    );
    assert.equal(terminal.length, 1);
    assert.equal(
      (terminal[0].payload as { code: string }).code,
      "response-limit",
    );
    assert.ok(
      Buffer.byteLength(JSON.stringify(r.events.at(-2)?.payload)) <=
        2 * 1024 * 1024,
    );
    const count = r.events.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(r.events.length, count);
    assert.equal(r.stderr(), "");
  } finally {
    r.child.kill();
  }
});
