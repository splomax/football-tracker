// Admin login. The admin's features (share buttons, the image exports) aren't in the public code: the Worker at
// ADMIN_URL (worker/) hands them out only to a logged-in admin. ?admin asks for the password and trades it for a
// token that lasts 30 days, kept in this browser's localStorage (adminToken) in place of the password. With a token
// that still works, ?admin skips the password. ?admin=off logs out.
//
// The features show only with ?admin in the address bar. Without it, a logged-in browser looks like anyone else's,
// but its visits still aren't counted.

import { ADMIN_PARAM, ADMIN_URL } from "./config.js";
import { store } from "./store.js";
import { allGames, state, saveSelected } from "./state.js";
import { renderBoard, setAdmin } from "./board.js";
import { listView, renderList, setPickerAdmin } from "./picker.js";
import { currentTheme } from "./theme.js";
import { setTimeZone } from "./format.js";

/**
 * Check the admin login, and with ?admin turn the admin's features on (asking for the password if needed).
 * Resolves true when this browser is logged in, features on or not.
 */
export async function loadAdmin() {
  // Older versions kept the password itself; swap it for a token once, then forget it.
  const oldPassword = store.get("adminKey");
  if (oldPassword) {
    store.set("adminKey", null);
    const token = await logIn(oldPassword);
    if (typeof token === "string") store.set("adminToken", token);
  }
  if (ADMIN_PARAM === "off") store.set("adminToken", null);
  let code = await adminCode();
  // ?admin asks for the password only when this browser isn't already logged in.
  if (!code && ADMIN_PARAM !== null && ADMIN_PARAM !== "off") {
    for (let error = ""; ;) {
      const password = await askPassword(error);
      if (!password) break;  // cancelled: stay a regular visitor
      const token = await logIn(password);
      if (token === 401) { error = "Wrong password"; continue; }
      if (token) store.set("adminToken", token);
      code = await adminCode();
      break;
    }
  }
  if (ADMIN_PARAM === null) return !!code;  // logged in or not, no features without ?admin
  const on = await install(code);
  // ?admin stays in the address bar while the features are on; ?admin=off, a cancelled login, or an unreachable
  // Worker drop it.
  if (!on) {
    const url = new URL(location.href);
    url.searchParams.delete("admin");
    history.replaceState(null, "", url);
  }
  return on;
}

// The admin module, using the saved token. Null when there's no token, it's refused, or the Worker can't be reached.
async function adminCode() {
  const token = store.get("adminToken");
  if (!token) return null;
  const code = await workerText(`${ADMIN_URL}/admin.js`, { headers: { Authorization: `Bearer ${token}` } });
  if (code === 401) store.set("adminToken", null);  // expired, or the password changed: log in again with ?admin
  return typeof code === "string" ? code : null;
}

// Trade the password for a token (the browser keeps only the token). 401 for a wrong password, null if unreachable.
async function logIn(password) {
  const body = await workerText(`${ADMIN_URL}/login`, { method: "POST", headers: { Authorization: `Bearer ${password}` } });
  return typeof body === "string" ? JSON.parse(body).token : body;
}

// A Worker response's text, 401 when it refuses, or null when it can't be reached.
async function workerText(url, options) {
  try {
    const res = await fetch(url, options);
    if (res.status === 401) return 401;
    return res.ok ? await res.text() : null;
  } catch (err) {
    console.error("admin", err);  // carry on as a regular visitor
    return null;
  }
}

// The visit counter's { weekly, monthly, total }, or null if it can't be had.
async function visits() {
  const body = await workerText(`${ADMIN_URL}/visits`, { headers: { Authorization: `Bearer ${store.get("adminToken")}` } });
  return typeof body === "string" ? JSON.parse(body) : null;
}

async function install(code) {
  if (typeof code !== "string") return false;
  const blob = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try {
    const { install } = await import(blob);
    const hooks = install({ renderBoard, renderList, listView, allGames, state, saveSelected, currentTheme, setTimeZone, visits });
    setAdmin(hooks);
    setPickerAdmin(hooks);
    return true;
  } catch (err) {
    console.error("admin", err);
    return false;
  } finally {
    URL.revokeObjectURL(blob);
  }
}

// A small modal with a masked password field (the hidden username lets password managers save it).
// Resolves with what was typed, or null if cancelled.
function askPassword(error) {
  const dialog = document.createElement("dialog");
  dialog.id = "admin-login";
  dialog.innerHTML = `<form method="dialog">
    <label for="admin-password">Admin password</label>
    <input type="text" name="username" value="admin" autocomplete="username" hidden>
    <input type="password" id="admin-password" autocomplete="current-password" required>
    <p class="error" role="alert">${error}</p>
    <div class="buttons"><button type="button" value="cancel">Cancel</button><button value="ok">Log in</button></div>
  </form>`;
  document.body.append(dialog);
  const input = dialog.querySelector("input[type=password]");
  dialog.querySelector('[value="cancel"]').addEventListener("click", () => dialog.close("cancel"));
  dialog.showModal();
  input.focus();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(dialog.returnValue === "ok" ? input.value : null);  // Escape closes with returnValue ""
    });
  });
}
