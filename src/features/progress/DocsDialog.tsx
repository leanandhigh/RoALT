import { useEffect, useRef, useState, type ReactNode } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { t, type Key } from "../../i18n";
import { Icon, type IconName } from "../../ui/Icon";
import { Dialog } from "../../ui/Dialog";
import { toastError } from "../../ui/Toast";

const loader = (host: string) => `repeat task.wait() until game:IsLoaded()

getgenv().ProgressConfig = {
    ["PC_NAME"] = "PC1",   -- a different name on each PC
    ["Interval"] = 10,     -- seconds between reports (optional)
}

while not getgenv().ProgressViewerLoaded do
    pcall(function() loadstring(game:HttpGet("http://${host}/script.luau"))() end)
    task.wait(3)
end`;

const EVERY_GAME = `-- leaderstats from any game: numbers become values, "Level" becomes the level,
-- text (like a rank) becomes a stat.
local stats = P.player:FindFirstChild("leaderstats")
if stats then
	for _, v in ipairs(stats:GetChildren()) do
		if v:IsA("ValueBase") then
			if v.Name:lower():find("level") then
				level(v.Value)
			elseif num(v.Value) then
				value(v.Name, v.Value)
			else
				stat(v.Name, v.Value)
			end
		end
	end
end

-- Many games keep the level as an attribute on the player.
level(P.player:GetAttribute("Level"))`;

const VALUES = `-- From leaderstats:
value("Coins", read("leaderstats.Coins"))

-- From a TextLabel on screen (its number: "1,234" -> 1234):
value("Gems", read("PlayerGui.MainGui.Currency.Gems.Amount"))

-- From an attribute on the player, with a picture (a decal id):
value("Candy", read("Player@Candy"), { image = 1234567890 })

-- From any service:
value("Tokens", read("ReplicatedStorage.PlayerData." .. P.player.Name .. ".Tokens"))

-- Level and stats (text like "Battle Pass 4 / 30"):
level(read("leaderstats.Level"))
stat("Battle Pass", read("Player@BattlePassTier"), 30)
stat("Rank", P.player:GetAttribute("Rank"))`;

const MODULE = `-- find() returns the table a ModuleScript gives back (it runs require for you).
local data = find("ReplicatedStorage.Modules.ProfileData")
if data then
	value("Coins", data.Coins)
	level(data.Level)

	-- A whole { [id] = count } table, all in one category:
	items(data.Materials, { category = "Materials" })
end`;

const ITEMS = `-- The game's item database gives each item's name, rarity and picture.
local data = find("ReplicatedStorage.Modules.ProfileData")
local db = find("ReplicatedStorage.Database.Items")      -- { [id] = { Name, Rarity, Image } }
if data and db then
	for _, kind in ipairs({ "Weapons", "Pets" }) do
		items(data[kind], function(id, count)
			local info = db[id] or {}
			return {
				name = info.Name,          -- shown name
				rarity = info.Rarity,      -- "Common", "Legendary", "Godly"...
				category = kind,           -- the filter chips on the Items tab
				image = info.Image,        -- decal/image id, or "rbxassetid://..."
			}
		end)
	end
end

-- One item by hand:
item("StarterSword", 1, { name = "Starter Sword", rarity = "Common", category = "Weapons", image = 1234567890 })`;

const REMOTE = `-- Some games only hand data out through a remote.
local remote = find("ReplicatedStorage.Remotes.GetInventory")
if remote then
	local ok, inv = pcall(function() return remote:InvokeServer() end)
	if ok and type(inv) == "table" then
		value("Coins", inv.Coins)
		items(inv.Items, { category = "Inventory" })
	end
end`;

const HELPERS: [string, Key][] = [
  ['value(name, amount, { key, image })', "progress.docsHValue"],
  ['item(id, count, { name, rarity, category, image })', "progress.docsHItem"],
  ["items(tbl, opts)", "progress.docsHItems"],
  ["items(tbl, function(id, count) return opts end)", "progress.docsHItemsFn"],
  ["stat(name, text, max)", "progress.docsHStat"],
  ["level(n)", "progress.docsHLevel"],
  ['read("path")', "progress.docsHRead"],
  ['find("path")', "progress.docsHFind"],
  ["num(v)", "progress.docsHNum"],
  ["P.player · P.require(m) · P.report", "progress.docsHP"],
];

