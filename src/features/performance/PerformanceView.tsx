import "./performance.css";
import { useRef, useState, type RefObject } from "react";
import type { Profile } from "../../api";
import type { Limits } from "../../bindings/Limits";
import { useAccounts, useSetSettings, useSettings } from "../../data";
import { t, type Key } from "../../i18n";
import { Button } from "../../ui/Button";
import { NumberField, Segmented, Switch } from "../../ui/controls";
import { Select } from "../../ui/Field";
import { Collapse, Morph, Swap } from "../../ui/motion";
import { StatusPill } from "../../ui/Status";
import { PREVIEW_FPS, usePreviewFps } from "../dashboard/previewFps";
import { useJumpTarget } from "../settings/jump";
import { useRow } from "../settings/kit/rowError";
import { Renderers, SettingRow, type RowRenderers } from "../settings/kit/SettingRow";
import { SettingSection } from "../settings/kit/SettingSection";
import { BandwidthRow } from "./BandwidthRow";
import { PERFORMANCE_ENTRIES } from "./entries";
import { benchApplied, ForThisPc } from "./ForThisPc";
import { FpsRow } from "./FpsControl";
import { FlagsDialog } from "./FlagsDialog";
import { isApplied, named, ownCaps, PRESETS, type Preset } from "./presets";
import { ReviewDialog } from "./ReviewDialog";
import { ShareRow } from "./ShareRow";

/** "[320] × [240] px": the size clients go tiny at. */
function TinyFields() {
  const { ctx, write, setError, describedBy } = useRow();
  return (
    <span className="flex items-center gap-2">
      <NumberField unit={t("performance.tinyWidth")} short="×" min={16} max={7680} value={ctx.s.microWidth} onCommit={(microWidth) => void write({ microWidth })} onInvalid={setError} describedBy={describedBy} />
      <NumberField unit={t("performance.tinyHeight")} short="px" min={16} max={4320} value={ctx.s.microHeight} onCommit={(microHeight) => void write({ microHeight })} onInvalid={setError} describedBy={describedBy} />
    </span>
  );
}

/** The tiny size, under "Start clients tiny" while that is on. */
function TinyBelow() {
  const { ctx } = useRow();
  return (
    <Collapse open={ctx.s.tinyOnLaunch}>
      <div className="pt-2.5">
        <TinyFields />
      </div>
    </Collapse>
  );
}

/** What clients not in front get: a CPU limit, efficiency mode, a trim schedule; each named on screen. */
function BackgroundLimits() {
  const { ctx, write } = useRow();
  const a = ctx.s.adaptive;
  const put = (patch: Partial<Limits>) => void write({ adaptive: { ...a, background: { ...a.background, ...patch } } });
  return (
    <div className="perf-bg">
      <div className="perf-bg-item">
        <span className="perf-bg-label">{t("launch.limits.cpu")}</span>
        <Segmented
          mono
          label={t("settings.adaptiveBgCpu")}
          value={a.background.cpuCap ?? 0}
          options={[0, 50, 25, 10, 5].map((c) => ({ value: c, label: c ? t("settings.percent", { n: c }) : t("common.off") }))}
          onChange={(c) => put({ cpuCap: c || null })}
        />
      </div>
      <label className="perf-bg-item">
        <span className="perf-bg-label">{t("launch.limits.eco")}</span>
        <Switch label={t("settings.adaptiveBgEco")} checked={a.background.eco} onChange={(eco) => put({ eco })} />
      </label>
      <div className="perf-bg-item">
        <span className="perf-bg-label">{t("launch.limits.trimEvery")}</span>
        <Segmented
          mono
          label={t("settings.adaptiveBgTrim")}
          value={a.background.trimEveryMin ?? -1}
          options={[-1, 0, 5, 15, 30, 60].map((m) => ({ value: m, label: m < 0 ? t("common.default") : m ? t("settings.minutesShort", { n: m }) : t("common.off") }))}
          onChange={(m) => put({ trimEveryMin: m < 0 ? null : m })}
        />
      </div>
    </div>
  );
}

/** Custom FFlags: for every account or each its own; the global ones are edited here. */
function CustomFlagsRow() {
  return (
    <SettingRow id="customFlags">
      <CustomFlagsControl />
    </SettingRow>
  );
}

function CustomFlagsControl() {
  const { ctx, write, describedBy } = useRow();
  const setSettings = useSetSettings({ quiet: true });
  const [editing, setEditing] = useState(false);
  const global = ctx.s.customFlagsScope === "global";
  const count = Object.keys(ctx.s.customFlags).length;
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      <Segmented
        label={t("flags.scope")}
        value={ctx.s.customFlagsScope}
        options={[{ value: "global" as const, label: t("flags.global") }, { value: "account" as const, label: t("flags.perAccount") }]}
        onChange={(customFlagsScope) => void write({ customFlagsScope })}
      />
      {global && (
        <Button size="md" icon="pencil" onClick={() => setEditing(true)} aria-describedby={describedBy}>
          {count ? t("flags.count", { count }) : t("flags.edit")}
        </Button>
      )}
      <FlagsDialog
        open={editing}
        onClose={() => setEditing(false)}
        title={t("flags.title")}
        flags={ctx.s.customFlags}
        // Through the API, not `write`: a refusal belongs in the dialog, not the row.
        onSave={(customFlags) => setSettings.mutateAsync({ customFlags })}
      />
    </span>
  );
}

function PreviewFpsRow() {
  const [fps, setFps] = usePreviewFps();
  return (
    <SettingRow id="previewFps">
      <Segmented mono label={t("dashboard.previewFps")} value={fps} options={PREVIEW_FPS.map((f) => ({ value: f, label: t("dashboard.fps", { fps: f }) }))} onChange={setFps} />
    </SettingRow>
  );
}

