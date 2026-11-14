//! Progress: what each alt has in game (level, values like coins or candy, items), reported by a
//! script the executor runs in each client.
//!
//! MTwin Manager listens on `http://127.0.0.1:16390` (this PC only):
//! - `GET /script.luau`: the reporter (`progress.luau`), with this address filled in. The loader
//!   the Progress view hands out (`Get script`) loads it from here, like an MCP bridge's autoexec.
//! - `POST /report` (or `GET /report?d=<json>` for executors without `request`): one account's
//!   report, every 10 s.
//! - `GET /catalog?game=<universe id>`: the values and items added by hand in the Catalog that
//!   have a path to read, so the script reads them too.
//! - `GET /collector?game=<universe id>`: the Luau the script runs for that game, `{ all, game }`:
//!   "Every game" (`ALL`, by default `DEFAULT_ALL`) and the game's own, both written in the
//!   Progress view's Script tab. The reporter knows no game by itself.
//!
//! Reports and the Catalog are kept in `progress.json` in the data folder (not the vault: nothing
//! in them is secret). Nothing here talks to Roblox except the pictures (`images`, decal ids).

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use ts_rs::TS;

use crate::App;
use crate::commands::now_ms;
use crate::error::{AppError, Result};

pub const PORT: u16 = 16390;
/// The progress website on the network (`web_share` on): read-only, and every request needs the key.
pub const WEB_PORT: u16 = 16391;
const WEB_PAGE: &str = include_str!("progress_web.html");
/// The website's logo and tab icon: the app's own icon.
const WEB_LOGO: &[u8] = include_bytes!("../icons/128x128.png");
/// An account is online while it reported within this (the script reports every 10 s).
const ONLINE_MS: i64 = 30_000;
const MAX_HEAD: usize = 16 * 1024;
const MAX_BODY: usize = 2 * 1024 * 1024;
const FILE: &str = "progress.json";
const REPORTER: &str = include_str!("progress.luau");
/// The Script key of "Every game".
pub const ALL: &str = "*";
const MAX_SCRIPT: usize = 200 * 1024;
/// "Every game" until it is edited: leaderstats and a Level attribute.
pub const DEFAULT_ALL: &str = r#"-- Runs in every game, before the game's own script.
-- leaderstats: numbers become values (Level becomes the level), text becomes stats.
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
level(P.player:GetAttribute("Level"))
"#;

/// A number an account has: coins, candy, a material.
#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProgressValue {
    pub key: String,
    pub name: String,
    pub amount: f64,
    /// A Roblox decal (or image) id; empty: none.
    #[serde(default)]
    pub image: String,
}

/// A line of text an account has ("Battle Pass" 4 of 30).
#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProgressStat {
    pub key: String,
    pub name: String,
    pub value: String,
    #[serde(default)]
    pub max: Option<f64>,
}

/// Something an account owns, `count` of it.
#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProgressItem {
    pub id: String,
    pub name: String,
    pub rarity: String,
    /// Weapons, Pets, Materials…
    pub category: String,
    pub count: f64,
    /// A Roblox decal (or image) id; empty: none.
    #[serde(default)]
    pub image: String,
}

/// One account in one game, as its last report said.
#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProgressAccount {
    /// `<game id>:<user id>`.
    pub key: String,
    /// The PC_NAME the script was given: groups accounts into machines.
    pub pc: String,
    /// The universe id (the place id where a game has none).
    pub game_id: String,
    pub game_name: String,
    /// The place the account is in (a game's start place, or one of its other places).
    #[serde(default)]
    pub place_id: Option<i64>,
    pub user_id: i64,
    pub name: String,
    pub display_name: String,
    pub level: Option<f64>,
    pub values: Vec<ProgressValue>,
    pub stats: Vec<ProgressStat>,
    pub items: Vec<ProgressItem>,
    /// What went wrong in the Script tab's scripts on its last report.
    #[serde(default)]
    pub errors: Vec<String>,
    /// Unix ms.
    pub first_seen: i64,
    /// Unix ms: its last report.
    pub last_seen: i64,
}

#[derive(Serialize, Deserialize, TS, Clone, Copy, Debug, PartialEq, Eq, Hash, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum CatalogKind {
    /// A number (coins, candy, a material): a column and a total.
    #[default]
    Value,
    /// Something owned, with a count: a card.
    Item,
}

/// A value or item added by hand for a game: its name, picture and rarity in MTwin Manager, and, with a
/// `source`, where the script reads it.
#[derive(Serialize, Deserialize, TS, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct CatalogEntry {
    /// The id the game (or the script) uses; a report's value key or item id with this id takes
    /// this entry's name, picture and rarity.
    pub id: String,
    pub kind: CatalogKind,
    pub name: String,
    /// Weapons, Pets, Materials… (items).
    pub category: String,
    pub rarity: String,
    /// A Roblox decal id; empty: what the script sends.
    pub image: String,
    /// Where the script reads it, e.g. `leaderstats.Coins` (`readPath` in progress.luau); empty:
    /// only named here.
    pub source: String,
}

/// Whether MTwin Manager is listening for reports.
#[derive(Serialize, TS, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProgressServer {
    pub port: u16,
    pub running: bool,
    /// Why it isn't (the port is taken), as the OS said it.
    pub error: Option<String>,
}

/// Everything the Progress view shows.
#[derive(Serialize, TS, Clone, Debug)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProgressState {
    pub accounts: Vec<ProgressAccount>,
    /// By game id.
    pub catalog: HashMap<String, Vec<CatalogEntry>>,
    /// Accounts that stopped reporting this long ago are removed; 0: never.
    pub auto_delete_hours: u32,
    pub server: ProgressServer,
    /// Unix ms, by MTwin Manager's clock (`lastSeen` is too).
    pub now: i64,
    pub online_ms: i64,
    /// The Script tab's Luau by game id, "*" for every game (missing: `default_all`).
    pub collectors: HashMap<String, String>,
    pub default_all: String,
    /// Games added by hand (`progress_game_add`), so their Catalog can be set up before anyone plays.
    pub games: Vec<String>,
}

/// A game's card: its name, icon and players now (`progress_games`).
#[derive(Serialize, TS, Clone, Debug)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProgressGame {
    pub universe_id: i64,
    /// The game's start place.
    pub root_place_id: i64,
    pub name: String,
    pub playing: i64,
    pub icon_url: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Stored {
    accounts: HashMap<String, ProgressAccount>,
    catalog: HashMap<String, Vec<CatalogEntry>>,
    auto_delete_hours: u32,
    games: Vec<String>,
    collectors: HashMap<String, String>,
    /// The website is also served to the network (`WEB_PORT`).
    web_share: bool,
    /// What a network request must carry (`?key=`); made when sharing is first turned on.
    web_key: String,
}

