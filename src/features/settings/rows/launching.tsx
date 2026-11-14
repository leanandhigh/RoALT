import { useEffect, useId, useState } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, asError, events, type InstallProgress, type RobloxClient } from "../../../api";
import { qk, useAccounts, useMultiStatus, useSettings, useUpdateAccount } from "../../../data";
import { fmtDate, t } from "../../../i18n";
import { Skeleton } from "../../../ui/Bits";
import { Button } from "../../../ui/Button";
import { NumberField, OffOrNumberField, Segmented, Switch, TextField } from "../../../ui/controls";
import { RANGES } from "../../../ui/ranges";
import { useSameServer } from "../../launch/batchPrefs";
import { accountName, Avatar } from "../../accounts/shared";
import { FlagsDialog } from "../../performance/FlagsDialog";
import type { AccountSummary } from "../../../api";
import { useSessionFps } from "../../launch/launchQueue";
import { Checkbox, Field, Select } from "../../../ui/Field";
import { Meter } from "../../../ui/Meter";
import { Morph, Swap } from "../../../ui/motion";
import { Popover, useAnchor } from "../../../ui/Popover";
import { StatusPill, type Tone } from "../../../ui/Status";
import { friendly, toast } from "../../../ui/Toast";
import { MultiNotice, useMultiToggle } from "../../launch/MultiNotice";
import { ExecutorStatus, useExecutors } from "../../updates/ExecutorCard";
import { useNow } from "../../launch/Running";
import { useRow } from "../kit/rowError";
import { SettingRow } from "../kit/SettingRow";

/** Multi-instance goes through its own command; the first time on, Roblox's stance is shown first.
 * While it is on but held up, the notice under the row has the way out. */
function MultiSwitch() {
  const { ctx, describedBy, setError } = useRow();
  const multi = useMultiStatus().data;
  // A failed switch is told at the row, as every other write here.
  const { toggle, dialog } = useMultiToggle(() => setError(null), (e) => setError(friendly(asError(e))));
  return (
    <>
      <Switch label={t("settings.multi")} checked={multi?.enabled ?? ctx.s.multiInstance} onChange={toggle} describedBy={describedBy} />
      {dialog}
    </>
  );
}

/** "[3] tries in [10] min": the crash breaker's two numbers. */
function BreakerFields() {
  const { entry, ctx, write, setError, describedBy } = useRow();
  return (
    <span className="flex flex-wrap items-center gap-3">
      <NumberField
        name={`${t(entry.label)}, ${t("settings.unit.relaunches")}`}
        unit={t("settings.unit.relaunches")}
        short={t("settings.unit.tries")}
        min={1}
        max={20}
        value={ctx.s.breakerMax}
        onCommit={(breakerMax) => void write({ breakerMax })}
        onInvalid={setError}
        describedBy={describedBy}
      />
      <NumberField
        label={t("settings.breakerIn")}
        unit={t("settings.unit.minutes")}
        short={t("settings.unit.min")}
        min={1}
        max={240}
        value={ctx.s.breakerWindowMin}
        onCommit={(breakerWindowMin) => void write({ breakerWindowMin })}
        onInvalid={setError}
        describedBy={describedBy}
      />
    </span>
  );
}

const SHUTDOWN_PRESETS = [30, 60, 120, 240, 480];
const clock = (ms: number) => fmtDate(ms, { hour: "2-digit", minute: "2-digit" });

/** "1 h 05 min" style, for what is left. */
function duration(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? t("settings.durHours", { h, m: pad(m) }) : m ? t("settings.durMinutes", { m, s: pad(s) }) : t("settings.durSeconds", { s });
}

/** The next time the clock shows `hhmm` ("21:30"), as Unix ms. */
function nextAt(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const at = new Date();
  at.setHours(h, m, 0, 0);
  if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
  return at.getTime();
}

