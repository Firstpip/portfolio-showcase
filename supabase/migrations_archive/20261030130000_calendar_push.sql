-- ============================================================================
-- 사내 캘린더 푸시 알림 (2026-10-30)
-- ----------------------------------------------------------------------------
-- 기기(브라우저·아이폰 홈 화면 앱)마다 웹 푸시 구독을 저장하고, 5분마다 엣지 함수 calendar-push 가
-- 보낼 알림을 계산해 발송한다.
--   - 미팅 알림     : 참석하는 미팅·일정·수주 미팅 시작 N분 전 (기기별 10/30/60분, 기본 30분)
--   - 아침 브리핑   : 평일 08:30 오늘 내 근무지 + 일정
--   - 변경 알림     : 오늘·내일 팀 근무지 변경, 내가 참석하는 7일 안 일정 추가·변경·취소 (바꾼 본인 제외)
--
--   push_subscriptions  기기별 구독 + 알림 설정. 본인 것만 읽고 쓴다(RLS user_id = auth.uid()).
--   push_sent           보낸 알림 키(중복 발송 방지). 함수(service_role)만 접근.
--   push_state          감사 로그 처리 위치 등 함수 상태. 함수(service_role)만 접근.
--
-- 주기 실행: pg_cron 이 5분마다 pg_net 으로 함수를 호출한다. 헤더의 키는 공개 anon 키(대시보드 HTML 에도 있음)다.
--   누가 함수를 직접 불러도 '지금 보낼 차례인 알림'만, 그것도 push_sent 로 한 번만 나간다 — 비밀값이 필요 없다.
-- VAPID 키는 Supabase 비밀값(VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT)에만 둔다. 저장소에 커밋 금지.
--
-- 롤백: 파일 맨 아래 주석 블록.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL DEFAULT auth.uid(),
  member_id     uuid REFERENCES public.team_members(id) ON DELETE CASCADE,
  endpoint      text NOT NULL UNIQUE,
  p256dh        text NOT NULL,
  auth          text NOT NULL,
  platform      text,                      -- ios-home | desktop | android | other (표시용)
  user_agent    text,
  lead_minutes  integer NOT NULL DEFAULT 30 CHECK (lead_minutes IN (10, 30, 60)),
  morning_brief boolean NOT NULL DEFAULT true,
  change_alerts boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_sent_at  timestamptz,
  fail_count    integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_member ON public.push_subscriptions (member_id);

CREATE TABLE IF NOT EXISTS public.push_sent (
  key     text PRIMARY KEY,                -- 예: m:<일정id>@2026-11-03@30:<member>, b:2026-11-03:<member>, c:<감사id>:<member>
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_sent_at ON public.push_sent (sent_at);

CREATE TABLE IF NOT EXISTS public.push_state (
  name       text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- updated_at 자동 갱신 (캘린더 마이그레이션의 함수 재사용 — updated_by 컬럼은 없으므로 별도 함수)
CREATE OR REPLACE FUNCTION public.tg_push_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS tg_push_subscriptions_touch ON public.push_subscriptions;
CREATE TRIGGER tg_push_subscriptions_touch BEFORE UPDATE ON public.push_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.tg_push_touch();

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
DROP POLICY IF EXISTS "push_subscriptions_own" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_own" ON public.push_subscriptions
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 기기 등록: 같은 기기(endpoint)를 다른 사람이 쓰던 경우에도 지금 로그인한 사람 것으로 넘긴다.
-- (RLS 상 남의 행은 고칠 수 없어서 일반 upsert 로는 실패함) 팀원은 클라이언트 값을 믿지 않고 로그인 계정으로 정한다.
-- 알림 설정은 같은 기기를 다시 켤 때 유지한다(본인 행일 때).
CREATE OR REPLACE FUNCTION public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_platform text, p_user_agent text)
RETURNS public.push_subscriptions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_member uuid;
  v_prev public.push_subscriptions;
  v_row public.push_subscriptions;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다' USING ERRCODE = '42501'; END IF;
  IF coalesce(p_endpoint,'') !~ '^https://' OR coalesce(p_p256dh,'') = '' OR coalesce(p_auth,'') = '' THEN
    RAISE EXCEPTION '구독 정보가 올바르지 않습니다' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_member FROM public.team_members WHERE user_id = v_uid AND is_active IS NOT FALSE ORDER BY created_at LIMIT 1;
  SELECT * INTO v_prev FROM public.push_subscriptions WHERE endpoint = p_endpoint;
  IF FOUND AND v_prev.user_id <> v_uid THEN DELETE FROM public.push_subscriptions WHERE id = v_prev.id; v_prev := NULL; END IF;
  INSERT INTO public.push_subscriptions AS s (user_id, member_id, endpoint, p256dh, auth, platform, user_agent)
  VALUES (v_uid, v_member, p_endpoint, p_p256dh, p_auth, left(p_platform, 20), left(p_user_agent, 300))
  ON CONFLICT (endpoint) DO UPDATE SET member_id = EXCLUDED.member_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
    platform = EXCLUDED.platform, user_agent = EXCLUDED.user_agent, fail_count = 0
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.register_push_subscription(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_subscription(text, text, text, text, text) TO authenticated;

-- 함수 전용 테이블: 정책 없음 = authenticated·anon 차단, service_role 만 접근
ALTER TABLE public.push_sent  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_sent, public.push_state FROM anon, authenticated;

-- ── 5분마다 함수 호출 ────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'calendar-push') THEN
    PERFORM cron.unschedule('calendar-push');
  END IF;
  PERFORM cron.schedule('calendar-push', '*/5 * * * *', $job$
    SELECT net.http_post(
      url     := 'https://ucwtmheysdrgrmeaubuy.supabase.co/functions/v1/calendar-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjd3RtaGV5c2RyZ3JtZWF1YnV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMDczOTUsImV4cCI6MjA5MDY4MzM5NX0.C1SaCMLXhNSlDtnPsFcF0Cb1K0ZTITmBnma0nwg2_Uw'),
      body    := '{"source":"cron"}'::jsonb,
      timeout_milliseconds := 25000
    );
  $job$);
END $$;

-- ============================================================================
-- 롤백 (필요 시 수동 실행)
-- ----------------------------------------------------------------------------
-- SELECT cron.unschedule('calendar-push');
-- DROP TABLE IF EXISTS public.push_subscriptions, public.push_sent, public.push_state;
-- DROP FUNCTION IF EXISTS public.tg_push_touch();
-- DROP FUNCTION IF EXISTS public.register_push_subscription(text, text, text, text, text);
-- (pg_cron·pg_net 확장은 다른 용도로 쓸 수 있어 남겨 둔다)
-- ============================================================================
