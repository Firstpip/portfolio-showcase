// 수주 미팅 저장 규칙 — 워크룸 프로젝트 탭과 캘린더 '수주 미팅'이 같은 규칙으로 저장하도록 한곳에 둔다 (2026-11-23)
//
// 미팅의 원천은 프로젝트의 meeting_at·meeting_type 한 칸과 history(이력)다. 캘린더 일정 표(calendar_events)로 옮기지 않는다 —
// 상태 전환(지원 완료 → 미팅 예정, 삭제 시 되돌림)·이력·퍼널·근무지 규칙이 모두 이 칸에 걸려 있다.
// 여기 함수는 순수 계산만 한다: 무엇을 이력에 남기고 어떤 칸을 바꿀지({ entries, fields })를 돌려주고,
// 실제 저장은 호출하는 쪽이 append_project_history RPC 로 한다.
import { kstParts } from './dates.mjs';

export const MEETING_TYPE_LABEL = { video: '화상', inperson: '대면', phone: '전화' };
export const meetingTypeLabel = (k) => MEETING_TYPE_LABEL[k] || '미지정';
export const sameInstant = (a, b) => !!a && !!b && new Date(a).getTime() === new Date(b).getTime();
export function formatMeetingAt(iso) { const p = kstParts(iso); return p ? `${p.date} ${p.time}` : null; }

// 같은 미팅(meeting_at 동일)의 가장 최근 메모 — history는 append-only라 "수정"은 새 항목 추가로 표현됨
export function latestMeetingMemo(history, meetingAt) {
  if (!meetingAt) return '';
  const hs = (history || []).filter(h => sameInstant(h.meeting_at, meetingAt) && h.meeting_memo);
  return hs.length ? hs[hs.length - 1].meeting_memo : '';
}

// 캘린더에서 수주 미팅을 잡을 수 있는 단계 — 지원 완료(첫 미팅) · 미팅 예정(변경) · 미팅 완료(추가 미팅)
export const MEETING_STAGES = { applied: '지원 완료', interview: '미팅 예정', meeting_done: '미팅 완료' };

// '미팅 완료' + 기존 미팅 있음 → 추가 미팅 등록(새 미팅). 그 외 → 현재 미팅 수정
export const isAddMeetingMode = (project) => project?.current_status === 'meeting_done' && !!project?.meeting_at;

/**
 * 미팅 저장 계획.
 * @param project  프로젝트 행(current_status, meeting_at, meeting_type, history)
 * @param input    { iso: 미팅 시각 ISO, type: 'video'|'inperson'|'phone', memo: 문자열 }
 * @returns { entries, fields } — append_project_history 에 그대로 넘긴다
 */
export function planMeetingSave(project, { iso, type, memo }, nowMs = Date.now()) {
  const st = project.current_status;
  const t = type || null;
  const m = (memo || '').trim() || null;
  const addMode = isAddMeetingMode(project);
  const current = project.meeting_at ? { meeting_at: project.meeting_at, meeting_type: project.meeting_type } : null;
  const isFuture = new Date(iso).getTime() > nowMs;
  // 미래 일시 등록 시 '미팅 예정'으로 전환되는 상태: 지원(applied) / 미팅 완료(meeting_done)
  if (isFuture && (st === 'applied' || st === 'meeting_done')) {
    const entries = [];
    if (st === 'meeting_done' && current) {
      entries.push({ status: 'meeting_done', note: '미팅 완료 (아카이브)', meeting_at: current.meeting_at,
        meeting_type: current.meeting_type || null, meeting_memo: latestMeetingMemo(project.history, current.meeting_at) || null });
    }
    entries.push({ status: 'interview', note: st === 'meeting_done' ? '추가 미팅 예정' : '미팅 예정', meeting_at: iso, meeting_type: t, meeting_memo: m });
    return { entries, fields: { meeting_at: iso, meeting_type: t, current_status: 'interview' } };
  }
  let note;
  if (!current) note = '미팅 등록';
  else if (addMode) note = '지난 미팅 기록 추가';
  else {
    const parts = [];
    if (!sameInstant(iso, current.meeting_at)) parts.push(`일시 ${formatMeetingAt(current.meeting_at)} → ${formatMeetingAt(iso)}`);
    if (t !== (current.meeting_type || null)) parts.push(`종류 ${meetingTypeLabel(current.meeting_type)} → ${meetingTypeLabel(t)}`);
    if ((m || '') !== (latestMeetingMemo(project.history, current.meeting_at) || '')) parts.push('메모 수정');
    note = parts.length ? `미팅 변경 — ${parts.join(', ')}` : '미팅 정보 재저장';
  }
  return { entries: [{ status: st, note, meeting_at: iso, meeting_type: t, meeting_memo: m }], fields: { meeting_at: iso, meeting_type: t } };
}

// 미팅 일정 삭제 계획 — '미팅 예정'에서 일정만 지우면 일정 없는 예정 상태에 갇히므로 지원 완료로 함께 되돌린다 (이력에 명시)
export function planMeetingDelete(project) {
  const revert = project.current_status === 'interview';
  const entries = [{ status: revert ? 'applied' : project.current_status, note: `미팅 일정 삭제 (${formatMeetingAt(project.meeting_at)})${revert ? ' — 지원 완료로 되돌림' : ''}` }];
  const fields = { meeting_at: null, meeting_type: null, ...(revert ? { current_status: 'applied' } : {}) };
  return { entries, fields, revert };
}
