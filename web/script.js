const page = document.body.dataset.page;
const $ = (id) => document.getElementById(id);

/* ---------- Loading skeletons + empty states (shared by every page) ---------- */
// skeletonHTML("event" | "card" | "person" | "row" | "post" | "li", count): grey shimmering placeholders
// shown while a list loads, shaped like what will replace them.
function skeletonHTML(kind, n) {
  const line = (w) => '<span class="skel skel-line" style="width:' + w + '%"></span>';
  const avatar = '<span class="skel skel-avatar"></span>';
  const shapes = {
    card: () => '<div class="card skel-card">' + line(55) + line(90) + line(40) + "</div>",
    event: () => '<div class="card skel-card skel-flex"><span class="skel skel-block"></span><div class="skel-col">' + line(60) + line(90) + line(45) + "</div></div>",
    person: () => '<div class="card skel-card skel-flex">' + avatar + '<div class="skel-col">' + line(50) + line(30) + "</div></div>",
    row: () => '<div class="skel-flex skel-rowpad">' + avatar + '<div class="skel-col">' + line(45) + line(70) + "</div></div>",
    post: () => '<div class="card skel-card"><div class="skel-flex">' + avatar + '<div class="skel-col">' + line(40) + line(25) + "</div></div>" + line(95) + line(80) + "</div>",
    li: () => '<li class="skel-li">' + line(70) + "</li>"
  };
  const make = shapes[kind] || shapes.card;
  let html = kind === "li" ? "" : '<span class="skel-sr" role="status">Loading\u2026</span>';
  for (let i = 0; i < (n || 3); i++) html += make();
  return html;
}

// emptyStateHTML(icon, title, text, cta): friendly "nothing here yet" box with an optional button.
// cta = { label, href }  -> a link,  or  { label, click: "#openEventForm" } -> clicks that element (e.g. the + button).
function emptyStateHTML(icon, title, text, cta) {
  let btn = "";
  if (cta && cta.href) btn = '<a class="btn-small" href="' + cta.href + '">' + cta.label + "</a>";
  else if (cta && cta.click) btn = '<button type="button" class="btn-small" data-empty-click="' + cta.click + '">' + cta.label + "</button>";
  return '<div class="empty-state"><span class="empty-icon" aria-hidden="true">' + icon + "</span>" +
    '<p class="empty-title">' + title + "</p><p>" + text + "</p>" + btn + "</div>";
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-empty-click]");
  const t = b && document.querySelector(b.dataset.emptyClick);
  if (t) t.click();
});

// Floating action buttons get a text label ("+ New event") so nobody has to guess what the + does.
// On phones the label folds away while scrolling down and comes back on scroll up.
(function () {
  const LABELS = { openPostForm: "New post", openEventForm: "New event", openGroupForm: "New group", openLfForm: "Post item",
    openRideForm: "Post ride", openMusicForm: "New music group", openGroupChat: "Group chat" };
  const fabs = [...document.querySelectorAll(".fab")].filter((f) => LABELS[f.id]);
  if (!fabs.length) return;
  fabs.forEach((fab) => {
    const label = LABELS[fab.id];
    fab.classList.add("fab-ext");
    fab.innerHTML = '<span class="fab-icon" aria-hidden="true">' + fab.innerHTML.trim() + '</span><span class="fab-label">' + label + "</span>";
    fab.removeAttribute("aria-label");   // the visible text is now the accessible name
    fab.title = label;
  });
  let lastY = window.scrollY;
  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    if (Math.abs(y - lastY) < 8) return;
    const compact = window.innerWidth <= 900 && y > lastY && y > 80;
    fabs.forEach((f) => f.classList.toggle("compact", compact));
    lastY = y;
  }, { passive: true });
})();

// Pages ship a plain "Loading…" line in a few lists; swap it for skeletons before the first fetch finishes.
(function () {
  const lists = { groupList: ["card", 3], discoverGrid: ["person", 4], musicList: ["card", 3], convList: ["row", 4] };
  Object.keys(lists).forEach((id) => {
    const el = $(id);
    if (el && el.children.length === 1 && el.firstElementChild.matches("p.sub")) el.innerHTML = skeletonHTML(lists[id][0], lists[id][1]);
  });
})();

// Pages that need someone logged in (kept in one place so new pages are one line to add)
const AUTH_PAGES = ["dashboard", "profile", "settings", "events", "groups", "group", "groupchat", "lostfound", "rides", "notifications", "user", "messages", "welcome", "discover", "music"];

const QUESTIONS = [
  "What was the name of your first pet?", "What is your mother's maiden name?",
  "What was your first school called?", "What is your favourite teacher's name?",
  "In which city were you born?"
];

/* ---------- Dark mode toggle (saved in localStorage; follows the system until you choose) ---------- */
(function () {
  const root = document.documentElement;
  const KEY = "vibelyTheme";
  const saved = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "themeToggle";
  btn.className = "notif-btn theme-btn";

  function paint() {
    const dark = root.dataset.theme === "dark";
    btn.innerHTML = '<span aria-hidden="true">' + (dark ? "\u2600\uFE0E" : "\u263E") + "</span>";
    btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    btn.title = dark ? "Light mode" : "Dark mode";
  }
  function setTheme(dark) {
    if (dark) root.dataset.theme = "dark"; else delete root.dataset.theme;
    paint();
  }
  btn.addEventListener("click", () => {
    const dark = root.dataset.theme !== "dark";
    setTheme(dark);
    try { localStorage.setItem(KEY, dark ? "dark" : "light"); } catch (e) {}
  });

  const logout = $("logout");
  if (logout && logout.closest(".topbar")) {
    logout.before(btn);
    // Separate Settings button (gear) on every page that has the full top bar
    if ($("notifLink")) {
      const gear = document.createElement("a");
      gear.id = "settingsLink";
      gear.href = "settings.html";
      gear.className = "notif-btn" + (page === "settings" ? " active" : "");
      gear.setAttribute("aria-label", "Settings");
      gear.title = "Settings";
      gear.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
      btn.before(gear);
    }
  } else { btn.classList.add("theme-float"); document.body.appendChild(btn); }
  paint();

  // No saved choice yet: follow the device's light/dark setting live.
  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  if (mq && mq.addEventListener) mq.addEventListener("change", (e) => { if (!saved()) setTheme(e.matches); });
  // Keep other open tabs in sync.
  window.addEventListener("storage", (e) => { if (e.key === KEY) setTheme(e.newValue === "dark"); });
})();

/* ---------- Helpers ---------- */

// Hostels by gender (keep in sync with GIRLS_HOSTELS / BOYS_HOSTELS in Main.java)
const HOSTELS = {
  female: ["Ivory Hall", "Rosewood Hall", "New Hostel D"],
  male: ["Chanakya Hostel", "Einstein Hostel", "Tagore Hostel", "Sadbhavna Hostel", "Sukhmani", "City Hostel"]
};

function fillHostels(select, gender, selected) {
  const list = HOSTELS[gender] || [];
  select.innerHTML = (list.length ? '<option value="">Select your hostel</option>' : '<option value="">Select gender first</option>')
    + list.map((n) => `<option value="${h(n)}">${h(n)}</option>`).join("");
  select.disabled = !list.length;
  if (selected && list.includes(selected)) select.value = selected;
}

// escape user text before putting it into HTML
const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function getUser() {
  try { return JSON.parse(sessionStorage.getItem("vibelyUser") || "null"); } catch (e) { return null; }
}
function saveUser(u) { try { sessionStorage.setItem("vibelyUser", JSON.stringify(u)); } catch (e) {} }
function loggedIn() { return !!getUser(); }

// fade the old text out, swap it, fade the new text in (instant = no fade)
function swapText(el, text, instant) {
  if (el.textContent === text) return;
  if (instant) { el.textContent = text; return; }
  el.style.opacity = 0;
  setTimeout(() => { el.textContent = text; el.style.opacity = 1; }, 180);
}

// remember the chosen tab so the pages before login stay in the same colour
function savedRole() {
  try { return sessionStorage.getItem("vibelyRole") === "dayscholar" ? "dayscholar" : "hostellor"; }
  catch (e) { return "hostellor"; }
}
function saveRole(r) { try { sessionStorage.setItem("vibelyRole", r); } catch (e) {} }

// Talk to the Java server. Sends the login token if there is one.
async function api(path, params) {
  const user = getUser();
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (user && user.token) headers["Authorization"] = "Bearer " + user.token;
  try {
    const res = await fetch(path, { method: "POST", headers, body: new URLSearchParams(params || {}) });
    const data = await res.json();
    if (data.expired) {                       // server restarted or session invalid
      sessionStorage.removeItem("vibelyUser");
      window.location.replace("login.html");
    }
    return data;
  } catch (err) {
    return { ok: false, message: "Can't reach the server. Is the Java app running?" };
  }
}

// Pop-up message (green for success, red for a problem). It closes itself after a few seconds.
function toast(text, ok) {
  let box = $("toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    document.body.appendChild(box);
  }
  const t = document.createElement("div");
  t.className = "toast " + (ok ? "ok" : "bad");
  t.setAttribute("role", ok ? "status" : "alert");
  t.innerHTML = `<span class="toast-icon">${ok ? "&#10003;" : "!"}</span><span>${h(text)}</span>` +
                '<button type="button" aria-label="Dismiss">&times;</button>';
  const close = () => { t.classList.add("out"); setTimeout(() => t.remove(), 250); };
  t.querySelector("button").addEventListener("click", close);
  box.appendChild(t);
  setTimeout(close, ok ? 3500 : 5500);
}

// Wires a floating "+" button to open a hidden modal, and the modal's own
// close button / backdrop click / Escape key to close it again.
// Returns { open, close } so page code can close it after a successful create.
function wireModal(openBtnId, modalId) {
  const openBtn = $(openBtnId), modal = $(modalId);
  if (!openBtn || !modal) return null;
  const close = () => { modal.hidden = true; document.body.classList.remove("modal-open"); };
  const open = () => {
    modal.hidden = false;
    document.body.classList.add("modal-open");
    const firstField = modal.querySelector("input, select, textarea");
    if (firstField) firstField.focus();
  };
  openBtn.addEventListener("click", open);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  const closeBtn = modal.querySelector(".modal-close");
  if (closeBtn) closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) close(); });
  return { open, close };
}

// Like wireModal, but opened from code (no button): returns { open, close }.
function makeModal(modalId) {
  const modal = $(modalId);
  if (!modal) return null;
  const close = () => { modal.hidden = true; document.body.classList.remove("modal-open"); };
  const open = () => { modal.hidden = false; document.body.classList.add("modal-open"); };
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  modal.querySelector(".modal-close")?.addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) close(); });
  return { open, close };
}

/* ---------- Shared 3-dots dropdown ---------- */
// openDropdown(button, [[key, label, isDanger], ...], (key) => ...) shows a small menu under the button.
let ddMenu = null, ddOwner = null;
function closeDropdown() {
  if (ddMenu) { ddMenu.remove(); ddMenu = null; }
  if (ddOwner) { ddOwner.setAttribute("aria-expanded", "false"); ddOwner = null; }
}
function openDropdown(btn, items, onPick) {
  if (ddOwner === btn) { closeDropdown(); return; }
  closeDropdown();
  if (!items.length) return;
  ddOwner = btn;
  btn.setAttribute("aria-expanded", "true");
  ddMenu = document.createElement("div");
  ddMenu.className = "dd-menu";
  ddMenu.setAttribute("role", "menu");
  ddMenu.innerHTML = items.map(([key, label, danger]) =>
    `<button type="button" role="menuitem" data-key="${h(key)}" class="${danger ? "danger" : ""}">${h(label)}</button>`).join("");
  document.body.appendChild(ddMenu);
  const r = btn.getBoundingClientRect();
  const w = ddMenu.offsetWidth, hgt = ddMenu.offsetHeight;
  let left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
  let top = r.bottom + 4;
  if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 4);
  ddMenu.style.left = left + "px";
  ddMenu.style.top = top + "px";
  ddMenu.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-key]");
    if (!b) return;
    const key = b.dataset.key;
    closeDropdown();
    onPick(key);
  });
}
document.addEventListener("click", (e) => {
  if (ddMenu && !ddMenu.contains(e.target) && e.target.closest(".dd-btn, .msg-more") !== ddOwner) closeDropdown();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDropdown(); });
window.addEventListener("scroll", closeDropdown, true);
window.addEventListener("resize", closeDropdown);

function fillQuestions(select) {
  select.innerHTML = QUESTIONS.map((q, i) => `<option value="${i}">${h(q)}</option>`).join("");
}

/* ---------- Shared: posts / events / groups (feed, cards, likes, comments) ---------- */

// "created" comes back as a UTC ISO string ("YYYY-MM-DDTHH:mm:ssZ"); Date() converts it to the viewer's own time zone.
function timeAgo(created) {
  if (!created) return "";
  const then = new Date(created);
  const diffSec = Math.max(0, (Date.now() - then.getTime()) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return Math.floor(diffSec / 60) + "m ago";
  if (diffSec < 86400) return Math.floor(diffSec / 3600) + "h ago";
  if (diffSec < 604800) return Math.floor(diffSec / 86400) + "d ago";
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function roleLabel(role) { return role === "hostellor" ? "Hostellor" : "Day scholar"; }

// Reads an image File, downscales it so nothing gets sent needlessly huge, and
// resolves to a "data:image/jpeg;base64,..." string ready to send as a form field.
// CSP forbids inline onerror="" attributes, so images that should disappear when they fail to load carry data-hide-on-error.
document.addEventListener("error", (e) => {
  const t = e.target;
  if (t && t.tagName === "IMG" && t.hasAttribute("data-hide-on-error")) t.remove();
}, true);

function fileToCompressedDataUrl(file, maxDim) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) { reject(new Error("Please choose an image file.")); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That doesn't look like an image."));
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, (maxDim || 1280) / Math.max(width, height));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// A stable, cheerful colour per person, used as the background for the initials fallback below.
const AVATAR_COLORS = ["#c76b4a", "#4a7c76", "#8a5fbf", "#c2894f", "#3f6f9e", "#a24a68", "#5c8a3a", "#b45f7a"];
function avatarColor(username) {
  let hash = 0;
  const s = String(username || "");
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}
// Renders someone's real profile photo if avatarPath is set, otherwise a colourful initials circle.
// Used everywhere a person's identity needs a face: posts, comments, people lists, search, messages.
function avatarHTML(username, name, avatarPath, size) {
  const cls = "avatar " + (size || "");
  return avatarPath
    ? `<img class="${cls}" src="${h(avatarPath)}" alt="">`
    : `<span class="${cls}" style="background:${avatarColor(username)}">${h(initials(name))}</span>`;
}

// Where a username's handle should link to: your own goes to your profile page,
// anyone else's goes to the read-only viewer.
function profileHref(username) {
  return (me && username === me.username) ? "profile.html" : "user.html?u=" + encodeURIComponent(username);
}
function nameHandleLink(username, name, nameClass, handleClass) {
  const href = profileHref(username);
  return `<a class="${nameClass}" href="${href}">${h(name)}</a> <a class="${handleClass}" href="${href}">@${h(username)}</a>`;
}
function handleLink(username, name) { return nameHandleLink(username, name, "comment-name", "comment-handle"); }

function personRow(p) {
  return `<div class="comment">
    ${avatarHTML(p.username, p.name, p.avatar, "sm")}
    <div class="comment-body">${handleLink(p.username, p.name)} <span class="badge">${roleLabel(p.role)}</span></div>
  </div>`;
}

// Wires "Followers" / "Following" buttons so opening one closes the other (never both at once).
function wireFollowToggle(container) {
  container.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "toggle-followers") {
      const opening = $("followersBox").hidden;
      $("followingBox").hidden = true;
      $("followersBox").hidden = !opening;
    } else if (btn.dataset.action === "toggle-following") {
      const opening = $("followingBox").hidden;
      $("followersBox").hidden = true;
      $("followingBox").hidden = !opening;
    }
  });
}

// Escapes text for HTML, then turns @username into a link to that person's profile.
// (Same rule as the server: an @ glued to a letter/digit/period/underscore, like an email, isn't a mention.)
function richText(text) {
  return h(text).replace(/(^|[^A-Za-z0-9._])@([A-Za-z0-9._]{1,30})/g, (all, pre, name) => {
    const dots = (name.match(/\.+$/) || [""])[0];
    const clean = name.slice(0, name.length - dots.length);
    if (!clean) return all;
    return `${pre}<a class="mention" href="${profileHref(clean.toLowerCase())}">@${clean}</a>${dots}`;
  });
}

function commentHTML(c) {
  return `<div class="comment">
    ${avatarHTML(c.username, c.name, c.avatar, "sm")}
    <div class="comment-body">
      ${handleLink(c.username, c.name)}
      <p>${richText(c.content)}</p>
    </div>
  </div>`;
}

function postCardHTML(p) {
  return `
  <article class="post" data-id="${p.id}">
    <header class="post-head">
      <div class="post-who">
        ${avatarHTML(p.username, p.name, p.avatar, "sm")}
        <div class="post-who-text">
          ${nameHandleLink(p.username, p.name, "post-name", "post-handle")}
          <span class="badge">${roleLabel(p.role)}</span>
        </div>
      </div>
      <time class="post-time">${h(timeAgo(p.created))}</time>
    </header>
    <p class="post-content">${richText(p.content)}</p>
    ${p.image ? `<img class="post-image" src="${h(p.image)}" alt="">` : ""}
    <div class="post-actions">
      <button type="button" class="post-btn like-btn ${p.liked ? "active" : ""}" data-action="like">
        <span class="heart">${p.liked ? "\u2665" : "\u2661"}</span><span class="count">${p.likes}</span>
      </button>
      <button type="button" class="post-btn" data-action="toggle-comments">\uD83D\uDCAC <span class="count">${p.comments}</span></button>
      ${p.mine ? '<button type="button" class="post-btn danger" data-action="delete">Delete</button>' : ""}
    </div>
    <div class="post-comments" hidden>
      <div class="comment-list"></div>
      <form class="comment-form" autocomplete="off">
        <input type="text" maxlength="300" placeholder="Write a comment\u2026" required>
        <button type="submit" class="btn-small">Send</button>
      </form>
    </div>
  </article>`;
}

