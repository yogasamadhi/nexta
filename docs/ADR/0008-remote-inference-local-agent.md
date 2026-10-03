# ADR-0008 — Remote Inference First, Local Agent Runtime

**Status:** Accepted

## Context

“本地 Agent”与“本地 LLM 推理”不是同一概念。V1 需要控制包体、性能、耗电和模型兼容风险。

## Decision

V1：

```text
Agent Runtime
Tools
Scheduler
Memory Metadata
SQLite
User Model
= Local

LLM Inference
= Provider Adapter，可远端
```

后续可加入 Native Local LLM Adapter。

不在 Hermes 中直接执行大模型矩阵推理。

## Consequences

- 离线时 Agent 的 LLM 增强能力可降级；
- Scheduler / Task / Execution 仍可本地工作；
- Context 必须最小化外发。

## Implementation Status

Phase 6 已实现本地 Agent/Tool/最小 AgentRun SQLite metadata、统一 ModelProvider Contract 与 Fake Provider；没有在 Hermes 内运行模型，也没有打包真实 Provider SDK 或共享密钥。远端 Provider 与生产凭据模式等待 DEC-005。
