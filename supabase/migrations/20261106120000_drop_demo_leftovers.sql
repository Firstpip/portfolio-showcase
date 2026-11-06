-- 데모 생성기 잔재 삭제 (2026-11-06).
--
-- 데모 생성기는 2026-09-09 사용자 결정으로 없앴고, 표·함수만 운영 DB 에 남아 있었다(마지막 데이터 2026-04).
-- 대시보드·서버 함수·생성기(wishket-portfolio-system) 어디서도 쓰지 않는다. 지우기 전 데이터는 따로 받아 두었다.
-- 순서: auth.users 의 가입 트리거(새 계정마다 profiles 행을 넣음)를 먼저 지운다 — 표만 지우면 새 직원 계정 추가가 실패한다.

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

DROP FUNCTION IF EXISTS public.check_and_increment_usage(uuid, integer);
DROP FUNCTION IF EXISTS public.decrement_daily_usage(uuid);
DROP FUNCTION IF EXISTS public.get_or_set_stripe_customer(uuid, text);
DROP FUNCTION IF EXISTS public.increment_daily_usage(uuid);

-- profiles 를 참조하는 표부터
DROP TABLE IF EXISTS public.subscriptions;
DROP TABLE IF EXISTS public.generations;
DROP TABLE IF EXISTS public.daily_usage;
DROP TABLE IF EXISTS public.contact_messages;
DROP TABLE IF EXISTS public.profiles;
