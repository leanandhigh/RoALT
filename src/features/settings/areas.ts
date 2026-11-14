import type { Key } from "../../i18n";
import type { IconName } from "../../ui/Icon";
import { SHORTCUTS } from "./shortcuts";

/** Settings' areas, one screen each, picked from the island's Settings group. */
export type SettingsArea = "launching" | "appearance" | "security" | "data" | "about" | "shortcuts";

/** An area's rows by group, in screen order. A group without a label is the area's first block. */
export type AreaDef = { id: SettingsArea; label: Key; icon: IconName; groups: readonly { label?: Key; ids: readonly string[] }[] };

export const AREAS: readonly AreaDef[] = [
  {
    id: "launching",
    label: "settings.section.launching",
    icon: "rocket",
    groups: [
      { ids: ["multi", "protectLogin", "launchDelay", "launchArgs", "protectMain"] },
      { label: "settings.group.recovery", ids: ["autoRejoin", "autoRestart", "breaker", "antiAfk"] },
      { label: "settings.group.play", ids: ["windowLayout", "playFps", "sameServer"] },
      { label: "settings.group.perAccount", ids: ["perAccount"] },
      { label: "farm.settings", ids: ["replaceDead", "replaceChallenged", "farmDoneAt", "closeWhenDone"] },
      { label: "settings.group.stopping", ids: ["panic", "closeGrace", "shutdown"] },
    ],
  },
  {
    id: "appearance",
    label: "settings.section.appearance",
    icon: "palette",
    groups: [
      { ids: ["theme", "accent", "background", "density", "tabLayout", "language", "sounds", "motion"] },
      { label: "settings.group.window", ids: ["closeToTray", "skipSplash", "liteUi"] },
    ],
  },
  {
    id: "security",
    label: "settings.section.security",
    icon: "shield",
    groups: [{ ids: ["encryption", "masterPassword", "recoveryCode", "autoLock", "clipboard", "lockPurchases", "publicNetworks"] }],
  },
  { id: "data", label: "settings.section.data", icon: "database", groups: [{ ids: ["dataFolder", "backup", "cache", "cleanLogs", "browserData"] }] },
  { id: "about", label: "settings.section.about", icon: "info", groups: [{ ids: ["version", "rolimons", "support"] }] },
  { id: "shortcuts", label: "settings.section.shortcuts", icon: "keyboard", groups: [{ ids: SHORTCUTS.map((s) => `key.${s.id}`) }] },
];
