// 알림 계획 — DB 스냅샷과 지금 시각으로 '지금 보낼 알림' 목록을 만든다.
// 보내는 알림은 두 가지 (2026-10-30 사용자 결정: 미팅 시작 전 알림은 두지 않는다)
//   ① 다음 근무일 안내: 근무일 16:00~17:30 첫 실행에 '다음 근무일' 근무지·일정·팀 부재. 내 근무지가 평소와 같고 내 일정도 없으면 보내지 않는다.
//      (2026-11-03 조정: 유연출퇴근이라 퇴근 시각이 사람·날마다 다름 — 가장 이른 퇴근 전에 받아야 재택 전날 노트북 등을 챙길 수 있어
//       저녁 18:30 → 오후 16:00. 이후 바뀌는 내일 근무지·내 일정은 ② 변경 알림이 메운다. 팀원 부재만으로는 보내지 않음 — 매일 오는 알림은 무시하게 된다)
//   ② 변경 알림: 감사 로그 기준. 밤 22:00~07:30 사이에는 보내지 않고 쌓아 두었다가 07:30 이후 첫 실행에 보낸다.
// DB·네트워크에 의존하지 않는 순수 함수라 따로 테스트한다 (plan.test.ts).
// 근무지 규칙은 화면(dashboard/src/calendar.jsx)과 같다:
//   종일 휴가 > 직접 고른 근무지 > 대면 미팅 외근 > 팀 근무지(하루 예외 > 적용 시작일별 주간 패턴)

export type Member = { id: string; name: string; user_id: string | null };
// morning_brief 컬럼 = '다음 근무일 안내' 켜기/끄기 (이름은 첫 설계 때 것). lead_minutes 는 미팅 알림을 없애며 쓰지 않는다.
export type Sub = { id: string; member_id: string | null; lead_minutes?: number; morning_brief: boolean; change_alerts: boolean };
export type Row = Record<string, any>;
export type Snapshot = {
  members: Member[];
  subs: Sub[];
  routines: Row[];        // team_work_routines
  teamOverrides: Row[];   // team_work_overrides
  memberOverrides: Row[]; // member_work_overrides
  leaves: Row[];          // team_leaves (삭제 안 된 것)
  events: Row[];          // calendar_events (삭제 안 된 것)
  holidays: Record<string, string>;
  wishket: Row[];         // wishket_projects (meeting_at 이 있는 것)
  audit: Row[];           // project_audit_log (처리 위치 이후, id 오름차순)
};
export type Note = {
  key: string; member: string; kind: "brief" | "change";
  title: string; body: string; url: string; tag: string; ttl: number; urgency: "high" | "normal";
};