function dayNum(dateStr) { return new Date(dateStr + "T00:00:00").getDate(); }
function monthShort(dateStr) { return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { month: "short" }); }
function weekdayShort(dateStr) { return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" }); }
function formatEventTime(t) {
  if (!t) return "Time TBA";
  const [hh, mm] = t.split(":");
  const hour = Number(hh);
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = ((hour + 11) % 12) + 1;
  return h12 + ":" + mm + " " + period;
}

function eventCardHTML(e) {
  return `
  <article class="card event-card" data-id="${e.id}" data-myrsvp="${h(e.myRsvp || "")}">
    <div class="event-date-badge"><span class="w">${h(weekdayShort(e.date))}</span><span class="d">${dayNum(e.date)}</span><span class="m">${h(monthShort(e.date))}</span></div>
    <div class="event-body">
      <div class="event-top">
        <h3>${h(e.title)}</h3>
        <span class="badge cat-chip cat-${h(String(e.category || "general").toLowerCase().replace(/[^a-z]/g, ""))}">${h(e.category || "General")}</span>
      </div>
      <p class="event-meta">${h(formatEventTime(e.time))}${e.location ? " \u00b7 " + h(e.location) : ""}</p>
      ${e.description ? `<p class="event-desc">${h(e.description)}</p>` : ""}
      <p class="event-host">Hosted by <a class="host-link" href="${profileHref(e.username)}">${h(e.name)} (@${h(e.username)})</a></p>
      <div class="post-actions">
        <button type="button" class="post-btn rsvp-btn ${e.myRsvp === "going" ? "active" : ""}" data-action="rsvp-going">Going \u00b7 <span class="going-count">${e.going}</span></button>
        <button type="button" class="post-btn rsvp-btn ${e.myRsvp === "interested" ? "active" : ""}" data-action="rsvp-interested">Interested \u00b7 <span class="interested-count">${e.interested}</span></button>
        <button type="button" class="post-btn like-btn ${e.liked ? "active" : ""}" data-action="like">
          <span class="heart">${e.liked ? "\u2665" : "\u2661"}</span><span class="count">${e.likes}</span>
        </button>
        <button type="button" class="post-btn" data-action="toggle-comments">\uD83D\uDCAC <span class="count">${e.comments}</span></button>
        ${e.mine ? '<button type="button" class="post-btn danger" data-action="delete">Delete</button>' : ""}
      </div>
      <div class="post-comments" hidden>
        <div class="comment-list"></div>
        <form class="comment-form" autocomplete="off">
          <input type="text" maxlength="300" placeholder="Write a comment\u2026" required>
          <button type="submit" class="btn-small">Send</button>
        </form>
      </div>
    </div>
  </article>`;
}

// Handles like / RSVP / comment-toggle / comment-submit / delete for a container full of
// post cards or event cards. One listener per container (delegation), works for any number of cards.
function wireCardInteractions(container, cfg) {
  container.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const card = btn.closest("[data-id]");
    if (!card) return;
    const id = Number(card.dataset.id);
    const action = btn.dataset.action;

    if (action === "like") {
      const wasActive = btn.classList.contains("active");
      const countEl = btn.querySelector(".count");
      const heartEl = btn.querySelector(".heart");
      const n = Number(countEl.textContent);
      btn.classList.toggle("active");
      countEl.textContent = wasActive ? n - 1 : n + 1;
      heartEl.textContent = wasActive ? "\u2661" : "\u2665";
      const d = await api(cfg.likeUrl, { [cfg.idParam]: id });
      if (!d.ok) {
        btn.classList.toggle("active");
        countEl.textContent = n;
        heartEl.textContent = wasActive ? "\u2665" : "\u2661";
        toast(d.message || "Something went wrong.", false);
      }
      return;
    }

    if (cfg.rsvpUrl && (action === "rsvp-going" || action === "rsvp-interested")) {
      const wantStatus = action === "rsvp-going" ? "going" : "interested";
      const current = card.dataset.myrsvp || "";
      const goingBtn = card.querySelector('[data-action="rsvp-going"]');
      const interestedBtn = card.querySelector('[data-action="rsvp-interested"]');
      const goingCount = card.querySelector(".going-count");
      const interestedCount = card.querySelector(".interested-count");
      const newStatus = current === wantStatus ? "" : wantStatus;
      if (current === "going") goingCount.textContent = Number(goingCount.textContent) - 1;
      if (current === "interested") interestedCount.textContent = Number(interestedCount.textContent) - 1;
      if (newStatus === "going") goingCount.textContent = Number(goingCount.textContent) + 1;
      if (newStatus === "interested") interestedCount.textContent = Number(interestedCount.textContent) + 1;
      goingBtn.classList.toggle("active", newStatus === "going");
      interestedBtn.classList.toggle("active", newStatus === "interested");
      card.dataset.myrsvp = newStatus;
      const d = await api(cfg.rsvpUrl, { [cfg.idParam]: id, status: newStatus });
      if (!d.ok) toast(d.message || "Couldn't update RSVP.", false);
      return;
    }

    if (action === "toggle-comments") {
      const box = card.querySelector(".post-comments");
      box.hidden = !box.hidden;
      if (!box.hidden && !box.dataset.loaded) {
        box.dataset.loaded = "1";
        const list = box.querySelector(".comment-list");
        list.innerHTML = '<p class="sub">Loading\u2026</p>';
        const d = await api(cfg.commentsUrl, { [cfg.idParam]: id });
        list.innerHTML = (d.ok && d.comments.length) ? d.comments.map(commentHTML).join("") : '<p class="sub">No comments yet.</p>';
      }
      return;
    }

    if (action === "delete") {
      if (!confirm(cfg.confirmMsg || "Delete this?")) return;
      const d = await api(cfg.deleteUrl, { id });
      if (d.ok) card.remove(); else toast(d.message || "Couldn't delete that.", false);
    }
  });

  container.addEventListener("submit", async (e) => {
    const form = e.target.closest(".comment-form");
    if (!form) return;
    e.preventDefault();
    const card = form.closest("[data-id]");
    const id = Number(card.dataset.id);
    const input = form.querySelector("input");
    const content = input.value.trim();
    if (!content) return;
    const d = await api(cfg.commentUrl, { [cfg.idParam]: id, content });
    if (!d.ok) return toast(d.message || "Couldn't add the comment.", false);
    input.value = "";
    const list = form.parentElement.querySelector(".comment-list");
    if (list.querySelector(".sub")) list.innerHTML = "";
    list.insertAdjacentHTML("beforeend", commentHTML({ username: me.username, name: me.name, content }));
    const countEl = card.querySelector('[data-action="toggle-comments"] .count');
    countEl.textContent = Number(countEl.textContent) + 1;
  });
}

const POST_CFG = {
  likeUrl: "/api/posts/like", idParam: "postId", deleteUrl: "/api/posts/delete",
  commentUrl: "/api/posts/comment", commentsUrl: "/api/posts/comments", confirmMsg: "Delete this post?"
};
const EVENT_CFG = {
  likeUrl: "/api/events/like", idParam: "eventId", rsvpUrl: "/api/events/rsvp", deleteUrl: "/api/events/delete",
  commentUrl: "/api/events/comment", commentsUrl: "/api/events/comments", confirmMsg: "Delete this event?"
};

// A post composer + list of posts, for the main dashboard feed or one group's feed.
// root needs a ".post-composer" form (textarea + submit button) and a ".feed-list" container.
function initFeed(root, opts) {
  const groupId = opts && opts.groupId != null ? opts.groupId : null;
  const listEl = root.querySelector(".feed-list");
  wireCardInteractions(listEl, POST_CFG);
  let focusPending = !!(opts && opts.focusParam);

  async function reload() {
    listEl.innerHTML = skeletonHTML("post", 2);
    const d = await api("/api/posts/list", groupId != null ? { groupId } : {});
    if (!d.ok) { listEl.innerHTML = '<p class="sub">Couldn\u2019t load posts.</p>'; return; }
    listEl.innerHTML = d.posts.length ? d.posts.map(postCardHTML).join("") : '<div class="empty-state"><span class="empty-icon" aria-hidden="true">\uD83D\uDCDD</span><p>' + ((opts && opts.emptyText) || "No posts yet. Be the first to share something!") + '</p></div>';
    if (focusPending) { focusPending = false; focusFromQuery(listEl, opts.focusParam); }
  }

  const composer = root.querySelector(".post-composer");
  const postModal = composer ? wireModal("openPostForm", "postModal") : null;
  if (composer) {
    const textarea = composer.querySelector("textarea");
    const photoInput = composer.querySelector('input[type="file"]');
    const photoBox = composer.querySelector(".composer-photo");
    const photoPreview = composer.querySelector(".composer-photo-preview");
    const photoRemove = composer.querySelector(".composer-photo-remove");
    let photoDataUrl = null;

    function clearPhoto() {
      photoDataUrl = null;
      if (photoBox) photoBox.hidden = true;
      if (photoPreview) photoPreview.src = "";
    }

    photoInput?.addEventListener("change", async () => {
      const file = photoInput.files[0];
      photoInput.value = "";
      if (!file) return;
      try {
        photoDataUrl = await fileToCompressedDataUrl(file, 1280);
        photoPreview.src = photoDataUrl;
        photoBox.hidden = false;
      } catch (err) {
        toast(err.message || "Couldn't read that image.", false);
      }
    });
    photoRemove?.addEventListener("click", clearPhoto);

    composer.addEventListener("submit", async (e) => {
      e.preventDefault();
      const content = textarea.value.trim();
      if (!content) return;
      const btn = composer.querySelector('button[type="submit"]');
      btn.disabled = true;
      const params = groupId != null ? { content, groupId } : { content };
      if (photoDataUrl) params.photo = photoDataUrl;
      const d = await api("/api/posts/create", params);
      btn.disabled = false;
      if (!d.ok) return toast(d.message || "Couldn't post that.", false);
      textarea.value = "";
      clearPhoto();
      reload();
      postModal?.close();
    });
  }

  reload();
  return { reload };
}

/* ---------- Lost & found card + interactions ---------- */
function lostFoundCardHTML(item) {
  const resolved = item.status === "resolved";
  const isFound = item.type === "found";
  const typeBadge = `<span class="badge ${isFound ? "badge-found" : "badge-lost"}">${isFound ? "Found" : "Lost"}</span>`;
  const resolvedBadge = resolved ? '<span class="badge badge-resolved">Resolved \u2713</span>' : "";
  // Anyone else can message the poster straight from the card (that's the whole point of the page).
  const contact = !item.mine && !resolved
    ? `<a class="btn-small" href="messages.html?with=${encodeURIComponent(item.username)}">${isFound ? "This is mine" : "I found this"}</a>` : "";
  const mineBtns = item.mine
    ? (resolved ? "" : '<button type="button" class="post-btn" data-action="resolve">Mark resolved</button>') +
      '<button type="button" class="post-btn danger" data-action="delete">Delete</button>' : "";
  return `
  <article class="card lostfound-card ${isFound ? "is-found" : "is-lost"} ${resolved ? "resolved" : ""}" data-id="${item.id}">
    <div class="event-top">
      <h3>${h(item.item)}</h3>
      <span class="lf-badges">${typeBadge}${resolvedBadge}</span>
    </div>
    <p class="event-meta">${item.date ? h(item.date) + " \u00b7 " : ""}${h(item.location || "Location not given")}</p>
    ${item.description ? `<p class="event-desc">${h(item.description)}</p>` : ""}
    ${item.image ? `<img class="post-image" src="${h(item.image)}" alt="" loading="lazy">` : ""}
    <p class="event-host">${avatarHTML(item.username, item.name, item.avatar, "sm")} Posted by <a class="host-link" href="${profileHref(item.username)}">${h(item.name)} (@${h(item.username)})</a> \u00b7 ${h(timeAgo(item.created))}</p>
    ${contact || mineBtns ? `<div class="post-actions">${contact}${mineBtns}</div>` : ""}
  </article>`;
}

function wireLostFoundInteractions(container, reload) {
  container.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const card = btn.closest("[data-id]");
    const id = Number(card.dataset.id);
    const action = btn.dataset.action;

    if (action === "resolve") {
      btn.disabled = true;
      const d = await api("/api/lostfound/resolve", { id });
      btn.disabled = false;
      if (!d.ok) return toast(d.message || "Couldn't update that.", false);
      toast("Marked as resolved.", true);
      reload();
    }
    if (action === "delete") {
      if (!confirm("Delete this post?")) return;
      const d = await api("/api/lostfound/delete", { id });
      if (d.ok) reload(); else toast(d.message || "Couldn't delete that.", false);
    }
  });
}

/* ---------- Rides card + interactions ---------- */
function rideCardHTML(r) {
  const closed = r.status === "closed";
  const offer = r.type === "offer";
  const joinLabel = offer ? "Ask to join" : "Offer this ride";
  const statusLabel = { pending: "Requested", accepted: "Accepted \u2713", declined: "Declined" }[r.myStatus] || joinLabel;
  const seatsPill = closed
    ? '<span class="ride-pill ride-pill-closed">Closed</span>'
    : (offer && r.seats != null ? `<span class="ride-pill ride-pill-seats">${r.seats} seat${r.seats === 1 ? "" : "s"}</span>` : "");
  return `
  <article class="card ride-card ${offer ? "ride-offer" : "ride-request"} ${closed ? "closed" : ""}" data-id="${r.id}" data-mystatus="${h(r.myStatus || "")}">
    <div class="ride-top">
      <span class="badge ride-type ${offer ? "ride-type-offer" : "ride-type-request"}">${offer ? "\uD83D\uDE97 Offering" : "\uD83D\uDD90\uFE0F Looking for"}</span>
      ${seatsPill}
    </div>
    <h3 class="ride-route"><span class="ride-place">${h(r.from)}</span><span class="ride-arrow" aria-label="to">&rarr;</span><span class="ride-place">${h(r.to)}</span></h3>
    <p class="event-meta">${h(r.date)}${r.time ? " \u00b7 " + h(formatEventTime(r.time)) : ""}</p>
    ${r.notes ? `<p class="event-desc">${h(r.notes)}</p>` : ""}
    <p class="event-host">Posted by <a class="host-link" href="${profileHref(r.username)}">${h(r.name)} (@${h(r.username)})</a> \u00b7 ${r.acceptedCount} accepted</p>
    <div class="post-actions">
      ${r.mine ? `
        ${closed ? "" : '<button type="button" class="post-btn" data-action="close">Close ride</button>'}
        <button type="button" class="post-btn" data-action="toggle-requests">Requests</button>
        <button type="button" class="post-btn danger" data-action="delete">Delete</button>
      ` : (closed ? "" : `<button type="button" class="post-btn ride-request-btn ${r.myStatus ? "active" : ""}" data-action="request">${h(statusLabel)}</button>`)}
    </div>
    ${r.mine ? '<div class="group-members ride-requests" hidden><div class="member-list"></div></div>' : ""}
  </article>`;
}

function wireRideInteractions(container, reload) {
  container.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const card = btn.closest("[data-id]");
    const id = Number(card.dataset.id);
    const action = btn.dataset.action;

    if (action === "request") {
      btn.disabled = true;
      const d = await api("/api/rides/request", { rideId: id });
      btn.disabled = false;
      if (!d.ok) return toast(d.message || "Couldn't update that.", false);
      reload();
    }
    if (action === "close") {
      btn.disabled = true;
      const d = await api("/api/rides/close", { id });
      btn.disabled = false;
      if (!d.ok) return toast(d.message || "Couldn't update that.", false);
      reload();
    }
    if (action === "delete") {
      if (!confirm("Delete this ride?")) return;
      const d = await api("/api/rides/delete", { id });
      if (d.ok) card.remove(); else toast(d.message || "Couldn't delete that ride.", false);
    }
    if (action === "toggle-requests") {
      const box = card.querySelector(".ride-requests");
      box.hidden = !box.hidden;
      if (!box.hidden) {
        const list = box.querySelector(".member-list");
        list.innerHTML = '<p class="sub">Loading\u2026</p>';
        const d = await api("/api/rides/requests", { rideId: id });
        if (!d.ok || !d.requests.length) { list.innerHTML = '<p class="sub">No requests yet.</p>'; return; }
        list.innerHTML = d.requests.map((r) => `
          <div class="comment ride-request-row" data-username="${h(r.username)}">
            ${handleLink(r.username, r.name)}
            ${r.status === "pending"
              ? '<span class="post-actions" style="margin-top:.4rem;"><button type="button" class="post-btn" data-decision="accepted">Accept</button><button type="button" class="post-btn danger" data-decision="declined">Decline</button></span>'
              : `<span class="badge">${h(r.status === "accepted" ? "Accepted" : "Declined")}</span>`}
          </div>`).join("");
      }
    }

    const decisionBtn = e.target.closest("button[data-decision]");
    if (decisionBtn) {
      const row = decisionBtn.closest(".ride-request-row");
      const username = row.dataset.username;
      decisionBtn.disabled = true;
      const d = await api("/api/rides/respond", { rideId: id, username, decision: decisionBtn.dataset.decision });
      if (!d.ok) { decisionBtn.disabled = false; return toast(d.message || "Couldn't save that.", false); }
      card.querySelector('[data-action="toggle-requests"]').click();
      card.querySelector('[data-action="toggle-requests"]').click();
    }
  });
}

/* ---------- Deep links from notifications (?post=, ?event=, ?ride=, ?group=) ---------- */
// Scrolls to the card whose data-id matches the URL parameter and flashes it. Returns the card, or null.
function focusFromQuery(container, key) {
  const id = new URLSearchParams(window.location.search).get(key);
  if (!id) return null;
  const el = [...container.querySelectorAll("[data-id]")].find((x) => x.dataset.id === id);
  if (!el) { toast("That one isn't in the list any more.", false); return null; }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 2600);
  return el;
}

// Where a notification should take you, or null (follows have no target).
function notifHref(n) {
  if (n.targetId == null) return null;
  if (n.targetType === "group") {
    const gid = encodeURIComponent(n.targetId);
    if (n.type === "group_request") return "group.html?id=" + gid + "&tab=requests";
    if (n.type === "group_approved") return "group.html?id=" + gid;
  }
  const page = { post: "dashboard.html?post=", group: "groups.html?group=", event: "events.html?event=", ride: "rides.html?ride=" }[n.targetType];
  return page ? page + encodeURIComponent(n.targetId) : null;
}

