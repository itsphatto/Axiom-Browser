import {
  app,
  BrowserWindow,
  Menu,
  WebContentsView,
  ipcMain,
  net,
  MenuItemConstructorOptions,
} from "electron";
import * as fs from "fs";
import * as path from "path";

const SIDEBAR_DEFAULT = 240;
const SIDEBAR_MIN = 56;
const SIDEBAR_MAX = 480;
const SIDEBAR_RAIL = 56;
const SIDEBAR_SNAP = 110;
const TOOLBAR_H = 48;
const VIEW_GAP = 8; // space around the page so the rounded corners show
const VIEW_RADIUS = 12;
const START = "dev-x://start"; // internal marker for the start page, not a real URL
const START_PAGE = path.join(__dirname, "../renderer/newtab.html");
const START_BG = "#00000000"; // transparent so the window blur shows through
const MAX_HISTORY = 50;

interface Tab {
  id: number;
  view: WebContentsView;
  favicon: string;
}

interface Visit {
  url: string;
  title: string;
  favicon: string;
  time: number;
}

let win: BrowserWindow;
let tabs: Tab[] = [];
let activeId: number | null = null;
let nextId = 1;
let sidebarW = SIDEBAR_DEFAULT;
let sidebarVisible = true;

// ---------- history ----------
let history: Visit[] = [];
let saveTimer: NodeJS.Timeout | null = null;

function historyFile(): string {
  return path.join(app.getPath("userData"), "history.json");
}

function loadHistory(): void {
  try {
    const data = JSON.parse(fs.readFileSync(historyFile(), "utf8"));
    if (Array.isArray(data)) {
      history = data
        .filter((v) => v && typeof v.url === "string" && /^https?:\/\//i.test(v.url))
        .slice(0, MAX_HISTORY);
    }
  } catch {
    history = []; // first run or unreadable file
  }
}

function saveHistoryNow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    fs.writeFileSync(historyFile(), JSON.stringify(history));
  } catch {
    /* not fatal */
  }
}

function saveHistorySoon(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveHistoryNow, 1000);
}

