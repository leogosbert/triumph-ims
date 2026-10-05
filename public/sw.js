/* LeMoSp service worker: lets drivers open "My deliveries" and record
   proof of delivery with no signal. Only the driver screen and the app's
   static files are cached; everything else always goes to the network. */
const CACHE = "ims-driver-v1";
// Also shows phone notifications sent by the server (Stage 7).

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("ims-driver-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// "Update now" in the app: a new version of this file that is still waiting takes over at once.
// (The offline driver cache keeps its name, so saved deliveries and screens are not touched.)
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "skipWaiting") self.skipWaiting();
});

// The page tells us which files it loaded, so the next offline visit has them.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "cache" || !Array.isArray(data.urls)) return;
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        data.urls
          .filter((u) => typeof u === "string" && u.startsWith(self.location.origin))
          .map((u) =>
            fetch(u, { credentials: "same-origin" })
              .then((res) => (res.ok && !res.redirected ? cache.put(u, res) : undefined))
              .catch(() => undefined),
          ),
      ),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // App code and styles never change for a given file name: cache first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req, { ignoreVary: true }).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // The driver screen: fresh when online, last saved copy when offline.
  if (req.mode === "navigate" && url.pathname === "/driver") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req.url, copy));
          }
          return res;
        })
        .catch(() =>
          caches
            .match(req.url, { ignoreVary: true })
            .then((hit) => hit || caches.match("/driver", { ignoreSearch: true, ignoreVary: true }))
            .then(
              (hit) =>
                hit ||
                new Response("<h1>No signal</h1><p>Open My deliveries once while online so it works offline.</p>", {
                  headers: { "Content-Type": "text/html; charset=utf-8" },
                }),
            ),
        ),
    );
  }
});

// ---------- Phone notifications ----------
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "LeMoSp", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "LeMoSp", {
      body: data.body || "",
      tag: data.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/notifications" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/notifications", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin) && "focus" in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
