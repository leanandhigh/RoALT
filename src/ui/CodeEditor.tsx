import "./code-editor.css";
import { useRef, useState, type ReactNode } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { t } from "../i18n";
import { Icon } from "./Icon";
import { toastError } from "./Toast";

/** Lua, coloured: comments, strings, numbers, keywords and calls (pure; the text is escaped by React). */
const KEYWORDS = new Set(["local", "function", "end", "if", "then", "else", "elseif", "for", "in", "do", "while", "repeat", "until", "return", "not", "and", "or", "nil", "true", "false", "break", "continue"]);
export function highlightLua(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(--[^\n]*)|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)|(\b\d[\d.]*\b)|([A-Za-z_][A-Za-z0-9_]*)(\s*\()?/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index));
    if (m[1]) out.push(<span key={k++} className="lx-c">{m[1]}</span>);
    else if (m[2]) out.push(<span key={k++} className="lx-s">{m[2]}</span>);
    else if (m[3]) out.push(<span key={k++} className="lx-n">{m[3]}</span>);
    else if (m[4]) {
      const cls = KEYWORDS.has(m[4]) ? "lx-k" : m[5] ? "lx-f" : undefined;
      out.push(cls ? <span key={k++} className={cls}>{m[4]}</span> : m[4]);
      if (m[5]) out.push(m[5]);
    }
    last = re.lastIndex;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

/** A Lua editor: a bar (the file's name or "Luau", the line count, Copy, then `tools`), line
 * numbers, and the code coloured as it is typed (a coloured copy under a see-through textarea).
 * Tab indents; Ctrl+S calls `onSave`, Ctrl+Enter `onRun`. */
export function CodeEditor({ value, onChange, label, name, placeholder, tools, onSave, onRun, minRows = 14, autoFocus }: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  /** Shown in the bar: the file name. */
  name?: ReactNode;
  placeholder?: string;
  tools?: ReactNode;
  onSave?: () => void;
  onRun?: () => void;
  minRows?: number;
  autoFocus?: boolean;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const under = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const lines = Math.max(value.split("\n").length, 1);
  const sync = () => {
    const a = area.current;
    if (!a) return;
    if (under.current) {
      under.current.scrollTop = a.scrollTop;
      under.current.scrollLeft = a.scrollLeft;
    }
    if (gutter.current) gutter.current.scrollTop = a.scrollTop;
  };
  return (
    <div className="ce" style={{ "--ce-rows": minRows } as React.CSSProperties}>
      <div className="ce-bar">
        <span className="ce-lang">Luau</span>
        {name && <span className="ce-name">{name}</span>}
        <span className="ce-meta">{t("code.lines", { count: lines })}</span>
        <span className="ce-sp" />
        {tools}
        <button
          type="button"
          className="ce-btn"
          disabled={!value}
          onClick={() =>
            writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }, toastError)
          }
        >
          <Icon name={copied ? "check" : "copy"} size={13} />
          {t(copied ? "progress.copied" : "common.copy")}
        </button>
      </div>
      <div className="ce-body">
        <div ref={gutter} className="ce-gutter" aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
        <div className="ce-text">
          <pre ref={under} className="ce-under" aria-hidden="true">
            {highlightLua(value)}
            {"\n"}
          </pre>
          <textarea
            ref={area}
            className="ce-area"
            value={value}
            placeholder={placeholder}
            aria-label={label}
            spellCheck={false}
            autoFocus={autoFocus}
            wrap="off"
            onScroll={sync}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Tab" && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                const el = e.currentTarget;
                el.setRangeText("\t", el.selectionStart, el.selectionEnd, "end");
                onChange(el.value);
              } else if (e.key === "s" && (e.ctrlKey || e.metaKey) && onSave) {
                e.preventDefault();
                onSave();
              } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && onRun) {
                e.preventDefault();
                onRun();
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