/** Ticks each second, digits only (no tween). */
function Countdown({ at }: { at: number }) {
  const now = useNow(1000);
  return (
    <span className="mono text-[13px]" role="timer">
      {t("settings.shutdownIn", { left: duration(Math.max(0, (at - now) / 1000)), time: clock(at) })}
    </span>
  );
}

/** Windows' own shutdown timer: Schedule… (a preset or a time, closing the clients first or not),
 * then a countdown and Cancel. "Close clients first" is a choice for this timer only: not saved. */
function ShutdownControls({ status, closeClients, setCloseClients }: {
  status: UseQueryResult<number | null>;
  closeClients: boolean;
  setCloseClients: (v: boolean) => void;
}) {
  const row = useRow();
  const qc = useQueryClient();
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const anchor = useAnchor();
  const pop = useId();
  const run = (p: Promise<number | null>, done: (at: number | null) => string) => {
    setBusy(true);
    row.setError(null);
    p.then(
      (at) => {
        qc.setQueryData(qk.shutdown, at);
        toast(done(at));
      },
      row.fail,
    ).finally(() => {
      // Closed either way: a refusal shows at the row, which the popover would cover.
      document.getElementById(pop)?.hidePopover();
      setBusy(false);
      // Refused too: the button that had the focus was disabled meanwhile, or swapped out.
      row.refocus(qc.getQueryData(qk.shutdown) == null ? "[popovertarget]" : "[data-cancel]");
    });
  };
  const schedule = (when: { atMs?: number; inSecs?: number }) => run(api.shutdownSchedule(when, closeClients), (at) => t("settings.shutdownAt", { time: clock(at ?? 0) }));

  if (status.isError) return <Button size="md" onClick={() => void status.refetch()}>{t("common.tryAgain")}</Button>;
  if (status.data === undefined) return <Skeleton width={104} height={34} radius={999} />;
  const at = status.data;
  return (
    <Morph innerClassName="gap-3">
      <Swap k={at === null ? "idle" : "set"}>
        {at === null ? (
          <>
            <Button size="md" popoverTarget={pop} style={anchor.style} aria-haspopup="dialog" aria-expanded={open} disabled={busy}>
              {t("settings.shutdownSchedule")}
            </Button>
            <Popover id={pop} anchor={anchor.name} placement="below-end" role="dialog" label={t("settings.shutdown")} onToggle={(on) => {
                setOpen(on);
                // Into the dialog, on its first preset.
                if (on) requestAnimationFrame(() => document.getElementById(pop)?.querySelector<HTMLElement>("button:not(:disabled)")?.focus());
              }} className="w-[296px]">
              <div className="flex flex-col gap-4 p-2.5">
                <div className="flex flex-wrap gap-1.5">
                  {SHUTDOWN_PRESETS.map((m) => (
                    <Button key={m} size="sm" className="mono" disabled={busy} onClick={() => schedule({ inSecs: m * 60 })}>
                      {m < 60 ? t("settings.minutesShort", { n: m }) : t("settings.hoursShort", { n: m / 60 })}
                    </Button>
                  ))}
                </div>
                <Field label={t("settings.shutdownAtLabel")}>
                  {({ id }) => (
                    <span className="flex items-center gap-2">
                      <input id={id} className="field mono flex-1 min-w-0" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                      <Button size="sm" disabled={busy || !time} onClick={() => schedule({ atMs: nextAt(time) })}>
                        {t("settings.atThisTime")}
                      </Button>
                    </span>
                  )}
                </Field>
                <Checkbox checked={closeClients} onChange={setCloseClients} label={t("settings.closeClientsFirst")} />
              </div>
            </Popover>
          </>
        ) : (
          <>
            <Countdown at={at} />
            <Button size="md" busy={busy} disabled={busy} data-cancel onClick={() => run(api.shutdownCancel(), () => t("settings.shutdownOff"))}>
              {t("common.cancel")}
            </Button>
          </>
        )}
      </Swap>
    </Morph>
  );
}

