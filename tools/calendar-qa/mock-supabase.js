// 로그인 없이 워크룸을 띄우기 위한 메모리 Supabase (테스트 전용)
// - from().select/insert/update/upsert/delete + eq/is/in/order/limit, rpc, channel, auth, functions
// - 캘린더 테이블에 DB 트리거 흉내: created/updated, 감사 로그, 휴가 겹침(23P01), 고유키(23505), 실시간 이벤트
// QA: 알림 권한·앱 창 흉내 — ?perm=denied|granted|default, ?app=1(홈 화면·설치 앱 창), ?ua=mac-chrome|mac-safari|win-chrome|iphone|android
(function () { const q = new URLSearchParams(location.search);
  const perm = q.get('perm'); if (perm && 'Notification' in window) try { Object.defineProperty(Notification, 'permission', { get: () => perm }); } catch (_) {}
  if (q.get('app')) { const mm = window.matchMedia.bind(window); window.matchMedia = m => /display-mode: *standalone/.test(m) ? { matches:true, media:m, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} } : mm(m); try { Object.defineProperty(navigator, 'standalone', { get: () => true }); } catch (_) {} }
  const UA = { 'mac-chrome':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'mac-safari':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    'win-chrome':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'iphone':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    'android':'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' }[q.get('ua')];
  if (UA) try { Object.defineProperty(navigator, 'userAgent', { get: () => UA }); } catch (_) {}
})();
(function () {
  const ME_UID = '11111111-1111-1111-1111-111111111111';
  const iso = () => new Date().toISOString();
  const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c==='x'?r:(r&3|8)).toString(16); });
  const day = n => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  // 여는 요일과 상관없이 같은 모습이 되게: wday(n) = 오늘부터 n번째 평일(0 = 오늘이 평일이면 오늘), nextDow(w) = 내일 이후 첫 w요일
  const wday = n => { let i = 0, c = 0; for (;; i++) { const g = new Date(day(i)+'T00:00:00').getDay(); if (g>0 && g<6) { if (c===n) return day(i); c++; } } };
  const nextDow = w => { for (let i = 1; ; i++) if (new Date(day(i)+'T00:00:00').getDay()===w) return day(i); };
  const at = (n, hm) => new Date(`${day(n)}T${hm}:00+09:00`).toISOString();
  const M1='aaaaaaaa-0000-0000-0000-000000000001', M2='aaaaaaaa-0000-0000-0000-000000000002', M3='aaaaaaaa-0000-0000-0000-000000000003';
  const DB = {
    team_members: [
      { id:M1, name:'김가람', color:'#6c5ce7', is_active:true, user_id:'22222222-2222-2222-2222-222222222222', created_at:'2026-01-01T00:00:00Z' },
      { id:M2, name:'이나래', color:'#00b894', is_active:true, user_id:ME_UID, created_at:'2026-01-02T00:00:00Z' },
      { id:M3, name:'박다온', color:'#e17055', is_active:true, user_id:'33333333-3333-3333-3333-333333333333', created_at:'2026-01-03T00:00:00Z' },
    ],
    wishket_projects: [
      { slug:'261029_hotel-qr', title:'호텔 QR 로컬 가이드 앱', current_status:'interview', meeting_at:at(0,'14:00'), meeting_type:'video', assigned_main:M2, assigned_sub:M3, wishket_url:'https://www.wishket.com/project/1', created_at:'2026-10-29T00:00:00Z' },
      { slug:'261024_window', title:'B2B 창호 견적 시스템 고도화', current_status:'interview', meeting_at:at(5,'11:00'), meeting_type:'inperson', assigned_main:M1, wishket_url:'https://www.wishket.com/project/2', created_at:'2026-10-24T00:00:00Z' },
      { slug:'261020_clinic', title:'피부과 예약·CRM 통합', current_status:'in_progress', meeting_at:at(-2,'16:00'), meeting_type:'phone', assigned_main:M3, assigned_manager:M3, created_at:'2026-10-20T00:00:00Z' },
    ],
    team_work_routines: [{ id:uuid(), valid_from:'2026-01-01', days:{1:'cityhall',2:'cityhall',3:'home',4:'cityhall',5:'cityhall'}, change_note:'기본 패턴', created_by:null, created_at:'2026-01-01T00:00:00Z' }],
    team_work_overrides: [], member_work_overrides: [], team_leaves: [], calendar_events: [],
    calendar_holidays: [{ holiday_date:'2026-10-03', name:'개천절' }, { holiday_date:'2026-10-05', name:'대체공휴일' }, { holiday_date:'2026-10-09', name:'한글날' }, { holiday_date:'2026-12-25', name:'성탄절' }, { holiday_date:'2027-01-01', name:'신정' }, { holiday_date:'2027-02-06', name:'설날 연휴' }, { holiday_date:'2027-02-07', name:'설날' }, { holiday_date:'2027-02-08', name:'설날 연휴' }, { holiday_date:'2027-02-09', name:'대체공휴일 (설날)' }, { holiday_date:'2027-03-01', name:'삼일절' }, { holiday_date:'2027-05-01', name:'노동절' }, { holiday_date:'2027-05-03', name:'대체공휴일 (노동절)' }, { holiday_date:'2027-05-05', name:'어린이날' }, { holiday_date:'2027-05-13', name:'부처님오신날' }, { holiday_date:'2027-06-06', name:'현충일' }, { holiday_date:'2027-07-17', name:'제헌절' }, { holiday_date:'2027-07-19', name:'대체공휴일 (제헌절)' }, { holiday_date:'2027-08-15', name:'광복절' }, { holiday_date:'2027-08-16', name:'대체공휴일 (광복절)' }, { holiday_date:'2027-09-14', name:'추석 연휴' }, { holiday_date:'2027-09-15', name:'추석' }, { holiday_date:'2027-09-16', name:'추석 연휴' }, { holiday_date:'2027-10-03', name:'개천절' }, { holiday_date:'2027-10-04', name:'대체공휴일 (개천절)' }, { holiday_date:'2027-10-09', name:'한글날' }, { holiday_date:'2027-10-11', name:'대체공휴일 (한글날)' }, { holiday_date:'2027-12-25', name:'성탄절' }, { holiday_date:'2027-12-27', name:'대체공휴일 (성탄절)' }],
    project_audit_log: [],
  };
  // 실제 DB처럼 새로고침해도 기기 등록은 남게 (테스트용)
  // QA: 이 탭 안에서는 새로고침해도 데이터 유지(sessionStorage). ?reset=1 이면 처음 데이터로.
  const QS = new URLSearchParams(location.search);
  let restored = false;
  if (QS.get('reset')) { try { sessionStorage.removeItem('__mockDB'); sessionStorage.removeItem('__qaCursor'); } catch (_) {}
    const u = new URL(location.href); u.searchParams.delete('reset'); u.searchParams.delete('empty'); history.replaceState(null, '', u.toString()); }
  else { try { const j = JSON.parse(sessionStorage.getItem('__mockDB')||'null'); if (j) { Object.keys(DB).forEach(k => delete DB[k]); Object.assign(DB, j); restored = true; } } catch (_) {} }
  const save = () => { try { sessionStorage.setItem('__mockDB', JSON.stringify(DB)); } catch (_) {} };
  window.addEventListener('pagehide', save); window.addEventListener('beforeunload', save);
  // ?demo=projects — 프로젝트 목록 날짜 칸(개발완료 예정일·무상 만료일) 눈으로 확인용 표본 (2026-11-06). 자동 시험(qa*)은 쓰지 않는다.
  //   무상 기준(일수): 개발완료일부터 180일, 계약금액 1,000만원 미만 90일, 2026-10-15 이전 계약은 일괄 180일(dashboard/src/maintenance.mjs). 날짜는 여는 날 기준.
  if (QS.get('demo') === 'projects' && !DB.wishket_projects.some(r => String(r.slug).startsWith('demo_'))) {
    const W = n => 'https://www.wishket.com/project/7' + n, base = { history:[], memo:null };
    DB.wishket_projects.push(...[
      { slug:'demo_dev_ok',      title:'[개발 중] 사내 예약 시스템 — 마감 20일 남음',          current_status:'in_progress',      budget:'1,500만원', start_date:day(-40), deadline:day(20) },
      { slug:'demo_dev_old',     title:'[개발 중] 예약 웹 — 500만원, 2026-04 계약(무상 기본 180일)', current_status:'in_progress', budget:'500만원', start_date:'2026-04-27', deadline:day(10), history:[{ date:'2026-04-16', status:'contracted', note:'' }, { date:'2026-04-27', status:'in_progress', note:'' }] },
      { slug:'demo_dev_small',   title:'[개발 중] 소개 사이트 — 700만원, 2026-10-20 계약(무상 기본 90일)', current_status:'in_progress', budget:'700만원', start_date:'2026-10-21', deadline:day(10), history:[{ date:'2026-10-20', status:'contracted', note:'' }, { date:'2026-10-21', status:'in_progress', note:'' }] },
      { slug:'demo_dev_late',    title:'[개발 중] 재고 관리 앱 — 마감 3일 지남',               current_status:'in_progress',      budget:'900만원',   start_date:day(-60), deadline:day(-3) },
      { slug:'demo_dev_none',    title:'[개발 중] 설문 플랫폼 — 마감일 없음',                  current_status:'in_progress',      budget:'1,200만원' },
      { slug:'demo_mf_soon',     title:'[무상] 시설 점검 앱 — 700만원, 곧 만료(90일)',         current_status:'maintenance_free', budget:'700만원',   start_date:day(-150), deadline:day(-80) },
      { slug:'demo_mf_ok',       title:'[무상] 교육 LMS — 1,800만원(180일)',                   current_status:'maintenance_free', budget:'1,800만원', start_date:day(-100), deadline:day(-10) },
      { slug:'demo_mf_trans',    title:'[무상] 뉴스레터 대시보드 — 개발완료일 미지정(계산 안 함)', current_status:'maintenance_free', budget:'500만원', history:[{ date:day(-200), status:'in_progress', note:'' }, { date:day(-30), status:'maintenance_free', note:'' }] },
      { slug:'demo_mf_manual',   title:'[무상] 쇼핑몰 리뉴얼 — 계약서 기간 직접 입력(1년)',      current_status:'maintenance_free', budget:'1,800만원', start_date:day(-90), deadline:day(-10), free_maint_until:day(355) },
      { slug:'demo_mf_legacy',   title:'[무상] 예약 관리 웹 — 500만원이지만 2026-10-15 이전 계약(180일)', current_status:'maintenance_free', budget:'500만원', deadline:day(-30), history:[{ date:'2026-04-16', status:'contracted', note:'' }, { date:day(-30), status:'maintenance_free', note:'' }] },
      { slug:'demo_mf_over',     title:'[무상] 워크북 웹 — 무상 기간 끝남',                    current_status:'maintenance_free', budget:'800만원',   start_date:day(-200), deadline:day(-120) },
      { slug:'demo_mf_nobudget', title:'[무상] 랜딩 페이지 — 금액 없음(기준 없음)',             current_status:'maintenance_free', budget:'',          start_date:day(-30), deadline:day(-15) },
      { slug:'demo_paid',        title:'[유상] 병원 홈페이지 — 개발완료일 그대로',               current_status:'maintenance_paid', budget:'1,000만원', deadline:day(-200) },
      { slug:'demo_deliv',       title:'[납품 완료] 포트폴리오 사이트 — 개발완료일 그대로',       current_status:'delivered',        budget:'60만원',    deadline:day(-50) },
    ].map((r, i) => ({ id:800 + i, created_at:`${day(-i)}T01:00:00Z`, wishket_url:W(i), ...base, ...r })));
  }
  // QA: ?as=1,2,3… 로 로그인한 사람 바꾸기(팀원 목록 순서). 기본은 2번(이나래)
  const AS = Number(QS.get('as') || 0);
  const curUid = () => (AS && DB.team_members[AS-1]?.user_id) || ME_UID;
  const CAL = ['team_work_routines','team_work_overrides','member_work_overrides','team_leaves','calendar_events'];
  const UNIQUE = { team_work_routines:['valid_from'], team_work_overrides:['work_date'], member_work_overrides:['member_id','work_date'] };
  const listeners = [];
  let actor = ME_UID;
  // 실제 Supabase 처럼 바뀐 행(new·old)을 같이 보낸다 — 워크룸 본체는 payload.new 로 목록을 고친다 (2026-11-06)
  const emit = (table, eventType, row, old) => { const n = row ? JSON.parse(JSON.stringify(row)) : {}, o = old ? JSON.parse(JSON.stringify(old)) : {}; setTimeout(() => listeners.filter(l => !l.table || l.table===table).forEach(l => l.fn({ eventType, table, new:n, old:o })), 10); };
  const audit = (table, op, before, after) => { if (!CAL.includes(table) && table!=='wishket_projects') return; DB.project_audit_log.push({ id:DB.project_audit_log.length+1, at:iso(), table_name:table, op, row_pk:(after||before).id, actor_id:actor, actor_email: actor===ME_UID?'qa@example.test':'other@example.test', before: before?JSON.parse(JSON.stringify(before)):null, after: after?JSON.parse(JSON.stringify(after)):null }); };
  const err = (code, message) => ({ data:null, error:{ code, message } });
  function check(table, row, selfId){
    if (table==='team_leaves' && !row.deleted_at) {
      if (row.to_date < row.from_date) return err('23514','tl_range');
      if (DB.team_leaves.some(l => l.id!==selfId && !l.deleted_at && l.member_id===row.member_id && l.from_date<=row.to_date && l.to_date>=row.from_date)) return err('23P01','같은 기간에 이미 등록된 휴가가 있습니다');
    }
    if (table==='calendar_events' && row.end_time && row.start_time && row.end_time <= row.start_time) return err('23514','ce_end_after');
    const u = UNIQUE[table]; if (u && DB[table].some(r => r.id!==selfId && u.every(c => r[c]===row[c]))) return 'dup';
    return null;
  }
  // PostgREST or=(…) 논리식 해석 (and/or 중첩, eq/gte/lte/gt/lt/is, not.)
  const splitTop = s => { const out=[]; let d=0, cur=''; for (const ch of s){ if (ch==='(') d++; if (ch===')') d--; if (ch===',' && d===0){ out.push(cur); cur=''; } else cur+=ch; } if (cur) out.push(cur); return out; };
  const cond = p => { const [col, ...rest] = p.split('.'); let neg=false; if (rest[0]==='not'){ neg=true; rest.shift(); } const op=rest[0], v=rest.slice(1).join('.');
    const f = r => { const x = r[col] ?? null; switch(op){ case 'is': return v==='null' ? x===null : String(x)===v; case 'eq': return String(x)===v; case 'gte': return x!==null && x>=v; case 'lte': return x!==null && x<=v; case 'gt': return x!==null && x>v; case 'lt': return x!==null && x<v; default: throw new Error('mock: 모르는 연산자 '+op); } };
    return neg ? r => !f(r) : f; };
  const logic = (kind, s) => { const ps = splitTop(s).map(p => { const m = p.match(/^(and|or)\((.*)\)$/); return m ? logic(m[1], m[2]) : cond(p); }); return kind==='and' ? r => ps.every(f=>f(r)) : r => ps.some(f=>f(r)); };
  class Q {
    constructor(t){ this.t=t; this.f=[]; this.op='select'; this._order=null; this._limit=null; }
    select(){ if (this.op==='select') this.op='select'; return this; }
    eq(c,v){ this.f.push(r => r[c]===v); return this; } neq(c,v){ this.f.push(r => r[c]!==v); return this; }
    is(c,v){ this.f.push(r => (r[c]??null)===v); return this; } in(c,vs){ this.f.push(r => vs.includes(r[c])); return this; }
    gte(c,v){ this.f.push(r => r[c]>=v); return this; } lte(c,v){ this.f.push(r => r[c]<=v); return this; }
    or(expr){ this.f.push(logic('or', expr)); this._or=expr; return this; }
    order(c,o){ (this._orders ||= []).push([c, o?.ascending!==false]); return this; } limit(n){ this._limit=n; return this; }
    range(a,b){ this._range=[a,b]; return this; }
    single(){ this._single=true; return this; } maybeSingle(){ this._single=true; return this; }
    insert(v){ this.op='insert'; this.v=Array.isArray(v)?v:[v]; return this; }
    update(v){ this.op='update'; this.v=v; return this; }
    upsert(v,o){ this.op='upsert'; this.v=Array.isArray(v)?v:[v]; this.oc=(o?.onConflict||'id').split(','); return this; }
    delete(){ this.op='delete'; return this; }
    // ?lat=800 → 읽기마다 800ms 지연 (느린 네트워크에서 '불러오는 중'·다시 들어올 때 즉시 표시 확인용)
    then(res, rej){ const lat = this.op==='select' ? Number(QS.get('lat')||0) : 0; return (lat ? new Promise(r => setTimeout(r, lat)) : Promise.resolve()).then(() => this.exec()).then(res, rej); }
    exec(){
      const t = this.t; if (!DB[t]) DB[t] = [];
      const rows = DB[t]; const match = r => this.f.every(f => f(r));
      if (this.op==='select') { (window.__mock.q ||= []).push(t); let out = rows.filter(match); if (this._orders) out = [...out].sort((x,y) => { for (const [c,a] of this._orders) { const d = (x[c]>y[c]?1:x[c]<y[c]?-1:0)*(a?1:-1); if (d) return d; } return 0; });
        // 실제 서버처럼 한 번에 최대 1000행 (limit·range 와 상관없이)
        if (this._range) out = out.slice(this._range[0], this._range[1]+1); if (this._limit) out = out.slice(0,this._limit); if (!this._single) out = out.slice(0, 1000); (window.__mock.rows ||= {})[t] = out.map(r=>r.title||r.work_date||r.from_date||r.id); return { data: JSON.parse(JSON.stringify(this._single ? out[0]||null : out)), error:null }; }
      if (this.op==='insert' || this.op==='upsert') {
        const out = [];
        for (const v of this.v) {
          const ex = this.op==='upsert' ? rows.find(r => this.oc.every(c => r[c]===v[c])) : null;
          if (ex) { const before = { ...ex }; const next = { ...ex, ...v, updated_at:iso(), updated_by:actor }; const c = check(t, next, ex.id); if (c && c!=='dup') return c; Object.assign(ex, next); audit(t,'UPDATE',before,ex); out.push(ex); emit(t,'UPDATE',ex,before); continue; }
          const row = { id:uuid(), created_at:iso(), updated_at:iso(), created_by:actor, updated_by:actor, exdates:t==='calendar_events'?[]:undefined, ...v };
          const c = check(t, row, row.id); if (c==='dup') return err('23505','duplicate key'); if (c) return c;
          rows.push(row); audit(t,'INSERT',null,row); out.push(row); emit(t,'INSERT',row);
        }
        return { data: JSON.parse(JSON.stringify(out)), error:null };
      }
      if (this.op==='update') { const hit = rows.filter(match); for (const r of hit) { const before={...r}; const next = { ...r, ...this.v, updated_at:iso(), updated_by:actor }; const c = check(t, next, r.id); if (c==='dup') return err('23505','duplicate key'); if (c) return c; Object.assign(r, next); audit(t,'UPDATE',before,r); emit(t,'UPDATE',r,before); } return { data:hit, error:null }; }
      if (this.op==='delete') { const hit = rows.filter(match); DB[t] = rows.filter(r => !match(r)); hit.forEach(r => { audit(t,'DELETE',r,null); emit(t,'DELETE',null,r); }); return { data:hit, error:null }; }
    }
  }
  const sessionOf = () => { const uid = curUid(); actor = uid; return { user:{ id:uid, email:(DB.team_members.find(m=>m.user_id===uid)?.name||'qa')+'@example.test', app_metadata:{ role:'admin' }, user_metadata:{} } }; };
  window.supabase = { createClient: () => ({
    from: t => new Q(t),
    rpc: async (fn, args) => {
      if (fn === 'register_push_subscription') {
        const T = DB.push_subscriptions || (DB.push_subscriptions = []);
        const me = DB.team_members.find(m => m.user_id === actor);
        let r = T.find(x => x.endpoint === args.p_endpoint);
        if (r && r.user_id !== actor) { DB.push_subscriptions = T.filter(x => x !== r); r = null; }
        if (!r) { r = { id:uuid(), user_id:actor, endpoint:args.p_endpoint, lead_minutes:30, morning_brief:true, change_alerts:true, fail_count:0, created_at:iso() }; DB.push_subscriptions.push(r); }
        Object.assign(r, { member_id: me?.id || null, p256dh:args.p_p256dh, auth:args.p_auth, platform:args.p_platform, user_agent:args.p_user_agent, updated_at:iso() });
        return { data: JSON.parse(JSON.stringify(r)), error:null };
      }
      // 반복 나누기(2026-11-06): 새 일정 INSERT + 원래 반복 UPDATE 를 한 번에. __mock.failSplit 이면 아무것도 쓰지 않고 실패(트랜잭션 롤백 흉내)
      if (fn === 'calendar_split_event') {
        if (window.__mock.failSplit) return err('08006', 'connection failure');
        if (!DB.calendar_events.some(r => r.id === args.p_parent && !r.deleted_at)) return err('P0002', '나눌 반복 일정을 찾지 못했습니다');
        const ins = await new Q('calendar_events').insert(args.p_row);
        if (ins.error) return ins;
        const patch = { exdates: args.p_parent_exdates || [], change_note: args.p_parent_note };
        if (args.p_parent_until) patch.repeat_until = args.p_parent_until;
        const up = await new Q('calendar_events').update(patch).eq('id', args.p_parent);
        if (up.error) return up;
        (window.__mock.splits ||= []).push(args);
        return { data: DB.calendar_events[DB.calendar_events.length - 1].id, error:null };
      }
      // 상태 변경(2026-11-10): 운영 append_project_history 와 같게 — 이력 항목 날짜는 오늘(KST), 허용된 칸만 바꾸고 바뀐 행을 돌려준다
      if (fn === 'append_project_history') {
        const r = DB.wishket_projects.find(x => x.slug === args.p_slug);
        if (!r) return { data:null, error:null };
        const ALLOWED = ['assigned_manager','assigned_main','assigned_sub','meeting_at','meeting_type','current_status','start_date','deadline'];
        const patch = { history: [...(r.history || []), ...(args.p_entries || []).map(e => ({ ...e, date: day(0) }))] };
        for (const k of ALLOWED) if (args.p_fields && k in args.p_fields) patch[k] = args.p_fields[k];
        const up = await new Q('wishket_projects').update(patch).eq('slug', args.p_slug);
        if (up.error) return up;
        (window.__mock.appends ||= []).push(args);
        return { data: JSON.parse(JSON.stringify(r)), error:null };
      }
      // 알림 서버 상태: 테스트가 페이지를 열기 전에 window.__qaHeartbeat 로 정할 수 있다(QA 패널·점검용)
      if (fn === 'calendar_push_status') return { data: window.__mock.heartbeat || window.__qaHeartbeat || null, error:null };
      return { data:0, error:null };
    },
    functions: { invoke: async (name, o) => { (window.__mock.invokes ||= []).push({ name, body:o?.body }); return name === 'calendar-push' && o?.body?.test ? { data:{ sent:(DB.push_subscriptions||[]).filter(x=>x.user_id===actor && (!o.body.endpoint || x.endpoint===o.body.endpoint)).length, failed:0 }, error:null } : { data:null, error:null }; } },
    channel: () => { const ch = { on(_e, o, fn){ listeners.push({ table:o?.table, fn }); return ch; }, subscribe(cb){ if (cb) { (window.__mock.chan ||= []).push(cb); cb('SUBSCRIBED'); } return ch; } }; return ch; },
    removeChannel: () => {},
    auth: { getSession: async () => ({ data:{ session: sessionOf() } }), onAuthStateChange: () => ({ data:{ subscription:{ unsubscribe(){} } } }), signOut: async () => ({}) },
  }) };
  // 테스트에서 다른 사람이 바꾼 상황을 만들 때 쓰는 손잡이
  window.__mock = { restored, save, DB, M1, M2, M3, day, wday, nextDow, asOther(fn){ const prev = actor; actor = '33333333-3333-3333-3333-333333333333'; try { return fn(); } finally { actor = prev; } }, emit };
})();
