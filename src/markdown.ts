export const isMarkdownFile = (relative: string) =>
  /\.(md|markdown)$/i.test(relative);

export function markdownTarget(href: string, relative: string) {
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) return null;
  try {
    if (href.startsWith("#"))
      return {
        kind: "fragment" as const,
        value: decodeURIComponent(href.slice(1)),
      };
    if (/^https?:\/\//i.test(href))
      return { kind: "external" as const, value: new URL(href).href };
    if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//")) return null;
    const base = relative.split(/[\\/]/).map(encodeURIComponent).join("/");
    const url = new URL(href, `https://markdown.invalid/${base}`);
    if (url.origin !== "https://markdown.invalid") return null;
    const path = decodeURIComponent(url.pathname).slice(1);
    if (!path || /[\u0000-\u001f\u007f\\]/.test(path)) return null;
    return { kind: "file" as const, value: path };
  } catch {
    return null;
  }
}
