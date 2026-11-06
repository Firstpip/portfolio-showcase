// 워크룸 주소 옮기기 (2026-11-06 준비) — firstpip.github.io/portfolio-showcase/dashboard/ → https://workroom.firstpip.co.kr/
//
// 왜: 옛 주소는 결과물 페이지 70여 개·demos·pairingfoodie 와 출처(firstpip.github.io)가 같다.
//   로그인 정보(Supabase 세션)는 출처별 저장소(localStorage)에 들어가므로, 그 페이지들에서 도는 스크립트
//   (Tailwind CDN 등 무결성 검사를 못 붙이는 외부 스크립트 포함)가 팀원 세션을 읽을 수 있다. 출처를 나누면 닿지 않는다.
//
// 같은 코드가 두 주소에 함께 배포된다(.github/workflows/workroom-deploy.yml). 옛 주소에서만 STAGE 에 따라 움직인다.
//   0: 아무것도 안 함(새 주소 준비 전)
//   1: 함께 쓰는 기간 — 옛 주소 위에 '새 주소로 옮겨 주세요' 띠
//   2: 옮김 완료 — 옛 주소를 열면 정리(알림 구독 해제·이 기기 로그아웃·결과물 팀 표식) 후 새 주소로 보낸다
export const MOVE_STAGE = 0;
export const NEW_ORIGIN = 'https://workroom.firstpip.co.kr';
const OLD_HOST = 'firstpip.github.io';

export const isOldHost = () => location.hostname === OLD_HOST;

// 옛 주소의 쿼리·해시(?cal=1#calendar 등 알림·홈 화면 링크)를 그대로 새 주소로
export function newUrl() {
  return NEW_ORIGIN + '/' + location.search + location.hash;
}

// 옛 출처에 남은 것을 치운다. 실패해도 이동은 한다.
async function handover(supabase) {
  // 결과물 방문 집계의 '팀 브라우저' 표식은 결과물과 같은 출처에 있어야 읽힌다(assets/sv.js) — 옛 주소가 마지막으로 남긴다
  try { localStorage.setItem('fp_internal', '1'); } catch {}
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    const sub = await reg?.pushManager?.getSubscription();
    // 옛 주소 구독을 지우지 않으면 새 주소에서 다시 켠 기기에 알림이 두 번 온다
    if (sub) { await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
    await reg?.unregister();
  } catch (e) { console.warn('옛 주소 알림 정리 실패:', e); }
  // scope:'local' — 이 출처의 세션만 지운다. 기본값(global)은 새 주소의 로그인까지 끊는다
  try { await supabase.auth.signOut({ scope: 'local' }); } catch {}
  try { Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k)); } catch {}
}

// app.jsx 가 화면을 그리기 전에 부른다. true 면 화면을 그리지 않는다(새 주소로 가는 중).
export function runMove(supabase) {
  if (!isOldHost() || MOVE_STAGE === 0) return false;
  if (MOVE_STAGE >= 2) {
    document.getElementById('root').innerHTML = '<div style="padding:3rem;text-align:center;font-family:sans-serif;color:#888">워크룸 새 주소로 옮기는 중…</div>';
    handover(supabase).finally(() => location.replace(newUrl()));
    return true;
  }
  const bar = document.createElement('a');
  bar.href = newUrl();
  bar.textContent = '워크룸 주소가 바뀌었어요 → workroom.firstpip.co.kr 에서 다시 로그인하고, 알림·홈 화면 앱도 새 주소에서 다시 켜 주세요';
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;padding:10px 16px;background:#e17055;color:#fff;font:600 13px/1.4 sans-serif;text-align:center;text-decoration:none;padding-bottom:calc(10px + env(safe-area-inset-bottom))';
  document.body.appendChild(bar);
  return false;
}
