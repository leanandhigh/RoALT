import { useSyncExternalStore } from "react";

/** Whether a media query matches now, following changes (a window made smaller or larger). */
export function useMedia(query: string) {
  return useSyncExternalStore(
    (on) => {
      const mq = matchMedia(query);
      mq.addEventListener("change", on);
      return () => mq.removeEventListener("change", on);
    },
    () => matchMedia(query).matches,
  );
}
