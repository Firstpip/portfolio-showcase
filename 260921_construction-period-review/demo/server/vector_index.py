"""
표준품셈 항목 벡터 검색 인덱스

- 기본 임베더: 문자 n-gram(2·3-gram) 해시드 TF-IDF (numpy, 4096차원, 외부 모델 불필요 → 8GB 노트북에서도 즉시 동작)
- 선택 임베더: OPENAI_API_KEY 가 있으면 text-embedding-3-small 로 교체 (같은 인터페이스). pgvector 이식 시에도 동일 벡터 사용.
- 검색: 코사인 유사도 상위 k. 단위가 주어지면 단위 불일치 항목은 감점.

실 시스템 매핑 흐름: 벡터 검색(후보 확대) → LLM 문맥 판정 → 실무자 확정 → 확정 이력 학습
"""
import hashlib, json, math, os, re
from typing import Iterable
import numpy as np

DIM = 4096
_SPACE = re.compile(r"\s+")
_STRIP = re.compile(r"(공사|작업|설치및해체|및)")


def normalize(text: str) -> str:
    t = str(text or '').lower()
    t = re.sub(r"\(.*?\)", " ", t)
    t = re.sub(r"[^\w가-힣.]", "", t)
    return _STRIP.sub("", t)


def ngrams(t: str) -> Iterable[str]:
    t = normalize(t)
    for n in (2, 3):
        for i in range(len(t) - n + 1):
            yield t[i:i + n]
    if len(t) <= 3 and t:
        yield t


def _h(g: str) -> int:
    return int(hashlib.blake2b(g.encode('utf-8'), digest_size=4).hexdigest(), 16) % DIM


class HashedTfidf:
    name = 'hashed-ngram-tfidf'

    def __init__(self):
        self.idf = np.ones(DIM, dtype=np.float32)

    def fit(self, texts):
        df = np.zeros(DIM, dtype=np.float32)
        for t in texts:
            for g in set(ngrams(t)):
                df[_h(g)] += 1
        n = max(1, len(texts))
        self.idf = np.log((n + 1) / (df + 1)) + 1.0

    def embed(self, texts):
        out = np.zeros((len(texts), DIM), dtype=np.float32)
        for i, t in enumerate(texts):
            for g in ngrams(t):
                out[i, _h(g)] += 1.0
            out[i] = np.log1p(out[i]) * self.idf
            nrm = np.linalg.norm(out[i])
            if nrm > 0: out[i] /= nrm
        return out


class OpenAIEmbedder:
    name = 'openai/text-embedding-3-small'

    def __init__(self):
        from openai import OpenAI
        self.client = OpenAI()

    def fit(self, texts): pass

    def embed(self, texts):
        vecs = []
        for i in range(0, len(texts), 256):
            r = self.client.embeddings.create(model='text-embedding-3-small', input=texts[i:i + 256])
            vecs.extend([d.embedding for d in r.data])
        a = np.asarray(vecs, dtype=np.float32)
        a /= np.linalg.norm(a, axis=1, keepdims=True) + 1e-9
        return a


class VectorIndex:
    def __init__(self):
        self.items = []; self.mat = None; self.key = None
        self.embedder = None
        if os.environ.get('OPENAI_API_KEY'):
            try: self.embedder = OpenAIEmbedder()
            except Exception: self.embedder = None
        if self.embedder is None: self.embedder = HashedTfidf()

    @staticmethod
    def doc_text(it: dict) -> str:
        return ' '.join([it.get('name', ''), it.get('cat', ''), ' '.join(it.get('syn') or []), it.get('part', '') or ''])

    def build(self, items: list[dict]):
        key = hashlib.md5(json.dumps([(i.get('code'), i.get('name'), i.get('unit')) for i in items], ensure_ascii=False).encode()).hexdigest()
        if key == self.key: return False
        texts = [self.doc_text(i) for i in items]
        self.embedder.fit(texts)
        self.mat = self.embedder.embed(texts)
        self.items = items; self.key = key
        return True

    def search(self, query: str, unit: str | None = None, k: int = 8, spec: str = ''):
        if self.mat is None or not len(self.items): return []
        q = self.embedder.embed([query + (' ' + spec if spec else '')])[0]
        sims = self.mat @ q
        if unit:
            u = _unit(unit)
            for i, it in enumerate(self.items):
                if it.get('unit') and _unit(it['unit']) != u:
                    sims[i] *= 0.6
        idx = np.argsort(-sims)[:k]
        return [{'code': self.items[i]['code'], 'name': self.items[i]['name'], 'unit': self.items[i].get('unit'), 'score': float(round(sims[i] * 100, 1))} for i in idx if sims[i] > 0]


_UNIT = {'m2': 'm²', '㎡': 'm²', 'm3': 'm³', '㎥': 'm³', 't': 'ton', '톤': 'ton', 'ea': '개소', '개': '개소'}
def _unit(u): u = str(u or '').strip().lower(); return _UNIT.get(u, u)
