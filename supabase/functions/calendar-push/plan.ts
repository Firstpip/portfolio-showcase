// 알림 계획 — DB 스냅샷과 지금 시각으로 '지금 보낼 알림' 목록을 만든다.
// 보내는 알림은 두 가지 (2026-10-30 사용자 결정: 미팅 시작 전 알림은 두지 않는다)
//   ① 다음 근무일 안내: 근무일 18:00~19:30 첫 실행에 '다음 근무일' 내 근무지·일정·팀원 부재. 매 근무일 보낸다(다음 근무일 종일 휴가인 사람만 제외).
//      (2026-11-04 사용자 결정: 평소와 다를 때만 오후 4시 → 매일 18:00. 안내를 보고 고친 내용은 ② 변경 알림으로 바로 나간다)
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
  day?: string; at?: number;   // 변경 알림만: 무슨 날에 대한 알림인지 · 변경 시각 (같은 실행의 안내와 겹침 판단용, 발송엔 안 씀)
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
  other: { label: "다른 장소", full: "다른 장소" },   // 직접 입력한 장소(branch) — 다른 지점·미팅 장소로 바로 출근 (2026-11-04)
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
export const BRIEF_FROM = 18 * 60, BRIEF_TO = 19 * 60 + 30;
const ICON: Record<string, string> = { home: "🏠", out: "🚕", cityhall: "🏢", forest: "🏢", other: "📍" };
// 제목 = 내가 갈 곳 '🏢 내일 시청역2호점 · 11/5 (목)' — 매일 오는 안내라 맨 먼저 볼 것은 내일 어디로 가는지 (2026-11-04)
export const briefTitle = (when: string, k: string, place: { text: string; code: string; half?: boolean; partial?: boolean }) =>
  `${placeIcon(place)} ${when} ${short(place.text)} · ${fmtD(k)}`;
// 짧은 표기: 다 아는 '패스트파이브'·'근무' 는 뺀다 (2026-11-03 문구 정리)
const short = (t: string) => t.replace(/패스트파이브 /g, "").replace("재택근무", "재택");
const placeIcon = (p: { code: string; half?: boolean; partial?: boolean }) => p.half ? "🌓" : p.partial ? "🏢" : ICON[p.code] || "📍";
const atOffice = (p: unknown) => typeof p === "string" && ["패스트파이브", "시청역", "서울숲", "사무실"].some((w) => p.includes(w));

