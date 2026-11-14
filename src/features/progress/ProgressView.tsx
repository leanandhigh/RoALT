import "./progress.css";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, type AccountSummary, type ProgressState } from "../../api";
import { qk } from "../../data";
import { fmtNum, t, type Key } from "../../i18n";
import { Chip } from "../../ui/Bits";
import { Button, IconButton } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Field, Input, Select } from "../../ui/Field";
import { Switch } from "../../ui/controls";
import { Icon } from "../../ui/Icon";
import { StatusPill } from "../../ui/Status";
import { LoadFailed, toast, toastError } from "../../ui/Toast";
import { useStored } from "../../ui/stored";
import { DocsDialog } from "./DocsDialog";
import { GamePage } from "./GamePage";
import { Decal, isOnline, PORT_HOST, useProgress } from "./shared";

/** The game open in Progress, kept while MTwin Manager runs. */
let lastGame: string | null = null;

type GameCard = { id: string; name: string; iconUrl: string | null; playing: number | null; mine: number; online: number; supported: boolean };
type GameFilter = "all" | "supported" | "custom" | "favorites" | "running";
type GameSort = "online" | "mine" | "playing" | "name";

const list = (s: string | null) => {
  try {
    const v = JSON.parse(s ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

/** Progress: what each alt has in game, sent by a script the executor runs in each client. */
/** On the Progress website (`src/web`): the same page, without the button that shares it. */
const inWeb = () => !!(window as { __MTWIN_WEB__?: boolean }).__MTWIN_WEB__;

export function ProgressView({ accounts }: { accounts: AccountSummary[] }) {
  const q = useProgress();
  const [game, setGameState] = useState<string | null>(lastGame);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [webOpen, setWebOpen] = useState(false);
  const setGame = (g: string | null) => {
    lastGame = g;
    setGameState(g);
  };
  const s = q.data;

  if (q.isError && !s) return <LoadFailed error={q.error} busy={q.isFetching} onRetry={() => void q.refetch()} />;

  return (
    <main className="scroll flex-1 min-w-0 page">
      <div className="pg-page">
        <header className="pg-head">
          <div className="min-w-0">
            <h1 className="page-title">{t("app.nav.progress")}</h1>
            <p className="page-sub">{t("progress.sub")}</p>
          </div>
          <div className="pg-head-tools">
            {!inWeb() && (
              <Button size="md" variant="ghost" icon="globe" onClick={() => setWebOpen(true)}>
                {t("progress.web")}
              </Button>
            )}
            <Button size="md" variant="ghost" icon="info" onClick={() => setDocsOpen(true)}>
              {t("progress.docs")}
            </Button>
            <Button size="md" variant="primary" icon="copy" onClick={() => setScriptOpen(true)}>
              {t("progress.getScript")}
            </Button>
          </div>
        </header>
        {s && game === null && <StatusStrip s={s} />}
        {!s ? null : game === null ? (
          <GameList s={s} onOpen={setGame} onScript={() => setScriptOpen(true)} />
        ) : (
          <GamePage s={s} gameId={game} accounts={accounts} onBack={() => setGame(null)} />
        )}
      </div>
      <ScriptDialog open={scriptOpen} onClose={() => setScriptOpen(false)} host={PORT_HOST(s)} />
      <DocsDialog open={docsOpen} onClose={() => setDocsOpen(false)} host={PORT_HOST(s)} />
      <WebsiteDialog open={webOpen} onClose={() => setWebOpen(false)} />
    </main>
  );
}

/** The progress website: open it here, or share it on the network for a phone or another PC. */
function WebsiteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const web = useQuery({ queryKey: ["progressWeb"], queryFn: api.progressWeb, enabled: open, refetchInterval: open ? 3000 : false }).data;
  const [busy, setBusy] = useState(false);
  const local = web?.localUrl ?? "http://127.0.0.1:16390/";
  const set = (share: boolean, newKey = false) => {
    setBusy(true);
    api
      .progressWebSet(share, newKey)
      .then((w) => {
        qc.setQueryData(["progressWeb"], w);
        if (newKey) toast(t("progress.webNewKeyDone"));
      }, toastError)
      .finally(() => setBusy(false));
  };
  const copy = (url: string) => writeText(url).then(() => toast(t("progress.webCopied")), toastError);
  return (
    <Dialog open={open} onClose={onClose} title={t("progress.web")} width={560}>
      <div className="pg-web dlg-body">
        <p className="text-fg-2">{t("progress.webIntro")}</p>
        <div className="pg-web-row">
          <div className="min-w-0 flex-1">
            <b>{t("progress.webHere")}</b>
            <code className="pg-web-url">{local}</code>
          </div>
          <Button size="md" variant="primary" icon="external" onClick={() => openUrl(local).catch(toastError)}>
            {t("progress.webOpen")}
          </Button>
        </div>
        <div className="pg-web-row">
          <div className="min-w-0 flex-1">
            <b>{t("progress.webShare")}</b>
            <span className="pg-web-hint">{t("progress.webShareHint")}</span>
          </div>
          <Switch label={t("progress.webShare")} checked={!!web?.share} disabled={busy || !web} onChange={(on) => set(on)} />
        </div>
        {web?.share && (
          <div className="pg-web-share">
            {web.error ? (
              <p className="pg-web-err">{t("progress.webError", { error: web.error })}</p>
            ) : web.lanUrl ? (
              <>
                <code className="pg-web-url">{web.lanUrl}</code>
                <div className="pg-web-acts">
                  <Button size="sm" icon="copy" onClick={() => void copy(web.lanUrl!)}>
                    {t("progress.webCopy")}
                  </Button>
                  <Button size="sm" variant="ghost" icon="refresh" busy={busy} onClick={() => set(true, true)}>
                    {t("progress.webNewKey")}
                  </Button>
                </div>
                <p className="pg-web-hint">{t("progress.webFirewall")}</p>
              </>
            ) : (
              <p className="pg-web-err">{t("progress.webNoNetwork")}</p>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function ServerPill({ s }: { s: ProgressState }) {
  if (s.server.running) return <StatusPill tone="ok" label={t("progress.listening")} detail={PORT_HOST(s)} />;
  if (s.server.error) return <span title={s.server.error}><StatusPill tone="err" label={t("progress.notListening", { port: s.server.port })} /></span>;
  return <StatusPill tone="info" pulse label={t("progress.starting")} />;
}

/** The reporter, the accounts reporting, and when offline ones are removed: one strip. */
function StatusStrip({ s }: { s: ProgressState }) {
  const online = s.accounts.filter((a) => isOnline(a, s)).length;
  return (
    <div className="pg-strip panel">
      <div className="pg-strip-cell">
        <span className="pg-strip-k">{t("progress.reporter")}</span>
        <ServerPill s={s} />
      </div>
      <div className="pg-strip-cell">
        <span className="pg-strip-k">{t("progress.accountsK")}</span>
        <span className="pg-strip-v">
          <b data-on={online > 0 || undefined}>{fmtNum(online)}</b> {t("progress.onlineWord")} <span className="text-fg-3">· {t("progress.reportingN", { n: fmtNum(s.accounts.length) })}</span>
        </span>
      </div>
      <div className="pg-strip-cell">
        <span className="pg-strip-k">{t("progress.autoDelete")}</span>
        <AutoDelete hours={s.autoDeleteHours} />
      </div>
    </div>
  );
}

const AUTO_DELETE = [0, 1, 6, 24, 72, 168];
function AutoDelete({ hours }: { hours: number }) {
  const label = (h: number) => (h === 0 ? t("progress.autoDeleteNever") : h < 24 ? t("progress.autoDeleteHours", { n: h }) : t("progress.autoDeleteDays", { n: h / 24 }));
  const options = [...new Set([...AUTO_DELETE, hours])].sort((a, b) => a - b).map((h) => ({ value: String(h), label: label(h) }));
  return (
    <Select
      value={String(hours)}
      options={options}
      aria-label={t("progress.autoDelete")}
      onChange={(v) => api.progressAutoDelete(Number(v)).then(() => toast(t("progress.saved")), toastError)}
    />
  );
}

/** The loader for an executor's autoexec folder: waits for the game, then loads the reporter from MTwin Manager until it runs. */
function loader(pc: string, host: string) {
  const name = pc.replace(/["\\\n\r]/g, "") || "PC1";
  return `repeat task.wait() until game:IsLoaded()

getgenv().ProgressConfig = {
    ["PC_NAME"] = "${name}",
}

while not getgenv().ProgressViewerLoaded do
    pcall(function() loadstring(game:HttpGet("http://${host}/script.luau"))() end)
    task.wait(3)
end`;
}

function ScriptDialog({ open, onClose, host }: { open: boolean; onClose: () => void; host: string }) {
  const [pc, setPc] = useStored("mtwin.progressPc", (s) => s ?? "PC1", (v) => v);
  const [copied, setCopied] = useState(false);
  const code = loader(pc, host);
  const copy = () =>
    writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }, toastError);
  return (
    <Dialog open={open} onClose={onClose} title={t("progress.getScript")} width={620}>
      <div className="dlg-body flex flex-col gap-4">
        <p className="text-fg-2">{t("progress.scriptLead")}</p>
        <Field label={t("progress.pcName")} hint={t("progress.pcNameHint")}>
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={pc} maxLength={60} onChange={(e) => setPc(e.target.value)} />}
        </Field>
        <pre className="pg-code" dir="ltr">{code}</pre>
        <p className="meta">{t("progress.scriptHint")}</p>
      </div>
      <div className="dlg-foot">
        <Button size="md" variant="ghost" onClick={onClose}>{t("common.close")}</Button>
        <Button size="md" variant="primary" icon={copied ? "check" : "copy"} onClick={copy}>
          {t(copied ? "progress.copied" : "progress.copyScript")}
        </Button>
      </div>
    </Dialog>
  );
}

function GameList({ s, onOpen, onScript }: { s: ProgressState; onOpen: (id: string) => void; onScript: () => void }) {
  const [favs, setFavs] = useStored("mtwin.progressFavourites", list, JSON.stringify);
  const [filter, setFilter] = useState<GameFilter>("all");
  const [sort, setSort] = useStored<GameSort>("mtwin.progressGameSort", (v) => (v === "mine" || v === "playing" || v === "name" ? v : "online"), (v) => v);
  const [search, setSearch] = useState("");

  const [adding, setAdding] = useState(false);
  const ids = useMemo(() => [...new Set([...s.games, ...s.accounts.map((a) => a.gameId)])], [s.games, s.accounts]);
  const numeric = ids.filter((id) => /^\d+$/.test(id)).sort();
  const meta = useQuery({
    queryKey: qk.progressGames(numeric.join(",")),
    queryFn: () => api.progressGames(numeric.map(Number)),
    staleTime: 60_000,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  }).data;

  const games: GameCard[] = ids.map((id) => {
    const m = meta?.find((g) => String(g.universeId) === id);
    const mine = s.accounts.filter((a) => a.gameId === id);
    return {
      id,
      name: m?.name || mine[0]?.gameName || t("progress.gameId", { id }),
      iconUrl: m?.iconUrl ?? null,
      playing: m ? m.playing : null,
      mine: mine.length,
      online: mine.filter((a) => isOnline(a, s)).length,
      // Set up here: its own script, or a catalog of what to read. Else only "Every game" reads it.
      supported: !!s.collectors[id]?.trim() || (s.catalog[id]?.length ?? 0) > 0,
    };
  });
  const fav = new Set(favs);
  const needle = search.trim().toLowerCase();
  const match = (g: GameCard) => !needle || g.name.toLowerCase().includes(needle);
  const added = new Set(s.games);
  const used = games.filter((g) => g.mine > 0 || fav.has(g.id) || added.has(g.id));
  const pick: Record<GameFilter, (g: GameCard) => boolean> = {
    all: () => true,
    supported: (g) => g.supported,
    custom: (g) => !g.supported,
    favorites: (g) => fav.has(g.id),
    running: (g) => g.online > 0,
  };
  const pool = (f: GameFilter) => (f === "favorites" || f === "running" ? games : used).filter(pick[f]);
  const counts = Object.fromEntries((Object.keys(pick) as GameFilter[]).map((f) => [f, pool(f).length])) as Record<GameFilter, number>;
  const shown = pool(filter).filter(match);
  const by: Record<GameSort, (a: GameCard, b: GameCard) => number> = {
    online: (a, b) => b.online - a.online || b.mine - a.mine,
    mine: (a, b) => b.mine - a.mine,
    playing: (a, b) => (b.playing ?? -1) - (a.playing ?? -1),
    name: () => 0,
  };
  shown.sort((a, b) => by[sort](a, b) || a.name.localeCompare(b.name));
  const toggleFav = (id: string) => setFavs(fav.has(id) ? favs.filter((f) => f !== id) : [...favs, id]);

  const filters: { id: GameFilter; label: Key; icon: "grid" | "star" | "play" | "check" | "terminal"; tip?: Key }[] = [
    { id: "all", label: "progress.all", icon: "grid" },
    { id: "supported", label: "progress.supported", icon: "check", tip: "progress.supportedTip" },
    { id: "custom", label: "progress.custom", icon: "terminal", tip: "progress.customTip" },
    { id: "favorites", label: "progress.favourites", icon: "star" },
    { id: "running", label: "progress.running", icon: "play" },
  ];

  return (
    <section aria-label={t("progress.games")}>
      <h2 className="section-title pg-section">{t("progress.games")}</h2>
      <div className="pg-bar">
        <div className="pg-chips" role="group" aria-label={t("progress.filter")}>
          {filters.map((f) => (
            <span key={f.id} data-tip={f.tip ? t(f.tip) : undefined} className="contents">
              <Chip pressed={filter === f.id} count={counts[f.id]} onClick={() => setFilter(f.id)}>
                <Icon name={f.icon} size={13} />
                {t(f.label)}
              </Chip>
            </span>
          ))}
        </div>
        <div className="pg-bar-tools">
          <Input leading="search" className="pg-search" value={search} placeholder={t("progress.searchGames")} aria-label={t("progress.searchGames")} onChange={(e) => setSearch(e.target.value)} />
          <Select<GameSort>
            value={sort}
            onChange={setSort}
            aria-label={t("progress.sortBy")}
            options={[
              { value: "online", label: t("progress.sortOnline") },
              { value: "mine", label: t("progress.statAccounts") },
              { value: "playing", label: t("progress.statPlayers") },
              { value: "name", label: t("progress.name") },
            ]}
          />
          <Button size="md" icon="plus" onClick={() => setAdding(true)}>{t("progress.addGame")}</Button>
        </div>
      </div>

      {shown.length ? (
        <div className="pg-games">
          {shown.map((g) => (
            <div key={g.id} className="pg-game panel" data-running={g.online > 0 || undefined}>
              <button type="button" className="pg-game-open" onClick={() => onOpen(g.id)}>
                <span className="pg-game-top">
                  <Decal url={g.iconUrl ?? undefined} name={g.name} size={48} />
                  <span className="min-w-0 flex flex-col gap-1.5">
                    <span className="pg-game-name">{g.name}</span>
                    <span className="pg-kind" data-supported={g.supported || undefined}>
                      {t(g.supported ? "progress.supported" : "progress.custom")}
                    </span>
                  </span>
                </span>
                <span className="pg-game-stats">
                  <span><b data-on={g.online > 0 || undefined}>{g.online ? fmtNum(g.online) : "—"}</b>{t("progress.statOnline")}</span>
                  <span><b>{g.mine ? fmtNum(g.mine) : "—"}</b>{t("progress.statAccounts")}</span>
                  <span><b>{g.playing !== null ? fmtNum(g.playing) : "—"}</b>{t("progress.statPlayers")}</span>
                </span>
              </button>
              <IconButton size="sm" icon="star" className="pg-fav" pressed={fav.has(g.id)} label={t(fav.has(g.id) ? "progress.unfavourite" : "progress.favourite")} onClick={() => toggleFav(g.id)} />
            </div>
          ))}
        </div>
      ) : (
        <div className="pg-empty panel">
          <Icon name="progress" size={22} />
          <h3 className="section-title">{t(s.accounts.length ? "progress.noGamesMatch" : "progress.emptyTitle")}</h3>
          {!s.accounts.length && <p className="text-fg-2">{t("progress.emptyBody")}</p>}
          {!s.accounts.length && (
            <Button size="md" variant="primary" icon="copy" onClick={onScript}>
              {t("progress.getScript")}
            </Button>
          )}
        </div>
      )}

      <AddGameDialog open={adding} onClose={() => setAdding(false)} onAdded={onOpen} />
    </section>
  );
}

/** A game by its link or id, so its Catalog can be set up before any account plays it. */
function AddGameDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (id: string) => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const add = () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    api
      .progressGameAdd(text)
      .then((id) => {
        if (!id) return setBad(true);
        setText("");
        onClose();
        void qc.invalidateQueries({ queryKey: qk.progress });
        onAdded(id);
      }, toastError)
      .finally(() => setBusy(false));
  };
  return (
    <Dialog open={open} onClose={onClose} title={t("progress.addGame")} width={520}>
      <form onSubmit={(e) => { e.preventDefault(); add(); }}>
        <div className="dlg-body">
          <Field label={t("progress.addGameLabel")} hint={t("progress.addGameHint")} error={bad ? t("progress.addGameBad") : undefined}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} aria-describedby={describedBy} invalid={invalid} value={text} placeholder="https://www.roblox.com/games/142823291/…" onChange={(e) => { setText(e.target.value); setBad(false); }} />
            )}
          </Field>
        </div>
        <div className="dlg-foot">
          <Button size="md" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button size="md" variant="primary" type="submit" busy={busy} disabled={!text.trim()}>{t("progress.addGame")}</Button>
        </div>
      </form>
    </Dialog>
  );
}