#[derive(Serialize, TS, Clone, Debug)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProgressWeb {
    /// This PC's address for the website.
    pub local_url: String,
    pub share: bool,
    /// The address to open on another device (with the key), when sharing and this PC has one.
    pub lan_url: Option<String>,
    /// Why the network listener isn't up, when sharing.
    pub error: Option<String>,
}

pub struct Progress {
    file: PathBuf,
    stored: Mutex<Stored>,
    dirty: AtomicBool,
    server: Mutex<ProgressServer>,
    /// Decal id → picture URL; None: Roblox has none.
    images: Mutex<HashMap<i64, Option<String>>>,
    /// Roblox user id → headshot URL, for the session.
    heads: Mutex<HashMap<i64, String>>,
    web_error: Mutex<Option<String>>,
    exec: Mutex<Exec>,
    /// What the page this PC is served must send to run a script (`/api/exec`); in no other page,
    /// so another site open in the browser can't make the clients run anything.
    exec_token: String,
}

/// Scripts sent from the progress website to clients, and how they went.
#[derive(Default)]
struct Exec {
    /// Account key → (id, code) not yet picked up by its reporter.
    queue: HashMap<String, Vec<(String, String)>>,
    /// Newest last, at most `EXEC_KEEP`.
    results: Vec<ExecResult>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct ExecResult {
    id: String,
    key: String,
    name: String,
    /// The script, cut to its first line, for the list.
    script: String,
    /// None while it waits or runs.
    ok: Option<bool>,
    picked: bool,
    output: String,
    at: i64,
}

const EXEC_KEEP: usize = 200;
const MAX_EXEC_CODE: usize = 64 * 1024;
/// A script no client picked up in this long is reported as such.
const EXEC_STALE_MS: i64 = 120_000;

impl Progress {
    pub fn new(data_dir: &std::path::Path) -> Self {
        let file = data_dir.join(FILE);
        let stored = match std::fs::read_to_string(&file) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
                log::warn!("progress: {FILE} unreadable, starting empty: {e}");
                Stored::default()
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Stored::default(),
            Err(e) => {
                log::warn!("progress: can't read {FILE}: {e}");
                Stored::default()
            }
        };
        Self {
            file,
            stored: Mutex::new(stored),
            dirty: AtomicBool::new(false),
            server: Mutex::new(ProgressServer { port: PORT, running: false, error: None }),
            images: Mutex::new(HashMap::new()),
            heads: Mutex::new(HashMap::new()),
            web_error: Mutex::new(None),
            exec: Mutex::new(Exec::default()),
            exec_token: uuid::Uuid::new_v4().simple().to_string(),
        }
    }

    fn stored(&self) -> std::sync::MutexGuard<'_, Stored> {
        self.stored.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn changed(&self) {
        self.dirty.store(true, Ordering::Relaxed);
    }

    /// Writes progress.json when something changed since (atomically: a temp file renamed over it).
    fn save(&self) {
        if !self.dirty.swap(false, Ordering::Relaxed) {
            return;
        }
        let text = match serde_json::to_string(&*self.stored()) {
            Ok(t) => t,
            Err(e) => return log::warn!("progress: can't serialize: {e}"),
        };
        let tmp = self.file.with_extension("json.tmp");
        if let Err(e) = std::fs::write(&tmp, text).and_then(|()| std::fs::rename(&tmp, &self.file)) {
            log::warn!("progress: can't save {FILE}: {e}");
            self.changed();
        }
    }

    fn auto_delete(&self) {
        let mut s = self.stored();
        if s.auto_delete_hours == 0 {
            return;
        }
        let cutoff = now_ms() - i64::from(s.auto_delete_hours) * 3_600_000;
        let before = s.accounts.len();
        s.accounts.retain(|_, a| a.last_seen >= cutoff);
        if s.accounts.len() != before {
            drop(s);
            self.changed();
        }
    }

    pub fn state(&self) -> ProgressState {
        let s = self.stored();
        let mut accounts: Vec<ProgressAccount> = s.accounts.values().cloned().collect();
        accounts.sort_by(|a, b| a.key.cmp(&b.key));
        ProgressState {
            accounts,
            catalog: s.catalog.clone(),
            auto_delete_hours: s.auto_delete_hours,
            server: self.server.lock().unwrap_or_else(|e| e.into_inner()).clone(),
            now: now_ms(),
            online_ms: ONLINE_MS,
            collectors: s.collectors.clone(),
            default_all: DEFAULT_ALL.to_owned(),
            games: s.games.clone(),
        }
    }

    /// What the website shows (no scripts, no catalog): the accounts, by game then name.
    /// Each reporting user's newest report: (user id, unix ms, the place it was in).
    pub fn last_reports(&self) -> Vec<(i64, i64, Option<i64>)> {
        let mut out: std::collections::HashMap<i64, (i64, Option<i64>)> = std::collections::HashMap::new();
        for a in self.stored().accounts.values() {
            let e = out.entry(a.user_id).or_insert((a.last_seen, a.place_id));
            if a.last_seen >= e.0 {
                *e = (a.last_seen, a.place_id.or(e.1));
            }
        }
        out.into_iter().map(|(u, (at, place))| (u, at, place)).collect()
    }

