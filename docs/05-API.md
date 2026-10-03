# 05 — Contracts / API

## 1. 定位与设计状态

V1 是本地移动端 App，不以 HTTP API 为核心。本文维护 Package / Application Service / Tool / Adapter 的行为契约。

Phase 1 已将 Task / Goal / Project 用例、Application Ports、Runtime Schema、幂等结果与 SQLite Repository 落实为代码；Phase 2 已实现 pure Scheduler Core、Application Preview/Commit、内存 Preview Store，以及 SchedulePlan/TimeBlock/IntegrationJob 的本地 SQLite 事务。Phase 3–8 已继续实现 Calendar/Notification、移动端规划与执行、Agent/User Model 技术边界，以及 Reflection/EnergyCheckIn/Relax 的本地事务与 UI 入口。

生产 SchedulingSnapshot/ScheduleService、权限/刷新 UI、Execution、Achievement、受控 Agent 边界与 Phase 8 本地可持续节奏能力已经实现。Calendar/Notification 仍无真实 OS/物理设备权限、账户/source、回读、投递和进程恢复验证，Agent 仍无真实 Provider/生产凭据，不能按代码或文档存在推断为全部设备可用。Mobile Runtime 会打开并迁移 SQLite、构造真实 Adapter/Application Service，并在 AppState active 时按通道消费 durable Job；它不自动请求权限、不构成后台 daemon，亦不替代真机验收。投影/提醒产品策略保持注入并受 [DEC-012](DECISIONS.md#dec-012) 约束。未定义的业务规则不得用 `any`、测试 policy 或临时字段绕过。含糊的 `planVersion` 已拆为输入版本、已提交版本与预览标识；依据见 [ADR-0009](ADR/0009-application-commit-and-recovery.md)，实际进度与验证证据见 [STATUS](../.ai/STATUS.md)。

## 2. Contract Ownership

| 层 | 负责 | 不允许 |
| --- | --- | --- |
| domain | 实体、不变量、状态迁移、值对象 | Expo、DB 实现、Provider SDK |
| scheduler-core | 显式输入到确定性排程结果 | 时钟读取、ID 随机生成、持久化、Adapter 调用 |
| application | 用例、Repository/UnitOfWork/Clock/Device Ports、校验、授权、事务、幂等 | import 平台 Adapter 实现 |
| agent-core | 通用 Tool/Model 运行契约、循环、流、中止 | 依赖业务 DB、UI 或 Node API |
| agent-tools | 参数映射、受限用例调用 | 任意 DB Handle、自行实现第二套业务规则 |
| infrastructure | 实现 Ports，映射平台错误 | 将底层异常或敏感原始数据直接暴露给 UI/Agent |
| apps/mobile | Composition Root、交互与设备生命周期 | 在 Screen 中实现排程、完成证据或事务规则 |

所有外部输入进行 Runtime Validation。`Instant`、`LocalDate`、时区和区间遵守 [时间语义](04-DATA-MODEL.md#23-时间语义)。

当前机器边界包括 Zod strict object 输入/结果、Repository / UnitOfWork / Clock / LocalTimeProvider / IdGenerator / SchedulingSnapshot / PreviewExpiration / Calendar / Notification Ports，以及 Task、Goal、Project、Schedule、Calendar、Integration、Execution、Achievement、AgentRun、UserModel、Reflection、EnergyCheckIn 与 Relax Application Service。`expo-sqlite`、`expo-calendar`、`expo-notifications` 只在 Infrastructure Adapter 实现 Application Port；Domain/Application/Scheduler Core 不 import Expo。所有 Provider 返回在 Application 边界先按严格 Schema 解析，底层 `unknown` 或平台对象不进入 Domain。

Mobile Composition 已组合当前服务并保持 Screen 不直接访问数据库。Node SQLite、Fake Provider、注入 native facade 与 Hermes bundle 分别验证事务或代码边界，但不等同于真实 Provider、OS 行为或物理设备能力完成。

## 3. Scheduler Core

```ts
type ScheduleInput = {
  now: Instant;
  horizon: { start: Instant; end: Instant };
  timeZone: TimeZoneId;
  tasks: SchedulableTask[];
  busyEvents: BusyEvent[];
  existingBlocks: ExistingTimeBlock[];
  preferences: SchedulingPreferences;
  userModel: SchedulingUserFeatures;
  policy: SchedulingPolicy; // 含 policyVersion、粒度与稳定决胜规则
  reason: ScheduleReason;
};

type ScheduleResult = {
  schedulerVersion: string;
  blocks: ProposedTimeBlock[]; // 稳定候选 key；不生成持久化随机 ID
  unscheduled: UnscheduledTask[];
  warnings: ScheduleWarning[];
  metrics: ScheduleMetrics;
  explanations: ScheduleExplanation[];
};

declare function previewSchedule(input: ScheduleInput): ScheduleResult;
declare function replanSchedule(input: ScheduleInput): ScheduleResult;
```

- `SchedulableTask` 显式包含已验证的剩余时长、Earliest Start、Deadline、拆分和能量约束；缺时长返回可解释原因，不能编造。
- `ProposedTimeBlock` 包含 stableKey、既有 blockId（若有）、taskId/type、start/end、locked 和变更原因。既有 started/completed/locked 块作为保留输入处理。Application 生成 `PlanChange` 时额外附上同一 Snapshot 中的 `taskTitle`，仅供用户核对，不能成为 Commit authority。
- `UnscheduledTask` 包含 taskId、未排入剩余分钟（未知时可缺省）、reasonCode；至少区分 missing_duration、remaining_estimate_required、insufficient_time、deadline_infeasible、unsupported_dependency。
- `ScheduleWarning` 指明实体、code、严重程度与用户可理解的原因；已有受保护块冲突与新方案不合法要区分。
- Task 的剩余工作量不能重复分配：先扣除受保护未来块已承诺的剩余投入，再分配新块；正在执行块只计算 now 之后仍承诺的部分，不把已记录投入再次排入。超额或矛盾的保留计划显式报告，不能静默改写受保护块。
- 重排最小扰动相对于 existingBlocks 计算。同一完整输入与算法版本必须稳定；集合排序与平分决胜不能依赖遍历偶然顺序。
- Core 不生成业务版本、不持久化 Preview、不 Commit。输入合法性与硬约束不满足不能被软评分抵消。

Phase 2 的 `scheduler-core` 已按上述边界实现 `previewSchedule / replanSchedule`、严格运行时输入校验、确定性排序、硬约束、拆分、显式软评分、warnings/unscheduled/metrics/explanations，并以随机不变量样本验证同输入稳定性。Core 只使用调用方显式提供的 `priorityRanks` 和版本化权重；`schedulingPolicy` 仍是不透明非空 key，`splittable` 只作为输入布尔约束。生产词表、默认值和 policy 映射仍受 [DEC-011](DECISIONS.md#dec-011) 约束。TaskDependency 未实现；当前边界只会显式报告 `unsupported_dependency`，见 [DEC-006](DECISIONS.md#dec-006)。

## 4. Application Preview

```ts
type SchedulePreviewRequest = {
  reason: ScheduleReason;
  taskIds?: string[];
  timeRange?: { start: Instant; end: Instant };
};

type SchedulePreview = {
  previewId: string;
  basedOnStateVersion: number;
  basedOnPlanRevision: number;
  inputHash: string;
  schedulerVersion: string;
  policyVersion: string;
  createdAt: Instant;
  expiresAt: Instant;
  timeZone: TimeZoneId;
  changedBlocks: PlanChange[];
  // Application review projection adds taskTitle to each relevant item.
  unscheduled: (UnscheduledTask & { taskTitle: string })[];
  warnings: (ScheduleWarning & { entityTitle: string | null })[];
  summary: string;
  riskAssessment: RiskAssessment;
};
```

Application 从同一一致性读快照读取 Task、Block、执行、已缓存 Busy、偏好、特征与捕获时刻之前最新的 EnergyCheckIn，注入 now、有限 horizon、时区和策略后调用 Core。`taskIds` 是关注范围，不允许忽略范围内其他 Busy/受保护块。Phase 7 后快照会把 `personalizationEnabled` 与 UserModelFeature 缓存一起交给 SchedulingInputPolicyPort；policy 必须自行验证算法版本、新鲜度、样本和置信度，不能因为表中存在数值就默认采用。Phase 8 的 Check-in 也只是一条可选软信号；当前 Mobile 中性 policy 在正式生产映射未接受前忽略它，不把低精力变成强制取消或自动提交。

Preview 不写数据库，不触发日历或通知同步；其完整候选结果只在应用内存保存，并绑定输入哈希与版本。当前 InMemory Store 对写入和读取都作隔离深拷贝并冻结受信对象，Commit 会从 Store 重新校验 snapshot/result/diff，调用方篡改返回的 JavaScript 对象不能替换待提交内容。Application 的 review projection 从同一 SchedulingSnapshot 附加 Task 标题：变更块使用 `taskTitle`，未排程项使用必填 `taskTitle`，warning 使用可空 `entityTitle`；这些字段仅用于解释，不能代替 taskId/timeBlockId、版本或受信 diff。`summary` 的语言润色不能改变事实或候选 diff。日历刷新是独立的受限应用用例，应在读取预览快照前完成；无法刷新时明确显示数据新鲜度。

多个 Preview 可短期存在。App 重启后 previewId 失效；返回 `preview_not_found`，重新生成。Preview TTL 由显式 Port 注入，并被最早变更块开始和 horizon end 收紧；开始时间已经到达或将写入过去时不得提交。不能只拿 Agent 提供的 changedBlocks 作为可信提交内容。生产端已通过 `SqliteSchedulingSnapshotPort` 在同一 UnitOfWork 事务中读取 SQLite Task/TimeBlock/Busy cache/偏好/UserModelFeature 与版本，并通过注入的工作窗口、horizon 和版本化 policy 组装快照；缺少必需设置时返回 `scheduling_setup_required`，不会使用隐藏默认。DEC-007 关闭前 Mobile policy 明确忽略缓存特征并保持 completion-rate 权重为零；真实设备 SQLite/Calendar 数据仍需单独验收，测试 Fake/Node SQLite 不能冒充该证据。

<a id="commit-contract"></a>
## 5. Commit / Version / Recovery

```ts
type ScheduleCommitRequest = {
  previewId: string;
  expectedStateVersion: number;
  operationId: string;
};

type IntegrationStatus =
  | "synced"
  | "pending"
  | "permission_required"
  | "failed"
  | "disabled"
  | "reconciliation_required"
  | "superseded";

type ScheduleCommitResult = {
  operationId: string;
  local: "committed";
  planRevision: number;
  stateVersion: number;
  calendar: IntegrationStatus;
  notifications: IntegrationStatus;
};
```

### 5.1 三类标识

- `stateVersion`：排程输入的并发令牌。Task 的调度字段、Block/Execution 状态、Busy 快照内容、有效偏好/用户特征/调度时区改变时，在同一事务递增。仅同步尝试次数变化不递增。
- `planRevision`：已持久化计划的版本。TimeBlock 集合、时间、锁定或状态变化时递增，包括完成任务取消未来块。Core 不分配它。
- `previewId`：一次内存候选方案的引用；`schedulerVersion / policyVersion` 是算法与策略版本。标识不可混用。

### 5.2 提交顺序

1. 首先查 operationId：同一命令与相同参数摘要的已提交操作返回原提交结果（附当前集成状态），即使 Preview 已失效；同 ID 不同参数返回 `idempotency_conflict`。
2. 查找应用保存的 Preview，验证 expectedStateVersion 与其 basedOnStateVersion 一致。当前实现只接受宿主注入的直接用户 authority；自动策略尚未启用。未来即使启用已配置策略，也不能用模型声称“用户同意了”代替授权。
3. 重新检查实际时钟、时区、策略版本和候选有效性。expiresAt 必须有限，不能晚于候选中最早需要调整的未来开始时间或 horizon 结束；已过期/新块将落入过去/有新输入时返回 `preview_expired` 或 `plan_conflict`，不静默换一份计划提交。
4. 在 SQLite 事务内比较当前 stateVersion，写 Block、SchedulePlan、必要的 Task `inbox → planned` 与首次估时基线、新版本、OperationRecord 和 Calendar/Notification IntegrationJob。Task 变更前后随计划 diff 保存；并发或任一晚期写入失败回滚整个本地事务。
5. 事务成功后才可发送 best-effort worker wake signal；外部同步不持有 SQLite 事务。Mobile Runtime 已把 ScheduleService、TimeBlockAdjustmentService 与 IntegrationService 接到仅前台 active 的按通道 drain 协调器；权限 UI 已组合，但真实 OS 生命周期尚未验收，不能把该组合或 fake worker 测试描述为端到端设备同步。

重新生成 Preview 是独立用户可审查动作，旧确认不自动适用于更大的新 diff。未来外部日历变更不可能被本地版本锁永久阻止；应用在观测到新快照后生成新的冲突提示/Preview。

手工 TimeBlock 拖动/缩放采用同一提交原则：`TimeBlockAdjustmentService.preview` 从一致性 SchedulingSnapshot 读取原块、工作窗口、Busy、Task 约束、时钟与版本，校验候选位于显式 grid 且只允许未来未锁定 planned 块；Preview 不写库并携带 Busy freshness。`commit` 只接受直接用户确认和受信 previewId，以 stateVersion/planRevision/原块快照作 fence，在单个事务中写新的 committed SchedulePlan、锁定后的 TimeBlock、OperationRecord、双通道 IntegrationJob 与两类新版本。`unlock` 是另一项直接用户操作，只改变未来 planned 块的 locked 状态，并以相同事务建立新计划版本；UI 或 Agent 不得直接更新表。

### 5.3 失败与重试

| 失败位置 | 本地结果 | 恢复 |
| --- | --- | --- |
| Preview 失效、授权/Schema 错误、版本冲突 | 未提交 | 原计划保留；修正输入或重新 Preview |
| SQLite 事务失败 | 完整回滚 | 按错误类别重试同 operationId，不留下半个计划 |
| DB 已提交、Calendar/Notification 失败 | local=committed，通道 pending/permission_required/failed | 持久化作业继续；不向用户谎称原计划未变，不自动回滚业务事实 |
| 已提交但响应丢失 | 结果不确定 | 调用方保留并复用 operationId；查询原结果，不再次生成新写操作 |
| OS 已创建但映射写入前崩溃 | durable intent 已提交、外部结果未知 | 下一次先按稳定 scope/marker/平台 ID 回读；verified checkpoint 写 binding 并删除 intent，无法判断时保留待核对状态，不盲目再创建 |

Calendar 与 Notification 作业独立恢复。按实体/通道串行处理，检查 desiredRevision，并在异步操作完成后再次核对当前目标；过时作业跳过或产生面向最新目标的修复，不将旧结果登记为新计划已同步。

Phase 3 的持久化 claim 协议为：同一通道在事务内领取一个满足 `notBefore` 的 pending，或显式允许自动恢复的 failed/reconciliation_required，或 lease 已过期的 processing 作业；领取时 `attemptCount + 1` 并写入新的 `claimToken / leaseExpiresAt`。未过期 processing 阻止同通道并发；完成以 token + attempt generation 作 CAS，过期 worker 不能覆盖新 worker。可运行候选先选带未解决 ExternalMutationIntent 的 Job，再选过期 processing，最后按目标 revision 处理普通队列；worker 还会在新工作前扫描该通道最旧 intent，避免旧 OS 副作用被新版 pending Job 饥饿。

每个有副作用的 Provider 调用采用 write-ahead 协议：先在独立 SQLite 事务验证 claim/revision 并插入 ExternalMutationIntent，再调用 OS；回读确认后，在一个 checkpoint 事务内按 claim fence 写入 verified/pending binding 并删除 intent。Job 的最终状态随后以 token/attempt CAS 收口；即使在两个事务之间再次崩溃，binding/intent checkpoint 或过期 claim 都能被后续 worker 收敛。`integrationJobId` 和稳定 `scopeKey` 双重唯一阻止同一 Job 或同一外部目标跨 revision 出现两个未解决副作用。intent payload 是经过 Domain/Repository 校验的最小 canonical JSON，只含 ID、hash、revision 和 UTC 范围，不含 Calendar/Task/Notification 展示文本。

不是所有失败都自动重试。只有 Application 明确判定可通过稳定身份 reconciliation 安全收敛的未知 create/update/delete/schedule/cancel 结果才设置 `automaticRetryEligible` 并由 retry policy 给出未来 `notBefore`；容器归属未知、重复/用户编辑冲突、无可靠核对路径等保持用户可见的 `reconciliation_required` 且不自动重试。`permission_required` 仅在显式前台权限请求成功后重新排队；Mobile user-action host 在返回 granted 后还要 best-effort 唤醒当前前台协调器，不能要求用户先切后台再回来。唤醒不是事实源，失败时不得把已经授予的权限或已经提交的 requeue 报成回滚；durable Job 留待下次前台事件恢复。background refresh/worker 只读权限状态，绝不触发系统权限弹框。

所有 Calendar/Notification Provider Promise 必须由 Composition Root 设置正整数毫秒上限；当前 Mobile 值为 15 秒。Application 区分 `*_read_timeout` 与 `*_mutation_timeout`：前者以 `provider_timeout` 收口为可延迟重试的 failed Job；后者不能证明外部写入未发生，必须沿 ExternalMutationIntent/reconciliation 路径保持不确定状态。包装器只停止等待，不宣称能取消 OS 调用；迟到结果不得直接提交本地映射。

Phase 1 已落实通用 operationId 基础；Phase 2 Schedule Commit 复用同一协议：命令和严格校验后的参数生成稳定 SHA-256 摘要，参数 DTO 本身不写入 OperationRecord；`resultJson` 保存首次提交的完整 mutation DTO snapshot，必要 `diffJson` 保存计划变更前后快照。提交响应丢失且内存 Preview 已清除时，同 operationId/同参数会先读取本地 OperationRecord，精确恢复首次结果并聚合当前两个 Job 状态；不同参数返回 `idempotency_conflict`，不会生成第二份计划。结果/diff snapshot 可能包含标题、描述、完成事实或计划事实，只能作为本地幂等恢复数据使用，不默认送入日志、LLM Context 或无关 Tool；保留边界见 [Security](09-SECURITY.md#6-llm-data-exposure)。Phase 3 已落实 worker、write-ahead intent、marker inventory、回读核对与 reconciliation 的平台无关应用协议及 Expo Adapter/Mobile 前台组合代码；真实 OS 验证仍是独立未完成边界。

适配器必须在对应平台验证回读与归属能力。若平台不能可靠判断未知创建结果，明确返回 reconciliation_required，交由可见恢复流程处理，不承诺跨 SQLite 与 OS 的 exactly-once 事务。

### 5.4 Undo

`undoSchedule(operationId, expectedStateVersion)` 通过应用服务读取已记录的 diff，验证当前版本、时间、Busy 和块状态，再创建新的反向计划操作；它不是恢复旧数据库快照。不能删除真实 Execution/Completion。冲突时返回新 Preview，保留期之外返回 `undo_unavailable`。自动提交启用条件见 [DEC-002](DECISIONS.md#dec-002)。

## 6. Task / Execution / Achievement Services

```ts
type WriteContext = {
  operationId: string;
  authority: ApplicationAuthority; // 宿主注入，模型不能设置
};

type FinishExecutionInput = {
  sessionId: string;
  outcome: "finish_session" | "complete_task";
  recordAchievement?: boolean; // complete_task 时生效；遵守用户偏好
  allEffortRecorded?: boolean; // complete_task 时可由直接用户确认完整计时覆盖
};
```

Phase 1 的 `TaskService.create` 在调用方省略字段时暂用 `priority = "normal"`、`splittable = false` 与 `schedulingPolicy = "flexible"`。这些是 [DEC-011](DECISIONS.md#dec-011) 关闭前的兼容默认；Runtime Schema/Domain 当前只验证非空 priority / schedulingPolicy，不定义排序或调度效果。Phase 2 Core 不得在决定前自行解释这些字符串。

当前实现范围包括 Task create/get/update/complete/cancel、Goal/Project create/get/update/archive、Goal progress、Schedule Preview/Replan/Commit、Execution start/getActive/get/pause/resume/finish/abandon、Achievement create/get/list/details/update/hide，以及 Reflection get/refresh、EnergyCheckIn record/read、Relax start/end/read/list。手工或 Focus 完成都会在一个本地事务中更新 Task/Session/Interval/Block、唯一 CompletionRecord、用户允许的唯一 Achievement、TaskActivityEvent、OperationRecord、ScheduleState、必要 SchedulePlan 与 IntegrationJob；任何晚期写入失败都会回滚。没有 Execution 证据时耗时保持 unknown，计时待核对区间不被冒充为可信投入；只有直接用户明确传入 `allEffortRecorded=true` 才将可信已记录秒数（包括明确的零）标为 complete coverage，Agent authority 传入该字段会被拒绝。Schedule Commit 继续按既有规则创建/更新/取消未来可变 TimeBlock、冻结首次估时基线并写 durable IntegrationJob。

Task 编辑 Contract 保持 `estimatedDurationMinutes` 与显式 `remainingDurationMinutes` 独立：前者是总估时，后者是用户对剩余工作的覆盖值；`actualDurationMinutes` 只能由可信执行区间派生，UI/普通 patch 不得写入。清除显式剩余值后 Scheduler 按总估时减可信实际投入推导，估时已耗尽而任务未完成时返回 `remaining_estimate_required`。Task 修改后的重新排程使用 `ScheduleService.replan`，不能把修改后的既有计划误当首次 Preview。

- TaskService.create/update 校验普通字段；status、实际耗时、完成证据不能通过通用 patch 修改。
- Mobile 手工 Task 表单以设备 IANA 时区把成对的 `YYYY-MM-DD` / `HH:MM` 解析为 Instant；DST 不存在/重复时间、截止早于最早开始、非法块时长在调用 Service 前拒绝。只有日期的 Deadline 保存为 `deadlineLocalDate + deadlineTimeZone`，不会猜测时刻；当前手工 UI 要求补充精确时间后才直接进入 Schedule Preview。
- TaskService.list 使用最多 50 项的有界游标分页；Mobile 收件箱固定查询 `status = "inbox"`，不得为展示列表让 Screen 直接读表。
- GoalService.list 与 ProjectService.list 使用最多 50 项的稳定有界游标分页，默认排除 archived；Project 可按 goalId 过滤。Goal progress 继续由直接/项目关联 Task 事实汇总，列表/界面不能写入百分比。
- ExecutionService.start/pause/resume/finish/abandon 共用 [状态迁移](04-DATA-MODEL.md#state-transitions)，持久化区间与状态原子更新。同一时间最多一个 running/paused Session。
- Focus 的 Mindful Transition 是 Mobile 展示协议，不是 ExecutionService 状态迁移：只有 `start` 确实创建新 Session 的 Today/Task 路径才附带一次性导航信号；Focus 接收后立即清除该信号，并在 `focus.mindfulTransition.enabled.v1` 缺失/无效时按启用、显式为 false 时关闭。恢复已有 Session、直接重开 Focus 或从 Relax 返回不附带信号。10 秒倒计时和跳过动作不写 Session/Interval，也不改变已经开始的执行事实；偏好仍只通过直接用户 `PreferenceService.update` 持久化。
- TaskService.complete 是手工/Tool 任务完成入口；ExecutionService.finish 的 complete_task 分支在当前 Session 事务内执行同一完成规则，不开启嵌套事务。两条入口共用 CompletionRecord/Achievement 唯一性、可信区间聚合、未来块清理、版本与幂等约束；UI/Agent 不得绕过应用服务直接写事实。
- 完成事务包括 Task completed、活跃区间关闭、CompletionRecord、用户允许时创建 Achievement、未来未开始块取消、版本/操作记录/集成作业。重复完成返回既有事实，不产生第二份成就。
- `TaskService.cancel` 返回严格 `TaskCancellationResult`：canceled Task、operationId、stateVersion、planRevision，以及 Calendar/Notification 的独立同步状态。它只接受直接用户或已授权 Agent 的明确动作；system authority 不得自动取消。
- 取消事务会关闭目标 Task 的当前 work/pause Interval、abandon 活跃 Session、把关联 started Block 与所有 planned Block 设为 canceled，并写 TaskActivityEvent/OperationRecord。Block 有变化时同时推进 planRevision、保存 `reason = "task_cancel"` 的 committed SchedulePlan，并建立两通道 durable IntegrationJob；没有 Block 时 planRevision 不变。整个事务不生成 CompletionRecord/Achievement，任一晚期写入失败完整回滚；相同 operationId/参数精确重放首次结果。
- finish_session 只结束本次 Session/关联块，不制造 Task 完成。abandon 保留投入事实、将当前关联块设为 skipped，不产生 CompletionRecord；取消整个任务必须走上述取消用例，不能通过普通 patch。
- AchievementService.create 只接受有效 completionRecordId 及可选表达字段；同一来源返回已有成就。用户选择不记录的来源不能由 Agent 自行重新生成，必须有后续明确用户动作。
- User Model 派生刷新可延后且可重放；原始完成/活动事实不能因派生刷新失败而丢失。
- 其他写操作使用同一 operationId 协议；所有影响计划的操作维护 stateVersion/planRevision 与必要集成作业。

### 6.1 UserModelService

`rebuild({ window, policy })` 要求显式非空 UTC 窗口与完整版本化统计 policy，在一个 UnitOfWork 事务中读取 Task、CompletionRecord、已结束 Session/Interval、TimeBlock、SchedulePlan 时区、TaskActivityEvent 与 ScheduleState，调用纯 User Model builder，并原子替换该 algorithmVersion 的派生缓存。返回 features、sample/exclusion 计数、sourceStateVersion、个性化开关与窗口；失败回滚缓存替换，不影响原始事实。

`snapshot(algorithmVersion)` 返回稳定排序的缓存与 `fresh`。只有至少存在一个特征且每项 sourceStateVersion 都等于当前 ScheduleState 才新鲜；缺开关或值无效按关闭处理。服务不提供生产窗口、分类、阈值或权重默认值，也不自动在完成事务内刷新，避免 DEC-007 未关闭时固化未评审策略。

### 6.2 Reflection / EnergyCheckIn / Relax

- `ReflectionService.getForDay({ localDate, timeZone, range })` 读取已保存复盘；`refresh(..., WriteContext)` 只接受直接用户，在一个事务中读取日范围内 CompletionRecord、重叠 Task TimeBlock 与活跃 Task，生成 `local_facts` 摘要、最多三个可追溯 Win、下一步建议并保存可选用户备注。它写 OperationRecord 以支持幂等重放，但保持 stateVersion/planRevision 不变。
- `EnergyCheckInService.record({ level, note? }, WriteContext)` 只接受直接用户，level 必须为 1–5；日期/时区由记录时刻的 LocalTimeProvider 决定。每条记录追加保存并推进 stateVersion，使旧 Preview 失效；`getLatestCurrentDay`/`getLatestForDay` 不做医疗解释。
- `RelaxService.start/end` 只接受直接用户并使用 OperationRecord 幂等。开始时若已有 active Relax 或 running Execution 则返回 `active_session_conflict`；Focus UI 必须先 pause。结束只接受 completed/abandoned，按注入时钟保存实际秒数并推进 stateVersion；不会创建 CompletionRecord 或 Achievement。`getActive/listRange` 用于 reload 恢复与历史事实读取。

两个可选入口由 `wellbeing.checkIn.enabled.v1` 与 `wellbeing.relaxSuggestions.enabled.v1` 偏好控制。关闭只隐藏建议/输入，不删除历史事实，不扩大 Agent 权限；这些 Phase 8 写用例目前不暴露为 Agent Tool。

## 7. CalendarProvider / NotificationProvider

Ports 位于 application；具体 Expo 实现位于对应 Adapter 包。

```ts
interface CalendarProvider {
  readonly provider: string;
  getPermissionState(): Promise<unknown>;
  requestPermission(access: "read" | "write"): Promise<unknown>;
  listCalendars(): Promise<unknown>;
  listBusyEvents(input: CalendarBusyRequest): Promise<unknown>;
  ensureAppCalendar(input: EnsureAppCalendarInput): Promise<unknown>;
  createAppEvent(input: AppCalendarEventInput): Promise<unknown>;
  updateAppEvent(ref: OwnedAppEventRef, patch: AppCalendarEventPatch): Promise<unknown>;
  deleteAppEvent(ref: OwnedAppEventRef): Promise<unknown>;
  reconcileAppEvent(identity: AppEventIdentity): Promise<unknown>;
  listOwnedAppEvents(input: OwnedCalendarEventInventoryInput): Promise<unknown>;
}

interface NotificationProvider {
  getPermissionState(): Promise<unknown>;
  requestPermission(): Promise<unknown>;
  schedule(input: LocalNotificationInput): Promise<unknown>;
  cancel(ref: OwnedNotificationRef): Promise<unknown>;
  cancelMany(refs: readonly OwnedNotificationRef[]): Promise<unknown>;
  reconcile(identity: NotificationIdentity): Promise<unknown>;
  listOwnedScheduledNotifications(): Promise<unknown>;
}
```

Port 故意返回 `unknown`，Application 必须用 Zod strict schema 将平台结果解析成受信类型后才能推进本地状态。`PermissionState` 区分未请求、授权、拒绝与不可用，并携带 `canAskAgain / settingsRequired`；Calendar 分别表示读取/写入能力。Calendar 快照包含 provider/calendar、精确查询范围、fetchedAt、`complete | partial`、事件实例身份和 Busy 区间；失败/不完整查询不得把缺少的事件全部当作已删除。

```ts
interface CalendarService {
  getPermissionState(): Promise<CalendarPermissionState>;
  requestPermission(access: "read" | "write"): Promise<CalendarPermissionState>;
  listCalendars(): Promise<readonly CalendarInfo[]>;
  refreshBusy(input: CalendarRefreshInput): Promise<CalendarRefreshResult>;
}

interface IntegrationService {
  processNext(channel: "calendar" | "notification"): Promise<IntegrationWorkerResult>;
  getCurrentStatus(): Promise<IntegrationState>;
  requestNotificationPermission(): Promise<NotificationPermissionState>;
  getNotificationPermissionState(): Promise<NotificationPermissionState>;
  confirmCalendarProvisioningMissing(jobId: string, context: WriteContext): Promise<CalendarProvisioningRecoveryResult>;
}
```

Calendar refresh range 必须由注入 policy 明确允许且有限。`partial` 只 upsert 可用事件；`complete` 才在同一事务删除未见实例并写 coverage。只有有效 Busy 集合变化递增 stateVersion；由 verified CalendarBinding 识别的 App-owned 事件不重复成为 Busy。

`OwnedAppEventRef` / `OwnedNotificationRef` 必须由应用归属映射验证，不能只信任模型输入或平台 ID。Calendar container 以 `(provider, ownershipKey)` 建立权威映射，不能按 title 猜测；event marker 只帮助有界查询。Busy 去重按 verified CalendarBinding 的完整 external instance 身份识别；用户外部事件始终不可写。

Reconciliation 返回 found/missing/unknown/conflict 及平台引用；unknown 不自动等同 missing。Adapter 的 owned-marker inventory 也显式返回 complete/partial/unknown：partial 可以发现候选，但不能用缺失推断对象不存在；重复稳定身份进入可见核对。平台能力不足时按 5.3 的待核对路径恢复。用户在系统日历修改 App 事件导致 conflict 时先展示差异，不静默覆盖用户改动。Calendar provisioning 无可靠全局 marker 回查时保持非自动 `reconciliation_required`；只有直接用户在两步界面中确认已检查系统 Calendar 且目标确实不存在，Application 才删除对应 intent 并重排明确目标 Job。Mobile 在该事务成功后 best-effort 唤醒协调器；外部唤醒失败不改变已提交的恢复事实。

通知身份稳定为 `(timeBlockId, type)`，planRevision 不进入身份；Adapter 使用确定性 OS identifier 与不含 title/body 的 opaque marker 回读核对。通知取消/注册有中间窗口，应报告同步状态；平台拒绝权限时本地业务仍可执行。精确通知依赖 OS 已注册计划，不依赖 JS 常驻。

IntegrationProjectionPolicy 显式决定 Calendar provisioning、哪些 Block 投影为事件/提醒、标题/正文、提醒时刻与类型；worker 没有隐藏默认。`IntegrationProjectionContext.notificationLeadMinutes` 是领取作业时在同一事务读取并校验的用户覆盖值，`null` 表示由宿主使用显式默认；当前 Mobile 默认是 `0`，用户可在 Settings 保存 `0–1440` 分钟。lease/retry 时间也由显式 policy 与 Clock 注入。当前测试 policy 只证明协议，不构成产品推荐的默认提前量/预设、Android source/account、通知声音/隐私或 Calendar 内容策略；生产选择见 [DEC-012](DECISIONS.md#dec-012)。

修改 `notification.leadMinutes.v1` 时，PreferenceService 在同一事务推进 stateVersion，并尝试将当前 planRevision 最新的安全终态 Notification Job 重排为 pending；processing、`reconciliation_required` 和带未解决 intent 的作业不被抢占。事务提交后只发送 best-effort wake，durable Job 是恢复源。若 Provider 调用期间 stateVersion 改变，IntegrationService 可返回内部 `pending` 结果并由前台协调器继续 drain；已核验的外部结果仍先 checkpoint，旧快照不能成为最终投影。

`createTimeoutCalendarProvider` / `createTimeoutNotificationProvider` 包装 Port 的全部方法并要求宿主注入 `ProviderCallTimer`。该边界不依赖全局 timer API，因而不会向 Pure Application 包引入 Node/Expo；它也不改变 Provider identity、严格结果 Schema 或 ExternalMutationIntent 协议。

## 8. ModelProvider

```ts
interface ModelProvider {
  complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}
```

ModelEvent 至少包括 text_delta、tool_call_start/delta/end、usage、error、done。complete 可通过聚合 stream 实现，两者使用同一错误、usage、tool call ID 语义。

只有完整的工具参数通过 Runtime Schema 校验后才执行。流中断不能重放已完成写操作。Agent Core 只依赖通用 Model Contract，Provider SDK 留在 model-runtime。Provider 名单/凭据模式见 [DEC-005](DECISIONS.md#dec-005)。

`createModelProvider` 的 complete/stream 和自定义 error mapper 均经过统一脱敏：只保留稳定 ProviderErrorCode、retryable 与允许的 category，不透传上游 message、body、cause 或任意 category/code。原生流中的 error event 同样只输出通用文案。取消后到达的 response/delta 不作为有效结果。

AgentRuntime 的 run timeout/Abort 对 Provider、流、审批与 Tool 等待均有界，即使依赖忽略 signal 也结束本次运行；迟到回复不得启动工具，迟到审批不得启动写入，迟到 Tool 结果不得修改已结束运行或继续下一轮。这只停止等待，不能撤销已开始的事务或外部调用。成功收据保留；等待中写入的恢复使用宿主生成的稳定 operationId 和 Application 的 durable 幂等结果，不能把 Abort 当作“未提交”的证明。Tool 异常仅输出稳定允许错误码、retryable 与通用文案，未知异常统一为 tool_execution_error。

## 9. Agent Tool Contract

```ts
interface AgentTool<TInput, TOutput> {
  name: string;
  description: string;
  risk: ToolRisk; // 最低风险；不是最终授权结论
  inputSchema: RuntimeSchema<TInput>;
  outputSchema: RuntimeSchema<TOutput>;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
}

type ToolRisk = "read" | "low_write" | "high_write" | "external_sensitive";
```

ToolExecutionContext 由宿主提供受限服务、AbortSignal、运行预算、作用域与权限证据。动态风险基于应用层解析出的目标、实际 diff、是否可撤销及用户设置计算；未知风险不能降为 low_write。审批绑定具体操作/Preview 与版本，不能由工具参数伪造。

<a id="tool-matrix"></a>
## 10. V1 Tool Matrix

表中所有写操作都使用宿主保存的 operationId。模型调用去重与业务幂等分开处理；网络重试复用原 ID，不将不同用户动作误认为同一次请求。各命名输入对象以数据模型与下表字段白名单为准，在对应 Phase 建立 Runtime Schema 和边界测试。

| Tool | 输入白名单 / 输出 | 应用用例与最低风险 |
| --- | --- | --- |
| task.create | title、description?、priority?、估时/时间/拆分/能量约束、projectId?/goalId?；返回 Task | TaskService.create；low_write；缺时长可保存 inbox |
| task.update | taskId、普通可编辑字段 patch；返回 Task | TaskService.update；low_write 起，按实际影响升级；禁止状态/证据/实际耗时 patch |
| task.complete | taskId、recordAchievement?、allEffortRecorded?；返回 Task/CompletionRecord/可选 Achievement/集成状态 | TaskService.complete；high_write，需明确完成授权；完整投入声明只接受直接用户 authority |
| task.list | status/projectId?/timeRange?/cursor?/limit；返回有界分页 Task | TaskService.list；read |
| calendar.listBusy | start、end、授权作用域；返回必要 Busy 快照及新鲜度 | CalendarService.listBusy；read；刷新缓存为受控用例，不是 Schedule Preview 的副作用 |
| scheduler.preview | reason、taskIds?、timeRange?；返回 SchedulePreview | ScheduleService.preview；read；不写 DB |
| scheduler.replan | 同 preview；返回带 diff 的 SchedulePreview | ScheduleService.replan；read；不隐式提交 |
| scheduler.commit | previewId、expectedStateVersion；返回 ScheduleCommitResult | ScheduleService.commit；low_write 起，按变更升级 |
| execution.start | taskId、timeBlockId?；返回 Session/版本 | ExecutionService.start；low_write；已有活跃 Session 时返回冲突 |
| execution.complete | sessionId、outcome、recordAchievement?、allEffortRecorded?；返回 Session/可选完成事实/集成状态 | ExecutionService.finish；high_write，需明确 outcome 授权；完整投入声明只接受直接用户 authority |
| achievement.create | completionRecordId、title?/summary?；返回 Achievement | AchievementService.create；low_write；不允许模型自造证据 |
| achievement.list | localDateRange?/timeZone?/cursor?/limit；返回有界分页 | AchievementService.list；read |
| notification.reschedule | planRevision；返回当前通道同步状态 | IntegrationService.reconcileNotifications；low_write；拒绝旧版本，不接受任意通知正文/时刻绕过计划 |
| preference.read | 允许读取的 keys；返回脱敏偏好 | PreferenceService.read；read；不返回 Secret |
| preference.update | 允许编辑的 keys/value patch；返回偏好及版本 | PreferenceService.update；low_write 起；扩大自治权限须用户专门设置流程，Secret 不经此工具 |

low_write 是否可自动执行必须满足 [Security](09-SECURITY.md#5-agent-tool-risk-model) 的授权、可恢复与审计条件。工具未完成所需保障前不开放自动执行。

当前 Phase 6 实现中，全部 15 个 Tool 已注册。`task.list` 与 `achievement.list` 使用最大 50 条的稳定 cursor 分页；Task 的 `timeRange` 按有效调度窗口重叠解释。`calendar.listBusy` 只读取已授权 provider/calendar 的有限本地缓存，排除 verified App-owned 实例，仅返回 Busy 起止、新鲜度、完整性与截断状态，不触发 Provider refresh。`notification.reschedule` 只接受 planRevision，先拒绝旧版本再调用受 fence 保护的 Notification worker，不能传正文或任意时刻。

模型不能在 Tool Input 中提供 `WriteContext`；宿主使用 runId/toolCallId 生成稳定 operationId，并把针对该具体调用的 authorizationId 注入 Application authority。`task.update` 的展示字段可保持 low_write，任何已知排程影响字段保守升级；`scheduler.commit` 在 DEC-002 的完整 diff 风险策略交付前按 high_write 处理。`preference.update` 当前同样按 high_write 请求授权，Application 仍拒绝 Agent 修改直接用户专属的调度/Calendar scope 设置，包括 `notification.leadMinutes.v1`；Settings 的直接用户流程才可写入。

自然语言 Capture 采用单独的非持久化 `capture.preview` Model Tool Schema，只输出 `CreateTaskInput` 白名单与 uncertainFields；完整校验后才展示结构化草稿。草稿本身不创建 Task，不构成完成或排程授权；确认后继续走 TaskService 与 ScheduleService。真实 Provider 与凭据方式仍见 DEC-005。

Capture 的显式时间上下文 Contract 为 `preview(text, timeContext, signal)`。`timeContext` 严格只允许 `referenceInstant`（有效 ISO-8601 UTC Instant，须以 Z 结尾，规范化毫秒）、`timeZone`（宿主支持的 IANA 标识，可用 UTC，不接受数值 offset）和 `locale`（有效 BCP 47 locale，规范化大小写）。宿主在用户发起本次 Preview 时注入这些值；Previewer 不隐式读取当前时钟/设备设置。缺失、非法或额外字段在 Provider 调用前以 invalid_context 拒绝。

请求包含固定 system 约束、单独的受控时间 Context system 消息、本次用户原文和 capture.preview Schema；不追加历史、Calendar 内容、Check-in 或 Secret。相对日期只能参考本次上下文，仍不把“周五/下周”等多义表达默认为已确定意图；模糊/缺失字段保留 uncertainFields。仅日期 Deadline 保留 localDate/timeZone，不能补造精确截止时刻或估时；草稿仍需直接用户确认。时间 Context 传递和脚本化输出校验不证明真实模型的中文日期解释准确率。

## 11. Error Contract

```ts
type AppError = {
  code: string;
  message: string;
  retryable: boolean;
  userAction?: string;
  causeCategory?: string;
  operationId?: string;
};
```

至少区分 validation_error、permission_required、active_session_conflict、invalid_transition、preview_not_found、preview_expired、plan_conflict、idempotency_conflict、undo_unavailable、reconciliation_required、adapter_error、provider_error、provider_timeout。

本地提交成功后的集成失败通过 CommitResult 的通道状态表达；不能作为“整个事务失败”误导调用方重新创建操作。错误不暴露 SQLite/Provider 原始堆栈与敏感 Payload。

## 12. Versioning

Phase 1 已有代码调用方、持久化 Schema 与 migration，但尚无已发布生产用户数据。任何 Breaking Change 必须同步更新调用方、Runtime Schema、Drizzle Schema、migration、OperationRecord 重放兼容性、测试和本文件；改变系统边界时新增 ADR，影响已有本地数据时提供可验证迁移，不能以尚未发布为由静默重置。

Tool Name / Input / Output / 风险与授权语义均属于 Contract，不得静默改变。Preview 必须绑定 schedulerVersion 与 policyVersion，升级后旧 Preview 失效。既有操作结果保留其原版本解释。

## 13. Future Sync API

V1 不实现完整 Cloud Sync。device identity、变更日志、冲突、删除与 Schema 演进需独立设计；不得提前添加临时同步 API 绑定领域模型。
