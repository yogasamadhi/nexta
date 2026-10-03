# ADR-0009 — Application Services, Commit and Recovery

**Status:** Accepted  
**Date:** 2026-09-12  
**Relationship:** 补充 ADR-0002、ADR-0003、ADR-0005、ADR-0006；不替代其 Local-first、Pure Core 与 Event-driven 决策。  
**Implementation:** Phase 1 已实现 Application Ports/Services、SQLite UnitOfWork、OperationRecord 幂等重放与 Task 完成基础事务；Phase 2 已实现 pure Scheduler、隔离的内存 Preview、版本/过期检查、SQLite 原子 Commit、SchedulePlan/TimeBlock/IntegrationJob 与响应丢失重放；Phase 3 已实现 Calendar Snapshot/Coverage、可恢复 Integration worker、verified bindings、ExternalMutationIntent、`0002`/`0003` migration，以及 Calendar/Notification Expo Adapter 与仅前台 Mobile 协调器；Phase 4 已接 production SchedulingSnapshot/ScheduleService、权限/刷新 UI 与时间块调整；Phase 5 已实现 `0005`、Execution/Completion/Achievement 本地原子事务、幂等恢复及 Focus/成就 Mobile 闭环。真实 OS/物理设备权限、账户/source、回读、投递和进程恢复仍待验证，Phase 1–5 的开放产品决策与设备 Exit 也尚未全部关闭。阶段与证据见 [PLAN](../../.ai/PLAN.md) / [STATUS](../../.ai/STATUS.md)。

## Context

初始文档要求 UI/Agent 经 Application Service，但未指定代码归属。Scheduler 的 `planVersion` 混用了预览与持久化版本语义；Commit 先写 SQLite 再调用 OS，却未定义本地成功、外部失败和重试不确定性的区别。

这些缺口会导致 UI/Tool 重复业务逻辑、旧 Preview 覆盖新事实，以及外部重试重复创建事件或通知。

## Options

1. 在 UI/各 Tool 中分别完成事务与平台调用：难以共享规则与验证边界。
2. 把平台调用放进 Scheduler Core：违反纯计算边界。
3. 显式平台无关 Application 层，使用本地事务与可恢复的外部同步：采用。

## Decision

- 新增 `packages/application`，承载用例、Ports、校验、权限/实际变更风险、事务、幂等与恢复。Infrastructure 实现 Ports，Mobile Composition Root 注入。
- Scheduler 只产生确定性候选结果。Application 用内存 `previewId` 绑定候选快照；`stateVersion` 表示排程输入版本，`planRevision` 表示已提交计划版本。
- Preview 不写数据库。Commit 在事务内比较输入版本，原子写计划、OperationRecord 与 IntegrationJob；事务成功后才执行 OS Calendar/Notification。
- OperationRecord 用命令与稳定参数摘要识别写操作，并保存首次提交的完整 mutation result DTO snapshot，确保实体后来改变或首次响应丢失后仍能精确重放原结果。参数原文不作为审计旁路保存；结果快照只留在本地业务 SQLite，按敏感业务数据保护。
- 外部通道失败不回滚已成立的本地事实，单独报告同步状态。响应丢失用原 operationId 查询/重试；外部创建结果未知时先核对，无法判断时保留待核对状态。
- IntegrationJob 每通道串行领取；claim token、attempt generation、未来 lease、notBefore 与显式 automaticRetryEligible 组成恢复/fence。过期 lease 可被新 generation 重领，旧 worker 不能完成覆盖；权限阻塞只能由明确前台授权流程重新排队。
- Provider 调用在 SQLite 事务外。每个 Calendar provisioning/event create/update/delete 或 Notification schedule/cancel 前，Application 先在独立事务写 ExternalMutationIntent；回读确认后，在 checkpoint 事务内写 verified/pending binding 并删除 intent，随后以 claim token/attempt CAS 收口 Job。intent 以 integrationJobId 和稳定外部 scope 双重唯一，最小 payload 不含展示文本；带未解决 intent 的可运行 Job 和通道最旧 intent 优先恢复，避免被较新 revision 饥饿。
- 调用前后检查 desiredRevision；旧计划标为 superseded，版本变化后的未知外部结果继续保留待核对状态。owned-marker inventory 可发现缺失 binding，但 partial/unknown 不能证明外部对象不存在。Calendar provisioning 无可靠 marker 回查时不自动释放 intent，必须经过直接用户确认目标缺失。
- Calendar container/event 与 Notification identity 必须经稳定身份和平台 readback 验证后才成为可写 binding；marker 只帮助有界 reconciliation，不单独授予归属。只有可证明安全收敛的未知结果进入自动 retry，其他冲突保持用户可见。
- 完成 Task、完成 Session 和创建 Achievement 使用同一应用层完成规则与真实完成证据；TaskService.complete 是手工/Tool 入口，ExecutionService 的 complete_task 在当前 Session 事务内执行相同规则，避免嵌套事务。状态联动不能隐藏在 Screen 或 Tool 内。
- 自动提交权限仍由产品规则和用户授权决定；Calendar/Notification 的投影内容、提醒提前量、Android source/account 和声音/隐私策略也保持显式注入。本 ADR 不确定这些产品阈值/默认，也不扩大 V1 外部操作范围。

## Consequences

- 新增应用包、操作结果与集成恢复记录，并增加事务、版本、去重、崩溃恢复测试。
- API 文档中的初始 `planVersion` 设计签名更新为明确标识。Phase 1–5 已有代码调用方、Schema 与有序 migration，但尚无已发布生产数据；再改变 Contract/Schema 必须处理调用方、结果/diff 快照兼容性与迁移，不能改写既有 `0000` 至 `0005` 历史。
- UI 必须区分“未提交”与“本地已提交，某通道待同步”。SQLite 与 OS 之间不声称存在 exactly-once 分布式事务。
- ExternalMutationIntent 扩大了本地可恢复窗口而不是提供跨系统原子性：进程可在 intent、OS 调用、binding checkpoint、Job settle 的任一边界终止，恢复必须按当前持久事实和平台回读收敛。
- 基础可靠性随首次能力实现，Phase 9 再进行组合验证。
- 完整结果快照增加本地敏感数据副本；不得送入日志、LLM Context 或无关 Tool，保留/清理必须同时维护幂等和完成证据约束并遵守 DEC-009。

当前 Clock Port 验证 UTC Instant 形状，Schedule Preview/Commit 还会拒绝过期或将写入过去的候选。Execution 关闭区间遇到墙钟倒退时会钳制到区间开始、标记 needs_review 并排除可信投入，避免负耗时和虚假精度；其他 mutation 时间戳的全局单调策略仍未定义。这不改变本 ADR 的事务原子性决定，也不能把局部保护解释为完整时钟回拨策略。

## References

- [Architecture](../03-ARCHITECTURE.md)
- [Data Model](../04-DATA-MODEL.md)
- [Contracts](../05-API.md#commit-contract)
- [Testing](../08-TESTING-ACCEPTANCE.md#requirement-matrix)
- [DEC-002：自动重排阈值](../DECISIONS.md#dec-002)
- [DEC-012：Calendar / Notification production policy](../DECISIONS.md#dec-012)
