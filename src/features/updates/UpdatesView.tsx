import "./updates.css";
import { useQuery } from "@tanstack/react-query";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { api, type PlatformVersion, type RobloxVersions } from "../../api";
import { qk } from "../../data";
import { t, type Key } from "../../i18n";
import { Button, IconButton } from "../../ui/Button";
import { StatusPill } from "../../ui/Status";
import { LoadFailed, toast, toastError } from "../../ui/Toast";
import { ago } from "../progress/shared";
import { useNow } from "../launch/Running";
import { Renderers, type RowRenderers } from "../settings/kit/SettingRow";
import { SettingSection } from "../settings/kit/SettingSection";
import { ClientCard, ClientPathRow, ExecutorRow } from "../settings/rows/launching";

const CLIENT_ROWS: RowRenderers = { client: ClientCard, clientPath: ClientPathRow, executor: ExecutorRow };

type Platform = "windows" | "mac" | "android" | "ios";
const PLATFORMS: [Platform, string][] = [
  ["windows", "Windows"],
  ["mac", "Mac"],
  ["android", "Android"],
  ["ios", "iOS"],
];

/** Roblox's builds per platform, from WhatExpsAre.Online: what's live, what's deployed next, what came before. */
export function UpdatesView() {
  const q = useQuery({ queryKey: qk.robloxVersions, queryFn: () => api.robloxVersions(), staleTime: 0, refetchInterval: 60_000, refetchIntervalInBackground: false });
  const now = useNow(5000);
  const v = q.data;
  if (q.isError && !v) return <LoadFailed error={q.error} busy={q.isFetching} onRetry={() => void q.refetch()} />;

  return (
    <main className="scroll flex-1 min-w-0 page">
      <div className="up-page">
        <header className="up-head">
          <div className="min-w-0">
            <h1 className="page-title">{t("app.nav.updates")}</h1>
            <p className="page-sub">{t("updates.sub")}</p>
          </div>
          <div className="up-tools">
            {v && <span className="meta">{t("updates.checked", { ago: ago(now - v.checkedAt) })}</span>}
            <Button size="md" icon="refresh" busy={q.isFetching} onClick={() => api.robloxVersions(true).then((d) => q.refetch().then(() => d), toastError)}>
              {t("updates.refresh")}
            </Button>
          </div>
        </header>
        {v?.error && <p className="up-error panel">{t("updates.partial", { why: v.error })}</p>}
        {v && <Installed v={v} />}
        {/* The Roblox client: how it launches, the executor it's kept on, its updates. */}
        <section className="up-client">
          <Renderers value={CLIENT_ROWS}>
            <SettingSection label="settings.client" ids={["client", "executor", "clientPath", "autoUpdate"]} />
          </Renderers>
        </section>
        {v && <BuildTable v={v} />}
        <p className="meta up-credit">{t("updates.credit")}</p>
      </div>
    </main>
  );
}

/** This PC's Windows build against the live and the next one. */
function Installed({ v }: { v: RobloxVersions }) {
  const live = v.current?.windows?.version;
  const next = v.future?.windows?.version;
  const mine = v.installed;
  const [tone, label] = !mine
    ? (["neutral", t("updates.notInstalled")] as const)
    : !live
      ? (["neutral", t("updates.unknown")] as const)
      : mine === live
        ? next && next !== live
          ? (["info", t("updates.upToDateNext")] as const)
          : (["ok", t("updates.upToDate")] as const)
        : mine === v.past?.windows?.version
          ? (["attention", t("updates.behind")] as const)
          : mine === next
            ? (["info", t("updates.ahead")] as const)
            : (["attention", t("updates.differs")] as const);
  return (
    <div className="up-mine panel">
      <div className="min-w-0">
        <span className="up-k">{t("updates.thisPc")}</span>
        <span className="up-v mono">{mine ?? "—"}</span>
      </div>
      <StatusPill tone={tone} label={label} />
    </div>
  );
}

/** The executor chosen in Settings, against Roblox: what it supports, what's live, what's here. */
/** Every platform's builds in one table: platforms down the side; live, next and the one before across. */
function BuildTable({ v }: { v: RobloxVersions }) {
  const copy = (text: string) => writeText(text).then(() => toast(t("updates.copied", { v: text })), toastError);
  const cols: [Key, Key, RobloxVersions["current"]][] = [
    ["updates.current", "updates.currentHint", v.current],
    ["updates.future", "updates.futureHint", v.future],
    ["updates.past", "updates.pastHint", v.past],
  ];
  return (
    <div className="panel up-table-wrap">
      <table className="up-table">
        <thead>
          <tr>
            <th scope="col">{t("updates.platform")}</th>
            {cols.map(([title, hint]) => (
              <th key={title} scope="col" data-tip={t(hint)}>{t(title)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PLATFORMS.map(([key, name]) => (
            <tr key={key}>
              <th scope="row">{name}</th>
              {cols.map(([title, , set]) => {
                const b = set?.[key] ?? null;
                const mine = key === "windows" && !!v.installed && b?.version === v.installed;
                return (
                  <td key={title} data-mine={mine || undefined}>
                    {b ? (
                      <span className="up-cell">
                        <span className="up-cell-v">
                          <span className="mono truncate selectable">{b.version}</span>
                          <IconButton size="sm" icon="copy" label={t("updates.copy")} onClick={() => void copy(b.version)} />
                        </span>
                        <span className="meta">
                          {b.date ?? "—"}
                          {mine && <span className="up-badge">{t("updates.installedHere")}</span>}
                        </span>
                      </span>
                    ) : (
                      <span className="meta">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Section({ title, hint, set, platforms, installed }: {
  title: Key;
  hint: Key;
  set: RobloxVersions["current"];
  platforms: [Platform, string][];
  installed: string | null;
}) {
  return (
    <section className="up-section">
      <h2 className="section-title">{t(title)}</h2>
      <p className="meta">{t(hint)}</p>
      <div className="up-grid">
        {platforms.map(([key, name]) => (
          <Card key={key} name={name} v={set?.[key] ?? null} mine={key === "windows" && !!installed && set?.[key]?.version === installed} />
        ))}
      </div>
    </section>
  );
}

function Card({ name, v, mine }: { name: string; v: PlatformVersion | null; mine: boolean }) {
  const copy = (text: string) => writeText(text).then(() => toast(t("updates.copied", { v: text })), toastError);
  return (
    <div className="up-card panel" data-mine={mine || undefined}>
      <div className="up-card-head">
        <span className="up-k">{name}</span>
        {mine && <span className="up-badge">{t("updates.installedHere")}</span>}
      </div>
      {v ? (
        <>
          <div className="up-ver">
            <span className="mono up-v truncate selectable">{v.version}</span>
            <IconButton size="sm" icon="copy" label={t("updates.copy")} onClick={() => void copy(v.version)} />
          </div>
          <span className="meta">{v.date ?? "—"}</span>
        </>
      ) : (
        <span className="meta">{t("updates.none")}</span>
      )}
    </div>
  );
}
