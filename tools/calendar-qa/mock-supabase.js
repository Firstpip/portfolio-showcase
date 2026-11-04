// 로그인 없이 워크룸을 띄우기 위한 메모리 Supabase (테스트 전용)
// - from().select/insert/update/upsert/delete + eq/is/in/order/limit, rpc, channel, auth, functions
// - 캘린더 테이블에 DB 트리거 흉내: created/updated, 감사 로그, 휴가 겹침(23P01), 고유키(23505), 실시간 이벤트
(function () {
  const ME_UID = '11111111-1111-1111-1111-111111111111';
  const iso = () => new Date().toISOString();
  const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c==='x'?r:(r&3|8)).toString(16); });
  const day = n => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
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
    calendar_holidays: [{ holiday_date:'2026-10-03', name:'개천절' }, { holiday_date:'2026-10-05', name:'대체공휴일' }, { holiday_date:'2026-10-09', name:'한글날' }, { holiday_date:'2026-12-25', name:'성탄절' }],
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
  // QA: ?as=1,2,3… 로 로그인한 사람 바꾸기(팀원 목록 순서). 기본은 2번(이나래)
  const AS = Number(QS.get('as') || 0);
  const curUid = () => (AS && DB.team_members[AS-1]?.user_id) || ME_UID;
  const CAL = ['team_work_routines','team_work_overrides','member_work_overrides','team_leaves','calendar_events'];
  const UNIQUE = { team_work_routines:['valid_from'], team_work_overrides:['work_date'], member_work_overrides:['member_id','work_date'] };
  const listeners = [];
  let actor = ME_UID;
  const emit = (table, eventType) => setTimeout(() => listeners.filter(l => !l.table || l.table===table).forEach(l => l.fn({ eventType, table })), 10);
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
    order(c,o){ this._order=[c, o?.ascending!==false]; return this; } limit(n){ this._limit=n; return this; }
    single(){ this._single=true; return this; } maybeSingle(){ this._single=true; return this; }
    insert(v){ this.op='insert'; this.v=Array.isArray(v)?v:[v]; return this; }
    update(v){ this.op='update'; this.v=v; return this; }
    upsert(v,o){ this.op='upsert'; this.v=Array.isArray(v)?v:[v]; this.oc=(o?.onConflict||'id').split(','); return this; }
    delete(){ this.op='delete'; return this; }
    then(res, rej){ return Promise.resolve().then(() => this.exec()).then(res, rej); }
    exec(){
      const t = this.t; if (!DB[t]) DB[t] = [];
      const rows = DB[t]; const match = r => this.f.every(f => f(r));
      if (this.op==='select') { (window.__mock.q ||= []).push(t); let out = rows.filter(match); if (this._order) { const [c,a]=this._order; out = [...out].sort((x,y)=> (x[c]>y[c]?1:x[c]<y[c]?-1:0)*(a?1:-1)); } if (this._limit) out = out.slice(0,this._limit); (window.__mock.rows ||= {})[t] = out.map(r=>r.title||r.work_date||r.from_date||r.id); return { data: JSON.parse(JSON.stringify(this._single ? out[0]||null : out)), error:null }; }
      if (this.op==='insert' || this.op==='upsert') {
        const out = [];
        for (const v of this.v) {
          const ex = this.op==='upsert' ? rows.find(r => this.oc.every(c => r[c]===v[c])) : null;
          if (ex) { const before = { ...ex }; const next = { ...ex, ...v, updated_at:iso(), updated_by:actor }; const c = check(t, next, ex.id); if (c && c!=='dup') return c; Object.assign(ex, next); audit(t,'UPDATE',before,ex); out.push(ex); emit(t,'UPDATE'); continue; }
          const row = { id:uuid(), created_at:iso(), updated_at:iso(), created_by:actor, updated_by:actor, exdates:t==='calendar_events'?[]:undefined, ...v };
          const c = check(t, row, row.id); if (c==='dup') return err('23505','duplicate key'); if (c) return c;
          rows.push(row); audit(t,'INSERT',null,row); out.push(row); emit(t,'INSERT');
        }
        return { data: JSON.parse(JSON.stringify(out)), error:null };
      }
      if (this.op==='update') { const hit = rows.filter(match); for (const r of hit) { const before={...r}; const next = { ...r, ...this.v, updated_at:iso(), updated_by:actor }; const c = check(t, next, r.id); if (c==='dup') return err('23505','duplicate key'); if (c) return c; Object.assign(r, next); audit(t,'UPDATE',before,r); emit(t,'UPDATE'); } return { data:hit, error:null }; }
      if (this.op==='delete') { const hit = rows.filter(match); DB[t] = rows.filter(r => !match(r)); hit.forEach(r => { audit(t,'DELETE',r,null); emit(t,'DELETE'); }); return { data:hit, error:null }; }
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
  window.__mock = { restored, save, DB, M1, M2, M3, day, asOther(fn){ const prev = actor; actor = '33333333-3333-3333-3333-333333333333'; try { return fn(); } finally { actor = prev; } }, emit };
})();