/* ---------- Notifications ---------- */
function notifItemHTML(n) {
  const mention = n.actor ? "@" + n.actor : null;
  const msg = (mention && n.message.startsWith(mention))
    ? `<a class="host-link" href="${profileHref(n.actor)}">@${h(n.actor)}</a>${h(n.message.slice(mention.length))}`
    : h(n.message);
  const href = notifHref(n);
  return `<div class="notif-item ${n.read ? "" : "unread"}"${href ? ` data-href="${h(href)}" role="link" tabindex="0"` : ""}>
    <p>${msg}</p>
    <time>${h(timeAgo(n.created))}</time>
  </div>`;
}

// Browsers without cross-page view transitions: fade the panel out before leaving
if (!("CSSViewTransitionRule" in window)) {
  document.body.classList.add("no-vt");
  document.querySelectorAll('a[href="login.html"], a[href="register.html"], a[href="forgot.html"]').forEach(a =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      document.body.classList.add("leaving");
      setTimeout(() => { window.location.href = a.getAttribute("href"); }, 280);
    }));
}

// Back/forward button: a page restored from the browser's cache doesn't re-run its
// scripts, so check the login state again when it is shown.
window.addEventListener("pageshow", (e) => {
  if (!e.persisted) return;
  if (AUTH_PAGES.includes(page) && !loggedIn()) window.location.replace("login.html");
  if ((page === "login" || page === "register") && loggedIn()) window.location.replace("dashboard.html");
});

// Eye button on every password field
const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a19.77 19.77 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 5c7 0 11 7 11 7a19.86 19.86 0 0 1-3.17 4.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

document.querySelectorAll('input[type="password"]').forEach((input) => {
  const wrap = document.createElement("div");
  wrap.className = "pw-wrap";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pw-toggle";
  btn.setAttribute("aria-label", "Show password");
  btn.innerHTML = EYE;
  btn.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.innerHTML = show ? EYE_OFF : EYE;
    btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    input.focus();
  });
  wrap.appendChild(btn);
});

// Hostellor / Day scholar toggle shared by login and register
function setupRoleToggle(config, onChange) {
  const tabs = document.querySelectorAll(".tab");
  let role = savedRole();
  const apply = (instant) => {
    document.body.dataset.role = role;
    tabs.forEach(t => t.classList.toggle("active", t.dataset.role === role));
    onChange(config[role], instant);
  };
  apply(true);
  tabs.forEach(tab => tab.addEventListener("click", () => {
    if (tab.dataset.role === role) return;
    role = tab.dataset.role;
    saveRole(role);
    apply(false);
    $("error").hidden = true;
  }));
  return () => role;
}

/* ---------- Username rules (same as Instagram) ---------- */
// 1-30 characters; letters, numbers, periods, underscores; can't start or end
// with a period; no two periods in a row; not case-sensitive.
function usernameError(u) {
  if (u.length < 1 || u.length > 30) return "Username must be 1-30 characters.";
  if (!/^[a-z0-9._]+$/.test(u)) return "Usernames can only use letters, numbers, underscores and periods.";
  if (u.startsWith(".") || u.endsWith(".")) return "A username can't start or end with a period.";
  if (u.includes("..")) return "A username can't have two periods in a row.";
  return null;
}

/* ---------- Login page ---------- */
if (page === "login") {
  const getRole = setupRoleToggle({
    hostellor:  { name: "hostellor",   tag: "Life after class starts down the corridor." },
    dayscholar: { name: "day scholar", tag: "Every commute ends with a good conversation." }
  }, (l, instant) => {
    swapText($("roleName"), l.name, instant);
    swapText($("tagline"), l.tag, instant);
  });

  const errorBox = $("error");
  const showError = (msg) => { errorBox.textContent = msg; errorBox.hidden = false; };

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = $("username").value.trim().toLowerCase();
    const password = $("password").value;
    if (!username || !password) return showError("Enter your username and password.");
    const d = await api("/api/login", { role: getRole(), username, password });
    if (d.ok) {
      saveUser({ ...d.user, token: d.token });
      // The server remembers whether this account has finished the welcome page.
      window.location.replace(d.user.onboarded ? "dashboard.html" : "welcome.html");
    } else {
      showError(d.message);
    }
  });
}

/* ---------- Register page ---------- */
if (page === "register") {
  fillQuestions($("question"));
  fillHostels($("hostel"), "");
  $("gender").addEventListener("change", () => fillHostels($("hostel"), $("gender").value));

  const getRole = setupRoleToggle({
    hostellor:  { hostel: true, detailLabel: "Hostel",
                  name: "hostellor", tag: "Meet your block before the first mess bell." },
    dayscholar: { hostel: false, detailLabel: "Area you commute from",
                  name: "day scholar", tag: "Skip the lonely commute. Find your campus crew." }
  }, (l, instant) => {
    swapText($("detailLabel"), l.detailLabel, instant);
    swapText($("roleName"), l.name, instant);
    swapText($("tagline"), l.tag, instant);
    $("detailLabel").htmlFor = l.hostel ? "hostel" : "detail";
    $("hostel").hidden = !l.hostel;
    $("detail").hidden = l.hostel;
  });

  const errorBox = $("error"), okBox = $("success");
  const showError = (msg) => { okBox.hidden = true; errorBox.textContent = msg; errorBox.hidden = false; };

  // Two steps: 1 = account (name, username, password), 2 = profile (gender, hostel/area, security question).
  let step = 1;
  function goStep(n) {
    step = n;
    document.querySelectorAll(".reg-step").forEach((el) => { el.hidden = Number(el.dataset.step) !== n; });
    document.querySelectorAll(".reg-dot").forEach((d) => d.classList.toggle("active", Number(d.dataset.step) <= n));
    $("regStepLabel").textContent = n === 1 ? "Step 1 of 2 \u00b7 Your account" : "Step 2 of 2 \u00b7 Your profile";
    $("regBack").hidden = n === 1;
    $("regNextText").hidden = n === 2;
    $("regCreate").hidden = n === 1;
    errorBox.hidden = true;
    (n === 1 ? $("name") : $("gender")).focus();
  }
  $("regBack").addEventListener("click", () => goStep(1));

  $("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const role = getRole(), gender = $("gender").value;
    const name = $("name").value.trim(), username = $("username").value.trim().toLowerCase(),
          detail = role === "hostellor" ? $("hostel").value : $("detail").value.trim(),
          password = $("password").value, question = $("question").value, answer = $("answer").value.trim();
    if (step === 1) {
      if (!name || !username || !password) return showError("Fill in your name, username and password.");
      const uErr1 = usernameError(username);
      if (uErr1) return showError(uErr1);
      if (password.length < 6) return showError("Password must be at least 6 characters.");
      if (password !== $("confirm").value) return showError("The two passwords don't match.");
      return goStep(2);
    }
    if (!gender) return showError("Select your gender.");
    if (role === "hostellor" && !detail) return showError("Choose your hostel from the list.");
    if (!detail || !answer) return showError("Fill in every field.");
    const d = await api("/api/register", { role, name, gender, username, detail, password, question, answer });
    if (d.ok) {
      errorBox.hidden = true;
      okBox.textContent = "Account created. Taking you to log in...";
      okBox.hidden = false;
      setTimeout(() => { window.location.replace("login.html"); }, 1200);
    } else {
      showError(d.message);
    }
  });
}

/* ---------- Forgot password page ---------- */
if (page === "forgot") {
  const errorBox = $("error"), okBox = $("success");
  const showError = (msg) => { okBox.hidden = true; errorBox.textContent = msg; errorBox.hidden = false; };
  let username = "";

  $("findForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    username = $("username").value.trim().toLowerCase();
    if (!username) return showError("Enter your username.");
    const d = await api("/api/forgot/question", { username });
    if (!d.ok) return showError(d.message);
    errorBox.hidden = true;
    $("questionText").textContent = d.question;
    $("step").textContent = "Answer your security question and choose a new password.";
    $("findForm").hidden = true;
    $("resetForm").hidden = false;
    $("answer").focus();
  });

  $("resetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const answer = $("answer").value.trim(), newPassword = $("newPassword").value;
    if (!answer || !newPassword) return showError("Fill in every field.");
    if (newPassword.length < 6) return showError("New password must be at least 6 characters.");
    if (newPassword !== $("confirm").value) return showError("The two passwords don't match.");
    const d = await api("/api/forgot/reset", { username, answer, newPassword });
    if (!d.ok) return showError(d.message);
    errorBox.hidden = true;
    okBox.textContent = d.message + " Taking you to log in...";
    okBox.hidden = false;
    setTimeout(() => { window.location.replace("login.html"); }, 1500);
  });
}

// Unread-notification badge shown next to the bell on every signed-in page.
async function refreshNotifBadge() {
  const badge = $("notifBadge");
  if (!badge) return;
  const d = await api("/api/notifications/list");
  if (!d.ok) return;
  if (d.unread > 0) { badge.textContent = d.unread > 9 ? "9+" : d.unread; badge.hidden = false; }
  else { badge.hidden = true; }
}

// Unread-message badge shown next to the messages icon on every signed-in page.
async function refreshMsgBadge() {
  const badge = $("msgBadge");
  if (!badge) return;
  const d = await api("/api/messages/unread");
  if (!d.ok) return;
  if (d.unread > 0) { badge.textContent = d.unread > 9 ? "9+" : d.unread; badge.hidden = false; }
  else { badge.hidden = true; }
}

/* ---------- After login: dashboard and profile ---------- */
const me = getUser();
if (AUTH_PAGES.includes(page)) {
  if (!me) {
    window.location.replace("login.html");
  } else {
    document.body.dataset.role = me.role;
    $("logout").addEventListener("click", async () => {
      await api("/api/logout");
      sessionStorage.removeItem("vibelyUser");
      window.location.replace("login.html");
    });
    refreshNotifBadge();
    refreshMsgBadge();

    // The vibely logo in the topbar always takes you back to the home page.
    document.querySelectorAll(".topbar .logo").forEach((el) => {
      const a = document.createElement("a");
      a.className = el.className;
      a.href = "dashboard.html";
      a.setAttribute("aria-label", "Vibely home");
      a.textContent = el.textContent;
      el.replaceWith(a);
    });

    // Pull-to-refresh (like Instagram): drag down from the top of any page on a touch screen to reload it.
    (function () {
      if (!("ontouchstart" in window)) return;
      document.documentElement.classList.add("ptr-on");   // stops the browser's own overscroll/refresh from fighting ours
      const ind = document.createElement("div");
      ind.className = "ptr";
      ind.setAttribute("aria-hidden", "true");
      ind.innerHTML = '<span class="ptr-spin"></span>';
      document.body.appendChild(ind);
      const spin = ind.firstChild;
      const THRESHOLD = 60, MAX = 90;
      let startY = null, dist = 0, pulling = false, busy = false;

      // Don't hijack scrolling inside chats, lists, popups or the search dropdown.
      const blocked = (t) => !!t.closest(".thread-messages, .conv-list, .search-results, .modal-overlay:not([hidden]), textarea, input, select");
      const place = (px, animate) => {
        ind.style.transition = animate ? "transform .2s ease, opacity .2s ease" : "none";
        ind.style.transform = "translate(-50%, " + px + "px)";
        ind.style.opacity = Math.min(1, px / 40);
      };

      window.addEventListener("touchstart", (e) => {
        if (busy || e.touches.length !== 1 || window.scrollY > 0 || blocked(e.target)) { startY = null; return; }
        startY = e.touches[0].clientY; dist = 0; pulling = false;
      }, { passive: true });

      window.addEventListener("touchmove", (e) => {
        if (startY === null || busy) return;
        const dy = e.touches[0].clientY - startY;
        if (dy <= 0 || window.scrollY > 0) { if (pulling) { pulling = false; place(0, true); } return; }
        pulling = true;
        dist = Math.min(dy * 0.5, MAX);
        if (e.cancelable) e.preventDefault();
        place(dist, false);
        spin.style.transform = "rotate(" + dist * 4 + "deg)";
        ind.classList.toggle("ready", dist >= THRESHOLD);
      }, { passive: false });

      window.addEventListener("touchend", () => {
        if (!pulling) { startY = null; return; }
        startY = null; pulling = false;
        if (dist >= THRESHOLD) {
          busy = true;
          ind.classList.add("loading");
          place(THRESHOLD - 10, true);
          setTimeout(() => window.location.reload(), 350);
        } else {
          place(0, true);
        }
      });
      window.addEventListener("touchcancel", () => { startY = null; if (pulling) { pulling = false; place(0, true); } });
    })();

    // Global search box in the topbar: type to search people, events, groups, lost&found and rides.
    (function () {
      const input = $("globalSearch");
      const box = $("searchResults");
      if (!input || !box) return;

      let timer = null;

      function closeResults() { box.hidden = true; box.innerHTML = ""; }

      function resultLink(title, sub, href) {
        return `<a class="search-result" href="${href}"><span class="sr-title">${title}</span><span class="sr-sub">${sub}</span></a>`;
      }
      function group(title, items) {
        return `<div class="search-group"><p class="search-group-title">${title}</p>${items.join("")}</div>`;
      }

      function render(d) {
        if (!d.ok) { box.innerHTML = '<p class="search-empty">Couldn\u2019t search right now.</p>'; box.hidden = false; return; }
        if (!d.results.length) { box.innerHTML = `<p class="search-empty">No matches for \u201c${h(d.query)}\u201d.</p>`; box.hidden = false; return; }

        const byType = { user: [], event: [], group: [], lostfound: [], ride: [] };
        d.results.forEach((r) => { if (byType[r.type]) byType[r.type].push(r); });

        const sections = [];
        if (byType.user.length) sections.push(group("People", byType.user.map((u) =>
          resultLink(`${avatarHTML(u.username, u.name, u.avatar, "sm")} ${h(u.name)} <span class="badge">${roleLabel(u.role)}</span>`,
            "@" + h(u.username) + (u.course ? " \u00b7 " + h(u.course) : ""), profileHref(u.username)))));
        if (byType.event.length) sections.push(group("Events", byType.event.map((e) =>
          resultLink(h(e.title), (e.date ? h(e.date) + " \u00b7 " : "") + h(e.location || e.category), "events.html"))));
        if (byType.group.length) sections.push(group("Groups", byType.group.map((g) =>
          resultLink(h(g.name), g.members + " member" + (g.members === 1 ? "" : "s") + " \u00b7 " + h(g.category), "groups.html?group=" + g.id))));
        if (byType.lostfound.length) sections.push(group("Lost & found", byType.lostfound.map((i) =>
          resultLink(h(i.item), (i.itemType === "found" ? "Found" : "Lost") + (i.location ? " \u00b7 " + h(i.location) : ""), "lostfound.html?item=" + i.id))));
        if (byType.ride.length) sections.push(group("Rides", byType.ride.map((r) =>
          resultLink(h(r.from) + " \u2192 " + h(r.to), h(r.date) + (r.rideType === "offer" ? " \u00b7 Offering" : " \u00b7 Looking for"), "rides.html"))));

        box.innerHTML = sections.join("");
        box.hidden = false;
      }

      async function runSearch(q) {
        const d = await api("/api/search", { q });
        if (input.value.trim() === q) render(d);
      }

      input.addEventListener("input", () => {
        const q = input.value.trim();
        clearTimeout(timer);
        if (!q) { closeResults(); return; }
        timer = setTimeout(() => runSearch(q), 300);
      });

      input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { closeResults(); input.blur(); }
        if (e.key === "Enter") { e.preventDefault(); clearTimeout(timer); const q = input.value.trim(); if (q) runSearch(q); }
      });

      input.addEventListener("focus", () => { if (input.value.trim() && box.innerHTML) box.hidden = false; });
      document.addEventListener("click", (e) => { if (!e.target.closest(".search-wrap")) closeResults(); });
    })();

    // Mobile hamburger menu for the topbar nav.
    (function () {
      const toggle = $("navToggle");
      const nav = $("topbarNav");
      if (!toggle || !nav) return;
      const closeMenu = () => {
        nav.classList.remove("open");
        toggle.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      };
      const openMenu = () => {
        nav.classList.add("open");
        toggle.classList.add("open");
        toggle.setAttribute("aria-expanded", "true");
      };
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        nav.classList.contains("open") ? closeMenu() : openMenu();
      });
      document.addEventListener("click", (e) => {
        if (nav.classList.contains("open") && !nav.contains(e.target) && e.target !== toggle) closeMenu();
      });
      nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", closeMenu));
      window.addEventListener("resize", () => { if (window.innerWidth > 760) closeMenu(); });
    })();
    // Mobile bottom tab bar. CSS shows it on narrow screens only (and hides the hamburger, gear, theme and logout
    // buttons from the topbar there); they live in the "More" sheet instead. Not used on the full-height group chat.
    (function () {
      if (page === "groupchat" || !document.querySelector(".topbar nav")) return;
      const svg = (inner) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + "</svg>";
      const I = {
        home: svg('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>'),
        events: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
        groups: svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
        rides: svg('<path d="M3 13l2-6a2 2 0 0 1 2-1.5h10a2 2 0 0 1 2 1.5l2 6v5h-3v-2H6v2H3z"/><circle cx="7.5" cy="14" r=".8"/><circle cx="16.5" cy="14" r=".8"/>'),
        profile: svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
        more: svg('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'),
        music: svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
        lost: svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
        settings: svg('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>'),
        moon: svg('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
        sun: svg('<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'),
        logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>')
      };
      const activeKey = ({ dashboard: "home", discover: "home", events: "events", groups: "groups", group: "groups",
        rides: "rides", profile: "profile", settings: "profile", music: "more", lostfound: "more" })[page] || "";
      const tabs = [["dashboard.html", "Home", "home"], ["events.html", "Events", "events"], ["groups.html", "Groups", "groups"],
        ["rides.html", "Rides", "rides"], ["profile.html", "Profile", "profile"]];

      document.body.classList.add("has-tabbar");

      const bar = document.createElement("nav");
      bar.className = "tabbar";
      bar.setAttribute("aria-label", "Main");
      bar.innerHTML = tabs.map(([href, label, key]) =>
        '<a class="tab-item' + (activeKey === key ? " active" : "") + '" href="' + href + '"' + (activeKey === key ? ' aria-current="page"' : "") + ">" + I[key] + "<span>" + label + "</span></a>"
      ).join("") +
        '<button type="button" class="tab-item' + (activeKey === "more" ? " active" : "") + '" id="moreBtn" aria-haspopup="true" aria-expanded="false" aria-controls="moreSheet">' + I.more + "<span>More</span></button>";

      const backdrop = document.createElement("div");
      backdrop.className = "more-backdrop";
      const sheet = document.createElement("div");
      sheet.className = "more-sheet";
      sheet.id = "moreSheet";
      sheet.setAttribute("role", "menu");
      document.body.append(backdrop, sheet, bar);

      const moreBtn = bar.querySelector("#moreBtn");
      const close = () => {
        sheet.classList.remove("open"); backdrop.classList.remove("open");
        moreBtn.setAttribute("aria-expanded", "false");
      };
      const open = () => {
        const dark = document.documentElement.dataset.theme === "dark";
        sheet.innerHTML =
          '<a class="more-item" role="menuitem" href="music.html">' + I.music + "Music</a>" +
          '<a class="more-item" role="menuitem" href="lostfound.html">' + I.lost + "Lost &amp; Found</a>" +
          '<a class="more-item" role="menuitem" href="settings.html">' + I.settings + "Settings</a>" +
          '<button type="button" class="more-item" role="menuitem" data-act="theme">' + (dark ? I.sun : I.moon) + (dark ? "Light mode" : "Dark mode") + "</button>" +
          '<div class="more-sep"></div>' +
          '<button type="button" class="more-item danger" role="menuitem" data-act="logout">' + I.logout + "Log out</button>";
        sheet.classList.add("open"); backdrop.classList.add("open");
        moreBtn.setAttribute("aria-expanded", "true");
      };

      moreBtn.addEventListener("click", () => (sheet.classList.contains("open") ? close() : open()));
      backdrop.addEventListener("click", close);
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
      sheet.addEventListener("click", (e) => {
        const b = e.target.closest("[data-act]");
        if (!b) return;
        close();
        if (b.dataset.act === "theme") { const t = $("themeToggle"); if (t) t.click(); }
        if (b.dataset.act === "logout") { const l = $("logout"); if (l) l.click(); }
      });
      window.addEventListener("pageshow", close);
    })();
  }
}

