import { invoke } from "@tauri-apps/api/core";
import { ChatRuntime, main } from "../../src/chat/chat-runtime";
import { textOf, type Conversation, type Loaded } from "../../src/chat/types";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function checkBrowserIsolation() {
  const config = await invoke<{ url: string | null; offline: boolean }>(
    "chat_probe_backend",
    { action: "browser-url" },
  );
  if (config.offline) return null;
  if (!config.url) throw Error("Native browser probe server is unavailable.");
  const id = "chat-acl-probe";
  const slots = [
    { id, url: config.url, bounds: { x: 0, y: 0, width: 1, height: 1 } },
  ];
  try {
    await invoke("sync_browsers", { retained: [id], slots });
    for (let i = 0; i < 200; i++) {
      const result = await invoke<{
        available: boolean;
        denied: number;
      } | null>("chat_probe_backend", { action: "browser-result" });
      if (result?.available && result.denied === 2) return true;
      if (result)
        throw Error("Native browser child did not reject Chat AI commands.");
      await pause(50);
    }
    throw Error("Native browser permission probe timed out.");
  } finally {
    await invoke("sync_browsers", { retained: [], slots: [] });
  }
}

async function idle(runtime: ChatRuntime) {
  for (let i = 0; i < 900; i++) {
    if (!runtime.snapshot.busy) {
      if (runtime.snapshot.error) throw Error(runtime.snapshot.error);
      return;
    }
    await pause(50);
  }
  await runtime.stop();
  throw Error("Live provider exceeded the 45-second test deadline.");
}

export async function runLive() {
  const setup = await invoke<{
    providers: {
      id: string;
      provider: string;
      model: string;
      catalog: { status: string };
      connectionTest: { status: string };
    }[];
  }>("chat_probe_backend", { action: "live-setup" });
  const results: Record<string, unknown>[] = [];
  const preview = document.createElement("pre");
  preview.style.cssText =
    "position:fixed;inset:20px;z-index:999999;background:var(--color-background);color:var(--color-surface-text);padding:16px;white-space:pre-wrap";
  document.body.append(preview);
  for (const provider of setup.providers) {
    let runtime: ChatRuntime | undefined;
    const result: Record<string, unknown> = {
      provider: provider.provider,
      model: provider.model,
      catalog: provider.catalog,
      connectionTest: provider.connectionTest,
      passed: false,
    };
    try {
      if (
        provider.catalog.status !== "completed" ||
        provider.connectionTest.status !== "completed"
      )
        throw Error(
          "The provider catalog or connection test did not complete.",
        );
      preview.textContent = `Native live test: ${provider.provider} / ${provider.model}`;
      const conversation = await main<Conversation>({
        action: "create",
        id: crypto.randomUUID(),
        origin: {
          projectId: "live-test",
          projectName: "Live test",
          workspaceId: "live-test",
          workspaceName: "Live test",
        },
      });
      runtime = new ChatRuntime(conversation.id);
      await runtime.ready;
      await runtime.configure({
        connectionId: provider.id,
        model: provider.model,
        system: "Follow the requested output format concisely.",
        maxOutputTokens: 1024,
        temperature: null,
        configured: true,
      });
      const marker = `SB-${crypto.randomUUID().slice(0, 8)}`;
      await runtime.attach({
        name: "explicit-test.txt",
        bytes: [
          ...new TextEncoder().encode(
            `CODE: ${marker}\nUnicode: Zażółć 日本語\n`,
          ),
        ],
      });
      runtime.setText(
        "Read the attached file. Reply with its CODE value alone.",
      );
      const started = performance.now();
      await runtime.send();
      runtime.setText("Retained live draft Żółć");
      await runtime.flush();
      await idle(runtime);
      if (!textOf(runtime.chat.messages.at(-1)!).includes(marker))
        throw Error("The provider response did not contain the attached code.");
      result.firstResponseMs = Math.round(performance.now() - started);
      result.textAttachment = true;
      if (runtime.snapshot.text !== "Retained live draft Żółć")
        throw Error("The next draft was lost during the live response.");
      result.nextDraft = true;

      runtime.setText(
        "What was the CODE from the attached file? Reply with that value alone.",
      );
      await runtime.send();
      await idle(runtime);
      if (!textOf(runtime.chat.messages.at(-1)!).includes(marker))
        throw Error("The second turn lost its attachment/history context.");
      result.multiTurn = true;
      const previousAssistant = runtime.chat.messages.at(-1)!.id;
      const userCount = runtime.chat.messages.filter(
        (m) => m.role === "user",
      ).length;
      await runtime.send("retry", previousAssistant);
      await idle(runtime);
      if (
        runtime.chat.messages.at(-1)!.id === previousAssistant ||
        runtime.chat.messages.filter((m) => m.role === "user").length !==
          userCount ||
        !textOf(runtime.chat.messages.at(-1)!).includes(marker)
      )
        throw Error("Regenerate did not preserve the user turn and context.");
      result.regenerate = true;

      runtime.setText(
        "Write a long numbered list from 1 to 1000, one number per line, with no introduction.",
      );
      await runtime.send();
      const streamDeadline = performance.now() + 30000;
      while (runtime.snapshot.busy && performance.now() < streamDeadline) {
        const message = runtime.chat.messages.at(-1);
        if (message?.role === "assistant" && textOf(message).length > 0) break;
        await pause(10);
      }
      const partial = runtime.chat.messages.at(-1);
      result.partialBeforeStop =
        partial?.role === "assistant" && textOf(partial).length > 0;
      const wasBusy = runtime.snapshot.busy;
      const stopping = performance.now();
      await runtime.stop();
      await idle(runtime);
      result.stopMs = Math.round(performance.now() - stopping);
      if (!wasBusy || !result.partialBeforeStop)
        throw Error("The Stop test requires an active partial response.");
      const saved = await main<Loaded>({ action: "load", id: runtime.id });
      result.finalStatus = saved.messages.at(-1)?.status;
      if (wasBusy && result.finalStatus !== "cancelled")
        throw Error("Stop did not persist a cancelled native response.");
      result.stoppedActiveRequest = wasBusy;
      await invoke("chat_close", { conversations: [runtime.id], all: false });
      runtime.dispose();
      runtime = new ChatRuntime(conversation.id);
      await runtime.ready;
      if (
        runtime.snapshot.busy ||
        runtime.chat.messages.length !== saved.messages.length
      )
        throw Error("Reopening history resumed or lost a live request.");
      result.reopenedHistory = true;
      result.passed = true;
    } catch (error) {
      result.error = String(error);
    } finally {
      if (runtime) {
        await runtime.stop().catch(() => {});
        await invoke("chat_close", {
          conversations: [runtime.id],
          all: false,
        }).catch(() => {});
        runtime.dispose();
      }
      results.push(result);
    }
  }
  let deniedBrowser: boolean | null = null;
  let browserError: string | undefined;
  try {
    deniedBrowser = await checkBrowserIsolation();
  } catch (error) {
    browserError = String(error);
  }
  preview.remove();
  await invoke("chat_probe_result", {
    result: {
      passed: !browserError && results.every((result) => result.passed),
      live: true,
      deniedBrowser,
      browserError,
      providers: results,
      note: "Only synthetic prompts and an explicitly created text attachment were sent; keys stayed in native session memory.",
    },
  });
}
