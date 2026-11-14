import { useEffect, useMemo, useState } from "react";
import type { ProgressAccount } from "../api";
import { Button } from "../ui/Button";
import { CodeEditor } from "../ui/CodeEditor";
import { Dialog } from "../ui/Dialog";
import { Input } from "../ui/Field";
import { Icon } from "../ui/Icon";
import { StatusPill } from "../ui/Status";
import { toast } from "../ui/Toast";
import { isOnline, useProgress } from "../features/progress/shared";

type Result = { id: string; key: string; name: string; script: string; ok: boolean | null; picked: boolean; output: string; at: number };

const SNIPPETS: [string, string][] = [
  ["Who am I", "local p = game.Players.LocalPlayer\nprint(p.Name, p.UserId, game.PlaceId, game.JobId)"],
  ["Position", "local c = game.Players.LocalPlayer.Character\nprint(c and c:GetPivot().Position)"],
  ["Reset", 'local h = game.Players.LocalPlayer.Character and game.Players.LocalPlayer.Character:FindFirstChildOfClass("Humanoid")\nif h then h.Health = 0 end\nprint("reset")'],
  ["Rejoin", 'game:GetService("TeleportService"):TeleportToPlaceInstance(game.PlaceId, game.JobId, game.Players.LocalPlayer)\nprint("rejoining")'],
];
const KEY = "mtwin.webScript";
const nameOf = (a: ProgressAccount) => a.displayName || a.name;

/** Runs Lua in the clients of the accounts picked, through each one's Progress reporter (it polls
 * the server for what to run). Offline accounts are listed but can't be picked: nothing would run
 * there, and the server refuses them too. Only on the page this PC serves: it carries the token. */
