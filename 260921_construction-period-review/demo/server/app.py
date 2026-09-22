"""
공사기간 산정 콘솔 — 데모 백엔드 (FastAPI)

역할
  1. 기상청 ASOS 일자료 API(공공데이터포털) 프록시 + 캐시   GET /api/weather?station=143&start=2016&end=2025
  2. 공종명 AI 문맥 보정 (Claude)                          POST /api/map
  3. 검토보고서 AI 서술 초안 (Claude)                      POST /api/narrative
  4. 상태 확인                                            GET /api/health
  5. 정적 데모 서빙 (../index.html)                        GET /

실행
  KMA_SERVICE_KEY=<공공데이터포털 인증키(Decoding)> python3 app.py     # http://127.0.0.1:8765
  키가 없으면 /api/weather 는 503 을 돌려주고, 데모는 내장 데이터로 동작한다.

LLM 호출은 Claude Code CLI(`claude -p`)를 서브프로세스로 쓴다 — 별도 API 키 불필요.
비용 절감: 빈 작업 폴더(cwd=server/.claude-empty)에서 도구를 끄고 sonnet 으로 호출한다.
"""
import json, os, re, subprocess, math, time
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

HERE = Path(__file__).resolve().parent
DEMO_DIR = HERE.parent
CACHE = Path(os.environ.get("DEMO_CACHE_DIR", HERE / "cache")); CACHE.mkdir(parents=True, exist_ok=True)
EMPTY_CWD = HERE / ".claude-empty"; EMPTY_CWD.mkdir(exist_ok=True)
KMA_KEY = os.environ.get("KMA_SERVICE_KEY", "").strip()
LLM_MODEL = os.environ.get("DEMO_LLM_MODEL", "sonnet")
LLM_TIMEOUT = int(os.environ.get("DEMO_LLM_TIMEOUT", "150"))
ASOS_URL = "http://apis.data.go.kr/1360000/AsosDalyInfoService/getWthrDataList"

