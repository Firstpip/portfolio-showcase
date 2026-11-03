// 알림 계획 테스트 — deno test supabase/functions/calendar-push/plan.test.ts
import { planNotifications, type Snapshot } from "./plan.ts";

const eq = (a: unknown, b: unknown, msg: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}\n  실제: ${JSON.stringify(a)}\n  기대: ${JSON.stringify(b)}`); };
const ok = (c: unknown, msg: string) => { if (!c) throw new Error(msg); };
const at = (k: string, hm: string) => Date.parse(`${k}T${hm}:00+09:00`);

const M1 = "m1", M2 = "m2", M3 = "m3";
const base = (): Snapshot => ({
  members: [{ id: M1, name: "김동욱", user_id: "u1" }, { id: M2, name: "최기용", user_id: "u2" }, { id: M3, name: "심정규", user_id: "u3" }],
  subs: [
    { id: "s1", member_id: M1, lead_minutes: 30, morning_brief: true, change_alerts: true },
    { id: "s2", member_id: M2, lead_minutes: 30, morning_brief: true, change_alerts: true },
    { id: "s2b", member_id: M2, lead_minutes: 10, morning_brief: false, change_alerts: false },
    { id: "s3", member_id: M3, lead_minutes: 60, morning_brief: false, change_alerts: true },
  ],
  routines: [{ valid_from: "2026-01-01", days: { 1: "cityhall", 2: "cityhall", 3: "home", 4: "cityhall", 5: "cityhall" } }],
  teamOverrides: [], memberOverrides: [], leaves: [],
  events: [
    { id: "e1", type: "meeting", kind: "kickoff", title: "가나다물류 킥오프", event_date: "2026-11-03", start_time: "14:00:00", all_day: false, meeting_type: "inperson", place: "고객사", people: [M1, M2], auto_out: true, exdates: [] },
    { id: "e2", type: "internal", title: "주간 회의", event_date: "2026-11-02", start_time: "10:00:00", all_day: false, people: [M1, M2, M3], repeat: "weekly", skip_holiday: true, exdates: ["2026-11-16"] },
    { id: "e3", type: "deadline", title: "제안서 마감", event_date: "2026-11-03", all_day: true, people: [M2], exdates: [] },
  ],
  holidays: { "2026-12-25": "성탄절" },
  wishket: [{ slug: "w1", title: "호텔 QR 앱", meeting_at: "2026-11-03T02:00:00Z", meeting_type: "video", assigned_main: M2, assigned_sub: null, current_status: "interview" }],
  audit: [],
});
const keys = (r: ReturnType<typeof planNotifications>) => r.notes.map((n) => n.key).sort();

Deno.test("미팅 시작 전 알림은 보내지 않음 (사용자 결정)", () => {
  const s = base();
  for (const t of ["13:30", "13:50", "10:30"]) eq(planNotifications(s, at("2026-11-03", t)).notes.filter((n) => n.key.startsWith("m:")).length, 0, `미팅 알림 없음 ${t}`);
});

Deno.test("다음 근무일 안내: 근무일 16:00~17:30, 다음 근무일 기준", () => {
  const s = base();
  s.leaves = [{ member_id: M3, from_date: "2026-11-03", to_date: "2026-11-03", kind: "off" }];
  eq(planNotifications(s, at("2026-11-02", "15:59")).notes.filter((n) => n.kind === "brief").length, 0, "15:59 전");
  eq(planNotifications(s, at("2026-11-02", "17:30")).notes.filter((n) => n.kind === "brief").length, 0, "17:30 이후");
  eq(planNotifications(s, at("2026-11-02", "17:25")).notes.filter((n) => n.kind === "brief").length, 2, "17:25 도 구간 안(첫 실행이 늦어도 나감)");
  const r = planNotifications(s, at("2026-11-02", "16:00")).notes.filter((n) => n.kind === "brief");
  eq(r.map((n) => n.member).sort(), [M1, M2], "다음 근무일 안내 켠 사람만(심정규는 끔), 내일 연차인 심정규는 원래 제외");
  const me = r.find((n) => n.member === M2)!;
  eq([me.key, me.title], ["e:2026-11-03:m2", "🚕 내일 외근 (가나다물류 킥오프) · 11/3 (화)"], "키·제목(근무지가 바뀌는 날은 제목에 근무지)");
  eq(me.body, "근무지: 외근 (가나다물류 킥오프) (평소와 다름)\n일정 3건: 종일 제안서 마감, 11:00 호텔 QR 앱, 14:00 가나다물류 킥오프\n팀: 김동욱 외근 (가나다물류 킥오프), 심정규 연차", "본문");
});

Deno.test("다음 근무일 안내: 금요일 → 월요일, 공휴일 전날 → 그다음 평일, 쉬는 날엔 없음", () => {
  const s = base();
  s.events.push({ id: "e5", type: "internal", title: "월요 점검", event_date: "2026-11-09", start_time: "09:30:00", all_day: false, people: [M1], exdates: [] });
  const fri = planNotifications(s, at("2026-11-06", "16:35")).notes.filter((n) => n.kind === "brief" && n.member === M1);
  eq(fri.map((n) => [n.key, n.title]), [["e:2026-11-09:m1", "📅 다음 근무일 11/9 (월)"]], "금요일 오후 → 월요일");
  eq(planNotifications(s, at("2026-11-07", "16:35")).notes.filter((n) => n.kind === "brief").length, 0, "토요일엔 없음");
  s.holidays["2026-11-10"] = "임시공휴일";
  s.events.push({ id: "e6", type: "internal", title: "수요 점검", event_date: "2026-11-11", start_time: "09:30:00", all_day: false, people: [M1], exdates: [] });
  eq(planNotifications(s, at("2026-11-09", "16:35")).notes.filter((n) => n.kind === "brief" && n.member === M1).map((n) => n.key), ["e:2026-11-11:m1"], "공휴일 전날 → 그다음 평일");
});

Deno.test("다음 근무일 안내: 평소와 같은 날은 보내지 않음, 다르면 보냄", () => {
  const s = base(); s.events = []; s.wishket = [];
  eq(planNotifications(s, at("2026-11-03", "16:30")).notes.filter((n) => n.kind === "brief").length, 0, "패턴대로·일정 없음·팀 정상 → 없음");
  s.teamOverrides = [{ work_date: "2026-11-04", loc: "other", branch: "패스트파이브 강남 3호점", note: null }];
  const ex = planNotifications(s, at("2026-11-03", "16:30")).notes.find((n) => n.member === M1 && n.kind === "brief")!;
  eq([ex.title, ex.body], ["🏢 내일 강남 3호점 · 11/4 (수)", "근무지: 패스트파이브 강남 3호점 (평소와 다름)"], "팀 근무지 하루 예외");
  s.teamOverrides = []; s.memberOverrides = [{ member_id: M1, work_date: "2026-11-04", loc: "out", branch: null }];
  const r = planNotifications(s, at("2026-11-03", "16:30")).notes.filter((n) => n.kind === "brief");
  eq(r.find((n) => n.member === M1)!.body.split("\n")[0], "근무지: 외근 (평소와 다름)", "내 개인 근무지");
  const only = r.find((n) => n.member === M2)!;
  eq([only.title, only.body], ["👥 내일 김동욱 외근 · 11/4 (수)", "근무지: 재택근무\n팀: 김동욱 외근"], "팀원만 평소와 달라도 모두에게 — 제목에 그 팀원 (2026-11-03 사용자 결정)");
  s.memberOverrides.push({ member_id: M3, work_date: "2026-11-04", loc: "forest", branch: null });
  eq(planNotifications(s, at("2026-11-03", "16:30")).notes.find((n) => n.member === M2 && n.kind === "brief")!.title, "👥 내일 김동욱 외근 외 1명 · 11/4 (수)", "여러 명이면 외 N명");
  s.memberOverrides.pop();
  s.events = [{ id: "e9", type: "internal", title: "회고", event_date: "2026-11-04", start_time: "16:00:00", all_day: false, people: [M2], exdates: [] }];
  const withEv = planNotifications(s, at("2026-11-03", "16:30")).notes.find((n) => n.member === M2 && n.kind === "brief")!;
  eq([withEv.title, withEv.body], ["📅 내일 11/4 (수)", "근무지: 재택근무\n일정 1건: 16:00 회고\n팀: 김동욱 외근"], "내 일정이 있어 보내는 날엔 팀원 부재도 본문에");
  s.events = [];
  s.memberOverrides = []; s.leaves = [{ member_id: M2, from_date: "2026-11-04", to_date: "2026-11-04", kind: "pm" }];
  s.routines.push({ valid_from: "2026-11-04", days: { 1: "cityhall", 2: "cityhall", 3: "forest", 4: "cityhall", 5: "cityhall" } });
  eq(planNotifications(s, at("2026-11-03", "16:30")).notes.find((n) => n.member === M2 && n.kind === "brief")!.body, "근무지: 오후반차 · 패스트파이브 서울숲 (평소와 다름)", "반차 + 패턴이 바뀌는 날");
  eq(planNotifications(s, at("2026-10-27", "16:30")).notes.find((n) => n.member === M1 && n.kind === "brief"), undefined, "과거 수요일(예전 패턴, 평소와 같음) → 없음");
  s.leaves = []; s.memberOverrides = [{ member_id: M1, work_date: "2026-11-05", loc: "home", branch: null }];
  eq(planNotifications(s, at("2026-11-04", "16:00")).notes.find((n) => n.member === M1 && n.kind === "brief")!.title, "🏠 내일 재택근무 · 11/5 (목)", "개인 재택 → 제목에 재택");
});

Deno.test("변경 알림: 밤 22:00~07:30 은 보내지 않고 처리 위치도 그대로", () => {
  const s = base();
  s.teamOverrides = [{ work_date: "2026-11-03", loc: "forest", branch: null, note: null }];
  s.audit = [{ id: 31, table_name: "team_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { work_date: "2026-11-03", loc: "forest" } }];
  for (const [d, t] of [["2026-11-02", "22:00"], ["2026-11-02", "23:30"], ["2026-11-03", "07:29"]]) {
    const r = planNotifications(s, at(d, t));
    eq([r.notes.filter((n) => n.kind === "change").length, r.cursor], [0, null], `조용한 시간 ${d} ${t}`);
  }
  const m = planNotifications(s, at("2026-11-03", "07:30"));
  eq([m.notes.filter((n) => n.kind === "change").map((n) => n.title)[0], m.cursor], ["🏢 오늘 팀 근무지 변경", 31], "아침 07:30 에 '오늘' 기준으로 발송");
});

Deno.test("변경 알림: 팀 근무지 — 오늘~모레만, 바꾼 사람 제외", () => {
  const s = base();
  s.teamOverrides = [{ work_date: "2026-11-03", loc: "forest", branch: null, note: "킥오프" }];
  s.audit = [
    { id: 11, table_name: "team_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { work_date: "2026-11-03", loc: "forest" } },
    { id: 12, table_name: "team_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { work_date: "2026-11-20", loc: "home" } },
  ];
  const r = planNotifications(s, at("2026-11-02", "15:00"));
  eq(r.notes.filter((n) => n.kind === "change").map((n) => n.key).sort(), ["c:11:m2", "c:11:m3"], "김동욱 제외, 11/20 은 범위 밖");
  const n = r.notes.find((x) => x.key === "c:11:m2")!;
  eq([n.title, n.body], ["🏢 내일 팀 근무지 변경", "11/3 (화) 패스트파이브 서울숲 · 킥오프 — 김동욱"], "문구");
  eq(r.cursor, 12, "처리 위치는 범위 밖 행까지 전진");
});

Deno.test("변경 알림: 팀 근무지 — 금요일 오후 안내 뒤 월요일 변경도 알림(다음 근무일까지)", () => {
  const s = base();
  s.teamOverrides = [{ work_date: "2026-11-09", loc: "home", branch: null, note: null }];
  s.audit = [
    { id: 21, table_name: "team_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { work_date: "2026-11-09", loc: "home" } },
    { id: 22, table_name: "team_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { work_date: "2026-11-10", loc: "forest" } },
  ];
  const r = planNotifications(s, at("2026-11-06", "17:10"));   // 금요일 17:10
  eq(r.notes.filter((n) => n.kind === "change").map((n) => n.key).sort(), ["c:21:m2", "c:21:m3"], "월요일(다음 근무일) 변경은 알림, 화요일은 범위 밖");
  eq(r.notes.find((x) => x.key === "c:21:m2")!.title, "🏢 11/9 (월) 팀 근무지 변경", "제목");
  s.holidays["2026-11-09"] = "임시공휴일";
  s.teamOverrides = [{ work_date: "2026-11-10", loc: "forest", branch: null, note: null }];
  eq(planNotifications(s, at("2026-11-06", "17:10")).notes.filter((n) => n.kind === "change").map((n) => n.key).sort(), ["c:22:m2", "c:22:m3"], "월요일이 공휴일이면 화요일이 다음 근무일");
});

Deno.test("변경 알림: 일정 추가·취소·의미 없는 갱신·참석자 아닌 사람", () => {
  const s = base();
  const ev = { id: "e9", type: "meeting", title: "디자인 협의", event_date: "2026-11-05", start_time: "11:00:00", all_day: false, people: [M2, M3], exdates: [], deleted_at: null };
  s.audit = [
    { id: 21, table_name: "calendar_events", op: "INSERT", actor_id: "u2", before: null, after: ev },
    { id: 22, table_name: "calendar_events", op: "UPDATE", actor_id: "u2", before: ev, after: { ...ev, change_note: "x" } },
    { id: 23, table_name: "calendar_events", op: "UPDATE", actor_id: "u1", before: ev, after: { ...ev, start_time: "15:00:00", change_note: "시간 11:00 → 15:00" } },
    { id: 24, table_name: "calendar_events", op: "UPDATE", actor_id: "u2", before: ev, after: { ...ev, deleted_at: "2026-11-02T06:00:00Z" } },
    { id: 25, table_name: "calendar_events", op: "INSERT", actor_id: "u2", before: null, after: { ...ev, id: "e10", event_date: "2026-12-01" } },
  ];
  const c = planNotifications(s, at("2026-11-02", "15:00")).notes.filter((n) => n.kind === "change");
  eq(c.map((n) => n.key).sort(), ["c:21:m3", "c:23:m2", "c:23:m3", "c:24:m3"], "추가(본인 제외)·변경(제3자)·취소, 의미 없는 갱신·먼 일정 제외");
  eq(c.find((n) => n.key === "c:23:m2")!.body, "11/5 (목) 15:00 디자인 협의 — 김동욱\n시간 11:00 → 15:00", "변경 문구");
  eq(c.find((n) => n.key === "c:24:m3")!.title, "✖️ 일정 취소", "취소 제목");
});

Deno.test("구독이 없는 사람에게는 계획하지 않음", () => {
  const s = base(); s.subs = [];
  eq(planNotifications(s, at("2026-11-03", "13:30")).notes.length, 0, "구독 없음");
});

Deno.test("변경 알림: 반복 일정 나누기는 한 건만 '변경', 한 회차 삭제는 '취소'·되돌림은 '추가'", () => {
  const s = base();
  const rep = s.events.find((e) => e.id === "e2")!; // 주간 회의 월 10:00, M1·M2·M3
  const child = { id: "e2c", type: "internal", title: "주간 회의", event_date: "2026-11-09", start_time: "15:00:00", all_day: false, people: [M1, M3], parent_id: "e2", exdates: [], change_note: "11/9 (월) 주간 회의 · 이 회차만 · 시간 10:00 → 15:00" };
  s.events.push(child);
  s.audit = [
    { id: 41, table_name: "calendar_events", op: "INSERT", actor_id: "u1", before: null, after: child },
    { id: 42, table_name: "calendar_events", op: "UPDATE", actor_id: "u1", before: rep, after: { ...rep, exdates: [...rep.exdates, "2026-11-09"], change_note: "11/9 (월) 회차를 따로 고침" } },
  ];
  const c = planNotifications(s, at("2026-11-04", "15:00")).notes.filter((n) => n.kind === "change");
  eq(c.map((n) => n.key).sort(), ["c:41:m2", "c:41:m3"], "나누기: 새 일정 쪽 한 건만, 빠진 최기용에게도");
  eq([c[0].title, c[0].body], ["✏️ 일정 변경", "11/9 (월) 15:00 주간 회의 — 김동욱\n11/9 (월) 주간 회의 · 이 회차만 · 시간 10:00 → 15:00"], "나누기 문구");

  const s2 = base(); const rep2 = s2.events.find((e) => e.id === "e2")!;
  const skipped = { ...rep2, exdates: [...rep2.exdates, "2026-11-09"], change_note: "이 회차 삭제 · 11/9 (월) 주간 회의" };
  s2.audit = [
    { id: 51, table_name: "calendar_events", op: "UPDATE", actor_id: "u1", before: rep2, after: skipped },
    { id: 52, table_name: "calendar_events", op: "UPDATE", actor_id: "u1", before: skipped, after: { ...rep2, change_note: "삭제 되돌림 · 11/9 (월) 주간 회의" } },
  ];
  const d = planNotifications(s2, at("2026-11-04", "15:00")).notes.filter((n) => n.kind === "change" && n.member === M2);
  eq(d.map((n) => [n.title, n.body]), [["✖️ 일정 취소", "11/9 (월) 10:00 주간 회의 — 김동욱"], ["➕ 일정 추가", "11/9 (월) 10:00 주간 회의 — 김동욱"]], "한 회차 삭제·되돌림 (다음 회차가 아니라 그 회차 날짜)");
  s2.audit = [{ id: 53, table_name: "calendar_events", op: "UPDATE", actor_id: "u1", before: rep2, after: { ...rep2, exdates: [...rep2.exdates, "2026-11-30"] } }];
  eq(planNotifications(s2, at("2026-11-04", "15:00")).notes.filter((n) => n.kind === "change").length, 0, "8일 뒤 이후 회차 삭제는 알림 없음");
});

Deno.test("변경 알림: 팀원 개인 근무지 — 전원(바꾼 사람 제외), 다음 근무일까지, 바꿨다 되돌림은 생략", () => {
  const s = base(); s.events = []; s.wishket = [];
  s.memberOverrides = [{ member_id: M1, work_date: "2026-11-04", loc: "home", branch: null }];
  s.audit = [{ id: 31, table_name: "member_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { member_id: M1, work_date: "2026-11-04", loc: "home", branch: null, note: "집중 작업" } }];
  let r = planNotifications(s, at("2026-11-03", "17:40"));
  eq(r.notes.filter((n) => n.kind === "change").map((n) => n.key).sort(), ["c:31:m2", "c:31:m3"], "본인(김동욱) 제외 전원");
  const n = r.notes.find((x) => x.key === "c:31:m2")!;
  eq([n.title, n.body, n.tag], ["🏠 김동욱 내일 재택근무", "11/4 (수) 김동욱 → 재택근무 · 집중 작업 — 김동욱", "who:m1:2026-11-04"], "문구");
  // 다른 사람이 내 근무지를 바꾸면 나도 받음
  s.audit = [{ id: 32, table_name: "member_work_overrides", op: "INSERT", actor_id: "u2", before: null, after: { member_id: M1, work_date: "2026-11-04", loc: "home", branch: null } }];
  eq(planNotifications(s, at("2026-11-03", "17:40")).notes.filter((n) => n.kind === "change").map((n) => n.member).sort(), [M1, M3], "남이 바꾸면 당사자도 받음");
  // 외근 → 되돌림(같은 실행 안) → 없음
  s.memberOverrides = [];
  s.audit = [
    { id: 33, table_name: "member_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { id: "o1", member_id: M1, work_date: "2026-11-04", loc: "out", branch: null } },
    { id: 34, table_name: "member_work_overrides", op: "DELETE", actor_id: "u1", before: { id: "o1", member_id: M1, work_date: "2026-11-04", loc: "out", branch: null }, after: null },
  ];
  r = planNotifications(s, at("2026-11-03", "17:40"));
  eq(r.notes.filter((n) => n.kind === "change").length, 0, "바꿨다 되돌림은 보내지 않음"); eq(r.cursor, 34, "처리 위치는 전진");
  // 해제(팀 근무지대로)
  s.audit = [{ id: 35, table_name: "member_work_overrides", op: "DELETE", actor_id: "u1", before: { member_id: M1, work_date: "2026-11-04", loc: "out", branch: null }, after: null }];
  eq(planNotifications(s, at("2026-11-03", "17:40")).notes.find((x) => x.key === "c:35:m2")!.body, "11/4 (수) 김동욱 → 재택근무 (팀 근무지대로) — 김동욱", "해제는 팀 근무지대로");
  // 범위 밖(다음 근무일보다 뒤) → 없음
  s.audit = [{ id: 36, table_name: "member_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { member_id: M1, work_date: "2026-11-10", loc: "home", branch: null } }];
  eq(planNotifications(s, at("2026-11-03", "17:40")).notes.filter((n) => n.kind === "change").length, 0, "범위 밖");
  // 밤에는 보류
  s.audit = [{ id: 37, table_name: "member_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { member_id: M1, work_date: "2026-11-04", loc: "home", branch: null } }];
  eq(planNotifications(s, at("2026-11-03", "23:00")).notes.filter((n) => n.kind === "change").length, 0, "밤에는 보류");
});

Deno.test("변경 알림: 휴가 — 다음 근무일까지 걸치면 전원, 사유만 수정은 생략, 취소", () => {
  const s = base(); s.events = []; s.wishket = [];
  const lv = { id: "l1", member_id: M3, from_date: "2026-11-04", to_date: "2026-11-05", kind: "off", note: null, deleted_at: null };
  s.audit = [{ id: 41, table_name: "team_leaves", op: "INSERT", actor_id: "u3", before: null, after: lv }];
  let r = planNotifications(s, at("2026-11-03", "10:00"));
  eq(r.notes.filter((n) => n.kind === "change").map((n) => n.key).sort(), ["c:41:m1", "c:41:m2"], "본인(심정규) 제외 전원");
  const n = r.notes.find((x) => x.key === "c:41:m1")!;
  eq([n.title, n.body], ["🌴 심정규 연차 등록", "11/4 (수)–11/5 (목) 심정규 연차 — 심정규"], "문구");
  s.audit = [{ id: 42, table_name: "team_leaves", op: "UPDATE", actor_id: "u3", before: lv, after: { ...lv, note: "가족 행사" } }];
  eq(planNotifications(s, at("2026-11-03", "10:00")).notes.filter((n) => n.kind === "change").length, 0, "사유만 수정 → 없음");
  s.audit = [{ id: 43, table_name: "team_leaves", op: "UPDATE", actor_id: "u3", before: lv, after: { ...lv, deleted_at: "2026-11-03T01:00:00Z" } }];
  eq(planNotifications(s, at("2026-11-03", "10:00")).notes.find((x) => x.key === "c:43:m1")!.title, "🌴 심정규 연차 취소", "취소");
  s.audit = [{ id: 44, table_name: "team_leaves", op: "INSERT", actor_id: "u3", before: null, after: { ...lv, from_date: "2026-11-20", to_date: "2026-11-21" } }];
  eq(planNotifications(s, at("2026-11-03", "10:00")).notes.filter((n) => n.kind === "change").length, 0, "먼 휴가는 안내 때(전날 오후)에만");
  s.audit = [{ id: 45, table_name: "team_leaves", op: "UPDATE", actor_id: "u3", before: lv, after: { ...lv, from_date: "2026-11-20", to_date: "2026-11-21" } }];
  eq(planNotifications(s, at("2026-11-03", "10:00")).notes.find((x) => x.key === "c:45:m1")!.title, "🌴 심정규 연차 변경", "가까운 휴가를 먼 날로 옮김 → 변경");
});

Deno.test("다음 근무일 안내: 팀원 상태가 오늘과 같으면(여러 날 휴가 등) 그것만으로는 보내지 않고 '(계속)'", () => {
  const s = base(); s.events = []; s.wishket = [];
  s.leaves = [{ member_id: M3, from_date: "2026-11-04", to_date: "2026-11-10", kind: "off" }];
  s.subs.push({ id: "s3b", member_id: M3, morning_brief: true, change_alerts: true });
  const b1 = planNotifications(s, at("2026-11-03", "16:00")).notes.filter((n) => n.kind === "brief");
  eq(b1.map((n) => n.title).sort(), ["👥 내일 심정규 연차 · 11/4 (수)", "👥 내일 심정규 연차 · 11/4 (수)"], "휴가 시작 전날엔 알림");
  eq(planNotifications(s, at("2026-11-04", "16:00")).notes.filter((n) => n.kind === "brief").length, 0, "휴가 둘째 날부터는 그것만으로 안 보냄");
  eq(planNotifications(s, at("2026-11-06", "16:00")).notes.filter((n) => n.kind === "brief").length, 0, "금요일(→월요일)도 이어지는 휴가면 안 보냄");
  s.events = [{ id: "e1", type: "internal", title: "회고", event_date: "2026-11-05", start_time: "16:00:00", all_day: false, people: [M1], exdates: [] }];
  eq(planNotifications(s, at("2026-11-04", "16:00")).notes.find((n) => n.member === M1 && n.kind === "brief")!.body,
    "근무지: 패스트파이브 시청역2호점\n일정 1건: 16:00 회고\n팀: 심정규 연차 (계속)", "다른 이유로 보낼 땐 본문에 (계속)");
  s.events = []; s.memberOverrides = [{ member_id: M2, work_date: "2026-11-05", loc: "home", branch: null }];
  const mix = planNotifications(s, at("2026-11-04", "16:00")).notes.find((n) => n.member === M1 && n.kind === "brief")!;
  eq([mix.title, mix.body], ["👥 내일 최기용 재택근무 · 11/5 (목)", "근무지: 패스트파이브 시청역2호점\n팀: 최기용 재택근무, 심정규 연차 (계속)"], "새 변동이 있으면 제목엔 새 것만");
});

Deno.test("변경 알림: 대면 미팅 외근 — 안내 뒤 등록·취소해도 참석자 아닌 팀원에게 근무지 알림", () => {
  const s = base(); s.wishket = [];
  const ev = { id: "e7", type: "meeting", title: "고객사 킥오프", event_date: "2026-11-05", start_time: "14:00:00", all_day: false, meeting_type: "inperson", people: [M1, M2], auto_out: true, exdates: [], deleted_at: null };
  s.events = [ev];
  s.audit = [{ id: 51, table_name: "calendar_events", op: "INSERT", actor_id: "u1", before: null, after: ev }];
  let r = planNotifications(s, at("2026-11-04", "17:40")).notes.filter((n) => n.kind === "change");
  eq(r.map((n) => `${n.member}|${n.title}`).sort(), ["m2|➕ 일정 추가", "m3|🚕 김동욱 내일 외근 (고객사 킥오프)", "m3|🚕 최기용 내일 외근 (고객사 킥오프)"], "참석자(최기용)는 일정 알림, 비참석자(심정규)는 두 사람 근무지");
  eq(r.find((n) => n.key === "c:51:m3:m1:2026-11-05")!.body, "11/5 (목) 김동욱 → 외근 (고객사 킥오프) — 김동욱", "근무지 알림 본문");
  // 취소(삭제) → 외근 해제
  s.events = [];
  s.audit = [{ id: 52, table_name: "calendar_events", op: "UPDATE", actor_id: "u1", before: ev, after: { ...ev, deleted_at: "2026-11-04T09:00:00Z" } }];
  r = planNotifications(s, at("2026-11-04", "17:40")).notes.filter((n) => n.member === M3);
  eq(r.map((n) => n.body).sort(), ["11/5 (목) 김동욱 → 패스트파이브 시청역2호점 (외근 해제) — 김동욱", "11/5 (목) 최기용 → 패스트파이브 시청역2호점 (외근 해제) — 김동욱"], "외근 해제");
  // 개인 근무지를 직접 정한 날은 미팅과 무관
  s.events = [ev]; s.memberOverrides = [{ member_id: M1, work_date: "2026-11-05", loc: "cityhall", branch: null }];
  s.audit = [{ id: 53, table_name: "calendar_events", op: "INSERT", actor_id: "u2", before: null, after: ev }];
  eq(planNotifications(s, at("2026-11-04", "17:40")).notes.filter((n) => n.member === M3).map((n) => n.title), ["🚕 최기용 내일 외근 (고객사 킥오프)"], "직접 정한 김동욱은 제외");
  // 외근 표시 없는 미팅·화상 미팅 → 근무지 알림 없음
  s.memberOverrides = []; const vid = { ...ev, id: "e8", meeting_type: "video" }; s.events = [vid];
  s.audit = [{ id: 54, table_name: "calendar_events", op: "INSERT", actor_id: "u1", before: null, after: vid }];
  eq(planNotifications(s, at("2026-11-04", "17:40")).notes.filter((n) => n.member === M3).length, 0, "화상 미팅은 근무지 그대로");
  // 범위 밖(다음 근무일 뒤)
  const far = { ...ev, id: "e9", event_date: "2026-11-10" }; s.events = [far];
  s.audit = [{ id: 55, table_name: "calendar_events", op: "INSERT", actor_id: "u1", before: null, after: far }];
  eq(planNotifications(s, at("2026-11-04", "17:40")).notes.filter((n) => n.member === M3).length, 0, "다음 근무일 뒤는 안내 때");
});

Deno.test("변경 알림: 반복 대면 미팅 '이 회차만' 시간 변경 → 근무지 그대로라 근무지 알림 없음", () => {
  const s = base(); s.wishket = [];
  const rep = { id: "r1", type: "meeting", title: "정기 점검", event_date: "2026-10-29", start_time: "10:00:00", all_day: false, meeting_type: "inperson", people: [M1], auto_out: true, repeat: "weekly", exdates: [], deleted_at: null };
  const child = { ...rep, id: "r1c", event_date: "2026-11-05", start_time: "15:00:00", repeat: null, parent_id: "r1" };
  s.events = [{ ...rep, exdates: ["2026-11-05"] }, child];
  s.audit = [
    { id: 61, table_name: "calendar_events", op: "INSERT", actor_id: "u1", before: null, after: child },
    { id: 62, table_name: "calendar_events", op: "UPDATE", actor_id: "u1", before: rep, after: { ...rep, exdates: ["2026-11-05"] } },
  ];
  eq(planNotifications(s, at("2026-11-04", "17:40")).notes.filter((n) => n.member === M3).length, 0, "외근은 그대로 → 비참석자 알림 없음");
});

Deno.test("변경 알림: 위시켓 대면 미팅 — 내일로 잡히면 바꾼 사람 뺀 전원에게 담당자 외근", () => {
  const s = base(); s.events = [];
  const w0 = { slug: "w9", title: "창호 견적", meeting_at: null, meeting_type: "video", assigned_main: M2, assigned_sub: null, current_status: "applied" };
  const w1 = { ...w0, meeting_at: "2026-11-05T05:00:00Z", meeting_type: "inperson", current_status: "interview" };
  s.wishket = [w1];
  s.audit = [{ id: 71, table_name: "wishket_projects", op: "UPDATE", actor_id: "u1", before: w0, after: w1 }];
  const r = planNotifications(s, at("2026-11-04", "17:40")).notes.filter((n) => n.kind === "change");
  eq(r.map((n) => `${n.member}|${n.title}`).sort(), ["m2|🚕 최기용 내일 외근 (창호 견적)", "m3|🚕 최기용 내일 외근 (창호 견적)"], "담당자 포함, 바꾼 사람(김동욱) 제외");
  s.audit = [{ id: 72, table_name: "wishket_projects", op: "UPDATE", actor_id: "u1", before: w1, after: { ...w1, title: "창호 견적 시스템" } }];
  eq(planNotifications(s, at("2026-11-04", "17:40")).notes.filter((n) => n.kind === "change").length, 0, "미팅과 무관한 수정은 무시");
});

Deno.test("주간 패턴: 같은 내용 재저장·지난 패턴은 '바뀜' 아님, 실제로 바뀌면 안내·알림", () => {
  const s = base(); s.events = []; s.wishket = [];
  const same = { valid_from: "2026-11-05", days: { 1: "cityhall", 2: "cityhall", 3: "home", 4: "cityhall", 5: "cityhall" }, change_note: "11/5부터 매주 목요일 시청역" };
  s.routines.push(same);
  eq(planNotifications(s, at("2026-11-04", "16:00")).notes.filter((n) => n.kind === "brief").length, 0, "같은 내용이면 안내 없음");
  s.audit = [{ id: 81, table_name: "team_work_routines", op: "INSERT", actor_id: "u1", before: null, after: same }];
  eq(planNotifications(s, at("2026-11-04", "10:00")).notes.filter((n) => n.kind === "change").length, 0, "같은 내용이면 변경 알림 없음");
  s.routines = [base().routines[0], { valid_from: "2026-09-01", days: { 1: "home", 2: "cityhall", 3: "home", 4: "cityhall", 5: "cityhall" } }, { valid_from: "2026-10-01", days: base().routines[0].days }];
  s.audit = [{ id: 82, table_name: "team_work_routines", op: "UPDATE", actor_id: "u1", before: {}, after: s.routines[1] }];
  eq(planNotifications(s, at("2026-11-04", "10:00")).notes.filter((n) => n.kind === "change").length, 0, "뒤에 다른 패턴이 있어 쓰이지 않는 지난 패턴");
  s.routines = [base().routines[0], { valid_from: "2026-11-05", days: { 1: "cityhall", 2: "cityhall", 3: "home", 4: "home", 5: "cityhall" } }];
  s.audit = [{ id: 83, table_name: "team_work_routines", op: "INSERT", actor_id: "u1", before: null, after: { ...s.routines[1], change_note: "11/5부터 매주 목요일 재택" } }];
  eq(planNotifications(s, at("2026-11-04", "10:00")).notes.filter((n) => n.kind === "change").map((n) => n.title), ["🗓 주간 근무 패턴 변경", "🗓 주간 근무 패턴 변경"], "실제로 바뀌면 알림");
  s.audit = [];
  eq(planNotifications(s, at("2026-11-04", "16:00")).notes.find((n) => n.member === M2 && n.kind === "brief")!.title, "🏠 내일 재택근무 · 11/5 (목)", "실제로 바뀌면 안내");
});
