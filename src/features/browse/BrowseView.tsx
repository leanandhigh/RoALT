import "./browse.css";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { api, type AccountSummary, type BrowseBlocked, type BrowsePage, type BrowsePlay } from "../../api";
import type { BrowseRequest } from "../../app/navigation";
import { useSettings } from "../../data";
import { t, type Key } from "../../i18n";
import { Button, IconButton } from "../../ui/Button";
import { Icon, type IconName } from "../../ui/Icon";
import { readStored, writeStored } from "../../ui/stored";
import { toast, toastError } from "../../ui/Toast";
import { AccountSwitch } from "./AccountSwitch";
import { launchOne, launchStep } from "../launch/launchQueue";
import { useMoveConfirm } from "../launch/MoveDialog";
import { useGameDetails } from "./GameDetails";
import { PlaytimeTab, PopularTab } from "./Native";
import { usePageCard } from "./pageCard";
import { usePlayerDetails } from "./PlayerDetails";
import { RobloxPane } from "./RobloxPane";

const LAST_KEY = "mtwin.browseAccount";
const lastAccount = () => Number(readStored(LAST_KEY)) || null;
const remember = (id: number) => writeStored(LAST_KEY, String(id));

/** The page Browse last showed: coming back to Browse goes on from there, not from its home. */
let lastPath = "home";
/** The last "Open on roblox.com" Browse followed: coming back to Browse later doesn't follow it again. */
let askDone = 0;
/** A page that starts a game as it loads (a private server or share link): never loaded again. */
const launches = (path: string) => /^(share|games\/start)\b|[?&]privateserverlinkcode=/i.test(path);
/** The place of a game's page ("games/920587237/Adopt-Me", maybe under a language: "de/games/..."). */
const placeOf = (path: string) => Number(/^(?:[a-z]{2}(?:-[a-z]{2,4})?\/)?games\/(\d{1,15})(?:[/?#]|$)/i.exec(path)?.[1]) || null;
/** The player of a profile page ("users/156/profile", maybe under a language). */
const userOf = (path: string) => Number(/^(?:[a-z]{2}(?:-[a-z]{2,4})?\/)?users\/(\d{1,15})\/profile(?:[/?#]|$)/i.exec(path)?.[1]) || null;

/** Roblox's own pages, as tabs. */
const PAGES: { id: string; path: string; label: Key; icon: IconName }[] = [
  { id: "home", path: "home", label: "browse.tab.home", icon: "home" },
  { id: "games", path: "charts", label: "browse.tab.games", icon: "grid" },
  { id: "market", path: "catalog", label: "browse.tab.market", icon: "star" },
  { id: "avatar", path: "my/avatar", label: "browse.tab.avatar", icon: "palette" },
  { id: "friends", path: "users/friends", label: "browse.tab.friends", icon: "accounts" },
];
type Native = "popular" | "playtime";
const BLOCKED: Record<BrowseBlocked, Key> = {
  create: "browse.blocked.create",
  robux: "browse.blocked.robux",
  money: "browse.blocked.money",
  signOut: "browse.blocked.signOut",
};

/** The tab a page belongs to; "" for none of them (a game, a profile). */
const tabOf = (path: string) => PAGES.find((p) => path === p.path || path.startsWith(`${p.path}/`) || path.startsWith(`${p.path}?`))?.id ?? "";

/** Browse: roblox.com inside MTwin Manager as one of the accounts (its own session), with Roblox's main pages
 * as tabs, back / forward / reload and a search. Create isn't there. `ask`: an account's "Open on
 * roblox.com" (each one new). */
export function BrowseView({ accounts, ask }: { accounts: AccountSummary[]; ask: (BrowseRequest & { n: number }) | null }) {
  const pick = (id: number | null | undefined) => (id != null && accounts.some((a) => a.id === id) ? id : null);
  // An ask not followed yet (Browse opened by it); otherwise Browse goes on where it was.
  const fresh = ask && ask.n > askDone ? ask : null;
  const [accountId, setAccountId] = useState<number | null>(() => pick(fresh?.accountId) ?? pick(lastAccount()) ?? accounts.find((a) => a.status === "valid")?.id ?? accounts[0]?.id ?? null);
  // What to load; `n` loads it again (the same search, a game opened again).
  const [page, setPage] = useState({ path: fresh ? (fresh.path ?? "home") : lastPath, n: 0 });
  // What the page shows now (it navigates by itself too).
  const [shown, setShown] = useState(page.path);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"people" | "games">("people");
  const [query, setQuery] = useState("");
  // One of MTwin Manager's own tabs, over Roblox's page (which stays where it was, hidden).
  const [native, setNative] = useState<Native | null>(null);
  // Counts Browse's page reports: a reload of the same page needs the profile card again.
  const [seq, setSeq] = useState(0);

  const go = (path: string) => {
    setNative(null);
    setPage((p) => ({ path, n: p.n + 1 }));
  };
  // Asked again while on screen (another account's "Open on roblox.com").
  const [askSeen, setAskSeen] = useState(ask?.n);
  if (ask && ask.n !== askSeen) {
    setAskSeen(ask.n);
    if (pick(ask.accountId) !== null) setAccountId(ask.accountId);
    setPage((p) => ({ path: ask.path ?? "home", n: p.n + 1 }));
  }
  // The account was removed: the first one left.
  if (accountId !== null && pick(accountId) === null) setAccountId(accounts[0]?.id ?? null);

  useEffect(() => {
    if (ask) askDone = Math.max(askDone, ask.n);
  }, [ask]);
  useEffect(() => {
    if (accountId !== null) remember(accountId);
  }, [accountId]);
  useEffect(() => {
    const un = listen<BrowsePage>("browse://page", (e) => {
      if (e.payload.accountId !== accountId) return;
      if (!launches(e.payload.path)) lastPath = e.payload.path;
      setShown(e.payload.path);
      setSeq((n) => n + 1);
    });
    return () => void un.then((f) => f());
  }, [accountId]);

  // Play or Join on Roblox's page: MTwin Manager launches the account (asking first when it already plays).
  const move = useMoveConfirm();
  const play = useRef<(p: BrowsePlay) => void>(() => {});
  play.current = ({ accountId: id, target }) => {
    const a = accounts.find((x) => x.id === id);
    if (!a) return;
    // One launch at a time: launchOne would do nothing.
    if (launchStep() !== null) return toast(t("browse.busy"), "error");
    if (move.liveOf(a)) move.ask(a, (from) => void launchOne(a, target, undefined, from));
    else void launchOne(a, target);
  };
  useEffect(() => {
    const un = listen<BrowsePlay>("browse://play", (e) => play.current(e.payload));
    return () => void un.then((f) => f());
  }, []);
  // What Browse refused: Create, and spending while purchases are locked.
  useEffect(() => {
    const un = listen<BrowseBlocked>("browse://blocked", (e) => toast(t(BLOCKED[e.payload]), "error"));
    return () => void un.then((f) => f());
  }, []);

  const search = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    go(kind === "people" ? `search/users?keyword=${encodeURIComponent(q)}` : `discover?Keyword=${encodeURIComponent(q)}`);
  };
  const nav = (action: "back" | "forward" | "reload") => {
    setNative(null);
    void api.browseNav(action).catch(toastError);
  };
  const account = accounts.find((a) => a.id === accountId);
  const details = useGameDetails();
  const player = usePlayerDetails(account?.id ?? 0);
  const gamePage = native ? null : placeOf(shown);
  const profilePage = native ? null : userOf(shown);
  usePageCard(account?.id ?? null, userOf(shown), seq, useSettings().data?.rolimonsValues ?? false);
  // A game card's buttons: its page here, or a launch as the account browsing.
  const open = (placeId: number) => go(`games/${placeId}`);
  const playPlace = (placeId: number) => account && play.current({ accountId: account.id, target: { kind: "place", placeId, launchData: null } });

  if (!account)
    return (
      <main className="flex-1 min-w-0 page grid place-items-center">
        <p className="text-fg-2">{t("browse.none")}</p>
      </main>
    );

  return (
    <main className="flex-1 min-w-0 min-h-0 bx">
      {/* The rail: who browses, Roblox's pages, MTwin Manager's own lists, search. Icons only when narrow. */}
      <aside className="bx-rail">
        <AccountSwitch
          accounts={accounts}
          value={account}
          onChange={(id) => {
            setAccountId(id);
            go("home");
          }}
        />
        <nav className="bx-nav" aria-label={t("browse.pages")}>
          <p className="bx-label">{t("browse.roblox")}</p>
          {PAGES.map((p) => (
            <RailItem key={p.id} icon={p.icon} label={t(p.label)} on={!native && tabOf(shown) === p.id} onClick={() => go(p.path)} />
          ))}
          <p className="bx-label">{t("browse.mtwin")}</p>
          <RailItem icon="bolt" label={t("browse.tab.popular")} on={native === "popular"} onClick={() => setNative("popular")} />
          <RailItem icon="clock" label={t("browse.tab.playtime")} on={native === "playtime"} onClick={() => setNative("playtime")} />
        </nav>
      </aside>

      <section className="bx-main">
        <div className="bx-bar">
          <span className="bx-navbtns">
            <IconButton icon="back" label={t("browse.back")} data-tip-side="bottom" onClick={() => nav("back")} />
            <IconButton icon="back" className="browse-forward" label={t("browse.forward")} data-tip-side="bottom" onClick={() => nav("forward")} />
            <IconButton icon="refresh" label={t("browse.reload")} data-tip-side="bottom" onClick={() => nav("reload")} />
          </span>
          <form className="bx-search" onSubmit={search}>
            <Icon name="search" size={14} className="bx-search-icon" />
            <input
              data-find
              className="bx-search-input"
              aria-label={t("browse.search")}
              placeholder={native ? t("browse.search") : `roblox.com/${shown}`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="bx-kind" role="radiogroup" aria-label={t("browse.searchFor")}>
              {(["people", "games"] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>
                  {t(k === "people" ? "browse.people" : "browse.games")}
                </button>
              ))}
            </span>
          </form>
          {gamePage && (
            <Button
              size="sm"
              variant="ghost"
              icon="copy"
              onClick={() => writeText(String(gamePage)).then(() => toast(t("browse.placeCopied", { id: String(gamePage) })), toastError)}
            >
              {t("browse.copyPlace")}
            </Button>
          )}
          {profilePage && (
            <Button size="sm" variant="ghost" icon="info" onClick={() => player.open(profilePage)}>
              {t("player.detailsTip")}
            </Button>
          )}
        </div>
        {error && !native && <p role="alert" className="alert">{error}</p>}
        <div className="browse-stage">
          <RobloxPane accountId={account.id} path={page.path} n={page.n} hidden={!!native} resume={lastPath} onError={setError} />
          {native && (
            <div className="browse-native scroll">
              {native === "popular" ? (
                <PopularTab onOpen={open} onPlay={playPlace} onDetails={details.open} />
              ) : (
                <PlaytimeTab accounts={accounts} onOpen={open} onPlay={playPlace} onDetails={details.open} />
              )}
            </div>
          )}
        </div>
      </section>
      {move.dialog}
      {details.dialog}
      {player.dialog}
    </main>
  );
}

function RailItem({ icon, label, on, onClick }: { icon: IconName; label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className="bx-item" aria-current={on ? "page" : undefined} aria-label={label} data-tip={label} data-tip-side="right" onClick={onClick}>
      <Icon name={icon} size={16} />
      <span>{label}</span>
    </button>
  );
}