app = FastAPI(title="공사기간 산정 콘솔 데모 API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def claude_available() -> bool:
    from shutil import which
    return which("claude") is not None


# ───────────────────────── 1. 기상청 ASOS ─────────────────────────
def feels_like(ta: float, rh: float) -> float:
    """기상청 여름철 체감온도 (Stull 습구온도 기반) — 프런트와 동일식"""
    tw = (ta * math.atan(0.151977 * math.sqrt(rh + 8.313659)) + math.atan(ta + rh) - math.atan(rh - 1.67633)
          + 0.00391838 * rh ** 1.5 * math.atan(0.023101 * rh) - 4.686035)
    return round(-0.2442 + 0.55399 * tw + 0.45535 * ta - 0.0022 * tw * tw + 0.00278 * tw * ta + 3.0, 1)


def f(v: Any, default=0.0):
    try:
        s = str(v).strip()
        return float(s) if s not in ("", "None") else default
    except ValueError:
        return default


async def fetch_asos_year(client: httpx.AsyncClient, station: str, year: int) -> list[dict]:
    cache_file = CACHE / f"asos_{station}_{year}.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text())
    if not KMA_KEY:
        raise HTTPException(503, "KMA_SERVICE_KEY 미설정")
    items: list[dict] = []
    page = 1
    while True:
        params = {"serviceKey": KMA_KEY, "pageNo": page, "numOfRows": 999, "dataType": "JSON", "dataCd": "ASOS",
                  "dateCd": "DAY", "startDt": f"{year}0101", "endDt": f"{year}1231", "stnIds": station}
        r = await client.get(ASOS_URL, params=params, timeout=60)
        if r.status_code != 200:
            raise HTTPException(502, f"기상청 API HTTP {r.status_code}: {r.text[:200]}")
        try:
            body = r.json()["response"]
        except Exception:
            raise HTTPException(502, f"기상청 API 응답 파싱 실패: {r.text[:300]}")
        code = body.get("header", {}).get("resultCode")
        if code != "00":
            raise HTTPException(502, f"기상청 API 오류 {code}: {body.get('header', {}).get('resultMsg')}")
        chunk = body.get("body", {}).get("items", {}).get("item", []) or []
        items.extend(chunk)
        total = int(body.get("body", {}).get("totalCount", 0) or 0)
        if len(items) >= total or not chunk:
            break
        page += 1
    days = []
    for it in items:
        tm = str(it.get("tm", ""))
        if len(tm) < 10:
            continue
        y, m, d = int(tm[0:4]), int(tm[5:7]), int(tm[8:10])
        # 결측(빈 문자열)은 None 으로 남긴다 — 프런트 룰 엔진은 None 을 어떤 기준에도 걸리지 않게 처리
        tmax = f(it.get("maxTa"), None); tmin = f(it.get("minTa"), None)
        # 최고기온 시각 습도는 제공되지 않아 최소상대습도(minRhm)를 우선, 없으면 평균습도 사용
        hum = f(it.get("minRhm"), f(it.get("avgRhm"), 50))
        days.append({"y": y, "m": m, "d": d, "rain": f(it.get("sumRn")), "tmax": tmax, "tmin": tmin, "hum": hum,
                     "wind": f(it.get("maxWs")), "snow": f(it.get("ddMefs")),
                     "feels": feels_like(tmax, hum) if tmax is not None else None})
    if len(days) >= 300:  # 연 단위 완결 데이터만 캐시
        cache_file.write_text(json.dumps(days, ensure_ascii=False))
    return days


@app.get("/api/weather")
async def weather(station: str = Query("143"), start: int = 2016, end: int = 2025):
    if not KMA_KEY and not any((CACHE / f"asos_{station}_{y}.json").exists() for y in range(start, end + 1)):
        raise HTTPException(503, "KMA_SERVICE_KEY 미설정 — 공공데이터포털 '기상청_지상(종관, ASOS) 일자료 조회서비스' 인증키가 필요합니다")
    t0 = time.time()
    async with httpx.AsyncClient() as client:
        out: list[dict] = []
        for y in range(start, end + 1):
            out.extend(await fetch_asos_year(client, station, y))
    return {"station": station, "start": start, "end": end, "days": out, "source": "기상청 ASOS 일자료 (공공데이터포털 API)",
            "elapsed_ms": int((time.time() - t0) * 1000)}


# ───────────────────────── 2·3. Claude (CLI) ─────────────────────────
def call_claude(prompt: str, timeout: int = LLM_TIMEOUT) -> str:
    if not claude_available():
        raise HTTPException(503, "claude CLI 없음")
    args = ["claude", "-p", "--model", LLM_MODEL, "--output-format", "json", "--tools", "", "--dangerously-skip-permissions"]
    try:
        r = subprocess.run(args, input=prompt, capture_output=True, text=True, timeout=timeout, cwd=EMPTY_CWD)
    except subprocess.TimeoutExpired:
        raise HTTPException(504, f"LLM 응답 시간 초과({timeout}s)")
    if r.returncode != 0:
        raise HTTPException(502, f"LLM 호출 실패: {r.stderr[-400:]}")
    try:
        data = json.loads(r.stdout)
        text = data.get("result", "") if isinstance(data, dict) else str(data)
    except json.JSONDecodeError:
        text = r.stdout
    return text


def extract_json(text: str) -> Any:
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    s = m.group(1) if m else text
    i, j = s.find("{"), s.rfind("}")
    if i < 0:
        i, j = s.find("["), s.rfind("]")
    return json.loads(s[i:j + 1])


class MapRow(BaseModel):
    no: int
    name: str
    spec: str = ""
    unit: str = ""
    qty: float = 0
    group: str = ""
    candidates: list[dict] = []   # [{code,name,cat,unit,score}]


class MapReq(BaseModel):
    rows: list[MapRow]
    standards: list[dict]         # 전체 표준품셈 요약 [{code,name,cat,unit}]


@app.post("/api/map")
def map_rows(req: MapReq):
    std_lines = "\n".join(f"- {s['code']} | {s['name']} | {s['cat']} | 단위 {s['unit']}" for s in req.standards)
    row_lines = []
    for r in req.rows:
        cands = ", ".join(f"{c['code']}({c.get('score', 0)}%)" for c in r.candidates)
        row_lines.append(f"{r.no}. 품명「{r.name}」 규격「{r.spec}」 단위 {r.unit} 수량 {r.qty} 공종구분 {r.group} / 1차 후보: {cands}")
    prompt = f"""당신은 건설공사 표준품셈 대조 전문가입니다. 건설 내역서의 품명(현장마다 표기가 다름)을 아래 표준품셈 항목 중 하나로 매핑하세요.

[표준품셈 항목]
{std_lines}

[내역서 행]
{chr(10).join(row_lines)}

규칙
- 품명·규격·단위·공종구분의 문맥을 함께 보고 판단합니다. 단위가 다르면 같은 공종이라도 매핑하지 않습니다(예: 절단 길이 m 와 면적 m² 는 다른 항목).
- 표준품셈에 해당 작업이 없거나(예: 현장 정리 '식'), 확신이 60 미만이면 code 를 null 로 두고 이유를 적습니다.
- confidence 는 0~100 정수. reason 은 한국어 한 문장(30자 내).
- 반드시 아래 JSON 만 출력하세요. 설명 문장 금지.

{{"results":[{{"no":1,"code":"T-01","confidence":95,"reason":"..."}}]}}"""
    text = call_claude(prompt)
    try:
        data = extract_json(text)
    except Exception:
        raise HTTPException(502, f"LLM 출력 파싱 실패: {text[:300]}")
    valid = {s["code"] for s in req.standards}
    results = {}
    for it in data.get("results", []):
        code = it.get("code")
        results[str(it.get("no"))] = {"code": code if code in valid else None,
                                      "confidence": max(0, min(100, int(it.get("confidence", 0) or 0))),
                                      "reason": str(it.get("reason", ""))[:80]}
    return {"model": LLM_MODEL, "results": results}


class NarrativeReq(BaseModel):
    summary: dict


@app.post("/api/narrative")
def narrative(req: NarrativeReq):
    s = json.dumps(req.summary, ensure_ascii=False, indent=1)
    prompt = f"""당신은 공사기간 적정성 검토 보고서를 작성하는 건설사업관리 전문가입니다. 아래 산정 결과(JSON)를 바탕으로 보고서의 서술 문단 3개를 한국어 경어체(~하였습니다/~됩니다)로 작성하세요.

[산정 결과]
{s}

규칙
- 숫자는 JSON 에 있는 값만 그대로 인용합니다. 새로운 수치·비율·날짜를 만들지 마세요.
- overview: 검토 개요(대상·방법) 3~4문장. weather: 기상 조건 분석 3문장. opinion: 적정성 검토 의견과 공기 준수 핵심 관리 항목 4~5문장(주공정선·비작업일 집중 시기·미매칭 항목 언급).
- 반드시 아래 JSON 만 출력. 마크다운·설명 금지.

{{"overview":"...","weather":"...","opinion":"..."}}"""
    text = call_claude(prompt)
    try:
        data = extract_json(text)
    except Exception:
        raise HTTPException(502, f"LLM 출력 파싱 실패: {text[:300]}")
    return {"model": LLM_MODEL, **{k: str(data.get(k, "")) for k in ("overview", "weather", "opinion")}}


@app.get("/api/health")
def health():
    cached = sorted({p.name.split("_")[1] for p in CACHE.glob("asos_*.json")})
    return {"ok": True, "kma": bool(KMA_KEY), "kma_cached_stations": cached, "llm": claude_available(), "llm_model": LLM_MODEL}


app.mount("/", StaticFiles(directory=str(DEMO_DIR), html=True), name="demo")

if __name__ == "__main__":
    import uvicorn
    print(f"KMA key: {'설정됨' if KMA_KEY else '없음(내장 데이터 폴백)'} · claude CLI: {'있음' if claude_available() else '없음'} · model={LLM_MODEL}")
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8765")))