/** Lua, coloured: comments, strings, numbers, keywords and calls (pure; the text is escaped by React). */
const KEYWORDS = new Set(["local", "function", "end", "if", "then", "else", "elseif", "for", "in", "do", "while", "repeat", "until", "return", "not", "and", "or", "nil", "true", "false"]);
function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(--[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(\b\d[\d.]*\b)|([A-Za-z_][A-Za-z0-9_]*)(\s*\()?/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index));
    if (m[1]) out.push(<span key={k++} className="lx-c">{m[1]}</span>);
    else if (m[2]) out.push(<span key={k++} className="lx-s">{m[2]}</span>);
    else if (m[3]) out.push(<span key={k++} className="lx-n">{m[3]}</span>);
    else if (m[4]) {
      const cls = KEYWORDS.has(m[4]) ? "lx-k" : m[5] ? "lx-f" : undefined;
      out.push(cls ? <span key={k++} className={cls}>{m[4]}</span> : m[4]);
      if (m[5]) out.push(m[5]);
    }
    last = re.lastIndex;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

function Code({ code, file }: { code: string; file?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <figure className="dx-code">
      <figcaption>
        <span className="dx-lang">Lua</span>
        {file && <span className="dx-file">{file}</span>}
        <button
          type="button"
          className="dx-copy"
          onClick={() =>
            writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }, toastError)
          }
        >
          <Icon name={copied ? "check" : "copy"} size={13} />
          {t(copied ? "progress.copied" : "progress.docsCopy")}
        </button>
      </figcaption>
      <pre dir="ltr">
        <code>{highlight(code)}</code>
      </pre>
    </figure>
  );
}

function Callout({ kind, children }: { kind: "note" | "tip" | "warn"; children: ReactNode }) {
  const icon: IconName = kind === "warn" ? "alert" : kind === "tip" ? "bolt" : "info";
  return (
    <div className="dx-call" data-kind={kind}>
      <Icon name={icon} size={15} />
      <div>{children}</div>
    </div>
  );
}

type Page = { id: string; title: Key; icon: IconName };
const NAV: { group: Key; pages: Page[] }[] = [
  {
    group: "progress.docsNavStart",
    pages: [
      { id: "overview", title: "progress.docsNavOverview", icon: "book" },
      { id: "loader", title: "progress.docsLoader", icon: "download" },
      { id: "every", title: "progress.docsEvery", icon: "globe" },
      { id: "game", title: "progress.docsGame", icon: "code" },
    ],
  },
  {
    group: "progress.docsNavRecipes",
    pages: [
      { id: "values", title: "progress.docsValues", icon: "coin" },
      { id: "module", title: "progress.docsModule", icon: "database" },
      { id: "items", title: "progress.docsItems", icon: "star" },
      { id: "remote", title: "progress.docsRemote", icon: "link" },
    ],
  },
  {
    group: "progress.docsNavReference",
    pages: [
      { id: "helpers", title: "progress.docsHelpers", icon: "tools" },
      { id: "paths", title: "progress.docsPaths", icon: "folder" },
      { id: "pictures", title: "progress.docsPictures", icon: "eye" },
      { id: "order", title: "progress.docsOrder", icon: "sliders" },
    ],
  },
];

function Section({ id, title, children }: { id: string; title: Key; children: ReactNode }) {
  return (
    <section id={`dx-${id}`} data-dx={id} className="dx-sec">
      <h2>
        <a href={`#dx-${id}`} onClick={(e) => e.preventDefault()} aria-hidden="true" tabIndex={-1}>#</a>
        {t(title).replace(/^\d+\.\s*/, "")}
      </h2>
      {children}
    </section>
  );
}

/** How to set Progress up, laid out as a docs site: a sidebar of pages in three groups (where you are
 * is marked as you scroll), start-here cards, coloured code with a copy button, notes and tips, and
 * the helpers as a reference. */
