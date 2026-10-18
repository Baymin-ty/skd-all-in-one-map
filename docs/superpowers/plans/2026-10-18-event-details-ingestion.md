# 活动详情采集与报名建议 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让官网和学校邮件采集的活动拥有可展示详情、报名入口、跨来源去重结果和 AI 报名建议，并在活动详情页呈现。

**Architecture:** 继续使用现有 `CampusEvent` JSON 快照和 SQLite 目录，以独立的纯函数负责正文清洗、报名链接提取和 AI 结果解析；官网与邮件管道在入库前统一补齐详情并通过现有合并入口去重。前台复用 `EventsPanel` 的活动详情状态，后台复用现有编辑与审核接口。

**Tech Stack:** Vue 3 + TypeScript, Node.js ESM, Express, SQLite, Vitest, 现有 `fetch`/`mailparser`/`imapflow`。

**Spec:** `docs/superpowers/specs/2026-10-18-event-details-ingestion-design.md`

## Global Constraints

- 新字段全部可选，兼容旧静态快照和旧数据库活动对象。
- 官网详情解析失败不得中断整次同步；邮件正文或 AI 解析失败不得阻断活动入库。
- 正文必须清洗并限制长度；报名链接优先选择报名、预约、注册语义附近的链接。
- 去重优先级为来源稳定 ID、标题 + 开始日期 + 地点、标题 + 开始日期。
- AI 结果仅作辅助建议，不自动替用户报名。

## Review Focus

- 官网详情页 HTML 含脚本、导航和重复标题时，输出只保留正文文本。
- 邮件包含 HTML、签名和引用历史时，详情不应保存签名或整段引用。
- 官网和邮件的地点写法不同但指向同一活动时，必须合并为一条记录并保留更完整详情。
- AI 返回代码围栏、缺字段或非法 JSON 时，活动仍应入库且建议状态可解释。
- 旧活动对象没有新字段时，列表、详情、日历和分享链路都应继续工作。

### Task 1: 扩展活动类型与详情纯函数

**Files:**
- Modify: `src/lib/discoveryTypes.ts`
- Create: `server/eventDetails.mjs`
- Create: `server/eventDetails.test.mjs`

**Interfaces:**
- Produces `cleanEventDescription(input: string, maxLength?: number): { text: string, truncated: boolean }`。
- Produces `extractRegistrationLink(htmlOrText: string, baseUrl?: string): string | null`。
- Produces `mergeEventDetails(existing, incoming): CampusEvent`，仅合并详情相关字段和来源元数据。

- [ ] **Step 1: Write failing tests** for HTML stripping, signature/quote removal, length truncation, registration link selection, and detail merge preferring the longer non-empty description.
- [ ] **Step 2: Run `npx vitest run server/eventDetails.test.mjs` and verify the new tests fail.**
- [ ] **Step 3: Add optional `description`, `registrationUrl`, `registrationDeadline`, `sourceUrls`, `collectedAt`, and structured `aiRecommendation` fields to `CampusEvent`; implement the three pure functions in `server/eventDetails.mjs`.
- [ ] **Step 4: Run the focused test and verify it passes.**
- [ ] **Step 5: Run `npm run build` to verify TypeScript consumers accept the optional fields.**

### Task 2: 官网详情页采集与跨来源去重合并

**Files:**
- Modify: `server/eventSync.mjs`
- Modify: `server/eventSync.test.mjs`
- Modify: `server/eventPipeline.mjs`
- Modify: `server/eventPipeline.test.mjs`

**Interfaces:**
- Consumes `cleanEventDescription`, `extractRegistrationLink`, and `mergeEventDetails` from Task 1.
- Preserves existing `fetchOfficialRecords` and `syncOfficialEvents` signatures.

- [ ] **Step 1: Add failing tests** with a mocked detail URL response and a matching email event; assert description, registration URL, source URL list, and one merged catalog record.
- [ ] **Step 2: Run the focused event sync/pipeline tests and verify the new assertions fail.**
- [ ] **Step 3: Fetch detail pages with the existing timeout pattern, enrich official records, and pass enriched records through the existing merge path; update duplicate matching to use stable source ID, normalized title/date/place, then normalized title/date.
- [ ] **Step 4: Ensure detail fetch warnings are attached to the run without clearing old catalog data when detail fetch fails.**
- [ ] **Step 5: Run `npx vitest run server/eventSync.test.mjs server/eventPipeline.test.mjs` and verify all pass.**

