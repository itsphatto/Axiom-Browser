import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  ready: () => ipcRenderer.send("ui:ready"),
  newTab: () => ipcRenderer.send("tab:new"),
  closeTab: (id: number) => ipcRenderer.send("tab:close", id),
  switchTab: (id: number) => ipcRenderer.send("tab:switch", id),
  go: (input: string) => ipcRenderer.send("nav:go", input),
  back: () => ipcRenderer.send("nav:back"),
  forward: () => ipcRenderer.send("nav:forward"),
  reload: () => ipcRenderer.send("nav:reload"),
  toggleSidebar: () => ipcRenderer.send("sidebar:toggle"),
  setTheme: (theme: string) => ipcRenderer.send("theme:set", theme),
  resizeSidebar: (width: number) => ipcRenderer.send("sidebar:resize", width),
  onState: (cb: (state: unknown) => void) =>
    ipcRenderer.on("state", (_e, state) => cb(state)),
  onFocusAddress: (cb: () => void) =>
    ipcRenderer.on("focus-address", () => cb()),
  onBlurAddress: (cb: () => void) =>
    ipcRenderer.on("blur-address", () => cb()),
  //suggestion start
  suggest: (text: string, rect: { x: number; width: number }) =>
    ipcRenderer.send("suggest:query", text, rect),
  suggestMove: (delta: number) => ipcRenderer.send("suggest:move", delta),
  suggestHide: () => ipcRenderer.send("suggest:hide"),
  suggestPick: (text: string) => ipcRenderer.send("suggest:pick", text),
  onSuggestItems: (cb: (items: unknown[], index: number) => void) =>
    ipcRenderer.on("suggest:items", (_e, items, index) => cb(items, index)),
  onSuggestFill: (cb: (text: string) => void) =>
    ipcRenderer.on("suggest:fill", (_e, text) => cb(text)),
  //suggestion end here
});