# ADR-0002 — Local-first SQLite + Drizzle

**Status:** Accepted

## Context

任务、时间块、执行、成就和用户模型属于高度结构化个人数据，并且核心功能应离线可用。

## Decision

V1 使用：

- expo-sqlite
- Drizzle ORM
- SQLite 作为本地业务事实源

Secret 使用 SecureStore，不进入普通 DB。

## Reasons

- Offline-first；
- 查询能力强；
- 事务；
- 数据关系明确；
- 易于未来同步；
- 用户隐私边界清晰。

## Consequences

- 必须维护 Migration；
- UI 不直接访问表；
- Cloud Sync 需后续单独设计。