    fn web_json(&self) -> String {
        let s = self.stored();
        let heads = self.heads.lock().unwrap_or_else(|e| e.into_inner());
        let now = now_ms();
        let mut accounts: Vec<&ProgressAccount> = s.accounts.values().collect();
        accounts.sort_by(|a, b| a.game_name.cmp(&b.game_name).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        let rows: Vec<Value> = accounts
            .iter()
            .map(|a| {
                serde_json::json!({
                    "key": a.key, "pc": a.pc, "gameId": a.game_id, "gameName": a.game_name, "userId": a.user_id,
                    "name": a.name, "displayName": a.display_name, "level": a.level, "values": a.values, "stats": a.stats,
                    "items": a.items, "lastSeen": a.last_seen, "firstSeen": a.first_seen,
                    "online": now - a.last_seen <= ONLINE_MS, "head": heads.get(&a.user_id),
                })
            })
            .collect();
        // Pictures known so far for the decal ids of items and values (by id), and the Catalog's
        // own for items that have none of their own.
        let images = self.images.lock().unwrap_or_else(|e| e.into_inner());
        let mut pics = serde_json::Map::new();
        for a in &accounts {
            let catalog = s.catalog.get(&a.game_id);
            let ids = a.items.iter().map(|i| {
                if i.image.is_empty() { catalog.and_then(|c| c.iter().find(|e| e.id == i.id)).map_or("", |e| e.image.as_str()) } else { i.image.as_str() }
            });
            for id in ids.chain(a.values.iter().map(|v| v.image.as_str())) {
                if let Ok(n) = id.parse::<i64>()
                    && let Some(Some(url)) = images.get(&n)
                {
                    pics.insert(id.to_owned(), Value::String(url.clone()));
                }
            }
        }
        let catalog: serde_json::Map<String, Value> = s
            .catalog
            .iter()
            .map(|(game, list)| (game.clone(), Value::Object(list.iter().filter(|e| !e.image.is_empty()).map(|e| (e.id.clone(), Value::String(e.image.clone()))).collect())))
            .collect();
        serde_json::json!({ "now": now, "onlineMs": ONLINE_MS, "accounts": rows, "images": pics, "catalogImages": catalog }).to_string()
    }

    /// Decal ids of items and values (and their Catalog pictures) not looked up yet (at most `max`).
    fn missing_images(&self, max: usize) -> Vec<i64> {
        let s = self.stored();
        let images = self.images.lock().unwrap_or_else(|e| e.into_inner());
        let mut ids: HashSet<i64> = HashSet::new();
        for a in s.accounts.values() {
            for id in a.items.iter().map(|i| i.image.as_str()).chain(a.values.iter().map(|v| v.image.as_str())) {
                ids.extend(id.parse::<i64>().ok());
            }
        }
        for list in s.catalog.values() {
            ids.extend(list.iter().filter_map(|e| e.image.parse::<i64>().ok()));
        }
        ids.into_iter().filter(|id| *id > 0 && !images.contains_key(id)).take(max).collect()
    }

    fn exec(&self) -> std::sync::MutexGuard<'_, Exec> {
        self.exec.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Queues `code` for each of `targets` (account keys that have reported); their ids.
    fn exec_queue(&self, targets: &[String], code: &str) -> Vec<String> {
        let names: HashMap<String, String> = self.stored().accounts.values().map(|a| (a.key.clone(), if a.display_name.is_empty() { a.name.clone() } else { a.display_name.clone() })).collect();
        let first = code.lines().find(|l| !l.trim().is_empty()).unwrap_or_default().chars().take(80).collect::<String>();
        let mut x = self.exec();
        let mut ids = Vec::new();
        for key in targets.iter().filter(|k| names.contains_key(*k)).take(200) {
            let id = uuid::Uuid::new_v4().simple().to_string()[..12].to_owned();
            x.queue.entry(key.clone()).or_default().push((id.clone(), code.to_owned()));
            x.results.push(ExecResult { id: id.clone(), key: key.clone(), name: names[key].clone(), script: first.clone(), ok: None, picked: false, output: String::new(), at: now_ms() });
            ids.push(id);
        }
        let extra = x.results.len().saturating_sub(EXEC_KEEP);
        x.results.drain(..extra);
        ids
    }

    /// What the reporter of `key` is to run now (handed out once).
    fn exec_take(&self, key: &str) -> Vec<(String, String)> {
        let mut x = self.exec();
        let list = x.queue.remove(key).unwrap_or_default();
        for (id, _) in &list {
            if let Some(r) = x.results.iter_mut().find(|r| &r.id == id) {
                r.picked = true;
            }
        }
        list
    }

    fn exec_done(&self, id: &str, ok: bool, output: &str) {
        let mut x = self.exec();
        if let Some(r) = x.results.iter_mut().find(|r| r.id == id) {
            r.ok = Some(ok);
            r.output = output.chars().take(4000).collect();
        }
    }

    /// The results, newest first; one nobody picked up in `EXEC_STALE_MS` is given up on.
    fn exec_results(&self) -> String {
        let now = now_ms();
        let mut x = self.exec();
        let mut gone = Vec::new();
        for r in x.results.iter_mut().filter(|r| r.ok.is_none() && !r.picked && now - r.at > EXEC_STALE_MS) {
            r.ok = Some(false);
            r.output = "No client picked it up: is this account's reporter running?".into();
            gone.push((r.key.clone(), r.id.clone()));
        }
        for (key, id) in gone {
            if let Some(q) = x.queue.get_mut(&key) {
                q.retain(|(i, _)| *i != id);
            }
        }
        let list: Vec<&ExecResult> = x.results.iter().rev().collect();
        serde_json::to_string(&list).unwrap_or_else(|_| "[]".into())
    }

    /// User ids without a headshot yet (at most `max`).
    fn missing_heads(&self, max: usize) -> Vec<i64> {
        let ids: HashSet<i64> = self.stored().accounts.values().map(|a| a.user_id).filter(|id| *id > 0).collect();
        let heads = self.heads.lock().unwrap_or_else(|e| e.into_inner());
        ids.into_iter().filter(|id| !heads.contains_key(id)).take(max).collect()
    }

    fn web_key(&self) -> Option<String> {
        let s = self.stored();
        (s.web_share && !s.web_key.is_empty()).then(|| s.web_key.clone())
    }

    fn web(&self) -> ProgressWeb {
        let s = self.stored();
        let lan_url = (s.web_share && !s.web_key.is_empty())
            .then(lan_ip)
            .flatten()
            .map(|ip| format!("http://{ip}:{WEB_PORT}/?key={}", s.web_key));
        ProgressWeb {
            local_url: format!("http://127.0.0.1:{PORT}/"),
            share: s.web_share,
            lan_url,
            error: if s.web_share { self.web_error.lock().unwrap_or_else(|e| e.into_inner()).clone() } else { None },
        }
    }

    fn set_web(&self, share: bool, new_key: bool) {
        let mut s = self.stored();
        s.web_share = share;
        if share && (new_key || s.web_key.is_empty()) {
            s.web_key = uuid::Uuid::new_v4().simple().to_string()[..16].to_owned();
        }
        drop(s);
        self.changed();
    }

    /// Keeps one report; the reporter's user id and level, when it has one.
    fn accept(&self, body: &Value) -> std::result::Result<Option<(i64, f64)>, String> {
        let now = now_ms();
        let mut s = self.stored();
        let prev_first = |key: &str| s.accounts.get(key).map(|a| a.first_seen);
        let account = parse_report(body, now, prev_first)?;
        let level = account.level.filter(|_| account.user_id > 0).map(|l| (account.user_id, l));
        s.accounts.insert(account.key.clone(), account);
        drop(s);
        self.changed();
        Ok(level)
    }

    /// The Catalog entries of a game the script has to read (those with a path), as JSON.
    fn catalog_for_script(&self, game_id: &str) -> String {
        let s = self.stored();
        let list: Vec<Value> = s
            .catalog
            .get(game_id)
            .into_iter()
            .flatten()
            .filter(|e| !e.source.trim().is_empty())
            .map(|e| serde_json::json!({ "id": e.id, "name": e.name, "kind": e.kind, "source": e.source }))
            .collect();
        serde_json::to_string(&list).unwrap_or_else(|_| "[]".into())
    }

    /// What the script runs in a game: `{ all, game }`.
    fn collector_for_script(&self, game_id: &str) -> String {
        let s = self.stored();
        let all = s.collectors.get(ALL).map_or(DEFAULT_ALL, String::as_str);
        let own = s.collectors.get(game_id).map_or("", String::as_str);
        serde_json::json!({ "all": all, "game": own }).to_string()
    }
}

// ---------- reports ----------

fn text(v: &Value, max: usize) -> String {
    let s = match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        _ => String::new(),
    };
    s.trim().chars().filter(|c| !c.is_control()).take(max).collect()
}

