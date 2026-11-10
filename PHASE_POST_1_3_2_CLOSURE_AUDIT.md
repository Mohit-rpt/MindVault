# MindVault Post-Phase Stage 1.3.2

# Final Closure Audit: Real-World Generation & Remediation

**Milestone:** Post-Phase Stage 1 — Real-World RAG Quality Validation  
**Task:** 1.3.2 Final Closure Audit  
**Audit Mode:** STRICT READ-ONLY EVIDENCE & VERIFICATION AUDIT  
**Audit Date:** November 9, 2026  
**Auditor:** Antigravity Autonomous Agent  
**Repository Working Copy Commit:** `a5697e4cec094c0a0af0575a5c16d53311fc7e1d`  
**Evaluation Target:** Dedicated Database `mindvault_eval` on PostgreSQL port 5433

---

## 1. Audit Verdict

### Final Verdict: **CLOSED WITH CONDITIONS**

**Verdict Justification:**

1. **Core Verification Satisfied:** Both reported production defects (`DEFECT-INGEST-01` and `DEFECT-GROUNDING-01`) have been remediated in production source files, verified with passing unit test suites (15/15 and 14/14 respectively), and proven effective in the live end-to-end evaluation pipeline.
2. **Complete Question Coverage:** All 36 golden evaluation questions (`EVAL-Q01` through `EVAL-Q36`) have complete generative answers, citation validations, grounding evaluations, semantic correctness scores, faithfulness scores, and latency measurements persisted in authoritative JSON result artifacts.
3. **Real Gemini Integration:** Evaluation was executed using genuine Google Gemini models via `@google/genai` SDK v2.32.0, achieving an average correctness score of **4.28 / 5.0**, **86.7% citation validity**, **0% citation hallucinations**, **100% abstention accuracy**, and an average latency of **8,255 ms** (an 86.3% latency reduction from local CPU inference).
4. **Conditions Defined:**
   - **Condition 1 (Dual-Model Distribution):** The evaluation utilized a split execution across two Gemini models (`gemini-3.5-flash` for 19 questions, `gemini-3.1-flash-lite` for 17 questions) to overcome Google AI Studio's Free Tier quota ceiling of 20 Requests Per Day per model.
   - **Condition 2 (Harness Ingestion Accounting Artifact):** While all 5 corpus PDFs passed production extraction and were successfully ingested into `mindvault_eval`, the evaluation script `eval-ingestion-runner.ts` retained a legacy accounting field setting `failedIngestions: 5` reflecting pre-remediation probe count rather than actual failure count.
   - **Condition 3 (Production Provider Default):** Production environment configuration defaults remain set to `LLM_PROVIDER=ollama`. Activating Gemini in production requires setting `LLM_PROVIDER=gemini` and providing a valid `GEMINI_API_KEY`.

---

## 2. Verification Analysis

### 2.1 Verification Point 1: Production Defect Remediation

#### DEFECT-INGEST-01 — PDF Extraction Runtime Crash

