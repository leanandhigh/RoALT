import { t } from "../../i18n";
import { Icon } from "../../ui/Icon";
import type { IslandLeaf, IslandModel } from "../../ui/island/model";
import { MenuItem, Popover, useAnchor } from "../../ui/Popover";

/** The places used every session, as tabs; the rest under More. */
const TABS = ["home", "accounts", "play", "servers", "progress", "updates", "executor"];
/** Not a page: Play opens as a panel (from Accounts, Home's games, Ctrl+3). */
const HIDDEN: string[] = [];

/** MTwin Manager's navigation: a bar of tabs under the title bar, More for the tools, Settings at
 * its end. The tab on screen sits on a raised plate with a red underline. */
export function TopNav({ model }: { model: IslandModel }) {
  const all = [...model.main, ...model.groups.flatMap((g) => (g.id === "tools" ? g.children : []))];
  const tabs = TABS.flatMap((id) => all.find((l) => l.id === id) ?? []);
  const more = all.filter((l) => !TABS.includes(l.id) && !HIDDEN.includes(l.id));
  const settings = model.groups.find((g) => g.id === "settings");
  const inSettings = !!settings?.children.some((c) => c.current);
  const moreOn = more.find((l) => l.current);
  const anchor = useAnchor();
  return (
    <nav className="tn" aria-label={model.label}>
      <div className="tn-tabs" role="list">
        {tabs.map((l) => (
          <Tab key={l.id} leaf={l} />
        ))}
        <button type="button" className="tn-tab" popoverTarget="tn-more" style={anchor.style} aria-haspopup="menu" aria-current={moreOn ? "page" : undefined} data-tip={moreOn?.label ?? t("app.nav.moreTools")}>
          <Icon name={moreOn?.icon ?? "grid"} size={15} />
          <span>{moreOn?.label ?? t("app.nav.moreTools")}</span>
          <Icon name="chevron" size={11} className="tn-chev" />
        </button>
        <Popover id="tn-more" anchor={anchor.name} role="menu" label={t("app.nav.moreTools")}>
          {more.map((l) => (
            <MenuItem key={l.id} icon={l.icon} kbd={l.shortcut} onSelect={l.onSelect}>
              {l.label}
            </MenuItem>
          ))}
        </Popover>
      </div>
      {settings && (
        <button
          type="button"
          className="tn-tab tn-settings"
          aria-current={inSettings ? "page" : undefined}
          data-tip={settings.label}
          onClick={() => (inSettings ? undefined : settings.children[0]?.onSelect())}
        >
          <Icon name="settings" size={15} />
          <span>{settings.label}</span>
        </button>
      )}
    </nav>
  );
}

function Tab({ leaf: l }: { leaf: IslandLeaf }) {
  return (
    <button type="button" role="listitem" className="tn-tab" aria-label={l.label} aria-current={l.current ? "page" : undefined} data-tip={l.label} data-tip-kbd={l.shortcut} onClick={l.onSelect}>
      <Icon name={l.icon} size={15} />
      <span>{l.label}</span>
      {l.count !== undefined && <span className="tn-count">{l.count}</span>}
      {!!l.badge && <span className="tn-badge">{l.badge}</span>}
    </button>
  );
}