fn num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => suffixed(s),
        _ => None,
    }
    .filter(|n: &f64| n.is_finite())
}

/// The scale of a number suffix games show ("K", "Qd", "Td"...), any case; as `progress.luau`'s.
fn suffix_scale(suffix: &str) -> Option<f64> {
    const NAMES: [(f64, &[&str]); 21] = [
        (1e3, &["k"]), (1e6, &["m", "mil"]), (1e9, &["b", "bil"]), (1e12, &["t", "tr", "tril"]),
        (1e15, &["qa", "qd", "q"]), (1e18, &["qn", "qi", "qt"]), (1e21, &["sx"]), (1e24, &["sp"]),
        (1e27, &["oc", "o"]), (1e30, &["no", "n"]), (1e33, &["dc", "d", "de"]), (1e36, &["ud", "un"]),
        (1e39, &["dd", "duo"]), (1e42, &["td", "tdd"]), (1e45, &["qad", "qtd"]), (1e48, &["qid", "qnd"]),
        (1e51, &["sxd"]), (1e54, &["spd"]), (1e57, &["ocd", "od"]), (1e60, &["nod", "nvd"]), (1e63, &["vg", "v"]),
    ];
    let s = suffix.to_ascii_lowercase();
    NAMES.iter().find(|(_, names)| names.contains(&s.as_str())).map(|(scale, _)| *scale)
}

/// A number as text: plain ("1,234.5"), scientific ("1.2e+15") or with a game's suffix ("$74.3Td",
/// "1.5K", "412 No"); currency signs and spaces around it are ignored (pure).
fn suffixed(text: &str) -> Option<f64> {
    let t = text.trim().replace(',', "");
    // A currency sign or other symbol may lead ("$74.3Td"); a word may not ("Human V4" is text).
    let t = t.trim_start_matches(|c: char| !(c.is_alphanumeric() || c == '-' || c == '.' || c.is_whitespace())).trim_start();
    if let Ok(n) = t.parse::<f64>() {
        return Some(n);
    }
    let end = t.find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-')).unwrap_or(t.len());
    let n: f64 = t[..end].parse().ok()?;
    let rest = t[end..].trim_start();
    let suffix: String = rest.chars().take_while(|c| c.is_ascii_alphabetic()).collect();
    if suffix.is_empty() {
        return rest.is_empty().then_some(n);
    }
    // Only the suffix may follow ("12 Coins" is a stat, not a number).
    let after = rest[suffix.len()..].trim();
    (after.is_empty() || after == "+").then_some(()).and(suffix_scale(&suffix)).map(|scale| n * scale)
}

/// The digits of a decal id ("rbxassetid://123", "123", 123); empty: none.
fn decal(v: &Value) -> String {
    let s = text(v, 80);
    let digits: String = s.chars().skip_while(|c| !c.is_ascii_digit()).take_while(char::is_ascii_digit).collect();
    if digits.len() > 18 { String::new() } else { digits }
}

fn list(v: &Value, max: usize) -> impl Iterator<Item = &Value> {
    v.as_array().into_iter().flatten().filter(|x| x.is_object()).take(max)
}

/// A report from the script, checked and trimmed. `first_seen`: the account's earlier first report.
fn parse_report(body: &Value, now: i64, first_seen: impl Fn(&str) -> Option<i64>) -> std::result::Result<ProgressAccount, String> {
    let acc = &body["account"];
    let user_id = num(&acc["userId"]).filter(|n| *n >= 1.0 && n.fract() == 0.0).ok_or("account.userId is required")? as i64;
    let game = &body["game"];
    let mut game_id = text(&game["id"], 40);
    if game_id.is_empty() || game_id == "0" {
        game_id = text(&game["placeId"], 40);
    }
    if game_id.is_empty() {
        game_id = "unknown".into();
    }
    let key = format!("{game_id}:{user_id}");
    // "values"; "currencies" from an older reporter.
    let values = if body["values"].is_array() { &body["values"] } else { &body["currencies"] };
    Ok(ProgressAccount {
        first_seen: first_seen(&key).unwrap_or(now),
        key,
        pc: Some(text(&body["pc"], 60)).filter(|s| !s.is_empty()).unwrap_or_else(|| "Unnamed PC".into()),
        game_name: Some(text(&game["name"], 80)).filter(|s| !s.is_empty()).unwrap_or_else(|| "Unknown game".into()),
        game_id,
        place_id: num(&game["placeId"]).filter(|n| *n >= 1.0 && n.fract() == 0.0).map(|n| n as i64),
        user_id,
        name: text(&acc["name"], 40),
        display_name: text(&acc["displayName"], 40),
        level: num(&body["level"]),
        values: list(values, 50)
            .filter_map(|c| {
                let name = text(&c["name"], 60);
                let key = Some(text(&c["key"], 80)).filter(|s| !s.is_empty()).unwrap_or_else(|| name.clone());
                let amount = num(&c["amount"])?;
                (!key.is_empty()).then(|| ProgressValue { name: if name.is_empty() { key.clone() } else { name }, key, amount, image: decal(&c["image"]) })
            })
            .collect(),
        stats: list(&body["stats"], 20)
            .filter_map(|s| {
                let name = text(&s["name"], 60);
                let key = Some(text(&s["key"], 80)).filter(|k| !k.is_empty()).unwrap_or_else(|| name.clone());
                (!name.is_empty()).then(|| ProgressStat { key, name, value: text(&s["value"], 60), max: num(&s["max"]) })
            })
            .collect(),
        items: list(&body["items"], 5000)
            .filter_map(|it| {
                let id = Some(text(&it["id"], 80)).filter(|s| !s.is_empty()).unwrap_or_else(|| text(&it["name"], 80));
                if id.is_empty() {
                    return None;
                }
                let category = Some(text(&it["category"], 30)).filter(|s| !s.is_empty()).unwrap_or_else(|| text(&it["type"], 30));
                Some(ProgressItem {
                    name: Some(text(&it["name"], 80)).filter(|s| !s.is_empty()).unwrap_or_else(|| id.clone()),
                    id,
                    rarity: text(&it["rarity"], 30),
                    category,
                    count: num(&it["count"]).unwrap_or(1.0).max(0.0),
                    image: decal(&it["image"]),
                })
            })
            .collect(),
        errors: body["errors"].as_array().into_iter().flatten().take(5).map(|e| text(e, 400)).filter(|e| !e.is_empty()).collect(),
        last_seen: now,
    })
}