/** bump = a real navigation (move to top). Otherwise only refresh title/favicon. */
function recordVisit(tab: Tab, bump: boolean): void {
  const wc = tab.view.webContents;
  const url = wc.getURL();
  if (!/^https?:\/\//i.test(url)) return;
  if (/^https?:\/\/(www\.)?google\.[^/]+\/search/i.test(url)) return; // skip search results

  let entry = history.find((v) => v.url === url);
  if (!entry) {
    if (!bump) return;
    entry = { url, title: "", favicon: "", time: Date.now() };
    history.unshift(entry);
  } else if (bump) {
    entry.time = Date.now();
    history = [entry, ...history.filter((v) => v !== entry)];
  }

  const title = wc.getTitle();
  if (title) entry.title = title;
  if (tab.favicon) entry.favicon = tab.favicon;

  history = history.slice(0, MAX_HISTORY);
  saveHistorySoon();
}

function isStartUrl(url: string): boolean {
  return url.includes("newtab.html");
}

// ---------- navigation helpers ----------
/** URL -> site. Anything else -> Google search. Only http(s) is allowed. */
function toUrl(input: string): string {
  const text = input.trim();

  if (/^https?:\/\//i.test(text)) return text;
  if (/^localhost(:\d+)?([/?#].*)?$/i.test(text)) return "http://" + text;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#].*)?$/.test(text)) return "http://" + text;
  if (!/\s/.test(text) && /^[^\s/]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(text)) {
    return "https://" + text;
  }
  return "https://www.google.com/search?q=" + encodeURIComponent(text);
}

function activeTab(): Tab | undefined {
  return tabs.find((t) => t.id === activeId);
}

/** Width the sidebar currently takes up (0 when hidden). */
function sidebarWidth(): number {
  return sidebarVisible ? sidebarW : 0;
}

function layout(): void {
  const tab = activeTab();
  if (!win || !tab) return;
  const [w, h] = win.getContentSize();
  const sw = sidebarWidth();
  tab.view.setBounds({
    x: sw + VIEW_GAP,
    y: TOOLBAR_H,
    width: Math.max(0, w - sw - VIEW_GAP * 2),
    height: Math.max(0, h - TOOLBAR_H - VIEW_GAP),
  });
}


function focusAddress(): void {
  win.webContents.focus();
  win.webContents.send("focus-address");
}

function pushState(): void {
  if (!win || win.isDestroyed()) return;
  const active = activeTab();
  const nav = active?.view.webContents.navigationHistory;

  // Hide the internal file path of the start page in the address bar
  const rawUrl = active ? active.view.webContents.getURL() : "";
  const url = isStartUrl(rawUrl) ? "" : rawUrl;

  win.webContents.send("state", {
    tabs: tabs.map((t) => {
      const wc = t.view.webContents;
      return {
        id: t.id,
        title: wc.getTitle() || wc.getURL() || "Axiom",
        favicon: t.favicon,
        loading: wc.isLoading(),
      };
    }),
    activeId,
    url,
    canGoBack: nav ? nav.canGoBack() : false,
    canGoForward: nav ? nav.canGoForward() : false,
    sidebarVisible,
    sidebarWidth: sidebarW,
  });
}

function setSidebarWidth(width: number): void {
  sidebarW =
    width < SIDEBAR_SNAP
      ? SIDEBAR_RAIL
      : Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)));
  layout();
  pushState();
}

function toggleSidebar(): void {
  sidebarVisible = !sidebarVisible;
  layout();
  pushState();
}

function switchTab(id: number): void {
  hideSuggest();
  const next = tabs.find((t) => t.id === id);
  if (!next) return;

  const prev = activeTab();
  if (prev && prev.id !== id) win.contentView.removeChildView(prev.view);

  activeId = id;
  win.contentView.addChildView(next.view);
  layout();
  pushState();
}

// ---------- suggestions ----------
interface SuggestItem { text: string; sub?: string }

let suggestView: WebContentsView;
let suggestShown = false;
let suggestItems: SuggestItem[] = [];
let suggestIndex = -1; // -1 = nothing selected (shows what the user typed)
let suggestTyped = "";
let suggestRect = { x: 0, width: 0 };
let suggestSeq = 0;
let suggestTimer: NodeJS.Timeout | null = null;
let suggestHideTimer: NodeJS.Timeout | null = null;

function hideSuggest(): void {
  suggestSeq++; // invalidates any in-flight request
  if (!suggestShown) return;
  suggestShown = false;
  win.contentView.removeChildView(suggestView);
}

function renderSuggest(): void {
  if (!suggestItems.length) return hideSuggest();
  const height = Math.min(suggestItems.length, 8) * 36 + 8;
  suggestView.setBounds({
    x: suggestRect.x,
    y: TOOLBAR_H - 4,
    width: suggestRect.width,
    height,
  });
  win.contentView.addChildView(suggestView); // re-adding moves it to the top
  suggestShown = true;
  suggestView.webContents.send("suggest:items", suggestItems, suggestIndex);
}

function localSuggestions(q: string): SuggestItem[] {
  const needle = q.toLowerCase();
  return history
    .filter((v) => v.url.toLowerCase().includes(needle) || v.title.toLowerCase().includes(needle))
    .slice(0, 3)
    .map((v) => ({ text: v.url, sub: v.title }));
}

async function googleSuggestions(q: string): Promise<string[]> {
  try {
    const res = await net.fetch(
      "https://suggestqueries.google.com/complete/search?client=firefox&q=" +
        encodeURIComponent(q)
    );
    const data = await res.json();
    return Array.isArray(data?.[1]) ? data[1].slice(0, 5) : [];
  } catch {
    return [];
  }
}



function createTab(input: string = START): void {
  const view = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  const tab: Tab = { id: nextId++, view, favicon: "" };
  view.setBorderRadius(VIEW_RADIUS);
  const wc = view.webContents;

  // The start page is transparent; real sites are opaque white.
  view.setBackgroundColor(input === START ? START_BG : "#ffffff");

  wc.setWindowOpenHandler(({ url }) => {
    createTab(url);
    return { action: "deny" };
  });

  wc.on("page-favicon-updated", (_e, favicons) => {
    tab.favicon = favicons[0] ?? "";
    recordVisit(tab, false);
    pushState();
  });

  // Registered before the pushState loop below so state is already up to date.
  wc.on("did-navigate", (_e, url) => {
    tab.favicon = "";
    view.setBackgroundColor(isStartUrl(url) ? START_BG : "#ffffff");
    recordVisit(tab, true);
  });

  wc.on("page-title-updated", () => recordVisit(tab, false));

  wc.on("did-finish-load", () => {
    recordVisit(tab, false);
  });

  for (const evt of [
    "did-navigate",
    "did-navigate-in-page",
    "page-title-updated",
    "did-start-loading",
    "did-stop-loading",
  ] as const) {
    wc.on(evt as any, pushState);
  }

  if (input === START) wc.once("did-finish-load", focusAddress); //i added this because it focus on the bar for a split second and it draw its attention to other part
  tabs.push(tab);
  if (input === START) wc.loadFile(START_PAGE);
  else wc.loadURL(toUrl(input));
  switchTab(tab.id);
  if (input === START) focusAddress(); //automatic focus on the uh type bar
}

function closeTab(id: number): void {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;

  const [tab] = tabs.splice(idx, 1);
  win.contentView.removeChildView(tab.view);
  tab.view.webContents.close();

  if (tabs.length === 0) {
    activeId = null;
    createTab(START);
  } else if (id === activeId) {
    switchTab(tabs[Math.min(idx, tabs.length - 1)].id);
  } else {
    pushState();
  }
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [{ role: "appMenu" } as MenuItemConstructorOptions]
      : []),
    { role: "editMenu" },
    {
      label: "Tab",
      submenu: [
        { label: "Axiom",
          accelerator: "CmdOrCtrl+T",
          click: () => createTab(START)
        },

        {
          label: "Close Tab",
          accelerator: "CmdOrCtrl+W",
          click: () => activeId !== null && closeTab(activeId),
        },
        {
          label: "Toggle Sidebar",
          accelerator: "CmdOrCtrl+S",
          click: () => toggleSidebar(),
        },
        {
          label: "Focus Address Bar",
          accelerator: "CmdOrCtrl+L",
          click: () => focusAddress(),
        },
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: () => activeTab()?.view.webContents.reload(),
        },
        {
          label: "Back",
          accelerator: "Alt+Left",
          click: () => activeTab()?.view.webContents.navigationHistory.goBack(),
        },
        {
          label: "Forward",
          accelerator: "Alt+Right",
          click: () => activeTab()?.view.webContents.navigationHistory.goForward(),
        },
        { type: "separator" },
        {
          label: "Toggle Page DevTools",
          accelerator: "CmdOrCtrl+Alt+I",
          click: () => activeTab()?.view.webContents.toggleDevTools(),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 700,
    minHeight: 400,
    backgroundColor: "#00000000",
    // blur behind the window
    backgroundMaterial: "acrylic", // Windows 11
    vibrancy: "under-window",      // macOS
    titleBarStyle: "hidden",
    titleBarOverlay: {
      // native minimize / maximize / close buttons
      color: "#00000000",
      symbolColor: "#ffffff",
      height: TOOLBAR_H,
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, "../renderer/index.html"));
  win.on("resize", layout);

  buildMenu();

    suggestView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  suggestView.setBorderRadius(10);
  suggestView.setBackgroundColor("#2b2b2b");
  suggestView.webContents.loadFile(path.join(__dirname, "../renderer/suggest.html"));

  createTab(START);
}

// --- IPC from the UI ---
ipcMain.on("ui:ready", pushState);
ipcMain.on("tab:new", () => createTab(START));
ipcMain.on("tab:close", (_e, id: number) => closeTab(id));
ipcMain.on("tab:switch", (_e, id: number) => switchTab(id));
ipcMain.on("nav:go", (_e, input: string) => {
  hideSuggest();
  const text = String(input).trim();
  if (!text) return;
  activeTab()?.view.webContents.loadURL(toUrl(text));
});
ipcMain.on("nav:back", () => activeTab()?.view.webContents.navigationHistory.goBack());
ipcMain.on("nav:forward", () => activeTab()?.view.webContents.navigationHistory.goForward());
ipcMain.on("nav:reload", () => activeTab()?.view.webContents.reload());
ipcMain.on("sidebar:toggle", () => toggleSidebar());
ipcMain.on("sidebar:resize", (_e, width: number) => setSidebarWidth(Number(width)));
//suggest ipc
ipcMain.on("suggest:query", (_e, text: string, rect: { x: number; width: number }) => {
  if (suggestHideTimer) clearTimeout(suggestHideTimer);
  if (suggestTimer) clearTimeout(suggestTimer);

  const q = String(text).trim();
  if (!q) return hideSuggest();

  const seq = ++suggestSeq;
  suggestRect = { x: Number(rect?.x) || 0, width: Number(rect?.width) || 0 };
  suggestTyped = String(text);
  suggestIndex = -1;
  suggestItems = localSuggestions(q);
  renderSuggest();

  if (/^https?:\/\//i.test(q)) return; // typing a URL, no search suggestions
  suggestTimer = setTimeout(async () => {
    const remote = await googleSuggestions(q);
    if (seq !== suggestSeq) return; // user kept typing or closed it
    const seen = new Set(suggestItems.map((i) => i.text));
    suggestItems = [
      ...suggestItems,
      ...remote.filter((s) => !seen.has(s)).map((s) => ({ text: s })),
    ];
    renderSuggest();
  }, 120);
});

ipcMain.on("suggest:move", (_e, delta: number) => {
  if (!suggestShown) return;
  const slots = suggestItems.length + 1; // items + "what I typed"
  suggestIndex = ((((suggestIndex + 1 + delta) % slots) + slots) % slots) - 1;
  const text = suggestIndex === -1 ? suggestTyped : suggestItems[suggestIndex].text;
  win.webContents.send("suggest:fill", text);
  suggestView.webContents.send("suggest:items", suggestItems, suggestIndex);
});

// small delay so a click on the dropdown lands before the input's blur hides it
ipcMain.on("suggest:hide", () => {
  suggestHideTimer = setTimeout(hideSuggest, 150);
});

ipcMain.on("suggest:pick", (_e, text: string) => {
  hideSuggest();
  activeTab()?.view.webContents.loadURL(toUrl(String(text)));
});

app.whenReady().then(() => {
  loadHistory();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", saveHistoryNow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});