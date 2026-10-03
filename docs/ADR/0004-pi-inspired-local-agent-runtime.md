# ADR-0004 — Pi-inspired Local Agent Runtime

**Status:** Accepted

## Context

完整 `pi-coding-agent` 依赖 Node / FS / Shell，不适合 Hermes；但 Pi 的 Agent Loop、Tool、State、Streaming 思路适合本产品。

## Decision

自建 `agent-core`：

- 借鉴 Pi Agent Core 思想；
- 不直接移植 Coding Agent；
- Hermes Compatible；
- Pure TypeScript；
- Tool-centric；
- 无 Node built-in。

## Included Concepts

- Agent Loop
- Agent State
- Tool Calling
- Tool Result
- Abort
- Max Turns
- Streaming Events
- Approval Hook
- Context Transform

## Excluded

- Shell
- File Tools
- Process Spawn
- Node FS
- Coding Agent TUI

## Consequences

需要维护自己的轻量 Agent Runtime，但获得移动端可控性和清晰安全边界。

## Implementation Status

Phase 6 已实现 pure TypeScript Agent Loop、State、Tool Registry、完整/流式 tool-call 缓冲、Abort、turn/tool/time 预算、Approval Hook、Context Transform、调用收据复用和 Event Coordinator。架构门禁禁止 Node/Expo/React Native import；真实 Provider 与设备 E2E 仍单独跟踪。