export function RunScript({ open, onClose, token }: { open: boolean; onClose: () => void; token: string }) {
  const s = useProgress().data;
  const all = useMemo(() => s?.accounts ?? [], [s]);
  const online = (a: ProgressAccount) => !!s && isOnline(a, s);
  // Unticked by hand; everyone online is picked otherwise (and whoever comes online).
  const [off, setOff] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const picked = all.filter((a) => online(a) && !off.has(a.key));
  const [code, setCode] = useState(() => {
    try {
      return localStorage.getItem(KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [since, setSince] = useState(0);

  useEffect(() => {
    if (!open) return;
    let stop = false;
    const poll = async () => {
      try {
        const r = await fetch("/api/exec-results", { cache: "no-store" });
        if (r.ok && !stop) setResults(await r.json());
      } catch {
        // Tried again next time.
      }
    };
    void poll();
    const id = setInterval(poll, 1500);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [open]);

  const save = (v: string) => {
    setCode(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      // Kept for this visit only.
    }
  };
  const run = async () => {
    // Checked again now: an account may have gone offline since the list was drawn.
    const targets = picked.filter(online).map((a) => a.key);
    if (!code.trim()) return;
    if (!targets.length) return toast("No picked account is online.", "error");
    setBusy(true);
    try {
      const r = await fetch("/api/exec", { method: "POST", headers: { "Content-Type": "application/json", "X-Exec-Token": token }, body: JSON.stringify({ code, targets }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const sent = ((await r.json()) as { ids: string[] }).ids.length;
      const skipped = targets.length - sent;
      toast(skipped ? `Sent to ${sent}; ${skipped} went offline and were skipped` : `Sent to ${sent} client${sent === 1 ? "" : "s"}`, skipped ? "error" : "ok");
    } catch (e) {
      toast(`Couldn't send it (${(e as Error).message})`, "error");
    } finally {
      setBusy(false);
    }
  };

  const n = q.trim().toLowerCase();
  const listed = all
    .filter((a) => !n || `${a.name} ${a.displayName} ${a.gameName} ${a.pc}`.toLowerCase().includes(n))
    .sort((a, b) => Number(online(b)) - Number(online(a)) || nameOf(a).localeCompare(nameOf(b)));
  const onlineCount = all.filter(online).length;
  const shown = results.filter((r) => r.at >= since);

  return (
    <Dialog open={open} onClose={onClose} title="Run a script" width={980}>
      <div className="rs">
        <aside className="rs-side">
          <div className="rs-side-head">
            <b>Clients</b>
            <span className="meta">
              {picked.length} of {onlineCount} online
            </span>
          </div>
          <Input leading="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an account" aria-label="Find an account" />
          <div className="rs-quick">
            <button type="button" className="linkbtn" onClick={() => setOff(new Set())}>
              All online
            </button>
            <button type="button" className="linkbtn" onClick={() => setOff(new Set(all.map((a) => a.key)))}>
              None
            </button>
          </div>
          <ul className="rs-list scroll">
            {listed.map((a) => {
              const on = online(a);
              const checked = on && !off.has(a.key);
              return (
                <li key={a.key}>
                  <button
                    type="button"
                    className="rs-acc"
                    role="checkbox"
                    aria-checked={checked}
                    disabled={!on}
                    onClick={() =>
                      setOff((o) => {
                        const x = new Set(o);
                        if (x.has(a.key)) x.delete(a.key);
                        else x.add(a.key);
                        return x;
                      })
                    }
                  >
                    <span className="rs-box" aria-hidden="true">
                      {checked && <Icon name="check" size={12} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="rs-name">{nameOf(a)}</span>
                      <span className="rs-sub">
                        {a.gameName}
                        {a.pc ? ` · ${a.pc}` : ""}
                      </span>
                    </span>
                    <span className="rs-state" data-on={on || undefined}>
                      {on ? "Online" : "Offline"}
                    </span>
                  </button>
                </li>
              );
            })}
            {!listed.length && <li className="meta px-2 py-4">{all.length ? "No account matches." : "No account has reported yet."}</li>}
          </ul>
        </aside>

        <section className="rs-main">
          <CodeEditor
            value={code}
            onChange={save}
            label="Script"
            name="run.lua"
            placeholder={"-- Lua, run in each picked client's executor\nprint(game.Players.LocalPlayer.Name)"}
            onRun={() => void run()}
            minRows={13}
            tools={SNIPPETS.map(([label, text]) => (
              <button key={label} type="button" className="ce-btn" onClick={() => save(text)} title={`Put the ${label} example in`}>
                {label}
              </button>
            ))}
          />
          <div className="rs-run">
            <span className="meta flex-1">Ctrl+Enter runs it on the picked clients. print() and errors show below.</span>
            <Button variant="primary" icon="play" busy={busy} disabled={!picked.length || !code.trim()} onClick={() => void run()}>
              {picked.length ? `Run on ${picked.length}` : "Pick an online client"}
            </Button>
          </div>
          <div className="rs-results">
            <div className="rs-results-head">
              <b>Output</b>
              {shown.length > 0 && (
                <button type="button" className="linkbtn" onClick={() => setSince(Date.now())}>
                  Clear
                </button>
              )}
            </div>
            <div className="rs-results-list scroll">
              {shown.map((r) => (
                <div key={r.id} className="rs-result" data-tone={r.ok === false ? "err" : undefined}>
                  <div className="rs-result-head">
                    <b className="truncate">{r.name}</b>
                    <StatusPill tone={r.ok === true ? "ok" : r.ok === false ? "err" : r.picked ? "info" : "neutral"} label={r.ok === true ? "Done" : r.ok === false ? "Error" : r.picked ? "Running" : "Queued"} />
                    <span className="meta ms-auto tabular-nums">{new Date(r.at).toLocaleTimeString()}</span>
                  </div>
                  {r.output && <pre>{r.output}</pre>}
                </div>
              ))}
              {!shown.length && <p className="rs-empty">Run something to see each client's output here.</p>}
            </div>
          </div>
        </section>
      </div>
    </Dialog>
  );
}
