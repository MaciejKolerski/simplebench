import { useState } from "react";
import type { Connection } from "./types";
import { modelLabel, modelOptions } from "./models";

export function ModelSelect({
  connection,
  value,
  onChange,
}: {
  connection?: Pick<Connection, "provider" | "models">;
  value: string;
  onChange: (value: string) => void;
}) {
  const options = modelOptions(connection);
  const [custom, setCustom] = useState(false);
  const isCustom = (custom && !value) || (!!value && !options.includes(value));
  return (
    <div className="chat-model-select">
      <label>
        Model
        <select
          disabled={!connection}
          value={isCustom ? "custom" : value}
          onChange={(event) => {
            const next = event.target.value;
            setCustom(next === "custom");
            onChange(next === "custom" ? "" : next);
          }}
        >
          <option value="" disabled>
            Choose a model
          </option>
          {options.map((id) => (
            <option key={id} value={id}>
              {modelLabel(id)}
            </option>
          ))}
          <option value="custom">Custom model…</option>
        </select>
      </label>
      {isCustom && (
        <label>
          Custom model ID
          <input
            required
            value={value}
            placeholder="Enter the provider’s model ID"
            spellCheck={false}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
      )}
    </div>
  );
}