// ---------- the local server ----------

/// Starts listening (once, at start) and the loop that saves and auto-deletes.
pub fn spawn(handle: AppHandle) {
    spawn_web(handle.clone());
    let h = handle.clone();
    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::bind(("127.0.0.1", PORT)).await {
            Ok(l) => l,
            Err(e) => {
                log::warn!("progress: can't listen on port {PORT}: {e}");
                *h.state::<App>().progress.server.lock().unwrap_or_else(|e| e.into_inner()) = ProgressServer { port: PORT, running: false, error: Some(e.to_string()) };
                return;
            }
        };
        *h.state::<App>().progress.server.lock().unwrap_or_else(|e| e.into_inner()) = ProgressServer { port: PORT, running: true, error: None };
        log::info!("progress: listening on 127.0.0.1:{PORT}");
        loop {
            let (stream, _) = match listener.accept().await {
                Ok(c) => c,
                Err(e) => {
                    log::debug!("progress: accept failed: {e}");
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    continue;
                }
            };
            let h = h.clone();
            tauri::async_runtime::spawn(async move {
                if tokio::time::timeout(Duration::from_secs(15), serve(&h, stream)).await.is_err() {
                    log::debug!("progress: a request timed out");
                }
            });
        }
    });
    tauri::async_runtime::spawn(async move {
        let mut ticks = 0u32;
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let p = &handle.state::<App>().progress;
            ticks += 1;
            if ticks.is_multiple_of(30) {
                p.auto_delete();
            }
            p.save();
        }
    });
}

struct Request {
    method: String,
    path: String,
    query: HashMap<String, String>,
    host: String,
    /// `Origin` and `X-Exec-Token`, for the script runner (`/api/exec`).
    origin: String,
    exec_token: String,
    body: Vec<u8>,
}

async fn read_request(stream: &mut TcpStream) -> Option<Request> {
    let mut buf = Vec::with_capacity(4096);
    let mut chunk = [0u8; 8192];
    let head_end = loop {
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i;
        }
        if buf.len() > MAX_HEAD {
            return None;
        }
        let n = stream.read(&mut chunk).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let mut lines = head.split("\r\n");
    let mut first = lines.next()?.split(' ');
    let method = first.next()?.to_owned();
    let target = first.next()?.to_owned();
    let mut length = 0usize;
    let mut host = String::new();
    let (mut origin, mut exec_token) = (String::new(), String::new());
    for line in lines {
        let Some((k, v)) = line.split_once(':') else { continue };
        match k.trim().to_ascii_lowercase().as_str() {
            "content-length" => length = v.trim().parse().ok()?,
            "host" => host = v.trim().to_owned(),
            "origin" => origin = v.trim().to_owned(),
            "x-exec-token" => exec_token = v.trim().to_owned(),
            _ => {}
        }
    }
    if length > MAX_BODY {
        return None;
    }
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < length {
        let n = stream.read(&mut chunk).await.ok()?;
        if n == 0 {
            return None;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(length);
    let url = url::Url::parse(&format!("http://localhost{target}")).ok()?;
    Some(Request {
        method,
        path: url.path().to_owned(),
        query: url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect(),
        host,
        origin,
        exec_token,
        body,
    })
}

async fn respond(stream: &mut TcpStream, status: &str, kind: &str, body: &str) {
    respond_bytes(stream, status, kind, body.as_bytes(), "no-store").await;
}

async fn respond_bytes(stream: &mut TcpStream, status: &str, kind: &str, body: &[u8], cache: &str) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: {cache}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.write_all(body).await;
    let _ = stream.shutdown().await;
}

async fn logo(stream: &mut TcpStream) {
    respond_bytes(stream, "200 OK", "image/png", WEB_LOGO, "max-age=86400").await;
}

const TEXT: &str = "text/plain; charset=utf-8";
const JSON: &str = "application/json; charset=utf-8";
const HTML: &str = "text/html; charset=utf-8";

/// Only what an address may hold, so it is safe inside the Luau string.
fn clean_host(host: &str) -> String {
    let h: String = host.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | ':' | '-' | '[' | ']')).take(100).collect();
    if h.is_empty() { format!("localhost:{PORT}") } else { h }
}

