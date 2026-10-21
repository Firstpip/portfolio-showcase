// 쇼케이스 방문 수집 — 위시켓 '결과물 확인하기'로 들어온 클라이언트가 실제로 봤는지 알기 위함.
// 모든 <slug>/portfolio-N/index.html 에 배포 시점에 주입된다 (wishket-portfolio-system lib/showcase-tracker.js).
// 원칙: 쿠키 없음 · 페이지 동작에 절대 영향 없음(전부 try/catch, 실패는 조용히 버림) · IP 는 서버에서 해시만.
(function () {
  try {
    var m = location.pathname.match(/\/portfolio-showcase\/([^/]+)\/portfolio-(\d+)\/?/);
    if (!m) return;
    var EP = 'https://ucwtmheysdrgrmeaubuy.supabase.co/functions/v1/showcase-view';

    var uuid = function () {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 3 | 8)).toString(16);
      });
    };
    var store = function (s, k, v) {
      try { if (v === undefined) return s.getItem(k); s.setItem(k, v); } catch (e) { return null; }
    };

    // 팀 브라우저 표식: 대시보드 로그인 시 같은 출처(firstpip.github.io)에 심어진다. ?internal=1 로도 켤 수 있다.
    if (/[?&]internal=1\b/.test(location.search)) store(localStorage, 'fp_internal', '1');
    var internal = store(localStorage, 'fp_internal') === '1';

    var sid = store(sessionStorage, 'sv_sid');
    if (!sid) { sid = uuid(); store(sessionStorage, 'sv_sid', sid); }

    var id = uuid();
    var base = { id: id, slug: decodeURIComponent(m[1]), p: +m[2] };
    var send = function (o) {
      var body = JSON.stringify(Object.assign({}, base, o));
      try {
        if (navigator.sendBeacon && navigator.sendBeacon(EP, new Blob([body], { type: 'text/plain' }))) return;
      } catch (e) { /* 아래 fetch 로 */ }
      try { fetch(EP, { method: 'POST', body: body, keepalive: true, mode: 'cors', headers: { 'Content-Type': 'text/plain' } }); } catch (e) {}
    };

    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    send({
      t: 'start', sid: sid, ref: document.referrer || '', q: location.search || '',
      vp: innerWidth + 'x' + innerHeight, lang: navigator.language || '', tz: tz,
      wd: navigator.webdriver === true, internal: internal
    });

    // 체류: 화면에 보이는 동안만 잰다. 스크롤: 문서·내부 스크롤 영역 중 가장 깊이 내려간 비율.
    var dwell = 0, since = document.visibilityState === 'visible' ? Date.now() : 0;
    var scroll = 0, ix = 0, lastSent = '';
    var now = function () { return dwell + (since ? Date.now() - since : 0); };
    var depth = function (el) {
      var h = el.scrollHeight - el.clientHeight;
      return h > 0 ? Math.round(100 * el.scrollTop / h) : 0;
    };
    var docDepth = function () {
      var d = document.documentElement, h = Math.max(d.scrollHeight, document.body ? document.body.scrollHeight : 0);
      return h > innerHeight ? Math.round(100 * (scrollY + innerHeight) / h) : 100;
    };
    scroll = docDepth();
    addEventListener('scroll', function (e) {
      var t = e.target, v = (t === document || t === document.documentElement || !t.scrollHeight) ? docDepth() : depth(t);
      if (v > scroll) scroll = Math.min(100, v);
    }, { capture: true, passive: true });
    addEventListener('pointerdown', function () { ix++; }, { capture: true, passive: true });
    addEventListener('keydown', function () { ix++; }, { capture: true, passive: true });

    var flush = function () {
      var d = now(), key = Math.round(d / 1000) + ':' + scroll + ':' + ix;
      if (key === lastSent) return;
      lastSent = key;
      send({ t: 'end', dwell: d, scroll: scroll, ix: ix });
    };
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { if (since) { dwell += Date.now() - since; since = 0; } flush(); }
      else if (!since) since = Date.now();
    });
    addEventListener('pagehide', flush);
    // 하트비트 — 이탈 시 비콘은 같은 탭 이동(P1→P2)에서 브라우저가 취소하기도 한다(실측 ERR_ABORTED).
    //   마지막 한 발에 기대지 않도록 5초·15초·이후 30초마다(보이는 동안, 최대 20분) 현재값을 보낸다.
    var beats = 0, beat = function () {
      if (since) flush();
      if (++beats < 42) setTimeout(beat, beats === 1 ? 10000 : 30000);
    };
    setTimeout(beat, 5000);
  } catch (e) { /* 수집 실패는 페이지에 영향 없음 */ }
})();
