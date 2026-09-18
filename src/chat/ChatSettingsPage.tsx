import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, errorMessage, native } from "../api";
import { newId } from "../model";
import { Modal } from "../ui";
import { defaultConfig } from "./types";
import type { Connection, Preferences } from "./types";
import "./chat.css";
const providers = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
};
export default function ChatSettingsPage() {
  const [data, setData] = useState<Preferences>();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [key, setKey] = useState("");
  const [removingKey, setRemovingKey] = useState<Connection | null>(null);
  const [deleting, setDeleting] = useState<Connection | null>(null);
  const [testModel, setTestModel] = useState<Record<string, string>>({});
  const reload = async () =>
    setData(await api<Preferences>("chat_preferences"));
  useEffect(() => {
    void reload().catch((e) => setError(errorMessage(e)));
    const stop = native
      ? listen("chat-preferences-changed", () => {
          void reload().catch((e) => setError(errorMessage(e)));
        })
      : undefined;
    return () => {
      void stop?.then((fn) => fn());
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await action();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const save = async (
    next: Preferences,
    connection?: string,
    newKey?: string,
  ) => {
    const saved = await api<Preferences>("chat_preferences_save", {
      data: next,
      expected: next.revision,
      keyConnection: connection ?? null,
      newKey: newKey || null,
    });
    setData(saved);
    setStatus("Saved");
  };
  const add = () => {
    setKey("");
    setEditing({
      id: newId(),
      name: "",
      provider: "openai",
      enabled: true,
      credentialRevision: 0,
      secretMode: "system",
      secretId: null,
      models: [],
      testedModel: null,
      testStatus: null,
    });
  };
  return (
    <main className="keybindings-page chat-settings">
      <header className="settings-page-heading">
        <div>
          <h1>Chat AI</h1>
          <p>
            Use your own provider connections. Keys stay in the native system
            credential store or, when selected, in memory until SimpleBench
            closes.
          </p>
        </div>
        <button className="button" disabled={!data || busy} onClick={add}>
          Add connection
        </button>
      </header>
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      <p role="status">{busy ? "Working…" : status}</p>
      {!data ? (
        <section>
          <p>
            Chat AI settings are unavailable. Existing preferences have been
            preserved.
          </p>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api("chat_recover", { target: "settings", reset: false });
                await reload();
              })
            }
          >
            Retry opening settings
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={() => setRecovering(true)}
          >
            Recover settings…
          </button>
        </section>
      ) : (
        <>
          {!data.connections.length && (
            <section className="chat-empty">
              <h2>Add your first connection</h2>
              <p>
                No SimpleBench or Vercel account is needed. Provider usage is
                billed to your own account.
              </p>
              <button className="button" onClick={add}>
                Add connection
              </button>
            </section>
          )}
          {data.connections.map((connection) => (
            <section key={connection.id} className="chat-connection">
              <header>
                <div>
                  <h2>{connection.name}</h2>
                  <p>
                    {providers[connection.provider]} ·{" "}
                    {connection.secretMode === "session"
                      ? "Session only"
                      : "System credential store"}{" "}
                    · {connection.enabled ? "Enabled" : "Disabled"} ·{" "}
                    {connection.secretId ? "Key configured" : "No API key"}
                  </p>
                </div>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    setEditing(connection);
                    setKey("");
                  }}
                >
                  Edit
                </button>
                {connection.secretId && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => setRemovingKey(connection)}
                  >
                    Remove key
                  </button>
                )}
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => setDeleting(connection)}
                >
                  Remove
                </button>
              </header>
              <label>
                Test model ID
                <input
                  list={`models-${connection.id}`}
                  value={
                    testModel[connection.id] ??
                    connection.testedModel ??
                    data.defaults.model
                  }
                  onChange={(e) =>
                    setTestModel({
                      ...testModel,
                      [connection.id]: e.target.value,
                    })
                  }
                />
                <datalist id={`models-${connection.id}`}>
                  {connection.models.map((id) => (
                    <option key={id} value={id} />
                  ))}
                </datalist>
              </label>
              <div className="dialog-actions">
                <button
                  className="button"
                  disabled={busy || !connection.enabled}
                  onClick={() =>
                    void run(async () => {
                      await api("chat_connection_action", {
                        connectionId: connection.id,
                        model: "",
                        operation: "list-models",
                      });
                      await reload();
                      setStatus("Model catalog updated");
                    })
                  }
                >
                  Refresh models
                </button>
                <button
                  className="button"
                  disabled={
                    busy ||
                    !connection.enabled ||
                    !(
                      testModel[connection.id] ??
                      connection.testedModel ??
                      data.defaults.model
                    )
                  }
                  onClick={() =>
                    void run(async () => {
                      const result = await api<{
                        status: string;
                        result?: { code?: string };
                      }>("chat_connection_action", {
                        connectionId: connection.id,
                        model:
                          testModel[connection.id] ??
                          connection.testedModel ??
                          data.defaults.model,
                        operation: "test-connection",
                      });
                      await reload();
                      setStatus(
                        result.status === "completed"
                          ? "Connection test succeeded"
                          : `Connection test failed: ${result.result?.code ?? result.status}`,
                      );
                    })
                  }
                >
                  Test connection
                </button>
              </div>
              <small>
                Test sends a fixed short prompt with a 32-token output limit. It
                may incur provider charges. No project content is sent.
              </small>
              {connection.testStatus && (
                <p>
                  Last test: {connection.testStatus} · {connection.testedModel}
                </p>
              )}
            </section>
          ))}
          <form
            className="chat-defaults"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() =>
                save({
                  ...data,
                  defaults: {
                    ...data.defaults,
                    configured:
                      !!data.defaults.connectionId && !!data.defaults.model,
                  },
                }),
              );
            }}
          >
            <h2>New conversation defaults</h2>
            <label>
              Connection
              <select
                value={data.defaults.connectionId ?? ""}
                onChange={(e) =>
                  setData({
                    ...data,
                    defaults: {
                      ...data.defaults,
                      connectionId: e.target.value || null,
                      model: "",
                    },
                  })
                }
              >
                <option value="">Choose connection</option>
                {data.connections
                  .filter((c) => c.enabled)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Model ID
              <input
                value={data.defaults.model}
                list="default-models"
                onChange={(e) =>
                  setData({
                    ...data,
                    defaults: { ...data.defaults, model: e.target.value },
                  })
                }
              />
              <datalist id="default-models">
                {data.connections
                  .find((c) => c.id === data.defaults.connectionId)
                  ?.models.map((id) => (
                    <option key={id} value={id} />
                  ))}
              </datalist>
            </label>
            <label>
              System instructions
              <textarea
                rows={4}
                value={data.defaults.system}
                onChange={(e) =>
                  setData({
                    ...data,
                    defaults: { ...data.defaults, system: e.target.value },
                  })
                }
              />
            </label>
            <label>
              Maximum output tokens
              <input
                type="number"
                min={1}
                max={32768}
                value={data.defaults.maxOutputTokens}
                onChange={(e) =>
                  setData({
                    ...data,
                    defaults: {
                      ...data.defaults,
                      maxOutputTokens: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
            <label>
              Send message with
              <select
                value={data.sendMode}
                onChange={(e) =>
                  setData({
                    ...data,
                    sendMode: e.target.value as Preferences["sendMode"],
                  })
                }
              >
                <option value="enter">
                  Enter · Shift+Enter for a new line
                </option>
                <option value="modifier-enter">
                  Ctrl/Cmd+Enter · Enter for a new line
                </option>
              </select>
            </label>
            <button className="button" disabled={busy}>
              Save defaults
            </button>
          </form>
        </>
      )}
      {editing && data && (
        <Modal
          title={
            editing.credentialRevision
              ? "Edit AI connection"
              : "Add AI connection"
          }
          onClose={() => {
            if (!busy) {
              setEditing(null);
              setKey("");
            }
          }}
        >
          <form
            className="dialog-form chat-config"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const connections = data.connections.some(
                  (c) => c.id === editing.id,
                )
                  ? data.connections.map((c) =>
                      c.id === editing.id ? editing : c,
                    )
                  : [...data.connections, editing];
                await save(
                  { ...data, connections },
                  key ? editing.id : undefined,
                  key,
                );
                setEditing(null);
                setKey("");
              });
            }}
          >
            <label>
              Connection name
              <input
                autoFocus
                required
                maxLength={200}
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </label>
            <label>
              Provider
              <select
                value={editing.provider}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    provider: e.target.value as Connection["provider"],
                  })
                }
              >
                {Object.entries(providers).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Key storage
              <select
                value={editing.secretMode}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    secretMode: e.target.value as Connection["secretMode"],
                  })
                }
              >
                <option value="system">System credential store</option>
                <option value="session">
                  Session only · expires when the app closes
                </option>
              </select>
            </label>
            <label>
              {editing.secretId
                ? "Replacement API key (leave empty to keep current key)"
                : "API key"}
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                required={!editing.secretId}
              />
            </label>
            <label className="chat-checkbox">
              <input
                type="checkbox"
                checked={editing.enabled}
                onChange={(e) =>
                  setEditing({ ...editing, enabled: e.target.checked })
                }
              />{" "}
              Enabled
            </label>
            <p>
              Changing the provider, key or storage mode stops active requests
              using this connection and preserves their responses. A provider or
              storage change requires a new key.
            </p>
            {error && <p role="alert">{error}</p>}
            <button className="button" disabled={busy}>
              Save connection
            </button>
          </form>
        </Modal>
      )}
      {recovering && (
        <Modal
          title="Recover Chat AI settings?"
          onClose={() => setRecovering(false)}
        >
          <div className="dialog-form">
            <p>
              The original preferences will be moved to a private recovery
              folder beside the preferences file. Start with empty connection
              settings; conversation history remains. Keys whose identities
              cannot be read may remain in the system credential store.
            </p>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api("chat_recover", {
                    target: "settings",
                    reset: true,
                  });
                  await reload();
                  setRecovering(false);
                })
              }
            >
              Back up and reset settings
            </button>
            {error && <p role="alert">{error}</p>}
          </div>
        </Modal>
      )}
      {removingKey && data && (
        <Modal title="Remove API key?" onClose={() => setRemovingKey(null)}>
          <div className="dialog-form">
            <p>
              Remove the key for “{removingKey.name}”? Its active responses will
              stop. The connection and history remain.
            </p>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setData(
                    await api<Preferences>("chat_preferences_save", {
                      data,
                      expected: data.revision,
                      clearKey: removingKey.id,
                    }),
                  );
                  setRemovingKey(null);
                })
              }
            >
              Remove key
            </button>
            {error && <p role="alert">{error}</p>}
          </div>
        </Modal>
      )}
      {deleting && data && (
        <Modal title="Remove AI connection?" onClose={() => setDeleting(null)}>
          <div className="dialog-form">
            <p>
              Remove “{deleting.name}” and its stored key? Active responses will
              stop. Conversation history stays on this device.
            </p>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await save({
                    ...data,
                    connections: data.connections.filter(
                      (c) => c.id !== deleting.id,
                    ),
                    defaults:
                      data.defaults.connectionId === deleting.id
                        ? defaultConfig
                        : data.defaults,
                  });
                  setDeleting(null);
                })
              }
            >
              Remove connection
            </button>
            {error && <p role="alert">{error}</p>}
          </div>
        </Modal>
      )}
    </main>
  );
}