export function ShutdownRow() {
  const [closeClients, setCloseClients] = useState(true);
  const status = useQuery({ queryKey: qk.shutdown, queryFn: api.shutdownStatus, staleTime: 0 });
  return (
    <SettingRow
      id="shutdown"
      detail={status.isError && <span className="alert">{friendly(asError(status.error))}</span>}
      more={<p>{t(closeClients ? "settings.shutdownHintClose" : "settings.shutdownHint")}</p>}
    >
      <ShutdownControls status={status} closeClients={closeClients} setCloseClients={setCloseClients} />
    </SettingRow>
  );
}

const ROBLOX_DOWNLOAD = "https://www.roblox.com/download";

function pill(c: RobloxClient): [Tone, string] {
  if (!c.path) return ["attention", t("settings.clientNotInstalled")];
  if (c.bootstrapper) return ["info", t("settings.clientBootstrapper")];
  return c.outdated ? ["attention", t("settings.clientOutdatedBadge")] : ["ok", t("settings.clientDetected")];
}

/** The installed version against Roblox's latest; none for a bootstrapper, which updates itself. */
function version(c: RobloxClient) {
  if (!c.path || c.bootstrapper) return null;
  if (c.outdated && c.latest) return t("settings.clientOutdated", { version: c.version ?? t("settings.versionUnknown"), latest: c.latest });
  return c.latest && c.version === c.latest ? t("settings.clientLatest", { version: c.version }) : (c.version ?? t("settings.versionUnknown"));
}

function installStep(p: InstallProgress | null) {
  switch (p?.stage) {
    case "downloading":
      return t("settings.installDownloading", { percent: p.percent });
    case "verifying":
      return t("settings.installVerifying");
    case "installing":
      return t("settings.installRunning");
    default:
      return null;
  }
}

/** Install, Update or Reinstall Roblox: a filling bar while it downloads, a running one while it is
 * checked and installed. A failure says why and offers roblox.com/download instead. */
function Install({ client }: { client: RobloxClient }) {
  const row = useRow();
  const qc = useQueryClient();
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const un = events.onRobloxInstall(setProgress);
    return () => void un.then((f) => f());
  }, []);
  const step = installStep(progress);

  async function install() {
    setBusy(true);
    setFailed(false);
    row.setError(null);
    row.setResult(null);
    try {
      const c = await api.robloxInstall();
      qc.setQueryData(qk.client, c);
      row.setResult(c.version ? t("settings.robloxInstalledVersion", { version: c.version }) : t("settings.robloxInstalled"));
    } catch (e) {
      setFailed(true);
      row.fail(e);
    } finally {
      setBusy(false);
      row.refocus();
    }
  }

  return (
    <Morph innerClassName="gap-2">
      <Swap k={step ? "busy" : "idle"}>
        {step ? (
          <span role="status" className="flex items-center gap-3 text-[13px] text-fg-2">
            {progress?.stage === "downloading" ? <Meter value={progress.percent} label={t("settings.installDownloadingStage")} className="w-28" /> : <span aria-hidden="true" className="live-bar w-28" />}
            {/* Heard once per stage; the meter carries the percent. */}
            <span aria-hidden="true">{step}</span>
            <span className="sr-only">{progress?.stage === "downloading" ? t("settings.installDownloadingStage") : step}</span>
          </span>
        ) : (
          <>
            {failed && (
              <Button size="md" variant="ghost" iconEnd="external" onClick={() => openUrl(ROBLOX_DOWNLOAD).catch(row.fail)}>
                roblox.com/download
              </Button>
            )}
            <Button size="md" variant={client.path ? "secondary" : "primary"} disabled={busy} aria-describedby={row.describedBy} onClick={() => void install()}>
              {!client.path ? t("settings.installRoblox") : client.outdated ? t("settings.updateRoblox") : t("settings.reinstallRoblox")}
            </Button>
          </>
        )}
      </Swap>
    </Morph>
  );
}

