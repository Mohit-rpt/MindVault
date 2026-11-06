# MindVault — Phase 5: Memory Architecture & Context Compression

**Focus:** Dual-Tier Bounded Memory, Query Contextualization, and Anti-Drift Design

---

## 1. The Conversational Context Dilemma in RAG

Naively accumulating all previous dialogue messages in a multi-turn RAG assistant causes three severe architectural failure modes:

1. **Context Window Exhaustion:** Unbounded token accumulation overflows LLM context limits or crowds out authoritative document evidence chunks.
2. **Context Dilution & Attention Drift:** Models lose focus on the user's latest query when forced to read thousands of tokens of historical conversational banter.
3. **Hallucination Amplification:** If past assistant responses contained tentative remarks or speculative points, appending them as factual context causes the model to cite past chat messages as real evidence.

---

## 2. MindVault Dual-Tier Memory Model

To solve these failure modes deterministically, MindVault implements a **dual-tier memory architecture**:

```
+-----------------------------------------------------------------------+
| MindVault Dual-Tier Conversational Memory Architecture                |
+-----------------------------------------------------------------------+
|                                                                       |
|  Tier 1: Sliding Window Context (Recent k = 6–10 turns)               |
|  - Full verbatim text of user questions and assistant answers         |
|  - Provides immediate conversational referents (pronouns, subjects)  |
|  - Strict budget: ≤ 1,500 tokens                                     |
|                                                                       |
|                               ^                                       |
|                               | (Messages older than window threshold)|
|                               v                                       |
|                                                                       |
|  Tier 2: Rolling Summarization (Asynchronous Background Synthesis)    |
|  - Compact neutral synopsis of earlier dialogue turns                 |
|  - Captures: Primary concepts, user objectives, established references|
|  - Bounded size: ≤ 120 words (≤ 180 tokens)                           |
|  - Versioned: summaryVersion incremented on every update              |
|                                                                       |
+-----------------------------------------------------------------------+
```

---

## 3. Query Contextualization Engine

Before executing semantic or keyword search, the incoming user query is analyzed by `QueryContextService`.

### 3.1 Detection Rules

The system checks whether the query requires resolution using regular expression heuristics:

- **Pronouns:** `\b(it|its|this|that|these|those|they|them|the former|the latter)\b`
- **Ellipticals:** `^(give me|show me|tell me more|what about|how about|why\?|can you elaborate|its limitations)\b`
- **Short Length:** `words <= 4` combined with referential markers.

### 3.2 Rewrite Strategies

- **Pass-Through:** If the query is already self-contained (e.g. _"Explain PostgreSQL GIN indexes"_), no rewrite is executed.
- **Heuristic Contextualization:** Resolves simple demonstratives by extracting the primary subject from the previous user turn.
- **LLM Contextualization:** For complex comparative or elliptical questions, a zero-shot rewrite prompt constructs a standalone search query:
  ```
  Given conversation history and follow-up query, produce a standalone search query.
  Output ONLY the standalone query.
  ```

---

## 4. Background Rolling Summarization

### 4.1 Triggering Logic

Summarization is evaluated on every completed assistant turn:
$$\text{unsummarizedCount} = \text{session.messageCount} - \text{session.summarizedThroughSeq}$$
If $\text{unsummarizedCount} \ge 4$, an asynchronous background task is spawned.

### 4.2 Non-Blocking Invariant

Summarization runs independently in the background (`(async () => { ... })()`). It **never** blocks the SSE stream or delays the user's answer. If summarization fails or times out, the error is safely caught and logged without affecting session integrity.
