# ADR-0006 — Event-driven Background Model

**Status:** Accepted

## Context

iOS / Android 不允许普通 JS Agent 永久后台运行。

## Decision

Agent 只由事件触发：

- 用户输入；
- App Resume；
- Task 完成；
- Calendar Change；
- Notification 点击；
- OS Background Window；
- 手动 Replan。

精确提醒交给 OS Notification Scheduler。

## Consequences

- 不设计 `while(true)` Agent；
- Background Task 只做可延迟工作；
- Plan Commit 必须提前注册提醒。
