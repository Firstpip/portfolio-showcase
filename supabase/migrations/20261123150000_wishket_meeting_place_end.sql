-- 수주 미팅 장소·끝나는 시각·외근 여부 (2026-11-23, 캘린더 통합 3단계)
--
-- 왜: 워크룸 프로젝트 탭과 캘린더 '수주 미팅'의 입력 칸을 캘린더 미팅과 같게 맞춘다.
--   전에는 장소 칸이 없어 대면 수주 미팅은 사무실에서 해도 무조건 외근으로 잡혔다.
-- 칸:
--   meeting_place     장소 또는 화상 링크(자유 입력)
--   meeting_end_at    끝나는 시각(선택). 시작보다 늦어야 한다
--   meeting_auto_out  대면 미팅이 외부인지(true=참석자 외근). NULL = 예전 기록 → 장소 글자로 판단(사무실 이름이 없으면 외근)
-- 모두 NULL 허용이라 기존 행·기존 화면에 영향이 없다.
ALTER TABLE public.wishket_projects
  ADD COLUMN IF NOT EXISTS meeting_place text,
  ADD COLUMN IF NOT EXISTS meeting_end_at timestamptz,
  ADD COLUMN IF NOT EXISTS meeting_auto_out boolean;

ALTER TABLE public.wishket_projects
  DROP CONSTRAINT IF EXISTS wishket_projects_meeting_end_after_start;
ALTER TABLE public.wishket_projects
  ADD CONSTRAINT wishket_projects_meeting_end_after_start
  CHECK (meeting_end_at IS NULL OR (meeting_at IS NOT NULL AND meeting_end_at > meeting_at));

-- 이력 추가 RPC: 새 칸 3개를 받는다.
--   meeting_at 을 바꾸면서 meeting_end_at 을 보내지 않으면(새 칸을 모르는 예전 화면) 끝나는 시각은 비운다 —
--   예전 미팅의 끝 시각이 새 시작보다 앞서 제약에 걸리거나, 엉뚱한 끝 시각이 남는 것을 막는다.
CREATE OR REPLACE FUNCTION "public"."append_project_history"("p_slug" "text", "p_entries" "jsonb", "p_fields" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "public"."wishket_projects"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
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
      meeting_place    = CASE WHEN p_fields ? 'meeting_place'    THEN  NULLIF(p_fields->>'meeting_place', '') ELSE t.meeting_place END,
      meeting_end_at   = CASE WHEN p_fields ? 'meeting_end_at'   THEN (p_fields->>'meeting_end_at')::timestamptz
                              WHEN p_fields ? 'meeting_at'       THEN NULL
                              ELSE t.meeting_end_at END,
      meeting_auto_out = CASE WHEN p_fields ? 'meeting_auto_out' THEN (p_fields->>'meeting_auto_out')::boolean ELSE t.meeting_auto_out END,
      current_status   = CASE WHEN p_fields ? 'current_status'   THEN  p_fields->>'current_status'          ELSE t.current_status END,
      start_date       = CASE WHEN p_fields ? 'start_date'       THEN (p_fields->>'start_date')::date       ELSE t.start_date END,
      deadline         = CASE WHEN p_fields ? 'deadline'         THEN (p_fields->>'deadline')::date         ELSE t.deadline END,
      updated_at       = (now() AT TIME ZONE 'Asia/Seoul')::date
  WHERE t.slug = p_slug
  RETURNING t.* INTO r;

  RETURN r;  -- 매칭 행 없으면(잘못된 slug/RLS 차단) NULL
END $$;
