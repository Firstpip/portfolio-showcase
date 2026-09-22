# 공사기간 산정 콘솔 — 시연 데모

두 가지 모드로 동작한다.

| 모드 | 실행 방법 | 기상 데이터 | 공종명 매핑 | 보고서 서술 |
|---|---|---|---|---|
| 오프라인 | `index.html` 을 브라우저로 연다 | 내장 10년 시뮬레이션 | 동의어 사전 + 유사도 | 템플릿 문장 |
| 실연동 | `server/run.sh` 실행 후 http://127.0.0.1:8765 | 기상청 ASOS API (키 필요) | 1차 사전·유사도 + **LLM 문맥 보정** | **LLM 서술 초안** |

헤더 우측 배지(기상청 API / AI)에 초록 점이 켜지면 실연동 상태다. 백엔드가 없으면 자동으로 오프라인 모드로 동작한다.

## 실연동 실행

```bash
cd server
cp .env.example .env     # KMA_SERVICE_KEY 채우기 (없으면 기상만 내장 데이터)
./run.sh                 # fastapi/uvicorn/httpx 없으면 자동 설치
# → http://127.0.0.1:8765
```

- **AI(LLM)**: 별도 API 키 없이 이 PC의 Claude Code CLI(`claude -p`)를 서브프로세스로 호출한다. 모델은 `DEMO_LLM_MODEL`(기본 sonnet). 빈 작업 폴더에서 도구를 끄고 호출하므로 호출당 컨텍스트가 작다.
  - AI 문맥 보정(24행): 약 30~60초. AI 서술 초안: 약 20~40초. 미팅에서는 버튼을 누르고 설명을 이어가면 된다.
- **기상청 API**: 공공데이터포털에서 「기상청_지상(종관, ASOS) 일자료 조회서비스」 활용신청 → 마이페이지의 **Decoding 인증키**를 `KMA_SERVICE_KEY` 에 넣는다. 승인은 보통 즉시 처리된다.
  - 최초 1회 지점별 10년치(약 3,650일)를 받아 `server/cache/asos_<지점>_<연도>.json` 에 캐시한다. 이후에는 키가 없어도 캐시로 동작한다.
  - 지점: 대구 143, 구미 279 (`index.html` 의 `SITES[].stn`).

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/health` | `{kma, llm, llm_model, kma_cached_stations}` |
| GET | `/api/weather?station=143&start=2016&end=2025` | ASOS 일자료 → `{y,m,d,rain,tmax,tmin,hum,wind,snow,feels}[]` |
| POST | `/api/map` | `{rows:[{no,name,spec,unit,qty,group,candidates}], standards:[…]}` → `{results:{no:{code,confidence,reason}}}` |
| POST | `/api/narrative` | `{summary:{…}}` → `{overview, weather, opinion}` |

## 샘플 내역서

`sample-boq.xlsx` — 24행. 헤더가 4행에 있고 공종구분이 병합셀처럼 비어 있는 형태라 파서의 헤더 탐지·승계를 함께 보여준다.
