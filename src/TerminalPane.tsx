import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  ChevronRight,
  Code,
  Command,
  Copy,
  History,
  Play,
  RotateCcw,
  Search,
  SplitSquareHorizontal,
  SplitSquareVertical,
  X,
} from "lucide-react";
import type { Pane, ShellProfile, Split } from "./model";
import { basename } from "./model";
import { terminalFor } from "./terminal-runtime";
import { IconButton } from "./ui";

interface Props {
  pane: Pane;
  profile?: ShellProfile;
  active: boolean;
  onFocus: () => void;
  onSplit: (axis: Split["axis"]) => void;
  onClose: () => void;
  onRestart: (useProjectDirectory?: boolean) => void;
}

export default function TerminalPane(props: Props) {
  if (!props.profile)
    return (
      <section className="terminal-pane">
        <div className="empty-message">
          <h2>Shell unavailable</h2>
          <p>Choose an installed environment from the tab’s shell selector.</p>
        </div>
      </section>
    );
  return <LiveTerminal {...props} profile={props.profile} />;
}

function LiveTerminal({
  pane,
  profile,
  active,
  onFocus,
  onSplit,
  onClose,
  onRestart,
}: Props & { profile: ShellProfile }) {
  const [runtime] = useState(() => terminalFor(pane, profile));
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  const container = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [composer, setComposer] = useState(false);
  const [command, setCommand] = useState("");
  const [blocks, setBlocks] = useState(false);

  useEffect(() => {
    runtime.attach(container.current!);
    return () => runtime.detach();
  }, [runtime]);
  useEffect(() => {
    if (
      active &&
      !container.current
        ?.closest(".terminal-pane")
        ?.contains(document.activeElement)
    )
      runtime.terminal.focus();
  }, [active, runtime]);
  useEffect(() => {
    if (searchOpen) {
      searchInput.current?.focus();
      searchInput.current?.select();
    } else runtime.searchAddon.clearDecorations();
    runtime.scheduleFit();
  }, [searchOpen, runtime]);
  useEffect(() => {
    if (searchOpen) runtime.find(query, false, caseSensitive, regex);
  }, [query, caseSensitive, regex, searchOpen, runtime]);
  useEffect(() => {
    runtime.scheduleFit();
    if (composer) composerInput.current?.focus();
  }, [composer, runtime]);
  useEffect(() => {
    if (!active) return;
    const handle = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.code === "KeyF"
      ) {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [active]);

  const execute = () => {
    runtime.execute(command);
    setCommand("");
  };
  return (
    <section
      className={`terminal-pane${active ? " is-active" : ""}`}
      data-pane-id={pane.id}
      aria-label={`Terminal ${profile.name}`}
      onPointerDownCapture={onFocus}
      onFocusCapture={onFocus}
    >
      <div className="pane-toolbar">
        <span
          className={`session-indicator ${snapshot.status}`}
          title={snapshot.status}
        />
        <span className="pane-shell">{profile.name}</span>
        <ChevronRight size={12} />
        <span className="pane-path" title={snapshot.cwd}>
          {basename(snapshot.cwd)}
        </span>
        <span
          className="renderer-label"
          title="Renderer for the visible terminal"
        >
          {snapshot.renderer}
        </span>
        <div className="pane-actions">
          <IconButton
            title="Find in terminal (Ctrl+Shift+F)"
            aria-pressed={searchOpen}
            onClick={() => setSearchOpen(!searchOpen)}
          >
            <Search size={14} />
          </IconButton>
          <IconButton
            title="Command input"
            aria-pressed={composer}
            onClick={() => setComposer(!composer)}
          >
            <Code size={15} />
          </IconButton>
          <IconButton
            title="Command blocks"
            aria-pressed={blocks}
            onClick={() => setBlocks(!blocks)}
          >
            <History size={14} />
          </IconButton>
          <IconButton
            title="Split terminal side by side"
            onClick={() => onSplit("horizontal")}
          >
            <SplitSquareHorizontal size={15} />
          </IconButton>
          <IconButton
            title="Split terminal top and bottom"
            onClick={() => onSplit("vertical")}
          >
            <SplitSquareVertical size={15} />
          </IconButton>
          <IconButton title="Close terminal" onClick={onClose}>
            <X size={14} />
          </IconButton>
        </div>
      </div>
      {searchOpen && (
        <div className="terminal-search">
          <Search size={14} />
          <input
            ref={searchInput}
            aria-label="Search terminal output"
            placeholder="Find in terminal…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSearchOpen(false);
                runtime.terminal.focus();
              }
              if (event.key === "Enter")
                runtime.find(query, event.shiftKey, caseSensitive, regex);
            }}
          />
          <span className="search-result">{snapshot.searchResult}</span>
          <IconButton
            title="Match case"
            aria-pressed={caseSensitive}
            onClick={() => setCaseSensitive(!caseSensitive)}
          >
            <CaseSensitive size={16} />
          </IconButton>
          <IconButton
            title="Regular expression"
            aria-pressed={regex}
            onClick={() => setRegex(!regex)}
          >
            <span className="regex-icon">.*</span>
          </IconButton>
          <IconButton
            title="Previous match"
            onClick={() => runtime.find(query, true, caseSensitive, regex)}
          >
            <ArrowUp size={14} />
          </IconButton>
          <IconButton
            title="Next match"
            onClick={() => runtime.find(query, false, caseSensitive, regex)}
          >
            <ArrowDown size={14} />
          </IconButton>
          <IconButton title="Close search" onClick={() => setSearchOpen(false)}>
            <X size={14} />
          </IconButton>
        </div>
      )}
      <div className="terminal-body">
        <div className="terminal-mount" ref={container} />
        {snapshot.status === "error" && (
          <div className="terminal-error">
            <p>{snapshot.error}</p>
            <button className="button" onClick={() => onRestart()}>
              <RotateCcw size={14} />
              Retry terminal
            </button>
            <button className="button" onClick={() => onRestart(true)}>
              Start in project folder
            </button>
          </div>
        )}
        {snapshot.status === "exited" && (
          <button
            className="button restart-terminal"
            onClick={() => onRestart()}
          >
            <RotateCcw size={14} />
            Restart
          </button>
        )}
        {blocks && (
          <aside className="command-blocks" aria-label="Command blocks">
            <header>
              <span>COMMANDS</span>
              <IconButton
                title="Close command blocks"
                onClick={() => setBlocks(false)}
              >
                <X size={14} />
              </IconButton>
            </header>
            {!snapshot.blocks.length && (
              <p className="muted">
                Run a command to see its output block here.
              </p>
            )}
            {[...snapshot.blocks].reverse().map((block) => (
              <button
                className="command-block"
                key={block.id}
                onClick={() => runtime.jumpTo(block)}
                title="Jump to command output"
              >
                <span className="command-block-text">
                  <Command size={13} />
                  <code>{block.command}</code>
                </span>
                <span className="command-block-meta">
                  <span className={block.exitCode ? "text-error" : ""}>
                    {block.finished
                      ? block.exitCode === undefined
                        ? "Completed"
                        : `Exit ${block.exitCode}`
                      : "Running"}
                  </span>
                  <span>
                    {block.finished
                      ? `${((block.finished - block.started) / 1000).toFixed(1)}s`
                      : ""}
                  </span>
                </span>
              </button>
            ))}
          </aside>
        )}
      </div>
      {composer && (
        <div className="command-composer">
          <div className="composer-heading">
            <Code size={14} />
            <span>Command input</span>
            <span className="muted">Ctrl+Enter to run</span>
            <IconButton
              title="Copy terminal selection"
              onClick={() => void runtime.copy()}
            >
              <Copy size={13} />
            </IconButton>
          </div>
          <textarea
            ref={composerInput}
            aria-label="Command input"
            placeholder="Write a command…"
            spellCheck={false}
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                execute();
              }
              if (event.key === "Tab") {
                event.preventDefault();
                const target = event.currentTarget;
                const start = target.selectionStart;
                setCommand(
                  command.slice(0, start) +
                    "  " +
                    command.slice(target.selectionEnd),
                );
                requestAnimationFrame(() =>
                  target.setSelectionRange(start + 2, start + 2),
                );
              }
              if (
                event.key === "ArrowUp" &&
                !command &&
                snapshot.blocks.length
              ) {
                event.preventDefault();
                setCommand(snapshot.blocks.at(-1)!.command);
              }
            }}
          />
          <button
            className="button composer-run"
            disabled={!command.trim() || snapshot.status !== "running"}
            onClick={execute}
          >
            <Play size={13} />
            Run
          </button>
        </div>
      )}
    </section>
  );
}
