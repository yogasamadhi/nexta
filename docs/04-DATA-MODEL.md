# 04 — Data Model

## 1. 原则

- SQLite 是 V1 业务数据本地事实源。
- Drizzle Schema 是已实现字段的机器事实源。`0000_phase1_foundation` 已实现 `goals`、`projects`、`tasks`、`operation_records`、`completion_records`、`task_activity_events` 与单例 `schedule_state`；`0001_phase2_schedule_commit` 已实现 `time_blocks`、`schedule_plans` 与初始 `integration_jobs`；`0002_phase3_calendar_notifications` 保持既有 migration/checksum 不变，升级 IntegrationJob 恢复字段并新增 Calendar Snapshot/Coverage 与 Calendar/Notification Binding 表；`0003_phase3_external_mutation_intents` 追加外部副作用 write-ahead intent；`0004_phase4_user_preferences` 追加带唯一 key 与 JSON 约束的 `user_preferences`；`0005_phase5_execution_achievements` 追加 `execution_sessions`、`execution_intervals`、`achievements`，并以 SQLite rebuild 为 CompletionRecord 的可选 Session 来源建立真实外键；`0006_phase6_agent_runs` 追加不含消息正文的最小 `agent_runs` metadata；`0007_phase7_user_model_features` 追加可按算法版本原子替换的 `user_model_features` 派生缓存；`0008_phase8_wellbeing` 追加 `daily_reflections`、`energy_check_ins` 与 `relax_sessions`。本文其余实体仍是后续阶段的设计基线，不能视为已存在的表。
- 本文档保存业务语义、关系、约束和演进原则。
- Secret 不进入普通业务表。
- 时刻持久化使用 UTC Instant；本地日期、工作窗口与调度日保留 Time Zone ID，规则见本文件“时间语义”。

---

## 2. Domain Overview

```text
Goal
 ↓
Project
 ↓
Task
 ↓ 1:N
TimeBlock
 ↓
ExecutionSession
 ↓
Achievement

Task / Execution / CheckIn / Relax
              ↓
          User Model

Daily Data
   ↓
Reflection
```

---

## 3. Goal

核心字段：

```text
id
title
description
status
targetDate?
createdAt
updatedAt
archivedAt?
```

关系：

- 1:N Project
- 1:N Task（允许直接关联）

V1 进度先展示真实计数“已完成 N / 有效任务 M”：汇总直接关联及所属 Project 的 Task，按 ID 去重，排除 canceled 与仅作分组且已有子任务的父 Task；M=0 时显示“暂无可汇总任务”，不显示虚假的完成百分比。归档不改变完成事实；不按 LLM 主观判断增加进度。

---

## 4. Project

```text
id
goalId?
title
description
status
deadline?
createdAt
updatedAt
archivedAt?
```

---

## 5. Task

```text
id
projectId?
goalId?
parentTaskId?

title
description?

status
priority

estimatedDurationMinutes?
baselineEstimatedDurationMinutes?  # 首次排程或开始时冻结的估时基线
actualDurationMinutes?  # 已知区间之和；无计时证据为 null
remainingDurationMinutes?  # 显式剩余估时覆盖
categoryKey?

earliestStartAt?
deadlineAt?
deadlineLocalDate?
deadlineTimeZone?

splittable
minBlockMinutes?
maxBlockMinutes?

energyDemand?
schedulingPolicy

source
createdAt
updatedAt
completedAt?
canceledAt?
```

