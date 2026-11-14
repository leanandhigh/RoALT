import "./tools.css";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type AccountSummary, type AccountTool, type ToolResult } from "../../api";
import { qk } from "../../data";
import { fmtNum, t, type Key } from "../../i18n";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Field";
import { Icon, type IconName } from "../../ui/Icon";
import { toast, toastError } from "../../ui/Toast";
import { accountName, Avatar } from "../accounts/shared";

type ToolId = "validate" | "robux" | "displayName" | "addFriend" | "block" | "unblock";
type ToolDef = { id: ToolId; icon: IconName; label: Key; hint: Key; tone: string; input?: "name" | "user" };

const TOOLS: ToolDef[] = [
  { id: "validate", icon: "refresh", label: "tools.validate", hint: "tools.validateHint", tone: "ok" },
  { id: "robux", icon: "coin", label: "tools.robux", hint: "tools.robuxHint", tone: "gold" },
  { id: "displayName", icon: "pencil", label: "tools.displayName", hint: "tools.displayNameHint", tone: "info", input: "name" },
  { id: "addFriend", icon: "accounts", label: "tools.addFriend", hint: "tools.addFriendHint", tone: "violet", input: "user" },
  { id: "block", icon: "block", label: "tools.block", hint: "tools.blockHint", tone: "danger", input: "user" },
  { id: "unblock", icon: "unlock", label: "tools.unblock", hint: "tools.unblockHint", tone: "muted", input: "user" },
];

/** Bulk account tools: pick accounts on the left, a tool on the right, run it on each in turn. */
export function ToolsView({ accounts }: { accounts: AccountSummary[] }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [tool, setTool] = useState<ToolId>("validate");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ tool: ToolId; rows: ToolResult[] } | null>(null);
  const usable = accounts.filter((a) => a.status !== "invalid");
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return usable.filter((a) => !n || `${a.alias}\n${a.displayName}\n${a.username}`.toLowerCase().includes(n));
  }, [usable, q]);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const chosen = usable.filter((a) => picked.has(a.id));
  const def = TOOLS.find((d) => d.id === tool)!;
  const allShown = shown.length > 0 && shown.every((a) => picked.has(a.id));

  const toggle = (id: number) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function run() {
    if (!chosen.length || busy) return;
    let arg: AccountTool;
    try {
      if (def.input === "user") {
        const raw = text.trim().replace(/^@/, "");
        if (!raw) return toast(t("tools.needUser"), "error");
        const userId = /^\d+$/.test(raw) ? Number(raw) : (await api.userLookup(raw)).userId;
        arg = { kind: tool as "addFriend" | "block" | "unblock", userId };
      } else if (def.input === "name") {
        if (!text.trim()) return toast(t("tools.needName"), "error");
        arg = { kind: "displayName", name: text.trim() };
      } else {
        arg = { kind: tool as "robux" | "validate" };
      }
    } catch (e) {
      return toastError(e);
    }
    setBusy(true);
    try {
      const rows = await api.accountsTool(chosen.map((a) => a.id), arg);
      setResults({ tool, rows });
      void qc.invalidateQueries({ queryKey: qk.accounts });
      const ok = rows.filter((r) => r.ok).length;
      toast(t("tools.done", { ok, total: rows.length }), ok === rows.length ? "ok" : "error");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  const totalRobux = results?.tool === "robux" ? results.rows.reduce((n, r) => n + (r.robux ?? 0), 0) : null;

  return (
    <main className="scroll flex-1 min-w-0 page">
      <div className="tl-page">
        <header className="tl-head">
          <h1 className="page-title">{t("app.nav.tools")}</h1>
          <p className="page-sub">{t("tools.sub")}</p>
        </header>

        <section className="tl-pick panel" aria-label={t("tools.accounts")}>
          <div className="tl-pick-head">
            <label className="tl-all">
              <input
                type="checkbox"
                className="cb"
                checked={allShown}
                onChange={() => setPicked(allShown ? new Set([...picked].filter((id) => !shown.some((a) => a.id === id))) : new Set([...picked, ...shown.map((a) => a.id)]))}
              />
              <span>{t("tools.accountsN", { n: chosen.length, total: usable.length })}</span>
            </label>
          </div>
          <Input leading="search" placeholder={t("accounts.filterPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("accounts.filterLabel")} />
          <ul className="tl-list">
            {shown.map((a) => (
              <li key={a.id}>
                <label className="tl-acc" data-on={picked.has(a.id) || undefined}>
                  <input type="checkbox" className="cb" checked={picked.has(a.id)} onChange={() => toggle(a.id)} />
                  <Avatar account={a} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="tl-acc-name">{accountName(a)}</span>
                    <span className="tl-acc-sub">@{a.username}</span>
                  </span>
                  {a.status === "challenged" && <Icon name="alert" size={14} className="tl-warn" />}
                </label>
              </li>
            ))}
            {!shown.length && <li className="tl-none">{t("accounts.noMatch")}</li>}
          </ul>
        </section>

        <section className="tl-main">
          <div className="tl-tools" role="radiogroup" aria-label={t("tools.pick")}>
            {TOOLS.map((d) => (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={tool === d.id}
                className="tl-tool"
                data-tone={d.tone}
                onClick={() => {
                  if (d.input !== def.input) setText("");
                  setTool(d.id);
                }}
              >
                <span className="tl-tool-icon" aria-hidden="true">
                  <Icon name={d.icon} size={17} />
                </span>
                <span className="min-w-0">
                  <span className="tl-tool-name">{t(d.label)}</span>
                  <span className="tl-tool-hint">{t(d.hint)}</span>
                </span>
              </button>
            ))}
          </div>

          <form
            className="tl-run panel"
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            <div className="tl-run-title">
              <Icon name={def.icon} size={16} />
              <b>{t(def.label)}</b>
              <span className="text-fg-3">· {t("tools.onN", { n: chosen.length })}</span>
            </div>
            {def.input && (
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t(def.input === "name" ? "tools.namePlaceholder" : "tools.userPlaceholder")}
                maxLength={def.input === "name" ? 24 : 40}
                aria-label={t(def.input === "name" ? "tools.namePlaceholder" : "tools.userPlaceholder")}
              />
            )}
            {def.input === "name" && <p className="tl-note">{t("tools.displayNameNote")}</p>}
            <Button type="submit" variant="primary" size="md" icon="play" busy={busy} disabled={!chosen.length}>
              {busy ? t("tools.running") : chosen.length ? t("tools.runOn", { n: chosen.length }) : t("tools.pickFirst")}
            </Button>
          </form>

          {results && (
            <section className="tl-results panel" aria-live="polite">
              <div className="tl-results-head">
                <b>{t(TOOLS.find((d) => d.id === results.tool)!.label)}</b>
                <span className="text-fg-3">{t("tools.done", { ok: results.rows.filter((r) => r.ok).length, total: results.rows.length })}</span>
                {totalRobux !== null && <span className="tl-total">{t("tools.totalRobux", { n: fmtNum(totalRobux) })}</span>}
              </div>
              <ul>
                {results.rows.map((r) => {
                  const a = byId.get(r.accountId);
                  return (
                    <li key={r.accountId} className="tl-res" data-ok={r.ok || undefined}>
                      <Icon name={r.ok ? "check" : "x"} size={14} className="tl-res-mark" />
                      <span className="tl-res-name">
                        {a ? accountName(a) : r.accountId}
                        {a && <span className="tl-res-user">@{a.username}</span>}
                      </span>
                      <span className="tl-res-msg">{r.message}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