/** The client MTwin Manager starts: what it is (pill and version, under the group's "Roblox client"
 * heading), where it is, and Install or Update (never over a bootstrapper, as the pill says). */
export function ClientCard() {
  // Asked again each time: Roblox may have been installed meanwhile.
  const client = useQuery({ queryKey: qk.client, queryFn: api.robloxClient, staleTime: 0 });
  const c = client.data;
  const [tone, word] = c ? pill(c) : (["neutral", ""] as const);
  const v = c && version(c);
  return (
    <SettingRow
      id="client"
      title={
        c ? (
          <Swap k={word}>
            <StatusPill tone={tone} label={word} />
          </Swap>
        ) : client.isError ? undefined : (
          <Skeleton width={112} height={22} radius={999} />
        )
      }
      detail={
        client.isError ? (
          <span className="alert">{friendly(asError(client.error))}</span>
        ) : c?.path ? (
          <>
            {v && <span className="mono block truncate text-fg-2">{v}</span>}
            <span className="mono block truncate selectable" title={c.path}>{c.path}</span>
          </>
        ) : (
          c && t("settings.robloxMissing")
        )
      }
    >
      {client.isError ? <Button size="md" onClick={() => void client.refetch()}>{t("common.tryAgain")}</Button> : c && !c.bootstrapper && <Install client={c} />}
    </SettingRow>
  );
}

export function MultiRow() {
  return (
    <SettingRow id="multi" below={<MultiNotice wanted={false} className="mt-3" />}>
      <MultiSwitch />
    </SettingRow>
  );
}

const AUTO = "";
const OTHER = "\u0000other";

/** "Launch with": Automatic (whatever opens roblox-player links), a bootstrapper found installed
 * (Bloxstrap, Fishstrap, ExploitStrap...), or any .exe pasted under Other. */
function ClientPathControl() {
  const qc = useQueryClient();
  const { entry, ctx, write, describedBy } = useRow();
  const found = useQuery({ queryKey: ["bootstrappers"], queryFn: api.clientBootstrappers, staleTime: 0 }).data ?? [];
  const current = ctx.s.clientPath;
  const known = found.some((b) => b.path.toLowerCase() === current.toLowerCase());
  const [other, setOther] = useState(!!current && !known);
  useEffect(() => {
    if (current && found.length && !known) setOther(true);
  }, [current, known, found.length]);
  const save = (clientPath: string) => write({ clientPath }).then(() => qc.invalidateQueries({ queryKey: qk.client }));
  const value = other ? OTHER : known ? found.find((b) => b.path.toLowerCase() === current.toLowerCase())!.path : AUTO;
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      <Select
        value={value}
        aria-label={t(entry.label)}
        aria-describedby={describedBy}
        className="min-w-[220px]"
        options={[
          { value: AUTO, label: t("settings.clientPathAuto") },
          ...found.map((b) => ({ value: b.path, label: b.name })),
          { value: OTHER, label: t("settings.clientPathOther") },
        ]}
        onChange={(v) => {
          if (v === OTHER) return setOther(true);
          setOther(false);
          void save(v);
        }}
      />
      {other && (
        <TextField
          label={t("settings.clientPathOther")}
          value={known ? "" : current}
          placeholder="C:\\…\\Fishstrap.exe"
          className="w-[300px]"
          describedBy={describedBy}
          onCommit={(text) => save(text)}
        />
      )}
    </span>
  );
}