### Task 3: 邮件正文详情与报名信息

**Files:**
- Modify: `server/mailEvents.mjs`
- Modify: `server/eventPipeline.mjs`
- Modify: `server/eventPipeline.test.mjs`

**Interfaces:**
- Consumes `cleanEventDescription` and `extractRegistrationLink` from Task 1.
- Keeps current `extractMailEvents` return shape while adding detail fields to each returned event.

- [ ] **Step 1: Add failing tests** for HTML email text, quoted reply and signature removal, and registration-link extraction.
- [ ] **Step 2: Run the focused mail tests and verify failure.**
- [ ] **Step 3: Preserve parsed plain text/HTML context long enough to clean it, extract registration metadata, and attach fields to each email event before duplicate matching.**
- [ ] **Step 4: Verify warnings and review queue behavior remain unchanged for malformed or incomplete messages.**
- [ ] **Step 5: Run the mail and pipeline tests.**

### Task 4: AI 报名建议服务与降级

**Files:**
- Create: `server/eventRecommendation.mjs`
- Create: `server/eventRecommendation.test.mjs`
- Modify: `server/eventPipeline.mjs`

**Interfaces:**
- Produces `recommendEventRegistration(event, options?): Promise<AiRecommendation | null>`.
- Accepts `fetcher`, `apiKey`, `model`, and `timeoutMs` overrides for tests.
- Returns `null` for missing configuration, timeout, invalid JSON, or missing required fields; never throws into the pipeline.

- [ ] **Step 1: Write failing tests** for valid JSON, fenced JSON, missing fields, malformed JSON, and no API key.
- [ ] **Step 2: Run `npx vitest run server/eventRecommendation.test.mjs` and verify failure.**
- [ ] **Step 3: Implement the bounded JSON prompt and parser using the configured AI endpoint; normalize decision values to `recommend`, `consider`, or `skip`.**
- [ ] **Step 4: Call the service after detail enrichment and before catalog merge; attach non-blocking warnings when it returns `null`.**
- [ ] **Step 5: Run recommendation and pipeline tests.**

### Task 5: 前台活动详情展示

**Files:**
- Modify: `src/components/EventsPanel.vue`
- Modify: `src/components/EventCard.vue`
- Modify: `src/lib/i18n.ts` only if existing translation keys are insufficient

**Interfaces:**
- Consumes optional `CampusEvent.description`, `registrationUrl`, `registrationDeadline`, `sourceUrls`, `collectedAt`, and `aiRecommendation`.
- Keeps `openEvent`, navigation, share, check-in, community, and add-to-today behavior intact.

- [ ] **Step 1: Add a component-level test or type-safe fixture covering an old event without new fields and an enriched event with all fields.**
- [ ] **Step 2: Implement detail sections for正文、报名入口、AI 建议、来源与采集时间; show explicit empty states when details or recommendations are unavailable.**
- [ ] **Step 3: Add focused styles for readable long-form text, recommendation decision badges, and registration action.**
- [ ] **Step 4: Run `npm run build` and the existing frontend tests.**

### Task 6: 后台编辑与待审核字段

**Files:**
- Modify: `server/admin.mjs`
- Modify: `server/eventPipeline.mjs`
- Modify: `src/admin/EventCatalogPanel.vue`
- Modify: `src/admin/EventReviewPanel.vue`
- Modify: `src/admin/eventPipeline.ts`
- Modify related admin tests

**Interfaces:**
- Adds the same detail fields to admin update and review approval allowlists with length/URL/time validation.
- Keeps current manual override behavior and review state transitions.

- [ ] **Step 1: Add failing server tests for saving and approving description, registration URL, and deadline.**
- [ ] **Step 2: Implement server validation and include fields in admin editor/review payloads.**
- [ ] **Step 3: Add form controls and display detail preview in the admin panels.**
- [ ] **Step 4: Run admin/event pipeline tests and `npm run build`.**

### Task 7: Full verification

**Files:**
- Modify: `server/eventDetails.test.mjs`, `server/eventRecommendation.test.mjs`, and affected tests only when failures identify a real compatibility issue.

- [ ] **Step 1: Run `npm test`.**
- [ ] **Step 2: Run `npm run build`.**
- [ ] **Step 3: Inspect the final diff and verify no generated secrets, network fixtures, or oversized raw email bodies are committed.**
- [ ] **Step 4: Report the implementation and any environment limitation, including unavailable AI configuration or blocked git commit.**
