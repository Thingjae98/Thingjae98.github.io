// 서비스워커: 앱 껍데기 캐시 + 푸시 알림
const CACHE = "fa-shell-v2";
const SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./config.js", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// 같은 출처의 정적 파일만 네트워크 우선, 실패 시 캐시. API(다른 출처)는 건드리지 않음
// no-cache: 브라우저 보관본(사이트가 10분 보관)을 그냥 쓰지 않고 서버에 새 버전을 확인한다 (화면·스크립트 버전이 섞이지 않게)
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || e.request.method !== "GET") return;
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});

self.addEventListener("push", (e) => {
  let data = { title: "가족 비서", body: "" };
  try { data = { ...data, ...e.data.json() }; } catch {}
  e.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "./icon-192.png", badge: "./icon-192.png", data: { url: data.url || "./" }, tag: "fa-event", renotify: true }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || "./", self.location.href).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const w = list.find((c) => c.url.startsWith(self.registration.scope));
    return w ? w.focus().then(() => w.navigate(target)) : self.clients.openWindow(target);
  }));
});
