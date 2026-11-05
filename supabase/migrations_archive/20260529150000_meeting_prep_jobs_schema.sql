-- ============================================================================
-- meeting_prep_jobs — 데모 준비 파일 생성 작업 큐 (스키마 드리프트 해소)
-- ----------------------------------------------------------------------------
-- 배경: 이 테이블은 그동안 마이그레이션 없이 운영 DB에 직접 생성돼 버전관리 밖에
--   있었음(드리프트). 원본 정의는 ~/wishket-portfolio-system/meeting-prep-service/
--   supabase-jobs-schema.sql. 이를 버전관리로 편입해 DB 재구축/클론 시 재현 가능하게 함.
--
-- 처리 주체: 로컬 맥 데몬(meeting-prep-daemon.js)이 SERVICE_ROLE 키로 큐를 폴링/처리
--   → RLS 우회. 대시보드(authenticated)는 job 생성/조회.
--
-- 보안: 원본 스키마의 anon 허용 정책("insert job"/"select job" TO anon)은 외부
--   무단 접근 구멍이었으므로 의도적으로 제외하고, authenticated 전용 정책만 둔다.
--   (20260529103000_enable_rls_core_tables.sql 와 동일 기조)
--
-- 멱등: 모두 IF NOT EXISTS / 가드 / on conflict 처리 → 기존 운영 DB에선 안전한 no-op,
--   신규 환경에선 테이블+트리거+RLS+버킷을 전부 구성.
-- ============================================================================

-- ── 테이블 ────────────────────────────────────────────────────────────────
create table if not exists public.meeting_prep_jobs (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null,
  status       text not null default 'pending',  -- pending | processing | done | error | expired
  model        text default 'opus',
  download_url text,
  error        text,
  requested_by text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ── updated_at 자동 갱신 트리거 ──────────────────────────────────────────────
create or replace function public.touch_meeting_prep_jobs()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_touch_meeting_prep_jobs on public.meeting_prep_jobs;
create trigger trg_touch_meeting_prep_jobs
  before update on public.meeting_prep_jobs
  for each row execute function public.touch_meeting_prep_jobs();

-- ── Realtime publication (대시보드 완료 감지 + 데몬 신규 job 수신) — 중복 추가 가드 ──
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='meeting_prep_jobs'
  ) then
    execute 'alter publication supabase_realtime add table public.meeting_prep_jobs';
  end if;
end $$;

-- ── Storage 비공개 버킷 (데몬이 service_role로 업로드, 서명 URL 발급) — 멱등 ──────
insert into storage.buckets (id, name, public)
values ('meeting-prep', 'meeting-prep', false)
on conflict (id) do nothing;

-- ── RLS: authenticated 전용 (anon 허용 정책은 보안상 제외) ────────────────────
grant select, insert, update, delete on public.meeting_prep_jobs to authenticated;
alter table public.meeting_prep_jobs enable row level security;

-- 레거시 anon 허용 정책 제거 (원본 스키마가 만들었던 구멍)
drop policy if exists "anon insert job" on public.meeting_prep_jobs;
drop policy if exists "insert job"      on public.meeting_prep_jobs;
drop policy if exists "anon select job" on public.meeting_prep_jobs;
drop policy if exists "select job"      on public.meeting_prep_jobs;

-- authenticated 전체 허용 (대시보드는 로그인 사용자, 데몬은 service_role로 우회)
drop policy if exists "mpj_all_authenticated" on public.meeting_prep_jobs;
create policy "mpj_all_authenticated" on public.meeting_prep_jobs
  for all to authenticated using (true) with check (true);

-- ============================================================================
-- 참고: 이 마이그레이션은 meeting_prep_jobs를 완전히 소유한다(테이블+RLS+정책).
--   20260529103000 의 meeting_prep_jobs 블록은 가드(to_regclass)가 있어 신규 환경에선
--   테이블 생성 전이라 skip되고, 이 파일이 이후에 전부 구성한다. 운영 DB에선 양쪽 모두
--   멱등 no-op이라 충돌 없음.
-- ============================================================================
