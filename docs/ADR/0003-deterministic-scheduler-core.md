# ADR-0003 — Deterministic Scheduler Core

**Status:** Accepted

## Context

让 LLM 直接生成 Calendar 会产生不稳定、冲突、不可复现与不可测试问题。

## Decision

建立独立 `scheduler-core`：

- Pure TypeScript；
- 确定性；
- 显式 Hard/Soft Constraints；
- LLM 只能调用 Scheduler，不直接决定最终时间表。

## Reasons

- 可测试；
- 可解释；
- 可复现；
- 不依赖模型质量；
- 可跨 Mobile/Desktop/Cloud 复用。

## Consequences

- 需要独立算法与测试投入；
- 排程体验的核心竞争力转移到 Scheduler + User Model。
