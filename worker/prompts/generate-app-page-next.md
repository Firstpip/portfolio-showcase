# generate-app page 프롬프트 — Next.js static export (T8.10 — Phase 8 — Pass 2)

> 사용처: `worker/generate-demo/generate-app.ts` 의 **per-flow page pass**, 스택이 `next-static` 일 때. flow 마다 1 호출.
> 모델: `claude-opus-4-7`
> 출력: **단일 JSON** `{"path": "app/{flow_id}/page.tsx", "content": "..."}`. 단 한 파일. files 배열 아님.

---

## ⚠️ 출력 절대 규칙 (위반 시 시스템 reject)

**응답의 첫 바이트는 반드시 `{` 이다.** 설명·인트로·코드펜스 일체 금지. 마지막 바이트는 `}`.

JSON string 안의 개행은 반드시 `\n` 으로 escape 한다. **raw 개행을 넣으면 파싱이 깨진다.**

---

## 역할

Pass 1(foundation) 이 만든 placeholder page 를 **정식 본문으로 덮어쓴다.** 한 호출당 한 flow 의 한 page 만 작성한다.

전제:
- foundation 은 이미 완성됨 — `app/layout.tsx`, `app/page.tsx`, `components/Layout.tsx`, `types.ts`, `lib/store.tsx`, `lib/seed.ts` 모두 존재.
- 사용 가능 패키지: `react`, `next`, `lucide-react`, `sonner`, `clsx`, `tailwind-merge`, `zod`, `recharts`. 그 외 import 금지.

## ⚠️ static export 제약 (가장 흔한 실패 원인)

서버가 없다. 파일 맨 위에 **`"use client";` 를 반드시 넣어라** — 이 page 는 상태·이벤트를 쓴다.

금지: Server Action(`"use server"`), Route Handler, `cookies()`/`headers()`, `force-dynamic`/`revalidate`, 동적 세그먼트. `localStorage` 직접 접근은 `useEffect` 안에서만 (스토어를 쓰면 신경 쓸 일이 없다).

### ⚠️ 타입 계약 (위반 시 빌드 실패)

입력의 `foundation_source` 는 **Pass 1 이 실제로 생성해 워크스페이스에 이미 존재하는 파일 원문**이다. 추측이 아니라 사실이다.

- `foundation_source["types.ts"]` 의 엔티티 타입을 **그대로** 쓴다. 필드 이름·타입(특히 `id`)을 임의로 바꾸거나 새로 가정하지 마라.
- 같은 이름의 타입을 page 안에서 **재정의하지 마라**. `import type { X } from "@/types"`.
- `foundation_source["lib/store.tsx"]` 의 `useStore()` 반환 형태와 갱신 함수 시그니처를 그대로 따른다.
- **`Layout` 을 import 하지 마라.** `app/layout.tsx` 가 이미 모든 page 를 감싼다. page 는 자기 콘텐츠만 그린다.
- 다른 컴포넌트를 import 할 때는 `foundation_source` 에 있는 **실제 export 형태**(default / named)를 그대로 따라라. 추측해서 named import 를 쓰면 빌드가 깨진다.
- 새 레코드의 `id` 는 types.ts 의 타입에 맞춰 만든다 — `string` 이면 `crypto.randomUUID()` 또는 `` `${Date.now()}` ``.

---

## 입력 (user 메시지)

```jsonc
{
  "spec": { ... },
  "tokens": { "primary": "#XXXXXX", ... },
  "flow_id": "flow_3",
  "page_path": "app/flow_3/page.tsx",
  "tier": 1,
  "foundation_source": { "types.ts": "...", "lib/store.tsx": "..." }
}
```

`spec.core_flows[]` 에서 `flow_id` 에 해당하는 flow 를 찾아 그 `title`, `steps`, `data_entities` 를 정확히 반영해야 한다.

---

## 🚫 외부 URL 절대 금지

빌드 산출물에 `http://` / `https://` 절대 URL 을 한 개도 남기지 마라. `src`/`href` 뿐 아니라 **목업 데이터 문자열 값·주석·상수 배열까지 전부 포함**이다. 이미지는 인라인 SVG나 CSS gradient, 영상은 회색 `aspect-video` 박스, 외부 링크는 `<button onClick>` + toast 로 대체한다.

---

## tier 별 동작 규칙 (엄격)

### tier 1 — 실제 CRUD
- 폼/인터랙션 → `useStore()` 의 갱신 함수로 상태 변경 → LocalStorage 자동 저장.
- entity 한두 개에 add/edit/delete 중 1~2가지.
- 성공 시 `import { toast } from "sonner"; toast.success("...")`.
- 결과 리스트도 같은 page 에 표시.
- **스토어를 변경하는 호출이 코드 안에 반드시 1곳 이상.**

### tier 2 — 화면만, 저장은 페이크
- 화면·컴포넌트·더미데이터는 제대로 만들되 **스토어를 변경하지 마라**.
- 저장 버튼 → `toast.success("저장되었습니다")` 같은 성공 문구만.
- 스토어 변경 호출 0건이어야 한다.

### tier 3 — placeholder 카드
- "본 계약 시 구현 예정" 안내 카드 하나. 폼·리스트 없음.

---

## 출력 형식

```jsonc
{
  "path": "app/flow_3/page.tsx",
  "content": "\"use client\";\n// tier: 1 — 세션 신청\nimport { useState } from \"react\";\n..."
}
```

규칙:
1. 첫 바이트 `{`, 마지막 `}`.
2. `path` 는 입력의 `page_path` 와 정확히 일치.
3. `content` 의 첫 줄은 `"use client";`, 둘째 줄은 `// tier: N — <flow.title>`.
4. default export 함수 컴포넌트 1개.
5. 한국어 UI, Tailwind 토큰 클래스(`bg-primary`/`text-text`/`bg-surface`/`rounded`) 사용.

## 품질 체크 (응답 전 스스로 확인)

- [ ] 첫 줄이 `"use client";` 다.
- [ ] flow 의 `steps` 가 화면에 실제로 드러난다.
- [ ] tier 규칙을 지켰다 (tier 1 은 스토어 변경 있음 / tier 2 는 0건).
- [ ] `@/types` 의 타입을 재정의하지 않고 import 해서 썼다.
- [ ] 서버 전용 API·동적 세그먼트를 쓰지 않았다.
- [ ] 코드 안에 `http://` / `https://` 로 시작하는 절대 URL 0건.
- [ ] JSON string 안의 개행이 전부 `\n` 으로 escape 됐다.
