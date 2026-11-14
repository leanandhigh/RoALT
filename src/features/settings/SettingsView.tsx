import "./settings.css";
import "./st.css";
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { requestNavigation, SECTION_ICON, SECTION_VIEW, useNavigationRequests, VIEW_NAME, type Section, type View } from "../../app/navigation";
import { t } from "../../i18n";
import { Input } from "../../ui/Field";
import { Icon, type IconName } from "../../ui/Icon";
import { ListPresence, RISE, SPRING, TWEEN } from "../../ui/motion";
import { AREAS, type SettingsArea } from "./areas";
import { jumpTo, requestJump } from "./jump";
import { EntryRow, Renderers, SearchHits, useCtx, type RowRenderers } from "./kit/SettingRow";
import { SettingSection } from "./kit/SettingSection";
import { dyn, shown } from "./registry";
import { keyOf, placeNames, search, type Hit, type HitGroup } from "./search";
import { SupportRow, VersionRow } from "./rows/about";
import { AccentRow, MotionRow, SoundRow } from "./rows/appearance";
import { BackupRow, BrowserDataRow, CleanLogsRow, DataFolderRow } from "./rows/data";
import { BreakerRow, MultiRow, PerAccountRow, PlayFpsRow, SameServerRow, ShutdownRow } from "./rows/launching";
import { EncryptionRow, MasterPasswordRow, PublicNetworkRow, RecoveryCodeRow } from "./rows/security";
import { ShortcutsTable } from "./rows/shortcuts";

/** Settings' rows that draw their own controls, by entry id. */
const RENDERERS: RowRenderers = {
  multi: MultiRow,
  breaker: BreakerRow,
  playFps: PlayFpsRow,
  perAccount: PerAccountRow,
  sameServer: SameServerRow,
  shutdown: ShutdownRow,
  accent: AccentRow,
  sounds: SoundRow,
  motion: MotionRow,
  encryption: EncryptionRow,
  masterPassword: MasterPasswordRow,
  recoveryCode: RecoveryCodeRow,
  publicNetworks: PublicNetworkRow,
  dataFolder: DataFolderRow,
  backup: BackupRow,
  cleanLogs: CleanLogsRow,
  browserData: BrowserDataRow,
  version: VersionRow,
  support: SupportRow,
};

/** Each view's island icon, for search's links into it. */
const VIEW_ICON = Object.fromEntries((Object.keys(SECTION_VIEW) as Section[]).map((s) => [SECTION_VIEW[s], SECTION_ICON[s]])) as Partial<Record<View, IconName>>;

/** What was typed, and what it found then. Found per keystroke, not per render: a row whose words a
 * flow changes (the vault's mode, a new recovery code) stays on screen, its dialog with it. */
type Find = { q: string; found: HitGroup[] | null };
const NO_FIND: Find = { q: "", found: null };