/** The executor in use, from WEAO's list: Roblox is kept at the build it supports. */
function ExecutorControl() {
  const qc = useQueryClient();
  const { entry, ctx, write, describedBy } = useRow();
  const list = useExecutors();
  const found = list.data ?? [];
  const chosen = ctx.s.executor;
  const options = [
    { value: "", label: t("executor.none") },
    ...found.map((e) => ({ value: e.title, label: `${e.title}${e.updated ? "" : ` · ${t("executor.notUpdated")}`}` })),
    // Still chosen though WEAO doesn't list it now.
    ...(chosen && !found.some((e) => e.title === chosen) ? [{ value: chosen, label: chosen }] : []),
  ];
  return (
    <Select
      value={chosen}
      aria-label={t(entry.label)}
      aria-describedby={describedBy}
      className="min-w-[220px]"
      options={options}
      onChange={(executor) => void write({ executor }).then(() => setTimeout(() => void qc.invalidateQueries({ queryKey: qk.client }), 1500))}
    />
  );
}

function ExecutorDetail() {
  const { ctx } = useRow();
  const e = (useExecutors().data ?? []).find((x) => x.title === ctx.s.executor);
  const client = useQuery({ queryKey: qk.client, queryFn: api.robloxClient, staleTime: 0 }).data;
  if (!ctx.s.executor) return null;
  if (!e) return <p className="meta mt-2">{t("executor.unlisted")}</p>;
  return (
    <div className="ex-box">
      <ExecutorStatus e={e} live={null} installed={client?.version ?? null} />
    </div>
  );
}

export function ExecutorRow() {
  return (
    <SettingRow id="executor" below={<ExecutorDetail />}>
      <ExecutorControl />
    </SettingRow>
  );
}

export function ClientPathRow() {
  return (
    <SettingRow id="clientPath">
      <ClientPathControl />
    </SettingRow>
  );
}

export function BreakerRow() {
  return (
    <SettingRow id="breaker">
      <BreakerFields />
    </SettingRow>
  );
}

/** The FPS cap for launches from the Play page (until MTwin Manager restarts): replaces each account's
 * own cap and the default from Performance. */
export function PlayFpsRow() {
  const [fps, setFps] = useSessionFps();
  return (
    <SettingRow id="playFps">
      <OffOrNumberField label={t("settings.playFps")} value={fps} range={RANGES.fpsCap} unit="FPS" short="FPS" onCommit={setFps} />
    </SettingRow>
  );
}

/** How a Play launch of several accounts picks servers: any, one shared, or each its own. */
export function SameServerRow() {
  const [mode, setMode] = useSameServer();
  const together = mode === "pickFirst" || mode === "followFirst";
  const kind = mode === "off" ? "off" : together ? "same" : "different";
  return (
    <SettingRow
      id="sameServer"
      below={
        kind === "same" ? (
          <div className="pt-2.5">
            <Segmented label={t("launch.findServer")} value={mode} options={[{ value: "pickFirst", label: t("launch.pickServer") }, { value: "followFirst", label: t("launch.followFirst") }]} onChange={setMode} />
          </div>
        ) : kind === "different" ? (
          <div className="pt-2.5">
            <Segmented
              label={t("launch.findServer")}
              value={mode}
              options={[
                { value: "ownPrivate", label: t("launch.spreadOwn") },
                { value: "randomPublic", label: t("launch.spreadRandom") },
                { value: "closest", label: t("launch.spreadClosest") },
                { value: "mostFull", label: t("servers.orderMostFull") },
                { value: "mostEmpty", label: t("servers.orderMostEmpty") },
              ]}
              onChange={setMode}
            />
          </div>
        ) : undefined
      }
    >
      <Segmented
        label={t("settings.servers")}
        value={kind}
        options={[
          { value: "off", label: t("settings.serversAny") },
          { value: "same", label: t("launch.sameServer") },
          { value: "different", label: t("launch.spread") },
        ]}
        onChange={(k) => setMode(k === "off" ? "off" : k === "same" ? "pickFirst" : "randomPublic")}
      />
    </SettingRow>
  );
}

/** Each account's own launch options in one table (what the account panel's Overrides tab held):
 * full quality, brought back when it drops, FPS cap, launch arguments, Discord alerts, FFlags. */
