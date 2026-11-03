// 알림 계획 테스트 — deno test supabase/functions/calendar-push/plan.test.ts
// 2026-11-03 재작성: 오후 4시 안내·팀원 변동·묶기(지웠다 되돌림 생략)·나누기 짝(시각 기준)·문구 정리 반영
import { planNotifications, type Snapshot } from "./plan.ts";

const eq = (a: unknown, b: unknown, msg: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}\n  실제: ${JSON.stringify(a)}\n  기대: ${JSON.stringify(b)}`); };
const at = (k: string, hm: string) => Date.parse(`${k}T${hm}:00+09:00`);
const iso = (k: string, hms: string) => new Date(`${k}T${hms}+09:00`).toISOString();

const M1 = "m1", M2 = "m2", M3 = "m3";
const base = (): Snapshot => ({
  members: [{ id: M1, name: "김동욱", user_id: "u1" }, { id: M2, name: "최기용", user_id: "u2" }, { id: M3, name: "심정규", user_id: "u3" }],
  subs: [
    { id: "s1", member_id: M1, morning_brief: true, change_alerts: true },
    { id: "s2", member_id: M2, morning_brief: true, change_alerts: true },
    { id: "s2b", member_id: M2, morning_brief: false, change_alerts: false },
    { id: "s3", member_id: M3, morning_brief: false, change_alerts: true },
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
const brief = (s: Snapshot, d: string, t = "16:00") => planNotifications(s, at(d, t)).notes.filter((n) => n.kind === "brief");
const change = (s: Snapshot, d: string, t = "10:00") => planNotifications(s, at(d, t)).notes.filter((n) => n.kind === "change");
const tb = (n: { title: string; body: string }) => [n.title, n.body];
const empty = (s: Snapshot) => { s.events = []; s.wishket = []; return s; };

// ───────── 다음 근무일 안내 ─────────
Deno.test("안내: 미팅 시작 전 알림은 없음 (사용자 결정)", () => {
  const s = base();
  for (const t of ["13:30", "13:50", "10:30"]) eq(planNotifications(s, at("2026-11-03", t)).notes.length, 0, `미팅 알림 없음 ${t}`);
});

Deno.test("안내: 근무일 16:00~17:30 첫 실행, 다음 근무일 기준, 켠 사람만", () => {
  const s = base();
  s.leaves = [{ id: "l3", member_id: M3, from_date: "2026-11-03", to_date: "2026-11-03", kind: "off" }];
  eq(brief(s, "2026-11-02", "15:59").length, 0, "15:59 전");
  eq(brief(s, "2026-11-02", "17:30").length, 0, "17:30 이후");
  eq(brief(s, "2026-11-02", "17:25").length, 2, "17:25 도 구간 안");
  const r = brief(s, "2026-11-02");
  eq(r.map((n) => n.member).sort(), [M1, M2], "켠 사람만(심정규 꺼짐)");
  const me = r.find((n) => n.member === M2)!;
  eq([me.key, ...tb(me)], ["e:2026-11-03:m2", "🚕 내일 14:00 외근 (가나다물류 킥오프) · 11/3 (화)",
    "일정: 종일 제안서 마감, 11:00 호텔 QR 앱, 14:00 가나다물류 킥오프\n팀원: 김동욱 14:00 외근 (가나다물류 킥오프), 심정규 연차"], "제목에 내 근무지, 본문엔 제목에 없는 것만");
});

Deno.test("안내: 금요일 → 월요일, 공휴일 전날 → 그다음 평일, 쉬는 날엔 없음", () => {
  const s = base();
  s.events.push({ id: "e5", type: "internal", title: "월요 점검", event_date: "2026-11-09", start_time: "09:30:00", all_day: false, people: [M1], exdates: [] });
  eq(brief(s, "2026-11-06").filter((n) => n.member === M1).map((n) => [n.key, n.title]), [["e:2026-11-09:m1", "📅 다음 근무일 11/9 (월)"]], "금요일 → 월요일");
  eq(brief(s, "2026-11-07").length, 0, "토요일엔 없음");
  s.holidays["2026-11-10"] = "임시공휴일";
  s.events.push({ id: "e6", type: "internal", title: "수요 점검", event_date: "2026-11-11", start_time: "09:30:00", all_day: false, people: [M1], exdates: [] });
  eq(brief(s, "2026-11-09").filter((n) => n.member === M1).map((n) => n.key), ["e:2026-11-11:m1"], "공휴일 전날 → 그다음 평일");
});

Deno.test("안내: 평소와 같은 날은 없음, 팀 근무지·내 근무지·반차 변화는 제목에", () => {
  const s = empty(base());
  eq(brief(s, "2026-11-03").length, 0, "패턴대로·일정 없음·팀 정상");
  s.teamOverrides = [{ work_date: "2026-11-04", loc: "other", branch: "패스트파이브 강남 3호점", note: "시청역 공사" }];
  eq(tb(brief(s, "2026-11-03").find((n) => n.member === M1)!), ["🏢 내일 강남 3호점 · 11/4 (수)", "팀 전체 강남 3호점 · 시청역 공사"], "팀 근무지 하루 예외 — 팀 전체임을 본문에");
  s.teamOverrides = []; s.memberOverrides = [{ member_id: M1, work_date: "2026-11-05", loc: "home", branch: null }];
  eq(tb(brief(s, "2026-11-04").find((n) => n.member === M1)!), ["🏠 내일 재택 · 11/5 (목)", ""], "개인 재택 — 제목으로 충분, 본문 없음");
  s.memberOverrides = []; s.leaves = [{ id: "l2", member_id: M2, from_date: "2026-11-05", to_date: "2026-11-05", kind: "pm" }];
  eq(brief(s, "2026-11-04").find((n) => n.member === M2)!.title, "🌓 내일 오후반차 · 시청역2호점 · 11/5 (목)", "반차");
  s.leaves = []; s.routines.push({ valid_from: "2026-11-05", days: { 1: "cityhall", 2: "cityhall", 3: "home", 4: "forest", 5: "cityhall" } });
  eq(tb(brief(s, "2026-11-04").find((n) => n.member === M1)!), ["🏢 내일 서울숲 · 11/5 (목)", "팀 전체 서울숲"], "새 패턴이 시작되는 날");
  eq(brief(s, "2026-10-27").length, 0, "과거(예전 패턴, 평소와 같음) → 없음");
});

Deno.test("안내: 팀원만 평소와 다르면 모두에게 — 제목에 그 팀원, 한 명뿐이면 본문 생략", () => {
  const s = empty(base());
  s.memberOverrides = [{ member_id: M1, work_date: "2026-11-04", loc: "out", branch: null }];
  eq(tb(brief(s, "2026-11-03").find((n) => n.member === M2)!), ["👥 내일 김동욱 외근 · 11/4 (수)", ""], "한 명");
  s.memberOverrides.push({ member_id: M3, work_date: "2026-11-04", loc: "forest", branch: null });
  eq(tb(brief(s, "2026-11-03").find((n) => n.member === M2)!), ["👥 내일 김동욱 외근 외 1명 · 11/4 (수)", "팀원: 김동욱 외근, 심정규 서울숲"], "여러 명");
  s.events = [{ id: "e9", type: "internal", title: "회고", event_date: "2026-11-04", start_time: "16:00:00", all_day: false, people: [M2], exdates: [] }];
  eq(tb(brief(s, "2026-11-03").find((n) => n.member === M2)!), ["📅 내일 11/4 (수)", "일정: 16:00 회고\n팀원: 김동욱 외근, 심정규 서울숲"], "내 일정이 있으면 📅");
});

Deno.test("안내: 이어지는 상태(같은 휴가·연속 재택)는 그것만으로 안 보냄, 따로 등록한 휴가는 새 소식", () => {
  const s = empty(base());
  s.subs.push({ id: "s3b", member_id: M3, morning_brief: true, change_alerts: true });
  s.leaves = [{ id: "L", member_id: M2, from_date: "2026-11-04", to_date: "2026-11-10", kind: "off" }];
  eq(brief(s, "2026-11-03").map((n) => n.title), ["👥 내일 최기용 연차 · 11/4 (수)", "👥 내일 최기용 연차 · 11/4 (수)"], "시작 전날엔 알림");
  for (const d of ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09"]) eq(brief(s, d).length, 0, `${d} 이어지는 휴가 → 없음`);
  s.events = [{ id: "e9", type: "internal", title: "회고", event_date: "2026-11-05", start_time: "16:00:00", all_day: false, people: [M1], exdates: [] }];
  eq(brief(s, "2026-11-04").find((n) => n.member === M1)!.body, "일정: 16:00 회고\n팀원: 최기용 연차", "다른 이유로 보낼 땐 본문에 그대로");
  s.events = [];
  s.leaves = [{ id: "F", member_id: M2, from_date: "2026-11-06", to_date: "2026-11-06", kind: "off" }, { id: "M", member_id: M2, from_date: "2026-11-09", to_date: "2026-11-09", kind: "off" }];
  eq(brief(s, "2026-11-06").map((n) => n.title), ["👥 다음 근무일 최기용 연차 · 11/9 (월)", "👥 다음 근무일 최기용 연차 · 11/9 (월)"], "금·월 따로 등록한 휴가 → 월요일도 알림");
});

// ───────── 변경 알림: 시간 규칙·묶기 ─────────
Deno.test("변경: 밤 22:00~07:30 은 보류(처리 위치 그대로), 아침에 '오늘' 기준으로", () => {
  const s = base();
  s.teamOverrides = [{ work_date: "2026-11-03", loc: "forest", branch: null, note: null }];
  s.audit = [{ id: 31, at: iso("2026-11-02", "21:59:00"), table_name: "team_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { work_date: "2026-11-03", loc: "forest" } }];
  for (const [d, t] of [["2026-11-02", "22:00"], ["2026-11-02", "23:30"], ["2026-11-03", "07:29"]]) {
    const r = planNotifications(s, at(d, t)); eq([r.notes.filter((n) => n.kind === "change").length, r.cursor], [0, null], `조용한 시간 ${d} ${t}`);
  }
  const m = planNotifications(s, at("2026-11-03", "07:30"));
  eq([m.notes.find((n) => n.kind === "change")!.title, m.cursor], ["🏢 오늘 팀 근무지 서울숲", 31], "아침 07:30");
});

Deno.test("변경: 같은 대상을 한 실행 안에서 여러 번 — 마지막만, 지웠다 되돌리면 없음", () => {
  const s = base();
  const ev = { id: "e9", type: "meeting", title: "디자인 협의", event_date: "2026-11-05", start_time: "11:00:00", all_day: false, people: [M2, M3], exdates: [], deleted_at: null };
  s.audit = [
    { id: 21, at: iso("2026-11-02", "14:00:00"), table_name: "calendar_events", op: "UPDATE", actor_id: "u1", before: ev, after: { ...ev, deleted_at: "x" } },
    { id: 22, at: iso("2026-11-02", "14:00:05"), table_name: "calendar_events", op: "UPDATE", actor_id: "u1", before: { ...ev, deleted_at: "x" }, after: ev },
  ];
  eq(change(s, "2026-11-02", "15:00").length, 0, "일정 삭제 → 되돌림");
  const lv = { id: "L1", member_id: M3, from_date: "2026-11-04", to_date: "2026-11-04", kind: "off", note: null, deleted_at: null };
  s.audit = [
    { id: 23, at: iso("2026-11-03", "09:00:00"), table_name: "team_leaves", op: "UPDATE", actor_id: "u3", before: lv, after: { ...lv, deleted_at: "x" } },
    { id: 24, at: iso("2026-11-03", "09:00:04"), table_name: "team_leaves", op: "UPDATE", actor_id: "u3", before: { ...lv, deleted_at: "x" }, after: lv },
  ];
  eq(change(s, "2026-11-03").length, 0, "휴가 삭제 → 되돌림");
  s.audit = [
    { id: 25, at: iso("2026-11-03", "09:00:00"), table_name: "team_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { work_date: "2026-11-04", loc: "forest" } },
    { id: 26, at: iso("2026-11-03", "09:00:30"), table_name: "team_work_overrides", op: "DELETE", actor_id: "u1", before: { work_date: "2026-11-04", loc: "forest" }, after: null },
  ];
  eq(change(s, "2026-11-03").length, 0, "팀 근무지 지정 → 해제");
  s.audit = [
    { id: 27, at: iso("2026-11-02", "14:00:00"), table_name: "calendar_events", op: "INSERT", actor_id: "u1", before: null, after: ev },
    { id: 28, at: iso("2026-11-02", "14:01:00"), table_name: "calendar_events", op: "UPDATE", actor_id: "u1", before: ev, after: { ...ev, start_time: "15:00:00" } },
  ];
  eq(change(s, "2026-11-02", "15:00").map((n) => [n.member, ...tb(n)]), [["m2", "➕ 디자인 협의 추가", "11/5 (목) 15:00 · 김동욱 추가"], ["m3", "➕ 디자인 협의 추가", "11/5 (목) 15:00 · 김동욱 추가"]], "추가 후 수정 → 최종 상태로 '추가' 한 건");
});

// ───────── 변경 알림: 근무지 ─────────
Deno.test("변경: 팀 근무지 — 오늘~다음 근무일, 바꾼 사람 제외, 원래대로", () => {
  const s = base();
  s.teamOverrides = [{ work_date: "2026-11-03", loc: "forest", branch: null, note: "킥오프" }];
  s.audit = [
    { id: 11, at: "", table_name: "team_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { work_date: "2026-11-03", loc: "forest", note: "킥오프" } },
    { id: 12, at: "", table_name: "team_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { work_date: "2026-11-20", loc: "home" } },
  ];
  const r = planNotifications(s, at("2026-11-02", "15:00"));
  eq(r.notes.filter((n) => n.kind === "change").map((n) => n.key).sort(), ["c:11:m2", "c:11:m3"], "김동욱 제외, 11/20 범위 밖");
  eq(tb(r.notes.find((x) => x.key === "c:11:m2")!), ["🏢 내일 팀 근무지 서울숲", "11/3 (화) · 킥오프 · 김동욱 변경"], "문구");
  eq(r.cursor, 12, "처리 위치 전진");
  s.teamOverrides = [];
  s.audit = [{ id: 13, at: "", table_name: "team_work_overrides", op: "DELETE", actor_id: "u1", before: { work_date: "2026-11-03", loc: "forest" }, after: null }];
  eq(tb(change(s, "2026-11-02", "15:00")[0]), ["🏢 내일 팀 근무지 시청역2호점", "11/3 (화) · 원래 근무지로 · 김동욱 변경"], "해제");
});

Deno.test("변경: 팀 근무지 — 금요일 오후 이후 월요일 변경도 (다음 근무일까지)", () => {
  const s = base();
  s.teamOverrides = [{ work_date: "2026-11-09", loc: "home", branch: null, note: null }];
  s.audit = [
    { id: 21, at: "", table_name: "team_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { work_date: "2026-11-09", loc: "home" } },
    { id: 22, at: "", table_name: "team_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { work_date: "2026-11-10", loc: "forest" } },
  ];
  eq(change(s, "2026-11-06", "17:10").map((n) => n.key).sort(), ["c:21:m2", "c:21:m3"], "월요일만");
  eq(change(s, "2026-11-06", "17:10")[0].title, "🏢 11/9 (월) 팀 근무지 재택", "제목");
  s.holidays["2026-11-09"] = "임시공휴일"; s.teamOverrides = [{ work_date: "2026-11-10", loc: "forest", branch: null, note: null }];
  eq(change(s, "2026-11-06", "17:10").map((n) => n.key).sort(), ["c:22:m2", "c:22:m3"], "월요일 공휴일이면 화요일");
});

Deno.test("변경: 팀원 개인 근무지 — 전원(바꾼 사람 제외), 남이 바꾸면 당사자도, 원래대로, 범위·밤", () => {
  const s = empty(base());
  s.memberOverrides = [{ member_id: M1, work_date: "2026-11-04", loc: "home", branch: null }];
  s.audit = [{ id: 31, at: "", table_name: "member_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { member_id: M1, work_date: "2026-11-04", loc: "home", branch: null, note: "집중 작업" } }];
  const r = change(s, "2026-11-03", "17:40");
  eq(r.map((n) => n.key).sort(), ["c:31:m2", "c:31:m3"], "본인 제외 전원");
  eq([...tb(r[0]), r[0].tag], ["🏠 김동욱 내일 재택", "11/4 (수) · 집중 작업", "who:m1:2026-11-04"], "문구 — 본인이 바꿨으면 '누가 변경' 생략");
  s.audit = [{ id: 32, at: "", table_name: "member_work_overrides", op: "INSERT", actor_id: "u2", before: null, after: { member_id: M1, work_date: "2026-11-04", loc: "home", branch: null } }];
  const o = change(s, "2026-11-03", "17:40");
  eq(o.map((n) => n.member).sort(), [M1, M3], "남이 바꾸면 당사자도");
  eq(o[0].body, "11/4 (수) · 최기용 변경", "바꾼 사람 표시");
  s.memberOverrides = [];
  s.audit = [
    { id: 33, at: "", table_name: "member_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { member_id: M1, work_date: "2026-11-04", loc: "out", branch: null } },
    { id: 34, at: "", table_name: "member_work_overrides", op: "DELETE", actor_id: "u1", before: { member_id: M1, work_date: "2026-11-04", loc: "out", branch: null }, after: null },
  ];
  eq(change(s, "2026-11-03", "17:40").length, 0, "바꿨다 되돌림");
  s.audit = [{ id: 35, at: "", table_name: "member_work_overrides", op: "DELETE", actor_id: "u1", before: { member_id: M1, work_date: "2026-11-04", loc: "out", branch: null }, after: null }];
  eq(tb(change(s, "2026-11-03", "17:40")[0]), ["🏠 김동욱 내일 재택", "11/4 (수) · 원래 근무지로"], "해제 → 원래대로(수요일 팀 재택)");
  s.events = [{ id: "e7", type: "meeting", title: "고객사 킥오프", event_date: "2026-11-04", start_time: "14:00:00", all_day: false, meeting_type: "inperson", people: [M1], auto_out: true, exdates: [] }];
  eq(tb(change(s, "2026-11-03", "17:40")[0]), ["🚕 김동욱 내일 14:00 외근 (고객사 킥오프)", "11/4 (수) · 원래 근무지로"], "해제했는데 대면 미팅이 있으면 그 외근이 '원래'");
  s.events = [];
  s.audit = [{ id: 36, at: "", table_name: "member_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { member_id: M1, work_date: "2026-11-10", loc: "home", branch: null } }];
  eq(change(s, "2026-11-03", "17:40").length, 0, "범위 밖");
  s.audit = [{ id: 37, at: "", table_name: "member_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { member_id: M1, work_date: "2026-11-04", loc: "home", branch: null } }];
  eq(change(s, "2026-11-03", "23:00").length, 0, "밤에는 보류");
});

Deno.test("변경: 휴가 — 등록·취소·날짜/종류 변경·대상자 변경, 사유만 수정 생략", () => {
  const s = empty(base());
  const lv = { id: "l1", member_id: M3, from_date: "2026-11-04", to_date: "2026-11-05", kind: "off", note: null, deleted_at: null };
  const one = (a: Record<string, unknown>) => { s.audit = [{ id: 41, at: "", table_name: "team_leaves", actor_id: "u3", ...a }]; return change(s, "2026-11-03"); };
  let r = one({ op: "INSERT", before: null, after: lv });
  eq(r.map((n) => n.member).sort(), [M1, M2], "본인 제외 전원");
  eq(tb(r[0]), ["🌴 심정규 연차 등록", "11/4 (수)–11/5 (목)"], "등록 — 본인이 등록했으면 '누가' 생략");
  eq(one({ op: "UPDATE", before: lv, after: { ...lv, note: "가족 행사" } }).length, 0, "사유만 수정");
  eq(tb(one({ op: "UPDATE", before: lv, after: { ...lv, deleted_at: "x" } })[0]), ["🌴 심정규 연차 취소", "11/4 (수)–11/5 (목)"], "취소");
  eq(one({ op: "INSERT", before: null, after: { ...lv, from_date: "2026-11-20", to_date: "2026-11-21" } }).length, 0, "먼 휴가는 전날 안내에서");
  eq(tb(one({ op: "UPDATE", before: lv, after: { ...lv, from_date: "2026-11-20", to_date: "2026-11-21" } })[0]), ["🌴 심정규 연차 변경", "11/4 (수)–11/5 (목) → 11/20 (금)–11/21 (토)"], "가까운 휴가를 먼 날로");
  eq(tb(one({ op: "UPDATE", before: lv, after: { ...lv, kind: "pm" } })[0]), ["🌴 심정규 오후반차 변경", "연차 → 오후반차"], "종류 변경");
  r = one({ op: "UPDATE", before: lv, after: { ...lv, member_id: M2 } });
  eq(r.map((n) => `${n.member}|${n.title}`).sort(), ["m1|🌴 심정규 연차 취소", "m1|🌴 최기용 연차 등록", "m2|🌴 심정규 연차 취소", "m2|🌴 최기용 연차 등록"], "대상자 변경 → 원래 사람 취소 + 새 사람 등록");
});

Deno.test("변경: 대면 미팅 외근 — 비참석자에게 근무지 알림, 취소 시 해제, 예외들", () => {
  const s = base(); s.wishket = [];
  const ev = { id: "e7", type: "meeting", title: "고객사 킥오프", event_date: "2026-11-05", start_time: "14:00:00", end_time: "15:00:00", all_day: false, meeting_type: "inperson", people: [M1, M2], auto_out: true, exdates: [], deleted_at: null };
  s.events = [ev];
  s.audit = [{ id: 51, at: "", table_name: "calendar_events", op: "INSERT", actor_id: "u1", before: null, after: ev }];
  let r = change(s, "2026-11-04", "17:40");
  eq(r.map((n) => `${n.member}|${n.title}`).sort(), ["m2|➕ 고객사 킥오프 추가", "m3|🚕 김동욱 내일 14:00 외근 (고객사 킥오프)", "m3|🚕 최기용 내일 14:00 외근 (고객사 킥오프)"], "참석자는 일정, 비참석자는 근무지");
  eq(r.find((n) => n.key === "c:51:m3:m1:2026-11-05")!.body, "11/5 (목) · 대면 미팅 ~15:00", "근무지 알림 본문(본인 등록이라 '누가' 생략)");
  eq(r.find((n) => n.member === M2)!.body, "11/5 (목) 14:00–15:00 · 김동욱 추가", "일정 알림 본문");
  s.events = [];
  s.audit = [{ id: 52, at: "", table_name: "calendar_events", op: "UPDATE", actor_id: "u1", before: ev, after: { ...ev, deleted_at: "x" } }];
  r = change(s, "2026-11-04", "17:40").filter((n) => n.member === M3);
  eq(r.map(tb).sort(), [["🏢 김동욱 내일 시청역2호점", "11/5 (목) · 미팅이 취소·변경돼 외근 해제"], ["🏢 최기용 내일 시청역2호점", "11/5 (목) · 미팅이 취소·변경돼 외근 해제 · 김동욱 변경"]], "외근 해제");
  s.events = [ev]; s.memberOverrides = [{ member_id: M1, work_date: "2026-11-05", loc: "cityhall", branch: null }];
  s.audit = [{ id: 53, at: "", table_name: "calendar_events", op: "INSERT", actor_id: "u2", before: null, after: ev }];
  eq(change(s, "2026-11-04", "17:40").filter((n) => n.member === M3).map((n) => n.title), ["🚕 최기용 내일 14:00 외근 (고객사 킥오프)"], "개인 근무지를 정한 사람 제외");
  s.memberOverrides = []; const vid = { ...ev, id: "e8", meeting_type: "video" }; s.events = [vid];
  s.audit = [{ id: 54, at: "", table_name: "calendar_events", op: "INSERT", actor_id: "u1", before: null, after: vid }];
  eq(change(s, "2026-11-04", "17:40").filter((n) => n.member === M3).length, 0, "화상 미팅");
  const far = { ...ev, id: "e9", event_date: "2026-11-10" }; s.events = [far];
  s.audit = [{ id: 55, at: "", table_name: "calendar_events", op: "INSERT", actor_id: "u1", before: null, after: far }];
  eq(change(s, "2026-11-04", "17:40").filter((n) => n.member === M3).length, 0, "다음 근무일 뒤");
});

Deno.test("변경: 위시켓 대면 미팅 — 바꾼 사람 뺀 전원(담당자 포함), 무관한 수정 무시", () => {
  const s = base(); s.events = [];
  const w0 = { slug: "w9", title: "창호 견적", meeting_at: null, meeting_type: "video", assigned_main: M2, assigned_sub: null, current_status: "applied" };
  const w1 = { ...w0, meeting_at: "2026-11-05T05:00:00Z", meeting_type: "inperson", current_status: "interview" };
  s.wishket = [w1];
  s.audit = [{ id: 71, at: "", table_name: "wishket_projects", op: "UPDATE", actor_id: "u1", before: w0, after: w1 }];
  const r = change(s, "2026-11-04", "17:40");
  eq(r.map((n) => `${n.member}|${n.title}`).sort(), ["m2|🚕 최기용 내일 14:00 외근 (창호 견적)", "m3|🚕 최기용 내일 14:00 외근 (창호 견적)"], "담당자 포함");
  eq(r[0].body, "11/5 (목) · 수주 미팅 · 김동욱 변경", "본문");
  s.audit = [{ id: 72, at: "", table_name: "wishket_projects", op: "UPDATE", actor_id: "u1", before: w1, after: { ...w1, title: "창호 견적 시스템" } }];
  eq(change(s, "2026-11-04", "17:40").length, 0, "무관한 수정");
});

Deno.test("변경: 주간 패턴 — 같은 내용·지난 패턴 생략, 바뀐 요일만 본문에", () => {
  const s = empty(base());
  const same = { valid_from: "2026-11-05", days: { 1: "cityhall", 2: "cityhall", 3: "home", 4: "cityhall", 5: "cityhall" } };
  s.routines.push(same);
  eq(brief(s, "2026-11-04").length, 0, "같은 내용 → 안내 없음");
  s.audit = [{ id: 81, at: "", table_name: "team_work_routines", op: "INSERT", actor_id: "u1", before: null, after: same }];
  eq(change(s, "2026-11-04").length, 0, "같은 내용 → 변경 알림 없음");
  s.routines = [base().routines[0], { valid_from: "2026-09-01", days: { 1: "home", 2: "cityhall", 3: "home", 4: "cityhall", 5: "cityhall" } }, { valid_from: "2026-10-01", days: base().routines[0].days }];
  s.audit = [{ id: 82, at: "", table_name: "team_work_routines", op: "UPDATE", actor_id: "u1", before: {}, after: s.routines[1] }];
  eq(change(s, "2026-11-04").length, 0, "쓰이지 않는 지난 패턴");
  s.routines = [base().routines[0], { valid_from: "2026-11-05", days: { 1: "cityhall", 2: "cityhall", 3: "home", 4: "home", 5: "cityhall" } }];
  s.audit = [{ id: 83, at: "", table_name: "team_work_routines", op: "INSERT", actor_id: "u1", before: null, after: s.routines[1] }];
  eq(tb(change(s, "2026-11-04")[0]), ["🗓 11/5 (목)부터 주간 근무 패턴 변경", "목 재택 · 김동욱 변경"], "바뀐 요일만");
  s.audit = [];
  eq(brief(s, "2026-11-04").find((n) => n.member === M2)!.title, "🏠 내일 재택 · 11/5 (목)", "안내");
});

// ───────── 변경 알림: 일정 ─────────
Deno.test("변경: 일정 추가·수정·취소·참석 변경 — 참석자에게, 바뀐 것만 본문에", () => {
  const s = base();
  const ev = { id: "e9", type: "meeting", title: "디자인 협의", event_date: "2026-11-05", start_time: "11:00:00", all_day: false, people: [M2, M3], exdates: [], deleted_at: null };
  const one = (a: Record<string, unknown>, d = "2026-11-02", t = "15:00") => { s.audit = [{ id: 61, at: "", table_name: "calendar_events", ...a }]; return change(s, d, t); };
  eq(one({ op: "INSERT", actor_id: "u2", before: null, after: ev }).map((n) => [n.member, ...tb(n)]), [["m3", "➕ 디자인 협의 추가", "11/5 (목) 11:00 · 최기용 추가"]], "추가 — 본인 제외");
  eq(one({ op: "UPDATE", actor_id: "u2", before: ev, after: { ...ev, note: "안건 추가" } }).length, 0, "메모만 수정");
  eq(one({ op: "UPDATE", actor_id: "u1", before: ev, after: { ...ev, start_time: "15:00:00" } }).map((n) => tb(n)[1]), ["11/5 (목) · 시간 11:00 → 15:00 · 김동욱 변경", "11/5 (목) · 시간 11:00 → 15:00 · 김동욱 변경"], "시간 변경 — 바뀐 값을 앞에서 반복하지 않음");
  eq(one({ op: "UPDATE", actor_id: "u2", before: ev, after: { ...ev, deleted_at: "x" } }).map((n) => [n.member, n.title]), [["m3", "✖️ 디자인 협의 취소"]], "취소");
  const p = one({ op: "UPDATE", actor_id: "u1", before: ev, after: { ...ev, people: [M2, M1] } });
  eq(p.map((n) => `${n.member}|${n.title}`).sort(), ["m2|✏️ 디자인 협의 변경", "m3|✖️ 디자인 협의 참석 빠짐"], "참석 변경 — 빠진 사람은 '참석 빠짐'");
  eq(one({ op: "INSERT", actor_id: "u2", before: null, after: { ...ev, id: "e10", event_date: "2026-12-01" } }).length, 0, "먼 일정");
  eq(one({ op: "INSERT", actor_id: "u2", before: null, after: { ...ev, people: [] } }).length, 0, "참석자 없는 일정은 받을 사람 없음");
});

Deno.test("변경: 일정을 7일 밖으로 옮김 — 옛 날짜 기준으로 '날짜 a → b'", () => {
  const s = base();
  const ev = { id: "e9", type: "meeting", title: "디자인 협의", event_date: "2026-11-05", start_time: "11:00:00", all_day: false, people: [M2, M3], exdates: [], deleted_at: null };
  s.audit = [{ id: 62, at: "", table_name: "calendar_events", op: "UPDATE", actor_id: "u1", before: ev, after: { ...ev, event_date: "2026-11-20", start_time: "15:00:00" } }];
  eq(tb(change(s, "2026-11-02", "15:00")[0]), ["✏️ 디자인 협의 변경", "날짜 11/5 (목) → 11/20 (금), 시간 11:00 → 15:00 · 김동욱 변경"], "이동");
});

Deno.test("변경: 반복 일정 — 나누기(시각 기준 짝)·한 회차 삭제/되돌림·반복 전체 삭제", () => {
  const s = base();
  const rep = s.events.find((e) => e.id === "e2")!;   // 주간 회의 월 10:00, M1·M2·M3
  const child = { id: "e2c", type: "internal", title: "주간 회의", event_date: "2026-11-09", start_time: "15:00:00", all_day: false, people: [M1, M3], parent_id: "e2", exdates: [], created_at: iso("2026-11-04", "14:00:00") };
  s.events.push(child);
  const pair = [
    { id: 41, at: iso("2026-11-04", "14:00:00"), table_name: "calendar_events", op: "INSERT", actor_id: "u1", before: null, after: child },
    { id: 47, at: iso("2026-11-04", "14:00:01"), table_name: "calendar_events", op: "UPDATE", actor_id: "u1", before: rep, after: { ...rep, exdates: [...rep.exdates, "2026-11-09"] } },
  ];
  // 사이에 위시켓 기록 5건이 끼어도(감사 번호 차이 6) 짝으로 묶는다
  s.audit = [pair[0], ...[42, 43, 44, 45, 46].map((id) => ({ id, at: iso("2026-11-04", "14:00:00"), table_name: "wishket_projects", op: "UPDATE", actor_id: null, before: { slug: "x" + id }, after: { slug: "x" + id } })), pair[1]];
  const c = change(s, "2026-11-04", "15:00");
  eq(c.map((n) => `${n.member}|${n.title}`).sort(), ["m2|✏️ 주간 회의 변경", "m3|✏️ 주간 회의 변경"], "한 건만 '변경', 취소 없음 — 빠진 최기용에게도");
  eq(c[0].body, "11/9 (월) · 시간 10:00 → 15:00, 참석 −최기용 · 이 회차만 · 김동욱 변경", "문구");
  // 짝의 원래 반복 쪽 갱신이 다음 실행으로 넘어간 경우(새 일정은 이미 처리됨) → 취소로 보내지 않음
  s.audit = [pair[1]];
  eq(change(s, "2026-11-04", "15:05").length, 0, "다음 실행의 원래 반복 갱신은 건너뜀");
  // 한 회차 삭제·되돌림(따로 실행)
  const s2 = base(); const rep2 = s2.events.find((e) => e.id === "e2")!;
  s2.audit = [{ id: 51, at: "", table_name: "calendar_events", op: "UPDATE", actor_id: "u1", before: rep2, after: { ...rep2, exdates: [...rep2.exdates, "2026-11-09"] } }];
  eq(tb(change(s2, "2026-11-04", "15:00").find((n) => n.member === M2)!), ["✖️ 주간 회의 취소", "11/9 (월) 10:00 · 이 회차만 · 김동욱 취소"], "한 회차 삭제");
  s2.audit = [{ id: 52, at: "", table_name: "calendar_events", op: "UPDATE", actor_id: "u1", before: { ...rep2, exdates: [...rep2.exdates, "2026-11-09"] }, after: rep2 }];
  eq(change(s2, "2026-11-04", "15:00").find((n) => n.member === M2)!.title, "➕ 주간 회의 추가", "되돌림");
  s2.audit = [{ id: 53, at: "", table_name: "calendar_events", op: "UPDATE", actor_id: "u1", before: rep2, after: { ...rep2, exdates: [...rep2.exdates, "2026-11-30"] } }];
  eq(change(s2, "2026-11-04", "15:00").length, 0, "8일 뒤 회차 삭제");
  // 반복 전체 삭제 → 지난 회차 날짜가 아니라 '매주 … 반복 전체'
  s2.audit = [{ id: 54, at: "", table_name: "calendar_events", op: "UPDATE", actor_id: "u1", before: rep2, after: { ...rep2, deleted_at: "x" } }];
  eq(tb(change(s2, "2026-11-02", "17:00").find((n) => n.member === M2)!), ["✖️ 주간 회의 취소", "매주 월 10:00 · 반복 전체 · 김동욱 취소"], "반복 전체 삭제");
});

Deno.test("구독이 없는 사람에게는 계획하지 않음", () => {
  const s = base(); s.subs = [];
  eq(planNotifications(s, at("2026-11-03", "16:00")).notes.length, 0, "구독 없음");
});

Deno.test("대면 미팅 외근: 시간 있는 미팅은 그 시각부터(가장 이른 것), 종일 미팅은 하루 전체", () => {
  const s = empty(base());
  const mk = (id: string, start: string | null, title: string) => ({ id, type: "meeting", title, event_date: "2026-11-04", start_time: start, all_day: !start, meeting_type: "inperson", people: [M1], auto_out: true, exdates: [] });
  s.events = [mk("a", "16:00:00", "B사 미팅"), mk("b", "14:00:00", "A사 미팅")];
  eq(brief(s, "2026-11-03").find((n) => n.member === M2)!.title, "👥 내일 김동욱 14:00 외근 (A사 미팅) · 11/4 (수)", "가장 이른 시각");
  s.events.push(mk("c", null, "종일 워크숍"));
  eq(brief(s, "2026-11-03").find((n) => n.member === M2)!.title, "👥 내일 김동욱 외근 (종일 워크숍) · 11/4 (수)", "종일이 있으면 하루 전체");
});
