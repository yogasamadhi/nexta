# ADR-0005 — Separate Agent Orchestration from Scheduling

**Status:** Accepted

## Decision

职责：

```text
LLM
= 理解 / Reasoning / 解释

Agent
= 编排 / Tool Selection

Scheduler
= 约束计算 / 排程

Application Service
= Commit / Persistence / Side Effect
```

Agent 不直接构造最终 Calendar Plan。

## Consequences

- Tool Contract 是关键边界；
- Scheduler 必须可独立运行；
- 无网络时仍可使用本地规则排程。
