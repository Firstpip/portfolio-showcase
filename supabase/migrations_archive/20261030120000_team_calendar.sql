-- ============================================================================
-- 사내 캘린더 (2026-10-30)
-- ----------------------------------------------------------------------------
-- 워크룸 캘린더 탭에서 쓰는 테이블. 직원 3명이 모두 읽고 쓰며, 누가 무엇을 바꿨는지는
-- 기존 범용 감사 트리거(public.log_audit → project_audit_log)로 남긴다.
--
--   team_work_routines   팀 주간 근무 패턴. valid_from 별 버전 — 패턴을 바꿔도 그 이전 날짜는 그대로.
--   team_work_overrides  팀 근무지 하루 예외 (날짜당 1행)
--   member_work_overrides 개인 근무지 하루 예외 (사람·날짜당 1행). 대면 미팅 외근은 저장하지 않고 화면에서 계산.
--   team_leaves          연차·반차·병가 (soft delete)
--   calendar_events      수동 미팅·사내 일정·마감 (매주 반복 + 건너뛴 회차 + 종료일, soft delete)
--   calendar_holidays    공휴일 (읽기 전용. 실제 갱신은 service_role 동기화 — 공공데이터포털 특일 정보)
--
-- 수주 미팅은 여기 저장하지 않는다 — wishket_projects.meeting_at 을 캘린더가 읽기 전용으로 보여 준다.
--
-- 공통:
--   - 사람 참조는 team_members.id (wishket_projects.assigned_* 와 같은 키)
--   - created_by/updated_by 는 auth.uid() (화면에서는 team_members.user_id 로 이름을 찾는다)
--   - change_note: 화면이 쓰는 사람이 읽을 변경 요약("11/3 시청역 → 서울숲"). 감사 로그 after 에 그대로 남는다.
--   - RLS: authenticated 전체 허용(다른 핵심 테이블과 동일), anon 차단
--
-- 롤백: 파일 맨 아래 주석 블록.
-- ============================================================================

-- ── 근무지 코드 ──────────────────────────────────────────────────────────────
-- cityhall 시청역2호점 · forest 서울숲 · other 기타 지점(branch 필수) · home 재택 · out 외근
-- 팀 근무지는 out 을 쓰지 않는다(팀 전체 외근은 없음).

-- CHECK 제약에는 서브쿼리를 못 쓰므로 검사 함수로 분리
CREATE OR REPLACE FUNCTION public.calendar_valid_days(d jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(d) = 'object'
     AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(d) e
                     WHERE e.key NOT IN ('1','2','3','4','5') OR e.value NOT IN ('cityhall','forest','other','home'));
$$;

-- ── 팀 주간 패턴 ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.team_work_routines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  valid_from  date NOT NULL UNIQUE,
  -- {"1":"cityhall","2":"cityhall","3":"home","4":"cityhall","5":"cityhall"}  (1=월 … 5=금)
  days        jsonb NOT NULL,
  change_note text,
  created_by  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT twr_days_shape CHECK (public.calendar_valid_days(days))
);

-- ── 팀 근무지 하루 예외 ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.team_work_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date   date NOT NULL UNIQUE,
  loc         text NOT NULL CHECK (loc IN ('cityhall','forest','other','home')),
  branch      text,
  note        text,
  change_note text,
  created_by  uuid DEFAULT auth.uid(),
  updated_by  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT two_branch_required CHECK (loc <> 'other' OR coalesce(btrim(branch),'') <> '')
);

-- ── 개인 근무지 하루 예외 ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.member_work_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   uuid NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  work_date   date NOT NULL,
  loc         text NOT NULL CHECK (loc IN ('cityhall','forest','other','home','out')),
  branch      text,
  note        text,
  change_note text,
  created_by  uuid DEFAULT auth.uid(),
  updated_by  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, work_date),
  CONSTRAINT mwo_branch_required CHECK (loc <> 'other' OR coalesce(btrim(branch),'') <> '')
);

-- ── 휴가 ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.team_leaves (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   uuid NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  from_date   date NOT NULL,
  to_date     date NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('off','am','pm','sick')),   -- 연차 · 오전반차 · 오후반차 · 병가
  note        text,
  change_note text,
  created_by  uuid DEFAULT auth.uid(),
  updated_by  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CONSTRAINT tl_range CHECK (to_date >= from_date)
);
CREATE INDEX IF NOT EXISTS idx_team_leaves_range ON public.team_leaves (from_date, to_date) WHERE deleted_at IS NULL;

-- 같은 사람의 휴가 기간이 겹치지 않게 (삭제된 것은 제외). 화면에서도 막지만 동시 입력 대비.
CREATE OR REPLACE FUNCTION public.tg_team_leaves_no_overlap() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM public.team_leaves l
    WHERE l.member_id = NEW.member_id AND l.id <> NEW.id AND l.deleted_at IS NULL
      AND l.from_date <= NEW.to_date AND l.to_date >= NEW.from_date
  ) THEN
    RAISE EXCEPTION '같은 기간에 이미 등록된 휴가가 있습니다' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tg_team_leaves_no_overlap ON public.team_leaves;
CREATE TRIGGER tg_team_leaves_no_overlap BEFORE INSERT OR UPDATE ON public.team_leaves
FOR EACH ROW EXECUTE FUNCTION public.tg_team_leaves_no_overlap();