/** `area`: the one the island picked (one screen each). */
export function SettingsView({ area = "launching" }: { area?: SettingsArea }) {
  const ctx = useCtx();
  const main = useRef<HTMLElement>(null);
  const [find, setFind] = useState(NO_FIND);
  const q = find.q;
  // The field answers each key at once; the results follow when React has time. Ending a search
  // doesn't wait: the area shows at once.
  const deferred = useDeferredValue(find);
  const { q: foundQ, found } = find.found ? deferred : find;
  const [shownArea, setShownArea] = useState(area);
  // Picking an area ends a search, so the area is what shows.
  if (shownArea !== area) {
    setShownArea(area);
    setFind(NO_FIND);
  }
  // So does any way here from elsewhere (an island sheet, a jump), the area on screen included.
  useNavigationRequests(useCallback((r: { view: View }) => r.view === "settings" && setFind(NO_FIND), []));
  // Less the rows a change has hidden since (the master-only ones, once the password is removed).
  const groups = found?.map((g) => ({ ...g, hits: g.hits.filter((h) => shown(h.row, ctx)) })).filter((g) => g.hits.length) ?? null;
  const hits = groups?.reduce((n, g) => n + g.hits.length, 0) ?? 0;
  const first = groups?.[0]?.hits[0]?.row;
  const def = AREAS.find((a) => a.id === area)!;
  // The area on screen is named by its tab.
  const title = t("settings.title");
  // The group in view, lit in the left column: the last one whose heading has passed the top third.
  const [spy, setSpy] = useState(0);
  useEffect(() => {
    const box = main.current;
    if (!box) return;
    const read = () => {
      const top = box.getBoundingClientRect().top + box.clientHeight / 3;
      const els = [...box.querySelectorAll<HTMLElement>("[data-group]")];
      let at = 0;
      els.forEach((el, i) => {
        if (el.getBoundingClientRect().top <= top) at = i;
      });
      // At the very bottom the last group is the one in view.
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 4) at = els.length - 1;
      setSpy(Math.max(0, at));
    };
    read();
    box.addEventListener("scroll", read, { passive: true });
    return () => box.removeEventListener("scroll", read);
  }, [area, groups]);
  // Before the frame a jump into the new area lands in (jump.ts), so it doesn't undo that scroll.
  useLayoutEffect(() => {
    main.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [area]);

  const search_ = (
    <div className="st-search">
      <Input
        id="settings-search"
        type="search"
        leading="search"
        data-find
        aria-label={t("settings.searchLabel")}
        placeholder={t("settings.searchPlaceholder")}
        value={q}
        onChange={(e) => setFind({ q: e.target.value, found: e.target.value.trim() ? search(e.target.value, ctx) : null })}
        onKeyDown={(e) => {
          if (e.key === "Escape" && q) {
            e.stopPropagation();
            setFind(NO_FIND);
          } else if (e.key === "Enter" && first) {
            e.preventDefault();
            (first.place.view === "settings" ? requestJump : jumpTo)(first.id);
          }
        }}
      />
      <p role="status" className="sr-only">
        {groups && (hits ? t("settings.searchCount", { count: hits }) : t("settings.searchNone", { q: foundQ.trim() }))}
      </p>
    </div>
  );

  // Two columns: the areas down the left (search on top, the open area's groups under it), the
  // open area's rows on the right.
  return (
    <div className="st">
      <aside className="st-nav" aria-label={t("app.nav.settings")}>
        <h1 className="st-title">{title}</h1>
        {search_}
        <nav className="st-areas" role="tablist" aria-orientation="vertical">
          {AREAS.filter((a) => a.id !== "shortcuts").map((a) => {
            const on = !groups && a.id === area;
            return (
              <div key={a.id}>
                <button type="button" role="tab" className="st-area" aria-selected={on} onClick={() => requestNavigation("settings", a.id)}>
                  <Icon name={a.icon} size={16} />
                  {t(a.label)}
                </button>
                {on && a.groups.some((g) => g.label) && (
                  <div className="st-subs">
                    {a.groups.map((g, i) => (
                      <button
                        key={g.label ?? i}
                        type="button"
                        className="st-sub"
                        aria-current={spy === i ? "location" : undefined}
                        onClick={() => main.current?.querySelector(`[data-group="${i}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      >
                        {g.label ? t(g.label) : t(a.label)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>
      <main ref={main} className="scroll flex-1 min-w-0 st-main">
        <Renderers value={RENDERERS}>
          <div className="st-body">
            <h2 className="st-area-title">{groups ? t("settings.searchLabel") : t(def.label)}</h2>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={groups ? "search" : area}
                initial={{ opacity: 0, y: RISE.md }}
                animate={{ opacity: 1, y: 0, transition: SPRING.smooth }}
                exit={{ opacity: 0, transition: TWEEN.exit }}
              >
                {groups ? (
                  <Results q={foundQ} groups={groups} />
                ) : area === "shortcuts" ? (
                  <div className="panel set-group">
                    <ShortcutsTable />
                  </div>
                ) : (
                  def.groups.map((g, i) => (
                    <div key={g.label ?? i} data-group={i}>
                      <SettingSection label={g.label} ids={g.ids} />
                    </div>
                  ))
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </Renderers>
      </main>
    </div>
  );
}

/** Hits from every screen, grouped where they live: Settings' as their own live rows (a match in
 * "More about" opens it), other views' as links that go there. */
function Results({ q, groups }: { q: string; groups: HitGroup[] }) {
  // The same set while the same rows open: a new one would re-render every row in the results.
  const moreIds = groups.flatMap((g) => g.hits.filter((h) => h.where === "more").map((h) => h.via.id)).join(" ");
  const more = useMemo(() => new Set(moreIds.split(" ")), [moreIds]);
  if (!groups.length) return <p className="empty enter">{t("settings.searchNone", { q: q.trim() })}</p>;
  return (
    <SearchHits value={more}>
      <ListPresence items={groups} getKey={(g) => keyOf(g.place)} className="set-results" render={(g) => <ResultGroup group={g} />} />
    </SearchHits>
  );
}

const hitIds = (g: HitGroup) => g.hits.map((h) => h.row.id).join(" ");

/** Drawn again only when its rows change, not on every key that finds the same ones. */
const ResultGroup = memo(function ResultGroup({ group }: { group: HitGroup }) {
  const live = group.place.view === "settings";
  return (
    <section className="set-section">
      <h2 className="section-title set-heading">{placeNames(group.place).join(" · ")}</h2>
      <ListPresence
        items={group.hits}
        getKey={(h) => h.row.id}
        className="panel set-group"
        itemClassName="set-wrap"
        render={(h) => (live ? <EntryRow id={h.row.id} /> : <LinkRow hit={h} />)}
      />
    </section>
  );
}, (a, b) => keyOf(a.group.place) === keyOf(b.group.place) && hitIds(a.group) === hitIds(b.group));

/** A setting in another view: its words, and the way there (it lands on the row and flashes it). */
function LinkRow({ hit }: { hit: Hit }) {
  const ctx = useCtx();
  const e = hit.row;
  const view = e.place.view;
  return (
    <button type="button" className="set-row set-link" onClick={() => jumpTo(e.id)}>
      <span className="set-link-icon">
        <Icon name={VIEW_ICON[view] ?? "settings"} size={15} />
      </span>
      <span className="set-text">
        <span className="set-label block">{t(e.label)}</span>
        {e.hint && <span className="set-hint block">{dyn(e.hint, ctx)}</span>}
      </span>
      <span className="set-go">
        {t(VIEW_NAME[view])}
        <Icon name="chevron" size={14} className="-rotate-90 rtl:rotate-90" />
      </span>
    </button>
  );
}