const KST = 9 * 3600e3;
const WD = ["일", "월", "화", "수", "목", "금", "토"];
export const kstKey = (ms: number) => new Date(ms + KST).toISOString().slice(0, 10);
export const kstMin = (ms: number) => { const d = new Date(ms + KST); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
export const kstHm = (ms: number) => new Date(ms + KST).toISOString().slice(11, 16);
export const addDay = (k: string, n: number) => new Date(Date.parse(`${k}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const dow = (k: string) => new Date(`${k}T00:00:00Z`).getUTCDay();
export const fmtD = (k: string) => `${+k.slice(5, 7)}/${+k.slice(8, 10)} (${WD[dow(k)]})`;
const hm = (t: unknown) => (t ? String(t).slice(0, 5) : "");

const LOC: Record<string, { label: string; full: string }> = {
  cityhall: { label: "시청역", full: "패스트파이브 시청역2호점" },
  forest: { label: "서울숲", full: "패스트파이브 서울숲" },
  other: { label: "기타지점", full: "패스트파이브 기타 지점" },
  home: { label: "재택", full: "재택근무" },
  out: { label: "외근", full: "외근" },
  off: { label: "연차", full: "연차" }, am: { label: "오전반차", full: "오전 반차" },
  pm: { label: "오후반차", full: "오후 반차" }, sick: { label: "병가", full: "병가" },
};
const HALF: Record<string, boolean> = { am: true, pm: true };
const KIND: Record<string, string> = {
  sales: "수주 상담", bid: "입찰·제안", kickoff: "킥오프", req: "요구사항", review: "중간보고",
  delivery: "납품·교육", maint: "유지보수", partner: "협력사", etc: "미팅",
};
const MT: Record<string, string> = { video: "화상", inperson: "대면", phone: "전화" };
const URL_CAL = "./?cal=1#calendar";
// 다음 근무일 안내 시각(한국 시간, 분). 5분마다 도는 실행 중 이 구간의 첫 실행에서 한 번만 나간다(push_sent 키).
export const BRIEF_FROM = 16 * 60, BRIEF_TO = 17 * 60 + 30;
const ICON: Record<string, string> = { home: "🏠", out: "🚕", cityhall: "🏢", forest: "🏢", other: "🏢" };
// 제목 우선순위: 내 근무지가 달라짐 '🏠 내일 재택근무 · 11/4 (수)' > 내 일정 있음 '📅 내일 11/4 (수)'
//               > 팀원만 평소와 다름 '👥 내일 김동욱 재택근무 · 11/4 (수)' (여러 명이면 '외 N명')
export const briefTitle = (when: string, k: string, place: { text: string; code: string } | null, hasItems = true, away: string[] = []) =>
  place ? `${ICON[place.code] || "📍"} ${when} ${short(place.text)} · ${fmtD(k)}`
  : !hasItems && away.length ? `👥 ${when} ${short(away[0])}${away.length > 1 ? ` 외 ${away.length - 1}명` : ""} · ${fmtD(k)}`
  : `📅 ${when} ${fmtD(k)}`;
const short = (t: string) => t.replace(/패스트파이브 /g, "");
const atOffice = (p: unknown) => typeof p === "string" && ["패스트파이브", "시청역", "서울숲", "사무실"].some((w) => p.includes(w));

export function occursOn(e: Row, k: string, holidays: Record<string, string>): boolean {
  if (!e || (e.exdates || []).includes(k)) return false;
  if (e.event_date === k) return true;
  return e.repeat === "weekly" && e.event_date < k && (!e.repeat_until || k <= e.repeat_until)
    && dow(e.event_date) === dow(k) && !(e.skip_holiday !== false && holidays[k]);
}
function firstWithin(e: Row, from: string, days: number, holidays: Record<string, string>): string | null {
  for (let i = 0; i <= days; i++) { const k = addDay(from, i); if (occursOn(e, k, holidays)) return k; }
  return null;
}

export function planNotifications(s: Snapshot, now: number): { notes: Note[]; cursor: number | null } {
  const today = kstKey(now), tomorrow = addDay(today, 1), nowMin = kstMin(now);
  const isOff = (k: string) => !!s.holidays[k] || [0, 6].includes(dow(k));
  const nextWorkday = (k: string) => { let d = addDay(k, 1); for (let i = 0; i < 30 && isOff(d); i++) d = addDay(d, 1); return d; };
  const quiet = nowMin >= 22 * 60 || nowMin < 7 * 60 + 30;   // 밤 22:00~07:30
  const memberName = (id: string | null | undefined) => s.members.find((m) => m.id === id)?.name || "누군가";
  const byUser: Record<string, string> = {};
  for (const m of s.members) if (m.user_id) byUser[m.user_id] = m.id;

  const routineAt = (k: string) => [...s.routines].filter((r) => r.valid_from <= k).sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1))[0];
  // 주간 패턴 r 이 직전 패턴과 월~금 근무지가 같은지 — 같은 내용을 다시 저장한 경우는 '바뀜'이 아니다
  const sameAsPrev = (r: Row) => { const prev = [...s.routines].filter((x) => x.valid_from < r.valid_from).sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1))[0];
    return !!prev && [1, 2, 3, 4, 5].every((w) => (prev.days?.[String(w)] || "cityhall") === (r.days?.[String(w)] || "cityhall")); };
  function teamLoc(k: string) {
    if (isOff(k)) return null;
    const ov = s.teamOverrides.find((o) => o.work_date === k);
    if (ov) return { code: ov.loc as string, branch: ov.branch as string | null, note: ov.note as string | null };
    const r = routineAt(k);
    return { code: (r?.days?.[String(dow(k))] || "cityhall") as string, branch: null, note: null };
  }
  const teamFull = (t: { code: string; branch: string | null } | null) => !t ? "휴무" : t.code === "other" && t.branch ? t.branch : LOC[t.code]?.full || t.code;
  const leaveOf = (pid: string, k: string) => s.leaves.find((l) => l.member_id === pid && l.from_date <= k && l.to_date >= k);
  function outMeeting(pid: string, k: string) {
    const w = s.wishket.find((w) => w.meeting_type === "inperson" && w.meeting_at && kstKey(Date.parse(w.meeting_at)) === k
      && [w.assigned_main, w.assigned_sub].includes(pid) && !atOffice(w.meeting_place));
    if (w) return w.title as string;
    const e = s.events.find((e) => e.type === "meeting" && e.meeting_type === "inperson" && e.auto_out && (e.people || []).includes(pid) && occursOn(e, k, s.holidays));
    return e ? (e.title as string) : null;
  }
  // 그 날 그 사람이 있는 곳(사람이 읽을 문장). 종일 휴가면 null.
  function placeOf(pid: string, k: string): { text: string; away: boolean; code: string } | null {
    if (isOff(k)) return null;
    const lv = leaveOf(pid, k);
    if (lv && !HALF[lv.kind]) return null;
    const t = teamLoc(k)!;
    const ov = s.memberOverrides.find((o) => o.member_id === pid && o.work_date === k);
    let text: string, away = false, code = t.code;
    if (ov && !(ov.loc === t.code && (ov.loc !== "other" || (ov.branch || "") === (t.branch || "")))) {
      text = ov.loc === "other" && ov.branch ? ov.branch : LOC[ov.loc]?.full || ov.loc; away = true; code = ov.loc;
    } else if (!ov && outMeeting(pid, k)) { text = `외근 (${outMeeting(pid, k)})`; away = true; code = "out"; }
    else text = teamFull(t);
    if (lv) { text = `${LOC[lv.kind].label} · ${text}`; away = true; }
    return { text, away, code };
  }
  // 그 날 그 사람이 참석하는 시간 있는 일정(수동 일정 + 아직 안 끝난 수주 미팅)
  function timedItems(pid: string, k: string) {
    const out: { id: string; start: string; title: string; label: string; place: string }[] = [];
    for (const e of s.events) {
      if (e.all_day || !e.start_time || !(e.people || []).includes(pid) || !occursOn(e, k, s.holidays)) continue;
      const label = e.type === "meeting" ? (KIND[e.kind] || "미팅") : e.type === "internal" ? "사내 일정" : e.type === "deadline" ? "마감" : "일정";
      out.push({ id: e.id, start: hm(e.start_time), title: e.title, label, place: [e.meeting_type ? MT[e.meeting_type] : "", e.place || ""].filter(Boolean).join(" · ") });
    }
    for (const w of s.wishket) {
      if (w.current_status !== "interview" || !w.meeting_at || ![w.assigned_main, w.assigned_sub].includes(pid)) continue;
      const ms = Date.parse(w.meeting_at); if (kstKey(ms) !== k) continue;
      out.push({ id: `w:${w.slug}`, start: kstHm(ms), title: w.title || w.slug, label: "수주 미팅", place: MT[w.meeting_type] || "" });
    }
    return out.sort((a, b) => a.start.localeCompare(b.start));
  }
  const alldayItems = (pid: string, k: string) => s.events.filter((e) => e.all_day && (e.people || []).includes(pid) && occursOn(e, k, s.holidays)).map((e) => e.title as string);

  // 팀원 한 명의 그날 상태(평소와 다를 때만 문장, 같으면 null)
  const statusOf = (o: Member, k: string) => { const lv = leaveOf(o.id, k); if (lv && !HALF[lv.kind]) return `${o.name} ${LOC[lv.kind].label}`;
    const p = placeOf(o.id, k); return p?.away ? `${o.name} ${p.text}` : null; };
  const notes: Note[] = [];
  const subsOf = (pid: string) => s.subs.filter((x) => x.member_id === pid);

  // ① 다음 근무일 안내 — 근무일 오후, 다음 근무일 기준 (금요일 → 월요일, 공휴일 전날 → 그다음 평일)
  //   보내는 조건: 팀 근무지가 평소(주간 패턴)와 다름 · 내 근무지가 팀과 다름(반차 포함) · 내 일정이 있음
  //                · 팀원 중 평소와 다른 사람(재택·외근·다른 지점·반차·휴가)이 있음 — 넷 중 하나 (2026-11-03 사용자 결정: 팀원 변동도 모두에게)
  //   제목에 가장 중요한 변화를 바로 쓴다 — 열어 보지 않아도 알 수 있게.
  if (!isOff(today) && nowMin >= BRIEF_FROM && nowMin < BRIEF_TO) {
    const k = nextWorkday(today);
    const teamChanged = s.teamOverrides.some((o) => o.work_date === k) || s.routines.some((r) => r.valid_from === k && !sameAsPrev(r));
    for (const m of s.members) {
      if (!subsOf(m.id).some((x) => x.morning_brief)) continue;   // 컬럼 이름은 morning_brief 지만 '다음 근무일 안내' 켜기/끄기로 쓴다
      const place = placeOf(m.id, k);
      if (!place) continue; // 다음 근무일 종일 휴가
      const items = timedItems(m.id, k), allday = alldayItems(m.id, k);
      const list = [...allday.map((t) => `종일 ${t}`), ...items.map((it) => `${it.start} ${it.title}`)];
      // 팀원 상태: 오늘과 같으면(연차·재택 이어짐) '(계속)' — 그것만으로는 보내지 않는다. 여러 날 휴가에 매일 같은 알림이 가지 않게 (2026-11-03)
      const others = s.members.filter((o) => o.id !== m.id).map((o) => ({ cur: statusOf(o, k), prev: statusOf(o, today) })).filter((x) => x.cur);
      const fresh = others.filter((x) => x.cur !== x.prev).map((x) => x.cur as string);
      const away = others.map((x) => x.cur === x.prev ? `${x.cur} (계속)` : x.cur as string);
      const moved = teamChanged || place.away;
      if (!moved && !list.length && !fresh.length) continue;
      const lines = [`근무지: ${place.text}${moved ? " (평소와 다름)" : ""}`];
      if (list.length) lines.push(`일정 ${list.length}건: ${list.slice(0, 3).join(", ")}${list.length > 3 ? ` 외 ${list.length - 3}건` : ""}`);
      if (away.length) lines.push(`팀: ${away.join(", ")}`);
      notes.push({ key: `e:${k}:${m.id}`, member: m.id, kind: "brief", title: briefTitle(k === tomorrow ? "내일" : "다음 근무일", k, moved ? place : null, list.length > 0, fresh), body: lines.join("\n"),
        url: URL_CAL, tag: `e:${k}`, ttl: 14 * 3600, urgency: "normal" });
    }
  }

  // ② 변경 알림 — 감사 로그를 변경 기록으로 읽는다. 바꾼 본인에게는 보내지 않는다.
  //   팀 근무지·팀원 개인 근무지·휴가(오늘~다음 근무일) → 전원, 주간 패턴(7일 안 시작) → 전원, 일정(7일 안 회차) → 참석자
  //   밤에는 처리하지 않고(처리 위치도 그대로) 아침 07:30 이후 첫 실행에서 한꺼번에 — 그때 기준 '오늘·내일'로 다시 판단한다.
  let cursor: number | null = null;
  if (quiet) return { notes, cursor };
  const watchers = (exclude: string | undefined) => s.members.filter((m) => m.id !== exclude && subsOf(m.id).some((x) => x.change_alerts)).map((m) => m.id);
  const dayWord = (k: string) => (k === today ? "오늘" : k === tomorrow ? "내일" : fmtD(k));
  // 근무지 변경을 알리는 범위: 오늘 ~ 다음 근무일(최소 모레). 금요일 오후 안내 뒤 월요일을 바꿔도 알린다 (2026-11-03)
  const until = [addDay(today, 2), nextWorkday(today)].sort()[1];
  // 개인 근무지: 같은 사람·같은 날을 한 번 실행 안에서 여러 번 바꿨으면 마지막 것만, 처음과 끝이 같으면(바꿨다 되돌림) 보내지 않는다
  const mwoKey = (x: Row) => `${(x.op === "DELETE" ? x.before : x.after)?.member_id}|${(x.op === "DELETE" ? x.before : x.after)?.work_date}`;
  const mwoGroups: Record<string, Row[]> = {};
  for (const x of s.audit) if (x.table_name === "member_work_overrides") (mwoGroups[mwoKey(x)] ||= []).push(x);
  const locSig = (row: Row | null | undefined) => row ? `${row.loc}|${row.branch || ""}` : "";
  // 미팅 때문에 그날 외근인지 (캘린더 대면 미팅 '외근 표시' · 위시켓 대면 미팅)
  const evOut = (e: Row | null | undefined, pid: string, k: string) => !!e && !e.deleted_at && e.type === "meeting" && e.meeting_type === "inperson" && !!e.auto_out && (e.people || []).includes(pid) && occursOn(e, k, s.holidays);
  const wkOut = (w: Row | null | undefined, pid: string, k: string) => !!w && w.meeting_type === "inperson" && !!w.meeting_at && kstKey(Date.parse(w.meeting_at)) === k && [w.assigned_main, w.assigned_sub].includes(pid) && !atOffice(w.meeting_place);
  const rangeDays = () => { const out: string[] = []; for (let k = today; k <= until; k = addDay(k, 1)) if (!isOff(k)) out.push(k); return out; };
  // 미팅으로 누군가의 근무지가 바뀌었을 때 → 받을 사람(to)에게 '근무지 변경' 알림. 개인 근무지를 직접 정한 날은 그게 우선이라 보내지 않는다.
  function meetingLocNotes(a: Row, who: string, pids: string[], to: (pid: string) => string[], wasOut: (pid: string, k: string) => boolean, isOut: (pid: string, k: string) => boolean) {
    for (const pid of pids) for (const k of rangeDays()) {
      if (wasOut(pid, k) === isOut(pid, k)) continue;
      if (s.memberOverrides.some((o) => o.member_id === pid && o.work_date === k)) continue;
      const p = placeOf(pid, k); if (!p) continue;
      if (!isOut(pid, k) && p.code === "out") continue;   // 다른 미팅으로 여전히 외근이면 바뀐 게 없음
      const nm = memberName(pid), back = !isOut(pid, k);
      for (const t of to(pid)) notes.push({ key: `c:${a.id}:${t}:${pid}:${k}`, member: t, kind: "change", title: `${ICON[p.code] || "📍"} ${nm} ${dayWord(k)} ${short(p.text)}`,
        body: `${fmtD(k)} ${nm} → ${p.text}${back ? " (외근 해제)" : ""} — ${who}`, url: URL_CAL, tag: `who:${pid}:${k}`, ttl: 86400, urgency: "normal" });
    }
  }
  for (const a of s.audit) {
    cursor = Math.max(cursor ?? 0, Number(a.id));
    const actor = a.actor_id ? byUser[a.actor_id] : undefined, who = actor ? memberName(actor) : "누군가";
    const b = a.before || {}, f = a.after || {}, r = a.op === "DELETE" ? b : f;
    const push = (pids: string[], title: string, body: string, tag: string) => {
      for (const pid of pids) notes.push({ key: `c:${a.id}:${pid}`, member: pid, kind: "change", title, body, url: URL_CAL, tag, ttl: 86400, urgency: "normal" });
    };
    if (a.table_name === "team_work_overrides") {
      const k = r.work_date as string;
      if (!k || k < today || k > until || isOff(k)) continue;
      const t = teamLoc(k);
      push(watchers(actor), `🏢 ${dayWord(k)} 팀 근무지 변경`, `${fmtD(k)} ${teamFull(t)}${t?.note ? " · " + t.note : ""} — ${who}`, `team:${k}`);
    } else if (a.table_name === "member_work_overrides") {
      // 팀원 개인 근무지 변경 → 바꾼 사람 뺀 전원 (2026-11-03 사용자 결정: 팀원 근무지 변동도 모두에게)
      const g = mwoGroups[mwoKey(a)];
      if (g[g.length - 1] !== a) continue;
      if (locSig(g[0].before) === locSig(a.op === "DELETE" ? null : a.after)) continue;
      const pid = r.member_id as string, k = r.work_date as string;
      if (!pid || !k || k < today || k > until || isOff(k)) continue;
      const p = placeOf(pid, k); if (!p) continue;   // 그날 종일 휴가면 근무지는 의미 없음
      const nm = memberName(pid), back = a.op === "DELETE";
      push(watchers(actor), `${ICON[p.code] || "📍"} ${nm} ${dayWord(k)} ${short(p.text)}`,
        `${fmtD(k)} ${nm} → ${p.text}${back ? " (팀 근무지대로)" : ""}${r.note && !back ? " · " + r.note : ""} — ${who}`, `who:${pid}:${k}`);
    } else if (a.table_name === "team_leaves") {
      // 휴가 등록·수정·취소가 오늘~다음 근무일에 걸치면 → 바꾼 사람 뺀 전원. 사유만 고친 건 보내지 않음
      const softDel = a.op === "UPDATE" && !b.deleted_at && f.deleted_at, undel = a.op === "UPDATE" && b.deleted_at && !f.deleted_at;
      if (a.op === "DELETE" && b.deleted_at) continue;
      if (a.op === "UPDATE" && !["member_id", "from_date", "to_date", "kind", "deleted_at"].some((c) => (b[c] ?? null) !== (f[c] ?? null))) continue;
      const hits = (x: Row) => x && x.from_date && x.from_date <= until && x.to_date >= today;
      if (!hits(r) && !(a.op === "UPDATE" && hits(b))) continue;
      const nm = memberName(r.member_id), lb = LOC[r.kind]?.label || "휴가";
      const verb = softDel || a.op === "DELETE" ? "취소" : a.op === "INSERT" || undel ? "등록" : "변경";
      const range = `${fmtD(r.from_date)}${r.to_date !== r.from_date ? "–" + fmtD(r.to_date) : ""}`;
      push(watchers(actor), `🌴 ${nm} ${lb} ${verb}`, `${range} ${nm} ${lb}${verb === "취소" ? " 취소" : ""} — ${who}`, `leave:${r.id ?? nm + r.from_date}`);
    } else if (a.table_name === "wishket_projects") {
      // 위시켓 대면 미팅 일시·방식·담당이 바뀌어 누군가의 근무지(외근)가 바뀌면 → 바꾼 사람 뺀 전원 (일정 알림 대상이 아니라 담당자도 받음)
      if (!["meeting_at", "meeting_type", "assigned_main", "assigned_sub"].some((c) => (b[c] ?? null) !== (f[c] ?? null)) && a.op === "UPDATE") continue;
      const pids = [...new Set([b.assigned_main, b.assigned_sub, f.assigned_main, f.assigned_sub].filter(Boolean))] as string[];
      meetingLocNotes(a, who, pids, () => watchers(actor), (pid, k) => wkOut(a.op === "INSERT" ? null : b, pid, k), (pid, k) => wkOut(a.op === "DELETE" ? null : f, pid, k));
    } else if (a.table_name === "team_work_routines") {
      if (a.op === "DELETE" || !r.valid_from || r.valid_from > addDay(today, 7)) continue;
      const cur = s.routines.find((x) => x.valid_from === r.valid_from) || r;
      if (sameAsPrev(cur)) continue;   // 같은 내용을 다시 저장
      if (![0, 1, 2, 3, 4, 5, 6, 7].some((i) => routineAt(addDay(today, i))?.valid_from === r.valid_from)) continue;   // 앞으로 8일 중 이 패턴이 쓰이는 날이 없음(지난 패턴)
      push(watchers(actor), "🗓 주간 근무 패턴 변경", `${r.change_note || fmtD(r.valid_from) + "부터 새 패턴"} — ${who}`, "routine");
    } else if (a.table_name === "calendar_events") {
      const softDel = a.op === "UPDATE" && !b.deleted_at && f.deleted_at, undel = a.op === "UPDATE" && b.deleted_at && !f.deleted_at;
      if (a.op === "DELETE" && b.deleted_at) continue;
      const fields = ["title", "event_date", "start_time", "end_time", "place", "people", "exdates", "repeat", "repeat_until", "meeting_type", "all_day", "deleted_at", "auto_out"];
      const changed = fields.filter((c) => JSON.stringify(b[c] ?? null) !== JSON.stringify(f[c] ?? null));
      if (a.op === "UPDATE" && !changed.length) continue;
      // 반복 일정 나누기(이 회차만·이후 전부): 화면이 새 일정(parent_id)을 넣은 뒤 원래 반복의 exdates·repeat_until 을 줄인다.
      //   → 새 일정 쪽 한 건만 '변경'으로 보내고, 바로 뒤따르는 원래 반복 쪽 갱신은 건너뛴다.
      const split = a.op === "INSERT" && !!f.parent_id;
      if (a.op === "UPDATE" && !softDel && !undel && changed.every((c) => c === "exdates" || c === "repeat_until")
        && s.audit.some((x) => x.table_name === "calendar_events" && x.op === "INSERT" && x.after?.parent_id === f.id && Number(x.id) < Number(a.id) && Number(a.id) - Number(x.id) <= 3)) continue;
      // 대면 미팅 '외근 표시'로 누군가의 근무지가 바뀌면 → 참석자가 아닌 팀원에게도 근무지 변경 알림 (참석자는 아래 일정 알림을 받음) (2026-11-03)
      {
        // 나누기면 '바꾸기 전'은 원래 반복(뒤따르는 갱신의 before), '바꾼 뒤'는 새 일정 + 줄어든 원래 반복
        const pu = split ? s.audit.find((x) => x.table_name === "calendar_events" && x.op === "UPDATE" && x.before?.id === f.parent_id && Number(x.id) > Number(a.id) && Number(x.id) - Number(a.id) <= 3) : null;
        if (!split || pu) {
          const before = split ? pu!.before : a.op === "INSERT" ? null : b, after = a.op === "DELETE" ? null : f, afterParent = split ? pu!.after : null;
          const crowd = new Set<string>([...(before?.people || []), ...(after?.people || [])]);
          meetingLocNotes(a, who, [...crowd], () => watchers(actor).filter((t) => !crowd.has(t)),
            (pid, k) => evOut(before, pid, k), (pid, k) => evOut(after, pid, k) || evOut(afterParent, pid, k));
        }
      }
      // 반복 일정 한 회차만 삭제·되돌림: exdates 만 바뀜 → 그 회차 날짜로 '취소'·'추가'
      const exOnly = a.op === "UPDATE" && changed.length === 1 && changed[0] === "exdates";
      const exAdded = exOnly ? (f.exdates || []).filter((k: string) => !(b.exdates || []).includes(k)) : [];
      const exRemoved = exOnly ? (b.exdates || []).filter((k: string) => !(f.exdates || []).includes(k)) : [];
      const inRange = (k: string) => k >= today && k <= addDay(today, 7);
      const when = exOnly ? [...exAdded, ...exRemoved].filter(inRange).sort()[0]
        : firstWithin(r, today, 7, s.holidays) || (a.op === "UPDATE" ? firstWithin(b, today, 7, s.holidays) : null);
      if (!when) continue;
      const parent = split ? s.events.find((e) => e.id === f.parent_id) : null;
      const people = new Set<string>([...(a.op === "INSERT" || undel ? [] : (b.people || [])), ...(parent?.people || []), ...(r.people || [])]);
      const pids = [...people].filter((p) => p !== actor && subsOf(p).some((x) => x.change_alerts));
      const time = r.all_day ? "종일" : hm(r.start_time);
      const verb = softDel || a.op === "DELETE" || (exOnly && exAdded.includes(when)) ? ["✖️", "취소"]
        : split ? ["✏️", "변경"] : (a.op === "INSERT" || undel || exOnly) ? ["➕", "추가"] : ["✏️", "변경"];
      const detail = split && f.change_note ? `\n${f.change_note}`
        : a.op === "UPDATE" && !softDel && !undel && !exOnly && f.change_note && f.change_note !== b.change_note ? `\n${f.change_note}` : "";
      push(pids, `${verb[0]} 일정 ${verb[1]}`, `${fmtD(when)} ${time} ${r.title} — ${who}${detail}`, `ev:${r.id}`);
    }
  }
  return { notes, cursor };
}
