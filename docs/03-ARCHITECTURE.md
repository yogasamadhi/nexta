# 03 — Architecture

## 1. Architecture Level

V1：**Mobile Local-first Modular Architecture**

核心目标：

- 核心业务在设备本地可运行；
- Agent 与 Scheduler 明确分离；
- Domain / Core 不依赖 Expo；
- 为未来 Desktop / Sync / Local LLM 保留扩展边界。

---

## 2. Architecture Principles

1. Local-first
2. Deterministic Scheduling
3. Agent Orchestration ≠ Scheduling Algorithm
4. Pure Core
5. Explicit Contracts
6. Event-driven Agent
7. OS-native Scheduling for Notifications
8. Minimal Data Exposure
9. Offline Degradation
10. Explainable Plan Changes
11. Human-aware，不追求 Calendar 填满率
12. Living Documentation

---

## 3. Technology Stack

以下为 Phase 0 已验证的技术基线。精确解析版本以 manifest / `pnpm-lock.yaml` 为机器事实源，验证证据写入 STATUS，兼容组合与升级规则见已关闭的 [DEC-004](DECISIONS.md#dec-004)。文档中的主版本不替代 lockfile，也不表示尚未实现的产品能力可用。

```text
Expo SDK 58
React Native
TypeScript
Hermes
Expo Router
NativeWind 5
gluestack-ui v5
Reanimated 4
React Native Gesture Handler

expo-sqlite
Drizzle ORM
SecureStore

expo-calendar
expo-notifications
expo-background-task / task-manager

pnpm
Node（仓库脚本运行时）
Vitest
React Native Testing Library（按 UI Phase 接入）
Maestro（按 Phase 接入）
```

---

## 4. High-Level System

```text
React Native UI / Device Lifecycle       Agent Runtime
             │                               │
             │                          Agent Tools
             └──────────────┬────────────────┘
                            ↓
              Application Services (Pure TS)
                  │                  │
                  ↓                  ↓
            Domain Policies    Scheduler Core (Pure TS)
                  │            只计算，不调用 Adapters
                  ↓
           Repository / Device Ports
                  ↑ 实现并由 Composition Root 注入
      ┌───────────┼────────────────┐
  SQLite       Calendar       Notification
  Drizzle      Expo Adapter   Expo Adapter
```

Model Runtime：

```text
Local Agent Runtime
        │
   Model Adapter
     ┌──┴────────────┐
     │               │
Remote Provider   Future Native Local LLM
```

---

## 5. Repository Structure

```text
apps/
  mobile/
    app/
    src/

packages/
  domain/
  application/
  database/
  scheduler-core/
  agent-core/
  agent-tools/
  model-runtime/
  calendar/
  notifications/
  user-model/
  ui/
```

### apps/mobile

只负责：

- Expo 初始化；
- Router；
- Screen；
- Device lifecycle；
- Composition Root；
- Native permissions。

### packages/domain

包含：

- Entity / Value Object；
- Domain Enum；
- Domain Policy；
- Domain Error。

不得 import Expo。

### packages/application

平台无关的应用用例与 Ports，包含 Task、Goal/Project、Execution、Achievement、Schedule、Preference 服务，以及 Repository / UnitOfWork / Clock / Calendar / Notification Port。Goal/Project 列表使用 Application Service 的稳定有界游标分页，Screen 不得为了组织视图直接读取 Repository/SQLite。

负责：运行时边界校验、权限与实际变更风险判定、事务、版本冲突、幂等、审计和外部副作用恢复。仅依赖 Domain、Scheduler、纯 User Model 和平台无关 Contracts；不得 import Expo、SQLite 实现或 Provider SDK。

Infrastructure 实现 Ports；`apps/mobile` 的 Composition Root 注入具体适配器。UI 与 Agent Tools 调用同一应用用例，禁止各自实现另一套完成/提交规则。依据见 [ADR-0009](ADR/0009-application-commit-and-recovery.md)。

当前 Phase 5/7 实现中，ExecutionService 以本地事务维护 Session/work-pause Interval、Task/Block 状态、版本和必要 IntegrationJob；TaskService 手工完成与 ExecutionService 的 complete_task 分支执行同一 CompletionRecord/Achievement 唯一性、可信投入聚合和未来块清理规则。TaskService 取消同样是计划事务：若目标 Task 正在执行，先关闭匹配区间并 abandon Session，再取消关联 started Block 与全部 planned Block；只要 Block 投影变化，就创建新的 committed SchedulePlan、推进 planRevision 并写入 Calendar/Notification durable Job，否则只推进 stateVersion。取消绝不创建 CompletionRecord/Achievement，任何晚期写入失败必须整体回滚。直接用户可额外确认“全部实际投入都已被计时记录”，从而形成完整覆盖样本；Agent 无权代替用户确认。AchievementService 只从稳定 CompletionRecord 读取/创建表达，并通过关联查询向 UI 暴露 Task/Project/Goal 来源；UserModelService 在一个一致性事务读取最小执行事实、调用纯统计包并原子替换同算法版本的派生缓存；Screen 不直接读取表。

### packages/scheduler-core

纯 TS。

输入：

```text
Tasks
Busy Events
Existing Blocks
Preferences
User Model Features
Now
Policy
```

输出：

```text
Plan
Blocks
Unscheduled
Warnings
Explanation Metadata
```

### packages/agent-core

Pi-inspired，但不是 `pi-coding-agent`。

包含：

- Agent Loop；
- State；
- Tool Registry；
- Message；
- Abort；
- Streaming Events；
- Max Turns；
- Tool Result；
- Approval Hook；
- Context Transform。

禁止：

- node:fs
- node:path
- child_process
- shell
- process spawning
- coding-agent file tools

当前 Phase 6 实现使用结构化 `AgentAbortSignal` 与包内取消控制器，保持 pure TypeScript/Hermes 边界；AgentRuntime 支持 complete/stream、严格 Provider 协议、maxTurns/maxToolCalls/run timeout、Approval Hook、Tool 收据复用与有界 Context Transform。AgentEventCoordinator 只在宿主激活的实际事件窗口串行 drain，相同 trigger/dedupeKey 合并，inactive 时中止当前工作并保留待恢复事件，不建立 daemon。

### packages/agent-tools

产品专用 Tool，负责将工具参数映射到受限 Application Service。风险枚举为最低风险；最终风险按实际 diff、调用上下文与授权计算。不得 import Database/Expo 实现。

当前 15 个 V1 Tool 均有严格 Zod 输入/输出及 JSON Schema；模型输入不含 authority/operationId，宿主按 runId/toolCallId 与具体授权生成写上下文。排程相关 Task 更新与 Schedule Commit 采用保守高风险，Task/Execution 明确完成始终 high_write；Calendar 读取受宿主 scope 和缓存范围约束，Preference 的自治范围扩大仍由 Application 拒绝。自然语言 Capture Preview 使用独立非持久化 `capture.preview` Schema，解析成功后仍必须调用同一 Task/Schedule 用例。

### packages/model-runtime

统一模型接口，不把 Provider SDK 传播到 Agent Core。

当前实现提供 complete/stream 相互适配、完整 tool-call 聚合、Abort、usage、脱敏错误映射与 FakeModelProvider。未选择或打包真实 Provider SDK/共享客户端密钥；生产接入等待 DEC-005。

### packages/database

Drizzle Schema、Migration、Repository Implementation。当前有序 migration 已覆盖 Phase 1–8 的业务事实、计划提交、Calendar Snapshot/Coverage、已验证绑定、可恢复 IntegrationJob、外部副作用 write-ahead intent、UserPreference、Execution/Achievement、最小 AgentRun metadata、版本化 UserModelFeature 派生缓存，以及 Reflection/Check-in/Relax；SQLite Repository 实现 Application UnitOfWork。migration 启动默认严格验证 id 前缀和固定 checksum；唯一预发布兼容桥只接受已知 `0006` 全零占位标记，并在其余历史与真实表/索引逐项匹配固定 SQL 后事务性修复，不能绕过其他历史错误。Expo SQLite Adapter 对同一连接的 `withExclusiveTransactionAsync` 调用排队串行执行，Application 即使并发读取或前台同步也不会同时进入两个原生 exclusive transaction；失败事务必须释放队列。

### packages/calendar

实现 Application 的 CalendarProvider Port，封装 Expo Adapter；Port 不反向依赖 Expo。当前 Adapter 通过可注入 native facade 隔离 `expo-calendar`，负责权限映射、有界 Busy 查询、重复实例身份、App Calendar provisioning、事件归属 marker、owned-marker inventory 与 reconciliation；marker 只帮助查找，最终归属仍须由本地 verified binding 与平台回读共同证明。

### packages/notifications

实现 Application 的 NotificationProvider Port；承担权限、平台注册/取消/查询、owned-marker inventory 与稳定通知身份，业务投影、映射和重试状态由应用服务维护。当前 Adapter 以 `(timeBlockId, type)` 派生稳定 OS identifier，并把不含标题/正文的 opaque marker 用于回读核对。

以上 Calendar/Notification Adapter 已有注入 facade 的单元测试，并已由 Mobile Composition Root 在 SQLite migration 后构造；AppState active 时前台协调器按通道消费 durable Job，inactive 时不启动新作业并等待当前调用后关闭数据库。该组合不会自动请求权限，也不是常驻 daemon；iOS Simulator 已验证未授权时作业保持可见 `permission_required`，仍没有真实 OS/物理设备权限、账户/source、回读、提醒投递或进程终止恢复证据。已实现代码边界与已验证平台能力必须分别报告。

Mobile Composition Root 在 Adapter 与 Application Service 之间统一注入有界 Provider 包装器；当前配置为 15 秒，Timer 由宿主注入，因此 Application 继续保持 Pure TypeScript/Hermes 边界。超时不提供平台取消保证：permission/list/inventory/reconcile 等只读调用超时可按 retry policy 延迟重试；permission request 和 Calendar/Notification 外部写超时视为结果不确定，必须保留预写 intent 并优先回读核对。任何迟到的 Promise 结果都不能越过已收口的调用修改本地事实。

### packages/user-model

Pure TypeScript 的确定性派生层，只处理用户执行行为特征，不做心理诊断。输入是显式观察窗口、最小事实快照与带 algorithmVersion 的统计 policy；输出是排序稳定、可重建的数值特征、sampleCount、confidence 与排除计数。包内没有环境时钟、时区数据库、存储或生产阈值默认值，也不直接修改 Scheduler 或 SQLite。

---

## 6. Dependency Direction

```text
UI
↓
Application
↓
Domain / Scheduler / Agent Contracts
↓
Ports
↑
Infrastructure Adapters
```

Hard Rule：

```text
Core / Application / Agent Tools 不 import Expo 或 Node API
Domain 不 import DB / Application
Scheduler 不 import LLM / Application / Adapters
Agent Core 不 import UI / Application 实现
Application 不 import Database / Calendar / Notification Adapter 实现
```

---

## 7. State Ownership

### SQLite

拥有：

- Tasks
- Projects
- Goals
- TimeBlocks
- ExecutionSessions
- ExecutionIntervals / CompletionRecords / TaskActivityEvents
- Achievements
- Reflections
- CheckIns
- RelaxSessions
- UserModelFeatures
- Agent Run Metadata
- Preferences
- ScheduleState / OperationRecords / IntegrationJobs
- ExternalMutationIntents
- ExternalCalendarEventSnapshots / CalendarRefreshCoverages
- CalendarContainerBindings / CalendarBindings / NotificationBindings

### OS Calendar

拥有外部用户日历事件。

本地只保存必要 Snapshot / External ID / Sync Metadata。

### Scheduler

不直接持久化状态。

它是纯函数式/确定性计算核心。

### Agent

Agent Run State 可持久化必要 Metadata，但业务事实仍属于业务实体。

---

## 8. Runtime Model

### Foreground

完整能力：

- Agent；
- Scheduling；
- Calendar Sync；
- Notifications；
- LLM Streaming；
- UI Animation。

### Background

不假设 JS 常驻。

只在 OS 授予执行窗口时做：

- 短同步；
- Notification Refresh；
- 轻量 Replan；
- 数据整理。

精确提醒交给 OS Notification Scheduler。

---

## 9. Agent Architecture

```text
User / Event
    ↓
Agent Run
    ↓
Context Builder
    ↓
Model Adapter
    ↓
Tool Call
    ↓
Risk / Schema / Permission
    ↓
Tool Execute
    ↓
Tool Result
    ↓
Agent Loop
    ↓
Final Response
```

Agent 的职责：

- 理解意图；
- 选择 Tool；
- 编排；
- 解释；
- 交互。

Agent 不负责：

- 自己“想出”最终排程；
- 直接写数据库；
- 绕过权限；
- 常驻后台。

---

## 10. Scheduler Architecture

Scheduler 使用明确约束。

### Hard Constraints

- Busy Event
- Locked TimeBlock
- Deadline
- Earliest Start
- Working Window
- Min / Max Block Duration
- 已完成 Block 不移动
- 正在执行 Block 不移动

### Soft Constraints

- Priority
- Energy Demand
- User Preferred Hours
- User Model Completion Rate
- Fragmentation
- Plan Stability
- Break Need

### 可行性与评分顺序

首先检查硬约束，只为可行部分生成新块。无法在 Deadline 前排完的任务返回 `unscheduled`（可含未排入剩余分钟）与原因，不用重叠 Busy 或越过 Deadline 来换取高分。

输入中已有 Locked / Started / Completed 块即使与新增 Busy 冲突，也保留原事实并返回明确冲突诊断；不得称其为无冲突的新方案。硬约束不满足的用户拖动不得提交为合法排程。

在合法候选方案之间按以下顺序比较：

1. Deadline 内可完成的工作与紧迫性；
2. Priority；
3. 最小化计划变化；
4. 最小化碎片；
5. 匹配具备足够证据的用户执行偏好；
6. 保留恢复时间。

相同输入快照、策略与算法版本产生相同结果。显式输入包括 now、范围、时区与版本化策略；不得读取系统时钟、随机 ID 或隐式全局偏好。稳定排序/相同分数决胜规则属于算法版本。

V1 可以采用启发式算法；不得为了“AI 感”直接让 LLM 生成时间表。

---

## 11. Calendar Model

V1：

- Read：用户授权的系统日历；
- Write：App 自有 Calendar / TimeBlock；
- External Event 默认视为 Busy / Immutable。
- 读取 Busy 时用稳定 CalendarBinding 排除 App 已映射事件，避免自己的 TimeBlock 被重复算作 Busy；不能仅凭标题识别。
- 每次受限范围刷新同时处理新增、修改、删除与重复事件实例；权限失败不将旧快照误标为已刷新。
- `complete` 刷新才写入覆盖证明并删除该范围内未见事件；`partial` 只合并可用观测，不删除旧快照。只有排除已验证自有事件后的有效 Busy 集合变化才递增 stateVersion。
- 用户在系统日历中修改 App 事件时，V1 不把它静默导入为本地计划修改；显示差异并请求恢复/重新排程，保护本地事实源。
- 权限拒绝与待同步是集成状态，不否定本地计划成功。

Application 的 CalendarService、Snapshot/Coverage Repository 与 Expo Calendar Adapter 已实现上述技术协议；IntegrationService 只把平台回读确认归属的 Calendar/事件保存为 verified binding。Calendar 创建/更新/删除前后均按稳定身份 reconciliation；`missing`、`unknown` 与 `conflict` 不互相冒充。Adapter 的 owned-marker inventory 可发现本地 binding 丢失后的候选；partial/unknown inventory 不能用缺失推断删除。Mobile Runtime 已构造这些对象与有限范围 policy，但权限/刷新 UI、SchedulingSnapshot 组装和真实 OS 行为仍须后续接入和设备验证。

未来若允许修改外部事件，必须新 ADR + 权限设计。

---

## 12. Notification Model

每次本地 Commit 在 SQLite 事务内写入计划、新版本、操作结果与待同步作业；事务成功后才触达 OS Calendar / Notification。

Application 按注入的目标投影处理差异：取消过期通知、注册所需通知、保存映射；重复执行应收敛到当前版本。每次有副作用的 OS 调用前，先独立持久化只含稳定 ID/hash/UTC 范围的 ExternalMutationIntent；回读确认后与 verified/pending binding 在同一 checkpoint 事务落盘并清除 intent。崩溃后优先恢复通道内最旧 intent，再用稳定 `(timeBlockId, type)`、平台标识、owned-marker inventory 与 verified 本地映射核对结果，不能盲目再创建。

Calendar 与 Notification 独立报告 `synced / pending / permission_required / failed / disabled / reconciliation_required / superseded`；binding 还可记录 `conflict`。一个通道失败不阻止另一通道恢复。旧版本作业执行前后均校验当前目标，不能把新计划覆盖回旧状态。具体协议见 [Commit Contract](05-API.md#commit-contract)。

IntegrationJob 的每通道原子 claim 使用 token、attempt generation、lease、notBefore 与显式 `automaticRetryEligible` 作为 fence；未过期的 processing job 阻止同通道并发消费，过期 lease 可被新 generation 重领，旧 worker 的 CAS 完成被拒绝。带未解决 intent 的可运行 Job 优先于普通 pending revision；权限恢复只由显式前台请求将 `permission_required` 作业重新排队，Mobile 宿主在授权成功后立即 best-effort 唤醒前台协调器，避免要求用户切换 AppState。非自动 Calendar provisioning 恢复还要求直接用户确认缺失，确认事务提交后同样由宿主唤醒；唤醒失败不回滚或掩盖 durable 本地结果。后台读取/worker 不弹权限框。外部调用不持有 SQLite 事务；intent/binding checkpoint 与 Job 最终 CAS 都受 claim/revision fence 保护。

Application worker、Expo Notifications Adapter 与仅前台运行的 Mobile 协调器已实现该技术路径。Composition 显式采用 DEC-012 关闭前的可替换保守基线：只投影 future planned task block、使用 generic title、不带 Task description、sound=false；用户没有保存提醒偏好时使用 lead=0，Settings 可由直接用户保存 `0–1440` 分钟的覆盖值。偏好、计划事实与 stateVersion 在同一投影快照读取；提醒值变化会推进 stateVersion，并只把当前 revision 中处于安全终态且没有未解决 intent 的 Notification Job 重新排为 pending。若外部调用期间 stateVersion 改变，worker 先保存已核验的外部结果，再释放当前 claim 重新收敛，不能把旧偏好投影冒充最终状态。Android source 缺失时仍不猜测创建 Calendar。哪些块/状态投影、标题/正文暴露、产品推荐的默认提前量/预设、Android source/account 及声音/振动仍是 [DEC-012](DECISIONS.md#dec-012) 的 Open 产品决策；当前基线不等于已接受。真实 OS 投递/取消/重启恢复尚未验证。

不得依赖后台 JS 在具体时刻检查时间；OS 未授予运行窗口时不承诺即时同步。

---

## 13. User Model

User Model 是统计/特征层，不是 LLM 人格画像。

示例：

```text
estimateBias.document = +0.28
completionRate.hour.09 = 0.76
completionRate.hour.22 = 0.31
medianSessionMinutes = 43
```

统计口径、缺样本规则与事实来源见 [数据模型](04-DATA-MODEL.md#user-model-semantics)。数值阈值在 [DEC-007](DECISIONS.md#dec-007) 接受前不启用个性化排程。

当前 Phase 7 技术边界已实现纯 facts-to-features builder、`0007` 本地派生缓存、UserModelService 原子重建/新鲜度快照，以及 SchedulingSnapshot 将“用户开关 + 特征”传给可注入 policy 的接口。缺偏好按关闭处理；无特征或 stateVersion 已变化时按无可用新鲜样本处理。DEC-007 仍为 Open，因此 production Mobile policy 继续返回空特征窗口、completion-rate 权重保持 `0`，即使缓存存在也不改变排程；这是一条可验证的安全降级，不是已接受的个性化参数。

每个 Feature 必须带：

- sampleCount
- confidence
- lastUpdatedAt
- algorithmVersion

---

## 13.1 Reflection, Check-in & Relax

Phase 8 的可持续节奏能力继续遵守 UI → Application → Domain/Repository 边界：`DailyReflection`、`EnergyCheckIn` 与 `RelaxSession` 是本地业务事实，Screen 不直接访问 SQLite，也不把界面计时器当作时长事实源。

- ReflectionService 在一个一致性事务中读取指定本地日的 CompletionRecord、TimeBlock 与活跃 Task，只生成可回溯的离线事实摘要、最多三个 Wins 和下一步建议；用户备注单独保存。刷新不改变排程输入版本，也不调用模型或 Provider。
- EnergyCheckInService 在记录时通过 LocalTimeProvider 固定 `localDate/timeZone`，只接受直接用户写入。新记录推进 `stateVersion`，SchedulingSnapshot 只把 `now` 之前最新一条交给可注入 policy；当前 Mobile 中性 policy 不应用未评审权重。
- RelaxService 记录 `active → completed/abandoned` 的真实墙钟区间，同时最多一条 active；时钟倒退钳制为零并标记 `needs_review`。从 Focus 进入前先显式暂停 Execution，结束后由 UI 明确恢复，不把 Relax 完成冒充 Task 完成。
- `wellbeing.checkIn.enabled.v1` 与 `wellbeing.relaxSuggestions.enabled.v1` 只控制可选入口，不代表医疗状态或自治授权。环境声入口在当前离线基线使用静默模式，不申请音频权限。

`0008_phase8_wellbeing`、Repository、Application Service 与 Mobile 路由已经接入；自动化测试证明事实来源、幂等、约束与回滚。真实 iOS/Android E2E-005 以及 Check-in 对生产排程的正式软权重仍须设备验收和产品 policy 决定。

### 13.2 Reliability & Offline

Phase 9 不另建一套恢复架构，而是组合验证既有本地事务、版本 fence、OperationRecord、IntegrationJob、ExternalMutationIntent 与区间状态机。文件型 SQLite 场景会真实关闭并重新打开连接，重复执行完整 migration，然后继续同一 Schedule/Execution/Reflection/Relax 业务链；响应丢失使用原 operationId 精确重放，未配置/离线的 OS 通道只保留 durable pending Job，不回滚已经提交的本地计划或完成事实。

自动化已覆盖多次进程重开、active/paused 会话恢复、唯一 CompletionRecord/Achievement、单 Reflection/Relax、迁移重入、版本冲突和 Provider 读/写超时。它不能证明移动 OS 杀进程时序、真实 Calendar/Notification 的迟到结果、离线到点投递、物理设备 E2E 或长期资源稳定性；这些必须按 Release Gate 单独记录。

---

## 14. Error Model

错误分类：

```text
DomainError
ValidationError
SchedulingError
PermissionError
AdapterError
ProviderError
AgentToolError
PersistenceError
ConflictError
```

UI 不直接展示底层技术错误。

---

## 15. Resource Lifecycle

必须明确释放：

- Streaming AbortController
- Calendar Subscription
- Reanimated / Gesture subscriptions
- DB transaction
- Agent Run
- Model Stream
- Notification replacement mapping

---

## 16. Architecture Testing

必须测试：

- Core package 不含 forbidden import；
- Scheduler invariants；
- Agent max turns；
- Tool schema；
- Tool risk policy；
- DB migration；
- Plan commit version conflict；
- Notification rebuild；
- Offline mode。

---

## 17. Evolution Strategy

未来扩展时优先新增 Adapter，而不是破坏 Core：

```text
Google Calendar Direct Adapter
Microsoft Calendar Adapter
Cloud Sync Adapter
Native Local LLM Adapter
Desktop Host
```

## 18. Account and Sync Server

[ADR-0010](ADR/0010-local-first-cloud-sync.md) 扩展内部账号与同步范围。`server/` 是独立 Go module：Kratos HTTP/gRPC → Service DTO → Biz → sqlc/pgx → PostgreSQL 18。服务端 SQL migrations 是 PostgreSQL 机器事实源，移动端 Drizzle 仍是 SQLite 机器事实源。Go 不导入或重写 TypeScript Scheduler。

移动端 Application 声明 CloudAPI/SecretStore/LocalStore Ports 与前台 CloudSyncService，宿主实现 HTTP、SecureStore、资料切换和 SQLite Adapter。Repository 写入在同一 UnitOfWork 捕获 Outbox；远端复制通过独立受校验的事务入口导入，不重放用户用例，不生成第二套完成事实。来源计划元数据仅用于核对，不作为排程或写权限。

账号资料目录使用独立非秘密 SQLite catalog，记录服务端 origin、账号和本地数据库名；Token 与安装身份继续由 SecureStore 隔离保存。Keychain 不可用时本地模式仍能启动，认证前先验证安全凭据存储。首次下载的固定快照页保存在独立暂存表，完成运行时与完整引用图校验后，事实、云端版本、游标和初始化完成标记一起提交；中断或进程重开只继续暂存，不发布半套事实。

两个副本之间没有分布式原子事务：本地成功、上传待处理、冲突和 OS 投影分别可见；网络失败不回滚本地完成。正式上线与原 Phase Exit 继续分别验收。
