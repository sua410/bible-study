// 성경 문제집 - 오프라인 지원
// 전략: 항상 인터넷에서 최신 파일을 먼저 받고(네트워크 우선), 실패하면 저장해 둔 사본을 보여줌.
// → 업데이트가 늦게 반영되는 문제 없이, 오프라인일 때만 사본을 씀.
const CACHE = 'bible-study-v1';

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firebase 등 외부 요청은 건드리지 않음
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() =>
      caches.match(req).then((hit) => hit || caches.match(req, { ignoreSearch: true }))
    )
  );
});
