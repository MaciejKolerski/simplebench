import { useEffect, useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { api, errorMessage } from "./api";
import { IconButton } from "./ui";

export interface SearchMatch {
  relative: string;
  line: number;
  column: number;
  length: number;
  preview: string;
  previewStart: number;
}
interface SearchResults {
  matches: SearchMatch[];
  limited: boolean;
  skipped: number;
}

export default function ProjectSearch({
  root,
  relative,
  onClose,
  onScope,
  onOpenFile,
}: {
  root: string;
  relative: string;
  onClose: () => void;
  onScope: (relative: string) => void;
  onOpenFile: (relative: string, match: SearchMatch) => void;
}) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [includeIgnored, setIncludeIgnored] = useState(false);
  const [results, setResults] = useState<SearchResults>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    let started = false;
    setResults(undefined);
    setError("");
    setBusy(!!query);
    const timer = setTimeout(() => {
      if (!query) return;
      started = true;
      void api<SearchResults>("search_project", {
        root,
        relative,
        query,
        caseSensitive,
        includeIgnored,
      })
        .then((result) => {
          if (current) setResults(result);
        })
        .catch((error) => {
          if (current) setError(errorMessage(error));
        })
        .finally(() => {
          if (current) setBusy(false);
        });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
      if (started) void api("cancel_project_search").catch(() => {});
    };
  }, [root, relative, query, caseSensitive, includeIgnored, revision]);
  const groups = new Map<string, SearchMatch[]>();
  for (const match of results?.matches ?? []) {
    const group = groups.get(match.relative) ?? [];
    group.push(match);
    groups.set(match.relative, group);
  }
  return (
    <div className="sidebar-panel project-search">
      <header className="sidebar-heading">
        <span>SEARCH</span>
        <IconButton title="Back to Explorer" onClick={onClose}>
          <ArrowLeft size={14} />
        </IconButton>
      </header>
      <form
        className="project-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          setRevision((revision) => revision + 1);
        }}
      >
        <div className="project-search-input">
          <Search size={14} />
          <input
            autoFocus
            aria-label="Search in files"
            placeholder="Search in files"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="project-search-scope" title={`${root}/${relative}`}>
          <span>{relative || "Entire project"}</span>
          {relative && (
            <button type="button" onClick={() => onScope("")}>
              Search entire project
            </button>
          )}
        </div>
        <label>
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(event) => setCaseSensitive(event.target.checked)}
          />
          Match case
        </label>
        <label>
          <input
            type="checkbox"
            checked={includeIgnored}
            onChange={(event) => setIncludeIgnored(event.target.checked)}
          />
          Include ignored files
        </label>
      </form>
      <div
        className="project-search-results"
        aria-label="Search results"
        aria-busy={busy}
      >
        <p className="tree-message" role="status">
          {busy
            ? "Searching…"
            : !query
              ? "Search saved file contents in this folder."
              : results
                ? `${results.matches.length} matches in ${groups.size} ${groups.size === 1 ? "file" : "files"}`
                : ""}
        </p>
        {error && (
          <p className="tree-message text-error" role="alert">
            {error}
          </p>
        )}
        {results?.limited && (
          <p className="tree-message">
            Search limit reached. Narrow the query or folder.
          </p>
        )}
        {!!results?.skipped && (
          <p className="tree-message">
            Skipped {results.skipped} binary, large or unreadable items.
          </p>
        )}
        {[...groups].map(([path, matches]) => (
          <section key={path} className="search-file-group">
            <h3 title={path}>
              {path}
              <span>{matches.length}</span>
            </h3>
            {matches.map((match) => {
              const start = match.column - 1 - match.previewStart;
              return (
                <button
                  key={`${match.line}:${match.column}`}
                  type="button"
                  className="search-match"
                  title={`${path}:${match.line}:${match.column}\n${match.preview}`}
                  aria-label={`${path}, line ${match.line}, column ${match.column}`}
                  onClick={() => onOpenFile(path, match)}
                >
                  <span className="search-line-number">{match.line}</span>
                  <code>
                    {match.previewStart > 0 && "…"}
                    {match.preview.slice(0, start)}
                    <mark>
                      {match.preview.slice(start, start + match.length)}
                    </mark>
                    {match.preview.slice(start + match.length)}
                  </code>
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
