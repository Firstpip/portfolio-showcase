// 미팅 ↔ 팀 근무지 (2026-11-23 사용자 QA)
//
// 사람이 3명이라 우리 사무실에서 하는 대면 미팅이 잡히면 그날 팀 근무지를 그 사무실로 바꾸는 일이 많다.
// 그런데 미팅을 옮기거나 취소하면 옛 날짜의 근무지는 사람이 기억해서 따로 되돌려야 했고, 알림도 따로 나갔다.
// 여기서는 미팅 저장 직전에 '근무지 영향'을 계산한다(순수 계산 — 읽기·쓰기는 호출하는 쪽):
//   ① 새 날짜: 대면 + 우리 사무실 + 장소가 시청역/서울숲 + 그날 팀 근무지가 그 사무실이 아님 → 팀 근무지를 그 사무실로(기본 선택)
//   ② 옛 날짜: 미팅이 그날에서 빠지고(옮김·취소·화상 전환·장소 변경) 그날 팀 근무지가 평소(주간 패턴)와 다르게 바뀌어 있음
//             → "평소 근무지로 되돌릴까요?" (그날 그 사무실에서 하는 다른 미팅이 남아 있으면 묻지 않는다)
// 쓸 때는 change_note 끝에 [m:<미팅 키>] 를 붙인다 — 알림 서버가 이 표시로 미팅 알림과 근무지 알림을 사람마다 한 건으로 묶는다.

export const OFFICE_OF_PLACE = [['서울숲', 'forest'], ['시청역', 'cityhall']];
export const OFFICE_LABEL = { cityhall: '시청역', forest: '서울숲', home: '재택', other: '다른 장소' };
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const parse = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const fmtDay = (k) => { const d = parse(k); return `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${WD[d.getUTCDay()]})`; };
export const meetTag = (key) => `[m:${key}]`;
export const MEET_TAG_RE = /\[m:([^\]]+)\]/;

/** 장소 글자에서 우리 사무실(시청역/서울숲)을 알아낸다. 모르면 null */
export function officeOfPlace(place) {
  const p = String(place || '');
  for (const [w, code] of OFFICE_OF_PLACE) if (p.includes(w)) return code;
  return null;
}

/** 미팅 한 판이 '우리 사무실 대면 미팅'이면 그 사무실 코드, 아니면 null. m = { k, type, autoOut, place } */
export function officeMeetingOf(m) {
  if (!m || !m.k || m.type !== 'inperson' || m.autoOut !== false) return null;
  return officeOfPlace(m.place);
}

/** 그날 팀 근무지 — routines: [{ from, days:{1..5:code} }], overrides: [{ date, loc, branch, note }] */
export function routineCodeAt(routines, k) {
  const r = [...(routines || [])].filter((x) => x.from <= k).sort((a, b) => (a.from < b.from ? 1 : -1))[0] || (routines || [])[0];
  return r?.days?.[parse(k).getUTCDay()] || 'cityhall';
}
export function teamAt(routines, overrides, k) {
  const ov = (overrides || []).find((o) => o.date === k);
  const usual = routineCodeAt(routines, k);
  return ov ? { code: ov.loc, branch: ov.branch || null, note: ov.note || null, src: 'override', usual } : { code: usual, src: 'routine', usual };
}

/**
 * 근무지 영향 계산.
 * @param prev  옮기기 전 미팅 { k:'YYYY-MM-DD', type, autoOut, place } 또는 null(새 미팅)
 * @param next  옮긴 뒤 미팅 같은 꼴 또는 null(삭제)
 * @param ctx   { today, isOff(k), team(k) → teamAt(..), otherOfficeMeeting(k, code) → bool (이 미팅 말고 그날 그 사무실 대면 미팅이 있나) }
 * @returns { change: { k, from, to } | null, revert: { k, from, usual } | null }
 */