/* ---------- @mention suggestions (post box + comment boxes) ---------- */
// Type "@" and a few letters in a post or comment box and a small list of matching people appears.
// One menu, shared by every box on the page, using the same search the top search bar uses.
(function () {
  if (!AUTH_PAGES.includes(page) || page === "welcome") return;
  if (!getUser()) return;

  const FIELD = ".post-composer textarea, .comment-form input";
  const menu = document.createElement("div");
  menu.className = "mention-menu";
  menu.hidden = true;
  menu.setAttribute("role", "listbox");
  document.body.appendChild(menu);

  let field = null, tokenStart = -1, items = [], active = 0, timer = null, seq = 0, peopleCache = null;

  function close() { menu.hidden = true; menu.innerHTML = ""; items = []; field = null; tokenStart = -1; }

  // The "@partial" the caret is sitting at the end of, or null.
  function currentToken(el) {
    const caret = el.selectionStart;
    const m = el.value.slice(0, caret).match(/(^|[^A-Za-z0-9._])@([A-Za-z0-9._]{0,30})$/);
    return m ? { start: caret - m[2].length - 1, query: m[2] } : null;
  }

  function place() {
    const r = field.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + "px";
    const below = r.bottom + 6;
    const fitsBelow = below + menu.offsetHeight <= window.innerHeight - 8;
    menu.style.top = (fitsBelow ? below : Math.max(8, r.top - menu.offsetHeight - 6)) + "px";
  }

  function render() {
    menu.innerHTML = items.map((u, i) => `
      <button type="button" class="mention-item ${i === active ? "active" : ""}" role="option" data-i="${i}">
        ${avatarHTML(u.username, u.name, u.avatar, "sm")}
        <span class="mention-text"><b>${h(u.name)}</b><span>@${h(u.username)}</span></span>
      </button>`).join("");
    menu.hidden = false;
    place();
  }

  function pick(i) {
    const u = items[i];
    if (!u || !field) return;
    const el = field;
    const caret = el.selectionStart;
    el.value = el.value.slice(0, tokenStart) + "@" + u.username + " " + el.value.slice(caret);
    const pos = tokenStart + u.username.length + 2;
    close();
    el.focus();
    el.setSelectionRange(pos, pos);
  }

  document.addEventListener("input", (e) => {
    const el = e.target;
    if (!el.matches || !el.matches(FIELD)) return;
    const tok = currentToken(el);
    clearTimeout(timer);
    if (!tok) { close(); return; }
    field = el; tokenStart = tok.start;
    const mine = ++seq;
    if (!tok.query) {                                   // just "@": offer a few people right away
      (async () => {
        if (!peopleCache) { const d = await api("/api/people"); peopleCache = d.ok ? d.people : []; }
        if (mine !== seq || field !== el) return;
        items = peopleCache.slice(0, 5); active = 0;
        if (items.length) render(); else close();
      })();
      return;
    }
    timer = setTimeout(async () => {
      const d = await api("/api/search", { q: tok.query });
      if (mine !== seq || field !== el) return;          // typing moved on
      items = d.ok ? d.results.filter((r) => r.type === "user").slice(0, 5) : [];
      active = 0;
      if (items.length) render(); else close();
    }, 200);
  });

  // Capture phase, so Enter picks a person instead of submitting the comment form.
  document.addEventListener("keydown", (e) => {
    if (menu.hidden || !items.length || e.target !== field) return;
    if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % items.length; render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + items.length) % items.length; render(); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); pick(active); }
    else if (e.key === "Escape") { e.stopPropagation(); close(); }
  }, true);

  // mousedown (not click) so the box doesn't lose focus before we read it
  menu.addEventListener("mousedown", (e) => {
    const btn = e.target.closest(".mention-item");
    if (!btn) return;
    e.preventDefault();
    pick(Number(btn.dataset.i));
  });

  document.addEventListener("focusout", (e) => { if (e.target === field) setTimeout(close, 150); });
  window.addEventListener("resize", () => { if (!menu.hidden && field) place(); });
})();

/* ---------- Dashboard page ---------- */
if (page === "dashboard" && me) {
  const cardsByRole = {
    hostellor: [
      ["Hostel mates", "See who's in your block and start a study group."],
      ["Mess menu", "Today's meals and a way to rate them."],
      ["Late-night hangouts", "Join plans after classes end."]
    ],
    dayscholar: [
      ["Commute buddies", "Find people on your route to share rides."],
      ["Canteen meetups", "Pick a table and a time between lectures."],
      ["Campus events", "Clubs, fests and workshops this week."]
    ]
  };

  $("cards").innerHTML = cardsByRole[me.role]
    .map(([t, p]) => `<div class="card"><h3>${h(t)}</h3><p>${h(p)}</p></div>`).join("");

  initFeed($("mainFeed"), { focusParam: "post" });
  const composerAv = $("composerAvatar");
  if (composerAv) composerAv.innerHTML = avatarHTML(me.username, me.name, me.avatarPath);

  $("events").innerHTML = skeletonHTML("li", 3);
  api("/api/events/list").then((d) => {
    const box = $("events");
    if (!d.ok || !d.events.length) {
      box.innerHTML = `<li><span>No events yet. <a href="events.html">Create one</a>.</span></li>`;
      return;
    }
    box.innerHTML = d.events.slice(0, 4).map((e) => `
      <li>
        <b>${h(weekdayShort(e.date))}</b>
        <span>${h(e.title)} <span class="sub">\u00b7 ${h(e.location || e.category)}</span></span>
      </li>`).join("");
  });

  function renderHeader(u) {
    $("welcome").textContent = "Hey " + u.name + "!";
    $("detail").textContent = (u.role === "hostellor" ? "Hostellor" : "Day scholar") + " · " + u.detail + " · @" + u.username;
    const checks = [
      [u.role === "hostellor" ? "hostel" : "commute area", u.detail], ["bio", u.bio], ["course", u.course],
      ["year", u.year], ["interests", u.interests], ["security question", u.hasQuestion], ["name", u.name], ["gender", u.gender]
    ];
    const missing = checks.filter(([, v]) => !v).map(([k]) => k);
    const pct = Math.round(((checks.length - missing.length) / checks.length) * 100);
    $("pct").textContent = pct;
    $("barFill").style.width = pct + "%";
    $("meterHint").textContent = missing.length ? "Still missing: " + missing.join(", ") + "." : "Your profile is complete. Nice!";
    // Once the profile is 100% complete, the whole card (message, bar and Edit profile button) goes away.
    const meterCard = document.querySelector(".meter");
    if (meterCard) meterCard.hidden = pct === 100;
  }
  renderHeader(me);

  api("/api/me").then((d) => {
    if (!d.ok) return;
    saveUser({ ...d.user, token: me.token });
    if (!d.user.onboarded) { window.location.replace("welcome.html"); return; }   // first time here
    renderHeader(d.user);
  });

  $("people").innerHTML = skeletonHTML("person", 3);
  api("/api/people").then((d) => {
    const box = $("people");
    if (!d.ok || !d.people.length) {
      box.innerHTML = emptyStateHTML("\uD83D\uDC4B", "It\u2019s quiet here", "No one else has joined yet. Invite your friends to Vibely!");
      return;
    }
    box.innerHTML = d.people.map((p) => `
      <div class="card person" data-username="${h(p.username)}">
        <a class="person-link" href="${profileHref(p.username)}">
          ${avatarHTML(p.username, p.name, p.avatar)}
          <h3>${h(p.name)}</h3>
          <p class="handle">@${h(p.username)}</p>
        </a>
        <span class="badge">${roleLabel(p.role)}</span>
        <button type="button" class="btn-small follow-btn ${p.following ? "following" : ""}" data-action="follow">${p.following ? "Following" : "Follow"}</button>
      </div>`).join("");
  });

  $("people").addEventListener("click", async (e) => {
    const btn = e.target.closest(".follow-btn");
    if (!btn) return;
    const username = btn.closest(".person").dataset.username;
    btn.disabled = true;
    const d = await api("/api/follow", { username });
    btn.disabled = false;
    if (!d.ok) return toast(d.message || "Couldn't update that.", false);
    btn.textContent = d.following ? "Following" : "Follow";
    btn.classList.toggle("following", d.following);
  });
}

/* ---------- Discover people page ---------- */
if (page === "discover" && me) {
  const grid = $("discoverGrid"), input = $("peopleSearch"), title = $("discoverTitle");
  let suggested = [], found = null, filter = "all", timer = null;
  const following = new Set();
  const myCourse = () => String((getUser() || me).course || "").trim().toLowerCase();

  function card(p) {
    const same = myCourse() && String(p.course || "").trim().toLowerCase() === myCourse();
    const isFollowing = following.has(p.username);
    return `<div class="person-card" data-username="${h(p.username)}">
      ${avatarHTML(p.username, p.name, p.avatar)}
      <div class="person-text">
        <a class="person-name" href="${profileHref(p.username)}">${h(p.name)}</a>
        <span class="person-handle">@${h(p.username)}</span>
        <div class="person-tags">
          <span class="badge">${roleLabel(p.role)}</span>
          ${same ? '<span class="same-course">Same course</span>' : ""}
        </div>
      </div>
      <button type="button" class="btn-small follow-btn ${isFollowing ? "following" : ""}" data-action="follow">${isFollowing ? "Following" : "Follow"}</button>
    </div>`;
  }

  function render() {
    const list = (found || suggested).filter((p) => {
      if (filter === "course") return myCourse() && String(p.course || "").trim().toLowerCase() === myCourse();
      if (filter === "hostellor" || filter === "dayscholar") return p.role === filter;
      return true;
    });
    title.textContent = found ? "Search results" : "Suggested for you";
    if (!list.length) {
      grid.innerHTML = found
        ? emptyStateHTML("\uD83D\uDD0D", "No one matches that", "Try a different name, username or course.")
        : emptyStateHTML("\uD83D\uDC4B", "Nobody to suggest yet", "Try searching by name, username or course.");
      return;
    }
    grid.innerHTML = list.map(card).join("");
  }

  async function runSearch(q) {
    const d = await api("/api/search", { q });
    if (input.value.trim() !== q) return;          // a newer search has started
    if (!d.ok) { grid.innerHTML = '<p class="sub">Couldn\u2019t search right now.</p>'; return; }
    found = d.results.filter((r) => r.type === "user");
    render();
  }

  input.addEventListener("input", () => {
    const q = input.value.trim();
    clearTimeout(timer);
    if (!q) { found = null; render(); return; }
    timer = setTimeout(() => runSearch(q), 300);
  });

  $("peopleFilters").addEventListener("click", (e) => {
    const b = e.target.closest(".seg-btn");
    if (!b) return;
    filter = b.dataset.filter;
    document.querySelectorAll("#peopleFilters .seg-btn").forEach((x) => {
      x.classList.toggle("active", x === b);
      x.setAttribute("aria-selected", x === b ? "true" : "false");
    });
    render();
  });

  grid.addEventListener("click", async (e) => {
    const btn = e.target.closest(".follow-btn");
    if (!btn) return;
    const username = btn.closest(".person-card").dataset.username;
    btn.disabled = true;
    const d = await api("/api/follow", { username });
    btn.disabled = false;
    if (!d.ok) return toast(d.message || "Couldn't update that.", false);
    d.following ? following.add(username) : following.delete(username);
    btn.textContent = d.following ? "Following" : "Follow";
    btn.classList.toggle("following", d.following);
  });

  (async function load() {
    // Who you already follow (search results don't say), the suggestions, and a fresh copy of your course.
    const [c, p, m] = await Promise.all([api("/api/connections"), api("/api/people"), api("/api/me")]);
    if (c.ok) c.following.forEach((u) => following.add(u.username));
    if (m.ok) saveUser({ ...m.user, token: me.token });
    if (!p.ok) { grid.innerHTML = '<p class="sub">Couldn\u2019t load people.</p>'; return; }
    suggested = p.people;
    p.people.forEach((u) => { if (u.following) following.add(u.username); });
    render();
  })();
}

/* ---------- Welcome / onboarding page (first login) ---------- */
if (page === "welcome" && me) {
  const FOLLOW_GOAL = 3, GROUP_GOAL = 2;
  let user = { ...me };

  const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "there";
  function renderHello() { $("welcomeTitle").textContent = "Welcome to Vibely, " + firstName(user.name) + "!"; }
  renderHello();

  // Progress line + button label, counted straight from the buttons on screen.
  function updateProgress() {
    const followed = document.querySelectorAll("#people .follow-btn.following").length;
    const joined = document.querySelectorAll("#groupPicks .follow-btn.following").length;
    $("progress").textContent = "Following " + followed + " of " + FOLLOW_GOAL + " \u00b7 Joined " + joined + " of " + GROUP_GOAL;
    $("finishBtn").textContent = (followed || joined) ? "Continue to Vibely" : "Skip for now";
  }

  async function finish() {
    const btn = $("finishBtn");
    btn.disabled = true;
    const d = await api("/api/onboarded");
    if (!d.ok) { btn.disabled = false; return toast(d.message || "Couldn't save that. Try again.", false); }
    saveUser({ ...(getUser() || me), onboarded: true });
    window.location.replace("dashboard.html");
  }
  $("finishBtn").addEventListener("click", finish);

  /* People to follow (same-course people come first once a course is saved) */
  async function loadPeople() {
    const box = $("people");
    box.innerHTML = skeletonHTML("person", 3);
    const d = await api("/api/people");
    if (!d.ok) { box.innerHTML = '<p class="sub">Couldn\u2019t load people.</p>'; return; }
    if (!d.people.length) {
      box.innerHTML = '<div class="card"><p>You\u2019re one of the first here! Invite your friends and they\u2019ll show up here as they join.</p></div>';
      updateProgress();
      return;
    }
    const myCourse = String(user.course || "").trim().toLowerCase();
    box.innerHTML = d.people.map((p) => `
      <div class="card person" data-username="${h(p.username)}">
        <a class="person-link" href="${profileHref(p.username)}" target="_blank" rel="noopener">
          ${avatarHTML(p.username, p.name, p.avatar)}
          <h3>${h(p.name)}</h3>
          <p class="handle">@${h(p.username)}</p>
        </a>
        <span class="badge">${roleLabel(p.role)}</span>
        ${p.course ? `<p>${h(p.course)}</p>` : ""}
        ${myCourse && String(p.course || "").trim().toLowerCase() === myCourse ? '<p class="same-course">Same course as you</p>' : ""}
        <button type="button" class="btn-small follow-btn ${p.following ? "following" : ""}" data-action="follow">${p.following ? "Following" : "Follow"}</button>
      </div>`).join("");
    // Offer the courses people already typed, so classmates end up with matching text.
    const courses = [...new Set(d.people.map((p) => p.course).filter(Boolean))];
    $("courseList").innerHTML = courses.map((c) => `<option value="${h(c)}">`).join("");
    updateProgress();
  }

  $("people").addEventListener("click", async (e) => {
    const btn = e.target.closest(".follow-btn");
    if (!btn) return;
    const username = btn.closest(".person").dataset.username;
    btn.disabled = true;
    const d = await api("/api/follow", { username });
    btn.disabled = false;
    if (!d.ok) return toast(d.message || "Couldn't update that.", false);
    btn.textContent = d.following ? "Following" : "Follow";
    btn.classList.toggle("following", d.following);
    updateProgress();
  });

  /* Groups to join (biggest first) */
  async function loadGroups() {
    const box = $("groupPicks");
    box.innerHTML = skeletonHTML("card", 2);
    const d = await api("/api/groups/list");
    if (!d.ok) { box.innerHTML = '<p class="sub">Couldn\u2019t load groups.</p>'; return; }
    const groups = d.groups.filter((g) => !g.isAdmin).sort((a, b) => b.members - a.members).slice(0, 6);
    if (!groups.length) {
      box.innerHTML = '<div class="card"><p>No groups yet. <a href="groups.html">Start the first one</a>!</p></div>';
      updateProgress();
      return;
    }
    box.innerHTML = groups.map((g) => `
      <div class="card group-pick" data-id="${g.id}">
        <h3>${h(g.name)}</h3>
        <span class="badge">${h(g.category || "General")}</span>
        ${g.description ? `<p class="event-desc">${h(g.description)}</p>` : ""}
        <p class="sub">${g.members} member${g.members === 1 ? "" : "s"}</p>
        <button type="button" class="btn-small follow-btn ${g.joined || g.requested ? "following" : ""}" data-action="join" ${g.joined ? "disabled" : ""}>${g.joined ? "Joined \u2713" : g.requested ? "Requested \u2713" : "Request to join"}</button>
      </div>`).join("");
    updateProgress();
  }

  $("groupPicks").addEventListener("click", async (e) => {
    const btn = e.target.closest(".follow-btn");
    if (!btn) return;
    const groupId = btn.closest(".group-pick").dataset.id;
    btn.disabled = true;
    const d = await api("/api/groups/request", { groupId });
    btn.disabled = false;
    if (!d.ok) return toast(d.message || "Couldn't update that.", false);
    btn.textContent = d.requested ? "Requested \u2713" : "Request to join";
    btn.classList.toggle("following", d.requested);
    updateProgress();
  });

  /* Course / year, so we can find classmates (shown only if the profile has no course yet) */
  $("courseForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const course = $("wCourse").value.trim(), year = $("wYear").value;
    if (!course) return toast("Type your course or branch first.", false);
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    const d = await api("/api/profile", {
      name: user.name || "", gender: user.gender || "", detail: user.detail || "",
      bio: user.bio || "", course, year, interests: user.interests || ""
    });
    btn.disabled = false;
    if (!d.ok) return toast(d.message || "Couldn't save that.", false);
    user = { ...user, course, year };
    saveUser({ ...user, token: me.token });
    $("courseCard").hidden = true;
    toast("Saved. Showing your classmates first.", true);
    loadPeople();
  });

  // Start from the latest profile on the server, then load the lists.
  api("/api/me").then((d) => {
    if (d.ok) { user = { ...d.user }; saveUser({ ...d.user, token: me.token }); }
    renderHello();
    $("courseCard").hidden = !!user.course;
    loadPeople();
    loadGroups();
  });
  updateProgress();
}

