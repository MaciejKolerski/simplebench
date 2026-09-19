import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, errorMessage, native } from "../api";
import { newId } from "../model";
import { Modal } from "../ui";
import {
  Check,
  Plus,
  ShieldCheck,
  ExternalLink,
  RefreshCw,
  Search,
  Eye,
  EyeOff,
} from "../icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  providerIds,
  providerPresets,
  validModelId,
  type Provider,
} from "./provider-presets";
import capabilities from "./model-capabilities.json";
import { ChatDefaults } from "./ChatDefaults";
import { ModelSelect } from "./ModelSelect";
import { providers, suggestedModel, modelOptions } from "./models";
import { defaultConfig } from "./types";
import type { Connection, Preferences } from "./types";
import "./chat.css";
export default function ChatSettingsPage() {
  const [data, setData] = useState<Preferences>();
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [addingModel, setAddingModel] = useState(false);
  const [newModel, setNewModel] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingModel, setEditingModel] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editingRevision, setEditingRevision] = useState(0);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [key, setKey] = useState("");
  const [removingKey, setRemovingKey] = useState<Connection | null>(null);
  const [deleting, setDeleting] = useState<Connection | null>(null);
  const [testModel, setTestModel] = useState<Record<string, string>>({});
  const originalConnection = data?.connections.find(
    (c) => c.id === editing?.id,
  );
  const needsKey =
    !editing?.secretId ||
    originalConnection?.provider !== editing?.provider ||
    originalConnection?.secretMode !== editing?.secretMode;
  const reload = async () =>
    setData(await api<Preferences>("chat_preferences"));
  useEffect(() => {
    void reload()
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
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
    if (busy) return false;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await action();
      return true;
    } catch (error) {
      setError(errorMessage(error));
      return false;
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
  const add = (provider: Provider = "openai") => {
    setEditingRevision(data?.revision ?? 0);
    setShowKey(false);
    setKey("");
    setError("");
    setEditingModel(
      suggestedModel({ provider, models: [], testedModel: null }),
    );
    setMakeDefault(
      !data?.defaults.model ||
        !data.connections.some(
          (connection) =>
            connection.id === data.defaults.connectionId &&
            connection.enabled &&
            connection.secretId,
        ),
    );
    setEditing({
      id: newId(),
      name: "",
      provider,
      enabled: true,
      credentialRevision: 0,
      secretMode: "system",
      secretId: null,
      models: [],
      testedModel: null,
      testStatus: null,
    });
  };
  const connection =
    data?.connections.find((c) => c.id === selected) ??
    (!selected ? data?.connections[0] : undefined);
  const provider: Provider =
    connection?.provider ??
    (providerIds.includes(selected as Provider)
      ? (selected as Provider)
      : "openai");
  const preset = providerPresets[provider];
  const models = modelOptions(connection ?? { provider, models: [] });
  if (
    connection &&
    data?.defaults.connectionId === connection.id &&
    data.defaults.model &&
    !models.includes(data.defaults.model)
  )
    models.unshift(data.defaults.model);
  const openEdit = (value: Connection) => {
    setEditingRevision(data?.revision ?? 0);
    setEditing(value);
    setShowKey(false);
    setKey("");
    setError("");
    setMakeDefault(data?.defaults.connectionId === value.id);
    setEditingModel(
      data?.defaults.connectionId === value.id
        ? data.defaults.model
        : suggestedModel(value),
    );
  };
  const choose = (value: string) => {
    setSelected(value);
    setSearch("");
    setError("");
    setStatus("");
  };
  return (
    <main className="keybindings-page chat-settings">
      <header className="settings-page-heading">
        <div>
          <h1>Chat AI</h1>
          <p>
            Manage your providers and choose the models you want to chat with.
          </p>
        </div>
        {data && (
          <button className="button" disabled={busy} onClick={() => add()}>
            <Plus size={14} /> Add connection
          </button>
        )}
      </header>
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      {(busy || status) && (
        <p className="chat-settings-status" role="status">
          {busy ? "Working…" : status}
        </p>
      )}
      {loading ? (
        <p role="status">Loading connections…</p>
      ) : !data ? (
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
          <div className="chat-provider-layout">
            <nav className="chat-provider-nav" aria-label="AI providers">
              {!!data.connections.length && <h2>Your providers</h2>}
              {data.connections.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="chat-provider-item"
                  aria-current={connection?.id === item.id ? "true" : undefined}
                  onClick={() => choose(item.id)}
                  disabled={busy}
                >
                  <span className="chat-provider-mark" aria-hidden="true">
                    {providerPresets[item.provider].mark}
                  </span>
                  <span className="chat-provider-name">
                    {item.name}
                    <small>
                      {item.enabled
                        ? item.secretId
                          ? "Key saved"
                          : "Needs API key"
                        : "Disabled"}
                    </small>
                  </span>
                  {data.defaults.connectionId === item.id && (
                    <Check size={14} aria-label="Default provider" />
                  )}
                </button>
              ))}
              <h2>
                {data.connections.length ? "Available providers" : "Providers"}
              </h2>
              {providerIds
                .filter(
                  (id) => !data.connections.some((c) => c.provider === id),
                )
                .map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="chat-provider-item"
                    aria-current={
                      !connection && provider === id ? "true" : undefined
                    }
                    onClick={() => choose(id)}
                    disabled={busy}
                  >
                    <span className="chat-provider-mark" aria-hidden="true">
                      {providerPresets[id].mark}
                    </span>
                    <span className="chat-provider-name">{providers[id]}</span>
                  </button>
                ))}
            </nav>
            <section
              className="chat-provider-detail"
              aria-label={`${preset.name} configuration`}
            >
              <header className="chat-provider-heading">
                <span className="chat-provider-mark" aria-hidden="true">
                  {preset.mark}
                </span>
                <div>
                  <h2>{connection?.name ?? preset.name}</h2>
                  <p>
                    {connection
                      ? `${preset.name} · ${connection.enabled ? "Enabled" : "Disabled"}`
                      : "Connect with your API key"}
                  </p>
                </div>
                {connection && (
                  <label className="chat-provider-toggle">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={`Enable ${connection.name}`}
                      checked={connection.enabled}
                      disabled={busy}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        void run(() =>
                          save({
                            ...data,
                            connections: data.connections.map((c) =>
                              c.id === connection.id ? { ...c, enabled } : c,
                            ),
                          }),
                        );
                      }}
                    />
                    <span aria-hidden="true" />
                  </label>
                )}
              </header>
              <dl className="chat-provider-endpoint">
                <div>
                  <dt>Base URL</dt>
                  <dd>{preset.baseURL}</dd>
                </div>
                <div>
                  <dt>API format</dt>
                  <dd>{preset.format}</dd>
                </div>
              </dl>
              <div className="chat-key-heading">
                <span>API key</span>
                <button
                  className="chat-text-button"
                  type="button"
                  onClick={() =>
                    void openUrl(preset.keyURL).catch((e) =>
                      setError(errorMessage(e)),
                    )
                  }
                >
                  Get API key <ExternalLink size={12} />
                </button>
              </div>
              <div className="chat-key-summary">
                <ShieldCheck size={16} aria-hidden="true" />
                <span>
                  {connection?.secretId
                    ? connection.secretMode === "session"
                      ? "Session-only key · re-enter after restarting"
                      : "Key saved in system credential store"
                    : "Add a key to start using this provider"}
                </span>
                <button
                  className={`button ${connection ? "" : "chat-primary-button"}`}
                  disabled={busy}
                  onClick={() =>
                    connection ? openEdit(connection) : add(provider)
                  }
                >
                  {connection ? "Edit" : "Connect"}
                </button>
              </div>
              <div className="chat-model-heading">
                <h3>
                  Models <span>{models.length}</span>
                </h3>
                <div>
                  <button
                    className="button"
                    disabled={
                      busy || !connection?.enabled || !connection.secretId
                    }
                    onClick={() =>
                      connection &&
                      void run(async () => {
                        const result = await api<{
                          status: string;
                          result?: { code?: string };
                        }>("chat_connection_action", {
                          connectionId: connection.id,
                          model: "",
                          operation: "list-models",
                        });
                        if (result.status !== "completed")
                          throw new Error(
                            `Could not refresh models: ${result.result?.code ?? result.status}. Your previous models are still available.`,
                          );
                        await reload();
                        setStatus("Model catalog updated");
                      })
                    }
                  >
                    <RefreshCw size={13} /> Refresh models
                  </button>
                  <button
                    className="button"
                    disabled={
                      busy || !connection || connection.models.length >= 1000
                    }
                    onClick={() => {
                      setNewModel("");
                      setError("");
                      setAddingModel(true);
                    }}
                  >
                    <Plus size={13} /> Add model
                  </button>
                </div>
              </div>
              <p className="chat-field-help">
                {connection
                  ? "Choose a default for new conversations. Refresh to discover more models available to your key."
                  : "Suggested models. Connect this provider to refresh its catalog or add another model."}
              </p>
              {models.length > 6 && (
                <label className="chat-model-search">
                  <Search size={14} aria-hidden="true" />
                  <input
                    type="search"
                    aria-label="Search models"
                    placeholder="Search models…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              )}
              <ul className="chat-provider-models" aria-label="Provider models">
                {models
                  .filter((id) =>
                    id.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((id) => {
                    const isDefault =
                      !!connection &&
                      data.defaults.connectionId === connection.id &&
                      data.defaults.model === id;
                    const vision = capabilities.models.some(
                      (m) => m.provider === provider && m.id === id && m.images,
                    );
                    return (
                      <li key={id}>
                        <div>
                          <code>{id}</code>
                          {vision && (
                            <span className="chat-model-badge">Vision</span>
                          )}
                        </div>
                        <button
                          className={`chat-model-default ${isDefault ? "is-default" : ""}`}
                          type="button"
                          disabled={
                            busy ||
                            !connection?.enabled ||
                            !connection.secretId ||
                            isDefault
                          }
                          aria-label={
                            isDefault
                              ? `${id} is the default model`
                              : `Use ${id} by default`
                          }
                          onClick={() =>
                            connection &&
                            void run(() =>
                              save({
                                ...data,
                                defaults: {
                                  ...data.defaults,
                                  connectionId: connection.id,
                                  model: id,
                                  temperature: null,
                                  configured: true,
                                },
                              }),
                            )
                          }
                        >
                          {isDefault ? (
                            <>
                              <Check size={13} /> Default
                            </>
                          ) : (
                            "Use by default"
                          )}
                        </button>
                      </li>
                    );
                  })}
                {!models.some((id) =>
                  id.toLowerCase().includes(search.toLowerCase()),
                ) && (
                  <li className="chat-model-empty">
                    No models match “{search}”.
                  </li>
                )}
              </ul>
              {connection && (
                <details className="chat-advanced chat-provider-tools">
                  <summary>Connection tools</summary>
                  <ModelSelect
                    connection={connection}
                    value={
                      testModel[connection.id] ??
                      (data.defaults.connectionId === connection.id
                        ? data.defaults.model
                        : suggestedModel(connection))
                    }
                    onChange={(model) =>
                      setTestModel({ ...testModel, [connection.id]: model })
                    }
                  />
                  <button
                    className="button"
                    disabled={
                      busy ||
                      !connection.enabled ||
                      !connection.secretId ||
                      !validModelId(
                        testModel[connection.id] ??
                          (data.defaults.connectionId === connection.id
                            ? data.defaults.model
                            : suggestedModel(connection)),
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
                            (data.defaults.connectionId === connection.id
                              ? data.defaults.model
                              : suggestedModel(connection)),
                          operation: "test-connection",
                        });
                        await reload();
                        if (result.status !== "completed")
                          throw new Error(
                            `Connection test failed: ${result.result?.code ?? result.status}`,
                          );
                        setStatus("Connection test succeeded");
                      })
                    }
                  >
                    Test connection
                  </button>
                  <p className="chat-field-help">
                    Sends a short prompt with a 32-token output limit. May incur
                    provider charges. No project content is sent.
                  </p>
                  {connection.testStatus && (
                    <p>
                      Last test: {connection.testStatus} ·{" "}
                      {connection.testedModel}
                    </p>
                  )}
                  <div className="chat-connection-danger">
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
                      Remove connection
                    </button>
                  </div>
                </details>
              )}
            </section>
          </div>
          {!!data.connections.length && (
            <ChatDefaults
              saved={data}
              busy={busy}
              onSave={(next) => run(() => save(next))}
            />
          )}
          <p className="chat-storage-note">
            <ShieldCheck size={15} /> Keys are kept in your system credential
            store by default. Conversation history stays on this device.
          </p>
        </>
      )}
      {editing && data && (
        <Modal
          className="chat-dialog"
          title={
            data.connections.some((c) => c.id === editing.id)
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
                if (data.revision !== editingRevision)
                  throw new Error(
                    "Settings changed while you were editing. Close and reopen this form to use the latest settings.",
                  );
                const connections = data.connections.some(
                  (c) => c.id === editing.id,
                )
                  ? data.connections.map((c) =>
                      c.id === editing.id
                        ? {
                            ...editing,
                            name:
                              editing.name.trim() ||
                              providers[editing.provider],
                          }
                        : c,
                    )
                  : [
                      ...data.connections,
                      {
                        ...editing,
                        name:
                          editing.name.trim() || providers[editing.provider],
                      },
                    ];
                await save(
                  {
                    ...data,
                    connections,
                    defaults: makeDefault
                      ? {
                          ...data.defaults,
                          connectionId: editing.id,
                          model: editingModel.trim(),
                          temperature: null,
                          configured: true,
                        }
                      : data.defaults,
                  },
                  key ? editing.id : undefined,
                  key,
                );
                setSelected(editing.id);
                setEditing(null);
                setKey("");
                setStatus(
                  makeDefault
                    ? "Connection saved. You’re ready to chat."
                    : "Connection saved.",
                );
              });
            }}
          >
            <label>
              Provider
              <select
                value={editing.provider}
                onChange={(e) => {
                  const provider = e.target.value as Connection["provider"];
                  setEditing({ ...editing, provider, models: [] });
                  setEditingModel(
                    suggestedModel({ provider, models: [], testedModel: null }),
                  );
                  setKey("");
                  setShowKey(false);
                }}
              >
                {Object.entries(providers).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {needsKey
                ? "API key"
                : "Replacement API key (leave empty to keep current key)"}
              <input
                autoFocus
                type={showKey ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                required={needsKey}
              />
            </label>
            <button
              className="chat-text-button chat-key-reveal"
              type="button"
              aria-pressed={showKey}
              onClick={() => setShowKey(!showKey)}
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}{" "}
              {showKey ? "Hide key" : "Show key"}
            </button>
            <p className="chat-field-help">
              Paste an API key from your provider’s developer console. API usage
              is billed separately by the provider.
            </p>
            <label className="chat-checkbox">
              <input
                type="checkbox"
                checked={makeDefault}
                disabled={data.defaults.connectionId === editing.id}
                onChange={(event) => setMakeDefault(event.target.checked)}
              />
              Use for new conversations
            </label>
            {makeDefault && (
              <ModelSelect
                key={editing.provider}
                connection={editing}
                value={editingModel}
                onChange={setEditingModel}
              />
            )}
            <p className="chat-storage-note">
              <ShieldCheck size={14} />{" "}
              {editing.secretMode === "system"
                ? "Your key will be saved in your system credential store."
                : "Key kept in memory until SimpleBench closes."}
            </p>
            <details className="chat-advanced">
              <summary>Advanced options</summary>
              <label>
                Connection name
                <input
                  placeholder={providers[editing.provider]}
                  maxLength={200}
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                />
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
              {data.connections.some((c) => c.id === editing.id) && (
                <p>
                  Changing the provider, key or storage mode stops active
                  requests using this connection and preserves their responses.
                  A provider or storage change requires a new key.
                </p>
              )}
            </details>
            {error && <p role="alert">{error}</p>}
            <div className="dialog-actions">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                  setKey("");
                  setShowKey(false);
                }}
              >
                Cancel
              </button>
              <button
                className="button chat-primary-button"
                disabled={
                  busy || (makeDefault && !validModelId(editingModel.trim()))
                }
              >
                {busy ? "Saving…" : "Save connection"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {addingModel && connection && data && (
        <Modal
          className="chat-dialog"
          title="Add model"
          onClose={() => {
            if (!busy) setAddingModel(false);
          }}
        >
          <form
            className="dialog-form chat-config"
            onSubmit={(event) => {
              event.preventDefault();
              if (!validModelId(newModel.trim())) return;
              void run(async () => {
                await save({
                  ...data,
                  connections: data.connections.map((c) =>
                    c.id === connection.id
                      ? {
                          ...c,
                          models: [...new Set([...c.models, newModel.trim()])],
                        }
                      : c,
                  ),
                });
                setSearch("");
                setAddingModel(false);
                setStatus("Model added");
              });
            }}
          >
            <label>
              Model ID
              <input
                autoFocus
                required
                maxLength={200}
                spellCheck={false}
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                placeholder="Exact ID from the provider’s model catalog"
              />
            </label>
            <p className="chat-field-help">
              Use the exact model ID from {preset.name}. Adding a model does not
              send a request or verify access.
            </p>
            {error && <p role="alert">{error}</p>}
            <div className="dialog-actions">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => setAddingModel(false)}
              >
                Cancel
              </button>
              <button
                className="button chat-primary-button"
                disabled={busy || !validModelId(newModel.trim())}
              >
                Add model
              </button>
            </div>
          </form>
        </Modal>
      )}
      {recovering && (
        <Modal
          className="chat-dialog"
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
        <Modal
          className="chat-dialog"
          title="Remove API key?"
          onClose={() => setRemovingKey(null)}
        >
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
        <Modal
          className="chat-dialog"
          title="Remove AI connection?"
          onClose={() => setDeleting(null)}
        >
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
                  setSelected(deleting.provider);
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
