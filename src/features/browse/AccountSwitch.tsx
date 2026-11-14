import { useState } from "react";
import type { AccountSummary } from "../../api";
import { t } from "../../i18n";
import { Icon } from "../../ui/Icon";
import { Popover, useAnchor } from "../../ui/Popover";
import { accountName, Avatar } from "../accounts/shared";

/** Who Browse is signed in as: the account's face, name and @username, and a list of the others
 * (searchable when there are many) to switch to. */
export function AccountSwitch({ accounts, value, onChange }: { accounts: AccountSummary[]; value: AccountSummary; onChange: (id: number) => void }) {
  const anchor = useAnchor();
  const [q, setQ] = useState("");
  const n = q.trim().toLowerCase();
  const shown = accounts.filter((a) => !n || `${a.alias}\n${a.displayName}\n${a.username}`.toLowerCase().includes(n));
  return (
    <>
      <button type="button" className="bx-who" popoverTarget="bx-accounts" style={anchor.style} aria-haspopup="listbox" aria-label={t("browse.as")} data-tip={t("browse.as")}>
        <Avatar account={value} size={32} />
        <span className="bx-who-text">
          <b>{accountName(value)}</b>
          <span>@{value.username}</span>
        </span>
        <Icon name="chevron" size={12} className="bx-who-chev" />
      </button>
      <Popover id="bx-accounts" anchor={anchor.name} role="listbox" label={t("browse.as")} className="bx-accounts" onToggle={(open) => !open && setQ("")}>
        {accounts.length > 6 && (
          <input className="field bx-accounts-find" placeholder={t("accounts.filterPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("accounts.filterLabel")} />
        )}
        <div className="bx-accounts-list scroll">
          {shown.map((a) => (
            <button
              key={a.id}
              type="button"
              role="option"
              aria-selected={a.id === value.id}
              className="bx-acc"
              onClick={(e) => {
                (e.currentTarget.closest("[popover]") as HTMLElement | null)?.hidePopover();
                if (a.id !== value.id) onChange(a.id);
              }}
            >
              <Avatar account={a} size={26} />
              <span className="bx-who-text">
                <b>{accountName(a)}</b>
                <span>@{a.username}</span>
              </span>
              {a.status !== "valid" && <Icon name="alert" size={13} className="bx-acc-warn" />}
              {a.id === value.id && <Icon name="check" size={14} className="bx-acc-on" />}
            </button>
          ))}
          {!shown.length && <p className="meta px-2 py-3">{t("accounts.noMatch")}</p>}
        </div>
      </Popover>
    </>
  );
}
