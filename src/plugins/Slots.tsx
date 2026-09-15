import { useSyncExternalStore } from "react";
import { Fill } from "react-slot-fill";
export { Provider as SlotProvider, Slot } from "react-slot-fill";
import { pluginHost } from "./runtime";
import { PluginBoundary } from "./PluginPanel";
export function PluginFills() {
  useSyncExternalStore(pluginHost.subscribe, pluginHost.revision);
  return [...pluginHost.fills]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, { owner, component: Component }]) => {
      const fill = pluginHost.catalog.entries
        .find((e) => e.id === owner)
        ?.manifest?.contributes?.fills?.find((f) => f.id === id);
      return fill ? (
        <Fill key={id} name={fill.slot}>
          <PluginBoundary owner={owner}>
            <span aria-label={fill.label}>
              <Component />
            </span>
          </PluginBoundary>
        </Fill>
      ) : null;
    });
}