async fn serve(handle: &AppHandle, mut stream: TcpStream) {
    let Some(req) = read_request(&mut stream).await else {
        return respond(&mut stream, "400 Bad Request", TEXT, "bad request").await;
    };
    let progress = &handle.state::<App>().progress;
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/script.luau" | "/script.lua") => {
            let script = format!("local __PROGRESS_HOST = \"{}\"\n{REPORTER}", clean_host(&req.host));
            respond(&mut stream, "200 OK", TEXT, &script).await;
        }
        ("POST", "/report") | ("GET", "/report") => {
            let parsed = if req.method == "POST" {
                serde_json::from_slice::<Value>(&req.body).map_err(|e| e.to_string())
            } else {
                req.query.get("d").ok_or_else(|| "d is required".to_owned()).and_then(|d| serde_json::from_str(d).map_err(|e| e.to_string()))
            };
            match parsed.and_then(|v| progress.accept(&v)) {
                Ok(level) => {
                    if let Some((user_id, level)) = level {
                        crate::farm::on_level(handle, user_id, level);
                    }
                    respond(&mut stream, "200 OK", JSON, "{\"ok\":true}").await
                }
                Err(e) => respond(&mut stream, "400 Bad Request", JSON, &serde_json::json!({ "ok": false, "error": e }).to_string()).await,
            }
        }
        ("GET", "/collector") => {
            let game = req.query.get("game").map(String::as_str).unwrap_or_default();
            respond(&mut stream, "200 OK", JSON, &progress.collector_for_script(game)).await;
        }
        ("GET", "/catalog") => {
            let game = req.query.get("game").map(String::as_str).unwrap_or_default();
            respond(&mut stream, "200 OK", JSON, &progress.catalog_for_script(game)).await;
        }
        ("GET", "/" | "/index.html") => respond(&mut stream, "200 OK", HTML, &WEB_PAGE.replace("__EXEC_TOKEN__", &progress.exec_token)).await,
        ("GET", "/api/progress") => web_api(handle, &mut stream).await,
        ("GET", "/logo.png" | "/favicon.ico") => logo(&mut stream).await,
        // A reporter asks what to run; its account's key is "<game>:<user id>".
        ("GET", "/commands") => {
            let key = format!("{}:{}", req.query.get("game").map(String::as_str).unwrap_or_default(), req.query.get("user").map(String::as_str).unwrap_or_default());
            let list: Vec<Value> = progress.exec_take(&key).into_iter().map(|(id, code)| serde_json::json!({ "id": id, "code": code })).collect();
            respond(&mut stream, "200 OK", JSON, &Value::Array(list).to_string()).await;
        }
        ("POST", "/exec-result") | ("GET", "/exec-result") => {
            let v = if req.method == "POST" {
                serde_json::from_slice::<Value>(&req.body).ok()
            } else {
                req.query.get("d").and_then(|d| serde_json::from_str(d).ok())
            };
            if let Some(v) = v {
                progress.exec_done(v["id"].as_str().unwrap_or_default(), v["ok"].as_bool().unwrap_or(false), v["output"].as_str().unwrap_or_default());
            }
            respond(&mut stream, "200 OK", JSON, "{\"ok\":true}").await;
        }
        ("POST", "/api/exec") => {
            // Only the page this PC serves: it carries the token, and its own origin.
            let local_origin = req.origin.is_empty() || req.origin == format!("http://127.0.0.1:{PORT}") || req.origin == format!("http://localhost:{PORT}");
            if req.exec_token != progress.exec_token || !local_origin {
                return respond(&mut stream, "403 Forbidden", TEXT, "forbidden").await;
            }
            let v: Value = serde_json::from_slice(&req.body).unwrap_or(Value::Null);
            let code = v["code"].as_str().unwrap_or_default();
            if code.trim().is_empty() || code.len() > MAX_EXEC_CODE {
                return respond(&mut stream, "400 Bad Request", TEXT, "no script, or over 64 KB").await;
            }
            let targets: Vec<String> = v["targets"].as_array().into_iter().flatten().filter_map(|t| t.as_str().map(str::to_owned)).collect();
            let ids = progress.exec_queue(&targets, code);
            log::info!("progress website: a script queued for {} client(s)", ids.len());
            respond(&mut stream, "200 OK", JSON, &serde_json::json!({ "ids": ids }).to_string()).await;
        }
        ("GET", "/api/exec-results") => respond(&mut stream, "200 OK", JSON, &progress.exec_results()).await,
        _ => respond(&mut stream, "404 Not Found", TEXT, "not found").await,
    }
}

/// The website's data, with headshots fetched for accounts that have none yet.
async fn web_api(handle: &AppHandle, stream: &mut TcpStream) {
    let s = handle.state::<App>();
    let missing = s.progress.missing_heads(100);
    if !missing.is_empty() {
        match s.api.headshots(&missing).await {
            Ok(found) => s.progress.heads.lock().unwrap_or_else(|e| e.into_inner()).extend(found),
            Err(e) => log::debug!("progress web: headshots: {e}"),
        }
    }
    let missing = s.progress.missing_images(100);
    if !missing.is_empty() {
        let (found, complete) = s.api.asset_icons(&missing).await;
        let mut cache = s.progress.images.lock().unwrap_or_else(|e| e.into_inner());
        for id in &missing {
            match found.get(id) {
                Some(url) => {
                    cache.insert(*id, Some(url.clone()));
                }
                None if complete => {
                    cache.insert(*id, None);
                }
                None => {}
            }
        }
    }
    respond(stream, "200 OK", JSON, &s.progress.web_json()).await;
}

/// The network listener: only the website and its data, each request with the key.
async fn serve_web(handle: &AppHandle, mut stream: TcpStream) {
    let Some(req) = read_request(&mut stream).await else {
        return respond(&mut stream, "400 Bad Request", TEXT, "bad request").await;
    };
    // The logo is the app's public icon: no key, so the tab icon loads too.
    if req.method == "GET" && matches!(req.path.as_str(), "/logo.png" | "/favicon.ico") {
        return logo(&mut stream).await;
    }
    let Some(key) = handle.state::<App>().progress.web_key() else {
        return respond(&mut stream, "403 Forbidden", TEXT, "sharing is off").await;
    };
    if req.query.get("key").map(String::as_bytes) != Some(key.as_bytes()) {
        return respond(&mut stream, "403 Forbidden", TEXT, "open the link MTwin Manager shows (it carries the key)").await;
    }
    match (req.method.as_str(), req.path.as_str()) {
        // Read-only on the network: no token, so no script runner.
        ("GET", "/" | "/index.html") => respond(&mut stream, "200 OK", HTML, &WEB_PAGE.replace("__EXEC_TOKEN__", "")).await,
        ("GET", "/api/progress") => web_api(handle, &mut stream).await,
        _ => respond(&mut stream, "404 Not Found", TEXT, "not found").await,
    }
}

/// While sharing is on, listens on every interface (`WEB_PORT`); stops when it is turned off.
fn spawn_web(handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let p = &handle.state::<App>().progress;
            if p.web_key().is_none() {
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
            let listener = match TcpListener::bind(("0.0.0.0", WEB_PORT)).await {
                Ok(l) => l,
                Err(e) => {
                    *p.web_error.lock().unwrap_or_else(|e| e.into_inner()) = Some(e.to_string());
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    continue;
                }
            };
            *p.web_error.lock().unwrap_or_else(|e| e.into_inner()) = None;
            log::info!("progress: website shared on port {WEB_PORT}");
            while handle.state::<App>().progress.web_key().is_some() {
                let Ok(accepted) = tokio::time::timeout(Duration::from_secs(1), listener.accept()).await else { continue };
                let Ok((stream, _)) = accepted else { continue };
                let h = handle.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = tokio::time::timeout(Duration::from_secs(15), serve_web(&h, stream)).await;
                });
            }
            log::info!("progress: website no longer shared");
        }
    });
}