export function planMeetingLoc(prev, next, ctx) {
  const ok = (k) => !!k && k >= ctx.today && !ctx.isOff(k);
  const nOffice = officeMeetingOf(next);
  let change = null, revert = null;
  if (nOffice && ok(next.k)) {
    const t = ctx.team(next.k);
    if (t && t.code !== nOffice) change = { k: next.k, from: t.code, to: nOffice, usual: t.usual };
  }
  // 옛 날짜에서 빠진 미팅이 그날 사무실 근무의 이유였을 수 있는지:
  //   대면이고 외부가 아님. 장소에서 사무실을 알면 그 사무실, 모르면(예전 기록 — 장소·외부 여부 칸이 없던 때) 어느 사무실이든.
  const prevOffice = !prev || prev.type !== 'inperson' || prev.autoOut === true ? null : (officeOfPlace(prev.place) || 'any');
  const leftDay = prevOffice && ok(prev.k) && (!next || next.k !== prev.k || officeMeetingOf(next) !== officeOfPlace(prev.place) || !officeMeetingOf(next));
  if (leftDay && !(change && change.k === prev.k)) {
    const t = ctx.team(prev.k);
    const isOffice = t && (t.code === 'cityhall' || t.code === 'forest');
    if (isOffice && t.src === 'override' && t.code !== t.usual && (prevOffice === 'any' || prevOffice === t.code) && !ctx.otherOfficeMeeting(prev.k, t.code)
      && !(next && next.k === prev.k && officeMeetingOf(next) === t.code)) {   // 같은 날 그 사무실 미팅으로 남아 있으면 그대로
      revert = { k: prev.k, from: t.code, usual: t.usual };
    }
  }
  return { change, revert };
}

/** 사람이 읽을 질문·요약 문구 */
export const changeText = (c, title) => `${fmtDay(c.k)} 팀 근무지 ${OFFICE_LABEL[c.from] || c.from} → ${OFFICE_LABEL[c.to]}${title ? ` (${title} 미팅)` : ''}`;
export const revertText = (r) => `${fmtDay(r.k)} 팀 근무지를 평소대로 ${OFFICE_LABEL[r.usual] || r.usual}(으)로 (지금 ${OFFICE_LABEL[r.from] || r.from})`;

/**
 * 고른 대로 팀 근무지를 쓴다. sb = supabase 클라이언트, choice = { change:bool, revert:bool }, key = 'wp:slug' | 'ev:id'
 * 되돌리기는 '평소와 같으면 그날 기록을 지운다'(캘린더 팀 근무지 저장과 같은 규칙). 지우기 전에 change_note 에 표시를 남겨 알림이 묶이게 한다.
 */
export async function applyMeetingLoc(sb, plan, choice, { key, title, table = 'team_work_overrides' }) {
  const tag = meetTag(key), done = [];
  const fail = (r) => { if (r?.error) throw r.error; return r; };
  if (plan.change && choice.change) {
    const c = plan.change, note = `${title} 미팅`;
    if (c.to === c.usual) {
      fail(await sb.from(table).update({ change_note: `${changeText(c, title)} ${tag}` }).eq('work_date', c.k));
      fail(await sb.from(table).delete().eq('work_date', c.k));
    } else {
      fail(await sb.from(table).upsert({ work_date: c.k, loc: c.to, branch: null, note, change_note: `${changeText(c, title)} ${tag}` }, { onConflict: 'work_date' }));
    }
    done.push(changeText(c));
  }
  if (plan.revert && choice.revert) {
    const r = plan.revert;
    fail(await sb.from(table).update({ change_note: `${fmtDay(r.k)} 팀 근무지 평소대로 · ${title} 미팅 이동·취소 ${tag}` }).eq('work_date', r.k));
    fail(await sb.from(table).delete().eq('work_date', r.k));
    done.push(`${fmtDay(r.k)} 평소대로 ${OFFICE_LABEL[r.usual] || r.usual}`);
  }
  return done;
}