/* ---------- Profile page (your own public-facing profile) ---------- */
if (page === "profile" && me) {
  function paintProfile(u) {
    $("uAvatar").innerHTML = avatarHTML(u.username, u.name, u.avatarPath, "lg");
    $("uName").textContent = u.name;
    $("uWho").textContent = "@" + u.username + " \u00b7 " + roleLabel(u.role);
    $("uDetailLine").textContent = (u.role === "hostellor" ? "Hostel: " : "Commutes from: ") + (u.detail || "\u2014");
    $("uBio").textContent = u.bio || "No bio yet.";
    $("uCourse").textContent = u.course ? u.course + (u.year ? " \u00b7 " + u.year : "") : "";
    $("uCourse").hidden = !u.course;
    $("uInterests").textContent = u.interests ? "Interests: " + u.interests : "";
    $("uInterests").hidden = !u.interests;
    $("emptyHint").hidden = !!(u.bio && u.course && u.interests);
  }
  paintProfile(me);
  api("/api/me").then((d) => { if (d.ok) { saveUser({ ...d.user, token: me.token }); paintProfile(d.user); } });

  api("/api/connections").then((d) => {
    if (!d.ok) return;
    $("followerCount").textContent = d.followerCount;
    $("followingCount").textContent = d.followingCount;
    $("followersList").innerHTML = d.followers.length ? d.followers.map(personRow).join("") : '<p class="sub">No followers yet.</p>';
    $("followingList").innerHTML = d.following.length ? d.following.map(personRow).join("") : '<p class="sub">Not following anyone yet.</p>';
  });
  wireFollowToggle($("followersBox").previousElementSibling);
}
/* ---------- Settings page (edit details, account) ---------- */
if (page === "settings" && me) {
  fillQuestions($("question"));
  const isHostellor = me.role === "hostellor";
  $("detailLabel").textContent = isHostellor ? "Hostel" : "Area you commute from";
  $("detailLabel").htmlFor = isHostellor ? "hostel" : "detail";
  $("hostel").hidden = !isHostellor;
  $("detail").hidden = isHostellor;
  $("gender").addEventListener("change", () => fillHostels($("hostel"), $("gender").value));

  function fill(u) {
    $("who").textContent = "@" + u.username + " · " + (u.role === "hostellor" ? "Hostellor" : "Day scholar");
    $("name").value = u.name; $("gender").value = u.gender; $("course").value = u.course;
    $("year").value = u.year; $("bio").value = u.bio; $("interests").value = u.interests;
    if (isHostellor) fillHostels($("hostel"), u.gender, u.detail);
    else $("detail").value = u.detail;
    $("secStatus").textContent = u.hasQuestion
      ? "A security question is set. You can change it below."
      : "No security question yet. Add one so you can reset your password if you forget it.";
    $("avatarPreview").innerHTML = avatarHTML(u.username, u.name, u.avatarPath, "lg");
    $("removeAvatarBtn").hidden = !u.avatarPath;
  }
  fill(me);
  api("/api/me").then((d) => { if (d.ok) { saveUser({ ...d.user, token: me.token }); fill(d.user); } });

  // The fields detailsForm sends; the avatar uploader reuses this so a photo-only
  // change still round-trips the rest of the profile correctly.
  function profileFieldsOrError() {
    const gender = $("gender").value;
    const detail = isHostellor ? $("hostel").value : $("detail").value.trim();
    if (!gender) return "Select your gender.";
    if (isHostellor && !detail) return "Choose your hostel from the list.";
    return {
      name: $("name").value.trim(), gender, detail, course: $("course").value.trim(),
      year: $("year").value, bio: $("bio").value.trim(), interests: $("interests").value.trim()
    };
  }

  // collect() returns either an object of values to send, or a string (an error to show)
  function bindForm(formId, path, collect, onOk) {
    const form = $(formId);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const params = collect();
      if (typeof params === "string") return toast(params, false);
      const d = await api(path, params);
      toast(d.message || "Something went wrong.", d.ok);
      if (d.ok && onOk) onOk(d, params, form);
    });
  }

  bindForm("detailsForm", "/api/profile", profileFieldsOrError,
    (d, params) => { saveUser({ ...getUser(), ...params }); fill(getUser()); });

  $("avatarInput").addEventListener("change", async () => {
    const file = $("avatarInput").files[0];
    $("avatarInput").value = "";
    if (!file) return;
    const fields = profileFieldsOrError();
    if (typeof fields === "string") return toast(fields, false);
    let photo;
    try {
      photo = await fileToCompressedDataUrl(file, 640);
    } catch (err) {
      return toast(err.message || "Couldn't read that image.", false);
    }
    const d = await api("/api/profile", { ...fields, photo });
    toast(d.ok ? "Photo updated." : (d.message || "Couldn't update your photo."), d.ok);
    if (d.ok) {
      const me2 = await api("/api/me");
      if (me2.ok) { saveUser({ ...me2.user, token: me.token }); fill(me2.user); }
    }
  });

  $("removeAvatarBtn").addEventListener("click", async () => {
    const fields = profileFieldsOrError();
    if (typeof fields === "string") return toast(fields, false);
    const d = await api("/api/profile", { ...fields, removePhoto: "1" });
    toast(d.ok ? "Photo removed." : (d.message || "Couldn't remove your photo."), d.ok);
    if (d.ok) {
      const me2 = await api("/api/me");
      if (me2.ok) { saveUser({ ...me2.user, token: me.token }); fill(me2.user); }
    }
  });

  bindForm("usernameForm", "/api/username", () => {
    const newUsername = $("newUsername").value.trim().toLowerCase();
    const err = usernameError(newUsername);
    if (err) return err;
    if (!$("uPassword").value) return "Enter your current password.";
    return { newUsername, password: $("uPassword").value };
  }, (d, params, form) => { saveUser({ ...getUser(), username: d.username }); fill(getUser()); form.reset(); });

  bindForm("passwordForm", "/api/password", () => {
    const next = $("newPassword").value;
    if (!$("curPassword").value) return "Enter your current password.";
    if (next.length < 6) return "New password must be at least 6 characters.";
    if (next !== $("newConfirm").value) return "The two new passwords don't match.";
    return { password: $("curPassword").value, newPassword: next };
  }, (d, params, form) => form.reset());

  bindForm("securityForm", "/api/security", () => {
    if (!$("answer").value.trim()) return "Enter your answer.";
    if (!$("sPassword").value) return "Enter your current password.";
    return { question: $("question").value, answer: $("answer").value.trim(), password: $("sPassword").value };
  }, (d, params, form) => { saveUser({ ...getUser(), hasQuestion: true }); fill(getUser()); form.reset(); });

  // Profile / Account tabs (deep-linkable with #account)
  const setTabs = document.querySelectorAll("#settingsTabs .seg-btn");
  function showSettingsTab(name, updateHash) {
    setTabs.forEach((btn) => {
      const on = btn.dataset.tab === name;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    $("tab-profile").hidden = name !== "profile";
    $("tab-account").hidden = name !== "account";
    if (updateHash) history.replaceState(null, "", name === "account" ? "#account" : location.pathname + location.search);
  }
  setTabs.forEach((btn) => btn.addEventListener("click", () => showSettingsTab(btn.dataset.tab, true)));
  showSettingsTab(location.hash === "#account" ? "account" : "profile", false);
}
/* ---------- Events page ---------- */
if (page === "events" && me) {
  const listEl = $("eventList");
  wireCardInteractions(listEl, EVENT_CFG);
  const createModal = wireModal("openEventForm", "eventModal");

  async function loadEvents() {
    listEl.innerHTML = skeletonHTML("event", 3);
    const d = await api("/api/events/list");
    if (!d.ok) { listEl.innerHTML = '<p class="sub">Couldn\u2019t load events.</p>'; return; }
    listEl.innerHTML = d.events.length ? d.events.map(eventCardHTML).join("") : emptyStateHTML("\uD83C\uDF89", "No events yet", "Workshops, fests, meetups \u2014 be the first to put something on the calendar.", { label: "Create an event", click: "#openEventForm" });
    if (!eventFocused) { eventFocused = true; focusFromQuery(listEl, "event"); }
  }
  let eventFocused = false;
  loadEvents();

  $("eventForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("evTitle").value.trim();
    const date = $("evDate").value;
    if (!title) return toast("Give the event a title.", false);
    if (!date) return toast("Pick a date.", false);
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    const d = await api("/api/events/create", {
      title, category: $("evCategory").value, location: $("evLocation").value.trim(),
      date, time: $("evTime").value, description: $("evDescription").value.trim()
    });
    btn.disabled = false;
    toast(d.message || "Something went wrong.", d.ok);
    if (d.ok) { e.target.reset(); loadEvents(); createModal?.close(); }
  });
}

/* ---------- Groups page ---------- */
if (page === "groups" && me) {
  const createModal = wireModal("openGroupForm", "groupModal");
  const joinModal = makeModal("joinModal");
  const params = new URLSearchParams(location.search);
  let groups = [];
  let tab = ["joined", "mine"].includes(params.get("tab")) ? params.get("tab") : "all";
  let joinTarget = null;
  let deepLinkDone = false;

  const pluralMembers = (n) => n + " member" + (n === 1 ? "" : "s");

  function groupCardHTML(g) {
    const status = g.isCreator ? "Owner" : g.isAdmin ? "Admin" : g.joined ? "Joined" : g.requested ? "Requested" : "";
    return `
    <article class="card group-card clickable" data-id="${g.id}" tabindex="0" role="button" aria-label="${g.joined ? "Open" : "View"} ${h(g.name)}">
      <div class="group-top">
        <h3>${h(g.name)}</h3>
        <div class="group-top-right">
          ${status ? `<span class="badge badge-status">${status}</span>` : ""}
          <span class="badge">${h(g.category || "General")}</span>
          <button type="button" class="dd-btn" aria-label="Group options" aria-haspopup="menu" aria-expanded="false">&#8942;</button>
        </div>
      </div>
      ${g.description ? `<p class="event-desc">${h(g.description)}</p>` : ""}
      <p class="event-meta">${pluralMembers(g.members)} \u00b7 started by <a class="host-link" href="${profileHref(g.createdBy)}">@${h(g.createdBy)}</a></p>
      ${g.isAdmin && g.pending ? `<p class="event-meta pending-note">${g.pending} join request${g.pending === 1 ? "" : "s"} waiting</p>` : ""}
    </article>`;
  }

  function render() {
    const joined = groups.filter((g) => g.joined);
    $("allCount").textContent = groups.length;
    $("joinedCount").textContent = joined.length;
    const mine = groups.filter((g) => g.isCreator);
    $("mineCount").textContent = mine.length;
    $("mineList").innerHTML = mine.length
      ? mine.map(groupCardHTML).join("")
      : emptyStateHTML("\uD83C\uDF31", "You haven\u2019t started a group", "Start a club or interest group and invite people to join.", { label: "Start a group", click: "#openGroupForm" });
    $("groupList").innerHTML = groups.length ? groups.map(groupCardHTML).join("") : emptyStateHTML("\uD83D\uDC65", "No groups yet", "Be the first to start one.", { label: "Start a group", click: "#openGroupForm" });
    $("joinedList").innerHTML = joined.length
      ? joined.map(groupCardHTML).join("")
      : emptyStateHTML("\uD83D\uDD0E", "You haven\u2019t joined any groups", "Find a group you like and send a request to join.", { label: "Browse all groups", click: '#groupTabs [data-tab="all"]' });
    setTab(tab);
  }

  function setTab(name) {
    tab = name;
    document.querySelectorAll("#groupTabs .seg-btn").forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    $("allSection").hidden = name !== "all";
    $("joinedSection").hidden = name !== "joined";
    $("mineSection").hidden = name !== "mine";
  }
  $("groupTabs").addEventListener("click", (e) => {
    const b = e.target.closest(".seg-btn");
    if (b) setTab(b.dataset.tab);
  });

  async function loadGroups() {
    const d = await api("/api/groups/list");
    if (!d.ok) { $("groupList").innerHTML = '<p class="sub">Couldn\u2019t load groups.</p>'; return; }
    groups = d.groups;
    render();
    if (!deepLinkDone) {                                   // ?group=ID from a search result or notification
      deepLinkDone = true;
      const id = params.get("group");
      if (!id) return;
      const g = groups.find((x) => String(x.id) === id);
      if (!g) toast("That group isn\u2019t here any more.", false);
      else if (g.joined) window.location.replace("group.html?id=" + g.id + "&tab=" + (params.get("tab") || "posts"));
      else openJoin(g);
    }
  }

  // Joined groups open their own page; everything else opens the request-to-join popup.
  function openGroup(g) {
    if (g.joined) window.location.href = "group.html?id=" + g.id;
    else openJoin(g);
  }

  function openJoin(g) {
    joinTarget = g;
    $("joinTitle").textContent = g.name;
    $("joinCategory").textContent = g.category || "General";
    $("joinDesc").textContent = g.description || "No description yet.";
    $("joinMeta").textContent = pluralMembers(g.members) + " \u00b7 started by @" + g.createdBy;
    $("joinNote").textContent = g.requested
      ? "Your request is waiting for an admin to approve it."
      : "Group admins review every request. You\u2019ll get a notification once you\u2019re approved.";
    $("joinRequestBtn").textContent = g.requested ? "Cancel request" : "Request to join";
    $("joinRequestBtn").classList.toggle("btn-outline", !!g.requested);
    joinModal?.open();
  }

  async function sendRequest(g) {
    const d = await api("/api/groups/request", { groupId: g.id });
    if (!d.ok) { toast(d.message || "Couldn\u2019t send that request.", false); loadGroups(); return false; }
    g.requested = d.requested;
    render();
    toast(d.requested ? "Request sent. An admin will review it." : "Request cancelled.", true);
    return true;
  }

  $("joinRequestBtn").addEventListener("click", async () => {
    if (!joinTarget) return;
    const btn = $("joinRequestBtn");
    btn.disabled = true;
    const ok = await sendRequest(joinTarget);
    btn.disabled = false;
    if (ok) joinModal?.close();
  });

  function groupMenuItems(g) {
    if (g.joined) return [["open", "Open group"], g.isCreator ? ["delete", "Delete group", true] : ["leave", "Leave group", true]];
    return g.requested ? [["view", "View details"], ["cancel", "Cancel request", true]] : [["view", "View details"], ["request", "Request to join"]];
  }

  async function pickMenu(g, key) {
    if (key === "open") return openGroup(g);
    if (key === "view") return openJoin(g);
    if (key === "request" || key === "cancel") return sendRequest(g);
    if (key === "leave") {
      if (!confirm("Leave " + g.name + "? You\u2019ll need to request to join again.")) return;
      const d = await api("/api/groups/leave", { groupId: g.id });
      toast(d.message || "Something went wrong.", d.ok);
      if (d.ok) loadGroups();
    }
    if (key === "delete") {
      if (!confirm("Delete this group? Its posts, chat and members are removed for everyone.")) return;
      const d = await api("/api/groups/delete", { id: g.id });
      toast(d.message || "Something went wrong.", d.ok);
      if (d.ok) loadGroups();
    }
  }

  function onCardClick(e) {
    const card = e.target.closest(".group-card");
    if (!card || e.target.closest("a")) return;
    const g = groups.find((x) => String(x.id) === card.dataset.id);
    if (!g) return;
    const menuBtn = e.target.closest(".dd-btn");
    if (menuBtn) { openDropdown(menuBtn, groupMenuItems(g), (key) => pickMenu(g, key)); return; }
    openGroup(g);
  }
  for (const id of ["groupList", "joinedList", "mineList"]) {
    $(id).addEventListener("click", onCardClick);
    $(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.classList.contains("group-card")) onCardClick(e);
    });
  }

  loadGroups();

  $("groupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("grName").value.trim();
    if (!name) return toast("Give the group a name.", false);
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    const d = await api("/api/groups/create", {
      name, category: $("grCategory").value, description: $("grDescription").value.trim()
    });
    btn.disabled = false;
    toast(d.message || "Something went wrong.", d.ok);
    if (d.ok) { e.target.reset(); loadGroups(); createModal?.close(); }
  });
}

