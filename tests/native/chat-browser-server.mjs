import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function browserProbe(directory) {
  const server = createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/result") {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 1024) {
          response.writeHead(413).end();
          return;
        }
      }
      try {
        const value = JSON.parse(body);
        await writeFile(
          join(directory, "browser-result.json"),
          JSON.stringify({
            available: value.available === true,
            denied: Number(value.denied) || 0,
            outcomes: Array.isArray(value.outcomes)
              ? value.outcomes.slice(0, 2)
              : [],
          }),
        );
        response.writeHead(204).end();
      } catch {
        response.writeHead(400).end();
      }
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><title>Chat permission probe</title>
<p>Native browser permission probe</p><script>
(async () => {
  for (let i = 0; i < 100 && !window.__TAURI_INTERNALS__; i++)
    await new Promise(resolve => setTimeout(resolve, 50));
  const available = !!window.__TAURI_INTERNALS__;
  let denied = 0;
  const outcomes = [];
  if (available) for (const [command, args] of [
    ['chat_preferences', {}],
    ['chat_main', { input: { action: 'list', query: '', offset: 0 } }]
  ]) {
    try {
      await window.__TAURI_INTERNALS__.invoke(command, args);
      outcomes.push({ command, status: 'resolved' });
    }
    catch (error) {
      const reason = String(error).slice(0, 400);
      if (/cannot call application commands|not allowed|ACL/i.test(reason)) denied++;
      outcomes.push({ command, status: 'rejected', reason });
    }
  }
  await fetch('/result', { method: 'POST', body: JSON.stringify({ available, denied, outcomes }) });
})();
</script>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => server.close(),
  };
}
