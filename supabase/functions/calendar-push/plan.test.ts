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

Deno.test("미팅 알림: 30분 전부터 15분 안에만, 기기 리드별로", () => {
  const s = base();
  eq(keys(planNotifications(s, at("2026-11-03", "13:29"))).filter((k) => k.startsWith("m:e1")), [], "29분 전 아님 → 31분 전");
  eq(keys(planNotifications(s, at("2026-11-03", "13:30"))).filter((k) => k.startsWith("m:e1")), ["m:e1@2026-11-03@30:m1", "m:e1@2026-11-03@30:m2"], "정확히 30분 전");
  eq(keys(planNotifications(s, at("2026-11-03", "13:44"))).filter((k) => k.startsWith("m:e1")), ["m:e1@2026-11-03@30:m1", "m:e1@2026-11-03@30:m2"], "14분 지연까지 허용");
  eq(keys(planNotifications(s, at("2026-11-03", "13:45"))).filter((k) => k.startsWith("m:e1@2026-11-03@30")), [], "15분 지나면 안 보냄");
  eq(keys(planNotifications(s, at("2026-11-03", "13:50"))).filter((k) => k.startsWith("m:e1")), ["m:e1@2026-11-03@10:m2"], "10분 리드 기기");
  eq(keys(planNotifications(s, at("2026-11-03", "14:00"))).filter((k) => k.startsWith("m:e1")), [], "시작 후엔 안 보냄");
  const n = planNotifications(s, at("2026-11-03", "13:30")).notes.find((x) => x.key === "m:e1@2026-11-03@30:m1")!;
  eq([n.title, n.body], ["📅 30분 후 킥오프", "14:00 가나다물류 킥오프 · 대면 · 고객사"], "문구");
});

Deno.test("미팅 알림: 수주 미팅(KST 변환), 1시간 리드, 반복·건너뛴 회차", () => {
  const s = base();
  eq(keys(planNotifications(s, at("2026-11-03", "10:30"))).filter((k) => k.startsWith("m:w:")), ["m:w:w1@2026-11-03@30:m2"], "수주 미팅 11:00 KST");
  eq(keys(planNotifications(s, at("2026-11-09", "09:00"))).filter((k) => k.startsWith("m:e2")), ["m:e2@2026-11-09@60:m3"], "반복 회차 1시간 전(정규만)");
  eq(keys(planNotifications(s, at("2026-11-16", "09:30"))).filter((k) => k.startsWith("m:e2")), [], "건너뛴 회차");
});

Deno.test("미팅 알림: 연차인 날은 보내지 않음", () => {
  const s = base(); s.leaves = [{ member_id: M1, from_date: "2026-11-03", to_date: "2026-11-03", kind: "off" }];
  eq(keys(planNotifications(s, at("2026-11-03", "13:30"))).filter((k) => k.startsWith("m:e1")), ["m:e1@2026-11-03@30:m2"], "김동욱 연차");
});

Deno.test("아침 브리핑: 평일 08:30~10:00, 근무지·일정·팀 부재", () => {
  const s = base();
  s.leaves = [{ member_id: M3, from_date: "2026-11-03", to_date: "2026-11-03", kind: "off" }];
  eq(planNotifications(s, at("2026-11-03", "08:29")).notes.filter((n) => n.kind === "brief").length, 0, "08:29 전");
  const r = planNotifications(s, at("2026-11-03", "08:30")).notes.filter((n) => n.kind === "brief");
  eq(r.map((n) => n.member).sort(), [M1, M2], "브리핑 켠 사람만(심정규는 끔)");
  const me = r.find((n) => n.member === M2)!;
  eq(me.title, "☀️ 11/3 (화) 오늘 일정", "제목");
  eq(me.body, "근무지: 외근 (가나다물류 킥오프)\n일정 3건: 종일 제안서 마감, 11:00 호텔 QR 앱, 14:00 가나다물류 킥오프\n팀: 김동욱 외근 (가나다물류 킥오프), 심정규 연차", "본문(대면 미팅 자동 외근)");
  eq(planNotifications(s, at("2026-11-07", "08:30")).notes.filter((n) => n.kind === "brief").length, 0, "토요일");
  eq(planNotifications(s, at("2026-12-25", "08:30")).notes.filter((n) => n.kind === "brief").length, 0, "공휴일");
});

Deno.test("아침 브리핑: 직접 고른 근무지·반차·팀 근무지 예외·적용 시작일", () => {
  const s = base();
  s.teamOverrides = [{ work_date: "2026-11-04", loc: "other", branch: "패스트파이브 강남 3호점", note: null }];
  s.memberOverrides = [{ member_id: M1, work_date: "2026-11-04", loc: "home", branch: null }];
  s.leaves = [{ member_id: M2, from_date: "2026-11-04", to_date: "2026-11-04", kind: "pm" }];
  s.routines.push({ valid_from: "2026-11-04", days: { 1: "cityhall", 2: "cityhall", 3: "forest", 4: "cityhall", 5: "cityhall" } });
  const r = planNotifications(s, at("2026-11-04", "08:31")).notes.filter((n) => n.kind === "brief");
  eq(r.find((n) => n.member === M1)!.body.split("\n")[0], "근무지: 재택근무", "개인 재택");
  eq(r.find((n) => n.member === M2)!.body.split("\n")[0], "근무지: 오후반차 · 패스트파이브 강남 3호점", "반차 + 하루 예외가 패턴보다 우선");
  s.teamOverrides = [];
  eq(planNotifications(s, at("2026-11-04", "08:31")).notes.find((n) => n.member === M2 && n.kind === "brief")!.body.split("\n")[0], "근무지: 오후반차 · 패스트파이브 서울숲", "11/4부터 수요일 패턴");
  eq(planNotifications(s, at("2026-10-28", "08:31")).notes.find((n) => n.member === M2 && n.kind === "brief")!.body.split("\n")[0], "근무지: 재택근무", "과거 수요일은 예전 패턴");
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
