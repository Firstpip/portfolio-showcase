// QA용 데이터 (탭에서 처음 열 때만 — 새로고침하면 그 탭의 데이터를 그대로 이어 씀, ?reset=1 이면 처음부터)
// 팀원 수: ?n=4(기본) · 3~7
(function(){ const m = window.__mock, DB = m.DB, day = m.day, wday = m.wday, q = new URLSearchParams(location.search);
  if (m.restored) return;
  const N = Number(q.get('n')||4);
  const extra = [['aaaaaaaa-0000-0000-0000-000000000004','최라온'],['aaaaaaaa-0000-0000-0000-000000000005','한별'],['aaaaaaaa-0000-0000-0000-000000000006','윤솔'],['aaaaaaaa-0000-0000-0000-000000000007','강빛']];
  extra.slice(0, Math.max(0,N-3)).forEach(([id,name],i)=>DB.team_members.push({ id, name, is_active:true, user_id:'4444444'+i+'-4444-4444-4444-444444444444', created_at:'2026-01-0'+(4+i)+'T00:00:00Z' }));
  if (q.get('empty')) return;
  const M4 = extra[0][0]; const id = () => Math.random().toString(36).slice(2);
  const base = { created_at:'2026-11-01T01:00:00Z', updated_at:'2026-11-01T01:00:00Z', created_by:'22222222-2222-2222-2222-222222222222', updated_by:null, deleted_at:null };
  // 오늘: 김가람 오후반차, 최라온 서울숲(개인)
  DB.team_leaves.push({ id:id(), ...base, member_id:m.M1, from_date:day(0), to_date:day(0), kind:'pm', note:'병원' });
  if (N>3) DB.member_work_overrides.push({ id:id(), ...base, member_id:M4, work_date:day(0), loc:'forest', branch:null, note:'서울숲 미팅룸 예약' });
  // 다음 평일: 이날만 시청역2호점 전원 출근 → 김가람·이나래 14:00 대면 미팅 (수요일이면 '평소 재택')
  DB.team_work_overrides.push({ id:id(), ...base, work_date:wday(1), loc:'cityhall', branch:null, note:null });
  // 평일 +2~+3: 박다온 연차 2일, 이나래 재택(개인)
  DB.team_leaves.push({ id:id(), ...base, member_id:m.M3, from_date:wday(2), to_date:wday(3), kind:'off', note:'가족 행사' });
  DB.member_work_overrides.push({ id:id(), ...base, member_id:m.M2, work_date:wday(2), loc:'home', branch:null, note:'오전 집중 작업' });
  // 평일 +3: 팀 근무지 이날만 서울숲(사유)
  DB.team_work_overrides.push({ id:id(), ...base, work_date:wday(3), loc:'forest', branch:null, note:'시청역 공사' });
  // 다른 장소(직접 입력): 평일 +2 김가람 혼자 판교로 바로 출근, 평일 +4 팀 전체가 미팅 장소로 바로 출근
  DB.member_work_overrides.push({ id:id(), ...base, member_id:m.M1, work_date:wday(2), loc:'other', branch:'판교 가나다타워 12층', note:'협력사 미팅 후 퇴근' });
  DB.team_work_overrides.push({ id:id(), ...base, work_date:wday(4), loc:'other', branch:'성수동 라마바빌딩', note:'고객사 워크숍 — 바로 출근' });
  // 팀 근무지에 오는 사람이 없는 날: 평일 +6 전원 개인 재택('전원 재택'), 평일 +7 제각각('각자 근무')
  DB.team_members.forEach(x => DB.member_work_overrides.push({ id:id(), ...base, member_id:x.id, work_date:wday(6), loc:'home', branch:null, note:null }));
  ['home','forest','out','home','forest','out','home'].slice(0, DB.team_members.length).forEach((loc,i) => DB.member_work_overrides.push({ id:id(), ...base, member_id:DB.team_members[i].id, work_date:wday(7), loc, branch:null, note:null }));
  // 다음 주: 최라온 연차 3일
  if (N>3) DB.team_leaves.push({ id:id(), ...base, member_id:M4, from_date:day(7), to_date:day(9), kind:'off', note:'' });
  const ev = (o) => DB.calendar_events.push({ id:id(), ...base, kind:null, all_day:false, start_time:null, end_time:null, meeting_type:null, place:null, people:[], note:null, repeat:null, repeat_until:null, skip_holiday:true, exdates:[], parent_id:null, project_slug:null, auto_out:false, ...o });
  ev({ type:'internal', title:'주간 회의', event_date:day(-1), start_time:'10:00', end_time:'10:30', people:DB.team_members.map(x=>x.id), repeat:'weekly' });
  ev({ type:'meeting', kind:'sales', title:'고객사 미팅', event_date:wday(1), start_time:'14:00', end_time:'16:00', meeting_type:'inperson', place:'고객사 (강남)', people:[m.M1, m.M2], auto_out:true });
  ev({ type:'meeting', kind:'review', title:'○○공단 중간보고', event_date:wday(2), start_time:'14:00', end_time:'15:00', meeting_type:'video', place:'Google Meet', people:[m.M2] });
  ev({ type:'deadline', title:'나라장터 제안서 마감', event_date:wday(3), all_day:true, people:[m.M2] });
  ev({ type:'meeting', kind:'maint', title:'라마바 쇼핑몰 장애 회의', event_date:day(0), start_time:'11:00', end_time:'11:30', meeting_type:'phone', people:[m.M2] });
  ev({ type:'meeting', kind:'partner', title:'디자인 협력사 미팅', event_date:day(8), start_time:'13:00', end_time:'14:00', meeting_type:'video', people:[m.M1] });
  ev({ type:'meeting', kind:'delivery', title:'가나다물류 오픈 교육', event_date:day(9), all_day:true, meeting_type:'inperson', place:'가나다물류 본사', people:[m.M3], auto_out:true });
  ev({ type:'other', title:'서버 인증서 갱신', event_date:day(10), all_day:true, people:[m.M2] });
})();
