# DB 마이그레이션 규칙 (Claude용)

- 운영 DB 변경은 `supabase/migrations/` 마이그레이션으로만 한다. SQL 편집기·`app.jsx` 안의 붙여넣기용 SQL로 객체를 만들지 않는다.
  (2026-11-05: 그렇게 만든 함수가 권한 회수 없이 남아 anon 키로 삭제 프로젝트 목록·복구가 됐다.)
- 기준선: `migrations/20261105130000_baseline.sql` = 2026-11-05 운영 스키마 전체(+pg_cron 작업·공휴일). 이전 파일은 `migrations_archive/`(다시 적용 안 함).
- 레포와 운영이 같은지 확인: `supabase db diff --linked --schema public` → "No schema changes found" 여야 한다(Docker 필요, 운영은 읽기만).
  새 마이그레이션을 만들기 전·적용 후에 돌린다.
- 함수를 만들면 같은 마이그레이션에서 `REVOKE EXECUTE ON FUNCTION … FROM PUBLIC, anon;` 후 필요한 역할에만 `GRANT`.
  Postgres 는 새 함수에 PUBLIC 실행 권한을 주고, 이는 스키마 단위 기본 권한으로 막을 수 없다(전역 변경은 확장 함수까지 막아 쓰지 않음).
- SECURITY DEFINER 함수는 `SET search_path = public, pg_temp` 를 붙인다.
- CI(`.github/workflows/ci.yml`)가 `node tools/ci/check-migrations.mjs` 로 SECURITY DEFINER 함수의 REVOKE … FROM PUBLIC·anon GRANT 금지·search_path 를 검사한다. 로컬에서도 먼저 돌린다.
- 적용 전 점검: anon 이 실행 가능한 SECURITY DEFINER 함수가 없어야 한다(트리거·event_trigger 제외, `rls_auto_enable` 은 Supabase 기본).
  `20261105120000_revoke_anon_rpc.sql` 의 마지막 DO 블록과 같은 질의.
- 운영 적용은 건마다 승인 → 적용 전 권한·정책 상태를 저장 → `supabase db push` → 다시 조회해 확인.
- 권한(2026-11-05~): 데이터 정책은 '로그인한 계정 전부'(`USING (true)`)가 아니라 `(SELECT public.is_staff())` — 팀원(team_members.user_id, is_active 아님 false) 또는 관리자(is_admin).
  새 테이블도 같은 조건으로 만든다. 팀원 추가·연결(team_members 쓰기)은 관리자만. 퇴사자는 `is_active = false` 로 바꾸면 바로 막힌다.
  SECURITY DEFINER 함수는 RLS 를 거치지 않으므로 본문 첫 줄에서 `IF NOT public.is_staff() THEN RAISE … '42501'`.
- 로컬 검증: 임시 폴더에 config.toml·migrations 를 복사해 `supabase start --workdir <임시> -x studio,…` → 시험 계정(팀원·퇴사·외부·관리자)으로 REST 호출.
  기준선의 pg_cron 등록은 `app.enable_cron=on` 일 때만 하므로 로컬·섀도 DB가 운영 알림 서버를 부르지 않는다.
