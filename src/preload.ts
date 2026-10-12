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
  resizeSidebar: (width: number) => ipcRenderer.send("sidebar:resize", width),
  onState: (cb: (state: unknown) => void) =>
    ipcRenderer.on("state", (_e, state) => cb(state)),
  onFocusAddress: (cb: () => void) =>
    ipcRenderer.on("focus-address", () => cb()),
});