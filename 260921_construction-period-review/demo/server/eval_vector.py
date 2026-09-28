"""
벡터 검색 평가 — 임베더별 상위 1·5 후보 적중률
  A. 시연 내역서 3종의 자동 확정 행 (전체 658 항목 색인, 정답 = 확정된 표준 항목)
  B. 동의어 사전에 없는 풀어 쓴 표기 33개 (검수·대표값 항목 색인, 정답 = 사람이 지정)
사용: python3 eval_vector.py <data.json>      (data.json = 화면에서 내보낸 items + rows)
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ['DEMO_VECTOR_DB'] = os.environ.get('DEMO_VECTOR_DB', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vectors.db'))
import vector_index as V

PARAPHRASE = [
 ("기존 아스팔트 포장 걷어내기", "m2", ["R-02"]), ("흙 되채움", "m3", ["T-03"]), ("남는 흙 외부로 실어내기", "m3", ["T-04"]),
 ("장비로 땅파기", "m3", ["T-02", "T-12"]), ("비탈면 다듬기", "m2", ["T-11"]), ("흙 돋우기", "m3", ["T-06"]),
 ("기초 밑 바닥 콘크리트 깔기", "m3", ["G-02"]), ("말뚝 박기", "m", ["G-03"]), ("기초에 레미콘 붓기", "m3", ["C-01"]),
 ("형틀 짜기 및 뜯기", "m2", ["C-03", "C-05"]), ("철근 엮기", "ton", ["C-04"]), ("받침기둥 세우기", "m2", ["C-07"]),
 ("벽돌로 벽 세우기", "m2", ["M-01", "M-02"]), ("바닥 시멘트 고르게 바르기", "m2", ["M-04"]), ("옥상 물막이 처리", "m2", ["M-07", "M-08", "M-06"]),
 ("보온재 붙이기", "m2", ["M-09"]), ("욕실 바닥 타일 시공", "m2", ["F-01"]), ("천장 마감 보드 달기", "m2", ["F-05"]),
 ("실내 벽 칠하기", "m2", ["F-07"]), ("창틀 달기", "개소", ["F-09"]), ("전기 파이프 매설", "m", ["E-01"]),
 ("화장실 변기 달기", "개", ["H-03"]), ("도로에 아스팔트 깔기", "m2", ["P-01", "P-03"]), ("보도에 블럭 깔기", "m2", ["P-05"]),
 ("도로 중앙선 그리기", "m", ["P-07"]), ("하수관 묻기", "m", ["D-01", "D-08", "D-04", "H-02"]), ("도로 가장자리 턱돌 놓기", "m", ["D-03"]),
 ("큰 나무 심기", "주", ["L-01"]), ("잔디 입히기", "m2", ["L-03"]), ("작업 발판 세우기", "m2", ["A-01", "A-02"]),
 ("공사장 가림막 세우기", "m", ["A-03"]), ("콘크리트 구조물 부수기", "m3", ["R-01"]), ("암반 굴착", "m3", ["T-07", "T-08"]),
]

def make(kind, w=0.6):
    if kind == 'hashed': return V.HashedTfidf()
    if kind == 'e5': return V.OnnxE5Embedder()
    return V.HybridEmbedder(w)

def evaluate(emb, items, queries):
    ix = V.VectorIndex.__new__(V.VectorIndex); ix.items = []; ix.mat = None; ix.key = None; ix.embedder = emb; ix.build_ms = 0
    t0 = time.time(); ix.build(items); build = time.time() - t0
    h1 = h5 = 0; miss = []; t0 = time.time()
    for q, spec, unit, gold in queries:
        res = [r['code'] for r in ix.search(q, unit or None, 5, spec or '')]
        if res[:1] and res[0] in gold: h1 += 1
        if any(c in gold for c in res): h5 += 1
        else: miss.append((q, gold[0], res[:3]))
    return {'n': len(queries), 'top1': h1, 'top5': h5, 'build_s': round(build, 2), 'query_ms': round((time.time() - t0) * 1000 / max(1, len(queries)), 1), 'miss': miss}

if __name__ == '__main__':
    d = json.load(open(sys.argv[1])); items = d['items']
    curated = [i for i in items if len(str(i['code']).split('-')[0]) == 1]   # 검수·대표값 (자동 추출·국토부 항목은 접두어가 두 글자)
    A = [(r['name'], r.get('spec', ''), r.get('unit', ''), [r['gold']]) for s in d['sets'].values() for r in s if r.get('gold')]
    B = [(q, '', u, g) for q, u, g in PARAPHRASE]
    print(f'색인 전체 {len(items)} · 검수·대표값 {len(curated)} · A {len(A)}행 · B {len(B)}개')
    out = {}
    for label, kind, w in [('n-gram', 'hashed', 0), ('문장 임베딩', 'e5', 0), ('결합 50%', 'hybrid', .5), ('결합 60%', 'hybrid', .6), ('결합 70%', 'hybrid', .7), ('결합 80%', 'hybrid', .8)]:
        ra = evaluate(make(kind, w), items, A); rb = evaluate(make(kind, w), curated, B)
        out[label] = {'A': {k: ra[k] for k in ('n', 'top1', 'top5', 'build_s', 'query_ms')}, 'B': {k: rb[k] for k in ('n', 'top1', 'top5', 'query_ms')}, 'missA': ra['miss'], 'missB': rb['miss']}
        print(f"{label:10s} | A 상위1 {ra['top1']}/{ra['n']} 상위5 {ra['top5']}/{ra['n']} | B 상위1 {rb['top1']}/{rb['n']} 상위5 {rb['top5']}/{rb['n']} | 색인 {ra['build_s']}s 질의 {ra['query_ms']}ms")
    json.dump(out, open(os.path.splitext(sys.argv[1])[0] + '-eval.json', 'w'), ensure_ascii=False, indent=1)
