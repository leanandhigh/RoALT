import { useSyncExternalStore } from "react";
import { signal } from "../signal";
import { readStored, writeStored } from "../stored";

// Motion, one source for CSS and JS: this PC's choice (Settings › Appearance › Motion), kept in
// localStorage so it survives a restart. "on" (the default, whatever Windows says): the liquid
// motion. "reduced": html[data-rm], fades and progress only. "off": html[data-rm][data-motion-off],
// nothing animates. ?rm=1 forces reduced in a dev preview. CSS reads the attributes
// (styles/motion.css); motion reads them through MotionRoot; WAAPI calls read prefersReducedMotion().
export type MotionPreference = "on" | "reduced" | "off";
const KEY = "mtwin.motion";

const { subscribe, notify } = signal();
let installed = false;
let pref: MotionPreference = "on";
/** Settings › Appearance › Lighter on your PC: no motion whatever the Motion choice. */
let lite = false;
let apply = () => {};

/** What an older MTwin Manager stored: "full" and "system" (no key) are On now; "reduced" stays. */
function read(stored: string | null): MotionPreference {
  return stored === "reduced" || stored === "off" ? stored : "on";
}

export function installReducedMotion() {
  if (installed) return;
  installed = true;
  const forced = import.meta.env.DEV && new URLSearchParams(location.search).get("rm") === "1";
  pref = read(readStored(KEY));
  apply = () => {
    const root = document.documentElement;
    root.toggleAttribute("data-rm", forced || lite || pref !== "on");
    root.toggleAttribute("data-motion-off", lite || pref === "off");
    root.toggleAttribute("data-lite", lite);
    notify();
  };
  apply();
}

/** Lighter on your PC (Settings.liteUi): motion off, and `data-lite` for what CSS leaves out. */
export function setLiteUi(on: boolean) {
  if (on === lite) return;
  lite = on;
  apply();
}
export const liteUi = () => lite;

/** Less motion: Reduced or Off. Travel, scale and blur go; Reduced keeps fades and progress. */
export const prefersReducedMotion = () => document.documentElement.hasAttribute("data-rm");

/** No motion at all. */
const motionOff = () => document.documentElement.hasAttribute("data-motion-off");

/** This PC's choice now. */
export const motionPreference = () => pref;

/** This PC's choice, kept on this PC only. */
export function setMotionPreference(next: MotionPreference) {
  pref = next;
  writeStored(KEY, next === "on" ? null : next);
  apply();
}

/** True while motion should be reduced (Reduced or Off); re-renders when the choice changes. */
export function useReducedMotionFlag() {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}

/** True while motion is Off. */
export function useMotionOff() {
  return useSyncExternalStore(subscribe, motionOff, () => false);
}

/** This PC's choice, kept current. */
export function useMotionPreference() {
  return useSyncExternalStore(subscribe, () => pref, () => "on" as MotionPreference);
}