export function DocsDialog({ open, onClose, host }: { open: boolean; onClose: () => void; host: string }) {
  const main = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState("overview");
  // A section picked in the list stays lit while the page scrolls to it (and after, when it is too
  // near the end to reach the top).
  const picked = useRef<{ id: string; until: number } | null>(null);
  useEffect(() => {
    const el = main.current;
    if (!open || !el) return;
    const spy = () => {
      if (picked.current && performance.now() < picked.current.until) return setAt(picked.current.id);
      picked.current = null;
      const box = el.getBoundingClientRect();
      const sections = [...el.querySelectorAll<HTMLElement>("[data-dx]")];
      // At the very end, the last section whose heading shows: the short ones there never reach the top.
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) {
        const shown = sections.filter((s) => s.getBoundingClientRect().top < box.bottom - 40);
        return setAt(shown.at(-1)?.dataset.dx ?? "overview");
      }
      let cur = "overview";
      for (const s of sections) if (s.getBoundingClientRect().top <= box.top + 24) cur = s.dataset.dx!;
      setAt(cur);
    };
    el.addEventListener("scroll", spy, { passive: true });
    return () => el.removeEventListener("scroll", spy);
  }, [open]);
  const go = (id: string) => {
    const el = main.current?.querySelector<HTMLElement>(`[data-dx="${id}"]`);
    const box = main.current;
    picked.current = { id, until: performance.now() + 900 };
    if (el && box) box.scrollTo({ top: el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 4, behavior: "smooth" });
    setAt(id);
  };
  const steps: { id: string; title: Key; text: Key; icon: IconName }[] = [
    { id: "loader", title: "progress.docsLoader", text: "progress.docsCardLoader", icon: "download" },
    { id: "every", title: "progress.docsEvery", text: "progress.docsCardEvery", icon: "globe" },
    { id: "game", title: "progress.docsGame", text: "progress.docsCardGame", icon: "code" },
  ];
  return (
    <Dialog open={open} onClose={onClose} title={t("progress.docs")} width={1080}>
      <div className="dx">
        <nav className="dx-nav" aria-label={t("progress.docs")}>
          {NAV.map((g) => (
            <div key={g.group} className="dx-group">
              <span className="dx-group-k">{t(g.group)}</span>
              {g.pages.map((p) => (
                <button key={p.id} type="button" className="dx-link" aria-current={at === p.id ? "location" : undefined} onClick={() => go(p.id)}>
                  {t(p.title).replace(/^\d+\.\s*/, "")}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div ref={main} className="dx-main">
          <section data-dx="overview" className="dx-sec dx-hero">
            <span className="dx-eyebrow">{t("progress.docsEyebrow")}</span>
            <h1>{t("progress.docsTitle")}</h1>
            <p className="dx-lead">{t("progress.docsLead")}</p>
            <div className="dx-cards">
              {steps.map((c, i) => (
                <button key={c.id} type="button" className="dx-card" onClick={() => go(c.id)}>
                  <span className="dx-card-n">{i + 1}</span>
                  <Icon name={c.icon} size={16} />
                  <b>{t(c.title).replace(/^\d+\.\s*/, "")}</b>
                  <span>{t(c.text)}</span>
                </button>
              ))}
            </div>
          </section>

          <Section id="loader" title="progress.docsLoader">
            <p>{t("progress.docsLoaderText")}</p>
            <Code code={loader(host)} file="autoexec/progress.lua" />
            <Callout kind="tip">{t("progress.docsTipPc")}</Callout>
          </Section>
          <Section id="every" title="progress.docsEvery">
            <p>{t("progress.docsEveryText")}</p>
            <Code code={EVERY_GAME} file="Every game" />
          </Section>
          <Section id="game" title="progress.docsGame">
            <p>{t("progress.docsGameText")}</p>
            <Callout kind="note">{t("progress.docsNoteDex")}</Callout>
          </Section>

          <Section id="values" title="progress.docsValues">
            <Code code={VALUES} file="This game" />
            <Callout kind="tip">{t("progress.docsTipSuffix")}</Callout>
          </Section>
          <Section id="module" title="progress.docsModule">
            <Code code={MODULE} file="This game" />
          </Section>
          <Section id="items" title="progress.docsItems">
            <Code code={ITEMS} file="This game" />
          </Section>
          <Section id="remote" title="progress.docsRemote">
            <Code code={REMOTE} file="This game" />
            <Callout kind="warn">{t("progress.docsWarnRemote")}</Callout>
          </Section>

          <Section id="helpers" title="progress.docsHelpers">
            <div className="dx-ref">
              {HELPERS.map(([sig, what]) => (
                <div key={sig} className="dx-ref-row">
                  <code dir="ltr">{sig}</code>
                  <span>{t(what)}</span>
                </div>
              ))}
            </div>
          </Section>
          <Section id="paths" title="progress.docsPaths">
            <p>{t("progress.docsPathsText")}</p>
          </Section>
          <Section id="pictures" title="progress.docsPictures">
            <p>{t("progress.docsPicturesText")}</p>
          </Section>
          <Section id="order" title="progress.docsOrder">
            <p>{t("progress.docsOrderText")}</p>
          </Section>
        </div>
      </div>
    </Dialog>
  );
}