/// This PC's address on its network: the one a packet to the internet would leave from (a UDP
/// "connect" sends nothing).
fn lan_ip() -> Option<std::net::IpAddr> {
    let sock = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    Some(sock.local_addr().ok()?.ip()).filter(|ip| !ip.is_loopback() && !ip.is_unspecified())
}

// ---------- commands ----------

#[tauri::command]
pub fn progress_state(s: State<'_, App>) -> ProgressState {
    s.progress.state()
}

/// Removes these accounts (`key`s); they come back when they report again. How many went.
#[tauri::command]
pub fn progress_remove(s: State<'_, App>, keys: Vec<String>) -> usize {
    let keys: HashSet<String> = keys.into_iter().collect();
    let mut st = s.progress.stored();
    let before = st.accounts.len();
    st.accounts.retain(|k, _| !keys.contains(k));
    let removed = before - st.accounts.len();
    drop(st);
    s.progress.changed();
    removed
}

/// Replaces a game's Catalog. Entries without an id are dropped; ids are unique per kind.
#[tauri::command]
pub fn progress_catalog_save(s: State<'_, App>, game_id: String, entries: Vec<CatalogEntry>) -> Result<Vec<CatalogEntry>> {
    let game_id = game_id.trim().to_owned();
    if game_id.is_empty() || game_id.len() > 40 {
        return Err(AppError::Invalid("Not a game id.".into()));
    }
    let mut seen = HashSet::new();
    let cut = |s: &str, n: usize| s.trim().chars().filter(|c| !c.is_control()).take(n).collect::<String>();
    let clean: Vec<CatalogEntry> = entries
        .into_iter()
        .take(1000)
        .map(|e| CatalogEntry {
            id: cut(&e.id, 80),
            kind: e.kind,
            name: cut(&e.name, 80),
            category: cut(&e.category, 30),
            rarity: cut(&e.rarity, 30),
            image: decal(&Value::String(e.image)),
            source: cut(&e.source, 300),
        })
        .filter(|e| !e.id.is_empty() && seen.insert((e.kind, e.id.clone())))
        .collect();
    let mut st = s.progress.stored();
    if clean.is_empty() {
        st.catalog.remove(&game_id);
    } else {
        st.catalog.insert(game_id, clean.clone());
    }
    drop(st);
    s.progress.changed();
    Ok(clean)
}

/// Saves a game's script (`game_id` "*": every game). Empty removes a game's; "Every game" set
/// back to `DEFAULT_ALL` (or empty) follows the default again.
#[tauri::command]
pub fn progress_collector_save(s: State<'_, App>, game_id: String, source: String) -> Result<()> {
    let game_id = game_id.trim().to_owned();
    if game_id.is_empty() || game_id.len() > 40 {
        return Err(AppError::Invalid("Not a game id.".into()));
    }
    if source.len() > MAX_SCRIPT {
        return Err(AppError::Invalid("The script is too long (200 KB at most).".into()));
    }
    let source = source.replace("\r\n", "\n");
    let mut st = s.progress.stored();
    if (source.trim().is_empty() && game_id != ALL) || (game_id == ALL && source.trim() == DEFAULT_ALL.trim()) {
        st.collectors.remove(&game_id);
    } else {
        st.collectors.insert(game_id, source);
    }
    drop(st);
    s.progress.changed();
    Ok(())
}

/// Accounts that stop reporting are removed after `hours`; 0: never.
#[tauri::command]
pub fn progress_auto_delete(s: State<'_, App>, hours: u32) {
    s.progress.stored().auto_delete_hours = hours.min(24 * 365);
    s.progress.changed();
    s.progress.auto_delete();
}

/// The place id in a game link (`roblox.com/games/<id>/...`, `?placeId=<id>`), or the number typed.
fn game_number(input: &str) -> Option<i64> {
    let s = input.trim();
    let digits = |t: &str| t.chars().take_while(char::is_ascii_digit).collect::<String>();
    let n = if let Some(i) = s.find("/games/") {
        digits(&s[i + 7..])
    } else if let Some(i) = s.find("placeId=") {
        digits(&s[i + 8..])
    } else if s.chars().all(|c| c.is_ascii_digit()) {
        s.to_owned()
    } else {
        String::new()
    };
    n.parse().ok().filter(|n| *n > 0)
}

/// Adds a game by its link, place id or universe id; its universe id, or None when the text
/// isn't one (the UI says so).
#[tauri::command]
pub async fn progress_game_add(s: State<'_, App>, input: String) -> Result<Option<String>> {
    let Some(n) = game_number(&input) else { return Ok(None) };
    // A place id is the usual case (links carry one); a number Roblox knows no place for is taken
    // as a universe id if Roblox knows that game.
    let universe = match s.api.place_universe(n).await {
        Ok(Some(u)) => u,
        _ => match s.api.games(&[n]).await {
            Ok(g) if g.iter().any(|g| g.universe_id == n) => n,
            Ok(_) => return Ok(None),
            Err(e) => return Err(e),
        },
    };
    let id = universe.to_string();
    let mut st = s.progress.stored();
    if !st.games.contains(&id) {
        st.games.push(id.clone());
    }
    drop(st);
    s.progress.changed();
    Ok(Some(id))
}

/// Takes a game added by hand off the list (its Catalog and reports stay).
#[tauri::command]
pub fn progress_game_remove(s: State<'_, App>, game_id: String) {
    s.progress.stored().games.retain(|g| *g != game_id);
    s.progress.changed();
}

/// Pictures for decal (or image) ids, from Roblox's thumbnails (cached for the session). Ids
/// without one are missing.
#[tauri::command]
pub async fn progress_images(s: State<'_, App>, ids: Vec<i64>) -> Result<HashMap<i64, String>> {
    let wanted: Vec<i64> = ids.into_iter().filter(|id| *id > 0).collect::<HashSet<_>>().into_iter().take(500).collect();
    let missing: Vec<i64> = {
        let cache = s.progress.images.lock().unwrap_or_else(|e| e.into_inner());
        wanted.iter().copied().filter(|id| !cache.contains_key(id)).collect()
    };
    if !missing.is_empty() {
        let (found, complete) = s.api.asset_icons(&missing).await;
        let mut cache = s.progress.images.lock().unwrap_or_else(|e| e.into_inner());
        for id in &missing {
            match found.get(id) {
                Some(url) => {
                    cache.insert(*id, Some(url.clone()));
                }
                // Only a full answer says Roblox has none; otherwise ask again next time.
                None if complete => {
                    cache.insert(*id, None);
                }
                None => {}
            }
        }
    }
    let cache = s.progress.images.lock().unwrap_or_else(|e| e.into_inner());
    Ok(wanted.into_iter().filter_map(|id| cache.get(&id).cloned().flatten().map(|u| (id, u))).collect())
}

