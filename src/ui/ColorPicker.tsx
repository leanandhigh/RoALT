import "./color-picker.css";
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { t } from "../i18n";
import { Popover, useAnchor } from "./Popover";

type Hsv = { h: number; s: number; v: number };

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const isHex = (s: string) => /^#[0-9a-f]{6}$/i.test(s);

function hexToHsv(hex: string): Hsv {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: ((h * 60) + 360) % 360, s: max ? d / max : 0, v: max };
}

function hsvToHex({ h, s, v }: Hsv) {
  const f = (k: number) => {
    const x = (k + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(x, 4 - x, 1));
  };
  return "#" + [f(5), f(3), f(1)].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
}

/** Drag on `el`: `at` gets the pointer's place in it (0-1 each way) while held; `done` once let go. */
function useDrag(at: (x: number, y: number) => void, done: () => void) {
  return (e: ReactPointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent | ReactPointerEvent) => {
      const r = el.getBoundingClientRect();
      at(clamp((ev.clientX - r.left) / r.width), clamp((ev.clientY - r.top) / r.height));
    };
    move(e);
    const onMove = (ev: PointerEvent) => move(ev);
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      done();
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  };
}

/** A colour well that opens a picker: saturation and brightness in a square, hue in a bar, and the
 * hex code. The colour shows live while dragging; `onChange` gets it once a drag ends or a code is
 * typed. */
export function ColorPicker({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  const id = useId().replace(/:/g, "");
  const anchor = useAnchor();
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [text, setText] = useState(value);
  const live = useRef(value);
  // Follows the value from outside (a reset, another window) unless it's the one just picked.
  useEffect(() => {
    if (value.toLowerCase() !== live.current.toLowerCase()) {
      live.current = value;
      setHsv(hexToHsv(value));
    }
    setText(value);
  }, [value]);
  const show = hsvToHex(hsv);
  const set = (next: Hsv) => {
    setHsv(next);
    live.current = hsvToHex(next);
    setText(live.current);
  };
  const commit = () => live.current.toLowerCase() !== value.toLowerCase() && onChange(live.current);
  const area = useDrag((x, y) => set({ ...hsv, s: x, v: 1 - y }), commit);
  const hue = useDrag((x) => set({ ...hsv, h: x * 359.9 }), commit);
  const keys = (dx: number, dy: number, which: "area" | "hue") => {
    const step = 0.02;
    set(which === "hue" ? { ...hsv, h: (hsv.h + dx * 4 + 360) % 360 } : { ...hsv, s: clamp(hsv.s + dx * step), v: clamp(hsv.v - dy * step) });
  };
  const arrows = (which: "area" | "hue") => (e: React.KeyboardEvent) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    keys(d[0], d[1], which);
  };

  return (
    <>
      <button type="button" className="cp-well" popoverTarget={`cp-${id}`} style={{ ...anchor.style, background: show }} aria-label={label} data-tip={label}>
        <span className="cp-code mono">{show.toUpperCase()}</span>
      </button>
      <Popover id={`cp-${id}`} anchor={anchor.name} placement="below-end" role="dialog" label={label} className="cp-pop" onToggle={(open) => !open && commit()}>
        <div
          className="cp-area"
          style={{ background: `hsl(${hsv.h} 100% 50%)` }}
          onPointerDown={area}
          tabIndex={0}
          role="slider"
          aria-label={t("settings.colourShade")}
          aria-valuetext={show}
          onKeyDown={arrows("area")}
          onKeyUp={commit}
        >
          <span className="cp-dot" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: show }} />
        </div>
        <div
          className="cp-hue"
          onPointerDown={hue}
          tabIndex={0}
          role="slider"
          aria-label={t("settings.colourHue")}
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(hsv.h)}
          onKeyDown={arrows("hue")}
          onKeyUp={commit}
        >
          <span className="cp-knob" style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }} />
        </div>
        <div className="cp-row">
          <span className="cp-chip" style={{ background: show }} />
          <input
            className="field cp-hex mono"
            value={text}
            spellCheck={false}
            maxLength={7}
            aria-label={t("settings.colourCode")}
            onChange={(e) => {
              const v = e.target.value.startsWith("#") ? e.target.value : "#" + e.target.value;
              setText(v);
              if (isHex(v)) {
                live.current = v.toLowerCase();
                setHsv(hexToHsv(v));
              }
            }}
            onKeyDown={(e) => e.key === "Enter" && commit()}
            onBlur={commit}
          />
        </div>
      </Popover>
    </>
  );
}
