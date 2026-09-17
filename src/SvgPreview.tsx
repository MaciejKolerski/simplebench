import {
  memo,
  useDeferredValue,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { EditorDocument } from "./editor-runtime";
import type { FileTab } from "./model";
import ImagePreview from "./ImagePreview";

export default memo(function SvgPreview({
  document,
  tab,
  active,
  children,
}: {
  document: EditorDocument;
  tab: FileTab;
  active: boolean;
  children: ReactNode;
}) {
  const current = useSyncExternalStore(
    document.subscribeText,
    document.getTextSnapshot,
  );
  const deferred = useDeferredValue(current);
  const text = useMemo(() => deferred.toString(), [deferred]);
  return (
    <ImagePreview tab={tab} active={active} sourceText={text}>
      {children}
    </ImagePreview>
  );
});