export function PerAccountRow() {
  const accounts = useAccounts().data ?? [];
  const settings = useSettings().data;
  const flagsOn = settings?.customFlagsScope === "account";
  const [flagsFor, setFlagsFor] = useState<AccountSummary | null>(null);
  const quiet = useUpdateAccount({ quiet: true });
  return (
    <SettingRow id="perAccount">
      <div className="pa-wrap">
        {accounts.length === 0 ? (
          <p className="text-fg-3 text-[13px]">{t("settings.perAccountNone")}</p>
        ) : (
          <table className="pa">
            <thead>
              <tr>
                <th>{t("settings.perAccountAccount")}</th>
                <th data-tip={t("accounts.detail.fullQualityHint")}>{t("accounts.detail.fullQuality")}</th>
                <th data-tip={t("accounts.detail.bringBackHint")}>{t("settings.perAccountBack")}</th>
                <th>{t("accounts.detail.fpsCap")}</th>
                <th>{t("accounts.detail.launchArgs")}</th>
                <th data-tip={t("accounts.detail.muteDiscordHint")}>{t("settings.perAccountMute")}</th>
                {flagsOn && <th>{t("flags.title")}</th>}
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <PerAccount key={a.id} account={a} flagsOn={flagsOn} onFlags={() => setFlagsFor(a)} />
              ))}
            </tbody>
          </table>
        )}
      </div>
      {flagsFor && (
        <FlagsDialog
          open
          onClose={() => setFlagsFor(null)}
          title={t("flags.accountTitle", { name: flagsFor.alias || flagsFor.displayName })}
          flags={flagsFor.customFlags}
          onSave={(customFlags) => quiet.mutateAsync({ id: flagsFor.id, patch: { customFlags } })}
        />
      )}
    </SettingRow>
  );
}

function PerAccount({ account: a, flagsOn, onFlags }: { account: AccountSummary; flagsOn: boolean; onFlags: () => void }) {
  const update = useUpdateAccount();
  const save = (patch: Parameters<typeof update.mutate>[0]["patch"]) => update.mutate({ id: a.id, patch });
  const count = Object.keys(a.customFlags).length;
  return (
    <tr>
      <td className="pa-first">
        <span className="pa-who">
          <Avatar account={a} size={24} />
          <span className="min-w-0">
            <span className="pa-name">{accountName(a)}</span>
            <span className="pa-user">@{a.username}</span>
          </span>
        </span>
      </td>
      <td data-label={t("accounts.detail.fullQuality")}><Switch label={t("accounts.detail.fullQuality")} checked={a.fullQuality} onChange={(fullQuality) => save({ fullQuality })} /></td>
      <td data-label={t("settings.perAccountBack")}><Switch label={t("accounts.detail.bringBack")} checked={!a.allowDisconnect} onChange={(back) => save({ allowDisconnect: !back })} /></td>
      <td data-label={t("accounts.detail.fpsCap")}>
        <OffOrNumberField label={t("accounts.detail.fpsCap")} value={a.fpsCap ?? 0} range={RANGES.fpsCap} unit={t("accounts.detail.fpsUnit")} short="FPS" onCommit={(fpsCap) => save({ fpsCap })} />
      </td>
      <td className="pa-args" data-label={t("accounts.detail.launchArgs")}>
        <TextField label={t("accounts.detail.launchArgs")} placeholder={t("settings.perAccountDefault")} value={a.launchArgs ?? ""} onCommit={(launchArgs) => update.mutateAsync({ id: a.id, patch: { launchArgs } })} />
      </td>
      <td data-label={t("settings.perAccountMute")}><Switch label={t("accounts.detail.muteDiscord")} checked={a.discordMuted} onChange={(discordMuted) => save({ discordMuted })} /></td>
      {flagsOn && (
        <td data-label={t("flags.title")}>
          <Button size="sm" icon="pencil" onClick={onFlags}>{count ? t("flags.count", { count }) : t("flags.edit")}</Button>
        </td>
      )}
    </tr>
  );
}
