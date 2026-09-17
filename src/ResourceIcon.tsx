import { IconGlyph } from "./theme/IconGlyph";
import { useState, useSyncExternalStore, type ComponentType } from "react";
import { File, Folder, FolderOpen, type LucideProps } from "lucide-react";
import { effectiveTheme, subscribeTheme } from "./theme/runtime";
import { fileIconDefinition, type FileIconRequest } from "./theme/icon-theme";

export default function ResourceIcon({
  path,
  folder,
  expanded,
  root,
  language,
  size = 14,
  fallback,
  ...props
}: FileIconRequest & LucideProps & { fallback?: ComponentType<LucideProps> }) {
  const snapshot = useSyncExternalStore(subscribeTheme, effectiveTheme);
  const theme = snapshot.fileIcons;
  const [failed, setFailed] = useState("");
  const Fallback =
    fallback ?? (folder ? (expanded ? FolderOpen : Folder) : File);
  if (!theme) return <Fallback size={size} aria-hidden="true" {...props} />;
  const selected = fileIconDefinition(
    theme.data,
    { path, folder, expanded, root, language },
    snapshot.appearance,
    snapshot.highContrast,
  );
  const definition = selected?.definition;
  const id = selected?.id;
  const source = definition?.iconPath ? theme.asset(definition.iconPath) : "";
  if (source && source === failed)
    return <Fallback size={size} aria-hidden="true" {...props} />;
  if (!definition) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      {...props}
      className={`resource-icon ${props.className ?? ""}`}
      data-file-icon={id}
    >
      {source ? (
        theme.data.usesCurrentColor ? (
          <>
            <image
              href={source}
              width="24"
              height="24"
              opacity="0"
              onError={() => setFailed(source)}
            />
            <foreignObject width="24" height="24">
              <span
                style={{
                  display: "block",
                  width: 24,
                  height: 24,
                  backgroundColor: "currentColor",
                  mask: `url(${JSON.stringify(source)}) center / contain no-repeat`,
                  WebkitMask: `url(${JSON.stringify(source)}) center / contain no-repeat`,
                }}
              />
            </foreignObject>
          </>
        ) : (
          <image
            href={source}
            width="24"
            height="24"
            onError={() => setFailed(source)}
          />
        )
      ) : (
        <IconGlyph theme={theme} definition={definition} size={size} />
      )}
    </svg>
  );
}
