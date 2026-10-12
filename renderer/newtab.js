// ---------- helpers ----------
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Same rules as the address bar: URL -> site, anything else -> Google search. */
function toUrl(input) {
  const text = input.trim();
  if (/^https?:\/\//i.test(text)) return text;
  if (/^localhost(:\d+)?([/?#].*)?$/i.test(text)) return "http://" + text;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#].*)?$/.test(text)) return "http://" + text;
  if (!/\s/.test(text) && /^[^\s/]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(text)) {
    return "https://" + text;
  }
  return "https://www.google.com/search?q=" + encodeURIComponent(text);
}

/** Returns a clean http(s) URL, or null if the text isn't a website. */
function normalizeSite(text) {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : "https://" + t;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u.href;
  } catch {
    return null;
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Colored circle with the first letter, no network requests needed. */
function letterIcon(name) {
  const letter = el("div", "letter", (name.trim()[0] || "?").toUpperCase());
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  letter.style.background = `hsl(${hash} 65% 55% / 0.85)`;
  return letter;
}

function siteIcon(name, url) {
  const img = document.createElement("img");
  img.className = "letter";
  img.alt = "";
  img.src = "https://www.google.com/s2/favicons?sz=64&domain=" + encodeURIComponent(hostOf(url));
  img.addEventListener("error", () => img.replaceWith(letterIcon(name)));
  return img;
}

// ---------- clock + welcome ----------
const welcome = document.getElementById("welcome");
const time = document.getElementById("time");
const date = document.getElementById("date");

function tick() {
  const now = new Date();
  const h = now.getHours();
  const greeting = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";

  welcome.textContent = `${greeting}, welcome to Dev-X`;
  time.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  date.textContent = now.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
tick();
setInterval(tick, 1000);

// ---------- search ----------
const searchForm = document.getElementById("search");
const searchInput = document.getElementById("q");

searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!searchInput.value.trim()) return;
  location.href = toUrl(searchInput.value);
});

// ---------- favorites (saved in this page's localStorage) ----------
const FAV_KEY = "devx.favorites";
const DEFAULT_FAVORITES = [
  { name: "Google", url: "https://www.google.com/" },
  { name: "YouTube", url: "https://www.youtube.com/" },
  { name: "GitHub", url: "https://github.com/" },
  { name: "Wikipedia", url: "https://www.wikipedia.org/" },
  { name: "Reddit", url: "https://www.reddit.com/" },
];

function loadFavorites() {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list.filter((f) => f && f.name && normalizeSite(f.url));
    }
  } catch {}
  return DEFAULT_FAVORITES.slice();
}

function saveFavorites() {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(favorites));
  } catch {}
}

let favorites = loadFavorites();
const favEl = document.getElementById("favorites");

function renderFavorites() {
  favEl.replaceChildren();

  favorites.forEach((fav, index) => {
    const tile = el("div", "tile");

    const link = el("a", "tile-link");
    link.href = fav.url;
    link.append(siteIcon(fav.name, fav.url), el("span", "tile-name", fav.name));

    const remove = el("button", "tile-remove", "×");
    remove.title = "Remove";
    remove.addEventListener("click", () => {
      favorites.splice(index, 1);
      saveFavorites();
      renderFavorites();
    });

    tile.append(link, remove);
    favEl.appendChild(tile);
  });

  const add = el("button", "tile-add");
  add.append(el("div", "letter", "+"), el("span", "tile-name", "Add"));
  add.addEventListener("click", openAddDialog);
  const addWrap = el("div", "tile");
  addWrap.appendChild(add);
  favEl.appendChild(addWrap);
}

// ---------- add-favorite dialog ----------
const dialog = document.getElementById("add-dialog");
const addForm = document.getElementById("add-form");
const addName = document.getElementById("add-name");
const addUrl = document.getElementById("add-url");
const addError = document.getElementById("add-error");

function openAddDialog() {
  addName.value = "";
  addUrl.value = "";
  addError.textContent = "";
  dialog.showModal();
  addName.focus();
}

document.getElementById("add-cancel").addEventListener("click", () => dialog.close());

addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const url = normalizeSite(addUrl.value);
  if (!url) {
    addError.textContent = "Enter a valid website, e.g. github.com";
    return;
  }
  const name = addName.value.trim() || hostOf(url);
  favorites.push({ name, url });
  saveFavorites();
  renderFavorites();
  dialog.close();
});

// ---------- recently visited (pushed in by the main process) ----------
const recentEl = document.getElementById("recent");

window.renderRecent = function (items) {
  recentEl.replaceChildren();

  const list = (Array.isArray(items) ? items : []).filter(
    (item) => item && typeof item.url === "string" && /^https?:\/\//i.test(item.url)
  );

  if (list.length === 0) {
    recentEl.appendChild(el("div", "empty", "Pages you visit will show up here."));
    return;
  }

  for (const item of list) {
    const host = hostOf(item.url);
    const title = item.title || host;

    const row = el("a", "row");
    row.href = item.url;

    let icon;
    if (item.favicon && /^(https?:|data:)/i.test(item.favicon)) {
      icon = document.createElement("img");
      icon.src = item.favicon;
      icon.alt = "";
      icon.addEventListener("error", () => icon.replaceWith(letterIcon(title)));
    } else {
      icon = letterIcon(title);
    }

    const text = el("span", "row-text");
    text.append(el("span", "row-title", title), el("span", "row-host", host));

    row.append(icon, text);
    recentEl.appendChild(row);
  }
};

renderFavorites();
window.renderRecent([]);