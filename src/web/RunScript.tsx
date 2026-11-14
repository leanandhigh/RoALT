import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Checkbox } from "../ui/Field";
import { Chip } from "../ui/Bits";
import { StatusPill } from "../ui/Status";
import { toast } from "../ui/Toast";
import { isOnline, useProgress } from "../features/progress/shared";

type Result = { id: string; key: string; name: string; script: string; ok: boolean | null; picked: boolean; output: string; at: number };

const SNIPPETS: [string, string][] = [
  ["Who am I", "local p = game.Players.LocalPlayer\nprint(p.Name, p.UserId, game.PlaceId, game.JobId)"],
  ["Position", "local c = game.Players.LocalPlayer.Character\nprint(c and c:GetPivot().Position)"],
  ["Reset character", 'local h = game.Players.LocalPlayer.Character and game.Players.LocalPlayer.Character:FindFirstChildOfClass("Humanoid")\nif h then h.Health = 0 end\nprint("reset")'],
  ["Rejoin server", 'game:GetService("TeleportService"):TeleportToPlaceInstance(game.PlaceId, game.JobId, game.Players.LocalPlayer)\nprint("rejoining")'],
];
const KEY = "mtwin.webScript";

/** Runs Lua in the clients of the accounts picked, through each one's Progress reporter (it polls
 * the server for what to run). Only on the page this PC serves: it carries the token. */
export function RunScript({ open, onClose, token }: { open: boolean; onClose: () => void; token: string }) {
  const s = useProgress().data;
  const online = useMemo(() => (s ? s.accounts.filter((a) => isOnline(a, s)) : []), [s]);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const chosen = picked ?? new Set(online.map((a) => a.key));
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
    const targets = online.filter((a) => chosen.has(a.key)).map((a) => a.key);
    if (!code.trim() || !targets.length) return;
    setBusy(true);
    try {
      const r = await fetch("/api/exec", { method: "POST", headers: { "Content-Type": "application/json", "X-Exec-Token": token }, body: JSON.stringify({ code, targets }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast(`Sent to ${targets.length} client${targets.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast(`Couldn't send it (${(e as Error).message})`, "error");
    } finally {
      setBusy(false);
    }
  };
  const shown = results.filter((r) => r.at >= since);

  return (
    <Dialog open={open} onClose={onClose} title="Run a script" width={880}>
      <div className="web-run">
        <section className="web-run-who">
          <div className="web-run-head">
            <b>Online accounts</b>
            <span className="meta">{chosen.size} picked</span>
          </div>
          <div className="web-run-list scroll">
            {online.map((a) => (
              <Checkbox
                key={a.key}
                checked={chosen.has(a.key)}
                onChange={(on) => {
                  const n = new Set(chosen);
                  if (on) n.add(a.key);
                  else n.delete(a.key);
                  setPicked(n);
                }}
                label={
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{a.displayName || a.name}</span>
                    <span className="block truncate meta">{a.gameName}</span>
                  </span>
                }
              />
            ))}
            {!online.length && <p className="meta">No account is reporting right now.</p>}
          </div>
        </section>
        <section className="web-run-main">
          <div className="flex flex-wrap gap-1.5">
            {SNIPPETS.map(([name, text]) => (
              <Chip key={name} small onClick={() => save(text)}>
                {name}
              </Chip>
            ))}
          </div>
          <textarea
            className="field web-run-code"
            spellCheck={false}
            value={code}
            placeholder={"-- Lua, run in each client's executor\nprint(game.Players.LocalPlayer.Name)"}
            onChange={(e) => save(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void run();
              }
            }}
          />
          <div className="flex items-center gap-2">
            <span className="meta flex-1">Ctrl+Enter runs it. print() shows below.</span>
            <Button variant="ghost" onClick={() => setSince(Date.now())}>
              Clear
            </Button>
            <Button variant="primary" icon="play" busy={busy} disabled={!chosen.size || !code.trim()} onClick={() => void run()}>
              Run on {chosen.size}
            </Button>
          </div>
          <div className="web-run-results scroll">
            {shown.map((r) => (
              <div key={r.id} className="web-run-result">
                <div className="flex items-center gap-2">
                  <b className="truncate">{r.name}</b>
                  <StatusPill tone={r.ok === true ? "ok" : r.ok === false ? "err" : r.picked ? "info" : "neutral"} label={r.ok === true ? "Done" : r.ok === false ? "Error" : r.picked ? "Running" : "Queued"} />
                  <span className="meta ms-auto">{new Date(r.at).toLocaleTimeString()}</span>
                </div>
                {r.output && <pre>{r.output}</pre>}
              </div>
            ))}
            {!shown.length && <p className="meta">Nothing run yet.</p>}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
