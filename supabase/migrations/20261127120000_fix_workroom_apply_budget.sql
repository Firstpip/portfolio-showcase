-- 2026-11-27 워크룸 지원 금액 4건 교정 — 등록 스크립트(register-project)가 틀리게 넣은 값
-- 원인: 생성 AI 가 budget-raw 에 지원액을 넣어 할인이 두 번 되거나, "5,000만원" 표기를 parseInt 가 5 로 읽음.
--       근본 수정은 wishket-portfolio-system fe5663b2(워크룸 금액 = pending.budget).
-- 교정 전 값(백업): tcg 3,200만원(applied) / chat-support 950만원 / union 지원 불가 (500만 미만) / hagwon 지원 불가 (500만 미만)
-- 교정 값 근거:
--   tcg     #159844 공고 5,000만 — 위시켓 실제 제출 4,000만(wishket_apply_attrs.bid_won, 11-13식 ×0.8)
--   chat    #159773 공고 2,000만 → 1,400만(11-26식 ×0.68, 평가 기록 '코드 산정 1,400만원')
--   union   #159881 공고 1,000만 →   680만(×0.68, 평가 기록 '코드 산정 680만원')
--   hagwon  #159890 공고 5,000만 → 3,400만(×0.68, 평가 기록 '코드 산정 3,400만원')
--   지원 전 3건은 실제 제출 때 apply-wishket 이 제출값으로 다시 맞춘다.
-- 변경은 tg_audit_wishket_projects 로 audit_log 에 남는다. 현재 값이 위와 다르면(그새 누가 고침) 전체 롤백.
DO $$
DECLARE n int; total int := 0;
BEGIN
  UPDATE public.wishket_projects SET budget = '4,000만원'
   WHERE slug = '261125_tcg-card-marketplace' AND budget = '3,200만원';
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  UPDATE public.wishket_projects SET budget = '1,400만원'
   WHERE slug = '261127_chat-support-widget' AND budget = '950만원' AND current_status = 'generated';
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  UPDATE public.wishket_projects SET budget = '680만원'
   WHERE slug = '261126_union-wordpress-renewal' AND budget = '지원 불가 (500만 미만)' AND current_status = 'generated';
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  UPDATE public.wishket_projects SET budget = '3,400만원'
   WHERE slug = '261127_hagwon-campus-admin' AND budget = '지원 불가 (500만 미만)' AND current_status = 'generated';
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  IF total <> 4 THEN RAISE EXCEPTION '예상 4건, 실제 %건 — 롤백', total; END IF;
END $$;
