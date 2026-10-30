// 워크룸 서비스 워커 — 웹 푸시 수신 전용 (2026-10-30)
//
// 일부러 fetch 핸들러를 두지 않는다: 아무것도 캐시하지 않으므로 GitHub Pages 에 배포하면 바로 새 버전이 뜬다.
// (서비스 워커 캐시는 배포 후 옛 app.js 가 남는 사고의 흔한 원인)
// 푸시는 엣지 함수 calendar-push 가 보낸다. payload: { title, body, url, tag }

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  // iOS 는 푸시를 받고 알림을 띄우지 않으면 구독을 끊는다 — 내용이 비어도 반드시 표시
  e.waitUntil(self.registration.showNotification(d.title || '퍼스트핍 워크룸', {
    body: d.body || '',
    tag: d.tag || undefined,
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-72.png',
    data: { url: d.url || './?cal=1#calendar' },
  }));
});

// 알림을 누르면 열려 있는 워크룸 창을 앞으로 가져오고, 없으면 새로 연다
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './?cal=1#calendar', self.registration.scope).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope)) {
        try { await c.navigate(url); } catch (_) { /* 다른 출처로 이동했던 창 등 */ }
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
