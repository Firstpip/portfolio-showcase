-- 반복 일정 나누기를 한 번에 저장한다 (2026-11-06).
--
-- 왜: 화면이 '이 회차만'·'이후 전부'를 두 번 따로 저장했다(새 일정 INSERT → 원래 반복 UPDATE).
--   두 번째가 실패하면(네트워크 끊김·탭 닫힘) 같은 일정이 두 번 보이고, '이후 전부'면 앞으로의 모든 회차가 겹쳤다.
--   이 함수는 둘을 한 트랜잭션으로 묶어 둘 다 되거나 둘 다 안 되게 한다.
-- 권한: SECURITY INVOKER — 부른 사람 권한으로 돈다. calendar_events RLS(is_staff)가 그대로 적용되므로 권한 상승이 없다.
--   감사 기록·알림 서버의 '나누기 짝' 판단(같은 사람·15초 안 INSERT+UPDATE)도 전과 같게 남는다.
CREATE OR REPLACE FUNCTION public.calendar_split_event(
  p_parent uuid,            -- 나눌 원래 반복 일정
  p_row jsonb,              -- 새 일정(화면 eventRow 결과 + change_note)
  p_parent_exdates date[],  -- 원래 반복의 새 제외 날짜
  p_parent_until date,      -- '이후 전부'면 원래 반복의 새 종료일, '이 회차만'이면 null(그대로)
  p_parent_note text        -- 원래 반복의 변경 메모
) RETURNS uuid
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  r public.calendar_events;
  v_id uuid;
BEGIN
  r := jsonb_populate_record(NULL::public.calendar_events, p_row);
  IF r.parent_id IS DISTINCT FROM p_parent THEN
    RAISE EXCEPTION '새 일정의 parent_id 가 나눌 일정과 다릅니다' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.calendar_events (type, kind, title, event_date, all_day, start_time, end_time, meeting_type, place, people, note,
    repeat, repeat_until, skip_holiday, exdates, parent_id, project_slug, auto_out, change_note)
  VALUES (r.type, r.kind, r.title, r.event_date, coalesce(r.all_day, false), r.start_time, r.end_time, r.meeting_type, r.place,
    coalesce(r.people, '{}'), r.note, r.repeat, r.repeat_until, coalesce(r.skip_holiday, true), coalesce(r.exdates, '{}'),
    r.parent_id, r.project_slug, coalesce(r.auto_out, false), r.change_note)
  RETURNING id INTO v_id;

  UPDATE public.calendar_events
     SET exdates = coalesce(p_parent_exdates, '{}'),
         repeat_until = coalesce(p_parent_until, repeat_until),
         change_note = p_parent_note
   WHERE id = p_parent AND deleted_at IS NULL;
  IF NOT FOUND THEN   -- 원래 일정이 지워졌거나 권한 밖 → 새 일정도 남기지 않는다
    RAISE EXCEPTION '나눌 반복 일정을 찾지 못했습니다' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.calendar_split_event(uuid, jsonb, date[], date, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.calendar_split_event(uuid, jsonb, date[], date, text) TO authenticated;
