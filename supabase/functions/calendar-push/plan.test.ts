// 알림 계획 테스트 — deno test supabase/functions/calendar-push/plan.test.ts
// 2026-11-03 재작성: 오후 4시 안내·팀원 변동·묶기(지웠다 되돌림 생략)·나누기 짝(시각 기준)·문구 정리 반영
// 2026-11-04: 안내 매일 18:00, 당사자 알림은 날짜 제한 없음, 다른 장소(직접 입력), 팀 근무지 변경은 따르는 사람에게만
import { isStaleSub, planNotifications, pushOutcome, type Snapshot } from "./plan.ts";

const eq = (a: unknown, b: unknown, msg: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}\n  실제: ${JSON.stringify(a)}\n  기대: ${JSON.stringify(b)}`); };
const at = (k: string, hm: string) => Date.parse(`${k}T${hm}:00+09:00`);
const iso = (k: string, hms: string) => new Date(`${k}T${hms}+09:00`).toISOString();

const M1 = "m1", M2 = "m2", M3 = "m3";
const base = (): Snapshot => ({
  members: [{ id: M1, name: "김가람", user_id: "u1" }, { id: M2, name: "이나래", user_id: "u2" }, { id: M3, name: "박다온", user_id: "u3" }],
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
const brief = (s: Snapshot, d: string, t = "18:00") => planNotifications(s, at(d, t)).notes.filter((n) => n.kind === "brief");
const change = (s: Snapshot, d: string, t = "10:00") => planNotifications(s, at(d, t)).notes.filter((n) => n.kind === "change");
const tb = (n: { title: string; body: string }) => [n.title, n.body];
const empty = (s: Snapshot) => { s.events = []; s.wishket = []; return s; };

// ───────── 다음 근무일 안내 ─────────
Deno.test("안내: 미팅 시작 전 알림은 없음 (사용자 결정)", () => {
  const s = base();
  for (const t of ["13:30", "13:50", "10:30"]) eq(planNotifications(s, at("2026-11-03", t)).notes.length, 0, `미팅 알림 없음 ${t}`);
});

Deno.test("안내: 근무일 18:00~19:30 첫 실행, 다음 근무일 기준, 켠 사람만", () => {
  const s = base();
  s.leaves = [{ id: "l3", member_id: M3, from_date: "2026-11-03", to_date: "2026-11-03", kind: "off" }];
  eq(brief(s, "2026-11-02", "17:59").length, 0, "17:59 전");
  eq(brief(s, "2026-11-02", "19:30").length, 0, "19:30 이후");
  eq(brief(s, "2026-11-02", "19:25").length, 2, "19:25 도 구간 안");
  const r = brief(s, "2026-11-02");
  eq(r.map((n) => n.member).sort(), [M1, M2], "켠 사람만(박다온 꺼짐)");
  const me = r.find((n) => n.member === M2)!;
  eq([me.key, ...tb(me)], ["e:2026-11-03:m2", "🏢 내일 시청역2호점 · 14:00 외근 (가나다물류 킥오프) · 11/3 (화)",
    "시청역2호점: 김가람(14:00 외근) · 연차: 박다온\n일정: 종일 제안서 마감, 11:00 호텔 QR 앱, 14:00 가나다물류 킥오프"], "제목에 내 근무지, 본문엔 제목에 없는 것만");
});

Deno.test("안내: 금요일 → 월요일, 공휴일 전날 → 그다음 평일, 쉬는 날엔 없음", () => {
  const s = base();
  s.events.push({ id: "e5", type: "internal", title: "월요 점검", event_date: "2026-11-09", start_time: "09:30:00", all_day: false, people: [M1], exdates: [] });
  eq(brief(s, "2026-11-06").filter((n) => n.member === M1).map((n) => [n.key, ...tb(n)]), [["e:2026-11-09:m1", "🏢 다음 근무일 시청역2호점 · 11/9 (월)", "시청역2호점: 이나래, 박다온\n일정: 09:30 월요 점검, 10:00 주간 회의"]], "금요일 → 월요일");
  eq(brief(s, "2026-11-07").length, 0, "토요일엔 없음");
  s.holidays["2026-11-10"] = "임시공휴일";
  eq(brief(s, "2026-11-09").filter((n) => n.member === M1).map((n) => n.key), ["e:2026-11-11:m1"], "공휴일 전날 → 그다음 평일");
});

Deno.test("안내: 평소와 같은 날도 매일 — 제목에 내가 갈 곳, 팀 근무지 사유·다른 장소·반차", () => {
  const s = empty(base());
  const r = brief(s, "2026-11-03");
  eq(r.map((n) => [n.member, ...tb(n)]), [[M1, "🏠 내일 재택 · 11/4 (수)", "재택: 이나래, 박다온"], [M2, "🏠 내일 재택 · 11/4 (수)", "재택: 김가람, 박다온"]], "패턴대로·일정 없음이어도 보냄 — 팀원 전원 장소별");
  eq(tb(brief(s, "2026-11-04").find((n) => n.member === M1)!), ["🏢 내일 시청역2호점 · 11/5 (목)", "시청역2호점: 이나래, 박다온"], "다음 날도");
  s.teamOverrides = [{ work_date: "2026-11-04", loc: "other", branch: "성수동 가나다빌딩", note: "고객사 워크숍" }];
  eq(tb(brief(s, "2026-11-03").find((n) => n.member === M1)!), ["📍 내일 성수동 가나다빌딩 · 11/4 (수)", "성수동 가나다빌딩: 이나래, 박다온\n고객사 워크숍"], "팀 전체가 미팅 장소로 바로 출근 — 제목에 장소, 본문엔 사유만");
  s.teamOverrides = [{ work_date: "2026-11-04", loc: "forest", branch: null, note: null }];
  s.memberOverrides = [{ member_id: M1, work_date: "2026-11-04", loc: "other", branch: "성수동 가나다빌딩" }];
  eq(tb(brief(s, "2026-11-03").find((n) => n.member === M1)!), ["📍 내일 성수동 가나다빌딩 · 11/4 (수)", "서울숲: 이나래, 박다온\n팀 전체 서울숲"], "나만 미팅 장소로 — 팀 전체가 어디인지");
  eq(tb(brief(s, "2026-11-03").find((n) => n.member === M2)!), ["🏢 내일 서울숲 · 11/4 (수)", "서울숲: 박다온 · 성수동 가나다빌딩: 김가람"], "팀원에게는 장소별 묶음으로 (같은 인원이면 팀 근무지 먼저)");
  s.teamOverrides = []; s.memberOverrides = [{ member_id: M1, work_date: "2026-11-05", loc: "home", branch: null }];
  eq(tb(brief(s, "2026-11-04").find((n) => n.member === M1)!), ["🏠 내일 재택 · 11/5 (목)", "시청역2호점: 이나래, 박다온"], "개인 재택 — 제목으로 충분");
  s.memberOverrides = []; s.leaves = [{ id: "l2", member_id: M2, from_date: "2026-11-05", to_date: "2026-11-05", kind: "pm" }];
  eq(brief(s, "2026-11-04").find((n) => n.member === M2)!.title, "🌓 내일 오후반차 · 시청역2호점 · 11/5 (목)", "반차");
  s.leaves = []; s.routines.push({ valid_from: "2026-11-05", days: { 1: "cityhall", 2: "cityhall", 3: "home", 4: "forest", 5: "cityhall" } });
  eq(tb(brief(s, "2026-11-04").find((n) => n.member === M1)!), ["🏢 내일 서울숲 · 11/5 (목)", "서울숲: 이나래, 박다온"], "새 패턴이 시작되는 날");
});

Deno.test("안내: 본문은 팀원 장소별 묶음 → (사유) → 일정 순 (2026-11-04 — 평소와 같은 사람도 전원)", () => {
  const s = empty(base());
  s.memberOverrides = [{ member_id: M1, work_date: "2026-11-04", loc: "out", branch: null }];
  eq(tb(brief(s, "2026-11-03").find((n) => n.member === M2)!), ["🏠 내일 재택 · 11/4 (수)", "재택: 박다온 · 외근: 김가람"], "한 명");
  s.memberOverrides.push({ member_id: M3, work_date: "2026-11-04", loc: "forest", branch: null });
  eq(brief(s, "2026-11-03").find((n) => n.member === M2)!.body, "외근: 김가람 · 서울숲: 박다온", "여러 명");
  s.events = [{ id: "e9", type: "internal", title: "회고", event_date: "2026-11-04", start_time: "16:00:00", all_day: false, people: [M2], exdates: [] }];
  eq(brief(s, "2026-11-03").find((n) => n.member === M2)!.body, "외근: 김가람 · 서울숲: 박다온\n일정: 16:00 회고", "팀원 먼저, 그다음 일정 (2026-11-04 사용자 결정)");
});

Deno.test("안내: 다음 근무일 종일 휴가인 사람은 받지 않음, 이어지는 휴가는 매일 팀원 줄에", () => {
  const s = empty(base());
  s.subs.push({ id: "s3b", member_id: M3, morning_brief: true, change_alerts: true });
  s.leaves = [{ id: "L", member_id: M2, from_date: "2026-11-04", to_date: "2026-11-10", kind: "off" }];
  eq(brief(s, "2026-11-03").map((n) => [n.member, n.body]), [[M1, "재택: 박다온 · 연차: 이나래"], [M3, "재택: 김가람 · 연차: 이나래"]], "휴가 중인 이나래는 받지 않고, 받는 사람들에겐 '연차: 이나래'");
  eq(brief(s, "2026-11-05").map((n) => n.title), ["🏢 내일 시청역2호점 · 11/6 (금)", "🏢 내일 시청역2호점 · 11/6 (금)"], "휴가 중에도 매일");
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
  eq(change(s, "2026-11-02", "15:00").map((n) => [n.member, ...tb(n)]), [["m2", "➕ 디자인 협의 추가", "11/5 (목) 15:00 · 김가람 추가"], ["m3", "➕ 디자인 협의 추가", "11/5 (목) 15:00 · 김가람 추가"]], "추가 후 수정 → 최종 상태로 '추가' 한 건");
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
  eq(r.notes.filter((n) => n.kind === "change").map((n) => n.key).sort(), ["c:11:m2", "c:11:m3"], "김가람 제외, 11/20 범위 밖");
  eq(tb(r.notes.find((x) => x.key === "c:11:m2")!), ["🏢 내일 팀 근무지 서울숲", "11/3 (화) · 킥오프 · 김가람 변경"], "문구");
  eq(r.cursor, 12, "처리 위치 전진");
  s.teamOverrides = [];
  s.audit = [{ id: 13, at: "", table_name: "team_work_overrides", op: "DELETE", actor_id: "u1", before: { work_date: "2026-11-03", loc: "forest" }, after: null }];
  eq(tb(change(s, "2026-11-02", "15:00")[0]), ["🏢 내일 팀 근무지 시청역2호점", "11/3 (화) · 원래 근무지로 · 김가람 변경"], "해제");
});

Deno.test("안내: 아침에 팀과 같은 곳으로 가면(오후 미팅·반차) '팀 전체 ○○' 없이 사유만", () => {
  const s = empty(base());
  s.teamOverrides = [{ work_date: "2026-11-04", loc: "forest", branch: null, note: "시청역 공사" }];
  s.events = [{ id: "e51", type: "meeting", title: "고객사 미팅", event_date: "2026-11-04", start_time: "14:00:00", all_day: false, meeting_type: "inperson", people: [M1], auto_out: true, exdates: [] }];
  eq(tb(brief(s, "2026-11-03").find((n) => n.member === M1)!), ["🏢 내일 서울숲 · 14:00 외근 (고객사 미팅) · 11/4 (수)", "서울숲: 이나래, 박다온\n시청역 공사\n일정: 14:00 고객사 미팅"], "오후 미팅");
  s.events = []; s.leaves = [{ id: "l51", member_id: M1, from_date: "2026-11-04", to_date: "2026-11-04", kind: "am" }];
  eq(brief(s, "2026-11-03").find((n) => n.member === M1)!.body.split("\n")[1], "시청역 공사", "오전반차");
  s.leaves = []; s.memberOverrides = [{ member_id: M1, work_date: "2026-11-04", loc: "home", branch: null }];
  eq(brief(s, "2026-11-03").find((n) => n.member === M1)!.body.split("\n")[1], "팀 전체 서울숲 · 시청역 공사", "나만 다른 곳이면 팀 전체 위치");
});

Deno.test("변경: 팀 근무지 — 그날 팀 근무지를 따르는 사람에게만 (개인 근무지·종일 휴가·종일 외근 제외, 반차는 받음)", () => {
  const s = base();
  s.teamOverrides = [{ work_date: "2026-11-03", loc: "forest", branch: null, note: null }];
  s.audit = [{ id: 41, at: "", table_name: "team_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { work_date: "2026-11-03", loc: "forest" } }];
  s.memberOverrides = [{ member_id: M2, work_date: "2026-11-03", loc: "home", branch: null }];
  s.leaves = [{ id: "l41", member_id: M3, from_date: "2026-11-03", to_date: "2026-11-03", kind: "off" }];
  eq(change(s, "2026-11-02", "15:00").length, 0, "이나래 개인 재택, 박다온 연차 → 아무도 안 따름 → 안 보냄");
  s.leaves = [{ id: "l41", member_id: M3, from_date: "2026-11-03", to_date: "2026-11-03", kind: "am" }];
  eq(change(s, "2026-11-02", "15:00").map((n) => n.member), [M3], "오전반차는 오후에 팀 근무지로 출근 → 받음");
  s.memberOverrides = []; s.leaves = [];
  s.events = [{ id: "e41", type: "meeting", kind: "sales", title: "종일 워크숍", event_date: "2026-11-03", all_day: true, meeting_type: "inperson", place: "고객사", people: [M2], auto_out: true, exdates: [] }];
  eq(change(s, "2026-11-02", "15:00").map((n) => n.member), [M3], "이나래 종일 외근 → 제외");
  s.events = [{ ...s.events[0], all_day: false, start_time: "14:00:00" }];
  eq(change(s, "2026-11-02", "15:00").map((n) => n.member).sort(), [M2, M3], "시간 있는 미팅은 아침에 팀 근무지로 출근 → 받음");
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
  eq([...tb(r[0]), r[0].tag], ["🏠 김가람 내일 재택", "11/4 (수) · 집중 작업", "who:m1:2026-11-04"], "문구 — 본인이 바꿨으면 '누가 변경' 생략");
  s.audit = [{ id: 32, at: "", table_name: "member_work_overrides", op: "INSERT", actor_id: "u2", before: null, after: { member_id: M1, work_date: "2026-11-04", loc: "home", branch: null } }];
  const o = change(s, "2026-11-03", "17:40");
  eq(o.map((n) => n.member).sort(), [M1, M3], "남이 바꾸면 당사자도");
  eq(o[0].body, "11/4 (수) · 이나래 변경", "바꾼 사람 표시");
  s.memberOverrides = [];
  s.audit = [
    { id: 33, at: "", table_name: "member_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { member_id: M1, work_date: "2026-11-04", loc: "out", branch: null } },
    { id: 34, at: "", table_name: "member_work_overrides", op: "DELETE", actor_id: "u1", before: { member_id: M1, work_date: "2026-11-04", loc: "out", branch: null }, after: null },
  ];
  eq(change(s, "2026-11-03", "17:40").length, 0, "바꿨다 되돌림");
  s.audit = [{ id: 35, at: "", table_name: "member_work_overrides", op: "DELETE", actor_id: "u1", before: { member_id: M1, work_date: "2026-11-04", loc: "out", branch: null }, after: null }];
  eq(tb(change(s, "2026-11-03", "17:40")[0]), ["🏠 김가람 내일 재택", "11/4 (수) · 원래 근무지로"], "해제 → 원래대로(수요일 팀 재택)");
  s.events = [{ id: "e7", type: "meeting", title: "고객사 킥오프", event_date: "2026-11-04", start_time: "14:00:00", all_day: false, meeting_type: "inperson", people: [M1], auto_out: true, exdates: [] }];
  eq(tb(change(s, "2026-11-03", "17:40")[0]), ["🚕 김가람 내일 14:00 외근 (고객사 킥오프)", "11/4 (수) · 원래 근무지로"], "해제했는데 대면 미팅이 있으면 그 외근이 '원래'");
  s.events = [];
  s.audit = [{ id: 36, at: "", table_name: "member_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { member_id: M1, work_date: "2026-11-10", loc: "home", branch: null } }];
  eq(change(s, "2026-11-03", "17:40").length, 0, "범위 밖 — 본인이 바꾸면 아무에게도");
  s.memberOverrides = [{ member_id: M1, work_date: "2026-11-20", loc: "other", branch: "성수동 가나다빌딩" }];
  s.audit = [{ id: 38, at: "", table_name: "member_work_overrides", op: "INSERT", actor_id: "u2", before: null, after: { member_id: M1, work_date: "2026-11-20", loc: "other", branch: "성수동 가나다빌딩" } }];
  eq(change(s, "2026-11-03", "17:40").map((n) => [n.member, ...tb(n)]), [[M1, "📍 김가람 11/20 (금) 성수동 가나다빌딩", "이나래 변경"]], "범위 밖 — 남이 바꾸면 당사자에게만");
  s.memberOverrides = [];
  s.audit = [{ id: 37, at: "", table_name: "member_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { member_id: M1, work_date: "2026-11-04", loc: "home", branch: null } }];
  eq(change(s, "2026-11-03", "23:00").length, 0, "밤에는 보류");
});

Deno.test("변경: 휴가 — 등록·취소·날짜/종류 변경·대상자 변경, 사유만 수정 생략", () => {
  const s = empty(base());
  const lv = { id: "l1", member_id: M3, from_date: "2026-11-04", to_date: "2026-11-05", kind: "off", note: null, deleted_at: null };
  const one = (a: Record<string, unknown>) => { s.audit = [{ id: 41, at: "", table_name: "team_leaves", actor_id: "u3", ...a }]; return change(s, "2026-11-03"); };
  let r = one({ op: "INSERT", before: null, after: lv });
  eq(r.map((n) => n.member).sort(), [M1, M2], "본인 제외 전원");
  eq(tb(r[0]), ["🌴 박다온 연차 등록", "11/4 (수)–11/5 (목)"], "등록 — 본인이 등록했으면 '누가' 생략");
  eq(one({ op: "UPDATE", before: lv, after: { ...lv, note: "가족 행사" } }).length, 0, "사유만 수정");
  eq(tb(one({ op: "UPDATE", before: lv, after: { ...lv, deleted_at: "x" } })[0]), ["🌴 박다온 연차 취소", "11/4 (수)–11/5 (목)"], "취소");
  eq(one({ op: "INSERT", before: null, after: { ...lv, from_date: "2026-11-20", to_date: "2026-11-21" } }).length, 0, "먼 휴가를 본인이 등록 → 전날 안내에서");
  eq(one({ op: "INSERT", actor_id: "u1", before: null, after: { ...lv, from_date: "2026-11-20", to_date: "2026-11-21" } }).map((n) => [n.member, ...tb(n)]),
    [[M3, "🌴 박다온 연차 등록", "11/20 (금)–11/21 (토) · 김가람 등록"]], "먼 휴가를 남이 등록 → 당사자에게만");
  const far = { ...lv, from_date: "2026-11-20", to_date: "2026-11-21" };
  eq(one({ op: "UPDATE", actor_id: "u1", before: far, after: { ...far, deleted_at: "x" } }).map((n) => [n.member, n.title]), [[M3, "🌴 박다온 연차 취소"]], "먼 휴가를 남이 취소 → 당사자에게");
  eq(one({ op: "UPDATE", actor_id: "u1", before: far, after: { ...far, to_date: "2026-11-23" } }).map((n) => [n.member, n.body]), [[M3, "11/20 (금)–11/21 (토) → 11/20 (금)–11/23 (월) · 김가람 변경"]], "먼 휴가를 남이 변경 → 당사자에게");
  eq(tb(one({ op: "UPDATE", before: lv, after: { ...lv, from_date: "2026-11-20", to_date: "2026-11-21" } })[0]), ["🌴 박다온 연차 변경", "11/4 (수)–11/5 (목) → 11/20 (금)–11/21 (토)"], "가까운 휴가를 먼 날로");
  eq(tb(one({ op: "UPDATE", before: lv, after: { ...lv, kind: "pm" } })[0]), ["🌴 박다온 오후반차 변경", "연차 → 오후반차"], "종류 변경");
  r = one({ op: "UPDATE", before: lv, after: { ...lv, member_id: M2 } });
  eq(r.map((n) => `${n.member}|${n.title}`).sort(), ["m1|🌴 박다온 연차 취소", "m1|🌴 이나래 연차 등록", "m2|🌴 박다온 연차 취소", "m2|🌴 이나래 연차 등록"], "대상자 변경 → 원래 사람 취소 + 새 사람 등록");
});

Deno.test("변경: 대면 미팅 외근 — 비참석자에게 근무지 알림, 취소 시 해제, 예외들", () => {
  const s = base(); s.wishket = [];
  const ev = { id: "e7", type: "meeting", title: "고객사 킥오프", event_date: "2026-11-05", start_time: "14:00:00", end_time: "15:00:00", all_day: false, meeting_type: "inperson", people: [M1, M2], auto_out: true, exdates: [], deleted_at: null };
  s.events = [ev];
  s.audit = [{ id: 51, at: "", table_name: "calendar_events", op: "INSERT", actor_id: "u1", before: null, after: ev }];
  let r = change(s, "2026-11-04", "17:40");
  eq(r.map((n) => `${n.member}|${n.title}`).sort(), ["m2|➕ 고객사 킥오프 추가", "m3|🚕 김가람 내일 14:00 외근 (고객사 킥오프)", "m3|🚕 이나래 내일 14:00 외근 (고객사 킥오프)"], "참석자는 일정, 비참석자는 근무지");
  eq(r.find((n) => n.key === "c:51:m3:m1:2026-11-05")!.body, "11/5 (목) · 대면 미팅 ~15:00", "근무지 알림 본문(본인 등록이라 '누가' 생략)");
  eq(r.find((n) => n.member === M2)!.body, "11/5 (목) 14:00–15:00 · 김가람 추가", "일정 알림 본문");
  s.events = [];
  s.audit = [{ id: 52, at: "", table_name: "calendar_events", op: "UPDATE", actor_id: "u1", before: ev, after: { ...ev, deleted_at: "x" } }];
  r = change(s, "2026-11-04", "17:40").filter((n) => n.member === M3);
  eq(r.map(tb).sort(), [["🏢 김가람 내일 시청역2호점", "11/5 (목) · 미팅이 취소·변경돼 외근 해제"], ["🏢 이나래 내일 시청역2호점", "11/5 (목) · 미팅이 취소·변경돼 외근 해제 · 김가람 변경"]], "외근 해제");
  s.events = [ev]; s.memberOverrides = [{ member_id: M1, work_date: "2026-11-05", loc: "cityhall", branch: null }];
  s.audit = [{ id: 53, at: "", table_name: "calendar_events", op: "INSERT", actor_id: "u2", before: null, after: ev }];
  eq(change(s, "2026-11-04", "17:40").filter((n) => n.member === M3).map((n) => n.title), ["🚕 이나래 내일 14:00 외근 (고객사 킥오프)"], "개인 근무지를 정한 사람 제외");
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
  eq(r.map((n) => `${n.member}|${n.title}`).sort(), ["m2|🚕 이나래 내일 14:00 외근 (창호 견적)", "m3|🚕 이나래 내일 14:00 외근 (창호 견적)"], "담당자 포함");
  eq(r[0].body, "11/5 (목) · 수주 미팅 · 김가람 변경", "본문");
  s.audit = [{ id: 72, at: "", table_name: "wishket_projects", op: "UPDATE", actor_id: "u1", before: w1, after: { ...w1, title: "창호 견적 시스템" } }];
  eq(change(s, "2026-11-04", "17:40").length, 0, "무관한 수정");
});

Deno.test("변경: 주간 패턴 — 같은 내용·지난 패턴 생략, 바뀐 요일만 본문에", () => {
  const s = empty(base());
  const same = { valid_from: "2026-11-05", days: { 1: "cityhall", 2: "cityhall", 3: "home", 4: "cityhall", 5: "cityhall" } };
  s.routines.push(same);
  eq(tb(brief(s, "2026-11-04").find((n) => n.member === M1)!), ["🏢 내일 시청역2호점 · 11/5 (목)", "시청역2호점: 이나래, 박다온"], "같은 내용 → 평소 안내 그대로");
  s.audit = [{ id: 81, at: "", table_name: "team_work_routines", op: "INSERT", actor_id: "u1", before: null, after: same }];
  eq(change(s, "2026-11-04").length, 0, "같은 내용 → 변경 알림 없음");
  s.routines = [base().routines[0], { valid_from: "2026-09-01", days: { 1: "home", 2: "cityhall", 3: "home", 4: "cityhall", 5: "cityhall" } }, { valid_from: "2026-10-01", days: base().routines[0].days }];
  s.audit = [{ id: 82, at: "", table_name: "team_work_routines", op: "UPDATE", actor_id: "u1", before: {}, after: s.routines[1] }];
  eq(change(s, "2026-11-04").length, 0, "쓰이지 않는 지난 패턴");
  s.routines = [base().routines[0], { valid_from: "2026-11-05", days: { 1: "cityhall", 2: "cityhall", 3: "home", 4: "home", 5: "cityhall" } }];
  s.audit = [{ id: 83, at: "", table_name: "team_work_routines", op: "INSERT", actor_id: "u1", before: null, after: s.routines[1] }];
  eq(tb(change(s, "2026-11-04")[0]), ["🗓 11/5 (목)부터 주간 근무 패턴 변경", "목 재택 · 김가람 변경"], "바뀐 요일만");
  s.audit = [];
  eq(brief(s, "2026-11-04").find((n) => n.member === M2)!.title, "🏠 내일 재택 · 11/5 (목)", "안내");
});

// 2026-11-05: 바꾸기 전·후 패턴으로 앞으로 8일 팀 근무지를 비교 — 같은 날짜 재저장(UPDATE)·예정 취소(DELETE)
Deno.test("변경: 주간 패턴 — 같은 날짜로 같은 내용 재저장은 생략, 내용이 바뀌면 바뀐 요일만", () => {
  const s = empty(base());
  const old = { valid_from: "2026-11-05", days: { 1: "cityhall", 2: "cityhall", 3: "home", 4: "home", 5: "cityhall" } };
  s.routines.push(old);
  s.audit = [{ id: 91, at: "", table_name: "team_work_routines", op: "UPDATE", actor_id: "u1", before: old, after: { ...old } }];
  eq(change(s, "2026-11-04").length, 0, "같은 내용 재저장(직전 패턴과는 다르지만 이 행은 그대로)");
  const neu = { valid_from: "2026-11-05", days: { 1: "cityhall", 2: "home", 3: "home", 4: "home", 5: "cityhall" } };
  s.routines = [base().routines[0], neu];
  s.audit = [{ id: 92, at: "", table_name: "team_work_routines", op: "UPDATE", actor_id: "u1", before: old, after: neu }];
  eq(tb(change(s, "2026-11-04")[0]), ["🗓 11/5 (목)부터 주간 근무 패턴 변경", "화 재택 · 김가람 변경"], "이 행에서 바뀐 요일(화)만 — 목은 원래 재택");
});

Deno.test("변경: 예정된 주간 패턴 취소(DELETE)도 알림", () => {
  const s = empty(base());
  const sched = { valid_from: "2026-11-05", days: { 1: "cityhall", 2: "cityhall", 3: "home", 4: "forest", 5: "cityhall" } };
  // 지금 상태(s.routines)엔 이미 없음
  s.audit = [{ id: 93, at: "", table_name: "team_work_routines", op: "DELETE", actor_id: "u1", before: sched, after: null }];
  const r = change(s, "2026-11-04");
  eq(r.length, 2, "바꾼 사람 뺀 전원(이나래·박다온)");
  eq(tb(r[0]), ["🗓 11/5 (목)부터 예정됐던 주간 패턴 취소", "목 시청역 · 김가람 변경"], "원래대로 돌아가는 요일");
  s.audit = [{ id: 94, at: "", table_name: "team_work_routines", op: "DELETE", actor_id: "u1", before: { valid_from: "2027-03-02", days: sched.days }, after: null }];
  eq(change(s, "2026-11-04").length, 0, "8일 밖 예정 취소는 생략");
});

Deno.test("발송 결과 분류·오래 죽은 구독", () => {
  eq([201, 404, 410, 429, 500, 503, 400, 401, 403, 413, null].map(pushOutcome),
    ["ok", "gone", "gone", "retry", "retry", "retry", "fatal", "fatal", "fatal", "fatal", "retry"], "상태 코드");
  const now = Date.parse("2026-11-05T09:00:00+09:00");
  eq(isStaleSub(10, null, now), false, "실패 10번은 지우지 않음 (전엔 지웠다)");
  eq(isStaleSub(30, new Date(now - 3 * 864e5).toISOString(), now), false, "최근에 받은 적 있음");
  eq(isStaleSub(30, new Date(now - 20 * 864e5).toISOString(), now), true, "30번 실패 + 20일 동안 못 받음");
  eq(isStaleSub(45, null, now), true, "한 번도 못 받음");
});

// ───────── 변경 알림: 일정 ─────────
Deno.test("변경: 일정 추가·수정·취소·참석 변경 — 참석자에게, 바뀐 것만 본문에", () => {
  const s = base();
  const ev = { id: "e9", type: "meeting", title: "디자인 협의", event_date: "2026-11-05", start_time: "11:00:00", all_day: false, people: [M2, M3], exdates: [], deleted_at: null };
  const one = (a: Record<string, unknown>, d = "2026-11-02", t = "15:00") => { s.audit = [{ id: 61, at: "", table_name: "calendar_events", ...a }]; return change(s, d, t); };
  eq(one({ op: "INSERT", actor_id: "u2", before: null, after: ev }).map((n) => [n.member, ...tb(n)]), [["m3", "➕ 디자인 협의 추가", "11/5 (목) 11:00 · 이나래 추가"]], "추가 — 본인 제외");
  eq(one({ op: "UPDATE", actor_id: "u2", before: ev, after: { ...ev, note: "안건 추가" } }).length, 0, "메모만 수정");
  eq(one({ op: "UPDATE", actor_id: "u1", before: ev, after: { ...ev, start_time: "15:00:00" } }).map((n) => tb(n)[1]), ["11/5 (목) · 시간 11:00 → 15:00 · 김가람 변경", "11/5 (목) · 시간 11:00 → 15:00 · 김가람 변경"], "시간 변경 — 바뀐 값을 앞에서 반복하지 않음");
  eq(one({ op: "UPDATE", actor_id: "u2", before: ev, after: { ...ev, deleted_at: "x" } }).map((n) => [n.member, n.title]), [["m3", "✖️ 디자인 협의 취소"]], "취소");
  const p = one({ op: "UPDATE", actor_id: "u1", before: ev, after: { ...ev, people: [M2, M1] } });
  eq(p.map((n) => `${n.member}|${n.title}`).sort(), ["m2|✏️ 디자인 협의 변경", "m3|✖️ 디자인 협의 참석 빠짐"], "참석 변경 — 빠진 사람은 '참석 빠짐'");
  eq(one({ op: "INSERT", actor_id: "u2", before: null, after: { ...ev, id: "e10", event_date: "2026-12-01" } }).map((n) => [n.member, ...tb(n)]),
    [["m3", "➕ 디자인 협의 추가", "12/1 (화) 11:00 · 이나래 추가"]], "먼 일정도 참석자에게 (당사자)");
  const mine = { ...ev, people: [M2], created_by: "u1" };
  eq(one({ op: "UPDATE", actor_id: "u2", before: mine, after: { ...mine, start_time: "13:00:00" } }).map((n) => [n.member, n.title]), [["m1", "✏️ 디자인 협의 변경"]], "만든 사람(참석자 아님)도 남이 바꾸면");
  eq(one({ op: "UPDATE", actor_id: "u2", before: mine, after: { ...mine, deleted_at: "x" } }).map((n) => [n.member, n.title]), [["m1", "✖️ 디자인 협의 취소"]], "만든 사람에게 취소");
  eq(one({ op: "UPDATE", actor_id: "u1", before: mine, after: { ...mine, start_time: "13:00:00" } }).map((n) => n.member), ["m2"], "만든 사람이 직접 바꾸면 본인 제외");
  eq(one({ op: "INSERT", actor_id: "u2", before: null, after: { ...ev, people: [] } }).length, 0, "참석자 없는 일정은 받을 사람 없음");
});

Deno.test("변경: 일정을 7일 밖으로 옮김 — 옛 날짜 기준으로 '날짜 a → b'", () => {
  const s = base();
  const ev = { id: "e9", type: "meeting", title: "디자인 협의", event_date: "2026-11-05", start_time: "11:00:00", all_day: false, people: [M2, M3], exdates: [], deleted_at: null };
  s.audit = [{ id: 62, at: "", table_name: "calendar_events", op: "UPDATE", actor_id: "u1", before: ev, after: { ...ev, event_date: "2026-11-20", start_time: "15:00:00" } }];
  eq(tb(change(s, "2026-11-02", "15:00")[0]), ["✏️ 디자인 협의 변경", "날짜 11/5 (목) → 11/20 (금), 시간 11:00 → 15:00 · 김가람 변경"], "이동");
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
  eq(c.map((n) => `${n.member}|${n.title}`).sort(), ["m2|✏️ 주간 회의 변경", "m3|✏️ 주간 회의 변경"], "한 건만 '변경', 취소 없음 — 빠진 이나래에게도");
  eq(c[0].body, "11/9 (월) · 시간 10:00 → 15:00, 참석 −이나래 · 이 회차만 · 김가람 변경", "문구");
  // 짝의 원래 반복 쪽 갱신이 다음 실행으로 넘어간 경우(새 일정은 이미 처리됨) → 취소로 보내지 않음
  s.audit = [pair[1]];
  eq(change(s, "2026-11-04", "15:05").length, 0, "다음 실행의 원래 반복 갱신은 건너뜀");
  // 한 회차 삭제·되돌림(따로 실행)
  const s2 = base(); const rep2 = s2.events.find((e) => e.id === "e2")!;
  s2.audit = [{ id: 51, at: "", table_name: "calendar_events", op: "UPDATE", actor_id: "u1", before: rep2, after: { ...rep2, exdates: [...rep2.exdates, "2026-11-09"] } }];
  eq(tb(change(s2, "2026-11-04", "15:00").find((n) => n.member === M2)!), ["✖️ 주간 회의 취소", "11/9 (월) 10:00 · 이 회차만 · 김가람 취소"], "한 회차 삭제");
  s2.audit = [{ id: 52, at: "", table_name: "calendar_events", op: "UPDATE", actor_id: "u1", before: { ...rep2, exdates: [...rep2.exdates, "2026-11-09"] }, after: rep2 }];
  eq(change(s2, "2026-11-04", "15:00").find((n) => n.member === M2)!.title, "➕ 주간 회의 추가", "되돌림");
  s2.audit = [{ id: 53, at: "", table_name: "calendar_events", op: "UPDATE", actor_id: "u1", before: rep2, after: { ...rep2, exdates: [...rep2.exdates, "2026-11-30"] } }];
  eq(tb(change(s2, "2026-11-04", "15:00").find((n) => n.member === M2)!), ["✖️ 주간 회의 취소", "11/30 (월) 10:00 · 이 회차만 · 김가람 취소"], "먼 회차 삭제도 참석자에게");
  // 반복 전체 삭제 → 지난 회차 날짜가 아니라 '매주 … 반복 전체'
  s2.audit = [{ id: 54, at: "", table_name: "calendar_events", op: "UPDATE", actor_id: "u1", before: rep2, after: { ...rep2, deleted_at: "x" } }];
  eq(tb(change(s2, "2026-11-02", "17:00").find((n) => n.member === M2)!), ["✖️ 주간 회의 취소", "매주 월 10:00 · 반복 전체 · 김가람 취소"], "반복 전체 삭제");
});

Deno.test("구독이 없는 사람에게는 계획하지 않음", () => {
  const s = base(); s.subs = [];
  eq(planNotifications(s, at("2026-11-03", "18:00")).notes.length, 0, "구독 없음");
});

Deno.test("대면 미팅 외근: 시간 있는 미팅은 그 시각부터(가장 이른 것), 종일 미팅은 하루 전체", () => {
  const s = empty(base());
  const mk = (id: string, start: string | null, title: string) => ({ id, type: "meeting", title, event_date: "2026-11-04", start_time: start, all_day: !start, meeting_type: "inperson", people: [M1], auto_out: true, exdates: [] });
  s.events = [mk("a", "16:00:00", "B사 미팅"), mk("b", "14:00:00", "A사 미팅")];
  eq(brief(s, "2026-11-03").find((n) => n.member === M2)!.body, "재택: 김가람(14:00 외근), 박다온", "가장 이른 시각 — 아침엔 팀 근무지 묶음에");
  s.events.push(mk("c", null, "종일 워크숍"));
  eq(brief(s, "2026-11-03").find((n) => n.member === M2)!.body, "재택: 박다온 · 외근: 김가람", "종일이 있으면 하루 전체 외근");
});

Deno.test("문구: 제목에 날짜가 있으면(모레 이후) 본문에 날짜를 다시 쓰지 않음", () => {
  const s = empty(base());
  s.memberOverrides = [{ member_id: M1, work_date: "2026-11-05", loc: "out", branch: null }];
  s.audit = [{ id: 91, at: "", table_name: "member_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { member_id: M1, work_date: "2026-11-05", loc: "out", branch: null } }];
  eq(tb(change(s, "2026-11-03", "15:00")[0]), ["🚕 김가람 11/5 (목) 외근", ""], "모레 → 날짜는 제목에만");
  s.memberOverrides = [{ member_id: M1, work_date: "2026-11-04", loc: "out", branch: null }];
  s.audit = [{ id: 92, at: "", table_name: "member_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { member_id: M1, work_date: "2026-11-04", loc: "out", branch: null } }];
  eq(tb(change(s, "2026-11-03", "15:00")[0]), ["🚕 김가람 내일 외근", "11/4 (수)"], "내일 → 본문에 날짜");
});

Deno.test("겹침: 18:00 전 변경은 같은 실행의 안내에 담기니 변경 알림 생략, 18:00 이후 변경은 그대로", () => {
  const s = empty(base());
  s.subs.push({ id: "s3b", member_id: M3, morning_brief: true, change_alerts: true });
  s.memberOverrides = [{ member_id: M1, work_date: "2026-11-04", loc: "out", branch: null }];
  s.audit = [{ id: 95, at: iso("2026-11-03", "17:58:00"), table_name: "member_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { member_id: M1, work_date: "2026-11-04", loc: "out", branch: null } }];
  let r = planNotifications(s, at("2026-11-03", "18:00")).notes;
  eq(r.filter((n) => n.kind === "brief").map((n) => n.member).sort(), [M1, M2, M3], "안내는 나감");
  eq(r.filter((n) => n.kind === "change").length, 0, "17:58 변경 → 안내에 담겨 변경 알림 생략");
  s.audit = [{ id: 96, at: iso("2026-11-03", "18:03:00"), table_name: "member_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { member_id: M1, work_date: "2026-11-04", loc: "out", branch: null } }];
  r = planNotifications(s, at("2026-11-03", "18:05")).notes;
  eq(r.filter((n) => n.kind === "change").map((n) => n.member).sort(), [M2, M3], "18:03 변경 → 안내 뒤일 수 있어 그대로 보냄(빠지지 않게)");
  s.audit = [{ id: 97, at: iso("2026-11-03", "17:58:00"), table_name: "member_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { member_id: M1, work_date: "2026-11-05", loc: "home", branch: null } }];
  s.memberOverrides = [{ member_id: M1, work_date: "2026-11-05", loc: "home", branch: null }];
  eq(planNotifications(s, at("2026-11-03", "18:00")).notes.filter((n) => n.kind === "change").length, 2, "다음 근무일이 아닌 날 변경은 그대로");
  s.subs = s.subs.filter((x) => x.member_id !== M3 || x.id === "s3");   // 박다온는 안내 끔
  s.audit = [{ id: 98, at: iso("2026-11-03", "17:58:00"), table_name: "member_work_overrides", op: "INSERT", actor_id: "u1", before: null, after: { member_id: M1, work_date: "2026-11-04", loc: "out", branch: null } }];
  s.memberOverrides = [{ member_id: M1, work_date: "2026-11-04", loc: "out", branch: null }];
  eq(planNotifications(s, at("2026-11-03", "18:00")).notes.filter((n) => n.kind === "change").map((n) => n.member), [M3], "안내를 끈 사람에겐 변경 알림 그대로");
});
