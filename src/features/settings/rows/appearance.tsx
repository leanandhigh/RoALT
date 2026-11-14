import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { api } from "../../../api";
import { qk, useBackgroundUrl } from "../../../data";
import { t } from "../../../i18n";
import { Button } from "../../../ui/Button";
import { Segmented, Switch } from "../../../ui/controls";
import { ColorPicker } from "../../../ui/ColorPicker";
import { BRAND_ACCENT } from "../../../app/theme";
import { Collapse, Morph, setMotionPreference, Swap, useMotionPreference } from "../../../ui/motion";
import { playSound, previewSound, setSoundPreferences, useSoundPreferences } from "../../../ui/sounds";
import { useRow } from "../kit/rowError";
import { SettingRow } from "../kit/SettingRow";

const IMAGES = ["png", "jpg", "jpeg", "webp", "gif"];

/** One colour picker; Reset goes back to MTwin red. */
function AccentPicker() {
  const { ctx, write } = useRow();
  const value = ctx.s.accent;
  return (
    <span className="flex items-center gap-2">
      {value && (
        <Button size="md" variant="ghost" onClick={() => void write({ accent: "" })}>
          {t("settings.accentReset")}
        </Button>
      )}
      <ColorPicker label={t("settings.accentColour")} value={value || BRAND_ACCENT} onChange={(accent) => void write({ accent: accent.toLowerCase() === BRAND_ACCENT ? "" : accent })} />
    </span>
  );
}

export function AccentRow() {
  return (
    <SettingRow id="accent">
      <AccentPicker />
    </SettingRow>
  );
}

/** Choose a picture, or with one set: its thumbnail, Change… and Remove. How much the theme covers it
 * is the sub-row under this one (the registry's backgroundDim). */
function BackgroundControls() {
  const row = useRow();
  const qc = useQueryClient();
  // The thumbnail is the theme's own URL: no second copy of the picture.
  const url = useBackgroundUrl();
  const [busy, setBusy] = useState(false);
  const has = row.ctx.background;
  const run = (p: Promise<unknown>) => {
    setBusy(true);
    row.setError(null);
    p.then(() => qc.invalidateQueries({ queryKey: qk.background }))
      .then(() => row.refocus(), row.fail)
      .finally(() => setBusy(false));
  };
  async function pick() {
    const path = await openFile({ multiple: false, directory: false, filters: [{ name: t("settings.images"), extensions: IMAGES }], title: t("settings.backgroundDialog") }).catch(row.fail);
    if (path) run(api.backgroundSet(path));
  }
  // The main button stays the same element as its words change, so it keeps the focus.
  return (
    <Morph innerClassName="gap-2">
      {has && url && <img src={url} alt="" className="set-thumb enter" />}
      <Button size="md" busy={busy} onClick={() => !busy && void pick()}>
        <Swap k={has ? "change" : "choose"}>{has ? t("settings.change") : t("settings.choose")}</Swap>
      </Button>
      {has && (
        <Button size="md" variant="ghost" className="enter" onClick={() => !busy && run(api.backgroundClear())}>
          {t("common.remove")}
        </Button>
      )}
    </Morph>
  );
}

export function BackgroundRow() {
  return (
    <SettingRow id="background">
      <BackgroundControls />
    </SettingRow>
  );
}

function SoundSwitch({ on }: { on: boolean }) {
  const { describedBy } = useRow();
  return <Switch label={t("settings.soundEffects")} checked={on} onChange={(enabled) => setSoundPreferences({ enabled })} describedBy={describedBy} />;
}

/** This PC's own choice (not a Settings field, kept across restarts): liquid motion (the default),
 * reduced to fades, or none. It applies at once; the hint follows it. */
export function MotionRow() {
  const pref = useMotionPreference();
  return (
    <SettingRow id="motion">
      <Segmented
        label={t("settings.motion")}
        value={pref}
        onChange={setMotionPreference}
        options={[
          { value: "on", label: t("settings.motionOn") },
          { value: "reduced", label: t("settings.motionReduced") },
          { value: "off", label: t("settings.motionOff") },
        ]}
      />
    </SettingRow>
  );
}

/** This PC's own choice (not a Settings field): on or off, and while on, the volume with a sample. */
export function SoundRow() {
  const sound = useSoundPreferences();
  const id = useId();
  const pct = Math.round(sound.volume * 100);
  return (
    <SettingRow
      id="sounds"
      below={
        <Collapse open={sound.enabled}>
          <div className="set-subs-pad">
            <div className="set-subs">
              <div className="set-row set-line">
                <label htmlFor={id} className="set-text set-label">{t("settings.soundVolume")}</label>
                <div className="set-control">
                  <input
                    id={id}
                    className="range set-volume"
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={pct}
                    onChange={(e) => setSoundPreferences({ volume: Number(e.target.value) / 100 })}
                    onPointerUp={() => playSound("click")}
                    onKeyUp={(e) => ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key) && playSound("click")}
                  />
                  <span className="mono text-fg-2 w-10 text-end">{pct}%</span>
                  <Button size="md" data-sound="off" disabled={!pct} onClick={previewSound}>{t("settings.soundPreview")}</Button>
                </div>
              </div>
            </div>
          </div>
        </Collapse>
      }
    >
      <SoundSwitch on={sound.enabled} />
    </SettingRow>
  );
}
