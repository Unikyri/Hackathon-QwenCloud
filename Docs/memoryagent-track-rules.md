# Track 1: MemoryAgent — Rules & Evaluation Criteria
### Global AI Hackathon Series with Qwen Cloud

> **Status:** This is a local planning snapshot, not the submission contract. It was stale
> in the Sprint 7 plan and has been refreshed against the [official Devpost
> rules](https://qwencloud-hackathon.devpost.com/rules), which prevail if anything changes.
> The current submission deadline is **July 20, 2026 at 2:00 PM Pacific Time**.

---

## 1. Track Overview

**Goal:** Build an Agent with **persistent memory** that autonomously accumulates experience, remembers user preferences, and makes increasingly accurate decisions across **multi-turn, cross-session interactions**.

Participants should focus on three core capabilities:

- **Efficient memory storage and retrieval** — how memories are indexed, stored, and fetched at scale.
- **Timely forgetting of outdated information** — mechanisms to decay, prune, or overwrite stale memories so the agent doesn't degrade over time.
- **Recalling critical memories within limited context windows** — smart selection/compression so the most relevant memories fit into a constrained prompt budget.

---

## 2. Submission Requirements

Every submission (regardless of track) must include:

1. **Project** built using Qwen models on **Qwen Cloud**, matching the Project Requirements above.
2. **Public, open-source code repository** with:
   - All source code, assets, and setup instructions needed to run the project.
   - A detectable open-source license file, visible in the repo's "About" section.
3. **Text description** explaining the features and functionality of the project.
4. **Proof of Alibaba Cloud deployment** — a direct link to a code file in the repo demonstrating use of Alibaba Cloud services/APIs.
5. **Architecture diagram** — a clear visual showing how Qwen Cloud connects to the backend, database, and frontend (memory store included).
6. **Demo video** (≤ 3 minutes):
   - Must show the project actually functioning.
   - Hosted publicly on YouTube, Vimeo, or Youku.
   - No unauthorized third-party trademarks, music, or copyrighted material.
7. **Track identification** — must specify "Track 1: MemoryAgent."
8. *(Optional)* Blog/social post link documenting the build journey, to qualify for the Blog Post bonus prize.

Additional general rules that apply:
- Project must be **new or significantly updated** during the Submission Period (May 26 – Jul 20, 2026).
- Must be functional, testable, and free of malicious code.
- Must not infringe third-party IP; any third-party SDKs/APIs/data must be properly licensed.
- English required (or English translations of all materials).

---

## 3. Judging Process

**Stage One (Pass/Fail):** Confirms the project reasonably fits the MemoryAgent theme and reasonably applies the required Qwen Cloud APIs/SDKs.

**Stage Two (Scored):** Submissions that pass Stage One are evaluated on four equally-weighted-in-spirit but differently-percentaged criteria:

| Criterion | Weight |
|---|---|
| Innovation & AI Creativity | 30% |
| **Technical Depth & Engineering** | **30%** |
| Problem Value & Impact | 25% |
| Presentation & Documentation | 15% |

---

## 4. Evaluation Criteria — Detailed Breakdown

### Innovation & AI Creativity (30%)
- Sophisticated use of Qwen Cloud APIs (e.g., custom skills, MCP integrations).
- Algorithmic/engineering innovation: novel memory architectures, custom retrieval components, performance optimizations for storage/recall.

### Technical Depth & Engineering (30%) — *Core focus for MemoryAgent*
This is where the memory-specific mechanics matter most:
- **Architecture quality**: modularity, scalability, and robust error handling — especially around the memory subsystem (storage layer, retrieval layer, decay/forgetting logic).
- **Engineering excellence**: clean code and non-trivial logic — e.g., well-structured memory indexing/embedding pipelines, deduplication, conflict resolution between old and new memories.
- **Tech stack sophistication**: advanced patterns and thoughtful adoption of tools for memory management (vector stores, hybrid retrieval, summarization/compression strategies, context-window budgeting techniques).

Judges will specifically be looking for how well the submission demonstrates:
- Efficient storage/retrieval at scale (not just a flat log of messages).
- A genuine forgetting/decay mechanism (not just unlimited accumulation).
- Smart recall strategies that fit critical memories into limited context windows (ranking, summarization, compression, relevance scoring).

### Problem Value & Impact (25%)
- Real-world relevance: does the memory agent solve an authentic business or user pain point (e.g., long-term personalization, continuity across sessions)?
- Scalability potential: could this be productized or grow into an open-source project/community?

### Presentation & Documentation (15%)
- Technical demo clarity: is the memory logic (storage, decay, recall) clearly visualized in the demo video?
- Clear documentation: does the architecture doc explain the memory design decisions?

---

## 5. Prize for This Track

| Prize | Amount | Qty | Eligible Submissions | Judged On |
|---|---|---|---|---|
| Grand Prize – Track 1: MemoryAgent | $7,000 cash + $3,000 cloud credits + blog feature + swag bag | 1 | All eligible Track 1 submissions | All judging criteria above |

*(Also eligible, independent of track: Top 10 Honorable Mention — $500 cash + $500 cloud credits; and Top 10 Blog Post Award — $500 cash + $500 cloud credits, judged separately on thoroughness/impact of the blog post.)*

- A project can win **only one grand prize** and **up to one blog post prize**.
- Winners are subject to identity/eligibility verification before prizes are awarded.

---

## 6. Key Dates (official snapshot)

| Milestone | Date |
|---|---|
| Submission Period | May 26, 2026 (8:00 AM Pacific Time) – Jul 20, 2026 (2:00 PM Pacific Time) |
| Judging Period | Jul 28, 2026 (8:00 AM Pacific Time) – Aug 11, 2026 (2:00 PM Pacific Time) |
| Winners Announced | On or around Aug 17, 2026 (2:00 PM Pacific Time) |