- **Affected File:** [`apps/worker/src/modules/ingestion/extractors/pdf.extractor.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/worker/src/modules/ingestion/extractors/pdf.extractor.ts)
- **Problem Statement:** Calling `await pdfParse(buffer)` caused an unhandled `TypeError: pdfParse is not a function` because `pdf-parse` v2.4.5 exports a class constructor `PDFParse` rather than a callable default function.
- **Implementation Evidence:**
  In [`pdf.extractor.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/worker/src/modules/ingestion/extractors/pdf.extractor.ts#L18-L49), dual-mode version detection was implemented:
  ```typescript
  if (typeof pdfModule.PDFParse === 'function') {
    // pdf-parse v2.x class API
    const parser = new pdfModule.PDFParse({ data: buffer });
    try {
      const textResult = await parser.getText();
      const infoResult = await parser.getInfo().catch(() => ({}));
      rawText = textResult.text || '';
      pageCount = textResult.total || (textResult.pages ? textResult.pages.length : 1);
      // ... page mapping
    } finally {
      await parser.destroy().catch(() => {});
    }
  } else if (typeof (pdfModule.default || pdfModule) === 'function') {
    // pdf-parse v1.x fallback callable function API
    const parseFn = pdfModule.default || pdfModule;
    const data = await parseFn(buffer);
    // ... v1 processing
  }
  ```
- **Test Evidence:**
  Executed [`apps/worker/src/modules/ingestion/extractors/extractors.test.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/worker/src/modules/ingestion/extractors/extractors.test.ts):
  - **15 passed out of 15 tests (100%)**.
  - Verified extraction of single-page PDFs, multi-page PDFs, page metadata, Unicode text, and graceful rejection of corrupted buffers.
- **Status:** **VERIFIED RESOLVED**.

#### DEFECT-GROUNDING-01 — False Negative Grounding Classification

- **Affected File:** [`apps/api/src/modules/generation/services/grounding.service.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/services/grounding.service.ts)
- **Problem Statement:** `evaluateGrounding` contained an artificial heuristic penalty: `if (suppliedSources.length > 3 && validCitationIds.length < suppliedSources.length)` which unconditionally downgraded answers to `PARTIALLY_GROUNDED`. When hybrid retrieval supplied 5 candidate chunks but a question only required 2 chunks, a concise, accurate answer citing `[S1],[S2]` was penalized.
- **Implementation Evidence:**
  In [`grounding.service.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/services/grounding.service.ts#L55-L67), the artificial source count threshold was eliminated. The logic now strictly validates citation existence and validity:
  ```typescript
  if (acknowledgesLackOfEvidence || suppliedSources.length === 0) {
    status = 'INSUFFICIENT_EVIDENCE';
  } else if (!citationResult.citationIdsValid) {
    status = 'CITATION_INVALID';
  } else if (citationResult.citationsPresent && citationResult.citationIdsValid) {
    // Citations are present and all cited citation IDs exist in suppliedSources
    status = 'GROUNDED';
  } else {
    // Evidence was supplied but no citations were included
    status = 'PARTIALLY_GROUNDED';
  }
  ```
- **Test Evidence:**
  Executed [`apps/api/src/modules/generation/services/grounding.service.test.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/services/grounding.service.test.ts):
  - **14 passed out of 14 tests (100%)**.
  - Verified scenarios including all sources cited, relevant subsets cited (2 of 5, 1 of 5), invalid citation IDs (fail-closed to `CITATION_INVALID`), missing citations (`PARTIALLY_GROUNDED`), and unanswerable acknowledgments (`INSUFFICIENT_EVIDENCE`).
- **Status:** **VERIFIED RESOLVED**.

---

### 2.2 Verification Point 2: Gemini Model Attribution (Primary vs Fallback)

The evaluation was executed across two distinct Google Gemini models due to Google AI Studio's Free Tier quota ceiling of 20 Requests Per Day (RPD) per model identifier.

#### Per-Model Attribution Matrix

Authoritative source: [`evaluation/results/generation-results.json`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/evaluation/results/generation-results.json)

| Model Identifier            | Model Role     | Question Count | Question IDs Evaluated                                                   | Avg Score (1-5) | Avg Faithfulness | Avg Latency | Grounding Distribution                                     |
| --------------------------- | -------------- | -------------- | ------------------------------------------------------------------------ | --------------- | ---------------- | ----------- | ---------------------------------------------------------- |
| **`gemini-3.5-flash`**      | Primary Model  | **19**         | `EVAL-Q01` through `EVAL-Q14`, `EVAL-Q16` through `EVAL-Q19`, `EVAL-Q27` | **4.16 / 5.0**  | 0.84 / 1.0       | 11,596 ms   | 14 GROUNDED, 3 INSUFFICIENT_EVIDENCE, 2 PARTIALLY_GROUNDED |
| **`gemini-3.1-flash-lite`** | Fallback Model | **17**         | `EVAL-Q15`, `EVAL-Q20` through `EVAL-Q26`, `EVAL-Q28` through `EVAL-Q36` | **4.41 / 5.0**  | 0.96 / 1.0       | 4,520 ms    | 12 GROUNDED, 5 INSUFFICIENT_EVIDENCE                       |
| **Total / Combined**        | —              | **36**         | All questions                                                            | **4.28 / 5.0**  | 0.90 / 1.0       | 8,255 ms    | 26 GROUNDED, 8 INSUFFICIENT_EVIDENCE, 2 PARTIALLY_GROUNDED |

#### Findings on Model Allocation

1. **Fallback Triggering:** When `gemini-3.5-flash` exceeded its 20 RPD Free Tier limit, the harness caught `HTTP 429 RESOURCE_EXHAUSTED`, marked `gemini-3.5-flash` as exhausted in an in-memory Set, and routed subsequent questions to `gemini-3.1-flash-lite`.
2. **Quality Consistency:** `gemini-3.1-flash-lite` exhibited virtually identical or slightly superior fidelity to instructions, scoring 4.41/5.0 with 0.96 faithfulness and executing ~2.5x faster (4,520 ms vs 11,596 ms).
3. **Honest Attribution:** Every individual question record in `generation-results.json` and `per-question-raw-results.json` explicitly documents its executing model via the `modelUsed` attribute.

---

### 2.3 Verification Point 3: Citation Validity, Precision and Completeness

To clarify the exact citation measurements across the 36 questions:

1. **Citation ID Validity (`citationIdsValid`):**
   - **Formula:** `unknownCitationIds.length === 0`.
   - **Measured Rate:** **100.0%**.
   - **Evidence:** Across all 36 evaluation questions, zero unknown, hallucinated, or out-of-bounds citation IDs were generated. Every single referenced citation (`[S1]`, `[S2]`, etc.) was a valid member of the retrieved `suppliedSources`.
2. **Answer-Level Citation Presence Rate (`citationValidityRate`):**
   - **Formula:** `(validQuestionsWithCitations / totalAnswerableQuestions) * 100` across the 30 answerable questions (Categories 1, 2, 3, 4, 6).
   - **Measured Rate:** **86.7% (26 / 30)**.
   - **Evidence:** 26 out of 30 answerable questions contained valid bracketed citations. The 4 questions without citations were:
     - `EVAL-Q08`: refused due to lack of cross-region replication details in context.
     - `EVAL-Q10`: refused due to lack of cluster throttling details in context.
     - `EVAL-Q13`: answered without bracketed source tags.
     - `EVAL-Q18`: answered without bracketed source tags.
3. **Citation Precision:**
   - **Formula:** `validCitationIds / referencedCitationIds`.
   - **Measured Rate:** **100.0%**.
   - **Evidence:** 100% of citation IDs referenced in generated answers mapped directly to supplied context sources.
4. **Citation Completeness / Document Recall:**
   - **Formula:** `(citedExpectedSupportingDocs / totalExpectedSupportingDocs) * 100`.
   - **Measured Rate:** **73.2% (30 / 41)**.
   - **Evidence:** Across all 30 answerable queries requiring 41 total supporting document mentions, Gemini cited chunks from 30 of the 41 expected documents. Omissions occurred primarily where multiple redundant documents covered the same fact and Gemini selected the single most concise source.

---

### 2.4 Verification Point 4: Baseline Comparability & Limitations

#### Identical Elements

- **Evaluation Dataset:** Exactly identical 36 questions, question IDs (`EVAL-Q01`–`EVAL-Q36`), categories, and golden expected answers from [`evaluation/dataset/eval-questions.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/evaluation/dataset/eval-questions.ts).
- **Corpus & Database:** Same 6 documents (`MV-DOC-01` to `MV-DOC-06`) ingested into dedicated PostgreSQL database `mindvault_eval` on port 5433 with pgvector `0.8.7`.
- **Embeddings:** Identical Ollama `nomic-embed-text` (768 dimensions) used for chunk indexing and query vectorization.
- **Retrieval Engine:** Same 3-way hybrid retrieval engine combining pgvector HNSW cosine search, PostgreSQL FTS, and graph relations with Reciprocal Rank Fusion ($k=60$).
- **Context Construction:** Identical `RAGPromptBuilder` template with `[S1]..[S5]` context labeling.

#### Comparability Limitations & Nuances

1. **Model Parameter Asymmetry:**
   - **Baseline:** Local `qwen3:0.6b` (0.6B parameter model) running via Ollama on host CPU.
   - **Evaluation:** Google Gemini (`gemini-3.5-flash` / `gemini-3.1-flash-lite`), modern frontier cloud models.
   - _Impact:_ The quality jump (correctness 3.42 -> 4.28, faithfulness 0.68 -> 0.90) is primarily driven by model parameter scale and reasoning capacity.
2. **Evaluation Generation Hyperparameters:**
   - **Baseline:** `temperature: 0.2`, `num_predict: 512` tokens.
   - **Gemini:** `temperature: 0.1`, `maxTokens: 1024` tokens.
3. **Grounding Heuristic Change (Fix B Timing):**
   - The Qwen baseline was evaluated _prior_ to Fix B, when `GroundingService` contained the faulty multi-source rule that forced answers citing $< 100\%$ of supplied chunks to `PARTIALLY_GROUNDED`. As a result, Qwen received 0 `GROUNDED` classifications in the baseline.
   - Gemini was evaluated _after_ Fix B. If Qwen were re-evaluated post-Fix B, its grounded count would have increased from 0 to approximately 13 (reflecting the 50% of questions where it cited valid sources).
4. **Hardware Inference vs Network Latency:**
   - Qwen's average latency (60,152 ms) reflects local CPU-bound inference on 4 vCPUs without GPU acceleration.
   - Gemini's average latency (8,255 ms) reflects API network transmission and Google cloud accelerator inference.

---

### 2.5 Verification Point 5: Ingestion Pipeline & Corpus PDF Verification

#### Database Verification Query

An independent direct query to `mindvault_eval` confirmed that all 5 PDF files and the single Markdown file exist in the database with status `COMPLETED`:

```sql
SELECT id, original_name, mime_type, extension, chunk_count, status FROM documents ORDER BY id;
```

**Live Query Results:**

```
┌─────────┬─────────────┬─────────────────┬───────────────────┬───────────┬────────────┬─────────────┐
│ (index) │ id          │ originalName    │ mimeType          │ extension │ chunkCount │ status      │
├─────────┼─────────────┼─────────────────┼───────────────────┼───────────┼────────────┼─────────────┤
│ 0       │ 'MV-DOC-01' │ 'MV-DOC-01.pdf' │ 'application/pdf' │ 'pdf'     │ 1          │ 'COMPLETED' │
│ 1       │ 'MV-DOC-02' │ 'MV-DOC-02.pdf' │ 'application/pdf' │ 'pdf'     │ 1          │ 'COMPLETED' │
│ 2       │ 'MV-DOC-03' │ 'MV-DOC-03.pdf' │ 'application/pdf' │ 'pdf'     │ 1          │ 'COMPLETED' │
│ 3       │ 'MV-DOC-04' │ 'MV-DOC-04.pdf' │ 'application/pdf' │ 'pdf'     │ 1          │ 'COMPLETED' │
│ 4       │ 'MV-DOC-05' │ 'MV-DOC-05.pdf' │ 'application/pdf' │ 'pdf'     │ 1          │ 'COMPLETED' │
│ 5       │ 'MV-DOC-06' │ 'MV-DOC-06.md'  │ 'text/markdown'   │ 'md'      │ 1          │ 'COMPLETED' │
└─────────┴─────────────┴─────────────────┴───────────────────┴───────────┴────────────┴─────────────┘
```

#### Production Extractor Execution Trace

From task execution log `task-14415.log`:

- Lines 23–32: Each PDF was processed through `extractDocument(buffer, 'pdf', 'application/pdf')` invoking the production `extractPdf` method:
  - `MV-DOC-01.pdf` (2,386 bytes) `-> SUCCESS`
  - `MV-DOC-02.pdf` (2,233 bytes) `-> SUCCESS`
  - `MV-DOC-03.pdf` (2,042 bytes) `-> SUCCESS`
  - `MV-DOC-04.pdf` (2,096 bytes) `-> SUCCESS`
  - `MV-DOC-05.pdf` (1,835 bytes) `-> SUCCESS`
- Lines 33–44: Each extracted text was chunked and indexed into `document_chunks` with real Ollama 768-dimensional embeddings.

#### Ingestion Accounting Field Discrepancy (Condition 2)

In [`evaluation/results/ingestion-results.json`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/evaluation/results/ingestion-results.json), the summary header reports:

```json
"totalDocumentsTested": 11,
"successfulIngestions": 6,
"failedIngestions": 5,
"pdfExtractorDefectDetected": false
```

**Audit Finding:**  
In [`evaluation/harness/eval-ingestion-runner.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/evaluation/harness/eval-ingestion-runner.ts#L321-L323), the summary object hardcodes:

```typescript
totalDocumentsTested: corpusFiles.length + pdfFilenames.length, // 6 + 5 = 11
successfulIngestions: corpusFiles.length,                      // 6
failedIngestions: pdfFilenames.length,                          // 5
```

This was a historical artifact from Stage 1.2 when the 5 PDF files were expected to fail extraction. When Fix A made extraction succeed (`pdfExtractorDefectDetected` remained `false`), line 323 was not updated to use a dynamic failure counter. As verified by the database records above, all 5 PDFs succeeded in production extraction and ingestion.

---

### 2.6 Verification Point 6: Full 36-Question Coverage

Verification of question result files:

- **`generation-results.json`:** Contains exactly **36 question result objects** (`questions.length = 36`).
- **`per-question-raw-results.json`:** Contains exactly **36 question trace objects** (`raw.length = 36`).
- **Missing Question IDs:** **0**. Both arrays contain every ID from `EVAL-Q01` through `EVAL-Q36`.
- **Answer Substance:** Every question has non-empty `generatedAnswer`, valid `citationDetails`, non-null `groundingStatus`, and measured `answerCorrectnessScore` (1 to 5).

---

### 2.7 Verification Point 7: Remaining Critical Defects & Unsupported Claims

1. **No Remaining Production Critical Defects:**
   - Extraction of PDF, DOCX, TXT, and Markdown works reliably without unhandled errors.
   - Grounding validation accurately rewards grounded answers while maintaining fail-closed protection on invalid citations or empty answers.
2. **Evaluated Claims Verified:**
   - The claim of **86.7% citation validity** is empirically accurate (26 out of 30 answerable queries contain valid citations).
   - The claim of **0% citation hallucinations** is verified (zero unknown IDs).
   - The claim of **100% abstention accuracy** on Category 5 is verified (6/6 unanswerable queries explicitly refused with zero hallucinated facts).
3. **Operational Recommendation:**
   - To adopt Gemini in production deployment, configure `LLM_PROVIDER=gemini` in `.env` and provision a Google AI Studio Paid Tier (Pay-As-You-Go) key to eliminate the 20 RPD Free Tier constraint.

---

## 3. Authoritative Evidence Artifact Manifest

| Artifact File                                                                                                                                                                      | Description                                                 | Verification Status                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------- |
| [`PHASE_POST_1_3_2_GEMINI_FINAL_EVALUATION_REPORT.md`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/PHASE_POST_1_3_2_GEMINI_FINAL_EVALUATION_REPORT.md)                       | Comprehensive final evaluation report                       | **VERIFIED ACCURATE**              |
| [`evaluation/results/generation-results.json`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/evaluation/results/generation-results.json)                                       | 36-question generation, citation, and grounding records     | **VERIFIED ACCURATE**              |
| [`evaluation/results/per-question-raw-results.json`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/evaluation/results/per-question-raw-results.json)                           | Full end-to-end question traces with retrieval & generation | **VERIFIED ACCURATE**              |
| [`evaluation/results/aggregate-benchmark-results.json`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/evaluation/results/aggregate-benchmark-results.json)                     | High-level summary metrics                                  | **VERIFIED ACCURATE**              |
| [`evaluation/results/reproducibility-metadata.json`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/evaluation/results/reproducibility-metadata.json)                           | Git commit hash, OS, and model digests                      | **VERIFIED ACCURATE**              |
| [`evaluation/results/failure-issue-register.json`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/evaluation/results/failure-issue-register.json)                               | Defect remediation status register                          | **VERIFIED ACCURATE**              |
| [`apps/worker/src/modules/ingestion/extractors/pdf.extractor.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/worker/src/modules/ingestion/extractors/pdf.extractor.ts) | Fix A: Dual-mode PDF extractor                              | **VERIFIED (15/15 tests passing)** |
| [`apps/api/src/modules/generation/services/grounding.service.ts`](file:///c:/Users/mohit/OneDrive/Desktop/MindVault/apps/api/src/modules/generation/services/grounding.service.ts) | Fix B: Calibrated grounding service                         | **VERIFIED (14/14 tests passing)** |

---

## 4. Stage 2 Security Validation Gate

Per strict project governance:

- **Stage 1.3.2 is CLOSED WITH CONDITIONS.**
- **Stage 2 Security Validation has NOT been started.**
- Execution is strictly stopped at this gate awaiting explicit user authorization.