export function occursOn(e: Row, k: string, holidays: Record<string, string>): boolean {
  if (!e || (e.exdates || []).includes(k)) return false;
  if (e.event_date === k) return true;
  return e.repeat === "weekly" && e.event_date < k && (!e.repeat_until || k <= e.repeat_until)
    && dow(e.event_date) === dow(k) && !(e.skip_holiday !== false && holidays[k]);
}
const EV_DAYS = 365;   // 일정 변경 알림을 볼 회차 범위(일) — 받는 사람이 참석자·만든 사람뿐이라 넓게
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
  // 그날 대면 미팅 외근: 시간이 있는 미팅이면 그 시각부터(그 전엔 팀 근무지), 종일 미팅이면 하루 전체 (2026-11-03 — 오전 출근 후 오후 미팅을 하루 외근으로 보던 문제)
  //   여러 건이면 종일이 하나라도 있으면 종일, 아니면 가장 이른 시각.
  function outMeeting(pid: string, k: string): { title: string; at: string | null } | null {
    const hits: { title: string; at: string | null }[] = [];
    for (const w of s.wishket) if (w.meeting_type === "inperson" && w.meeting_at && kstKey(Date.parse(w.meeting_at)) === k
      && [w.assigned_main, w.assigned_sub].includes(pid) && !atOffice(w.meeting_place)) hits.push({ title: w.title, at: kstHm(Date.parse(w.meeting_at)) });
    for (const e of s.events) if (e.type === "meeting" && e.meeting_type === "inperson" && e.auto_out && (e.people || []).includes(pid) && occursOn(e, k, s.holidays))
      hits.push({ title: e.title, at: e.all_day || !e.start_time ? null : hm(e.start_time) });
    if (!hits.length) return null;
    return hits.find((h) => h.at === null) || hits.sort((a, b) => a.at!.localeCompare(b.at!))[0];
  }
  // 그 날 그 사람이 있는 곳(사람이 읽을 문장). 종일 휴가면 null.
  // text: 본인에게 보일 문장(시간 있는 미팅이면 '시청역2호점 · 14:00 외근 (…)' — 아침에 갈 곳이 먼저), mate: 팀원 줄·남에게 보일 짧은 문장
  function placeOf(pid: string, k: string): { text: string; mate: string; away: boolean; code: string; half: boolean; partial: boolean } | null {
    if (isOff(k)) return null;
    const lv = leaveOf(pid, k);
    if (lv && !HALF[lv.kind]) return null;
    const t = teamLoc(k)!;
    const ov = s.memberOverrides.find((o) => o.member_id === pid && o.work_date === k);
    let text: string, mate: string | null = null, away = false, code = t.code, partial = false;
    if (ov && !(ov.loc === t.code && (ov.loc !== "other" || (ov.branch || "") === (t.branch || "")))) {
      text = ov.loc === "other" && ov.branch ? ov.branch : LOC[ov.loc]?.full || ov.loc; away = true; code = ov.loc;
    } else if (!ov && outMeeting(pid, k)) { const om = outMeeting(pid, k)!; mate = `${om.at ? om.at + " " : ""}외근 (${om.title})`;
      partial = !!om.at; text = partial ? `${teamFull(t)} · ${mate}` : mate; away = true; code = "out"; }
    else text = teamFull(t);
    if (lv) { text = `${LOC[lv.kind].label} · ${text}`; mate = mate ? `${LOC[lv.kind].label} · ${mate}` : null; away = true; }
    return { text, mate: mate ?? text, away, code, half: !!lv, partial };
  }
  // 그 날 그 사람이 팀 근무지로 출근하는지 (개인 근무지가 없고, 종일 휴가·종일 외근이 아님)
  const followsTeam = (pid: string, k: string) => {
    const lv = leaveOf(pid, k); if (lv && !HALF[lv.kind]) return false;
    if (s.memberOverrides.some((o) => o.member_id === pid && o.work_date === k)) return false;
    const om = outMeeting(pid, k); return !(om && !om.at);
  };
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

  // 팀원 한 명의 그날 상태(평소와 다를 때만). key 는 '같은 상태가 이어지는지' 비교용 — 휴가는 같은 휴가(행)일 때만 이어짐으로 본다
  //   (금요일 연차·월요일 연차를 따로 등록하면 다른 휴가 → 새 소식) (2026-11-03)
  const statusOf = (o: Member, k: string): { text: string; key: string } | null => {
    const lv = leaveOf(o.id, k);
    if (lv && !HALF[lv.kind]) return { text: `${o.name} ${LOC[lv.kind].label}`, key: `lv:${lv.id ?? lv.from_date}` };
    const p = placeOf(o.id, k); return p?.away ? { text: `${o.name} ${short(p.mate)}`, key: `${lv ? "lv:" + (lv.id ?? lv.from_date) + ":" : ""}${p.text}` } : null;
  };
  // 다음 근무일 안내의 팀원 줄: 장소별로 묶어 전원 (2026-11-04 사용자 결정 — 평소와 같은 사람도, 휴가자도 포함)
  //   '시청역2호점: 이나래, 박다온(오후반차) · 재택: 최라온 · 연차: 한별'. 근무하는 곳은 사람 많은 순(같으면 팀 근무지 먼저), 휴가는 뒤에.
  //   묶는 곳은 아침에 가는 곳 — 시간 있는 미팅은 팀 근무지에 두고 '(14:00 외근)', 종일 외근은 '외근'.
  const groupedMates = (ms: Member[], k: string): string => {
    const t = teamLoc(k)!, work = new Map<string, string[]>(), off = new Map<string, string[]>();
    for (const o of ms) {
      const lv = leaveOf(o.id, k);
      if (lv && !HALF[lv.kind]) { const g = LOC[lv.kind]?.label || "휴가"; off.set(g, [...(off.get(g) || []), o.name]); continue; }
      const ov = s.memberOverrides.find((x) => x.member_id === o.id && x.work_date === k);
      let g = short(teamFull(t)); const tag: string[] = lv ? [LOC[lv.kind].label] : [];
      if (ov && !(ov.loc === t.code && (ov.loc !== "other" || (ov.branch || "") === (t.branch || "")))) g = short(ov.loc === "other" && ov.branch ? ov.branch : LOC[ov.loc]?.full || ov.loc);
      else if (!ov) { const om = outMeeting(o.id, k); if (om?.at) tag.push(`${om.at} 외근`); else if (om) g = "외근"; }
      work.set(g, [...(work.get(g) || []), tag.length ? `${o.name}(${tag.join(", ")})` : o.name]);
    }
    const fmt = (m: Map<string, string[]>) => [...m.entries()].map(([g, ns]) => `${g}: ${ns.join(", ")}`);
    const home = short(teamFull(t));   // 같은 인원이면 팀 근무지를 앞에
    return [...fmt(new Map([...work.entries()].sort((a, b) => b[1].length - a[1].length || (b[0] === home ? 1 : 0) - (a[0] === home ? 1 : 0)))), ...fmt(off)].join(" · ");
  };
  const notes: Note[] = [];
  const join2 = (...xs: (string | null)[]) => xs.filter(Boolean).join(" · ");
  const subsOf = (pid: string) => s.subs.filter((x) => x.member_id === pid);

  // ① 다음 근무일 안내 — 근무일 18:00, 다음 근무일 기준 (금요일 → 월요일, 공휴일 전날 → 그다음 평일). 매 근무일 보낸다 (2026-11-04 사용자 결정)
  //   문구: 제목에 내가 갈 곳, 본문은 제목에 없는 것만 — 팀원 전원(장소별 묶음) · 팀 근무지 사유 · 내 일정. '(평소와 다름)'·건수 같은 설명은 쓰지 않는다.
  //   다음 근무일 종일 휴가인 사람에게는 보내지 않는다(받는 사람들의 팀원 줄에는 '연차: 이름'으로 나옴).
  const briefed = new Set<string>(); let briefK = "";
  if (!isOff(today) && nowMin >= BRIEF_FROM && nowMin < BRIEF_TO) {
    const k = nextWorkday(today); briefK = k;
    const teamOv = s.teamOverrides.find((o) => o.work_date === k);
    const teamChanged = !!teamOv || s.routines.some((r) => r.valid_from === k && !sameAsPrev(r));
    for (const m of s.members) {
      if (!subsOf(m.id).some((x) => x.morning_brief)) continue;   // 컬럼 이름은 morning_brief 지만 '다음 근무일 안내' 켜기/끄기로 쓴다
      const place = placeOf(m.id, k);
      if (!place) continue; // 다음 근무일 종일 휴가
      const items = timedItems(m.id, k), allday = alldayItems(m.id, k);
      const list = [...allday.map((t) => `종일 ${t}`), ...items.map((it) => `${it.start} ${it.title}`)];
      const mates = groupedMates(s.members.filter((o) => o.id !== m.id), k);
      const title = briefTitle(k === tomorrow ? "내일" : "다음 근무일", k, place);
      // 본문 순서 (2026-11-04 사용자 결정): 팀원 근무지 → 팀 근무지 사유 → 내 일정. 내 근무지는 제목.
      const lines: string[] = mates ? [mates] : [];
      // 팀 근무지를 그날만 바꿨으면: 내가 따로 가면 팀 전체가 어디인지, 팀과 같이 가면(제목에 있음) 사유만
      if (teamChanged) { const tf = short(teamFull(teamLoc(k))), why = teamOv?.note || null;
        // 아침에 팀과 같은 곳으로 가면(오후 미팅·반차) 제목에 이미 있으므로 사유만 (2026-11-04)
        const apart = place.away && !place.partial && !(place.half && place.code === teamLoc(k)!.code);
        if (apart) lines.push(join2(`팀 전체 ${tf}`, why)); else if (why) lines.push(why); }
      if (list.length) lines.push(`일정: ${list.slice(0, 3).join(", ")}${list.length > 3 ? ` 외 ${list.length - 3}건` : ""}`);
      notes.push({ key: `e:${k}:${m.id}`, member: m.id, kind: "brief", title, body: lines.join("\n"), url: URL_CAL, tag: `e:${k}`, ttl: 14 * 3600, urgency: "normal" });
      briefed.add(m.id);
    }
  }

  // ② 변경 알림 — 감사 로그를 변경 기록으로 읽는다. 바꾼 본인에게는 보내지 않는다.
  //   팀 근무지·팀원 개인 근무지·휴가·미팅 외근(오늘~다음 근무일) → 전원, 주간 패턴(8일 안에 쓰임) → 전원, 일정(7일 안 회차) → 참석자
  //   밤에는 처리하지 않고(처리 위치도 그대로) 아침 07:30 이후 첫 실행에서 한꺼번에 — 그때 기준 '오늘·내일'로 다시 판단한다.
  //   같은 대상(같은 행·같은 날)을 한 실행 안에서 여러 번 바꿨으면 처음과 마지막만 비교해 한 건으로 — 지웠다 되돌림은 보내지 않는다 (2026-11-03)
  //   문구: 제목 = 누가/무엇이 어떻게, 본문 = 언제 · 바뀐 내용 · 이유 · 바꾼 사람(당사자와 다를 때). 제목을 본문에서 반복하지 않는다.
  let cursor: number | null = null;
  if (quiet) return { notes, cursor };
  const watchers = (exclude: string | undefined) => s.members.filter((m) => m.id !== exclude && subsOf(m.id).some((x) => x.change_alerts)).map((m) => m.id);
  // 당사자: 남이 내 근무지·휴가·일정을 바꾸면 날짜와 상관없이(오늘 이후) 나에게는 보낸다 (2026-11-04 사용자 결정 — 다른 팀원 범위는 그대로)
  const ownerOnly = (pid: string | null | undefined, actor: string | undefined) => pid && pid !== actor && subsOf(pid).some((x) => x.change_alerts) ? [pid] : [];
  const dayWord = (k: string) => (k === today ? "오늘" : k === tomorrow ? "내일" : fmtD(k));
  // 근무지 변경을 알리는 범위: 오늘 ~ 다음 근무일(최소 모레). 금요일 오후 안내 뒤 월요일을 바꿔도 알린다
  const until = [addDay(today, 2), nextWorkday(today)].sort()[1];
  // 제목에 날짜가 이미 있으면(오늘·내일이 아닌 날) 본문에서는 날짜를 빼서 같은 말을 두 번 하지 않는다
  const dateLine = (k: string) => dayWord(k) === fmtD(k) ? null : fmtD(k);
  const inLoc = (k: string | undefined) => !!k && k >= today && k <= until && !isOff(k);
  const rangeDays = () => { const out: string[] = []; for (let k = today; k <= until; k = addDay(k, 1)) if (!isOff(k)) out.push(k); return out; };
  const alive = (x: Row | null | undefined) => !!x && !x.deleted_at;
  const join = (...xs: (string | null | undefined | false)[]) => xs.filter(Boolean).join(" · ");
  const byWho = (actor: string | undefined, subject?: string, verb = "변경") => actor && actor !== subject ? `${memberName(actor)} ${verb}` : null;
  let curAt = 0, curDay = "";   // 지금 처리 중인 변경 기록의 시각·대상 날짜 (note 가 함께 적는다)
  const note = (key: string, member: string, title: string, body: string, tag: string, day = curDay) =>
    notes.push({ key, member, kind: "change", title, body, url: URL_CAL, tag, ttl: 86400, urgency: "normal", day, at: curAt });
  const secs = (x: unknown, y: unknown) => Math.abs(Date.parse(String(x)) - Date.parse(String(y))) / 1000;

  // 묶기: 표마다 '같은 대상' 기준
  const gkey = (x: Row) => { const r = (x.op === "DELETE" ? x.before : x.after) || {};
    switch (x.table_name) {
      case "team_work_overrides": return `two|${r.work_date}`;
      case "member_work_overrides": return `mwo|${r.member_id}|${r.work_date}`;
      case "team_work_routines": return `twr|${r.valid_from}`;
      case "wishket_projects": return `wp|${r.slug}`;
      default: return `${x.table_name}|${r.id}`;
    } };
  const groups: Record<string, Row[]> = {};
  for (const x of s.audit) (groups[gkey(x)] ||= []).push(x);

  // 반복 일정 나누기 짝: 새 일정(parent_id) INSERT 와 원래 반복의 exdates·repeat_until 갱신 — 같은 사람이 몇 초 안에 한 것
  //   (감사 번호 차이로 판단하면 그 사이 다른 표의 기록이 끼어 짝을 놓친다)
  const SPLIT_SEC = 15;
  const parentUpdateOf = (child: Row, at: unknown, actorId: unknown) => s.audit.find((x) => x.table_name === "calendar_events" && x.op === "UPDATE"
    && x.before?.id === child.parent_id && x.actor_id === actorId && secs(x.at, at) <= SPLIT_SEC);
  const isSplitParentUpdate = (a: Row, b: Row, f: Row) => {
    const keys = ["exdates", "repeat_until"], all = ["title", "event_date", "start_time", "end_time", "place", "people", "repeat", "meeting_type", "all_day", "deleted_at", "auto_out", "kind"];
    if (all.some((c) => JSON.stringify(b[c] ?? null) !== JSON.stringify(f[c] ?? null)) || !keys.some((c) => JSON.stringify(b[c] ?? null) !== JSON.stringify(f[c] ?? null))) return false;
    return s.audit.some((x) => x.table_name === "calendar_events" && x.op === "INSERT" && x.after?.parent_id === f.id && x.actor_id === a.actor_id && secs(x.at, a.at) <= SPLIT_SEC)
      || s.events.some((e) => e.parent_id === f.id && e.created_at && secs(e.created_at, a.at) <= SPLIT_SEC);   // 짝이 앞 실행에서 이미 처리된 경우
  };

  // 미팅 때문에 그날 외근인지 (캘린더 대면 미팅 '외근 표시' · 위시켓 대면 미팅)
  const evOut = (e: Row | null | undefined, pid: string, k: string) => alive(e) && e!.type === "meeting" && e!.meeting_type === "inperson" && !!e!.auto_out && (e!.people || []).includes(pid) && occursOn(e!, k, s.holidays);
  const wkOut = (w: Row | null | undefined, pid: string, k: string) => !!w && w.meeting_type === "inperson" && !!w.meeting_at && kstKey(Date.parse(w.meeting_at)) === k && [w.assigned_main, w.assigned_sub].includes(pid) && !atOffice(w.meeting_place);
  // 미팅으로 누군가의 근무지가 바뀌었을 때 → to 에게 근무지 알림. 개인 근무지를 직접 정한 날은 그게 우선이라 보내지 않는다.
  function meetingLocNotes(a: Row, actor: string | undefined, pids: string[], to: string[], wasOut: (pid: string, k: string) => boolean, isOut: (pid: string, k: string) => boolean, why: (k: string) => string) {
    for (const pid of pids) for (const k of rangeDays()) {
      const was = wasOut(pid, k), is = isOut(pid, k);
      if (was === is || s.memberOverrides.some((o) => o.member_id === pid && o.work_date === k)) continue;
      const p = placeOf(pid, k); if (!p) continue;
      if (!is && p.code === "out") continue;   // 다른 미팅으로 여전히 외근이면 바뀐 게 없음
      const nm = memberName(pid);
      for (const t of to) note(`c:${a.id}:${t}:${pid}:${k}`, t, `${is ? "🚕" : placeIcon(p)} ${nm} ${dayWord(k)} ${short(p.mate)}`,
        join(dateLine(k), is ? why(k) : "미팅이 취소·변경돼 외근 해제", byWho(actor, pid)), `who:${pid}:${k}`, k);
    }
  }
  // 일정 한 건의 사람이 읽을 시간 문구
  const timeOf = (e: Row) => e.all_day ? "종일" : hm(e.start_time) + (e.end_time ? `–${hm(e.end_time)}` : "");
  // 일정 두 판(바꾸기 전 b·그 회차 날짜 bk / 바꾼 뒤 f·fk)의 차이를 짧은 문구로
  function evDiff(b: Row, bk: string, f: Row, fk: string): string[] {
    const d: string[] = [];
    if (bk !== fk) d.push(`날짜 ${fmtD(bk)} → ${fmtD(fk)}`);
    if (timeOf(b) !== timeOf(f)) d.push(`시간 ${timeOf(b)} → ${timeOf(f)}`);
    if ((b.title || "") !== (f.title || "")) d.push(`제목 ${b.title} → ${f.title}`);
    if ((b.place || "") !== (f.place || "")) d.push(`장소 ${b.place || "없음"} → ${f.place || "없음"}`);
    if ((b.meeting_type || "") !== (f.meeting_type || "") && f.meeting_type) d.push(`${MT[b.meeting_type] || "-"} → ${MT[f.meeting_type]}`);
    const bp: string[] = b.people || [], fp: string[] = f.people || [];
    const plus = fp.filter((x) => !bp.includes(x)).map(memberName), minus = bp.filter((x) => !fp.includes(x)).map(memberName);
    if (plus.length || minus.length) d.push(`참석 ${[...plus.map((n) => "+" + n), ...minus.map((n) => "−" + n)].join(" ")}`);
    return d;
  }

  for (const a of s.audit) {
    cursor = Math.max(cursor ?? 0, Number(a.id));
    const g = groups[gkey(a)];
    if (g[g.length - 1] !== a) continue;               // 같은 대상의 마지막 기록에서 한 번에 처리
    const first = g[0];
    curAt = Date.parse(a.at) || 0; curDay = "";
    const actor = a.actor_id ? byUser[a.actor_id] : undefined;
    const b: Row = (first.op === "INSERT" ? null : first.before) || {}, f: Row = (a.op === "DELETE" ? null : a.after) || {};
    const hadB = first.op !== "INSERT", hasF = a.op !== "DELETE";

    if (a.table_name === "team_work_overrides") {
      const k = (f.work_date || b.work_date) as string; curDay = k;
      if (!inLoc(k)) continue;
      if (hadB && hasF && b.loc === f.loc && (b.branch || "") === (f.branch || "") && (b.note || "") === (f.note || "")) continue;
      if (!hadB && !hasF) continue;
      const t = teamLoc(k);
      // 팀 근무지를 따르는 사람에게만 (2026-11-04 사용자 결정): 종일 휴가·개인 근무지·종일 외근이 있으면 그 사람이 갈 곳은 안 바뀐다.
      //   반차·시간 있는 미팅은 팀 근무지로 출근하므로 받는다. 아무도 안 따르면 보내지 않음.
      for (const w of watchers(actor).filter((pid) => followsTeam(pid, k))) note(`c:${a.id}:${w}`, w, `🏢 ${dayWord(k)} 팀 근무지 ${short(teamFull(t))}`,
        join(dateLine(k), hasF ? f.note : "원래 근무지로", byWho(actor)), `team:${k}`);
    } else if (a.table_name === "member_work_overrides") {
      // 팀원 개인 근무지 → 바꾼 사람 뺀 전원 (남이 바꾸면 당사자도)
      const sig = (x: Row, has: boolean) => has ? `${x.loc}|${x.branch || ""}` : "";
      if (sig(b, hadB) === sig(f, hasF)) continue;   // 바꿨다 되돌림
      const pid = (f.member_id || b.member_id) as string, k = (f.work_date || b.work_date) as string; curDay = k;
      if (!pid || !k || k < today || isOff(k)) continue;
      const to = inLoc(k) ? watchers(actor) : ownerOnly(pid, actor);   // 다음 근무일 너머는 당사자에게만
      const p = placeOf(pid, k); if (!p) continue;   // 그날 종일 휴가면 근무지는 의미 없음
      const nm = memberName(pid);
      for (const w of to) note(`c:${a.id}:${w}`, w, `${p.partial ? "🚕" : placeIcon(p)} ${nm} ${dayWord(k)} ${short(p.mate)}`,
        join(dateLine(k), hasF ? f.note : "원래 근무지로", byWho(actor, pid)), `who:${pid}:${k}`);
    } else if (a.table_name === "team_leaves") {
      // 휴가 등록·수정·취소가 오늘~다음 근무일에 걸치면 → 바꾼 사람 뺀 전원. 사유만 고친 건 보내지 않음. 지웠다 되돌림은 없음.
      const was = hadB && alive(b), is = hasF && alive(f);
      const hits = (x: Row) => !!x.from_date && x.from_date <= until && x.to_date >= today;
      const range = (x: Row) => `${fmtD(x.from_date)}${x.to_date !== x.from_date ? "–" + fmtD(x.to_date) : ""}`;
      const lb = (x: Row) => LOC[x.kind]?.label || "휴가";
      const future = (x: Row) => !!x.to_date && x.to_date >= today;
      // 오늘~다음 근무일에 걸치면 전원, 그 뒤면 당사자에게만
      const toOf = (x: Row) => hits(x) ? watchers(actor) : future(x) ? ownerOnly(x.member_id, actor) : [];
      const send = (x: Row, verb: string, extra: string | null) => { const to = toOf(x); if (!to.length) return;
        curDay = briefK && x.from_date <= briefK && x.to_date >= briefK ? briefK : x.from_date;
        for (const w of to) note(`c:${a.id}:${w}:${x.member_id}`, w, `🌴 ${memberName(x.member_id)} ${lb(x)} ${verb}`,
          join(range(x), extra, x.note && verb !== "취소" ? x.note : null, byWho(actor, x.member_id, verb)), `leave:${x.id ?? x.member_id + x.from_date}`); };
      if (!was && !is) continue;
      if (!was) send(f, "등록", null);
      else if (!is) send(b, "취소", null);
      else if (b.member_id !== f.member_id) { send(b, "취소", null); send(f, "등록", null); }
      else if (b.from_date !== f.from_date || b.to_date !== f.to_date || b.kind !== f.kind) {
        const x = hits(f) ? f : b, to = hits(f) || hits(b) ? watchers(actor) : future(f) || future(b) ? ownerOnly(f.member_id, actor) : [];
        if (!to.length) continue;
        const changes = join(b.kind !== f.kind ? `${lb(b)} → ${lb(f)}` : null, (b.from_date !== f.from_date || b.to_date !== f.to_date) ? `${range(b)} → ${range(f)}` : null);
        for (const w of to) note(`c:${a.id}:${w}:${x.member_id}`, w, `🌴 ${memberName(x.member_id)} ${lb(f)} 변경`, join(changes, byWho(actor, x.member_id)), `leave:${f.id}`);
      }
    } else if (a.table_name === "wishket_projects") {
      // 위시켓 대면 미팅 일시·방식·담당이 바뀌어 누군가의 근무지(외근)가 바뀌면 → 바꾼 사람 뺀 전원 (일정 알림 대상이 아니라 담당자도 받음)
      if (hadB && hasF && !["meeting_at", "meeting_type", "assigned_main", "assigned_sub"].some((c) => (b[c] ?? null) !== (f[c] ?? null))) continue;
      const pids = [...new Set([b.assigned_main, b.assigned_sub, f.assigned_main, f.assigned_sub].filter(Boolean))] as string[];
      const title = (f.title || b.title || "수주 미팅") as string;
      meetingLocNotes(a, actor, pids, watchers(actor), (pid, k) => hadB && wkOut(b, pid, k), (pid, k) => hasF && wkOut(f, pid, k),
        () => "수주 미팅");
    } else if (a.table_name === "team_work_routines") {
      if (!hasF || !f.valid_from || f.valid_from > addDay(today, 7)) continue;
      const cur = s.routines.find((x) => x.valid_from === f.valid_from) || f;
      if (sameAsPrev(cur)) continue;   // 같은 내용을 다시 저장
      if (![0, 1, 2, 3, 4, 5, 6, 7].some((i) => routineAt(addDay(today, i))?.valid_from === f.valid_from)) continue;   // 앞으로 8일 중 쓰이는 날이 없음(지난 패턴)
      const prev = [...s.routines].filter((x) => x.valid_from < cur.valid_from).sort((x, y) => (x.valid_from < y.valid_from ? 1 : -1))[0];
      const diff = [1, 2, 3, 4, 5].filter((w) => (prev?.days?.[String(w)] || "cityhall") !== (cur.days?.[String(w)] || "cityhall"))
        .map((w) => `${WD[w]} ${LOC[cur.days?.[String(w)] || "cityhall"]?.label}`).join(", ");
      for (const w of watchers(actor)) note(`c:${a.id}:${w}`, w, `🗓 ${fmtD(cur.valid_from)}부터 주간 근무 패턴 변경`, join(diff || null, byWho(actor)), "routine");
    } else if (a.table_name === "calendar_events") {
      // 나누기(이 회차만·이후 전부): 원래 반복 쪽 갱신은 건너뛰고 새 일정 쪽에서 한 건으로
      if (hadB && hasF && first === a && isSplitParentUpdate(a, b, f)) continue;
      const split = !hadB && hasF && !!f.parent_id;
      const pu = split ? parentUpdateOf(f, first.at, first.actor_id) : null;
      // 비교 기준: 나누기면 원래 반복(바꾸기 전) — 그 회차 날짜는 exdates 에 새로 들어간 날(이 회차만) 또는 repeat_until 다음 날(이후 전부)
      let base: Row | null = hadB ? b : null, baseK: string | null = null, splitWord: string | null = split ? "이 회차 수정" : null;
      if (pu) {
        base = pu.before;
        const added = (pu.after.exdates || []).filter((x: string) => !(pu.before.exdates || []).includes(x));
        baseK = added[0] || (pu.after.repeat_until ? addDay(pu.after.repeat_until, 1) : null);
        splitWord = added.length ? "이 회차만" : "이후 전부";
      }
      const was = alive(base), is = hasF && alive(f);
      if (!was && !is) continue;
      // 근무지(대면 미팅 외근) — 참석자가 아닌 팀원에게
      if (!split || pu) {
        const crowd = new Set<string>([...(base?.people || []), ...(f.people || [])]);
        meetingLocNotes(a, actor, [...crowd], watchers(actor).filter((t) => !crowd.has(t)),
          (pid, k) => evOut(base, pid, k), (pid, k) => (is && evOut(f, pid, k)) || (!!pu && evOut(pu.after, pid, k)),
          () => f.all_day ? "종일 대면 미팅" : f.end_time ? `대면 미팅 ~${hm(f.end_time)}` : "대면 미팅");
      }
      // 일정 알림 — 참석자(전·후)에게. 기준 회차: 바꾸기 전 회차가 7일 안이면 그 날(옮긴 경우 '날짜 a → b'), 아니면 바꾼 뒤 회차
      // 참석자·만든 사람은 당사자라 날짜와 상관없이(오늘 이후, 1년 안 회차) 받는다 (2026-11-04, 전엔 7일 안만)
      const inEv = (k: string | null) => !!k && k >= today && k <= addDay(today, EV_DAYS);
      const exOnly = was && is && !split && JSON.stringify(b.exdates || []) !== JSON.stringify(f.exdates || []) && evDiff(b, "", f, "").length === 0
        && ["repeat", "repeat_until", "all_day", "auto_out"].every((c) => JSON.stringify(b[c] ?? null) === JSON.stringify(f[c] ?? null));
      if (exOnly) {
        // 반복 일정 한 회차만 삭제·되돌림 → 그 회차 날짜로 '취소'·'추가'
        const addedX = (f.exdates || []).filter((x: string) => !(b.exdates || []).includes(x)).filter(inEv).sort()[0];
        const removedX = (b.exdates || []).filter((x: string) => !(f.exdates || []).includes(x)).filter(inEv).sort()[0];
        const k = addedX || removedX; if (!k) continue;
        const maker = byUser[f.created_by as string], ppl = [...new Set([...(f.people || []), ...(maker ? [maker] : [])])];
        for (const pid of ppl.filter((x: string) => x !== actor && subsOf(x).some((y) => y.change_alerts)))
          note(`c:${a.id}:${pid}`, pid, `${addedX ? "✖️" : "➕"} ${f.title} ${addedX ? "취소" : "추가"}`, join(`${fmtD(k)} ${timeOf(f)}`, "이 회차만", byWho(actor, undefined, addedX ? "취소" : "추가")), `ev:${f.id}`);
        continue;
      }
      const bk = was ? (baseK && occursOn({ ...base, exdates: [] }, baseK, s.holidays) ? baseK : firstWithin(base!, today, EV_DAYS, s.holidays)) : null;
      const fk = is ? firstWithin(f, today, EV_DAYS, s.holidays) || (bk && f.event_date) || null : null;
      const anchorK = inEv(bk) ? bk : inEv(fk) ? fk : null;
      if (!anchorK) continue;
      curDay = anchorK;
      const anchor = anchorK === bk ? base! : f;
      const everyone = new Set<string>([...(base?.people || []), ...(f.people || [])]);
      // 만든 사람이 참석자가 아니어도, 남이 그 일정을 바꾸면 알린다
      const maker = byUser[(base?.created_by || f.created_by) as string];
      const makerOnly = !!maker && !everyone.has(maker);
      if (makerOnly) everyone.add(maker);
      const repeatAll = was && !is && !!base?.repeat && !split;
      const diff = was && is ? evDiff(base!, bk || anchorK, f, fk || (f.repeat ? anchorK : f.event_date)) : [];
      if (was && is && !diff.length && !split) continue;   // 메모·성격 등 알릴 필요 없는 수정
      for (const pid of everyone) {
        if (pid === actor || !subsOf(pid).some((y) => y.change_alerts)) continue;
        const asMaker = makerOnly && pid === maker;
        const inB = was && (asMaker || (base!.people || []).includes(pid)), inF = is && (asMaker || (f.people || []).includes(pid));
        const verb = split ? ["✏️", "변경"] : !inB && inF ? ["➕", "추가"] : inB && !inF ? ["✖️", was && is ? "참석 빠짐" : "취소"] : ["✏️", "변경"];
        const showDiff = verb[1] === "변경" && diff.length > 0;
        const dateMoved = showDiff && diff.some((x) => x.startsWith("날짜")), timeMoved = showDiff && diff.some((x) => x.startsWith("시간"));
        const when = repeatAll ? `매주 ${WD[dow(base!.event_date)]} ${timeOf(base!)} · 반복 전체`
          : dateMoved ? (timeMoved ? null : timeOf(anchor)) : `${fmtD(anchorK)}${timeMoved ? "" : " " + timeOf(anchor)}`;
        const actVerb = verb[1] === "추가" ? "추가" : verb[1] === "취소" ? "취소" : "변경";
        note(`c:${a.id}:${pid}`, pid, `${verb[0]} ${(f.title || base?.title) as string} ${verb[1]}`,
          join(when, showDiff ? diff.join(", ") : null, splitWord, byWho(actor, undefined, actVerb)), `ev:${f.id || base?.id}`);
      }
    }
  }
  // 같은 실행에서 다음 근무일 안내를 받는 사람에게, 그 날에 대한 변경 중 18:00(BRIEF_FROM) 전에 한 것은 안내에 이미 담겼으니 따로 보내지 않는다 (2026-11-03)
  //   18:00 이후 변경은 안내(첫 실행에 이미 나감)에 없을 수 있어 그대로 보낸다 — 알림이 빠지는 쪽으로는 줄이지 않는다
  if (briefed.size) {
    const cut = Date.parse(`${today}T${String(Math.floor(BRIEF_FROM / 60)).padStart(2, "0")}:${String(BRIEF_FROM % 60).padStart(2, "0")}:00+09:00`);
    const kept = notes.filter((n) => !(n.kind === "change" && n.day === briefK && briefed.has(n.member) && (n.at || 0) < cut && n.at));
    return { notes: kept, cursor };
  }
  return { notes, cursor };
}