-- ── 수동 일정 ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.calendar_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text NOT NULL CHECK (type IN ('meeting','internal','deadline','other')),
  kind         text CHECK (kind IS NULL OR kind IN ('sales','bid','kickoff','req','review','delivery','maint','partner','etc')),  -- 미팅 성격
  title        text NOT NULL CHECK (btrim(title) <> ''),
  event_date   date NOT NULL,
  all_day      boolean NOT NULL DEFAULT false,
  start_time   time,
  end_time     time,
  meeting_type text CHECK (meeting_type IS NULL OR meeting_type IN ('video','inperson','phone')),
  place        text,
  people       uuid[] NOT NULL DEFAULT '{}',          -- team_members.id
  note         text,
  repeat       text CHECK (repeat IS NULL OR repeat = 'weekly'),
  repeat_until date,
  skip_holiday boolean NOT NULL DEFAULT true,
  exdates      date[] NOT NULL DEFAULT '{}',          -- 건너뛴(또는 따로 고친) 회차
  parent_id    uuid REFERENCES public.calendar_events(id) ON DELETE SET NULL,  -- 반복에서 떼어 낸 회차·이후 분할
  project_slug text,                                  -- wishket_projects.slug (수주 후 건). 프로젝트 삭제 시 화면에서 '연결 끊김'으로 표시
  auto_out     boolean NOT NULL DEFAULT false,        -- 대면 미팅 참석자를 그날 외근으로 표시
  change_note  text,
  created_by   uuid DEFAULT auth.uid(),
  updated_by   uuid DEFAULT auth.uid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  CONSTRAINT ce_time_order  CHECK (all_day OR start_time IS NOT NULL),
  CONSTRAINT ce_end_after   CHECK (end_time IS NULL OR start_time IS NULL OR end_time > start_time),
  CONSTRAINT ce_until_after CHECK (repeat_until IS NULL OR repeat_until >= event_date)
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON public.calendar_events (event_date) WHERE deleted_at IS NULL;

-- ── 공휴일 ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.calendar_holidays (
  holiday_date date PRIMARY KEY,
  name         text NOT NULL,
  source       text NOT NULL DEFAULT 'manual',        -- manual | data.go.kr
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ── updated_at / updated_by 자동 갱신 ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_calendar_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['team_work_overrides','member_work_overrides','team_leaves','calendar_events'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tg_%s_touch ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER tg_%s_touch BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_calendar_touch()', t, t);
  END LOOP;
END $$;

-- ── 감사 로그 (누가 · 언제 · 무엇을) ─────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['team_work_routines','team_work_overrides','member_work_overrides','team_leaves','calendar_events'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tg_audit_%s ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER tg_audit_%s AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_audit()', t, t);
  END LOOP;
END $$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['team_work_routines','team_work_overrides','member_work_overrides','team_leaves','calendar_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_all_authenticated', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t||'_all_authenticated', t);
  END LOOP;
END $$;

ALTER TABLE public.calendar_holidays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calendar_holidays FROM anon;
GRANT SELECT ON public.calendar_holidays TO authenticated;
DROP POLICY IF EXISTS "calendar_holidays_read" ON public.calendar_holidays;
CREATE POLICY "calendar_holidays_read" ON public.calendar_holidays FOR SELECT TO authenticated USING (true);

-- ── 실시간 반영 (세 명이 동시에 보고 있어도 바로 갱신) ───────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['team_work_routines','team_work_overrides','member_work_overrides','team_leaves','calendar_events'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ── 초기값 ──────────────────────────────────────────────────────────────────
-- 기본 주간 패턴: 월·화·목·금 시청역2호점, 수 재택 (2026-10-30 사용자 지정)
INSERT INTO public.team_work_routines (valid_from, days, change_note, created_by)
VALUES ('2026-01-01', '{"1":"cityhall","2":"cityhall","3":"home","4":"cityhall","5":"cityhall"}', '기본 패턴: 월·화·목·금 시청역, 수 재택', NULL)
ON CONFLICT (valid_from) DO NOTHING;

-- 공휴일: 확실한 날짜만 넣는다. 그 밖의 날짜(설·추석·대체·임시공휴일)는 특일 정보 동기화로 채운다.
INSERT INTO public.calendar_holidays (holiday_date, name) VALUES
  ('2026-10-03','개천절'), ('2026-10-05','대체공휴일'), ('2026-10-09','한글날'),
  ('2026-12-25','성탄절'), ('2027-01-01','신정')
ON CONFLICT (holiday_date) DO NOTHING;

-- ============================================================================
-- 롤백 (필요 시 수동 실행)
-- ----------------------------------------------------------------------------
-- DROP TABLE IF EXISTS public.calendar_events, public.team_leaves, public.member_work_overrides,
--   public.team_work_overrides, public.team_work_routines, public.calendar_holidays CASCADE;
-- DROP FUNCTION IF EXISTS public.tg_team_leaves_no_overlap();
-- DROP FUNCTION IF EXISTS public.tg_calendar_touch();
-- DROP FUNCTION IF EXISTS public.calendar_valid_days(jsonb);
-- (project_audit_log 의 기록은 남겨 둔다)
-- ============================================================================