/// Roblox headshots of the reporting accounts, by user id; ones Roblox has no picture for yet are
/// missing (asked again next time).
#[tauri::command]
pub async fn progress_headshots(s: State<'_, App>, user_ids: Vec<i64>) -> Result<HashMap<i64, String>> {
    let wanted: Vec<i64> = user_ids.into_iter().filter(|id| *id > 0).collect::<HashSet<_>>().into_iter().take(500).collect();
    let missing: Vec<i64> = {
        let heads = s.progress.heads.lock().unwrap_or_else(|e| e.into_inner());
        wanted.iter().copied().filter(|id| !heads.contains_key(id)).collect()
    };
    if !missing.is_empty() {
        match s.api.headshots(&missing).await {
            Ok(found) => s.progress.heads.lock().unwrap_or_else(|e| e.into_inner()).extend(found),
            Err(e) => log::debug!("progress: headshots: {e}"),
        }
    }
    let heads = s.progress.heads.lock().unwrap_or_else(|e| e.into_inner());
    Ok(wanted.into_iter().filter_map(|id| heads.get(&id).map(|u| (id, u.clone()))).collect())
}

/// The progress website: its address here, and on the network while shared.
#[tauri::command]
pub fn progress_web(s: State<'_, App>) -> ProgressWeb {
    s.progress.web()
}

/// Shares the website on the network (or stops); `new_key` makes a new key, so old links stop working.
#[tauri::command]
pub fn progress_web_set(s: State<'_, App>, share: bool, new_key: bool) -> ProgressWeb {
    s.progress.set_web(share, new_key);
    s.progress.web()
}

/// Names, icons and players now of these universes; ones Roblox doesn't answer for are missing.
#[tauri::command]
pub async fn progress_games(s: State<'_, App>, universe_ids: Vec<i64>) -> Result<Vec<ProgressGame>> {
    let ids: Vec<i64> = universe_ids.into_iter().filter(|id| *id > 0).take(100).collect();
    let games = s.api.games(&ids).await.inspect_err(|e| log::debug!("progress: games: {e}")).unwrap_or_default();
    let (icons, _) = s.api.game_icons(&ids).await;
    Ok(games
        .into_iter()
        .map(|g| ProgressGame { icon_url: icons.get(&g.universe_id).cloned(), universe_id: g.universe_id, root_place_id: g.root_place_id, name: g.name, playing: g.playing })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_with_game_suffixes_read() {
        let close = |a: Option<f64>, b: f64| a.is_some_and(|a| ((a - b) / b).abs() < 1e-9);
        assert_eq!(suffixed("1,234.5"), Some(1234.5));
        assert!(close(suffixed("1.5K"), 1500.0));
        assert!(close(suffixed("$74.3Td"), 74.3e42));
        assert!(close(suffixed("$483.0Qd"), 483e15));
        assert!(close(suffixed("412 No"), 412e30));
        assert!(close(suffixed("1.2e+15"), 1.2e15));
        assert!(close(suffixed("9.9m"), 9.9e6));
        assert_eq!(suffixed("12 Coins"), None);
        assert_eq!(suffixed("Human V4"), None);
    }
    use serde_json::json;

    #[test]
    fn report() {
        let body = json!({
            "pc": "PC1",
            "game": { "id": "66654135", "placeId": 142823291, "name": "Murder Mystery 2" },
            "account": { "userId": 1001, "name": "alt1", "displayName": "Alt" },
            "level": 53,
            "values": [{ "key": "Candy", "name": "Halloween Candy", "amount": 235, "image": "rbxassetid://123" }, { "name": "", "amount": 1 }],
            "stats": [{ "name": "Battle Pass", "value": "4", "max": 30 }],
            "items": [{ "id": "Embergun", "rarity": "Legendary", "type": "Weapons", "count": 3, "image": 456 }, { "name": "" }]
        });
        let a = parse_report(&body, 5, |_| Some(1)).unwrap();
        assert_eq!(a.key, "66654135:1001");
        assert_eq!(a.place_id, Some(142823291));
        assert_eq!((a.first_seen, a.last_seen), (1, 5));
        assert_eq!(a.level, Some(53.0));
        assert_eq!(a.values, vec![ProgressValue { key: "Candy".into(), name: "Halloween Candy".into(), amount: 235.0, image: "123".into() }]);
        assert_eq!(a.stats[0].max, Some(30.0));
        assert_eq!(a.items.len(), 1);
        assert_eq!((a.items[0].name.as_str(), a.items[0].category.as_str(), a.items[0].count, a.items[0].image.as_str()), ("Embergun", "Weapons", 3.0, "456"));
    }

    #[test]
    fn report_needs_a_user() {
        assert!(parse_report(&json!({ "account": {} }), 0, |_| None).is_err());
        assert!(parse_report(&json!({ "account": { "userId": 1.5 } }), 0, |_| None).is_err());
        // The place id stands in for a game id of 0 (Studio, an unpublished place).
        let a = parse_report(&json!({ "account": { "userId": 7 }, "game": { "id": "0", "placeId": 99 }, "currencies": [{ "name": "Coins", "amount": "1,200" }] }), 0, |_| None).unwrap();
        assert_eq!(a.key, "99:7");
        assert_eq!(a.values[0].amount, 1200.0, "an older reporter's currencies");
        assert_eq!(a.pc, "Unnamed PC");
    }

    #[test]
    fn game_numbers() {
        assert_eq!(game_number("https://www.roblox.com/games/142823291/Murder-Mystery-2"), Some(142823291));
        assert_eq!(game_number("roblox://experiences/start?placeId=920587237&launchData=x"), Some(920587237));
        assert_eq!(game_number(" 66654135 "), Some(66654135));
        assert_eq!(game_number("Murder Mystery"), None);
        assert_eq!(game_number("0"), None);
    }

    #[test]
    fn decals() {
        assert_eq!(decal(&json!("rbxassetid://123")), "123");
        assert_eq!(decal(&json!("http://www.roblox.com/asset/?id=987")), "987");
        assert_eq!(decal(&json!(42)), "42");
        assert_eq!(decal(&json!("none")), "");
        // The quote that would end the Luau string goes; what an address may hold stays.
        assert_eq!(clean_host("localhost:16390\"); os.exit()--"), "localhost:16390os.exit--");
    }
}