/* ---------- Single group page (posts, chat, members, requests) ---------- */
if (page === "group" && me) {
  const gid = Number(new URLSearchParams(location.search).get("id"));
  const TABS = ["posts", "members", "requests"];
  let g = null;
  let activeTab = "posts";
  let feedStarted = false;

  const dayLabel = (s) => {
    const d = new Date(s), today = new Date();
    const diff = Math.floor((new Date(today.toDateString()) - new Date(d.toDateString())) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
  };
  const clockTime = (s) => new Date(s).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");

  function renderHead() {
    document.title = "Vibely \u2013 " + g.name;
    $("gName").textContent = g.name;
    $("gAvatar").textContent = (g.name.trim()[0] || "G").toUpperCase();
    $("gAvatar").style.background = avatarColor(g.name);
    $("gMeta").innerHTML = `<span class="chip chip-accent">${h(g.category || "General")}</span>
      <span class="chip">${plural(g.members, "member")}</span>
      ${g.isCreator ? '<span class="chip">You\u2019re the owner</span>' : g.isAdmin ? '<span class="chip">You\u2019re an admin</span>' : ""}
      <span class="chip">by <a class="host-link" href="${profileHref(g.createdBy)}">@${h(g.createdBy)}</a></span>`;
    $("gDesc").textContent = g.description || "";
    $("gDesc").hidden = !g.description;
    $("reqTabBtn").hidden = !g.isAdmin;
    $("reqCount").textContent = g.pending || "";
    $("reqCount").hidden = !g.pending;
    $("memCount").textContent = g.members || "";
    $("gMenuBtn").hidden = false;
    $("openGroupChat").href = "groupchat.html?id=" + gid;
    $("openGroupChat").hidden = false;
  }

  function showTab(name) {
    if (!TABS.includes(name) || (name === "requests" && !g.isAdmin)) name = "posts";
    activeTab = name;
    document.querySelectorAll("#gTabs .seg-btn").forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    TABS.forEach((t) => { $("tab-" + t).hidden = t !== name; });
    if (name === "members") loadMembers();
    if (name === "requests") loadRequests();
    const u = new URL(window.location.href);
    u.searchParams.set("tab", name);
    history.replaceState(null, "", u);
  }

  /* ----- Posts: admins post, everyone reads / likes / comments ----- */
  function startFeed() {
    if (feedStarted) return;
    feedStarted = true;
    if (!g.isAdmin) { $("gComposer")?.remove(); $("postsNote").hidden = false; }
    else $("gComposerAvatar").innerHTML = avatarHTML(me.username, me.name, me.avatarPath);
    initFeed($("postsRoot"), {
      groupId: gid,
      emptyText: g.isAdmin ? "No posts yet. Share the first update with your group." : "No posts yet. Admins will share updates here."
    });
  }

  /* ----- Members ----- */
  let memberData = [];

  function memberCardHTML(m) {
    const isAdmin = m.groupRole === "admin";
    const canManage = g.isAdmin && m.username !== me.username && !m.creator && (!isAdmin || g.isCreator);
    return `<div class="person-card" data-username="${h(m.username)}" data-admin="${isAdmin ? 1 : 0}">
      ${avatarHTML(m.username, m.name, m.avatar)}
      <div class="person-text">
        <a class="person-name" href="${profileHref(m.username)}">${h(m.name)}</a>
        <span class="person-handle">@${h(m.username)}</span>
        <span class="person-tags">
          ${m.creator ? '<span class="chip chip-accent">Owner</span>' : isAdmin ? '<span class="chip chip-accent">Admin</span>' : ""}
          ${m.username === me.username ? '<span class="chip">You</span>' : ""}
          <span class="chip">${roleLabel(m.role)}</span>
        </span>
      </div>
      ${canManage ? '<button type="button" class="dd-btn" aria-label="Member options" aria-haspopup="menu" aria-expanded="false">&#8942;</button>' : ""}
    </div>`;
  }

  function renderMembers() {
    const box = $("gMembers");
    const q = $("memberSearch").value.trim().toLowerCase();
    const list = memberData.filter((m) => !q || m.name.toLowerCase().includes(q) || m.username.toLowerCase().includes(q));
    if (!list.length) { box.innerHTML = `<div class="empty-state"><span class="empty-icon" aria-hidden="true">\uD83D\uDD0D</span><p>${q ? "No members match that search." : "No members yet."}</p></div>`; return; }
    const admins = list.filter((m) => m.groupRole === "admin");
    const regular = list.filter((m) => m.groupRole !== "admin");
    const section = (title, arr) => arr.length
      ? `<h4 class="list-title">${title} <span class="seg-count">${arr.length}</span></h4><div class="people-grid">${arr.map(memberCardHTML).join("")}</div>` : "";
    box.innerHTML = section("Admins", admins) + section("Members", regular);
  }

  async function loadMembers() {
    const box = $("gMembers");
    if (!memberData.length) box.innerHTML = skeletonHTML("person", 3);
    const d = await api("/api/groups/members", { groupId: gid });
    if (!d.ok) { box.innerHTML = `<p class="sub">${h(d.message || "Couldn\u2019t load members.")}</p>`; return; }
    memberData = d.members;
    g.members = d.members.length;
    renderHead();
    renderMembers();
  }
  $("memberSearch").addEventListener("input", renderMembers);

  $("gMembers").addEventListener("click", (e) => {
    const btn = e.target.closest(".dd-btn");
    if (!btn) return;
    const row = btn.closest(".person-card");
    const username = row.dataset.username;
    const isAdmin = row.dataset.admin === "1";
    const items = [];
    if (!isAdmin) items.push(["promote", "Make admin"]);
    items.push(["remove", "Remove from group", true]);
    openDropdown(btn, items, async (key) => {
      if (key === "promote") {
        const d = await api("/api/groups/promote", { groupId: gid, username });
        toast(d.message || "Something went wrong.", d.ok);
      } else if (key === "remove") {
        if (!confirm("Remove @" + username + " from the group?")) return;
        const d = await api("/api/groups/remove", { groupId: gid, username });
        toast(d.message || "Something went wrong.", d.ok);
      }
      loadMembers();
    });
  });

  /* ----- Join requests (admins) ----- */
  async function loadRequests() {
    const box = $("gRequests");
    box.innerHTML = skeletonHTML("person", 2);
    const d = await api("/api/groups/requests", { groupId: gid });
    if (!d.ok) { box.innerHTML = `<p class="sub">${h(d.message || "Couldn\u2019t load requests.")}</p>`; return; }
    g.pending = d.requests.length;
    renderHead();
    box.innerHTML = d.requests.length
      ? `<p class="sub req-intro">${plural(d.requests.length, "person").replace("persons", "people")} waiting for your approval.</p>
         <div class="req-list">${d.requests.map((r) => `
        <div class="person-card req-card" data-username="${h(r.username)}">
          ${avatarHTML(r.username, r.name, r.avatar)}
          <div class="person-text">
            <a class="person-name" href="${profileHref(r.username)}">${h(r.name)}</a>
            <span class="person-handle">@${h(r.username)} \u00b7 requested ${h(timeAgo(r.created))}</span>
            <span class="person-tags"><span class="chip">${roleLabel(r.role)}</span></span>
          </div>
          <div class="req-actions">
            <button type="button" class="req-btn req-approve" data-decision="approve">Approve</button>
            <button type="button" class="req-btn req-decline" data-decision="reject">Decline</button>
          </div>
        </div>`).join("")}</div>`
      : '<div class="empty-state"><span class="empty-icon" aria-hidden="true">\u2705</span><p>You\u2019re all caught up. No pending requests.</p></div>';
  }

  $("gRequests").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-decision]");
    if (!btn) return;
    const username = btn.closest(".person-card").dataset.username;
    btn.closest(".req-actions").querySelectorAll("button").forEach((b) => { b.disabled = true; });
    const d = await api("/api/groups/respond", { groupId: gid, username, decision: btn.dataset.decision });
    toast(d.message || "Something went wrong.", d.ok);
    if (d.ok && btn.dataset.decision === "approve") memberData = [];
    loadRequests();
  });

  /* ----- Header menu: leave / delete / requests ----- */
  $("gMenuBtn").addEventListener("click", () => {
    const items = [];
    if (g.isAdmin) items.push(["requests", "Join requests" + (g.pending ? " (" + g.pending + ")" : "")]);
    items.push(g.isCreator ? ["delete", "Delete group", true] : ["leave", "Leave group", true]);
    openDropdown($("gMenuBtn"), items, async (key) => {
      if (key === "requests") return showTab("requests");
      if (key === "leave") {
        if (!confirm("Leave " + g.name + "? You\u2019ll need to request to join again.")) return;
        const d = await api("/api/groups/leave", { groupId: gid });
        if (!d.ok) return toast(d.message || "Couldn\u2019t leave that group.", false);
        window.location.href = "groups.html?tab=joined";
      }
      if (key === "delete") {
        if (!confirm("Delete this group? Its posts, chat and members are removed for everyone.")) return;
        const d = await api("/api/groups/delete", { id: gid });
        if (!d.ok) return toast(d.message || "Couldn\u2019t delete that group.", false);
        window.location.href = "groups.html?tab=joined";
      }
    });
  });

  $("gTabs").addEventListener("click", (e) => {
    const b = e.target.closest(".seg-btn");
    if (b) showTab(b.dataset.tab);
  });

  /* ----- Start: only members get in; everyone else goes back to the request popup ----- */
  if (!gid) {
    window.location.replace("groups.html");
  } else {
    api("/api/groups/get", { groupId: gid }).then((d) => {
      if (!d.ok) { toast(d.message || "That group isn\u2019t here any more.", false); setTimeout(() => window.location.replace("groups.html"), 900); return; }
      if (!d.group.joined) { window.location.replace("groups.html?group=" + gid); return; }
      g = d.group;
      renderHead();
      startFeed();
      showTab(new URLSearchParams(location.search).get("tab") || "posts");
    });
  }
}

