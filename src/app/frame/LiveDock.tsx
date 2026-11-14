import { useQuery } from "@tanstack/react-query";
import { api, type AccountSummary, type Instance } from "../../api";
import { useState } from "react";
import { qk, useInstances, usePresence, useSetSettings, useSettings } from "../../data";
import { t } from "../../i18n";
import { Button, IconButton } from "../../ui/Button";
import { Switch } from "../../ui/controls";
import { Icon } from "../../ui/Icon";
import { toast, toastError } from "../../ui/Toast";
import { useStored } from "../../ui/stored";
import { useMedia } from "../../ui/useMedia";
import { accountName, Avatar } from "../../features/accounts/shared";
import { isRunning, STATES, uptime, useNow } from "../../features/launch/Running";
import { launchOne } from "../../features/launch/launchQueue";

/** Every running client, always in view: a column at the window's right edge. Each row shows the
 * account, where it is and for how long, and brings its window up or ends it. It folds to a strip. */
export function LiveDock({ accounts }: { accounts: AccountSummary[] }) {
  const [foldedWide, setFoldedWide] = useStored("mtwin.liveFolded", (v) => v === "1", (v) => (v ? "1" : "0"));
  // A small window folds it to its strip, so the page keeps the room; opening it there lasts until
  // the window is large again.
  const narrow = useMedia("(max-width: 1180px)");
  const [openNarrow, setOpenNarrow] = useState(false);
  const folded = narrow ? !openNarrow : foldedWide;
  const setFolded = (f: boolean) => (narrow ? setOpenNarrow(!f) : setFoldedWide(f));
  const running = (useInstances().data ?? []).filter(isRunning);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const now = useNow(10_000);
  // In a game by Roblox's own account (as Accounts and Home show), with no client here: started
  // outside MTwin Manager, or one it lost track of. Listed so Live and Accounts agree.
  const presence = usePresence(accounts.filter((a) => a.status === "valid").map((a) => a.id)).data;
  const tracked = new Set(running.map((i) => i.accountId));
  const elsewhere = accounts.filter((a) => !tracked.has(a.id) && presence?.get(a.id)?.kind === "inGame");
  const total = running.length + elsewhere.length;
  const settings = useSettings().data;
  const set = useSetSettings({ quiet: true });
  const layout = settings?.windowLayout ?? "off";
  // Tiny: tiled in tiny cells, or (without Auto-tile) each made tiny where it is.
  const tiny = layout === "tiny" || (layout === "off" && !!settings?.tinyOnLaunch);
  // Ticked clients (Kill selected); ones that ended drop out.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const chosen = running.filter((i) => picked.has(i.id));
  const [killing, setKilling] = useState(false);
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const kill = () => {
    if (!chosen.length || killing) return;
    setKilling(true);
    api
      .instancesKill(chosen.map((i) => i.id))
      .then(() => toast(t("accounts.killed", { n: chosen.length })), toastError)
      .finally(() => {
        setKilling(false);
        setPicked(new Set());
      });
  };
  return (
    <aside className="ld" data-folded={folded || undefined} aria-label={t("live.title")}>
      <header className="ld-head">
        {!folded && (
          <>
            <span className="ld-dot" data-on={total > 0 || undefined} aria-hidden="true" />
            <h2 className="ld-title">{t("live.title")}</h2>
            <span className="ld-n">{total}</span>
          </>
        )}
        <IconButton size="sm" icon={folded ? "back" : "chevron"} className="ld-fold" label={t(folded ? "live.open" : "live.fold")} onClick={() => setFolded(!folded)} />
      </header>
      {folded ? (
        <ul className="ld-mini">
          {running.map((i) => {
            const a = byId.get(i.accountId);
            return (
              <li key={i.id} data-tip={a ? accountName(a) : undefined}>
                <button type="button" onClick={() => api.instanceShow(i.id, "focus").catch(toastError)}>
                  {a && <Avatar account={a} size={28} />}
                  <span className="ld-mini-dot" style={{ background: STATES[i.state][1] }} />
                </button>
              </li>
            );
          })}
          {elsewhere.map((a) => (
            <li key={`e${a.id}`} data-tip={`${accountName(a)} · ${t("live.elsewhere")}`}>
              <span className="ld-mini-out">
                <Avatar account={a} size={28} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className="ld-toggles">
            <label className="ld-toggle">
              <span>{t("live.autoTile")}</span>
              <Switch label={t("live.autoTile")} checked={layout !== "off"} onChange={(on) => {
                  // Tiled with Auto-tiny on: the tiny-cell layout; alone: as big as all fit.
                  set.mutate(on ? { windowLayout: tiny ? "tiny" : "fit", tinyOnLaunch: false } : { windowLayout: "off", tinyOnLaunch: tiny });
                  // The clients already running take their cells now, not only the next ones.
                  if (on && running.length) api.instancesTile(tiny).catch(toastError);
                }} />
            </label>
            <label className="ld-toggle" data-tip={t("live.autoTinyHint")}>
              <span>{t("live.autoTiny")}</span>
              <Switch label={t("live.autoTiny")} checked={tiny} onChange={(on) => {
                  if (layout !== "off") {
                    // With Auto-tile: tiny cells, as many as fit (or back to as big as all fit).
                    set.mutate({ windowLayout: on ? "tiny" : "fit", tinyOnLaunch: false });
                    if (running.length) api.instancesTile(on).catch(toastError);
                  } else {
                    set.mutate({ tinyOnLaunch: on });
                    for (const i of running) if (i.micro !== on) api.instanceMicro(i.id, on).catch(() => {});
                  }
                }} />
            </label>
            <label className="ld-toggle">
              <span>{t("live.autoMinimize")}</span>
              <Switch label={t("live.autoMinimize")} checked={!!settings?.minimizeOnLaunch} onChange={(on) => {
                  set.mutate({ minimizeOnLaunch: on });
                  // On: the clients already running go down too, not only the next ones.
                  if (on && running.length) api.instancesShowAll("minimize").catch(toastError);
                }} />
            </label>
          </div>
          <ul className="ld-list">
            {running.map((i) => (
              <Row key={i.id} i={i} a={byId.get(i.accountId)} now={now} picked={picked.has(i.id)} onPick={() => toggle(i.id)} />
            ))}
          </ul>
          {elsewhere.length > 0 && (
            <section className="ld-else">
              <h3 className="ld-sub" data-tip={t("live.elsewhereHint")}>
                {t("live.elsewhere")} <span className="ld-n">{elsewhere.length}</span>
              </h3>
              <ul className="ld-list">
                {elsewhere.map((a) => (
                  <li key={a.id} className="ld-row ld-row-out">
                    <span className="ld-main">
                      <Avatar account={a} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="ld-name">{accountName(a)}</span>
                        <span className="ld-where">{presence?.get(a.id)?.lastLocation || t("home2.inGame")}</span>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {total === 0 && (
            <div className="ld-empty">
              <Icon name="monitor" size={20} />
              <p>{t("live.empty")}</p>
            </div>
          )}
          {running.length > 0 && (
            <footer className="ld-foot">
              {running.length > 1 && (
                <label className="ld-all">
                  <input type="checkbox" className="cb" checked={chosen.length === running.length} ref={(el) => void (el && (el.indeterminate = chosen.length > 0 && chosen.length < running.length))} onChange={() => setPicked(chosen.length === running.length ? new Set() : new Set(running.map((i) => i.id)))} />
                  {t("live.pickAll")}
                </label>
              )}
              <Button size="md" variant="danger" icon="stop" block busy={killing} disabled={!chosen.length} onClick={kill}>
                {chosen.length ? t("app.killSelectedN", { n: chosen.length }) : t("accounts.killSelected")}
              </Button>
            </footer>
          )}
        </>
      )}
    </aside>
  );
}

function Row({ i, a, now, picked, onPick }: { i: Instance; a: AccountSummary | undefined; now: number; picked: boolean; onPick: () => void }) {
  const game = useQuery({ queryKey: qk.game(i.placeId), queryFn: () => api.gameInfo(i.placeId!), enabled: i.placeId !== null }).data;
  const [label, color] = STATES[i.state];
  return (
    <li className="ld-row" data-picked={picked || undefined}>
      <input type="checkbox" className="cb ld-cb" checked={picked} onChange={onPick} aria-label={t("app.pickClient", { name: a ? accountName(a) : String(i.accountId) })} />
      <button type="button" className="ld-main" onClick={() => api.instanceShow(i.id, "focus").catch(toastError)} data-tip={t("home.show")}>
        {a ? <Avatar account={a} size={32} /> : <span className="ld-noav" />}
        <span className="min-w-0 flex-1">
          <span className="ld-name">{a ? accountName(a) : t("dashboard.account", { id: i.accountId })}</span>
          <span className="ld-where">
            <span className="ld-state" style={{ color }}>{label}</span>
            {game?.name && <> · {game.name}</>}
          </span>
        </span>
        <span className="ld-time">{uptime(i.startedAt, now)}</span>
      </button>
      {/* Disconnected: back into the same place in one click (its client closes first). */}
      {i.state === "disconnected" && a && (
        <IconButton size="sm" icon="refresh" className="ld-rejoin" label={t("live.rejoin")} onClick={() => void launchOne(a, i.target, i.fpsCap, i.id)} />
      )}
      <IconButton size="sm" icon="x" className="ld-kill" label={t("live.end")} onClick={() => api.instancesKill([i.id]).catch(toastError)} />
    </li>
  );
}
