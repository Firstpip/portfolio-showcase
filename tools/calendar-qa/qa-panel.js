// QA 패널 (로컬 미리보기 전용) — 사람 바꾸기 · 데이터 초기화 · 알림 미리보기
// 알림 미리보기는 운영 함수와 같은 판단 코드(plan.ts 를 그대로 빌드한 plan.js)를 지금 이 탭의 데이터로 돌린다.
(function () {
  const M = window.__mock, DB = M.DB, Q = new URLSearchParams(location.search);
  const CK = '__qaCursor';
  const getCursor = () => Number(sessionStorage.getItem(CK) || 0);
  const setCursor = (n) => sessionStorage.setItem(CK, String(n));
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const urlWith = (patch) => { const u = new URL(location.href); Object.entries(patch).forEach(([k, v]) => v == null ? u.searchParams.delete(k) : u.searchParams.set(k, v)); return u.toString(); };
  const meIdx = Number(Q.get('as') || 2);

  const css = `
  #qa-btn{position:fixed;left:14px;bottom:14px;z-index:5000;background:#111827;color:#fff;border:0;border-radius:20px;padding:.5rem .9rem;font:600 13px Pretendard,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer}
  #qa-p{position:fixed;left:14px;bottom:60px;z-index:5000;width:min(460px,calc(100vw - 28px));max-height:calc(100vh - 90px);overflow:auto;background:#fff;color:#111827;border:1px solid #d1d5db;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.35);font:13px/1.5 Pretendard,sans-serif;padding:14px}
  #qa-p h4{font-size:13px;margin:12px 0 6px;color:#374151} #qa-p h4:first-child{margin-top:0}
  #qa-p .row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  #qa-p a,#qa-p button{font:inherit;border:1px solid #d1d5db;background:#f9fafb;color:#111827;border-radius:8px;padding:.3rem .6rem;cursor:pointer;text-decoration:none}
  #qa-p a.on{background:#4f46e5;border-color:#4f46e5;color:#fff}
  #qa-p input{font:inherit;border:1px solid #d1d5db;border-radius:8px;padding:.25rem .4rem}
  #qa-p .hint{color:#6b7280;font-size:12px}
  #qa-p .who{margin-top:8px;font-weight:700}
  #qa-p .n{border-left:3px solid #4f46e5;background:#f5f5ff;border-radius:6px;padding:6px 8px;margin-top:4px}
  #qa-p .n b{display:block} #qa-p .n span{white-space:pre-wrap;color:#374151}
  #qa-p .none{color:#6b7280;padding:6px 0}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const btn = document.createElement('button'); btn.id = 'qa-btn'; btn.textContent = 'QA'; document.body.appendChild(btn);
  const p = document.createElement('div'); p.id = 'qa-p'; p.hidden = true; document.body.appendChild(p);
  btn.onclick = () => { p.hidden = !p.hidden; if (!p.hidden) draw(); };

  // 운영 함수(index.ts)가 읽는 것과 같은 모양으로 스냅샷을 만든다. 받는 사람은 모두 '알림 둘 다 켬'으로 가정.
  function snapshot(withAudit) {
    return {
      members: DB.team_members.filter((m) => m.is_active !== false).map((m) => ({ id: m.id, name: m.name, user_id: m.user_id })),
      subs: DB.team_members.map((m, i) => ({ id: 'qa' + i, member_id: m.id, morning_brief: true, change_alerts: true })),
      routines: DB.team_work_routines.map((r) => ({ valid_from: r.valid_from, days: r.days })),
      teamOverrides: DB.team_work_overrides, memberOverrides: DB.member_work_overrides,
      leaves: DB.team_leaves.filter((l) => !l.deleted_at), events: DB.calendar_events.filter((e) => !e.deleted_at),
      holidays: Object.fromEntries(DB.calendar_holidays.map((h) => [h.holiday_date, h.name])),
      wishket: DB.wishket_projects.filter((w) => w.meeting_at),
      audit: withAudit ? DB.project_audit_log.filter((a) => a.id > getCursor()) : [],
    };
  }
  const nameOf = (id) => DB.team_members.find((m) => m.id === id)?.name || id;
  function render(notes, empty) {
    if (!notes.length) return `<div class="none">${empty}</div>`;
    const by = {}; notes.forEach((n) => (by[n.member] ||= []).push(n));
    return Object.entries(by).map(([m, ns]) => `<div class="who">📱 ${esc(nameOf(m))} 님이 받는 알림 ${ns.length}건</div>` +
      ns.map((n) => `<div class="n"><b>${esc(n.title)}</b>${n.body ? `<span>${esc(n.body)}</span>` : ''}</div>`).join('')).join('');
  }
  const pad = (n) => String(n).padStart(2, '0');
  const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

  function draw() {
    const pending = DB.project_audit_log.filter((a) => a.id > getCursor()).length;
    p.innerHTML = `
      <h4>로그인한 사람 (누르면 바뀜 · 데이터는 이 탭에서 유지)</h4>
      <div class="row">${DB.team_members.map((m, i) => `<a href="${urlWith({ as: i + 1 })}" class="${i + 1 === meIdx ? 'on' : ''}">${esc(m.name)}</a>`).join('')}</div>
      <div class="hint">다른 사람으로 바꿔 수정하면 '남이 바꾼 경우'(동시 수정 경고·변경 알림)를 볼 수 있어요.</div>
      <h4>데이터</h4>
      <div class="row"><a href="${urlWith({ reset: 1 })}">처음 데이터로 초기화</a><a href="${urlWith({ reset: 1, empty: 1 })}">빈 캘린더로 초기화</a>
        <a href="${urlWith({ reset: 1, n: 7 })}">7명으로 초기화</a></div>
      <h4>알림 미리보기 <span class="hint">(운영과 같은 판단 코드)</span></h4>
      <div class="row">기준 시각 <input type="datetime-local" id="qa-t" value="${localIso(new Date())}"></div>
      <div class="row" style="margin-top:6px"><button id="qa-brief">이 날 오후 4시 '다음 근무일 안내'</button></div>
      <div class="row" style="margin-top:6px"><button id="qa-chg">변경 알림 보기 (확인 안 한 변경 ${pending}건)</button><button id="qa-ack">여기까지 확인함</button></div>
      <div class="hint">변경 알림: 마지막 '확인함' 이후 이 탭에서 바꾼 것을, 기준 시각에 보낸다고 치고 계산합니다. 밤 22:00~07:30 이면 보류(아침에 발송)라 비어 보여요.</div>
      <div id="qa-out" style="margin-top:8px"></div>`;
    const t = () => new Date(document.getElementById('qa-t').value).getTime();
    document.getElementById('qa-brief').onclick = () => {
      const d = new Date(t()); d.setHours(16, 0, 0, 0);
      const notes = CalPlan.planNotifications(snapshot(false), d.getTime()).notes.filter((n) => n.kind === 'brief');
      document.getElementById('qa-out').innerHTML = `<div class="hint">${d.getMonth() + 1}/${d.getDate()} 16:00 기준</div>` + render(notes, '보낼 안내 없음 — 쉬는 날이거나, 다음 근무일이 모두 평소와 같아요.');
    };
    document.getElementById('qa-chg').onclick = () => {
      const notes = CalPlan.planNotifications(snapshot(true), t()).notes.filter((n) => n.kind === 'change');
      document.getElementById('qa-out').innerHTML = render(notes, '보낼 변경 알림 없음');
    };
    document.getElementById('qa-ack').onclick = () => { setCursor(DB.project_audit_log.length ? Math.max(...DB.project_audit_log.map((a) => a.id)) : 0); draw(); };
  }
})();