/** Performance's rows that draw their own controls. The strip-visuals flags get a heading inside
 * Lighter rendering's panel. */
const RENDERERS: RowRenderers = {
  fpsCap: FpsRow,
  // The switch, and the size it makes clients while it's on (the manual Tiny keeps using it too).
  tinyOnLaunch: () => <SettingRow id="tinyOnLaunch" below={<TinyBelow />} />,
  graySky: () => (
    <>
      <h3 className="perf-subhead">{t("performance.stripTitle")}</h3>
      <SettingRow id="graySky" />
    </>
  ),
  adaptiveBg: () => <SettingRow id="adaptiveBg" below={<BackgroundLimits />} />,
  previewFps: PreviewFpsRow,
  bandwidth: BandwidthRow,
  customFlags: CustomFlagsRow,
};

/** The groups of rows in screen order; each lists its entries' top rows (entries.ts order). */
const GROUPS = (["performance.fineTune", "performance.section.cpuMemory", "performance.section.app", "performance.section.network"] as const).map((group: Key) => ({
  group,
  ids: PERFORMANCE_ENTRIES.filter((e) => "group" in e.place && e.place.group === group && !e.parent).map((e) => e.id),
}));

/** Search can jump to a preset: each lands on the preset picker. */
function PresetJump({ id, target }: { id: string; target: RefObject<HTMLElement | null> }) {
  useJumpTarget(id, target);
  return null;
}

/** The presets as one dropdown; the one in use (or the one about to be reviewed) is described below
 * it. Picking one opens its review, as before. */
function PresetPicker({ active, onPick }: { active: Preset | undefined; onPick: (p: Preset) => void }) {
  const ref = useRef<HTMLElement>(null);
  useJumpTarget("presets", ref);
  const shown = active ?? null;
  const facts = shown?.facts() ?? [];
  return (
    <section ref={ref} aria-label={t("performance.presets")} className="perf-presets panel">
      {PRESETS.map((p) => (
        <PresetJump key={p.id} id={p.id} target={ref} />
      ))}
      <div className="perf-preset-row">
        <span className="section-title">{t("performance.presets")}</span>
        <Select
          aria-label={t("performance.presets")}
          value={shown?.id ?? "custom"}
          options={[
            ...(shown ? [] : [{ value: "custom", label: t("performance.custom") }]),
            ...PRESETS.map((p) => ({ value: p.id, label: t(p.label) })),
          ]}
          onChange={(id) => {
            const p = PRESETS.find((x) => x.id === id);
            if (p) onPick(p);
          }}
        />
      </div>
      {shown ? (
        <>
          <p className="text-fg-2">{t(shown.tag)}</p>
          <div className="perf-preset-facts">
            {facts.map((f) => (
              <span key={f} className="tag">{f}</span>
            ))}
          </div>
        </>
      ) : (
        <p className="text-fg-3">{t("performance.pickPreset")}</p>
      )}
    </section>
  );
}

/** How hard MTwin Manager works this PC: a preset or this PC's own suggestions, each reviewed before it
 * applies, then every setting behind them, then a profile to share. */
export function PerformanceView() {
  // From the query, not Shell's prop: the prop can lag a render behind the accounts below, and the pill then named a mix of both.
  const settings = useSettings().data!;
  const [previewFps] = usePreviewFps();
  const [review, setReview] = useState<{ profile: Profile; facts?: string[] } | null>(null);
  // What "For this PC" last sent to the review: it is "in use" once that is applied.
  const [picked, setPicked] = useState<Profile | null>(null);
  // Enter held on Apply lands on what opened the review: it must not open it again.
  const closedAt = useRef(0);
  const open = (profile: Profile, facts?: string[]) => Date.now() - closedAt.current > 400 && setReview({ profile, facts });

  // An account's own cap beats a preset's, so it isn't what those clients get.
  // A pick naming no setting would match any settings (isApplied skips what it leaves out).
  const candidates = [...PRESETS, ...(picked && named(picked) ? [{ label: "performance.bench.title" as Key, profile: picked }] : [])];
  const active = ownCaps(useAccounts().data ?? []) ? undefined : candidates.find((p) => isApplied(p.profile, settings));
  const using = active ? t("performance.using", { name: t(active.label) }) : t("performance.custom");

  return (
    <main className="scroll flex-1 min-w-0 page">
      <div className="perf-page">
        <header className="perf-head">
          <div className="perf-title">
            <h1 className="page-title">{t("performance.title")}</h1>
            <Morph className="relative">
              <Swap k={using}>
                <StatusPill tone="neutral" shape={active ? "dot" : "ring"} label={using} />
              </Swap>
            </Morph>
          </div>
          <p className="page-sub">{t("performance.intro")}</p>
        </header>

        <div className="perf-top">
          <PresetPicker active={PRESETS.find((p) => p === active)} onPick={(p) => open(p.profile)} />
          <ForThisPc
            settings={settings}
            previewFps={previewFps}
            onReview={(p, facts) => {
              setPicked(p);
              open(p, facts);
            }}
          />
        </div>

        <Renderers value={RENDERERS}>
          {GROUPS.map((g) => (
            <SettingSection key={g.group} label={g.group} ids={g.ids} />
          ))}
        </Renderers>
        <ShareRow onProfile={(p) => open(p)} />
      </div>
      <ReviewDialog
        profile={review?.profile ?? null}
        settings={settings}
        facts={review?.facts}
        onApplied={review?.facts ? benchApplied : undefined}
        onClose={() => {
          closedAt.current = Date.now();
          setReview(null);
        }}
      />
    </main>
  );
}