Phase 1 的 Application 创建边界在字段缺省时使用 `priority = "normal"`、`splittable = false`、`schedulingPolicy = "flexible"`。这是 [DEC-011](DECISIONS.md#dec-011) 生效前的实现基线，不是已接受的产品词表或调度策略：Domain/SQLite 当前只要求 priority 与 schedulingPolicy 为非空字符串；Scheduler 在决策关闭前不得据此推断优先级排序、固定/弹性含义或自动拆分授权。

### Task Status

```text
inbox
planned
in_progress
completed
canceled
```

### Constraint

- completedAt 仅在 `completed` 时存在；
- 预计/剩余 Duration 必须 > 0；派生实际耗时允许 0，未知为 null，不互相替代；
- deadlineAt 不得早于 earliestStartAt；
- parentTaskId 不得形成循环。

---

## 6. TaskDependency

```text
id
taskId
dependsOnTaskId
type
createdAt
```

候选设计，是否进入 V1 见 [DEC-006](DECISIONS.md#dec-006)。Phase 1 当前 Schema 按生效前默认行为没有该表，也没有对应 Repository / Service / Tool。决策关闭前不自动建表或暴露依赖操作；若纳入，必须补 migration、需求、无环约束、Scheduler 输入与验收。候选 type：

```text
finish_to_start
```

---

## 7. TimeBlock

TimeBlock 是 Scheduler 的核心计划单位。

```text
id
taskId?
type
startAt
endAt

status
source
locked

planRevision
externalCalendarEventId?  # 映射的便捷引用，完整归属由 CalendarBinding 保存

createdAt
updatedAt
```

### type

```text
task
break
relax
buffer
```

### status

```text
planned
started
completed
skipped
canceled
```

原则：

> Task ≠ TimeBlock

一个 Task 可以拆成多个 TimeBlock。

Phase 2 已实现 TimeBlock Domain、Drizzle Schema 与 SQLite Repository。`task` 类型必须有有效 `taskId`；其他类型可不关联 Task。区间遵守 `[startAt, endAt)` 且 end 严格晚于 start；`locked` 为布尔值，`source` 非空，`planRevision` 为非负安全整数。revision `0` 允许表示尚未由已提交 SchedulePlan 产生的既有/手工事实；Schedule Commit 写入的新版本使用正整数 revision。Preview 的 `stableKey / changeReason` 只属于候选 diff，不写入 TimeBlock 事实表。

---

## 8. SchedulePlan

用于 Preview / Commit / Conflict Control。

```text
id
planRevision
basedOnStateVersion
status
createdAt
committedAt
inputHash
schedulerVersion
policyVersion
timeZone
horizonStart
horizonEnd
reason
```

此实体只持久化已提交计划及必要审计元数据；当前唯一 status 是 `committed`，因此持久化记录的 `committedAt` 必须存在，`planRevision` 必须为正整数，且 horizon end 严格晚于 start。Preview 属于应用层短期内存对象，不创建业务持久化记录；App 重启后必须重新 Preview。

`planRevision` 是已提交计划的版本；`ScheduleState.stateVersion` 是所有排程输入的版本；算法/策略版本另存。它们不能共用含糊的 `planVersion`。自动变更的 Undo 需要保存实际 diff，保留期由 DEC-002 确认。

---

## 9. ExternalCalendarEventSnapshot

```text
id
provider
calendarId
externalEventId
occurrenceKey?
startAt
endAt
busy
lastSeenAt
contentHash
```

原则：

- 只缓存调度必要信息；
- 不默认长期保存完整会议内容；
- 外部事件内容最小化。

Phase 3 已实现该实体、Drizzle Schema 与 SQLite Repository。身份为 `(provider, calendarId, externalEventId, occurrenceKey)`：`occurrenceKey = null` 的单实例与非空重复实例分别用 partial unique index 保证唯一，非空 occurrenceKey 不允许空白。区间遵守 `[startAt, endAt)`，查询只返回指定 provider/calendar 与有限范围内重叠的记录。`contentHash` 用于检测必要调度内容变化，不保存标题、描述、参会人或地点。

### CalendarRefreshCoverage

```text
id
provider
calendarId
rangeStart
rangeEnd
fetchedAt
completeness  # 当前只能是 complete
observedEventCount
```

Coverage 是“该 provider/calendar 的该范围在 fetchedAt 完整观测过”的持久化证明。`partial` 响应永不写 Coverage，也不能以缺少记录为由删除旧 Snapshot；只有 `complete` 刷新可在同一事务内 upsert 已见实例、删除范围内未见旧实例并写 Coverage。较旧的完整结果不能覆盖更晚完成的范围，较旧观测也不能删除更新的实例。只有排除 verified App-owned binding 后的有效 Busy 集合变化才递增 `ScheduleState.stateVersion`，单纯 fetchedAt 变化不制造 Preview 冲突。

---

## 10. ExecutionSession

```text
id
taskId
timeBlockId?

startedAt
endedAt?
pausedDurationSeconds  # 由区间派生，不单独作为恢复依据
activeIntervalStartedAt?
pausedAt?

status
completionType?
createdAt
updatedAt
```

status：

```text
running
paused
completed
abandoned
```

---

## 11. Achievement

```text
id
sourceCompletionRecordId
sourceTaskId  # V1 非空便捷引用，必须与 CompletionRecord.taskId 一致
sourceExecutionSessionId?  # 有计时来源才存在

title
summary?
evidenceType
occurredAt

userEdited
hidden

createdAt
updatedAt
```

原则：

- 必须可追溯真实来源；
- AI Summary 不得替代 Evidence；
- 删除 Task 时不得静默破坏 Achievement 审计关系。

---

## 12. DailyReflection

```text
id
localDate
timeZone
summary
winsJson
adjustmentSuggestion?
userNote?
generatedBy
createdAt
updatedAt
```

Phase 8 已实现该实体与 `0008`。同一 `(localDate, timeZone)` 最多一条 Reflection；日期归属必须携带 IANA 时区。`summary` 由指定日的 CompletionRecord 与 Task TimeBlock 事实离线重建，最多三个 Win 分别保存 completionRecordId、taskId、标题快照与完成时刻；刷新不得把未知耗时、未发生完成或用户备注改写成系统事实。`generatedBy = local_facts | model_validated`，当前生产服务只写 `local_facts`。用户备注允许为空值或不超过 4000 字的非空文本，刷新保持显式备注；Reflection 不改变 `stateVersion/planRevision`。

---

## 13. EnergyCheckIn

```text
id
localDate
timeZone
level
note?
createdAt
```

level：

```text
1..5
```

不表示医学状态。

Phase 8 已实现该实体与 `0008`。每次 Check-in 都是独立追加事实，同一日可有多条；查询按 `createdAt` 选择最新记录，SchedulingSnapshot 只读取捕获时刻之前的最新一条，不能使用未来记录。level 只表示用户当时的主观精力，note 为可选、不超过 4000 字的非空文本；记录时固定本地日期与时区并推进 `stateVersion`，但不会自行提交 SchedulePlan。用户关闭入口后不强制记录，也不删除历史事实。

---

## 14. RelaxSession

```text
id
type
plannedMinutes
actualSeconds?
startedAt
endedAt?
source
status
timingQuality
createdAt
```

type：

```text
breathing
pause
stretch
ambient
```

`source = relax_tab | today | focus`；`status = active | completed | abandoned`；`timingQuality = trusted | needs_review`。Phase 8 已实现该实体与 `0008`：plannedMinutes 为 1–60 的整数，active 时 `endedAt/actualSeconds` 必须为空，结束后两者必须同时存在且 actualSeconds 非负；同一数据库最多一条 active RelaxSession。完成与放弃是不同事实，都不生成 CompletionRecord。实际秒数由 Application 注入时钟计算；墙钟倒退时 end 钳制到 start、时长记 0 并标记 `needs_review`。

---

## 15. UserModelFeature

```text
id
featureKey
scopeKey?
numericValue
windowStart
windowEnd
sourceStateVersion
sampleCount
confidence
algorithmVersion
lastUpdatedAt
```

示例：

```text
estimate_bias + scope=document
completion_rate_hour + scope=hour_09
completion_rate_hour + scope=hour_22
mean_session_minutes
median_session_minutes
postpone_skip_frequency
split_block_completion_rate
```

Phase 7 已实现该实体与 `0007`。同一 `(algorithmVersion, featureKey, scopeKey)` 唯一；空 scope 在 SQLite 使用内部 sentinel 实现唯一性，但 Repository 对 Domain 始终还原为 `null`。窗口必须非空，numericValue 必须为有限安全数，sampleCount/sourceStateVersion 非负，confidence 位于 `[0,1]`。重建只原子替换同 algorithmVersion 的缓存，并尽量保留身份相同特征的稳定 ID；原始 Task/Completion/Execution/Block/Event 事实不被派生刷新改写。

不保存：

- 医疗诊断；
- 人格标签；
- 敏感心理推断。

---

## 16. UserPreference

```text
id
key
valueJson
updatedAt
```

包含：

- workingHours
- preferredFocusBlock
- focusMindfulTransitionEnabled
- notificationLeadTime
- autoReplan
- personalizationEnabled
- checkInEnabled
- relaxSuggestionsEnabled
- defaultCalendarPolicy

当前具体实现包含：

- `notification.leadMinutes.v1 = { leadMinutes: integer }`，范围 `0–1440` 分钟；缺失时由宿主显式保守默认 `0`，不在数据库中伪造一条用户选择；
- `focus.mindfulTransition.enabled.v1 = { enabled: boolean }`。缺失或无效值按 `true` 处理，用户可在 Settings 直接关闭；它只控制新建 ExecutionSession 首次进入 Focus 时的 10 秒展示，不新增 Session 状态、执行事实或 SQL migration，恢复已有 Session 与从 Relax 返回不会重复展示；
- `personalization.enabled.v1 = { enabled: boolean }`。缺失或无效值按 `false` 处理；DEC-007 关闭前 Mobile 不开放从 false 切换为 true，已有 true 值仍可被用户关闭。

这些设置只能由直接用户修改，不能由 Agent 扩大自治范围。有效的提醒提前量变化会与偏好写入、`ScheduleState.stateVersion` 推进及当前 planRevision 的安全 Notification Job 重排处于同一事务；不重置 processing、`reconciliation_required` 或带未解决 ExternalMutationIntent 的作业。重复 operationId 或值未变化不重复唤醒集成 worker。

---

## 17. AgentRun

只保存最小运行 Metadata：

```text
id
startedAt
endedAt?
status
trigger
modelProvider?
turnCount
errorCode?
```

聊天全文是否持久化属于独立隐私决策；V1 默认最小化保存。

当前 `0006` 已实现上述字段及 status/trigger/turnCount/lifecycle CHECK 与 `(status, startedAt)` 索引。`running` 不允许 endedAt/errorCode；`completed/max_turns/max_tool_calls` 必须有 endedAt 且无 errorCode；`aborted/failed` 必须有 endedAt 与脱敏 errorCode。Repository 只提供按 ID、running 列表、insert/update；不会把 Agent message、Tool 参数/结果或 Provider body 写入本表。

---

## 18. Calendar / Notification Bindings

### CalendarContainerBinding

```text
id
provider
calendarId
ownershipKey
ownershipVerified  # 必须为 true
status
verifiedAt
createdAt
updatedAt
```

CalendarContainerBinding 是 App 自有 Calendar 的本地权威映射。`(provider, ownershipKey)` 与 `(provider, calendarId)` 均唯一；不能按可编辑 title 猜测归属。CalendarBinding 的 `(provider, calendarId, ownershipKey)` 通过复合外键引用这一已验证容器。

### CalendarBinding

```text
id
timeBlockId
provider
calendarId
externalEventId
occurrenceKey?
ownershipKey
ownershipVerified  # 必须为 true
appliedContentHash
appliedStartAt
appliedEndAt
lastAppliedRevision
status
verifiedAt
createdAt
updatedAt
```

每个 TimeBlock 最多一个 CalendarBinding；外部单实例/重复实例采用与 Snapshot 相同的 nullable occurrence 唯一语义。只有 provider 回读同时确认稳定身份、内容/区间与 ownership 后才保存 `ownershipVerified = true`。Repository 的 upsert/delete 使用 `lastAppliedRevision` fence，旧作业不能覆盖或删除新映射；TimeBlock 上的 `externalCalendarEventId` 只是旧的便捷引用，不能替代完整归属证明。

### NotificationBinding

```text
id
timeBlockId
taskId?
osNotificationId
type
appliedContentHash
scheduledAt
desiredRevision
lastAppliedRevision
status
identityVerified  # 必须为 true
verifiedAt
createdAt
updatedAt
```

通知稳定身份是 `(timeBlockId, type)`，不包含 planRevision；同一 OS notification ID 也必须唯一。taskId 可空，以支持不对应 Task 的合法 TimeBlock。`desiredRevision >= lastAppliedRevision`，`synced` 时两者必须相等；Repository 同样用 revision fence 防止旧 worker 覆盖/删除新映射。

Binding status 统一为：

```text
synced
pending
permission_required
failed
disabled
reconciliation_required
conflict
```

Binding 只保存 readback verified 的外部身份。Calendar/Notification marker 是有界查找与核对线索，不是单独的归属权限来源。

### ExternalMutationIntent

```text
id
integrationJobId
desiredRevision
scopeKey
action
payloadJson
createdAt
updatedAt
```

ExternalMutationIntent 是跨 SQLite 与 OS 边界的 durable write-ahead 恢复事实。Worker 在每次 Calendar provisioning/event create/update/delete 或 Notification schedule/cancel **之前**，先用独立本地事务写入 intent；平台结果经稳定身份回读确认后，才在同一 SQLite checkpoint 事务内写入 verified/pending binding 并删除 intent。若进程在 OS 已变更、binding 尚未写入之间终止，未解决 intent 留存，后续 worker 必须先核对它，不能把较新 revision 的普通 pending 作业排在它前面盲目再次创建。

`integrationJobId` 与 `scopeKey` 分别唯一：每个 Job 最多一个未解决 intent，同一稳定外部目标跨 Job/revision 也最多一个未解决 intent。`scopeKey` 由 action family 与稳定身份派生；payload 使用 canonical JSON，只允许恢复所需的 provider/container/block/notification ID、ownership key、hash、UTC 范围与 revision，不保存 Calendar title/notes、Task title/description 或 Notification title/body。父 IntegrationJob 在 intent 未解决时受 `ON DELETE RESTRICT` 保护。Calendar provisioning 的创建结果若无法可靠回查，不自动删除或重试 intent；只有直接用户确认目标确实缺失后才能释放并重新排队。

---

## 19. Secret Handling

以下内容禁止进入普通业务表：

- API Key
- OAuth Refresh Token
- Provider Secret

必须进入：

```text
SecureStore / Keychain / Keystore
```

---

## 20. Index 建议

至少：

```text
Task(status, deadlineAt)
Task(projectId)
TimeBlock(startAt, endAt)
TimeBlock(taskId)
ExecutionSession(taskId, startedAt)
Achievement(occurredAt)
ExternalCalendarEventSnapshot(startAt, endAt)
ExternalCalendarEventSnapshot(provider, calendarId, lastSeenAt)
CalendarRefreshCoverage(provider, calendarId, fetchedAt)
CalendarContainerBinding(provider, calendarId)
CalendarBinding(status)
NotificationBinding(status, scheduledAt)
ExternalMutationIntent(desiredRevision, action)
UserModelFeature(featureKey, scopeKey)
```

---

## 21. Soft Delete / Archive

Goal / Project 可 Archive。

Task V1 使用 status + canceledAt，不默认软删除所有记录。完成/取消后的 reopen 与历史更正交互见 DEC-010；不得通过普通 update 绕过状态约束。

Achievement 默认不随 Task 删除级联丢失。

---

## 22. Migration Policy

- 所有 Schema 改变必须有 Migration；
- 禁止运行时自动 destructive reset 用户数据库；
- Migration 必须可测试；
- 破坏性变更必须提供迁移或显式版本升级策略；
- Migration 完成后再更新 app schema version。

`0000_phase1_foundation`、按顺序追加的 `0001_phase2_schedule_commit`、`0002_phase3_calendar_notifications`、`0003_phase3_external_mutation_intents`、`0004_phase4_user_preferences`、`0005_phase5_execution_achievements`、`0006_phase6_agent_runs`、`0007_phase7_user_model_features` 与 `0008_phase8_wellbeing` 都带固定 checksum 和有序历史记录；追加 migration 没有改写既有 SQL/checksum。`0002` 以 SQLite rebuild 方式升级 `integration_jobs`，旧 pending 行回填为可自动领取且 `notBefore = createdAt`，其他旧终态默认不自动重试；没有可靠 token/lease 的旧 processing 行转为 `reconciliation_required`，避免把中间态冒充可继续的有效 claim。`0003` 只追加 ExternalMutationIntent 表、唯一约束、JSON/action CHECK、FK 与查询索引；`0004` 只追加 UserPreference 表、唯一 key 与 JSON 有效性约束；`0005` 在保留既有 CompletionRecord 的前提下补充 Session 来源外键，并建立唯一活跃 Session、每 Session 唯一开放 Interval、每 CompletionRecord 唯一 Achievement 的数据库约束；`0006` 只追加最小 AgentRun metadata、生命周期约束与运行态查询索引；`0007` 只追加 UserModelFeature 派生缓存、算法/特征/scope 唯一性、数值/窗口/置信度约束与查询索引；`0008` 只追加 DailyReflection、EnergyCheckIn 与 RelaxSession 的事实表和约束。启动时拒绝被改写或非前缀的历史，每个待执行 migration 在独立 SQLite 事务内应用，失败不留下该 migration 的部分 DDL/DML 或历史记录。

Node SQLite 集成已覆盖 `0000 → 0001 → … → 0008` 升级、重复运行、checksum、late failure 回滚、Drizzle/SQL 列与约束/index/FK 对齐、nullable occurrence 唯一性、claim/lease/CAS fence、complete/partial refresh、UserPreference/Execution/Achievement/AgentRun/UserModelFeature/Wellbeing 持久化，以及 OS 调用后本地 checkpoint 失败时 intent 留存/回滚/恢复。早期未发布 Development Build 曾为 `0006` 写入全零占位 checksum；兼容桥只在其余历史完全匹配且真实 `agent_runs` 表与索引逐项等价于固定 `0006` SQL 时原子修复该标记，缺失索引、任意其他 checksum 或非前缀历史仍拒绝启动。iOS Simulator 已在不清库的真实旧开发库上验证修复后继续应用 `0007/0008`、SQLite integrity 为 `ok` 且已有 Task/Completion/Achievement 保留；Android 与两平台物理设备仍缺同等证据。

---

## 23. 时间语义

- `Instant` 是经过校验的 UTC 时刻；`LocalDate` 是 YYYY-MM-DD，不能作为 UTC 零点使用。反思、Check-in 与“今天”必须携带所属 IANA 时区。
- 时间块与 Busy 区间使用 `[startAt, endAt)`；相邻块可首尾相接，`endAt > startAt`。Scheduler 的 horizon 必须有限且显式传入。
- 工作窗口按本地日期与时区展开；跨午夜拆成明确区间。DST 不存在时刻拒绝静默归一化，重复时刻要求明确 offset/选择；外部事件按 Adapter 提供的已验证 Instant 处理。
- “周五前”若只表达日期，则保留日期与时区，在 Preview 明示截止日期解释；用户确认后才按该本地日结束边界换算为下一本地日零点的排他上界，不假造用户指定的精确时刻。
- 缺少估时的 Task 可以保存；排程返回 `missing_duration`。默认剩余估时为预计时长减去有证据的实际耗时，显式剩余估时优先；耗时消耗完预计值但 Task 未完成时返回 `remaining_estimate_required`，不能自动完成 Task。
- 执行新增的有效工作区间会扣减显式剩余估时；达到零但未完成时清除该估时并要求重新估计。暂停时间不扣减。分钟/秒换算在边界显式完成，排程粒度由版本化策略统一规定。
- 调度时区变化使旧 Preview 失效；历史日记仍归属原记录时区的 localDate。旅行后的未来计划经新 Preview 处理。
- 区间恢复不依赖 UI tick。设备时钟倒退/跳变时标记计时待核对，不产生负耗时或把未知区间伪装为精确投入。

当前 Clock Port 会拒绝非规范 UTC Instant，Schedule Preview/Commit 也会按实际时钟拒绝已过期候选或将落入过去的新块。Execution 关闭区间时若观察到结束早于开始，会把事实结束时刻钳制到开始并标记 `timingQuality = needs_review`，该区间不计入可信投入；不会生成负数或虚假精确耗时。其他 `occurredAt / createdAt / committedAt / updatedAt` 的全局单调化仍未定义，不能把 Execution 的局部保护外推为完整墙钟回拨策略。

<a id="state-transitions"></a>
## 24. 状态迁移与实体联动

所有状态变化经过 Application Service；`task.update` 不直接 patch status、completedAt 或 actualDuration。

| 实体 / 当前状态 | 动作 | 结果与约束 |
| --- | --- | --- |
| Task inbox | 提交至少一个有效未来块 | planned；没有时长或没有可用块时仍可留在 inbox |
| Task planned / inbox | start | in_progress；创建 Session，若关联 TimeBlock 则该块变为 started |
| Task in_progress | 暂停或结束本次专注 | Task 保持未完成；in_progress 表示已有执行记录，不代表一定有活跃 Session |
| Task 非终态 | 明确完成整个任务 | completed；事务内保存 CompletionRecord，该任务活跃 Session/关联块 completed，取消尚未开始的未来块并安排集成清理 |
| Task 非终态 | 明确取消任务 | canceled；活跃 Session abandoned，其关联块与未开始块 canceled；不产生完成证据 |
| Task completed / canceled | 普通 update 或重复终态动作 | 不隐式重新打开；相同幂等动作返回既有结果，其他非法迁移拒绝 |
| TimeBlock planned | start | started；一个 Task 可有多个计划块，同一时间最多一个活跃 Session |
| TimeBlock started | 结束本次专注 | completed 表示此次计划投入结束，Task 可仍未完成；部分投入保留实际数据并重新估计剩余计划 |
| TimeBlock started | abandon 本次执行 | skipped；保留已投入区间与显式中止原因，Task 仍未完成；不保留永远 started 的块 |
| TimeBlock planned | 用户明确跳过 | skipped，记录用户动作；不等于取消 Task |
| TimeBlock planned | 取消/任务完成清理 | canceled；不生成虚假执行区间 |
| Session running | pause | 关闭有效工作区间，记录 pausedAt；状态 paused |
| Session paused | resume | 结束暂停区间，开启工作区间；状态 running |
| Session running / paused | finish_session | completed，记录区间；不隐式完成 Task |
| Session running / paused | complete_task | completed，并执行同一 Task 完成事务 |
| Session running / paused | abandon | abandoned；保留真实已投入区间，不生成任务完成事件 |

补充约束：

- 受保护规则限制 Replan；用户明确完成/取消整个 Task 时，仍按上述事务结束关联块并清理该任务未来计划，界面需展示其影响。
- 同时最多一个 running 或 paused Session。用户启动另一任务前先明确结束/放弃当前 Session，不能静默覆盖。
- 已过计划结束时间不代表 completed 或 skipped；未观测到执行时只产生“待处理计划”提示与 Preview，不能虚构未做或已完成事实。
- 已完成、正在执行、锁定的块不由 Replan 移动；用户拖动/缩放后的块默认锁定。历史块不为了满足新排程而改写时间。
- Session running 重启后从持久化区间恢复逻辑运行状态；它表示计时区间，不证明持续注意力。paused 状态重启后保持 paused，不把关闭 App 的时间算为工作。
- 拆分 Task 的某个块结束后，Scheduler 仅安排剩余工作量；用户必须通过“完成整个任务”确认任务成果。

### 示例：4 小时报告拆成四块

第一个 1 小时块结束 → Session completed、该 Block completed、Task in_progress；在没有估时修正且实际投入可信时还剩约 3 小时。不会提前生成“报告已完成”的 Achievement。

用户提前完成报告 → 明确 complete_task → Task completed，未开始的剩余块 canceled；Achievement 使用该 Task 的 CompletionRecord。没有计时而直接完成也有效，但实际投入显示未知。

## 25. ExecutionInterval / CompletionRecord / TaskActivityEvent

### ExecutionInterval

设计字段：`id, sessionId, kind(work|pause), startAt, endAt?, timingQuality`。与 Session 状态在同一事务更新；每个 Session 至多一个未关闭区间。耗时由有效 work 区间求和，累计暂停值只是派生缓存。

当前可信投入统计以已关闭且 `timingQuality = trusted` 的 work 区间为来源：每个区间先取向下舍入的整秒，再汇总；pause、未关闭和待核对区间不计入可信投入。原始 start/end 时间戳保留精度，不为展示或聚合回写。CompletionRecord 的实际秒数与 Task 的实际分钟投影须使用同一口径，不能将逐区间整秒汇总替换成毫秒小数之和。

### CompletionRecord

设计字段：`id, taskId, sourceSessionId?, operationId, completedAt, taskTitleSnapshot, actualDurationSeconds?, durationCoverage(complete|partial|unknown), achievementDisposition(record|skip), source(user|agent_authorized)`。

- 完成事实与表达分离；AI 不决定事实字段，不把预计时长当作实际时长。
- 首次提交计划或首次开始时冻结已知 baselineEstimatedDurationMinutes，后续改估时不覆盖；基线缺失则不参与该类偏差统计。
- 无计时、存在未记录投入或计时待核对时，不声称总耗时完整。可展示“已记录投入”，用户模型只接收符合其口径的数据。仅有计时记录不能证明覆盖完整；complete 覆盖标记需要直接用户在完成时明确确认 `allEffortRecorded = true`，可包含明确的零投入；否则有可信区间时为 partial、无可信投入时为 unknown。该确认可选，不阻塞完成操作，Agent/模型无权代替用户声明。
- 当前 V1 不开放未定义的重开流程；每个 Task 至多一个有效 CompletionRecord。创建完成证据与更新 Task 为同一事务。
- Achievement 必须外键引用 CompletionRecord；`sourceCompletionRecordId` 唯一。用户选择不记录时仍保留业务完成事实，但不生成 Achievement；隐藏已有成就不删除证据。
- Task 不做破坏证据关系的硬删除。未来历史更正须更新规则、迁移和审计策略，见 DEC-010。

### TaskActivityEvent

设计字段：`id, taskId, timeBlockId?, eventType, actor, occurredAt, localDate, timeZone, operationId, beforeSummary?, afterSummary?`。

事件类型至少区分用户 postpone/skip、系统 replan、start、finish_session、complete_task、cancel。记录统计必需的最小结构化事实，不保存全量聊天或任意敏感 Payload。用户推迟不与系统挪动混算；没有观测不能生成用户跳过事件。

<a id="user-model-semantics"></a>
## 26. User Model 统计口径

| Feature | 样本与计算口径 | 不纳入的情况 |
| --- | --- | --- |
| 分类估时偏差 | 有初始估时快照、明确分类且耗时覆盖完整的已完成 Task；比较实际与原始估时 | 未分类、未计时、部分覆盖、估时快照缺失 |
| 时段执行完成率 | 观察窗口内已结束且可判定结果的任务型 Block，按计划开始时所属时区/小时分组；completed / (completed + 明确 skipped) | break/relax/buffer、取消、系统替换块、未知/仍待处理结果；不等同整项 Task 完成率 |
| Session 长度 | 已关闭、计时有效的 Session 的 work 区间总秒数；明确记录均值或中位数对应的 featureKey | 活跃、计时待核对的 Session |
| 推迟/跳过频率 | 版本化窗口内显式用户 postpone/skip 次数，同时记录可判定 Block 数作为归一化分母 | 系统 Replan、没有观测的漏开始 |
| 拆分块完成情况 | 按 Task 关联的已闭合 Block 结果统计，并保留样本数 | 未闭合/未知结果不能推断为失败 |

Phase 7 的纯 builder 已实现上述五类统计，并要求调用方显式提供 observation window、`algorithmVersion`、估时偏差使用 mean/median 的选择，以及每个 feature family 达到满置信度所需的正整数样本数；`confidence = min(1, sampleCount / fullSampleCount)`。构建结果同时返回每类排除计数并稳定排序。分类估时偏差按 Task category scope；时段按 `hour_00..hour_23` scope；均值与中位 Session 长度分别使用独立 featureKey。系统 replan 不计作用户 postpone/skip，未闭合/取消/未知结果不被推断为失败。

生产统计窗口、分类词表、满置信样本阈值、启用阈值和 Scheduler 权重仍见 DEC-007。`confidence` 是版本化统计规则的输出，不是 LLM 自评分。所有特征可由最小事实重建；更换 algorithmVersion 后重算，不混用旧口径缓存。用户关闭个性化后不再将特征用于调度，不影响本地 Task/Execution 能力；DEC-007 接受前 production policy 即使读到缓存也保持中性。

## 27. 提交与集成恢复记录

| 实体 | 最小设计字段 / 不变量 |
| --- | --- |
| ScheduleState | 单一当前 `stateVersion` 与 `planRevision`；Task、Block、执行、日历快照、调度偏好/特征、时区等有效输入变化递增 stateVersion |
| OperationRecord | operationId、命令名、参数摘要哈希、完整 mutation result DTO snapshot、base/current version、发生时间、必要 diff；同 ID 同输入返回首次提交结果，不同输入拒绝 |
| IntegrationJob | id、operationId、target(channel/entity)、desiredRevision、desiredAction、status、attemptCount、lastErrorCode、automaticRetryEligible、claimToken、leaseExpiresAt、notBefore；与本地变更同事务写入 |
| ExternalMutationIntent | integrationJobId、desiredRevision、稳定 scopeKey、action、最小 canonical payload、时间戳；OS 副作用前独立落盘，verified checkpoint 后与 binding 同事务删除 |
| CalendarBinding | 本地 Block ID、verified container authority、provider/calendar/event/occurrence 标识、applied hash/range、lastAppliedRevision、同步状态；用于归属校验、去重和回读 |
| NotificationBinding | 必填 Block ID、可选 Task ID、稳定 type/OS ID、applied hash/schedule、desiredRevision、lastAppliedRevision、同步状态与 verified identity；旧版本作业不得覆盖新映射 |

Phase 2 已持久化 ScheduleState、SchedulePlan、TimeBlock、OperationRecord 与 IntegrationJob 的本地提交组合：每次成功提交生成一个 committed plan，将获得首个有效计划的 inbox Task 标为 planned 并冻结已知首次估时基线，同时为 `calendar`、`notification` 各写一个 pending `reconcile` 作业。Task before/after 与 Block diff 一起保存在恢复记录中，任一晚期写入失败时全部回滚。

Phase 3 已实现 Snapshot/Coverage、verified Calendar container/event 与 Notification binding、ExternalMutationIntent、IntegrationJob worker 状态机及 Repository。每通道原子 claim 将状态改为 processing、attemptCount 加一并写入唯一 token 与未来 lease；同通道未过期 claim 阻止并发领取，过期 lease 可由新 generation 重领，旧 token/attempt 的 `updateClaimed` CAS 被拒绝。可运行候选优先领取带未解决 intent 的 Job，再处理过期 processing 与普通 revision 队列，保证崩溃后的外部核对不会被较新 pending Job 饥饿。`notBefore` 限制退避时刻；`automaticRetryEligible` 明确区分可由 reconciliation 安全收敛的未知结果与需要用户可见核对的状态。`permission_required` 只在显式前台授权成功后重新排为 pending；不会重排 succeeded、superseded、processing 或 disabled。

Worker 在外部调用前后检查 desiredRevision；旧计划作业标为 superseded，未知外部结果即使版本已变也保留 reconciliation_required。Notification worker 还在领取事务中读取经过 Schema 校验的提醒提前量和 stateVersion；若 Provider 调用期间本地输入变化，已核验的 binding/intent 结果仍先安全 checkpoint，再将准确 claim 释放为 pending 进行下一轮收敛。外部 API 调用不位于 SQLite 事务内；每次有副作用的调用前先提交 ExternalMutationIntent，完成阶段再以 claim/revision fence checkpoint verified binding 并删除 intent，最终 Job 状态另以 claim CAS 落盘。启动/领取时还会先扫描通道内最旧 intent，通过单项 reconcile 或 owned-marker inventory 恢复缺失 binding；`partial`/`unknown` inventory 不能推断外部对象不存在。作业状态变化不反向改写已经成立的本地计划。该本地协议、Node SQLite 故障注入和 injected native facade 已有测试，真实 Expo/OS 进程终止、权限和回读行为仍须设备验收。

`stateVersion` 与 `planRevision` 的变化规则、事务和恢复流程以 [Contracts](05-API.md#commit-contract) 为准。当前实现不保存 mutation 参数原文，只保存稳定 SHA-256 摘要；为在实体后来变化后仍能精确重放首次提交响应，`resultJson` 会保存完整返回 DTO，必要 `diffJson` 还会保存计划变更前后快照。它们可能包含 Task/Goal/Project 标题、描述、完成事实或计划事实，属于本地业务 SQLite 中的敏感业务数据，不是日志、LLM Context 或无关 Tool Result 的数据源；保留/清理必须同时维护幂等与证据约束，并遵守 [Security](09-SECURITY.md#6-llm-data-exposure) 和 DEC-009。除这些明确的结果/恢复快照外，OperationRecord 不成为保存用户原始输入、聊天、日历描述或模型响应的旁路。Undo 超期或事实变化时返回明确不可撤销/需新 Preview，不恢复历史执行事实。
