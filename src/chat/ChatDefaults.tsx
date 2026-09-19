import { useState } from "react";
import { ModelSelect } from "./ModelSelect";
import { suggestedModel, modelLabel } from "./models";
import type { Preferences } from "./types";

export function ChatDefaults({
  saved,
  busy,
  onSave,
}: {
  saved: Preferences;
  busy: boolean;
  onSave: (data: Preferences) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<Preferences>();
  const data = draft ?? saved;
  return (
    <details className="chat-defaults-section">
      <summary>
        Chat preferences
        <span>
          {modelLabel(data.defaults.model) || "Choose a default model"}
        </span>
      </summary>
      <form
        className="chat-defaults"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave({
            ...data,
            defaults: {
              ...data.defaults,
              configured: !!data.defaults.connectionId && !!data.defaults.model,
            },
          }).then((saved) => {
            if (saved) setDraft(undefined);
          });
        }}
      >
        <h2>New conversation defaults</h2>
        <label>
          Connection
          <select
            value={data.defaults.connectionId ?? ""}
            onChange={(e) =>
              setDraft({
                ...data,
                defaults: {
                  ...data.defaults,
                  connectionId: e.target.value || null,
                  model: suggestedModel(
                    data.connections.find((c) => c.id === e.target.value),
                  ),
                  temperature: null,
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
        <ModelSelect
          key={data.defaults.connectionId}
          connection={data.connections.find(
            (c) => c.id === data.defaults.connectionId,
          )}
          value={data.defaults.model}
          onChange={(model) =>
            setDraft({
              ...data,
              defaults: { ...data.defaults, model, temperature: null },
            })
          }
        />
        <label>
          System instructions
          <textarea
            rows={4}
            value={data.defaults.system}
            onChange={(e) =>
              setDraft({
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
              setDraft({
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
              setDraft({
                ...data,
                sendMode: e.target.value as Preferences["sendMode"],
              })
            }
          >
            <option value="enter">Enter · Shift+Enter for a new line</option>
            <option value="modifier-enter">
              Ctrl/Cmd+Enter · Enter for a new line
            </option>
          </select>
        </label>
        <button className="button" disabled={busy || !draft}>
          Save defaults
        </button>
        {draft && (
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={() => setDraft(undefined)}
          >
            Discard changes
          </button>
        )}
      </form>
    </details>
  );
}
