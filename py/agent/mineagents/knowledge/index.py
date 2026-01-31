from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional

WORD_RE = re.compile(r"[a-z0-9]+", re.IGNORECASE)


def _tokenize(text: str) -> List[str]:
    return [token.lower() for token in WORD_RE.findall(text)]


@dataclass
class KnowledgeEntry:
    key: str
    text: str
    source: str
    metadata: Dict[str, str] = field(default_factory=dict)


@dataclass
class SearchResult:
    entry: KnowledgeEntry
    score: float


class HowToIndex:
    def __init__(self, entries: Optional[Iterable[KnowledgeEntry]] = None) -> None:
        self.entries: List[KnowledgeEntry] = list(entries or [])
        self._doc_freq: Counter[str] = Counter()
        self._embeddings: List[Dict[str, float]] = []
        self._norms: List[float] = []
        self._built: bool = False

    def add_entry(self, entry: KnowledgeEntry) -> None:
        self.entries.append(entry)
        self._built = False

    def build(self) -> None:
        if not self.entries:
            self._doc_freq.clear()
            self._embeddings.clear()
            self._norms.clear()
            self._built = True
            return

        self._doc_freq = Counter()
        for entry in self.entries:
            tokens = set(_tokenize(entry.text))
            self._doc_freq.update(tokens)

        num_docs = len(self.entries)
        self._embeddings = []
        self._norms = []

        for entry in self.entries:
            tokens = _tokenize(entry.text)
            tf = Counter(tokens)
            doc_len = len(tokens)
            embedding: Dict[str, float] = {}
            for token, count in tf.items():
                idf = math.log((1 + num_docs) / (1 + self._doc_freq[token]))
                embedding[token] = (count / doc_len) * idf
            norm = math.sqrt(sum(weight * weight for weight in embedding.values()))
            self._embeddings.append(embedding)
            self._norms.append(norm if norm != 0 else 1.0)

        self._built = True

    def _vectorize_query(self, text: str) -> Dict[str, float]:
        tokens = _tokenize(text)
        tf = Counter(tokens)
        num_docs = len(self.entries) or 1
        vector: Dict[str, float] = {}
        for token, count in tf.items():
            idf = math.log((1 + num_docs) / (1 + self._doc_freq.get(token, 0)))
            vector[token] = (count / len(tokens)) * idf
        return vector

    def search(self, query: str, top_k: int = 3) -> List[SearchResult]:
        if not query.strip():
            return []

        if not self._built:
            self.build()

        if not self.entries:
            return []

        query_vec = self._vectorize_query(query)
        query_norm = math.sqrt(sum(weight * weight for weight in query_vec.values())) or 1.0

        scores: List[SearchResult] = []
        for entry, embedding, norm in zip(self.entries, self._embeddings, self._norms):
            dot = 0.0
            for token, q_weight in query_vec.items():
                dot += q_weight * embedding.get(token, 0.0)
            score = dot / (query_norm * norm) if norm else 0.0
            scores.append(SearchResult(entry=entry, score=score))

        scores.sort(key=lambda result: result.score, reverse=True)
        return scores[:top_k]