/* ---------- Group chat page (separate page, opened from the chat button on the group page) ---------- */
if (page === "groupchat" && me) {
  const gid = Number(new URLSearchParams(location.search).get("id"));
  let g = null, chatTimer = null, chatSig = "";

  const dayLabel = (s) => {
    const d = new Date(s), today = new Date();
    const diff = Math.floor((new Date(today.toDateString()) - new Date(d.toDateString())) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
  };
  const clockTime = (s) => new Date(s).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  function renderChat(msgs) {
    const box = $("gChatMessages");
    let html = "", lastDay = null;
    msgs.forEach((m, i) => {
      const day = new Date(m.created).toDateString();
      if (day !== lastDay) { html += `<div class="day-divider"><span>${h(dayLabel(m.created))}</span></div>`; lastDay = day; }
      const prev = msgs[i - 1], next = msgs[i + 1];
      const samePrev = prev && prev.username === m.username && new Date(prev.created).toDateString() === day;
      const sameNext = next && next.username === m.username && new Date(next.created).toDateString() === day;
      const cls = (samePrev ? "" : "group-first ") + (sameNext ? "" : "group-last");
      const canMenu = m.mine || g.isAdmin;
      html += `<div class="msg-row ${m.mine ? "mine" : ""} ${cls}" data-id="${m.id}">
        ${avatarHTML(m.username, m.name, m.avatar, "sm")}
        <div class="msg-bubble">
          ${!samePrev && !m.mine ? `<a class="gmsg-name" href="${profileHref(m.username)}">${h(m.name)}</a>` : ""}
          <p>${h(m.content)}</p>${sameNext ? "" : `<time>${h(clockTime(m.created))}</time>`}
        </div>
        ${canMenu ? `<button type="button" class="msg-more" data-id="${m.id}" aria-label="Message options" aria-haspopup="menu" aria-expanded="false">&#8943;</button>` : ""}
      </div>`;
    });
    box.innerHTML = html || '<div class="conv-empty"><span class="empty-icon" aria-hidden="true">\uD83D\uDC4B</span><p class="sub">No messages yet. Say hello to the group!</p></div>';
  }

  async function loadChat(keepScroll, forceBottom) {
    const box = $("gChatMessages");
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    const d = await api("/api/groups/chat/list", { groupId: gid });
    if (!d.ok) { if (!keepScroll) toast(d.message || "Couldn\u2019t load the chat.", false); return; }
    const sig = d.messages.map((m) => m.id).join("|");
    if (sig !== chatSig) {
      chatSig = sig;
      renderChat(d.messages);
      if (forceBottom || !keepScroll || nearBottom) box.scrollTop = box.scrollHeight;
    }
  }

  $("gChatForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("gChatInput");
    const content = input.value.trim();
    if (!content) return;
    input.value = "";
    const d = await api("/api/groups/chat/send", { groupId: gid, content });
    if (!d.ok) { input.value = content; return toast(d.message || "Couldn\u2019t send that.", false); }
    loadChat(true, true);
  });

  $("gChatMessages").addEventListener("click", (e) => {
    const btn = e.target.closest(".msg-more");
    if (!btn) return;
    const text = btn.closest(".msg-row")?.querySelector(".msg-bubble p")?.textContent || "";
    const mine = btn.closest(".msg-row")?.classList.contains("mine");
    openDropdown(btn, [["copy", "Copy"], ["delete", mine ? "Delete message" : "Delete (admin)", true]], async (key) => {
      if (key === "copy") {
        try { await navigator.clipboard.writeText(text); toast("Copied.", true); }
        catch (_) { toast("Couldn\u2019t copy that.", false); }
      } else if (key === "delete") {
        if (!confirm("Delete this message for everyone in the group?")) return;
        const d = await api("/api/groups/chat/delete", { id: btn.dataset.id });
        if (!d.ok) return toast(d.message || "Couldn\u2019t delete that.", false);
        loadChat(true, false);
      }
    });
  });

  window.addEventListener("pagehide", () => clearInterval(chatTimer));

  if (!gid) {
    window.location.replace("groups.html");
  } else {
    api("/api/groups/get", { groupId: gid }).then((d) => {
      if (!d.ok) { toast(d.message || "That group isn\u2019t here any more.", false); setTimeout(() => window.location.replace("groups.html"), 900); return; }
      if (!d.group.joined) { window.location.replace("groups.html?group=" + gid); return; }
      g = d.group;
      document.title = "Vibely \u2013 " + g.name + " chat";
      $("gcName").textContent = g.name;
      $("gcMeta").textContent = g.members + (g.members === 1 ? " member" : " members");
      $("gcBack").href = "group.html?id=" + gid;
      loadChat(false, true);
      chatTimer = setInterval(() => { if (!document.hidden) loadChat(true, false); }, 4000);
      $("gChatInput").focus();
    });
  }
}

/* ---------- Lost & found page ---------- */
if (page === "lostfound" && me) {
  const listEl = $("lfList");
  const createModal = wireModal("openLfForm", "lfModal");
  let items = null, filter = "all", query = "", focused = false;

  // Lost/found date defaults to today and can't be in the future.
  const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const resetDate = () => { $("lfDate").max = today(); $("lfDate").value = today(); };
  resetDate();

  function visible() {
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => filter === "all" || (filter === "mine" ? i.mine : i.type === filter))
      .filter((i) => !q || [i.item, i.location, i.description, i.name, i.username].some((t) => (t || "").toLowerCase().includes(q)))
      .sort((a, b) => (a.status === "resolved") - (b.status === "resolved"));   // open items first, newest first within each group
  }

  function render() {
    if (!items) return;
    const counts = {
      all: items.length, lost: items.filter((i) => i.type === "lost").length,
      found: items.filter((i) => i.type === "found").length, mine: items.filter((i) => i.mine).length
    };
    Object.keys(counts).forEach((k) => { const el = $("lfCount_" + k); if (el) el.textContent = counts[k]; });
    const list = visible();
    if (list.length) { listEl.innerHTML = list.map(lostFoundCardHTML).join(""); return; }
    if (query.trim()) listEl.innerHTML = emptyStateHTML("\uD83D\uDD0D", "Nothing matches", "Try a different word, or clear the search.");
    else if (filter === "mine") listEl.innerHTML = emptyStateHTML("\uD83D\uDCCB", "You haven\u2019t posted anything", "Lost something, or found something that isn\u2019t yours? Post it here.", { label: "Post an item", click: "#openLfForm" });
    else if (items.length) listEl.innerHTML = emptyStateHTML("\uD83D\uDD0D", "Nothing here yet", "No " + filter + " items right now.");
    else listEl.innerHTML = emptyStateHTML("\uD83E\uDDF3", "Nothing lost or found", "That\u2019s a good thing. If you lose something, or find something that isn\u2019t yours, post it here.", { label: "Post an item", click: "#openLfForm" });
  }

  async function loadLostFound() {
    if (!items) listEl.innerHTML = skeletonHTML("card", 4);   // only the first load; later reloads swap in place
    const d = await api("/api/lostfound/list");
    if (!d.ok) { if (!items) listEl.innerHTML = '<p class="sub">Couldn\u2019t load items.</p>'; return; }
    items = d.items;
    render();
    if (!focused) { focused = true; focusFromQuery(listEl, "item"); }   // search results link here with ?item=<id>
  }
  wireLostFoundInteractions(listEl, loadLostFound);
  loadLostFound();

  $("lfFilters").addEventListener("click", (e) => {
    const b = e.target.closest(".seg-btn");
    if (!b) return;
    filter = b.dataset.filter;
    document.querySelectorAll("#lfFilters .seg-btn").forEach((x) => {
      x.classList.toggle("active", x === b);
      x.setAttribute("aria-selected", x === b ? "true" : "false");
    });
    render();
  });
  $("lfSearch").addEventListener("input", (e) => { query = e.target.value; render(); });

  let lfPhotoDataUrl = null;
  function clearLfPhoto() {
    lfPhotoDataUrl = null;
    $("lfPhotoBox").hidden = true;
    $("lfPhotoPreview").src = "";
  }
  $("lfPhoto").addEventListener("change", async () => {
    const file = $("lfPhoto").files[0];
    $("lfPhoto").value = "";
    if (!file) return;
    try {
      lfPhotoDataUrl = await fileToCompressedDataUrl(file, 1280);
      $("lfPhotoPreview").src = lfPhotoDataUrl;
      $("lfPhotoBox").hidden = false;
    } catch (err) {
      toast(err.message || "Couldn't read that image.", false);
    }
  });
  $("lfPhotoRemove").addEventListener("click", clearLfPhoto);

  $("lfForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const item = $("lfItem").value.trim();
    if (!item) return toast("Name the item.", false);
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    const params = {
      type: $("lfType").value, item, location: $("lfLocation").value.trim(),
      date: $("lfDate").value, description: $("lfDescription").value.trim()
    };
    if (lfPhotoDataUrl) params.photo = lfPhotoDataUrl;
    const d = await api("/api/lostfound/create", params);
    btn.disabled = false;
    toast(d.message || "Something went wrong.", d.ok);
    if (d.ok) { e.target.reset(); resetDate(); clearLfPhoto(); loadLostFound(); createModal?.close(); }
  });
}

/* ---------- Rides page ---------- */
if (page === "rides" && me) {
  const listEl = $("rideList");
  const createModal = wireModal("openRideForm", "rideModal");
  async function loadRides() {
    listEl.innerHTML = skeletonHTML("card", 4);
    const d = await api("/api/rides/list");
    if (!d.ok) { listEl.innerHTML = '<p class="sub">Couldn\u2019t load rides.</p>'; return; }
    listEl.innerHTML = d.rides.length ? d.rides.map(rideCardHTML).join("") : emptyStateHTML("\uD83D\uDE97", "No rides posted yet", "Heading somewhere? Offer a seat, or ask if anyone is going your way.", { label: "Post a ride", click: "#openRideForm" });
    if (!rideFocused) { rideFocused = true; focusFromQuery(listEl, "ride"); }
  }
  let rideFocused = false;
  wireRideInteractions(listEl, loadRides);
  loadRides();

  $("rideForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const from = $("rdFrom").value.trim(), to = $("rdTo").value.trim(), date = $("rdDate").value;
    if (!from || !to) return toast("Fill in where you're coming from and going to.", false);
    if (!date) return toast("Pick a date.", false);
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    const d = await api("/api/rides/create", {
      type: $("rdType").value, from, to, date, time: $("rdTime").value,
      seats: $("rdSeats").value.trim(), notes: $("rdNotes").value.trim()
    });
    btn.disabled = false;
    toast(d.message || "Something went wrong.", d.ok);
    if (d.ok) { e.target.reset(); loadRides(); createModal?.close(); }
  });
}

/* ---------- Public profile viewer (someone else's account) ---------- */
if (page === "user" && me) {
  const target = (new URLSearchParams(location.search).get("u") || "").trim().toLowerCase();

  if (!target || target === me.username) {
    // No one specified, or it's your own account — that's your own profile.html (edited in settings.html).
    window.location.replace("profile.html");
  } else {
    api("/api/userprofile", { username: target }).then((d) => {
      $("loadingMsg").hidden = true;
      if (!d.ok) { $("notFoundMsg").hidden = false; return; }

      const u = d.user;
      $("userView").hidden = false;
      $("uAvatar").innerHTML = avatarHTML(u.username, u.name, u.avatarPath, "lg");
      $("uName").textContent = u.name;
      $("uWho").textContent = "@" + u.username + " \u00b7 " + roleLabel(u.role);
      $("uDetailLine").textContent = (u.role === "hostellor" ? "Hostel: " : "Commutes from: ") + (u.detail || "\u2014");
      $("uBio").textContent = u.bio || "No bio yet.";
      $("uCourse").textContent = u.course ? u.course + (u.year ? " \u00b7 " + u.year : "") : "";
      $("uCourse").hidden = !u.course;
      $("uInterests").textContent = u.interests ? "Interests: " + u.interests : "";
      $("uInterests").hidden = !u.interests;

      $("followerCount").textContent = d.followerCount;
      $("followingCount").textContent = d.followingCount;
      $("followersList").innerHTML = '<p class="sub">Loading\u2026</p>';
      $("followingList").innerHTML = '<p class="sub">Loading\u2026</p>';
      api("/api/connections", { username: u.username }).then((c) => {
        if (!c.ok) return;
        $("followersList").innerHTML = c.followers.length ? c.followers.map(personRow).join("") : '<p class="sub">No followers yet.</p>';
        $("followingList").innerHTML = c.following.length ? c.following.map(personRow).join("") : '<p class="sub">Not following anyone yet.</p>';
      });
      wireFollowToggle($("followersBox").previousElementSibling);

      const followBtn = $("followBtn");
      const paint = (following) => {
        followBtn.textContent = following ? "Following" : "Follow";
        followBtn.classList.toggle("following", following);
      };
      paint(d.isFollowing);
      followBtn.addEventListener("click", async () => {
        followBtn.disabled = true;
        const r = await api("/api/follow", { username: u.username });
        followBtn.disabled = false;
        if (!r.ok) return toast(r.message || "Couldn't update that.", false);
        paint(r.following);
        $("followerCount").textContent = Number($("followerCount").textContent) + (r.following ? 1 : -1);
      });

      const messageBtn = $("messageBtn");
      if (messageBtn) messageBtn.href = "messages.html?with=" + encodeURIComponent(u.username);
    });
  }
}

/* ---------- Messages page ---------- */
if (page === "messages" && me) {
  const convListEl = $("convList");
  const threadPanel = $("threadPanel");
  const threadPlaceholder = $("threadPlaceholder");
  const threadMessages = $("threadMessages");
  const threadForm = $("threadForm");
  const threadInput = $("threadInput");
  let current = null;   // username of the open conversation
  let currentAvatar = ""; // avatar path of the open conversation's other user
  let pollTimer = null;
  let lastIds = new Set();   // ids currently rendered in the open thread, so a poll can skip a no-op re-render
  let lastSig = "";          // id + unsent/edited state of every message, so unsend/edit also trigger a re-render
  let editingId = null;      // id of the message being edited, if any
  let menuEl = null;         // the open message options menu
  const editBar = document.createElement("div");
  editBar.className = "edit-bar";
  editBar.hidden = true;
  editBar.innerHTML = '<span>Editing message</span><button type="button" aria-label="Cancel editing">Cancel</button>';
  threadForm.before(editBar);

  function convPreviewHTML(c) {
    const prefix = c.lastMine ? "You: " : "";
    return `
    <button type="button" class="conv-item ${c.username === current ? "active" : ""} ${c.unread ? "unread-row" : ""}" data-username="${h(c.username)}" data-name="${h(c.name)}" data-avatar="${h(c.avatar || "")}">
      ${avatarHTML(c.username, c.name, c.avatar)}
      <span class="conv-text">
        <span class="conv-name">${h(c.name)}</span>
        <span class="conv-preview">${c.lastUnsent ? (c.lastMine ? "You unsent a message" : "Message unsent") : h(prefix + c.lastContent)}</span>
      </span>
      <span class="conv-meta">
        <time>${h(timeAgo(c.lastCreated))}</time>
        ${c.unread ? `<span class="conv-unread">${c.unread > 9 ? "9+" : c.unread}</span>` : ""}
      </span>
    </button>`;
  }

  async function loadConversations() {
    const d = await api("/api/messages/conversations");
    if (!d.ok) { convListEl.innerHTML = '<p class="sub conv-empty">Couldn\u2019t load your messages.</p>'; return; }
    convListEl.innerHTML = d.conversations.length
      ? d.conversations.map(convPreviewHTML).join("")
      : `<div class="conv-empty"><span class="empty-icon" aria-hidden="true">\uD83D\uDCAC</span>
         <p class="sub">No conversations yet.<br>Visit someone\u2019s profile and tap Message to start one.</p></div>`;
  }

  function dayLabel(dateStr) {
    const d = new Date(dateStr);
    const today = new Date();
    const diffDays = Math.floor((new Date(today.toDateString()) - new Date(d.toDateString())) / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
  }
  function clockTime(dateStr) {
    return new Date(dateStr).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  // Renders the whole thread with day dividers, and groups consecutive
  // messages from the same sender (avatar + rounded "tail" only on the last one).
  // newIds marks which messages are new since the last render, so only those
  // get the entrance animation — otherwise every poll would replay it on everything.
  function renderThread(messages, otherUsername, otherName, newIds) {
    closeMenu();
    let html = "";
    let lastDay = null;
    let lastMineIdx = -1;   // my newest sent (not unsent) message gets the Sent/Seen receipt
    messages.forEach((m, i) => { if (m.mine && !m.unsent && m.id) lastMineIdx = i; });
    messages.forEach((m, i) => {
      const day = new Date(m.created).toDateString();
      if (day !== lastDay) { html += `<div class="day-divider"><span>${h(dayLabel(m.created))}</span></div>`; lastDay = day; }
      const next = messages[i + 1];
      const prev = messages[i - 1];
      const sameAsNext = next && next.mine === m.mine && new Date(next.created).toDateString() === day;
      const sameAsPrev = prev && prev.mine === m.mine && new Date(prev.created).toDateString() === day;
      const groupClass = (sameAsPrev ? "" : "group-first ") + (sameAsNext ? "" : "group-last");
      const isNew = newIds && newIds.has(m.id);
      const av = m.mine ? avatarHTML(me.username, me.name, me.avatarPath, "sm") : avatarHTML(otherUsername, otherName, currentAvatar, "sm");
      html += `<div class="msg-row ${m.mine ? "mine" : ""} ${groupClass} ${isNew ? "new-msg" : ""}">
        ${av}
        ${m.unsent
          ? `<div class="msg-bubble unsent"><p>${m.mine ? "You unsent a message" : "This message was unsent"}</p></div>`
          : `<div class="msg-bubble"><p>${h(m.content)}</p>${m.edited ? '<span class="edited-tag">edited</span>' : ""}${sameAsNext ? "" : `<time>${h(clockTime(m.created))}</time>`}</div>`}
        ${m.id ? `<button type="button" class="msg-more" data-id="${m.id}" data-mine="${m.mine ? 1 : 0}" data-unsent="${m.unsent ? 1 : 0}" data-canedit="${m.canEdit ? 1 : 0}" aria-label="Message options" aria-haspopup="menu">&#8943;</button>` : ""}
      </div>${i === lastMineIdx ? `<div class="msg-receipt ${m.read ? "seen" : ""}">${m.read ? "\u2713\u2713 Seen" : "\u2713 Sent"}</div>` : ""}`;
    });
    threadMessages.innerHTML = html || '<div class="conv-empty"><span class="empty-icon" aria-hidden="true">\uD83D\uDC4B</span><p class="sub">No messages yet. Say hello!</p></div>';
  }

  async function loadThread(username, keepScroll) {
    const nearBottom = keepScroll
      ? (threadMessages.scrollHeight - threadMessages.scrollTop - threadMessages.clientHeight < 60)
      : true;
    const d = await api("/api/messages/thread", { with: username });
    if (!d.ok) { toast(d.message || "Couldn\u2019t open that conversation.", false); return; }
    currentAvatar = d.avatar || currentAvatar;
    $("threadName").textContent = d.name;
    $("threadName").href = profileHref(username);
    $("threadHandle").textContent = "@" + username;
    $("threadHandle").href = profileHref(username);

    const idsNow = d.messages.map((m) => m.id);
    const sigNow = d.messages.map((m) => m.id + (m.unsent ? "u" : "") + (m.edited ? "e" : "") + (m.mine && m.read ? "r" : "") + (m.canEdit ? "c" : "")).join("|");
    const unchanged = keepScroll && sigNow === lastSig;
    if (!unchanged) {
      const newIds = new Set(idsNow.filter((id) => !lastIds.has(id)));
      renderThread(d.messages, username, d.name, keepScroll ? newIds : null);
      lastIds = new Set(idsNow);
      lastSig = sigNow;
      if (nearBottom) threadMessages.scrollTop = threadMessages.scrollHeight;
    }
    refreshMsgBadge();
  }

  function openThread(username, name, avatar) {
    cancelEdit();
    closeMenu();
    current = username;
    currentAvatar = avatar || "";
    lastIds = new Set();
    lastSig = "";
    threadPanel.hidden = false;
    if (threadPlaceholder) threadPlaceholder.hidden = true;
    document.body.classList.add("thread-open");
    document.querySelectorAll(".conv-item").forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.username === username));
    if (name) $("threadName").textContent = name;
    threadMessages.innerHTML = '<p class="sub conv-empty">Loading\u2026</p>';
    loadThread(username, false);
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (current === username) loadThread(username, true); }, 5000);
    threadInput.focus();
  }

  convListEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".conv-item");
    if (!btn) return;
    openThread(btn.dataset.username, btn.dataset.name, btn.dataset.avatar);
  });

  $("threadBack")?.addEventListener("click", () => {
    threadPanel.hidden = true;
    if (threadPlaceholder) threadPlaceholder.hidden = false;
    document.body.classList.remove("thread-open");
    clearInterval(pollTimer);
    cancelEdit();
    closeMenu();
    current = null;
  });

  /* ----- message options: copy, edit, unsend, delete for me, delete conversation ----- */
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }

  function cancelEdit() {
    editingId = null;
    editBar.hidden = true;
    threadInput.placeholder = "Write a message\u2026";
  }
  function startEdit(id, text) {
    editingId = id;
    editBar.hidden = false;
    threadInput.value = text;
    threadInput.placeholder = "Edit your message\u2026";
    threadInput.focus();
  }
  editBar.querySelector("button").addEventListener("click", () => { cancelEdit(); threadInput.value = ""; });
  threadInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && editingId) { cancelEdit(); threadInput.value = ""; }
  });

  async function refreshAfterAction() {
    if (current) await loadThread(current, true);
    loadConversations();
  }

  function openMenu(btn) {
    closeMenu();
    const id = btn.dataset.id;
    const mine = btn.dataset.mine === "1";
    const unsent = btn.dataset.unsent === "1";
    const canEdit = btn.dataset.canedit === "1";   // not yet seen, and under 30 minutes old (decided by the server)
    const text = btn.closest(".msg-row")?.querySelector(".msg-bubble p")?.textContent || "";
    const items = [];
    if (!unsent) items.push(["copy", "Copy"]);
    if (mine && !unsent && canEdit) items.push(["edit", "Edit"]);
    if (mine && !unsent) items.push(["unsend", "Unsend", true]);
    items.push(["delete", "Delete for me", true]);
    menuEl = document.createElement("div");
    menuEl.className = "msg-menu";
    menuEl.setAttribute("role", "menu");
    menuEl.innerHTML = items.map(([act, label, danger]) =>
      `<button type="button" role="menuitem" data-act="${act}" class="${danger ? "danger" : ""}">${label}</button>`).join("");
    document.body.appendChild(menuEl);
    const r = btn.getBoundingClientRect();
    const w = menuEl.offsetWidth, hgt = menuEl.offsetHeight;
    let left = mine ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = r.bottom + 4;
    if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 4);
    menuEl.style.left = left + "px";
    menuEl.style.top = top + "px";

    menuEl.addEventListener("click", async (e) => {
      const b = e.target.closest("button[data-act]");
      if (!b) return;
      const act = b.dataset.act;
      closeMenu();
      if (act === "copy") {
        try { await navigator.clipboard.writeText(text); toast("Copied.", true); }
        catch (_) { toast("Couldn\u2019t copy that.", false); }
      } else if (act === "edit") {
        startEdit(id, text);
      } else if (act === "unsend") {
        if (!confirm("Unsend this message? It will be removed for both of you.")) return;
        const d = await api("/api/messages/unsend", { id });
        if (!d.ok) return toast(d.message || "Couldn\u2019t unsend that.", false);
        if (editingId === id) { cancelEdit(); threadInput.value = ""; }
        refreshAfterAction();
      } else if (act === "delete") {
        if (!confirm("Delete this message for you? The other person will still see it.")) return;
        const d = await api("/api/messages/delete", { id });
        if (!d.ok) return toast(d.message || "Couldn\u2019t delete that.", false);
        if (editingId === id) { cancelEdit(); threadInput.value = ""; }
        refreshAfterAction();
      }
    });
  }

  threadMessages.addEventListener("click", (e) => {
    const b = e.target.closest(".msg-more");
    if (!b) return;
    e.stopPropagation();
    if (menuEl && menuEl.dataset.for === b.dataset.id) { closeMenu(); return; }
    openMenu(b);
    if (menuEl) menuEl.dataset.for = b.dataset.id;
  });
  document.addEventListener("click", (e) => { if (menuEl && !e.target.closest(".msg-menu")) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
  threadMessages.addEventListener("scroll", closeMenu);
  window.addEventListener("resize", closeMenu);

  $("threadClear")?.addEventListener("click", async () => {
    if (!current) return;
    if (!confirm("Delete this whole conversation for you? The other person will still have their copy.")) return;
    const d = await api("/api/messages/clear", { with: current });
    if (!d.ok) return toast(d.message || "Couldn\u2019t delete that conversation.", false);
    $("threadBack")?.click();
    loadConversations();
  });

  threadForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const content = threadInput.value.trim();
    if (!content || !current) return;
    if (editingId) {
      const id = editingId;
      const d = await api("/api/messages/edit", { id, content });
      if (!d.ok) return toast(d.message || "Couldn\u2019t edit that.", false);
      cancelEdit();
      threadInput.value = "";
      refreshAfterAction();
      return;
    }
    threadInput.value = "";
    const otherName = document.querySelector(`.conv-item[data-username="${CSS.escape(current)}"]`)?.dataset.name || $("threadName").textContent;
    const wasEmpty = !!threadMessages.querySelector(".conv-empty");
    const optimistic = { mine: true, content, created: new Date().toISOString() };
    if (wasEmpty) { renderThread([optimistic], current, otherName); }
    else {
      // Reuse the same grouping pass by re-rendering isn't necessary for a single append;
      // just drop in a same-sender-grouped bubble at the end.
      const lastRow = threadMessages.querySelector(".msg-row:last-child");
      const groupsWithMe = lastRow && lastRow.classList.contains("mine");
      if (groupsWithMe) lastRow.classList.remove("group-last");
      threadMessages.insertAdjacentHTML("beforeend", `<div class="msg-row mine ${groupsWithMe ? "" : "group-first"} group-last">
        ${avatarHTML(me.username, me.name, me.avatarPath, "sm")}
        <div class="msg-bubble"><p>${h(content)}</p><time>${h(clockTime(optimistic.created))}</time></div>
      </div>`);
    }
    threadMessages.scrollTop = threadMessages.scrollHeight;
    const d = await api("/api/messages/send", { to: current, content });
    if (!d.ok) return toast(d.message || "Couldn\u2019t send that.", false);
    await loadThread(current, true);
    loadConversations();
  });

  loadConversations().then(() => {
    const withUser = (new URLSearchParams(location.search).get("with") || "").trim().toLowerCase();
    if (!withUser || withUser === me.username) return;
    const existing = convListEl.querySelector(`.conv-item[data-username="${CSS.escape(withUser)}"]`);
    if (existing) { openThread(withUser, existing.dataset.name, existing.dataset.avatar); return; }
    api("/api/userprofile", { username: withUser }).then((d) => {
      if (!d.ok) return toast("That user doesn't exist.", false);
      openThread(withUser, d.user.name, d.user.avatarPath);
    });
  });
}

/* ---------- Notifications page ---------- */
if (page === "notifications" && me) {
  const listEl = $("notifList");
  async function loadNotifs() {
    listEl.innerHTML = skeletonHTML("row", 4);
    const d = await api("/api/notifications/list");
    if (!d.ok) { listEl.innerHTML = '<p class="sub">Couldn\u2019t load notifications.</p>'; return; }
    listEl.innerHTML = d.notifications.length
      ? d.notifications.map(notifItemHTML).join("")
      : emptyStateHTML("\uD83D\uDD14", "You\u2019re all caught up", "Likes, comments, follows, mentions and RSVPs will show up here.");
    if (d.unread > 0) { await api("/api/notifications/read"); refreshNotifBadge(); }
  }
  loadNotifs();

  function openNotif(e) {
    if (e.target.closest("a")) return;                       // the @name link goes to the profile
    const item = e.target.closest(".notif-item[data-href]");
    if (item) window.location.href = item.dataset.href;
  }
  listEl.addEventListener("click", openNotif);
  listEl.addEventListener("keydown", (e) => { if (e.key === "Enter") openNotif(e); });

  $("markAllRead").addEventListener("click", async () => {
    const d = await api("/api/notifications/read");
    if (!d.ok) return toast(d.message || "Couldn't update that.", false);
    document.querySelectorAll(".notif-item.unread").forEach((n) => n.classList.remove("unread"));
    refreshNotifBadge();
  });
}

/* ---------- Music groups: list + listening room ---------- */
// The leader (whoever started the group, until they hand it over) decides what plays.
// The server keeps one shared state per group and every listener's YouTube player follows it.
if (page === "music" && me) {
  const musicId = Number(new URLSearchParams(location.search).get("id")) || 0;
  if (musicId) initMusicRoom(musicId); else initMusicList();
}

function initMusicList() {
  $("musicListView").hidden = false;
  $("openMusicForm").hidden = false;
  wireModal("openMusicForm", "musicModal");
  const plural = (n) => n + (n === 1 ? " member" : " members");

  function cardHTML(g) {
    const badge = g.isLeader ? "Leader" : g.joined ? "Joined" : "";
    const waiting = g.pending && !g.isLeader;   // leader hasn't joined yet, so nobody else can either
    const act = g.isLeader && g.pending ? ["open", "Open room to join"] : waiting ? null : g.joined ? ["open", "Open room"] : ["join", "Join to listen"];
    const eq = '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>';
    // Playing: a banner with the video thumbnail and a live pill. Waiting: a ticking countdown pill.
    const banner = g.live && g.videoId
      ? `<div class="music-banner"><img src="https://i.ytimg.com/vi/${h(g.videoId)}/mqdefault.jpg" alt="" loading="lazy" data-hide-on-error><span class="live-pill">${eq} Playing now</span></div>`
      : "";
    const livePill = g.live && !banner ? `<span class="live-pill">${eq} Playing now</span>` : "";
    const wait = g.pending
      ? `<span class="badge badge-wait" data-end="${Date.now() + g.msLeft}" data-prefix="${g.isLeader ? "Join within" : "Waiting for leader \u00b7"}">${g.isLeader ? "Join within" : "Waiting for leader \u00b7"}</span>`
      : "";
    const shown = g.listeners || [];
    const more = g.members - shown.length;
    const stack = shown.length
      ? `<div class="avatar-stack" aria-hidden="true">${shown.map((l) => avatarHTML(l.username, l.name, l.avatar, "sm")).join("")}${more > 0 ? `<span class="avatar-more">+${more}</span>` : ""}</div>`
      : "";
    return `
    <article class="card group-card music-card${g.live ? " is-live" : ""}" data-id="${g.id}">
      ${banner}
      <div class="group-top">
        <h3>${h(g.name)}</h3>
        <div class="group-top-right">
          ${wait}${livePill}
          ${badge ? `<span class="badge badge-status">${badge}</span>` : ""}
        </div>
      </div>
      ${g.description ? `<p class="event-desc">${h(g.description)}</p>` : ""}
      <div class="music-meta">
        ${stack}
        <p class="event-meta">${g.live ? g.members + " listening" : plural(g.members)} \u00b7 led by <a class="host-link" href="${profileHref(g.leader)}">@${h(g.leader)}</a></p>
      </div>
      <div class="post-actions">
        ${act ? `<button type="button" class="btn-small" data-act="${act[0]}">${act[1]}</button>` : '<p class="sub">Opens once the leader joins.</p>'}
      </div>
    </article>`;
  }

  // Only repaint when something visible changed, so the list doesn't flicker while it refreshes itself.
  let lastKey = null;
  async function load() {
    const d = await api("/api/music/list");
    const key = !d.ok ? "error" : d.groups.map((g) => [g.id, g.members, g.live, g.videoId, g.pending, g.joined, g.isLeader, g.leader, (g.listeners || []).map((l) => l.username).join(",")].join("|")).join(";") || "empty";
    if (key === lastKey) return;
    lastKey = key;
    $("musicList").innerHTML = !d.ok ? '<p class="sub">Couldn\u2019t load music groups.</p>'
      : d.groups.length ? d.groups.map(cardHTML).join("")
      : emptyStateHTML("\uD83C\uDFB5", "No music groups yet", "Start one and listen to the same song, at the same time, with friends.", { label: "Start a music group", click: "#openMusicForm" });
  }

  $("musicList").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const id = btn.closest(".group-card").dataset.id;
    if (btn.dataset.act === "join") {
      btn.disabled = true;
      const d = await api("/api/music/join", { groupId: id });
      if (!d.ok) { btn.disabled = false; return toast(d.message || "Couldn\u2019t join that group.", false); }
    }
    window.location.href = "music.html?id=" + id;
  });

  $("musicForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("mgName").value.trim();
    if (!name) return toast("Give the group a name.", false);
    const d = await api("/api/music/create", { name, description: $("mgDescription").value.trim() });
    if (!d.ok) return toast(d.message || "Couldn\u2019t create that group.", false);
    window.location.href = "music.html?id=" + d.id;
  });

  load();
  // Keep the list fresh (who's playing, who joined) and tick the "join within" countdowns.
  setInterval(() => { if (!document.hidden) load(); }, 6000);
  setInterval(() => {
    document.querySelectorAll("#musicList [data-end]").forEach((el) => {
      const left = Math.max(0, Number(el.dataset.end) - Date.now());
      const sec = Math.ceil(left / 1000);
      el.textContent = el.dataset.prefix + " " + Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
      if (left <= 0 && !el.dataset.expired) { el.dataset.expired = "1"; load(); }   // the server deletes it; refresh
    });
  }, 1000);
}

function initMusicRoom(gid) {
  // The room, the player and the YouTube script all stay off until the first successful /api/music/state
  // call: the server only answers that for a logged-in member, so nobody else ever gets a player.
  let g = null, state = null, stateAt = 0;               // group, shared playback state, when we received it
  let isLeader = false, player = null, ytReady = false, playerReady = false, audioOn = false;
  let suppressUntil = 0, timer = null, memberSig = "", pendingEndsAt = 0, countdown = null;

  // Events our own code causes on the player (loading, seeking...) must not be sent back to the group.
  const suppress = () => { suppressUntil = Date.now() + 1500; };

  function parseYouTubeId(text) {
    const t = text.trim();
    const m = t.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/) || t.match(/^([\w-]{11})$/);
    return m ? m[1] : null;
  }

  // ---- the player ----
  // Listeners get a player without controls; the server ignores anything but the leader's actions anyway.
  function buildPlayer() {
    playerReady = false;
    if (player && player.destroy) { try { player.destroy(); } catch (_) {} }
    $("musicStage").innerHTML = '<div id="ytPlayer"></div>';
    $("musicStage").hidden = false;
    player = new YT.Player("ytPlayer", {
      width: "100%",
      height: "100%",
      playerVars: { playsinline: 1, rel: 0, controls: isLeader ? 1 : 0, disablekb: isLeader ? 0 : 1 },
      events: {
        onReady: () => { playerReady = true; if (audioOn) sync(true); },
        onStateChange: onPlayerStateChange,
      },
    });
  }
  window.onYouTubeIframeAPIReady = () => { ytReady = true; if (g && !player) buildPlayer(); };
  let ytRequested = false;
  function loadYouTubeApi() {
    if (ytRequested) return;
    ytRequested = true;
    if (window.YT && window.YT.Player) { ytReady = true; return; }
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  }

  // Where the song should be right now, going by the last state the server sent.
  const targetTime = () => state.playing ? state.position + (Date.now() - stateAt) / 1000 : state.position;

  // Listeners: make the player match the group. The leader's own player is the source of truth,
  // so it is only synced when they first press "Join the music" or after a leadership change.
  function sync(force) {
    if (!playerReady || !audioOn || !state || !state.videoId) return;
    if (isLeader && !force) return;
    const target = targetTime();
    const data = player.getVideoData ? player.getVideoData() : null;
    const ps = player.getPlayerState();
    suppress();
    if (!data || data.video_id !== state.videoId) {
      if (state.playing) player.loadVideoById(state.videoId, target);
      else player.cueVideoById(state.videoId, target);
      return;
    }
    if (Math.abs(player.getCurrentTime() - target) > 2.5) player.seekTo(target, true);
    const PS = YT.PlayerState;
    if (state.playing && ps !== PS.PLAYING && ps !== PS.BUFFERING && ps !== PS.ENDED) player.playVideo();
    else if (!state.playing && ps === PS.PLAYING) player.pauseVideo();
  }

  // The leader pressed play/pause or dragged the timeline on their own player: tell the group.
  function onPlayerStateChange(e) {
    if (!isLeader || Date.now() < suppressUntil) return;
    const time = player.getCurrentTime();
    if (e.data === YT.PlayerState.PLAYING) control("play", { time });
    else if (e.data === YT.PlayerState.PAUSED) control("pause", { time });
  }

  async function control(action, extra) {
    const d = await api("/api/music/control", Object.assign({ groupId: gid, action }, extra || {}));
    if (!d.ok) { toast(d.message || "Couldn\u2019t do that.", false); poll(); }
    return d;
  }

  // ---- the leader's 10-minute window to join ----
  function tickCountdown() {
    const left = Math.max(0, Math.ceil((pendingEndsAt - Date.now()) / 1000));
    const m = Math.floor(left / 60), sec = String(left % 60).padStart(2, "0");
    $("pendingText").textContent = "Nobody is in this group yet. Join within " + m + ":" + sec + " or it will be deleted.";
    if (left === 0) poll();   // the server has deleted it by now; this tells the page
  }

  // ---- drawing the page ----
  function renderRoom(members) {
    const pending = !!g.pending;
    $("pendingPanel").hidden = !(pending && isLeader);
    if (pending) {
      pendingEndsAt = stateAt + g.msLeft;
      tickCountdown();
      if (!countdown) countdown = setInterval(tickCountdown, 1000);
    } else if (countdown) { clearInterval(countdown); countdown = null; }
    document.title = "Vibely \u2013 " + g.name;
    $("mName").textContent = g.name;
    $("mDesc").hidden = !g.description;
    $("mDesc").textContent = g.description || "";
    $("mMeta").innerHTML = members.length + (members.length === 1 ? " listener" : " listeners") +
      ` \u00b7 led by <a class="host-link" href="${profileHref(g.leader)}">@${h(g.leader)}</a>`;
    $("mCount").textContent = members.length;
    $("leaderPanel").hidden = !isLeader || pending;
    $("musicDeleteBtn").hidden = !isLeader;
    $("listenerNote").hidden = isLeader;
    if (!isLeader) $("listenerNote").textContent = "\uD83C\uDFA7 Only @" + g.leader + " can change what plays. Your player follows along automatically.";
    $("musicJoinBtn").hidden = pending || audioOn || !state.videoId;
    $("musicHint").textContent = pending ? "" : !state.videoId
      ? (isLeader ? "Nothing is playing yet. Search for a song below." : "Nothing is playing yet. The leader will start something soon.")
      : (audioOn ? "" : "Tap to start listening in sync with the group.");

    const sig = members.map((m) => m.username + (m.leader ? "*" : "")).join("|") + "|" + isLeader;
    if (sig === memberSig) return;
    memberSig = sig;
    $("mMembers").innerHTML = members.map((m) => `
      <div class="comment member-row">
        ${avatarHTML(m.username, m.name, m.avatar, "sm")}
        <div class="comment-body">${handleLink(m.username, m.name)}
          ${m.leader ? '<span class="badge badge-status">Leader</span>' : ""}
          ${isLeader && !m.leader ? `<button type="button" class="post-btn" data-make="${h(m.username)}">Make leader</button>` : ""}
        </div>
      </div>`).join("");
  }

  // ---- keeping up with the group ----
  async function poll() {
    const t0 = Date.now();
    const d = await api("/api/music/state", { groupId: gid });
    if (!d.ok) {
      if (d.gone) {
        clearInterval(timer);
        toast(d.message || "That group isn\u2019t here any more.", false);
        setTimeout(() => window.location.replace("music.html"), 1000);
      }
      return;
    }
    $("musicRoomView").hidden = false;                    // the server accepted our login, so show the room
    state = d.state;
    stateAt = Date.now() - (Date.now() - t0) / 2;        // the state is about half a round trip old
    const hadGroup = !!g, wasLeader = isLeader;
    g = d.group;
    isLeader = g.leader === me.username;
    renderRoom(d.members);
    if (g.pending) return;                                // no player until the leader has joined
    if (hadGroup && wasLeader !== isLeader) {
      toast(isLeader ? "You\u2019re now the leader. Search for a song to play something." : "@" + g.leader + " is now the leader.", true);
      if (ytReady) buildPlayer();                         // new role, new player (controls on or off)
    } else if (ytReady && !player) {
      buildPlayer();
    }
    loadYouTubeApi();                                     // first time only; the player appears once it loads
    sync(false);
  }

  $("pendingJoinBtn").addEventListener("click", async () => {
    $("pendingJoinBtn").disabled = true;
    const d = await api("/api/music/join", { groupId: gid });
    $("pendingJoinBtn").disabled = false;
    if (!d.ok) return toast(d.message || "Couldn\u2019t join the group.", false);
    toast("You joined your group.", true);
    memberSig = "";
    poll();
  });

  $("musicJoinBtn").addEventListener("click", () => {
    audioOn = true;                                       // this click is what lets the browser play sound
    $("musicJoinBtn").hidden = true;
    $("musicHint").textContent = "";
    sync(true);
  });

  // Tell the group to play this video (leader only; the server checks too).
  async function playVideo(id) {
    const d = await control("load", { videoId: id });
    if (!d.ok) return false;
    audioOn = true;
    if (playerReady) { suppress(); player.loadVideoById(id, 0); }
    poll();
    return true;
  }

  $("musicLinkForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = parseYouTubeId($("musicLink").value);
    if (!id) return toast("That doesn\u2019t look like a YouTube link. Copy it from the video\u2019s Share button.", false);
    if (await playVideo(id)) $("musicLink").value = "";
  });

  // ---- search YouTube (the server holds the API key and does the search) ----
  $("musicSearchForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("musicSearch").value.trim();
    if (q.length < 2) return toast("Type a song or artist to search for.", false);
    const box = $("musicResults"), btn = $("musicSearchBtn");
    btn.disabled = true;
    box.hidden = false;
    box.innerHTML = '<p class="sub">Searching\u2026</p>';
    const d = await api("/api/music/search", { groupId: gid, q });
    btn.disabled = false;
    if (!d.ok) { box.hidden = true; return toast(d.message || "Couldn\u2019t search right now.", false); }
    box.innerHTML = d.results.length ? d.results.map((r) => `
      <button type="button" class="music-result" data-vid="${h(r.id)}">
        <img src="https://i.ytimg.com/vi/${h(r.id)}/mqdefault.jpg" alt="" loading="lazy">
        <span><span class="mr-title">${h(r.title)}</span><span class="mr-channel">${h(r.channel)}</span></span>
      </button>`).join("") : '<p class="sub">No results. Try different words.</p>';
  });

  $("musicResults").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-vid]");
    if (!btn) return;
    btn.disabled = true;
    if (await playVideo(btn.dataset.vid)) {
      $("musicResults").hidden = true;
      $("musicResults").innerHTML = "";
      $("musicSearch").value = "";
    } else btn.disabled = false;
  });

  $("mMembers").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-make]");
    if (!btn) return;
    const who = btn.dataset.make;
    if (!confirm("Make @" + who + " the leader? You won\u2019t be able to control the music any more.")) return;
    const d = await api("/api/music/transfer", { groupId: gid, username: who });
    if (!d.ok) return toast(d.message || "Couldn\u2019t hand over leadership.", false);
    toast(d.message, true);
    poll();
  });

  $("musicLeaveBtn").addEventListener("click", async () => {
    if (!confirm("Leave this music group?")) return;
    const d = await api("/api/music/leave", { groupId: gid });
    if (!d.ok) return toast(d.message || "Couldn\u2019t leave the group.", false);
    window.location.replace("music.html");
  });

  $("musicDeleteBtn").addEventListener("click", async () => {
    if (!confirm("Delete this music group for everyone?")) return;
    const d = await api("/api/music/delete", { groupId: gid });
    if (!d.ok) return toast(d.message || "Couldn\u2019t delete the group.", false);
    window.location.replace("music.html");
  });

  // Leaving the music page (closing the tab, going to another page) takes you out of the group.
  // The server waits a few seconds first, so a refresh doesn't remove you.
  window.addEventListener("pagehide", () => {
    try {
      const u = getUser();
      const headers = { "Content-Type": "application/x-www-form-urlencoded" };
      if (u && u.token) headers["Authorization"] = "Bearer " + u.token;
      fetch("/api/music/away", { method: "POST", headers, body: new URLSearchParams({ groupId: gid }), keepalive: true });
    } catch (_) {}
  });
  // Coming back with the Back button restores a frozen page; reload so the server can say whether you're still in.
  window.addEventListener("pageshow", (e) => { if (e.persisted) window.location.reload(); });

  window.addEventListener("pagehide", () => {
    clearInterval(timer); clearInterval(countdown);
    if (player && player.destroy) { try { player.destroy(); } catch (_) {} }
  });
  // Heartbeat: tells the server this page is still open (runs even in a background tab). If it stops
  // (tab killed, phone locked, crash), the server removes the member after a couple of minutes.
  const pingTimer = setInterval(() => { api("/api/music/ping", { groupId: gid }); }, 15000);
  window.addEventListener("pagehide", () => clearInterval(pingTimer));
  poll().then(() => { timer = setInterval(() => { if (!document.hidden) poll(); }, 2000); });
}