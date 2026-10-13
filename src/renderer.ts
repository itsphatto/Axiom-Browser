// Runs inside the browser UI (sidebar + toolbar). Wrapped in an IIFE so it
// stays a plain script (no module exports) and avoids global name clashes.
(() => {
  interface TabInfo {
    id: number;
    title: string;
    favicon: string;
    loading: boolean;
  }
  interface UiState {
    tabs: TabInfo[];
    activeId: number | null;
    url: string;
    canGoBack: boolean;
    canGoForward: boolean;
    sidebarVisible: boolean;
    sidebarWidth: number;
  }
  interface Api {
    ready(): void;
    newTab(): void;
    closeTab(id: number): void;
    switchTab(id: number): void;
    go(input: string): void;
    back(): void;
    forward(): void;
    reload(): void;
    toggleSidebar(): void;
    resizeSidebar(width: number): void;
    onState(cb: (state: UiState) => void): void;
    onFocusAddress(cb: () => void): void;
  }

  const SIDEBAR_DEFAULT = 240;
  const SIDEBAR_MIN = 56;
  const SIDEBAR_MAX = 480;
  const SIDEBAR_RAIL = 56;   // icon-only width
  const SIDEBAR_SNAP = 110;  // drag below this -> snaps to the rail

  const api = (window as unknown as { api: Api }).api;

  const root = document.documentElement;
  const tabList = document.getElementById("tab-list") as HTMLDivElement;
  const newTabBtn = document.getElementById("new-tab") as HTMLButtonElement;
  const toggleBtn = document.getElementById("toggle-sidebar") as HTMLButtonElement;
  const resizer = document.getElementById("resizer") as HTMLDivElement;
  const backBtn = document.getElementById("back") as HTMLButtonElement;
  const forwardBtn = document.getElementById("forward") as HTMLButtonElement;
  const reloadBtn = document.getElementById("reload") as HTMLButtonElement;
  const form = document.getElementById("address-form") as HTMLFormElement;
  const address = document.getElementById("address") as HTMLInputElement;

  let dragging = false;

  function clampSidebar(px: number): number {
    if (px < SIDEBAR_SNAP) return SIDEBAR_RAIL;
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(px)));
  }

  function setSidebarVar(px: number): void {
    root.style.setProperty("--sidebar-w", px + "px");
    document.body.classList.toggle("sidebar-compact", px > 0 && px < 110);
  }

  function renderTabs(state: UiState): void {
    tabList.replaceChildren();

    for (const tab of state.tabs) {
      const row = document.createElement("div");
      row.className = "tab" + (tab.id === state.activeId ? " active" : "");
      row.title = tab.title;
      row.addEventListener("click", () => api.switchTab(tab.id));

      const icon = document.createElement("span");
      icon.className = "tab-icon";

      if (tab.loading) {
        icon.classList.add("spinner");
      } else if (tab.favicon) {
        const img = document.createElement("img");
        img.src = tab.favicon;
        img.alt = "";
        icon.appendChild(img);
      } else {
        icon.classList.add("letter");
        icon.textContent = (tab.title.trim()[0] || "•").toUpperCase();
      }

      const title = document.createElement("span");
      title.className = "tab-title";
      title.textContent = tab.title;

      const close = document.createElement("button");
      close.className = "tab-close";
      close.textContent = "×";
      close.title = "Close tab";
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        api.closeTab(tab.id);
      });

      row.append(icon, title, close);
      tabList.appendChild(row);
    }
  }

  api.onState((state) => {
    renderTabs(state);
    backBtn.disabled = !state.canGoBack;
    forwardBtn.disabled = !state.canGoForward;
    // don't overwrite what the user is typing
    if (document.activeElement !== address) address.value = state.url;

    document.body.classList.toggle("sidebar-hidden", !state.sidebarVisible);
    if (!dragging) setSidebarVar(state.sidebarVisible ? state.sidebarWidth : 0);
  });

  api.onFocusAddress(() => {
    address.focus();
    address.select();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    api.go(address.value);
    address.blur();
  });

  // --- sidebar resize (drag the right edge of the sidebar) ---
  resizer.addEventListener("pointerdown", (e) => {
    dragging = true;
    resizer.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
  });

  resizer.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const width = clampSidebar(e.clientX);
    setSidebarVar(width); // instant feedback in the UI
    api.resizeSidebar(width); // resizes the page view in the main process
  });

  const stopDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    if (resizer.hasPointerCapture(e.pointerId)) resizer.releasePointerCapture(e.pointerId);
    document.body.classList.remove("resizing");
  };
  resizer.addEventListener("pointerup", stopDrag);
  resizer.addEventListener("pointercancel", stopDrag);

  // double-click the edge to reset to the default width
  resizer.addEventListener("dblclick", () => api.resizeSidebar(SIDEBAR_DEFAULT));

  toggleBtn.addEventListener("click", () => api.toggleSidebar());
  newTabBtn.addEventListener("click", () => api.newTab());
  backBtn.addEventListener("click", () => api.back());
  forwardBtn.addEventListener("click", () => api.forward());
  reloadBtn.addEventListener("click", () => api.reload());

  api.ready();
})();