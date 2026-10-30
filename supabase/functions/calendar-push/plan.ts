// 알림 계획 — DB 스냅샷과 지금 시각으로 '지금 보낼 알림' 목록을 만든다.
// 보내는 알림은 두 가지 (2026-10-30 사용자 결정: 미팅 시작 전 알림은 두지 않는다)
//   ① 저녁 안내: 근무일 저녁 18:30~20:00 첫 실행에 '다음 근무일' 근무지·일정·팀 부재. 평소와 같은 날은 보내지 않는다.
//   ② 변경 알림: 감사 로그 기준. 밤 22:00~07:30 사이에는 보내지 않고 쌓아 두었다가 07:30 이후 첫 실행에 보낸다.
// DB·네트워크에 의존하지 않는 순수 함수라 따로 테스트한다 (plan.test.ts).
// 근무지 규칙은 화면(dashboard/src/calendar.jsx)과 같다:
//   종일 휴가 > 직접 고른 근무지 > 대면 미팅 외근 > 팀 근무지(하루 예외 > 적용 시작일별 주간 패턴)

export type Member = { id: string; name: string; user_id: string | null };
// morning_brief 컬럼 = '저녁 안내' 켜기/끄기 (이름은 첫 설계 때 것). lead_minutes 는 미팅 알림을 없애며 쓰지 않는다.
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
  function placeOf(pid: string, k: string): { text: string; away: boolean } | null {
    if (isOff(k)) return null;
    const lv = leaveOf(pid, k);
    if (lv && !HALF[lv.kind]) return null;
    const t = teamLoc(k)!;
    const ov = s.memberOverrides.find((o) => o.member_id === pid && o.work_date === k);
    let text: string, away = false;
    if (ov && !(ov.loc === t.code && (ov.loc !== "other" || (ov.branch || "") === (t.branch || "")))) {
      text = ov.loc === "other" && ov.branch ? ov.branch : LOC[ov.loc]?.full || ov.loc; away = true;
    } else if (!ov && outMeeting(pid, k)) { text = `외근 (${outMeeting(pid, k)})`; away = true; }
    else text = teamFull(t);
    if (lv) { text = `${LOC[lv.kind].label} · ${text}`; away = true; }
    return { text, away };
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

  const notes: Note[] = [];
  const subsOf = (pid: string) => s.subs.filter((x) => x.member_id === pid);

  // ① 저녁 안내 — 근무일 저녁, 다음 근무일 기준 (금요일 → 월요일, 공휴일 전날 → 그다음 평일)
  //   평소와 같은 날(팀이 주간 패턴대로, 나도 팀과 같은 곳, 일정 없음, 팀원 모두 정상)은 보내지 않는다 — 매일 같은 알림은 무시하게 된다.
  if (!isOff(today) && nowMin >= 18 * 60 + 30 && nowMin < 20 * 60) {
    const k = nextWorkday(today);
    const teamChanged = s.teamOverrides.some((o) => o.work_date === k) || s.routines.some((r) => r.valid_from === k);
    for (const m of s.members) {
      if (!subsOf(m.id).some((x) => x.morning_brief)) continue;   // 컬럼 이름은 morning_brief 지만 '저녁 안내' 켜기/끄기로 쓴다
      const place = placeOf(m.id, k);
      if (!place) continue; // 다음 근무일 종일 휴가
      const items = timedItems(m.id, k), allday = alldayItems(m.id, k);
      const list = [...allday.map((t) => `종일 ${t}`), ...items.map((it) => `${it.start} ${it.title}`)];
      const away = s.members.filter((o) => o.id !== m.id).map((o) => {
        const lv = leaveOf(o.id, k); if (lv && !HALF[lv.kind]) return `${o.name} ${LOC[lv.kind].label}`;
        const p = placeOf(o.id, k); return p?.away ? `${o.name} ${p.text}` : null;
      }).filter(Boolean);
      if (!teamChanged && !place.away && !list.length && !away.length) continue;
      const lines = [`근무지: ${place.text}${teamChanged || place.away ? " (평소와 다름)" : ""}`];
      if (list.length) lines.push(`일정 ${list.length}건: ${list.slice(0, 3).join(", ")}${list.length > 3 ? ` 외 ${list.length - 3}건` : ""}`);
      if (away.length) lines.push(`팀: ${away.join(", ")}`);
      notes.push({ key: `e:${k}:${m.id}`, member: m.id, kind: "brief", title: `🌙 ${k === tomorrow ? "내일" : "다음 근무일"} ${fmtD(k)}`, body: lines.join("\n"),
        url: URL_CAL, tag: `e:${k}`, ttl: 14 * 3600, urgency: "normal" });
    }
  }

  // ② 변경 알림 — 감사 로그를 변경 기록으로 읽는다. 바꾼 본인에게는 보내지 않는다.
  //   밤에는 처리하지 않고(처리 위치도 그대로) 아침 07:30 이후 첫 실행에서 한꺼번에 — 그때 기준 '오늘·내일'로 다시 판단한다.
  let cursor: number | null = null;
  if (quiet) return { notes, cursor };
  const watchers = (exclude: string | undefined) => s.members.filter((m) => m.id !== exclude && subsOf(m.id).some((x) => x.change_alerts)).map((m) => m.id);
  const dayWord = (k: string) => (k === today ? "오늘" : k === tomorrow ? "내일" : fmtD(k));
  for (const a of s.audit) {
    cursor = Math.max(cursor ?? 0, Number(a.id));
    const actor = a.actor_id ? byUser[a.actor_id] : undefined, who = actor ? memberName(actor) : "누군가";
    const b = a.before || {}, f = a.after || {}, r = a.op === "DELETE" ? b : f;
    const push = (pids: string[], title: string, body: string, tag: string) => {
      for (const pid of pids) notes.push({ key: `c:${a.id}:${pid}`, member: pid, kind: "change", title, body, url: URL_CAL, tag, ttl: 86400, urgency: "normal" });
    };
    if (a.table_name === "team_work_overrides") {
      const k = r.work_date as string;
      if (!k || k < today || k > addDay(today, 2) || isOff(k)) continue;
      const t = teamLoc(k);
      push(watchers(actor), `🏢 ${dayWord(k)} 팀 근무지 변경`, `${fmtD(k)} ${teamFull(t)}${t?.note ? " · " + t.note : ""} — ${who}`, `team:${k}`);
    } else if (a.table_name === "team_work_routines") {
      if (a.op === "DELETE" || !r.valid_from || r.valid_from > addDay(today, 7)) continue;
      push(watchers(actor), "🗓 주간 근무 패턴 변경", `${r.change_note || fmtD(r.valid_from) + "부터 새 패턴"} — ${who}`, "routine");
    } else if (a.table_name === "calendar_events") {
      const softDel = a.op === "UPDATE" && !b.deleted_at && f.deleted_at, undel = a.op === "UPDATE" && b.deleted_at && !f.deleted_at;
      if (a.op === "DELETE" && b.deleted_at) continue;
      const fields = ["title", "event_date", "start_time", "end_time", "place", "people", "exdates", "repeat", "repeat_until", "meeting_type", "all_day", "deleted_at"];
      if (a.op === "UPDATE" && !fields.some((c) => JSON.stringify(b[c] ?? null) !== JSON.stringify(f[c] ?? null))) continue;
      const when = firstWithin(r, today, 7, s.holidays) || (a.op === "UPDATE" ? firstWithin(b, today, 7, s.holidays) : null);
      if (!when) continue;
      const people = new Set<string>([...(a.op === "INSERT" || undel ? [] : (b.people || [])), ...(r.people || [])]);
      const pids = [...people].filter((p) => p !== actor && subsOf(p).some((x) => x.change_alerts));
      const time = r.all_day ? "종일" : hm(r.start_time);
      const verb = softDel || a.op === "DELETE" ? ["✖️", "취소"] : (a.op === "INSERT" || undel) ? ["➕", "추가"] : ["✏️", "변경"];
      const detail = a.op === "UPDATE" && !softDel && !undel && f.change_note && f.change_note !== b.change_note ? `\n${f.change_note}` : "";
      push(pids, `${verb[0]} 일정 ${verb[1]}`, `${fmtD(when)} ${time} ${r.title} — ${who}${detail}`, `ev:${r.id}`);
    }
  }
  return { notes, cursor };
}
