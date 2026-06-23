-- 다중 세션 history lost-update 방지용 원자적 append RPC.
-- 배경: 클라이언트가 `[...(project.history||[]), entry]`로 read-modify-write 후 update하면,
--       그 사이 다른 세션이 추가한 history 항목이 통째로 덮어써져 유실됨(last-write-wins).
-- 해결: 서버에서 `history = history || p_entries`로 현재 값 기준 원자적 append + 동반 컬럼 set.
--       자동전이 함수(transition_passed_*)가 이미 쓰는 race-safe 패턴.
--
-- 설계 포인트
-- - p_entries: append할 history 항목들의 배열(미팅 저장은 아카이브+신규 2개 동시이므로 배열).
-- - 각 항목의 date는 KST로 캐논화 → 클라이언트 UTC 날짜로 인한 ±1일 어긋남(통계/Dday) 동시 해결.
-- - p_fields: 함께 set할 컬럼. `?`(키 존재)로 "null로 비우기"와 "미변경"을 구분(start_date 삭제 등).
-- - SECURITY INVOKER(기본) + anon EXECUTE 회수 → 권한은 기존 RLS(authenticated)와 동일, anon 차단.
-- - RETURNS row → 클라이언트가 서버 권위값(병합된 history)으로 로컬 상태 갱신.

CREATE OR REPLACE FUNCTION append_project_history(
  p_slug text,
  p_entries jsonb,
  p_fields jsonb DEFAULT '{}'::jsonb
)
RETURNS wishket_projects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  r wishket_projects;
  v_entries jsonb;
  v_date text := to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD');
BEGIN
  -- 각 항목의 date를 KST로 캐논화
  SELECT COALESCE(jsonb_agg(e || jsonb_build_object('date', v_date)), '[]'::jsonb)
    INTO v_entries
    FROM jsonb_array_elements(p_entries) e;

  UPDATE wishket_projects t
  SET history          = COALESCE(t.history, '[]'::jsonb) || v_entries,
      assigned_manager = CASE WHEN p_fields ? 'assigned_manager' THEN (p_fields->>'assigned_manager')::uuid ELSE t.assigned_manager END,
      assigned_main    = CASE WHEN p_fields ? 'assigned_main'    THEN (p_fields->>'assigned_main')::uuid    ELSE t.assigned_main END,
      assigned_sub     = CASE WHEN p_fields ? 'assigned_sub'     THEN (p_fields->>'assigned_sub')::uuid     ELSE t.assigned_sub END,
      meeting_at       = CASE WHEN p_fields ? 'meeting_at'       THEN (p_fields->>'meeting_at')::timestamptz ELSE t.meeting_at END,
      meeting_type     = CASE WHEN p_fields ? 'meeting_type'     THEN  p_fields->>'meeting_type'            ELSE t.meeting_type END,
      current_status   = CASE WHEN p_fields ? 'current_status'   THEN  p_fields->>'current_status'          ELSE t.current_status END,
      start_date       = CASE WHEN p_fields ? 'start_date'       THEN (p_fields->>'start_date')::date       ELSE t.start_date END,
      deadline         = CASE WHEN p_fields ? 'deadline'         THEN (p_fields->>'deadline')::date         ELSE t.deadline END,
      updated_at       = (now() AT TIME ZONE 'Asia/Seoul')::date
  WHERE t.slug = p_slug
  RETURNING t.* INTO r;

  RETURN r;  -- 매칭 행 없으면(잘못된 slug/RLS 차단) NULL
END $$;

REVOKE EXECUTE ON FUNCTION append_project_history(text, jsonb, jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION append_project_history(text, jsonb, jsonb) TO authenticated;
