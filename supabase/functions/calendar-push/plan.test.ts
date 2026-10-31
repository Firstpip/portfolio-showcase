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

Deno.test("저녁 안내: 근무일 18:30~20:00, 다음 근무일 기준", () => {
  const s = base();
  s.leaves = [{ member_id: M3, from_date: "2026-11-03", to_date: "2026-11-03", kind: "off" }];
  eq(planNotifications(s, at("2026-11-02", "18:29")).notes.filter((n) => n.kind === "brief").length, 0, "18:29 전");
  eq(planNotifications(s, at("2026-11-02", "20:00")).notes.filter((n) => n.kind === "brief").length, 0, "20:00 이후");
  const r = planNotifications(s, at("2026-11-02", "18:30")).notes.filter((n) => n.kind === "brief");
  eq(r.map((n) => n.member).sort(), [M1, M2], "저녁 안내 켠 사람만(심정규는 끔), 내일 연차인 심정규는 원래 제외");
  const me = r.find((n) => n.member === M2)!;
  eq([me.key, me.title], ["e:2026-11-03:m2", "🌙 내일 11/3 (화)"], "키·제목");
  eq(me.body, "근무지: 외근 (가나다물류 킥오프) (평소와 다름)\n일정 3건: 종일 제안서 마감, 11:00 호텔 QR 앱, 14:00 가나다물류 킥오프\n팀: 김동욱 외근 (가나다물류 킥오프), 심정규 연차", "본문");
});

Deno.test("저녁 안내: 금요일 → 월요일, 공휴일 전날 → 그다음 평일, 쉬는 날 저녁엔 없음", () => {
  const s = base();
  s.events.push({ id: "e5", type: "internal", title: "월요 점검", event_date: "2026-11-09", start_time: "09:30:00", all_day: false, people: [M1], exdates: [] });
  const fri = planNotifications(s, at("2026-11-06", "18:35")).notes.filter((n) => n.kind === "brief" && n.member === M1);
  eq(fri.map((n) => [n.key, n.title]), [["e:2026-11-09:m1", "🌙 다음 근무일 11/9 (월)"]], "금요일 저녁 → 월요일");
  eq(planNotifications(s, at("2026-11-07", "18:35")).notes.filter((n) => n.kind === "brief").length, 0, "토요일 저녁엔 없음");
  s.holidays["2026-11-10"] = "임시공휴일";
  s.events.push({ id: "e6", type: "internal", title: "수요 점검", event_date: "2026-11-11", start_time: "09:30:00", all_day: false, people: [M1], exdates: [] });
  eq(planNotifications(s, at("2026-11-09", "18:35")).notes.filter((n) => n.kind === "brief" && n.member === M1).map((n) => n.key), ["e:2026-11-11:m1"], "공휴일 전날 → 그다음 평일");
});

Deno.test("저녁 안내: 평소와 같은 날은 보내지 않음, 다르면 보냄", () => {
  const s = base(); s.events = []; s.wishket = [];
  eq(planNotifications(s, at("2026-11-03", "18:30")).notes.filter((n) => n.kind === "brief").length, 0, "패턴대로·일정 없음·팀 정상 → 없음");
  s.teamOverrides = [{ work_date: "2026-11-04", loc: "other", branch: "패스트파이브 강남 3호점", note: null }];
  eq(planNotifications(s, at("2026-11-03", "18:30")).notes.find((n) => n.member === M1 && n.kind === "brief")!.body, "근무지: 패스트파이브 강남 3호점 (평소와 다름)", "팀 근무지 하루 예외");
  s.teamOverrides = []; s.memberOverrides = [{ member_id: M1, work_date: "2026-11-04", loc: "out", branch: null }];
  const r = planNotifications(s, at("2026-11-03", "18:30")).notes.filter((n) => n.kind === "brief");
  eq(r.find((n) => n.member === M1)!.body.split("\n")[0], "근무지: 외근 (평소와 다름)", "내 개인 근무지");
  eq(r.find((n) => n.member === M2)!.body, "근무지: 재택근무\n팀: 김동욱 외근", "팀원이 다른 곳이면 다른 사람에게도");
  s.memberOverrides = []; s.leaves = [{ member_id: M2, from_date: "2026-11-04", to_date: "2026-11-04", kind: "pm" }];
  s.routines.push({ valid_from: "2026-11-04", days: { 1: "cityhall", 2: "cityhall", 3: "forest", 4: "cityhall", 5: "cityhall" } });
  eq(planNotifications(s, at("2026-11-03", "18:30")).notes.find((n) => n.member === M2 && n.kind === "brief")!.body, "근무지: 오후반차 · 패스트파이브 서울숲 (평소와 다름)", "반차 + 패턴이 바뀌는 날");
  eq(planNotifications(s, at("2026-10-27", "18:30")).notes.find((n) => n.member === M1 && n.kind === "brief"), undefined, "과거 수요일(예전 패턴, 평소와 같음) → 없음");
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
