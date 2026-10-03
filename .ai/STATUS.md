# Current Status

## Updated

2026-10-03

## Current Phase

当前实施轨道为 Phase 10 — Build & Release；正式阶段状态为：

- Phase 1 **IN PROGRESS**：实现与门禁已通过，但 [DEC-006](../docs/DECISIONS.md#dec-006) 尚未关闭，不能正式标记 DONE。
- Phase 2 **TECHNICAL IMPLEMENTATION COMPLETE / FORMAL PRODUCT SCOPE IN PROGRESS**：Pure Scheduler、Application Preview/Commit 和本地 SQLite 交付项已实现并通过门禁；[DEC-006](../docs/DECISIONS.md#dec-006)、[DEC-011](../docs/DECISIONS.md#dec-011) 尚未关闭，因此依赖范围、生产词表/default 与 policy 语义不能正式定稿。生产 Snapshot/Mobile/设备/OS 证据是后续集成范围，不能由本地技术完成状态代替。
- Phase 3 **IN PROGRESS**：平台无关 Calendar/Notification Domain/Application、`0002`/`0003` SQLite、Expo Adapter、write-ahead ExternalMutationIntent、仅前台 Mobile Runtime 协调器与提醒偏好安全重排已经实现并有自动化证据；ScheduleService/SchedulingSnapshot、显式权限、日历范围、有界 refresh 和 `0–1440` 分钟提醒设置已接入 Mobile，但真实 iOS/Android OS 行为尚未验收，[DEC-012](../docs/DECISIONS.md#dec-012) 仍为 Open，因此不能正式标记 DONE。
- Phase 4 **IN PROGRESS**：`0004` UserPreference、Hermes Intl/DST Adapter、production SchedulingSnapshot、Today/Day Timeline、本周日期条、含排程约束的手工 Capture/Task 编辑与两步取消、有界分页收件箱、Schedule Preview/显式 Commit、TimeBlock drag/resize/lock 与 Settings 已实现并通过类型、lint、单元、真实 Node SQLite 及 Hermes bundle 门禁；iOS Simulator Development Build 核心交互、收件箱/未来块编辑入口、约束持久化及 15 分钟提醒偏好持久化/作业重排已通过，物理设备、Android 运行和 OS 权限/Provider 验收仍未完成。
- Phase 5 **TECHNICAL IMPLEMENTATION COMPLETE / FORMAL TRIAL EXIT IN PROGRESS**：`0005` Execution/Achievement 持久化、ExecutionService、AchievementService、完成事务扩展、Focus/Today 启动入口、可跳过/可关闭且恢复不重复的 10 秒 Mindful Transition、成就日/周/月/历史回顾与编辑/收起已经实现。自动化门禁与 iOS Simulator 的 start → pause → reload recovery → resume → complete_task → Achievement → edit/hide/restore 已通过；首轮试用定义 [DEC-001](../docs/DECISIONS.md#dec-001)、物理 iOS/Android 设备证据和前序 OS Provider 验收仍未关闭。
- Phase 6 **TECHNICAL CORE COMPLETE / PROVIDER AND E2E IN PROGRESS**：Pure AgentRuntime、事件协调、统一 ModelProvider/Fake Provider、15 个 V1 Tool、最小 `0006` AgentRun metadata、自然语言结构化 Preview 边界与 Mobile 明确手工降级入口已经实现并通过自动化技术门禁。真实 Provider/生产凭据 [DEC-005](../docs/DECISIONS.md#dec-005)、真实自然语言解释质量与设备 E2E-001 尚未关闭，不能正式标记 DONE。
- Phase 7 **TECHNICAL CORE COMPLETE / PRODUCT POLICY IN PROGRESS**：Pure facts-to-features builder、UserModelFeature Domain/Repository、`0007`、原子重建/新鲜度快照、直接用户完整投入覆盖确认、个性化关闭设置与 Scheduler policy 输入边界已实现并通过自动化技术门禁。[DEC-007](../docs/DECISIONS.md#dec-007) 仍为 Open，生产窗口/分类/样本阈值/权重未定；Mobile 当前不允许启用且中性 policy 不消费缓存，因此不能正式标记 DONE。
- Phase 8 **TECHNICAL CORE COMPLETE / DEVICE AND POLICY ACCEPTANCE IN PROGRESS**：事实型 Daily Reflection、按记录时区归属的可选 Energy Check-in、真实区间 RelaxSession、`0008` SQLite、偏好与 Today/Focus/Relax/Reflection/Replan UI 已实现并通过自动化技术门禁；iOS Simulator 已完成 Relax → 呼吸入口 → 完成 → Today 冒烟并保存可信真实区间。SchedulingSnapshot 已把最新有效 Check-in 交给 policy，但当前 Mobile 中性 policy 不应用未评审权重；物理 iOS/Android E2E-005 尚未完成，因此不能正式标记 DONE。
- Phase 9 **AUTOMATED TECHNICAL BASELINE COMPLETE / DEVICE E2E IN PROGRESS**：Mobile Calendar/Notification Provider 已统一设置 15 秒有界调用，区分安全只读超时与结果不确定的外部写超时；文件型 SQLite 组合故障测试已覆盖多次进程重开、migration 重入、计划/执行/复盘/Relax 精确重放，以及离线同步 pending 保持。物理 iOS/Android E2E-001 至 E2E-005、真实 OS Provider 超时/终止窗口、离线通知重建和长期运行尚未完成，因此不能正式标记 DONE。
- Phase 10 **TECHNICAL RELEASE SCAFFOLD COMPLETE / EXTERNAL RELEASE GATES BLOCKED**：App `0.1.0`、三套独立 variant、EAS CLI/profile、preview/production build/submit 命令、remote build number、OTA-off 默认、静态 release check、双语商店隐私草案、机器发布清单与两平台物理设备 E2E 证据门禁已建立。已知旧开发库的 `0006` 全零 checksum 兼容桥通过真实 iOS Simulator 无清库升级到 `0008`；EAS 解析到账号认证边界后因本机未登录停止。Expo projectId/owner、签名/商店账号、identifier 可用性、公开 Privacy Policy、开放决策、production build/submit 与物理真机证据均不能由 AI 填造，因此 Phase 10 不能正式标记 DONE。

`MUST / SHOULD / FUTURE` 仍只表示需求等级，不表示跨阶段 Requirement 已完整交付。当前技术基线不表示真实 Provider、已启用的个性化/Check-in 加权排程、Calendar/Notification 真实 OS 同步、物理设备 Relax E2E 或发布闭环已完成。

## Current Task

`TASK-OPT-NC-20261003` — 按已交付计划执行无需凭据的九个优化工作包。

**Status: IN PROGRESS — OPT-01/02/06 complete; OPT-03 host preparation; OPT-05 contract validation**

既有 `TASK-TECHNICAL-PLAN-001` 保持 COMPLETE WITH USER-AUTHORIZED EXTERNAL SKIPS：原本地子集 80/80 已完成，正式决策、真实 Provider/设备与发布授权仍开放。新增优化工作包独立跟踪，不算作已完成，也不改写原 Engineering Readiness。

## Implemented Baseline

### Repository Foundation

- 已初始化 Git 和 Bun `1.4.0` Monorepo；初始默认分支为 `main`，本轮可追溯提交状态见 Optimization Execution Status。
- `apps/mobile` 保持 Expo Development Build 骨架与 development / preview / production 配置；中性原生标识和 DEC-004 依赖基线不变。
- strict TypeScript、Prettier、ESLint、Vitest、架构检查、文档检查、Hermes bundle 检查和 GitHub Actions CI 已由 Phase 0 建立。
- 11 个职责包和 pure TypeScript / Hermes 依赖边界继续由静态检查守护。

### Phase 1 Domain & Application

- `domain` 已实现 Goal、Project、Task、CompletionRecord、TaskActivityEvent、OperationRecord、ScheduleState 和带校验的 ID / Instant / LocalDate / TimeZone 值对象。
- Task 支持 `inbox / planned / in_progress / completed / canceled` 状态不变量、普通字段更新白名单、估时与日期约束、首次排程/开始时的估时基线冻结，以及直接/祖先父子环检测。
- Goal / Project 支持创建、读取、更新与归档；Goal 进度按真实关联 Task 聚合、按 ID 去重，并排除 canceled 与已有子项的分组父 Task；无有效 Task 时不伪造百分比。
- `application` 已实现 Repository / UnitOfWork / Clock / LocalTimeProvider / IdGenerator Ports，以及 Task、Goal、Project 的 Zod 输入/结果边界和 Application Error 映射。
- TaskService 已实现创建、读取、普通更新、显式完成与取消。完成事务原子写入 Task、唯一 CompletionRecord、最小 TaskActivityEvent、OperationRecord 和版本；取消事务会关闭并 abandon 目标 Task 的活跃执行、取消关联 started/planned Block、维护必要 SchedulePlan/IntegrationJob，且不创建完成或成就证据。普通 patch 不能修改状态、实际耗时或完成证据。
- GoalService / ProjectService 已实现创建、读取、更新、归档、有界稳定列表及 Goal 进度查询；写操作采用同一 operationId 幂等协议。Mobile 可创建 Goal/Project、从两者拆出关联 Task、读取真实进度并两步归档，归档保留任务与历史。
- 相同 operationId、命令和参数摘要返回首次提交时的原始结果；相同 ID 配不同命令/参数显式返回 `idempotency_conflict`。参数只保存稳定 SHA-256 摘要，返回结果为支持精确重放而在本地 OperationRecord 中保存完整 mutation DTO snapshot。
- Task 调度相关字段变化及完成/取消递增 `stateVersion`；完成/取消若清理既有 Block，会同时推进 `planRevision`、建立 committed SchedulePlan 和两通道 durable IntegrationJob；没有 Block 变化时 planRevision 保持不变。

### Phase 1 SQLite

- Drizzle Schema 已成为已实现字段的机器事实源；首个 migration `0000_phase1_foundation` 建立 `goals`、`projects`、`tasks`、`operation_records`、`completion_records`、`task_activity_events` 与单例 `schedule_state`。
- migration manifest 带 checksum 与前缀历史校验；每个 migration 独立事务执行，失败时回滚该 migration 的 DDL/DML 和历史写入并安全停止。
- Schema 与 migration 包含 Task 状态、Duration、Deadline、父引用、终态时间戳、CompletionRecord 唯一性、外键及查询索引约束；当前不创建 TaskDependency 表。
- 已实现平台无关的最小 SQLite 执行接口、Repository 映射、事务作用域 UnitOfWork，以及 `expo-sqlite` exclusive transaction Adapter。
- 应用启动可先运行 migration，再获取 SQLite Application UnitOfWork；Node 内置 SQLite 仅作为集成测试 Adapter，不进入移动端 Domain/Application 边界。

### Phase 2 Schedule Domain and SQLite

- `domain` 已实现 TimeBlock、仅 committed 的 SchedulePlan、IntegrationJob 及其值对象与不变量。Task 类型 Block 强制关联 Task；SchedulePlan revision 为正整数；IntegrationJob 当前目标为 SchedulePlan，action 为 `reconcile`。
- `0001_phase2_schedule_commit` 按顺序追加 `time_blocks`、`schedule_plans`、`integration_jobs`，没有改写 `0000` SQL/checksum；Drizzle Schema、migration SQL、索引、CHECK、FK 和 unique 约束保持对齐。
- SQLite Repository 已实现 TimeBlock find/list/insert/update、SchedulePlan find-by-revision/insert、IntegrationJob insert/list-by-operation，并接入与 Phase 1 Repository 相同的 Application UnitOfWork 事务。
- Node SQLite 已验证从既有 `0000` 数据升级、重复运行、checksum、失败 migration 回滚，以及 Phase 2 FK/unique/check/state/plan revision 持久化；没有创建 TaskDependency。

### Deterministic Scheduler Core

- 已实现显式 `ScheduleInput → ScheduleResult`、严格运行时校验、`previewSchedule / replanSchedule`、稳定候选 key、warnings、unscheduled remaining effort、metrics 与 explanations。
- 硬约束覆盖有限 horizon/UTC 区间、Busy、Earliest Start、Deadline、工作窗口、不可拆 Task、min/max Block、locked/started/completed 历史保护与受保护未来投入扣减；无法完整排入时返回明确原因，不伪造完成或静默移动受保护事实。
- 软评分只消费版本化显式 policy；稳定性、碎片、偏好时段、完成率、能量匹配和恢复惩罚没有隐藏环境默认。集合输入会规范排序，平分决胜稳定；同一完整输入与算法版本产生相同结果。
- DST 测试使用 Adapter 已展开的显式 UTC 工作窗口，证明 Core 不依赖平台时区数据库；Phase 4 的 Hermes IntlTemporalAdapter 已在生产 Mobile Composition 接入。
- 依赖任务只支持显式 `unsupported_dependency` 结果，不声称已实现 TaskDependency；priority 排序仅来自显式 policy，schedulingPolicy 仍是不透明 key。

### Application Preview and Commit

- 已实现 SchedulingSnapshot、BusySnapshot、UTC Working Window、PreviewExpiration 和 IntegrationJobWakeup Ports，以及 Zod Preview/Commit 输入/结果边界。
- ScheduleService Preview/Replan 从一个一致性 Snapshot 构造 Core 输入；taskIds 只缩小任务关注范围，不丢失其他 Busy 或受保护 Block。Preview 不写 SQLite，也不触发外部同步。
- InMemory Preview Store 对写入和读取作隔离深拷贝并冻结受信数据；Commit 会重算 snapshot/result/diff，调用方篡改返回 preview 不会改变待提交内容。进程重启或 clear 后未提交 preview 返回 `preview_not_found`。
- Preview TTL 由显式 policy Port 注入，并受最早变更块开始和 horizon end 限制；过期、块将落入过去、Task/state/policy/timeZone/input hash 变化都会在写入前拒绝。
- 当前 Commit 只接受宿主注入的直接用户 authority；无变更 Preview 不可提交，自动提交分支尚未启用。
- Commit 在一个 SQLite 事务内写入 OperationRecord、committed SchedulePlan、TimeBlock create/update/cancel、必要 Task `inbox → planned` 与首次估时基线、calendar/notification 两个 pending IntegrationJob，并同时递增 stateVersion 与 planRevision；Task before/after 纳入 diff，任何晚期写入失败都会完整回滚。
- 相同 operationId/命令/参数先于 Preview 查找执行重放。首次响应丢失且内存 Store 已清除后仍可从 OperationRecord 精确恢复原提交，并聚合当前 Job 状态；不同参数显式返回 `idempotency_conflict`，不会创建第二份计划。
- 事务成功后只发送可选 best-effort wake signal；本地持久化 Job 是恢复源。Phase 3 已实现消费 worker，但只有宿主前台协调器被唤醒且权限/平台能力允许时才尝试 OS 同步；pending 不能描述为已经同步。

### Phase 3 Calendar / Notification Persistence

- Domain 已实现 ExternalCalendarEventSnapshot、CalendarRefreshCoverage、verified CalendarContainerBinding/CalendarBinding、NotificationBinding、可恢复 IntegrationJob 与 ExternalMutationIntent 的不变量和值对象。
- `0002_phase3_calendar_notifications` 以 SQLite rebuild 安全升级既有 IntegrationJob，并新增 Snapshot/Coverage/Binding 表；旧 pending 行按 `createdAt` 回填 notBefore，无法证明有效 lease 的旧 processing 行转为 reconciliation_required。Calendar container authority、nullable occurrence identity、notification `(timeBlockId, type)` identity、状态/CHECK/FK/index 均在 Drizzle 与 SQL 对齐。
- `0003_phase3_external_mutation_intents` 只追加 durable write-ahead intent 表，保持 `0000/0001/0002` SQL/checksum 不变。每个 IntegrationJob 和稳定 scope 各最多一个未解决 intent；父 Job 受 RESTRICT，payload JSON 必须是经过 Domain/Repository allowlist 校验的 canonical object。
- SQLite Repository 已实现完整/部分 Calendar refresh 所需查询、verified binding 的 revision-fenced upsert/delete，以及 IntegrationJob find/latest/claim/CAS/requeue。每通道未过期 processing claim 阻止并发，过期 lease 可重领，旧 token/attempt 不能完成；带未解决 intent 的可运行 Job 优先于普通 revision 队列。
- complete refresh 才能在一个事务内 upsert 已见实例、删除有界范围内未见旧实例并写 Coverage；partial 只合并观测。只有排除 verified App-owned event 后的有效 Busy 集合变化才递增 stateVersion，fetchedAt 单独变化不制造 Preview 冲突。

### Phase 3 Application, Adapters and Mobile Runtime

- CalendarService 已实现只读权限状态、显式前台权限请求、有限范围 Calendar/Busy 读取和 complete/partial Snapshot/Coverage 事务；后台路径不触发权限弹框。
- IntegrationService 已实现 Calendar/Notification 两通道 projection/reconciliation worker、当前同步状态、权限恢复、旧 revision supersede、claim/lease/retry fence，以及 Calendar provisioning 不确定时的直接用户确认恢复入口。
- 每次 Calendar provisioning/event create/update/delete 或 Notification schedule/cancel 前，worker 先用独立事务持久化 ExternalMutationIntent；OS 回读确认后，以同一 checkpoint 事务写 verified/pending binding 并删除 intent，再以 claim CAS 收口 Job。OS 已变更但本地 checkpoint 前崩溃时，下一次优先恢复通道最旧 intent；跨 Job/revision 的 scope 唯一约束避免盲目重复 create。
- Calendar/Notification Provider 的 owned-marker inventory 可发现本地 binding 丢失后的候选；partial/unknown 结果不推断外部对象不存在，重复身份、用户编辑 conflict 或无法证明 ownership 时保持可见 reconciliation_required。
- Expo Calendar Adapter 已实现权限映射、有限 Busy/重复实例读取、App Calendar provisioning、event marker/inventory 与 create/update/delete/reconcile；Expo Notifications Adapter 已实现权限、确定性 OS identifier、marker/inventory、schedule/cancel/reconcile。两者通过可注入 native facade 测试隔离平台边界。
- Mobile Composition Root 已在应用启动时打开并迁移 `expo-sqlite`，构造真实 Calendar/Notifications Adapter、CalendarService 与 IntegrationService；AppState active 时前台协调器并行按通道串行 drain，inactive 时不启动新工作并等待 in-flight 后关闭。Settings 授权成功后会立即 best-effort 唤醒已重新入队的通道，并为 `calendar_provisioning_unknown` 提供两步用户核对/释放 intent/再尝试入口；唤醒失败不掩盖 durable 提交。它没有常驻 daemon，也不会自动请求权限。
- 当前 Mobile Runtime 显式采用 DEC-012 关闭前的可替换保守基线：只投影 future planned task block，Calendar/Notification 使用 generic title、不含 Task description、默认不暴露 Task title，提醒 body=null、sound=false；提醒提前量缺偏好时为 `0`，直接用户可保存 `0–1440` 分钟覆盖值。Android source=null 时 Adapter 明确不创建 Calendar。这是实现基线，不是已接受的产品决策。
- ScheduleService 与 production SqliteSchedulingSnapshot 已接入 Mobile；Settings 提供用途说明、显式 Calendar/Notification 请求、忙碌来源选择、30 天有界 refresh、local-only、提醒提前分钟数和受控待核对恢复，Today 显示通道状态。提醒偏好变化与 stateVersion/当前安全 Notification Job 重排同事务，in-flight 版本变化由 claim 释放为 pending 再次收敛。真实 OS permission/account/source/readback/delivery/cancel/process-restart 仍未验证，因此尚不是完成的 Calendar/Notification 产品闭环。

### Phase 4 Today / Calendar UI

- `0004_phase4_user_preferences`、Drizzle Schema 与 Repository 已实现时区、工作时间、Busy 来源和 `notification.leadMinutes.v1` 偏好；PreferenceService 只接受直接用户写入，幂等记录与有效变化会推进 stateVersion，提醒值变化还会安全重排当前 Notification projection。
- IntlTemporalAdapter 在 Hermes 边界解析 IANA 时区、DST gap/fold、23/25 小时日界线、跨午夜工作窗口；统一 minute→pixel Timeline 几何按真实 UTC elapsed time 渲染。
- SqliteSchedulingSnapshotPort 在同一事务读取 ScheduleState、Task、TimeBlock、UserPreference 与 Busy cache，缺设置返回 `scheduling_setup_required`，不偷偷注入工作时间或 Calendar 来源默认。
- PlanningQueryService 提供 Today/Day Timeline、当前块、最多三个 Next、真实 CompletionRecord Wins、Calendar freshness 与同步状态；Mobile Runtime 已构造 Task/Preference/Schedule/Planning 服务并以 Commit wake durable worker。
- Mobile 路由展示 Today、Calendar、中央添加、成就与 Relax；另有 Task 编辑与两步取消、有界分页 inbox、Goal/Project 组织、Schedule Preview/显式 Commit、Focus、成就详情、Reflection 与 Settings。Today Header/缺估时 Empty State、候选 Task 卡和未来 Calendar Block 均可进入相应 Task 编辑页；Today 还有不依赖 Check-in/Reflection/Relax 的直接 Replan Preview 动作，Calendar 可按所选本地日 UTC 范围直接生成 Preview，权限/待核对状态可直达 Settings。Application 从同一 Snapshot 给变更/未排程/warning 附加只读任务标题；中文 Preview 以结构化 code 显示摘要、before/after、跨日日期、IANA 时区、Busy、Deadline、受保护块和原因，不暴露 Scheduler 英文内部诊断，也不将展示标题用作提交 authority。Calendar 的稳定 TimeBlock 使用遵循系统 Reduce Motion 的 Reanimated 位置/尺寸短过渡。
- TimeBlockAdjustmentService 从受信 SchedulingSnapshot 生成无写入 Preview，只允许未来未锁定 planned 块并复核 grid、工作窗口、Busy、Task 约束与版本；确认事务原子写入新 SchedulePlan、锁定块、OperationRecord、双通道 IntegrationJob 和两类版本。显式 unlock 建立另一计划版本，UI 不直接写 Repository。
- TimeBlock 调整页除触摸拖动/上下边缘缩放外还提供等价的 15 分钟无障碍精调按钮；Today/Calendar 的嵌套 ScrollView 使用显式 flex 约束，避免 Development Build 中内容高度为零。工作窗口 Adapter 会剥离仅属于本地时间展开过程的字段，只向 Scheduler 传递 exact `WorkingWindow` Contract。
- Capture/Task 编辑页已暴露最早开始、Deadline、splittable、min/max Block、category 与 energyDemand；本地日期/时间通过 IntlTemporalAdapter 按设备 IANA 时区转为 Instant，date-only Deadline 保留日期/时区但需补时刻才直接排程。表单拒绝 DST/顺序/块边界错误，并规范化 iOS 智能破折号与全角冒号。
- Capture/Task 编辑串联本地保存与 Schedule Preview 时会保留已提交 Task，并在后续 Preview 失败时明确区分两个结果，避免误报整体失败或诱导重复创建。
- Task 编辑已把预计总时长、显式剩余估时和只读实际投入分开，避免保存普通修改时互相覆盖；编辑后的“重新排程”调用 Replan，Preview 未排程项可直接返回对应 Task 修正。
- Expo SQLite Adapter 对同一连接上的 exclusive transaction 做 FIFO 串行化并在失败后释放队列；单元测试覆盖并发不重叠与失败恢复。

### Phase 5 Execution & Success Diary

- Domain 已实现 ExecutionSession、work/pause ExecutionInterval 与 Achievement，不变量覆盖 running/paused/completed/abandoned、finish_session/complete_task 分离、每 Session 最多一个开放区间、时钟倒退区间归零并标记 `needs_review`，以及 Achievement 必须追溯唯一 CompletionRecord。
- `0005_phase5_execution_achievements` 追加 Session/Interval/Achievement 表并安全重建 CompletionRecord 的 Session 外键；Drizzle 当前 Schema 与历史 Phase Schema 分开保持 migration 事实，SQLite 唯一活跃 Session、唯一开放区间与唯一成就来源均有数据库约束。
- ExecutionService 实现 start/pause/resume/finish/abandon、重启恢复、operationId 精确重放与原子状态迁移；finish_session 只结束 Session/关联块，complete_task 才完成 Task、创建一次 CompletionRecord、按用户选择创建 Achievement 并取消未来 planned Block，abandon 保留真实投入且不制造完成事实。
- TaskService 手工完成会在同一事务关闭该 Task 的活跃 Session/区间、聚合可信已记录投入、清理未来块并创建必要 IntegrationJob；默认无计时完成保持 unknown，有可信区间但未确认完整时为 partial，只有直接用户明确确认全部投入已记录才为 complete。Achievement opt-out 可由直接用户后续明确反转，Agent 不能自行推翻或声明完整投入。
- AchievementService 提供真实来源的日记查询、CompletionRecord/Task/Project/Goal 详情、标题/备注编辑与 hide/unhide；隐藏只影响默认回顾，不删除完成证据。
- Mobile Today 与 Task 页面可开始/恢复 Focus；低噪音 Focus 展示当前 Task、已记录投入、原估与剩余时间，并明确区分暂停、结束本次专注、需要更多时间并在结束 Session 后调用真正的 Replan、完成整个任务（记录/不记录成就、可选确认全部投入已记录）和暂时无法继续。只有新建 Session 首次导航携带的一次性信号会显示 10 秒 Mindful Transition；用户可立即跳过或在 Settings 关闭，信号接收后被清除，恢复/reload/Relax 返回不重复，展示不新增持久化执行状态。Replan 后续失败会保留并如实说明已保存的 Session；成就 Tab 支持今天/本周/本月/历史及隐藏记录恢复。

### Phase 6 Local Agent Runtime

- Pure `agent-core` 已实现 Hermes-compatible Agent Loop、完整/流式 Model Contract、有限 turns/tool calls/run timeout、Abort、Tool Registry、审批与风险控制、状态事件、完整 Tool Call JSON 后执行和成功收据复用；模型中断不会直接留下半次 Tool 写入。
- `agent-tools` 已将文档中的 15 个 V1 Tool 逐项绑定到 Application Service，输入/输出均经过严格 Runtime Schema；authority、authorizationId 与 operationId 由宿主生成，模型不能伪造。未知、无效和被拒 Tool 也计入预算；`external_sensitive` 不允许自动执行。
- `model-runtime` 已提供 complete/stream 适配、usage 与工具事件聚合、Abort 和脱敏 ProviderError，并以可脚本化 FakeModelProvider 覆盖确定性测试。真实 Provider 和生产凭据仍受 DEC-005 阻塞。
- `0006_phase6_agent_runs`、Drizzle Schema、SQLite Repository 与 AgentRunMetadataService 只保存 id、startedAt/endedAt、status、trigger、modelProvider、turnCount 与脱敏 errorCode；checkpoint 更新 turnCount，不持久化 tool 计数、消息、模型输出、Tool 参数/结果或秘密。重启可识别并收口中断的运行 metadata，不恢复完整聊天或未完成的模型回合。
- Task/Achievement 有界分页、Calendar cached Busy 隐私视图、Notification 当前 revision reconciliation 已补齐 Agent Tool 所需 Application Contract。Calendar Busy 只返回时间区间、freshness/completeness/truncated，不泄露外部事件标题或标识。
- 自然语言 Capture 已有非持久化 `capture.preview` 结构化边界，约束模型只基于当前用户文本生成待确认 Task draft 与不确定字段；Provider 未配置时 Mobile 保留原文并明确转入手工确认，不猜测日期、截止时间或时长。

### Phase 7 User Model & Replan Intelligence

- Pure `user-model` 已实现分类估时偏差、按计划本地小时的 Block 完成率、Session 均值/中位长度、显式用户 postpone/skip 频率与拆分 Block 完成率。观察窗口、algorithmVersion、mean/median 选择及每类满置信样本数全部由调用方显式提供；结果稳定排序并报告排除计数，没有环境时钟、时区数据库、存储或生产参数默认。
- Domain 已实现 UserModelFeature 与稳定 identity；`0007_phase7_user_model_features`、Drizzle Schema 和 SQLite Repository 实现同 algorithmVersion 的原子缓存替换、稳定 ID 复用、范围/有限数/样本/置信度/唯一性约束，以及 ExecutionSession/TaskActivityEvent 的有界事实读取。
- UserModelService 在一个 UnitOfWork 事务中读取 ScheduleState、Task、CompletionRecord、结束 Session/Interval、TimeBlock、SchedulePlan 时区与 ActivityEvent，重建并替换版本化缓存；snapshot 只有在存在特征且全部 sourceStateVersion 等于当前状态时才 fresh，缺个性化偏好按关闭处理。
- TaskService 与 ExecutionService 的完成 Contract 新增可选 `allEffortRecorded`。只有直接用户确认才把可信记录投入（包括明确零投入）标为 complete；否则保持 partial/unknown，Agent authority 尝试声明会被拒绝。Task/Focus 页面提供默认关闭且有解释的确认控件。
- `personalization.enabled.v1` 是严格 `{ enabled: boolean }` 偏好并只允许直接用户写入；SchedulingSnapshot 在同一事务把开关和缓存特征交给 policy。DEC-007 未关闭前 Mobile 不能从 false 启用，production policy 返回空特征窗口且 completion-rate 权重为 `0`；测试证明已有高置信缓存也不改变当前计划。

### Phase 8 Reflection, Check-in & Relax

- Domain 已实现 DailyReflection、EnergyCheckIn 与 RelaxSession 不变量及 ID 值对象：Reflection 最多三个唯一 CompletionRecord 证据，Check-in level 为 1–5，Relax 明确 active/completed/abandoned、1–60 分钟计划和 trusted/needs_review 实际区间。
- ReflectionService 只接受直接用户刷新，在指定本地日的同一事务中读取 CompletionRecord、重叠 Task TimeBlock 与活跃 Task，离线生成真实完成/计划块状态摘要、Wins 和下一步建议，并保留用户备注；刷新不改变排程版本、不调用模型。
- EnergyCheckInService 按记录时刻的 LocalTimeProvider 固定 localDate/timeZone，追加主观精力事实并推进 stateVersion；SchedulingSnapshot 只读取捕获时刻之前最新一条交给 policy。当前 production neutral policy 不应用该信号，不声称低精力已改变排程。
- RelaxService 提供 get/getActive/list/start/end、幂等 OperationRecord、单 active 与晚期失败回滚；实际秒数来自注入时钟，倒退钳制为 0/needs_review，completed 与 abandoned 分开且都不创建任务完成事实。
- `0008_phase8_wellbeing`、Drizzle Schema 与 SQLite Repository 已实现本地日唯一 Reflection、按日/时刻 Check-in 查询、单 active Relax、生命周期/范围/文本/JSON 约束及 `0007 → 0008` 升级。
- Mobile 已加入 Relax Tab、Reflection 页面、Today 五级 Check-in/Relax/复盘入口、Focus 暂停后进入 Relax/结束后恢复、完成后的开始任务/再休息/调整今天，以及 Settings 两个可选入口开关。环境声入口当前使用离线静默模式，不请求音频权限；所有固定文案保持非医疗边界。

### Phase 9 Reliability & Offline

- Application 新增 Calendar/Notification 有界 Provider wrapper，Timer 由宿主注入，保持 pure package 不依赖全局 timer 或 Node/Expo。Mobile Runtime 统一使用 `providerCallTimeoutMs = 15_000`。
- Provider 超时公开为脱敏 `provider_timeout`；permission/list/inventory/reconcile 等只读超时收口为可延迟重试的 failed Job，permission request 与 create/update/delete/schedule/cancel 超时视为外部结果不确定。
- Calendar provisioning 写超时测试证明 ExternalMutationIntent 在调用前落盘、Job 保持不可盲目自动重试的 `reconciliation_required`，后续 worker 不会再次调用 create；Notification 只读卡死不会无限阻塞前台 drain。
- 新增文件型 SQLite 组合故障场景：连续关闭/重开真实连接，重复执行全部 `0000 → 0008` migration；Schedule Commit 响应丢失、Execution running/paused、Completion/Achievement、Reflection 与 Relax active/terminal 均可恢复并精确重放。
- 组合场景最终只有一份 Session/CompletionRecord/Achievement/Reflection/Relax 和九份唯一 OperationRecord；三次 Plan revision 产生的六个 Calendar/Notification Job 在离线状态持续 pending，本地状态与完成事实不回滚、不丢失。

### Phase 10 Build & Release

- 移动端版本已从占位 `0.0.0` 提升为首个 Beta 技术基线 `0.1.0`，iOS buildNumber 为 `1`、Android versionCode 为 `1`；development/preview/production 保持独立 display/scheme/bundle/package identity。
- 根工作区精确锁定 `eas-cli 24.3.0`；`apps/mobile/eas.json` 定义 development client、internal preview、production store build 与 Android internal/draft submit，三套 EAS environment 显式传入非 Secret `APP_VARIANT`。
- production 使用 EAS remote appVersionSource 与 autoIncrement，避免重复 developer-facing build number；首次关联已有商店记录仍须授权发布者核对远端初值。
- DEC-008 未关闭时 App Config 对三个 variant 全部显式 `updates.enabled = false`，EAS 不配置 OTA channel，不以字符串配置偷跑 production OTA。
- 新增 `release:check` 并纳入 `bun run check`：校验版本、profiles、独立 identity、无 Secret-like committed env、OTA 默认、双语隐私草案、release checklist 与明确外部 pending gate；`build:check` 先解析三套 Expo Config，再导出 production iOS/Android Hermes bundle。
- 新增 preview/production build、submit 与 `release:gate` 命令；`test:e2e` 只有在物理 iOS/Android 的 E2E-001 至 E2E-005 均附证据并通过时才成功，模板的 pending/placeholder 或模拟器证据都会失败。
- `release/store-privacy.json` 按当前二进制明确本地数据、Calendar 边界和未启用的远程模型/云同步/OTA/数据库加密/导出恢复，并保留产品、法律、Privacy Policy 与平台问卷审核；没有伪造通过状态。
- migration 启动器新增唯一的预发布兼容桥：仅识别 `0006_phase6_agent_runs` 的全零占位 checksum，在其他历史全部正确且真实表/索引精确匹配固定 SQL 后事务性修复；成功保留数据、缺索引、任意其他错误 checksum 与其他历史损坏均有 Node SQLite 回归。
- iOS 26.5 / iPhone 17 Pro Simulator 的真实旧开发库已在不 reset 的情况下从占位 `0006` 修复并继续应用 `0007/0008`，SQLite integrity 为 `ok`，原有 Task/Completion/Achievement 仍可见；随后完成 Relax 呼吸入口、真实 25 秒 completed/trusted 记录和返回 Today 冒烟。

### Pre-decision Task Defaults

- 创建 Task 未传值时，Application 当前使用 `priority = "normal"`、`splittable = false`、`schedulingPolicy = "flexible"`。
- 这些值只是 [DEC-011](../docs/DECISIONS.md#dec-011) 关闭前的实现基线。Domain/SQLite 把 priority 与 schedulingPolicy 当作非空语义字符串；Core 只读取显式 `priorityRanks`、按传入的 splittable 布尔约束排程，不赋予 schedulingPolicy 隐含语义。测试固定 policy 不是已接受的产品词表、默认排序或自动拆分授权。

## Verification Evidence

最新仓库验证日期：2026-10-03。下方 Simulator / 原生构建与授权环境历史证据仍为 2026-09-12，本次分析未重新执行原生构建、连接真机或检查 EAS 登录。

### Latest Repository Gate Snapshot

```text
bun run check
PASS
```

最新完整快照覆盖：

- unit：51 个测试文件、414 个测试；
- integration：19 个测试文件、79 个测试；
- format、lint、根工程与 pure package typecheck；
- 11 个包的架构边界；
- 文档结构与引用；
- 静态发布配置检查（5 个外部门禁仍为 pending）；
- iOS / Android Hermes JavaScript bundle export。

2026-10-03 项目分析重新执行完整 `bun run check`，全部通过且测试计数不变；另执行 `bun run test:e2e`，因未设置 `NEXTA_IOS_DEVICE_EVIDENCE` / `NEXTA_ANDROID_DEVICE_EVIDENCE` 返回 exit code 1。这是缺少经审核物理设备证据，不是已执行设备旅程后发现功能失败；本次没有执行 production build/submit 或声明 release gate 通过。

Task 取消事务、收件箱/未来块编辑可达性、Goal/Project、integration user-action wake/恢复与 Canonical Docs 同步后完整 `bun run check` 通过；最新门禁结果见本节计数。严格 `bun run release:gate` 也已实际执行：代码聚合门禁通过后，按设计在缺少 `NEXTA_IOS_DEVICE_EVIDENCE` / `NEXTA_ANDROID_DEVICE_EVIDENCE` 的物理设备证据入口失败；没有把 Simulator 或 Bundle 结果冒充真机通过。2026-09-12 再次只读复核显示 `eas whoami --non-interactive` 为 `Not logged in`，Xcode 仅枚举本机与 Simulator，且主机未安装 `adb`；因此当前不存在可用于云端签名构建或填写双平台真机验收的已授权环境。

Phase 1 证据继续覆盖 Task 状态/Duration/Deadline/日期时区/父子环、Goal 聚合、Zod 严格输入、幂等冲突与精确重放、唯一完成证据、事务故障注入回滚、`0000` migration/Schema，以及 Goal/Project/Task 到完成事实的 SQLite 纵向集成。取消新增覆盖 inbox 无 Block、运行中 Session/Interval 与 started/planned Block 原子收口、计划/同步作业建立、无完成/成就证据、精确重放及晚期失败全回滚；真实 SQLite 另验证持久化 planRevision/`task_cancel` SchedulePlan/双通道 Job。

Mobile Task 约束测试覆盖 Asia/Shanghai 本地时间转 Instant、date-only Deadline、智能标点规范化、字段回填、时间反转与块边界拒绝；iOS Simulator 真实 Expo SQLite 另保存了 45 分钟、可拆分、`2026-09-14 08:30` 最早开始与 `2026-09-15 18:00` Deadline，并回读到正确 UTC Instant。

Goal/Project 查询测试覆盖默认隐藏 archived、includeArchived、goalId 过滤、有界 cursor 与非法 cursor；真实 Node SQLite Repository 覆盖稳定 listAll 映射。iOS Simulator 真实 Expo SQLite 已验证创建 Goal → 创建 Project → 从 Goal 创建关联 inbox Task → 进度 `0/1 · 0%`，无 Task 时则显示“暂无可汇总任务”。

Phase 2 单元证据覆盖 Scheduler 严格边界、CASE-SCHED-01 硬约束/可解释部分排程、CASE-SCHED-02 受保护事实/稳定性、DST 显式 UTC 窗口、随机确定性不变量，以及 Application Preview 隔离、TTL/no-op、授权、版本冲突、Task planned/baseline 原子联动、create/update/cancel diff、late failure rollback、wakeup failure 和 operationId 恢复。

真实 Node SQLite 纵向 CASE-COMMIT-01 覆盖 Task → 一致性 Snapshot → 零 DB 写 Preview → 原子 Commit → SchedulePlan/TimeBlock/两个 IntegrationJob/两类版本；还验证 Task 排程输入变化后的旧 Preview 冲突、过期、Store clear、返回 Preview 被调用方篡改、第二个 Job 写入失败全回滚，以及响应丢失后在 Preview 已清除时精确重放且不重复写入。`0001` 集成另覆盖从 `0000` 升级、重复执行、checksum/历史、失败回滚、Schema 约束/index/FK 与 Repository 映射。

Phase 3 Application/Adapter 单元证据覆盖 Calendar complete/partial/乱序 refresh 与有效 Busy stateVersion、权限只由前台请求、两通道 projection/reconciliation、旧 revision、claim/lease/retry、owned-marker inventory、未知/冲突结果、write-ahead intent 准备/恢复/checkpoint、Calendar provisioning 的显式用户恢复，以及 Calendar/Notification native facade 对权限、identity/marker、重复实例、有限查询和 partial/unknown inventory 的严格映射。新增证据覆盖 `0–1440` 提醒 Schema、用户覆盖/宿主默认、当前安全终态 Job 重排、processing/intent 保护和 Provider 调用期间 stateVersion 改变后的准确 claim 释放。Mobile 单元证据覆盖保守 projection 隐私/lead/source 规则，前台协调器 inactive 不消费、wake 合并、`pending` 再收敛、按通道 drain、终止等待与循环上限，以及 Calendar/Notification 授权和 Calendar provisioning 用户确认后先提交事实再 best-effort wake 的宿主接线。

iOS 26.5 Simulator 已在既有真实开发库上重新加载本轮 JavaScript，并确认 Settings 在 Calendar/Notification `not_determined` 与既有 15 分钟提醒偏好下正常读取和渲染；Today 的独立“重新规划今天”已进入未提交 Preview。新生成的 Preview 实际显示 Snapshot 任务标题、调整前后日期时间、新块日期时间、结构化原因、`Asia/Shanghai`、Busy 未配置、Deadline 无不足警告、受保护块说明及带任务标题的缺失估时原因。Calendar 新 Reanimated 容器仍正确暴露 `2026-09-14` 的 TimeBlock 和读屏动作，前/后一天有语义标签；从该日期点击“重新规划这一天”也成功进入只含该日范围的 Preview。Calendar 的本周日期条又在真实页面显示 2026-09-07 周一至 09-13 周日、正确标记 09-12 为选中项，并在点击 09-13 后切换 Day Timeline 和选中语义；该读取/导航验证没有提交计划或改写任务事实。未来 planned 块的读屏动作现明确为“调整…计划中…09:00 开始”，点击后仍正常进入完整调整页；非未来 planned 块则由同一结构化判定保持只读，未伪造尚无对应样本的模拟器交互证据。未点击调整 Preview/Commit，也未伪造 `calendar_provisioning_unknown` 的 OS 状态；Reduce Motion 的切换效果与两步恢复故障分支仍待真实设备验收。

同一 Simulator Preview 的未排程 `Linked Goal Task` 已显示“编辑任务并重新预览”并成功进入对应 Task 页面；页面分别渲染空的预计总分钟、只读“实际投入未知”、空的显式剩余分钟及派生规则说明，没有保存或篡改任务事实。Focus “需要更多时间”改用 Replan 的代码路径通过类型与 bundle 门禁，完整交互仍归入物理设备 Phase 5 验收。

iOS 26.5 Simulator 又在缺少 `focus.mindfulTransition.enabled.v1` 偏好的真实开发库上确认 Settings 将“新建专注时显示 10 秒过渡”呈现为默认开启；从 Today 新建 Session 后实际显示任务标题、固定过渡文案、10 秒倒计时与“立即开始”，点击可立即进入计时。一次性导航信号随后已清除：Development Build reload 后从 Task 恢复同一 active Session 直接显示 Focus 计时，没有重复过渡。Settings 另实际保存关闭值，新建 Session 随即直接进入 Focus 而不显示过渡；验证结束后已恢复并回读 `{"enabled":true}`。两个测试 Session 都使用“结束本次专注，任务未完成”保存真实区间，SQLite 最终回读 active Session 数为 0；没有完成 Task、生成 Achievement、提交排程或请求 OS 权限。该 Simulator 证据仍不替代物理 iOS/Android 的进程终止与交互验收。

同一 Simulator 真实结束 31 秒专注后曾暴露 `29.483333333333334 分钟` 的展示缺陷；Mobile 现统一将 Today 候选/当前时间块、Focus、Task 与 Inbox 的非整数估时/剩余/实际分钟格式化为“约 N 分钟”或“少于 1 分钟”，Today 已实际回读为“约 29 分钟”。底层 Session/Interval 与 Task 精度没有被展示舍入改写。

真实 Node SQLite Phase 3 集成覆盖 `0000 → 0001 → 0002 → 0003` 升级、固定 checksum、重复运行、late migration rollback、Drizzle/SQL CHECK/FK/index 对齐、nullable occurrence 唯一性、complete/partial refresh、verified binding revision fence、permission/single-job requeue、偏好触发的 current-revision safe-terminal requeue、过期 claim/CAS 旧 worker拒写。ExternalMutationIntent 纵向故障用例还验证 job/scope 双唯一、canonical payload、父 Job RESTRICT、旧 intent Job 优先领取、OS 调用后本地 checkpoint 失败时 intent 留存、binding+intent 删除同事务回滚，以及回读后不重复 create 并清除 intent。

Phase 4 单元证据覆盖 UserPreference JSON/权限/幂等、提醒提前量范围与 durable wake、SqliteSchedulingSnapshot 设置缺失/Calendar freshness/App-owned event 排除、DST gap/fold 与 23/25 小时日界线、跨午夜工作窗口、Timeline/手势吸附几何、Today 当前/候选/Next/Wins 语义、TimeBlock 调整/锁定/解锁事务、安全错误文案，以及 Expo SQLite exclusive transaction 串行/失败释放；Node SQLite 集成覆盖 `0004` upgrade/restart/rollback/约束及 Schedule→手工调整→解锁三次计划版本。Mobile UI 已同时通过 iOS/Android Hermes bundle；iOS Simulator Development Build 完成核心点击链路、等价无障碍精调和 15 分钟提醒偏好保存/重载，物理设备触摸手势与 Android 运行仍未验收。

Phase 5 单元证据覆盖 Session/Interval/Achievement Domain 不变量、CASE-EXEC-01 多块任务语义、CASE-EXEC-02 暂停重启恢复/活跃冲突/时钟异常/事务晚期失败全回滚、CASE-ACH-01 唯一来源/opt-out/用户反转/编辑/隐藏、TaskService 手工完成活跃 Session，以及 Mindful Transition 仅对新建 running Session 启用、10 秒边界和直接用户开关持久化。Node SQLite 集成覆盖 `0000 → 0005` 数据保持、checksum、Drizzle/SQL FK/unique/check 对齐与 production Repository 的完整 start/pause/restart/resume/complete/Achievement 链路。

Phase 6 单元证据覆盖 CASE-AGENT-01/02/03/04 与 CASE-PRIVACY-01 的技术子集：有限循环与 Tool 预算、Abort/timeout、流式 Tool JSON 完整后执行、Schema/Risk/Approval/宿主授权、成功收据重放、错误脱敏、Context allowlist、15 个 Tool Contract、Fake Provider、自然语言 Preview 边界与 AgentRun 生命周期。真实 Node SQLite 集成覆盖 `0000 → 0006` 升级、checksum/restart/rollback/约束，以及最小 AgentRun metadata 持久化且不保存消息或 Tool 内容。

Phase 7 单元证据覆盖 CASE-MODEL-01 的技术子集：五类行为统计公式、显式窗口/算法/置信 policy、未知/部分/待核对样本排除、直接用户完整投入声明与 Agent 拒绝、系统 replan 与用户 skip 分离、稳定重建/新鲜度、个性化缺省关闭，以及缓存高置信特征不影响当前中性 Mobile policy。真实 Node SQLite 集成覆盖 `0000 → 0007` 升级、checksum/restart/rollback/约束、UserModelFeature Repository 映射、同算法缓存替换与事务失败回滚。

Phase 8 单元证据覆盖 CASE-REFL-01、CASE-CHECKIN-01、CASE-RELAX-01 与 CASE-PSY-01 的技术子集：Reflection 只引用 CompletionRecord/TimeBlock 事实并保留备注、Check-in 的本地日/时区与直接用户权限、Relax 真实区间/时钟倒退/单 active/结束幂等，以及晚期 stateVersion 写失败全回滚。真实 Node SQLite 集成覆盖 `0007 → 0008` 升级、固定 checksum、Reflection/Check-in/Relax Repository 映射、JSON/文本/level/lifecycle/单 active 约束和事务回滚；SchedulingSnapshot 集成验证未来 Check-in 被排除、仅把 now 之前最新记录交给 policy。iOS Simulator 已完成 E2E-005 路径冒烟并保存 25 秒 completed/trusted 事实，但仍无物理设备证据。

Phase 9 单元证据分别注入永不 settle 的 Calendar/Notification Promise，验证 15 秒生产边界可配置、只读超时延迟重试、写超时保留 durable intent 且不重复 provisioning。文件型 Node SQLite 组合集成在五个进程代次中验证全量 migration 重入、Schedule Commit 和 Execution/Reflection/Relax 的 operationId 精确重放、running/paused/active 状态恢复、Completion/Achievement 唯一性、三次计划版本与六个离线 pending Job 保持。E2E-001 至 E2E-005、真实 Provider/OS 强杀和长期运行仍无物理设备证据。

Phase 10 自动化证据覆盖 App Config 三套 variant、版本/build number、独立 identity 与 OTA-off；静态发布检查覆盖 EAS CLI/profile/environment、无 Secret-like env、remote autoIncrement、submit profile、隐私草案与外部门禁。migration 集成新增已知 `0006` 占位标记安全修复与三类拒绝路径；iOS Simulator 在原真实库上完成无清库 `0006 → 0007 → 0008`、integrity `ok`、已有事实保留及 Relax 冒烟。EAS CLI `config` 实际执行已找到 monorepo CLI 和 `apps/mobile/eas.json`，随后在需要 Expo 用户账号时停止；因此没有声称 project link、cloud build 或 signing 通过。`test:e2e` 已建立严格双物理平台证据入口，但当前因无审阅文件保持未执行/未通过。

该门禁证明当前代码、Node SQLite 事务、production Snapshot 组合和 Hermes bundle 可构建；iOS Simulator 另证明真实 Expo SQLite、本地核心 UI 与权限阻塞状态。它仍不证明物理设备触摸手势、Android 运行或 OS Calendar/Notification 行为已验证。

### Phase 0 Native Build Evidence

- DEC-004 依赖组合保持锁定；`expo install --check` 无版本偏差，`expo-doctor` 21/21 checks passed。
- iOS 26.5 / iPhone 17 Pro Simulator：Development Build 重新编译、安装、启动通过；早期实际执行到 `0005`，本轮又从旧开发库 `0006` 全零占位标记无清库升级并验证完整 `0000 → 0008` 历史与 integrity `ok`。Phase 4 的 Task/偏好/计划/调整/锁定/重启数据保持，并实际保存 `notification.leadMinutes.v1 = 15`：stateVersion 从设置事务推进，当前 notification job 被安全重排后在未请求权限状态收口为 `permission_required`，没有伪造 OS 成功；Phase 5 又实际验证直接开始、暂停、App reload 后暂停恢复、继续、明确 complete_task、真实 Achievement、秒级部分投入展示、标题编辑、hide/unhide 及再次 reload 后 Today Wins/完成证据保持；Phase 8 完成 Relax 呼吸入口、25 秒真实 completed/trusted 区间与返回 Today。未请求的 OS 权限仍保持可见阻塞状态。
- Android arm64-v8a Debug Development Build 与默认四 ABI 编译通过；主机无 Android emulator/device，因此未宣称 Android 安装或页面运行 smoke 通过。

Mobile Runtime 已在 iOS Simulator Development Build 完成真实 `0000 → … → 0008` migration、已知预发布历史修复、事务写读与既有事实保持 smoke；Android 与物理设备仍无同等证据，完整 SQLite 纵向故障注入证据继续来自 Node 内置 SQLite 集成测试。

## Known Limits / Follow-up

- [DEC-006](../docs/DECISIONS.md#dec-006) 仍为 Open：Phase 1 不能正式 DONE，Phase 2 也不能把依赖任务描述为受支持。当前 `0000/0001` 无 TaskDependency 表/Repository/Service/Tool，Core 明确返回 unsupported。
- [DEC-011](../docs/DECISIONS.md#dec-011) 仍为 Open：生产 priority 词表/排序、splittable 正式默认、schedulingPolicy 词表/语义及 policy 映射尚未定稿。技术测试中的显式 policy 不构成产品决定。
- [DEC-012](../docs/DECISIONS.md#dec-012) 仍为 Open：哪些 Block 投影、Calendar/Notification 标题/正文、产品推荐的提醒默认/预设、Android source/account 与声音/振动/channel 尚未正式定稿。Mobile 已允许直接用户配置 `0–1440` 分钟覆盖值，缺失时保守默认 `0`；这仍是可替换的生效前基线，不代表产品接受。
- [DEC-007](../docs/DECISIONS.md#dec-007) 仍为 Open：生产统计窗口、分类、满置信样本数、启用阈值和 Scheduler 权重尚未评审。Phase 7 已实现可显式配置的统计/缓存/接线边界，但 Mobile 不允许开启，Scheduler 保持中性，也没有自动重建策略。
- 生产 SqliteSchedulingSnapshot、工作窗口/DST 与显式 neutral policy 已接入 Mobile Composition Root；当前 DEC-011 未关闭，因此 neutral policy 不代表定稿。真实设备 Busy cache、时区数据库与长期运行仍缺验证。
- CASE-SCHED-03 跨越 Scheduler 与后续 UI：Phase 2 已实现受保护块、过期/临近开始拒绝和确定性 Preview/确认路径；iOS Simulator 已验证 15 分钟移动、Preview、提交后锁定与显式解锁，物理设备拖动、迟开始与跨天交互仍待验收。DEC-002 未关闭前不启用自动提交。
- Calendar/Notification worker、权限协议、回读核对、binding、complete/partial refresh、ExternalMutationIntent 与仅前台 Mobile drain 已实现；Settings/Today 已接权限、Calendar 选择、有界 refresh、同步状态、授权后立即 wake 和 Calendar provisioning unknown 两步恢复，Schedule Commit 也会 wake durable worker。真实设备创建/修改事件或投递/取消通知仍无证据，不能把 native facade 测试描述成 OS 已工作。
- `expo-sqlite` Adapter 和 Mobile startup 已在 iOS Simulator Development Build 验证 migration、事务写读与重启持久化；Android/物理设备仍无等价证据，不能把 iOS Simulator、Node SQLite 或 bundle 通过外推为所有设备均已验证。
- ExternalMutationIntent 关闭了“OS 已变更、binding 未写入”时的盲重试窗口，但不提供跨 SQLite/OS exactly-once。Calendar provisioning 无可靠回查时会持久保留待核对 intent，必须由用户确认缺失后释放；真实平台 marker/readback 与进程终止恢复仍须设备故障注入。
- Clock/Preview 会校验规范 UTC、TTL 与“新块不落入过去”；Execution 的区间结束早于开始时会钳制到开始时刻并标记 `needs_review`，不生成负耗时或虚假精确投入。其他 mutation 的全局时间戳单调化仍未定义，不能从 Execution 的局部保护外推为完整墙钟回拨策略。
- OperationRecord `resultJson` 保存完整 mutation DTO，Schedule Commit 的 `diffJson` 保存 Block 与 Task 变更前后快照。它们只留在本地业务 SQLite，用于精确重放/恢复，不得默认进入日志、LLM Context 或无关 Tool；保留/清理仍须与幂等、Undo/完成证据和 DEC-009 一起设计。
- 手工完成无 Execution 计时证据且未确认完整覆盖时，CompletionRecord 保留 `actualDurationSeconds = null` 与 `durationCoverage = unknown`；有可信记录默认 partial。直接用户可明确确认全部实际投入均已计时，Agent 不能代替；预计时长始终不冒充实际耗时。
- UI 已能完成手工 Task → 本地排程 → Focus 执行/恢复/Relax → 明确完成 → 成就回顾 → Reflection 的离线闭环，并提供可关闭 Check-in、调整今天 Preview、Agent 自然语言输入的明确手工降级入口与默认关闭的个性化说明；主机自动化组合可靠性已覆盖，但真实模型 Provider、启用后的个性化/Check-in 权重、物理设备 E2E、真实 OS 故障和发布能力仍属于开放范围，当前能力还不是完整 App。
- NativeWind `5.0.0-preview.4`、lockfile registry、Android 发布权限/备份、受控 AbortSignal 等既有 follow-up 继续有效；发布数据政策仍受 DEC-009 约束。
- EAS CLI 与 profiles 已配置，但当前无 Expo 登录/projectId/owner、Apple/Google 签名和商店账号；neutral `com.personalexecution.agent` identifier 的可用性也未验证。任何 placeholder 或本地主机身份都不能提交到仓库冒充授权配置。
- `release/store-privacy.json` 仍是 draft，缺公共 Privacy Policy URL、法律/产品批准和基于最终签名二进制的 Apple/Google 问卷；当前明确不宣称业务 SQLite 已加密、可备份或可导出恢复。

## 2026-10-03 Project Analysis

- 分析范围：对照 Context/Plan/Status、产品与需求、架构/Contract/安全/验收/发布文档，核对 Mobile Composition、Capture、生产 scheduling policy、Agent/Model Runtime、质量脚本与 Git 状态；不修改业务代码或代替负责人关闭 Open Decision。
- 当前实际能力是手工任务、确定性本地排程、执行/完成/成就与离线回顾闭环。Agent 的纯核心、15 个 Tool 和自然语言 Preview 边界存在于包与 Node 测试中，但 Mobile Runtime 未构造 Agent/Model Provider，也未调用 NaturalLanguageCapturePreviewer；Capture 当前固定使用原文转手工表单。SecureStore 已作为原生依赖/plugin 配置，尚无应用凭据存取或配置流程。
- MobileNeutralSchedulingInputPolicy 把所有 priority 设为同一 rank，所有软评分权重为 0，且不消费 User Model/Check-in 特征；因此核心支持显式软评分不等于生产个性化已启用。Agent 当前未接入 App，双平台 Hermes export 也不能证明 Agent 的真实 Hermes/Provider 执行已验证。
- 既有 Engineering Readiness 清单计数复核为 80 已完成、21 未完成。80/80 只描述既有授权排除外部阻塞后的子集，不等于 V1 产品完成率；Open Decision 解除后仍需要真实 Provider Adapter、Mobile Agent/凭据接线、生产 policy 与特征刷新等实现工作，不能把剩余任务描述为只需填账号和补证据。
- 分析时 Git 为 main 无首次 commit，`git ls-files` 与 `git remote -v` 均为空；CI workflow 已存在但当时本地检查不是远端 CI 执行证据。应建立经过敏感文件审阅的可追溯基线，再推进后续实施；该次分析未自行提交或配置远端，后续目标实施记录见 Optimization Execution Status。
- 测试主要证明 Node 单元逻辑、真实 Node SQLite 事务/恢复、注入 native facade 与 bundle 能构建；UI 组件、物理触控、后台/强杀、真实 OS 权限/投递和长期资源行为仍需各自验收。`test:e2e` 是设备证据文件校验器，不是自动执行移动端旅程的测试驱动。
- 后续优先级建议：先建立 Git 基线和首批试用标准；按 DEC-005 决策交付真实自然语言到 Preview/Commit 的纵向链路；在双物理平台验证 Calendar/Notification、升级与进程恢复；随后按 DEC-007/011 启用可解释的生产策略，并完成隐私、签名和商店发布门禁。此建议不替代产品价值判断或接受任何未决参数。
- 本次 Documentation Impact Assessment：Product、Requirements、Architecture、Data Model、API/Contracts、UI/UX、Development、Testing、Security、Build/Release、ADR、AI Context、Implementation Plan 均无规范或范围变化；Status 更新验证日期、分析证据、AgentRun metadata 描述与下一步边界。已有完成勾选、外部跳过和正式 Phase Exit 保持原状态。

## 2026-10-03 External Reference Research

- 研究范围：查询相近产品的官方文档与公开 GitHub 项目，阅读 README、License 和选定源码/测试；Super Productivity、Smart Agentic Calendar、Pi、Tasks.org 的只读浅克隆位于仓库外的临时目录，未安装其依赖或运行外部项目，不将文档、测试断言或活跃度当作 Nexta 的运行证据。
- 产品对照：[Motion](https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/how-auto-scheduling-works-behind-the-scenes) 提供截止风险与排不下的反馈；[Reclaim 2.0](https://help.reclaim.ai/en/articles/15280604-reclaim-2-0-faq) 将 Assistant/MCP 变更暂存后审查应用；[SkedPal TimeMaps](https://docs.skedpal.com/time-maps/introduction-to-time-maps) 使用显式分类时间窗口；[Sunsama Daily Planning](https://help.sunsama.com/docs/usage-guides/daily-planning/) 将计划工作量与可承受负荷对照。可借鉴可行性解释、整体 Preview、直接用户偏好和轻量每日规划，不因此接受后台 Agent、外部 Calendar 事实源或未经授权的工作窗口扩张。
- [Super Productivity](https://github.com/super-productivity/super-productivity)（MIT；检查版本 `8eef049de5c80bf2dc8be7e49236c0107af79a4a`）可借鉴 Focus 暂停后停止计时、移动滚动与拖动区分、时区转换等行为回归场景；其 Angular/Electron/Capacitor 实现不是 RN 模块。
- [Smart Agentic Calendar](https://github.com/fbdo/smart-agentic-calendar)（MIT；检查版本 `6088e957e17eda94fd362f8e420510827b5ed858`）可借鉴评分分解、变更合并、属性测试与排程性能场景。其 scheduler 直接依赖 Repository，采用 Node/SQLite/MCP 宿主，不能整包导入 Pure scheduler-core；测试中的性能阈值与默认权重也不构成 Hermes 测量或产品 policy 决策。
- [Pi](https://github.com/earendil-works/pi)（MIT；检查版本 `a276dabe57911253350bffb93cb7d7aff6a73261`）延续 ADR-0004 的轻量 Agent 参考方向：Provider 边界、Context 转换、Abort 与工具执行 Hook 可供对照。当前 CLI/工具链要求 Node，不能据此替换自有 Hermes-compatible runtime，也不能沿用默认并行工具执行或 Coding Agent 权限。
- [Tasks.org](https://github.com/tasks/tasks)（GPL-3.0；检查版本 `1221b1ad7bfe95cd6877fcd4700e37a260230a7f`）可借鉴提醒权限恢复与原生通知回归场景；其[备份文档](https://tasks.org/docs/backups/)也说明 App 私有目录备份随卸载删除的风险。建议在真实试用前优先评审 DEC-009 的数据恢复边界；源码复制须按具体文件许可评估，本次仅分析行为设计。
- [Maestro](https://github.com/mobile-dev-inc/Maestro)（Apache-2.0）可用于实际 UI 旅程；[官方平台支持](https://docs.maestro.dev/get-started/supported-platform)覆盖 Android 模拟器/真机和 iOS 模拟器，不能替代 iOS 真机验收。现有 `test:e2e` 仍是已审阅物理设备证据校验器，建议另建 UI 驱动入口而不降低它的门禁。
- 新发现：`NaturalLanguageCapturePreviewer.preview(text, signal)` 的请求只携带固定 system 约束、本次原文和 Schema，没有显式参考时刻、IANA timeZone 或 locale。真实 Provider 接入应评审时间 Context Contract，并验证“明天/本周五/下周”等相对表达、日期型 Deadline 与缺值不猜测；当前 Fake Provider 证据不能证明真实中文日期解释正确。
- 优化顺序建议：先建立 Git 可追溯基线与 DEC-001 试用标准；按 DEC-005 交付一个真实 Provider 的自然语言到确认/排程链路；按 DEC-011 评审优先级、拆分与计划稳定性等非学习策略，并并行补齐 UI/真实设备证据；随后评审显式时间偏好、容量反馈、前台重排合并与数据恢复。DEC-007 的学习参数、DEC-002 的自动提交仍保持 Open，不复制其他项目的权重/阈值，也不扩展 V1 到 Cloud Sync、团队协同或常驻 Agent。
- 本次 Documentation Impact Assessment：Product、Requirements、Architecture、Data Model、API/Contracts、UI/UX、Development、Testing、Security、Build/Release、ADR、AI Context、Implementation Plan 均无规范或实施范围变更；仅 Status 记录研究证据与待评审建议。验证限于文档与格式，未修改业务代码；本日既有 `bun run check` 结果仍为当前代码基线，不新增外部运行或设备通过声明。

## Optimization Execution Status

计划：[OPT-NC-20261003](PLAN.md#no-credential-optimization-plan)。规划文档已完成；用户随后启动“按照 PLAN 执行”的目标，按会话明确的 OPT-NC-20261003 轨道开始实施，不设置额外 Token 预算。方案是否 Accepted 与工作包是否完成分别记录。

| ID | 工作包 | 状态 | 实施 / 验收证据 |
| --- | --- | --- | --- |
| OPT-01 | 环境预检与本地 Git 基线 | DONE | 基线 f06bad8b1872eac2b51a3e73183b46691fb63f00；安全/隔离预检与 bun run check 通过，优化分支 codex/no-credential-optimization |
| OPT-02 | 排程性能与计划移动基准 | DONE | 13 场景/26 完整结果等价、固定 seed、不变量、独立计时与移动统计；本地热点优化前后证据见下文，Hermes 宿主可运行后追加测量 |
| OPT-03 | 本地 Development Build UI 自动化 | IN_PROGRESS | iOS 27 Debug 原生 build/install exit 0；test:ui、九个流程和稳定 testID 已建立，尚无实际旅程通过；正在恢复本地 UI 宿主并准备 Android 工具 |
| OPT-04 | 移动端可用性审查与必要修复 | NOT_STARTED | 尚无本轮审查与复测记录 |
| OPT-05 | 通用 ModelProvider / Agent 契约缺口 | IN_PROGRESS | complete/stream 错误脱敏与不合作 Abort 边界已修复；60 个 Agent tests、类型/lint/架构通过，等待可用 Hermes 宿主隔离 smoke |
| OPT-06 | Capture 时间上下文与中文案例 | DONE | API/Security 先同步显式 Context Contract；所有调用方迁移；中文时间 fixture、非法 Context/额外字段/取消与失败测试通过，未接入真实 Provider |
| OPT-07 | 本地事务与恢复覆盖审查 | DONE | 覆盖矩阵逐项审查，无需重复实现/测试；19 集成文件/79 tests 与 worker/provider/native facade 36 tests 本轮通过，真实文件关闭重开证据保留 |
| OPT-08 | 架构、依赖与文档一致性收口 | NOT_STARTED | 本次编写计划不等于完成本轮实施收口 |
| OPT-09 | 受决策约束的方案与验收包 | DONE | DECISIONS 候选包覆盖七个 Open 条目、取舍/数据影响/验收/最小输入；状态和生效前默认未变，docs:check exit 0 |

OPT-01 验收证据：本轮 bun run check exit code 0，51 个单元文件/414 tests、19 个集成文件/79 tests、11 包架构、27 文件文档、静态发布检查与 iOS/Android Hermes export 均通过。日志位于 .artifacts/optimization/check-baseline.log；.artifacts 已加入 Git ignore，309 个文件纳入基线提交 f06bad8b1872eac2b51a3e73183b46691fb63f00。候选文件的凭据模式扫描无发现；git diff --cached --check 另报告既有 Markdown 硬换行空格和 .editorconfig 尾部空行，未将该检查记为通过，低影响格式问题留待 OPT-08 审查。现有原生目录保持忽略，模拟器测试将新建专用设备，未触碰既有 App 沙盒。Git 身份复用配置且不打印值；无远端推送。

OPT-02 验收证据：新增 scripts/benchmark-scheduler.ts、tests/benchmarks/scheduler 的固定 seed 场景/独立后置条件及 tests/unit/scheduler 的基准与区间补集测试；bun run bench:scheduler 实际执行 50/200/500 Task × 7/30 天 × sparse/dense 的 12 组中性 policy，加一组明确标注的稳定性示例，共 13 组，preview/replan 各 5 个预热后样本。未优化结果保存在 .ai/evidence/optimization/scheduler-baseline.json，当前结果含 source SHA-256 保存在 scheduler-after.json，同输入/同主机的 10 样本 CPU profile 对比见 scheduler-comparison.json；以上命令 exit code 0。Profile 显示 mergeIntervals/sort 为热点，仅在减去 Busy/保护区间时先过滤当前窗口外的区间，没有改变候选排序、权重、约束或 scheduler-core/1 版本。所有 26 份完整结果（含解释/警告/metrics）与保存的优化前输出 deep equality 通过；独立整数区间补集 oracle 200 组通过。6 个 Scheduler 单元文件/24 tests、typecheck、11 包架构、docs:check 与相关 ESLint 均 exit code 0。曾误用 Vitest 的不存在 project=unit 入口，退出 1；改为仓库真实配置的文件过滤后通过，没有删除测试。

同一 200 Task/30 天/sparse 的 profile 测量：preview p95 125.494 → 24.267 ms，replan p95 129.532 → 50.207 ms，样本数均 10。仅为本地 Bun 1.4.0/Mac 主机观察，不建立 SLA，也不能外推 Hermes/手机耗时；原始 profile/完整结果位于 .artifacts/optimization/。变化统计严格按 existingBlockId 匹配，新增/删除单列；示例稳定性 policy 是测试输入，不是生产决定。Development/Testing/Build 文档已同步入口职责，生成物目录从格式/ESLint/文档扫描排除，不排除业务源码。Hermes 当前尚未执行基准，待本地原生宿主实际可运行后追加隔离测量。

OPT-03 准备：官方无需账号 CLI 2.11.0 位于 .artifacts/tools/maestro-2.11.0/，未修改 shell profile；后续执行禁用匿名 analytics 和 CLI analysis notification。专用设备 Execution Agent OPT-NC Test / UDID 828EE218-5681-4D83-B3B8-93345F837E42 使用 iOS 27.0 / iPhone 17；Debug 原生构建日志 .artifacts/optimization/ios-build.log。既有模拟器和业务库没有清理。Android SDK/adb/emulator 尚不可用；Maestro 官方说明 setAirplaneMode 仅 Android 生效，不能把 iOS 上无效命令当作离线证据，离线旅程需另行提供真实网络隔离方案或平台验证。

OPT-02 收口：完整 bun run check exit 0（53 个单元文件/418 tests、19 个集成文件/79 tests、架构/文档/静态发布/双平台 Hermes export），日志 .artifacts/optimization/check-scheduler.log；优化提交 d27dea32cf7bd2a378a83fa6a3c9a4e1154b1c7f。该门禁执行期间开始添加 UI testID，因此仅作为 Scheduler/脚本基准收口证据，本轮 UI 源码、runner 和后续改动仍需相关及最终完整门禁。

OPT-03 当前实现：scripts/test-ui.ts 使用 Maestro 本地 CLI，支持命名/UDID ownership receipt 校验、development bundle identifier 校验、测试 App 重装、独立运行产物、Junit/结构化记录和真实 SQLite 只读检查。tests/ui/flows 的九个 YAML 覆盖连接、任务创建、设置/缺估时 inbox、拒绝 Preview、计划提交、Calendar/开始/暂停、重启恢复、继续/明确完成及完成来源；控件使用 testID 和有界条件等待，无固定坐标或长 sleep。断言包括唯一 Task/Plan/Completion/Achievement、来源 FK、暂停投入不增长和可信区间汇总一致。Source/入口存在不等于旅程通过，当前 iOS runner 明确输出 offline 未执行和 planAcceptance=partial；Android 参数目前明确拒绝，不会假装支持。

OPT-03 验证/环境事实：iOS 27 Debug xcodebuild 与安装 exit 0，Maestro 两次启动探测均 exit 1，停在 SpringBoard 首次深链“打开”确认框；驱动读到按钮并报告 tap 成功，但截图/层级仍保留确认框，Metro 未收到 App bundle 请求，不能据此认定 App 已进入业务 UI。另建隔离 iOS 18.3 / iPhone 16，UDID F254416D-A447-4963-948A-1A63079FA90F；探测在 launchApp 处退出 1，cleanup 报模拟器 Shutting Down。当前 /Applications/Xcode.app 含 SDK/CLI，但没有 Developer/Applications/Simulator.app，mdfind 也未发现其旧 bundle；随后查到 /Applications/Xcode.app/Contents/Applications/DeviceHub.app（com.apple.dt.Devices）替代界面并显示专用测试设备，不能据旧路径缺失判定 Xcode 安装不完整。正在用该实际界面复测，触摸失败根因尚未证明。原始 probe/XCTest 日志和合成截图位于 .artifacts/optimization/ui-probe*。不改业务代码掩盖这些环境问题。

UI runner 的 typecheck、相关 ESLint、--help 均 exit 0；Android 未实现参数明确 exit 2；传入未登记 UDID 的保护探测在任何重装前拒绝，exit 1（现行配置/运行拒绝），记录 .artifacts/optimization/ui-unowned-device.log。docs:check exit 0，Development/Testing/Build 文档同步本地驱动职责与当前限制。另修根目录 Bun wrapper 顺序：原 `bun --cwd apps/mobile run ...` 只输出帮助后 exit 0，改为 `bun run --cwd apps/mobile ...`，Expo --help 与实际 Metro 启动已验证；Metro 使用 8087/--offline，只代表开发工具不联网，不能用作 App 断网证据。

Android 准备：官方 commandlinetools-mac_arm64-15859902 下载 SHA-256 与官方值 835b62a26162b229b441d1f6d4680383815a270809eb33522c0d480fa5002c4e 一致；SDK 包列表查询 exit 0。工具仅解压在 .artifacts/tools/android-sdk/，未更改全局 profile/用户 SDK。正在安装无需账号的 platform-tools、emulator 与 API 36 default arm64-v8a system image（具体 live handle 由当前会话保存，日志 .artifacts/optimization/android-sdk-install.log），尚无 emulator 或 Android 旅程通过证据。仓库既有 app-debug.apk 可用于 native host 准备，但尚未验证当前 JS/UI/设备运行。

OPT-05/06 收口门禁：bun run check exit 0（53 unit files/454 tests、19 integration files/79 tests、架构/文档/静态发布/双平台 Hermes export），日志 check-agent-capture.log。该结果不代替仍未通过的 UI 旅程或实际 Hermes 执行。

OPT-05/06 实施：通用 Provider complete/stream、自定义 mapper、已包装错误和 Agent Tool 异常均使用稳定错误码与通用消息，防止合成 raw payload/category/code 泄露；新增红灯测试先确认 4 个 ModelProvider 和 3 个 Agent 缺口，再修复并复测。Agent 对忽略 Abort 的 Provider/stream/Approval/Tool 停止等待并隔离迟到结果，不宣称撤销已开始的事务；complete/stream 的成功收据在后续 Provider 失败后均可复用。Tool Matrix/风险 floor 未变，没有引入 SDK、权限或生产 Fake AI。契约覆盖矩阵见 .ai/evidence/optimization/agent-contracts.json；Hermes 有实际可运行宿主后执行隔离 smoke，当前尚未执行。

OPT-06：docs/05-API 与 docs/09-SECURITY 先定义 preview(text, timeContext, signal)，referenceInstant 严格 UTC/Z、IANA timeZone 和 BCP 47 locale 由宿主显式提供并运行时校验；未知/非法 Context 在 Provider 前拒绝，草稿 Schema/非持久化与用户确认边界保持。调用搜索只发现 Previewer 与测试，无生产配置 Provider 的调用方；已全部迁移，不对手工 Capture 接入 Fake。8 个合成中文 fixture 覆盖同 Instant 不同时区、周界/跨年、DST 缺失/重复本地时刻、仅日期 Deadline 和模糊/缺估时；额外 Context、模型伪造字段、取消后迟到回复和 Provider 失败均验证。测试仅证明上下文传递/输出校验，不证明中文理解准确率。

本轮 Agent/Capture 验证：bunx vitest run tests/unit/agent exit 0（4 files/60 tests）；typecheck、相关 ESLint、docs:check 均 exit 0；Agent 初次修改后的 test:architecture exit 0，新增 Context import 后在最终门禁复核。日志 .artifacts/optimization/{model,agent}-contract-{red,green}.log 与 capture-time-{tests,types,lint,docs}.log。API/Security/Testing 同步当前 Contract 与覆盖；没有 Schema migration 或新 ADR；完整仓库最终门禁尚待后续修改收口。

OPT-07：逐项阅读真实 ScheduleService/Execution/Repository/Migration/ExternalIntent 和 Phase 9 文件型 SQLite 关闭重开测试，形成 recovery-coverage.json；既有测试已证明全部审查重点，未发现需要新增实现或重复故障测试的缺口。bun run test:integration exit 0（19 files/79 tests），worker 31 tests 和 provider timeout/native SQLite facade 5 tests exit 0，日志 recovery-{integration,unit,provider-native-facade}.log。一次文件过滤包含不存在的 provider-call-bounds 名称，但 Vitest 只运行存在的 integration-service（31 tests）；随后使用实际 provider-timeout 文件独立执行并通过，没有把前次过滤当该文件通过。没有 migration/checksum 修改或备份/导出；Node/Facade 不代表真实 OS 强杀与投递。

OPT-09：docs/DECISIONS.md 新增候选评审包，覆盖 DEC-001/002/005/007/009/011/012，包含试用指标分母/最小本地数据、基础与学习 policy/窗口/容量、前台合并与 Undo、Provider/BYOK、备份恢复 ADR 草案要点以及 OS 隐私/source/投递故障检查。所有关联条目继续 Open，现行默认保持；没有要求负责人本轮提供信息，没有真实请求或新产品行为。docs:check exit 0，日志 decision-docs.log；未新增 Markdown，MANIFEST 不变。

当前实施 Documentation Impact Assessment：Product/Requirements 无范围或必要程度变化；Architecture 沿既有 Pure Core/Application 边界并修复取消隔离；Data Model 无 Schema/迁移变化；API/Contracts 与 Security 同步时间 Context/错误脱敏/有界中止；UI/UX 尚待实际审查，当前只增加 testID；Development/Testing/Build 记录基准与部分 UI 入口；ADR 无新重大决策；AI Context 更新命令可用性路由；Implementation Plan 验收范围/依赖不变；Status 汇总实际证据和未完成项。DECISIONS 仅候选建议，未关闭决策。最终影响评估和完整门禁待 OPT-08。

状态约定：NOT_STARTED、IN_PROGRESS、PARTIAL、DONE、BLOCKED。每次更新附变更文件、命令/退出码、环境/覆盖、证据、未解决问题和下一步；审查类任务无修改时仍需审查证据。BLOCKED/PARTIAL 不能计为 DONE；工作包状态不代替宿主 Goal 生命周期。

当前动作：继续 OPT-03 实际宿主准备与旅程验证；若宿主准备等待或失败，推进依赖已满足的 OPT-05/06/07 审查与实现，不把 UI 部分准备算作完成。候选文件扫描仅覆盖所列凭据模式，不宣称完整安全认证；工具版本/隔离路径记录于 .ai/evidence/optimization/environment.json，原始本地日志使用被忽略的 .artifacts/。bun run bench:scheduler 已可用；bun run test:ui 入口已建立但实际旅程未通过，现有 test:e2e 仍是物理设备证据校验器。

本次规划的 Documentation Impact Assessment：Product、Requirements、Architecture、Data Model、API/Contracts、UI/UX、Development、Testing、Security、Build/Release、ADR 无生效规范或业务实现变化；AI Context 增加优化摘要与边界，Implementation Plan 增加九个包/验收/启动目标文本，Status 增加独立执行表及下一步。没有新增 Markdown 文件，MANIFEST 清单不变；必要的 Canonical/ADR 变更在对应工作包实施时完成。

2026-10-03 本次文档验证：bun run docs:check 通过（27 文件、24 Requirement、24 Acceptance、27 CASE、5 E2E），bun run format:check 通过；.ai 按现有规则排除于普通格式检查，另用 Prettier 显式覆盖 ignore 的 debug-check 验证这三个修改文件的格式往返，exit code 0。独立计划一致性核查通过：九个工作包都有章节和 NOT_STARTED 行、目标文本与 Context 路由存在、两条拟新增脚本尚未被当成当前命令、blocked 生命周期约束明确；链接/引用/清单与跨文档语义已复核。业务实现、代码测试与设备验收不适用：本次仅修改计划与上下文，不启动优化目标；本日先前 bun run check 证据保留，不作为本轮优化已实现的证据。

## Documentation Impact Assessment

| 项目 | 结果 |
| --- | --- |
| Product | 无产品范围变化；补充 Open Decision 的最小输入清单，但未替代产品负责人关闭 DEC-001 / DEC-002 / DEC-005 / DEC-006 / DEC-007 / DEC-008 / DEC-009 / DEC-011 / DEC-012 |
| Requirements | 补齐 Task 取消、Goal/Project 可达性及 Calendar 待核对恢复的实现证据；未把缺真实 Provider、设备或产品决策的 MUST/SHOULD 标记完成 |
| Architecture | Task 终态计划事务、Goal/Project 有界查询和 Mobile integration user-action wake 均复用既有 Application/前台事件驱动边界 |
| Data Model | UserPreference generic JSON 表保存提醒与 Focus 过渡开关，无新实体或 SQL migration；IntegrationJob 只开放受限安全终态重排，不抢占 processing/intent |
| API / Contracts | 增加 Task cancel 结果、Goal/Project 有界 list、Mobile 权限/恢复后 wake 接线与一次性 Focus 展示信号；直接用户 authority、幂等、Execution 状态机与 durable Job 边界不变 |
| UI/UX | Task/收件箱/Goal/Project 流程已补齐；Settings 对 Calendar provisioning unknown 提供受状态约束的两步核对恢复，增加可关闭 Focus Mindful Transition，并统一秒级事实派生的分钟展示 |
| Development | 明确终态计划事务、有界列表、权限/recovery 本地提交与 best-effort wake 分离；不把 wake 失败伪装成事务回滚 |
| Testing | 新增 Task 取消、完整约束、Goal/Project 列表/关联、integration user-action wake 与 Focus 过渡开关/边界覆盖；Simulator/Facade 证据仍不计入真机 OS 验收 |
| Security | Task/Goal/Project 终态操作与 Calendar provisioning intent 释放均要求直接用户和两步 UI；DEC-012 隐私与最终通知 policy 仍开放 |
| Build / Release | 真机证据增加零/非零提前量实际触发与非法值拒绝；补充不含凭据的授权发布交接顺序，既有 release gate 不放宽 |
| ADR | 无新重大设计决定；未把当前中性 policy 或静默环境入口固化为产品决策 |
| AI Context | 同步 Task/Goal/Project、提醒偏好、安全重排、待核对恢复、投影竞态 fence 与用户授权的外部跳过边界 |
| Implementation Plan | 补充 Phase 1/3/4 当前 Mobile 功能边界、仍需真机验证的 Exit 与用户授权的阻塞任务跳过登记 |
| Status | 本文件记录新增可达性/恢复证据、当前主机授权环境复核、Open Decision 最小输入、三个可追溯 Skip ID 与仍需授权人员完成的发布门禁 |

## Engineering Readiness

`PHASE 10 TECHNICAL RELEASE SCAFFOLD COMPLETE — FORMAL PRODUCT/DEVICE/SIGNING/STORE GATES OPEN`；按用户授权排除三个外部 Skip ID 后，80 / 80 项本地可执行清单均已完成，最新 `bun run check` 通过（51 个单元测试文件 / 414 tests、19 个集成测试文件 / 79 tests、架构、文档、静态发布检查和 iOS/Android Hermes bundle）。计划中没有 Phase 11，但原始 101 项清单中的 21 个正式 Exit 尚未满足，当前仍不能称为已发布且功能完善的 App。

Phase 1 技术实现与正式关闭项：

- [x] Domain types、Task 状态不变量与 Goal / Project / Task 关系
- [x] Application Ports、Runtime Schema、Task/Goal/Project Services
- [x] Goal/Project 有界查询、Mobile 创建/关联 Task/真实进度与两步归档入口
- [x] Drizzle Schema、migration、Repository 与 UnitOfWork
- [x] 手工 Task 创建/编辑/明确完成及唯一 CompletionRecord 事务
- [x] Task 明确取消、活跃执行/未完成块收口、计划版本/同步作业与无完成证据事务
- [x] OperationRecord、TaskActivityEvent、stateVersion 与估时基线基础
- [x] migration failure、transaction rollback、invalid transition 与纵向集成测试
- [x] `bun run check` 当前代码聚合门禁
- [ ] 产品负责人关闭 DEC-006，确认 TaskDependency V1 范围

Phase 2 技术实现与后续产品/集成项：

- [x] Pure Scheduler 输入/输出、硬约束、显式软评分、拆分、稳定性、warnings/unscheduled
- [x] Application Snapshot Port、内存 Preview/Replan、TTL、版本冲突、明确用户 Commit 与幂等重放
- [x] `0001` SchedulePlan/TimeBlock/IntegrationJob Schema、migration、Repository 与原子提交
- [x] 首次有效计划提交的 Task planned / baseline estimate 原子联动与回滚
- [x] CASE-SCHED-01/02、随机不变量及真实 SQLite CASE-COMMIT-01 技术覆盖
- [x] 当前完整 `bun run check`
- [ ] 关闭 DEC-006，确定依赖任务 V1 范围
- [ ] 关闭 DEC-011，确定生产 Task 词表/default 与 Scheduler policy 映射
- [x] 生产 SchedulingSnapshot / 工作窗口-DST / pre-decision neutral policy Adapter 接入 Mobile；正式 policy 仍待 DEC-011
- [ ] Phase 4 补齐 CASE-SCHED-03 物理设备拖动、迟开始与跨天真实交互；iOS Simulator 精调/锁定/解锁已验证
- [x] iOS Simulator Development Build 完成真实 `0000 → 0001 → 0002 → 0003 → 0004 → 0005` SQLite 写读、事务与重启 smoke；Android/物理设备仍待验收

Phase 3 技术实现与正式关闭项：

- [x] Calendar Snapshot/Coverage、verified container/event/notification binding Domain 与 Repository
- [x] `0002` IntegrationJob claim/lease/notBefore/automatic retry migration 与 `0003` ExternalMutationIntent write-ahead migration
- [x] CalendarService complete/partial refresh、权限边界与 Busy stateVersion 联动
- [x] IntegrationService projection/reconciliation、owned inventory、intent/checkpoint、revision/claim fence 与显式恢复
- [x] Expo Calendar/Notifications Adapter、严格 Provider 结果解析和注入 native facade 测试
- [x] Mobile `expo-sqlite` startup migration、真实 Adapter/Service 构造与 AppState active 前台协调器
- [x] Node SQLite migration/约束/rollback/故障恢复集成与当前完整 `bun run check`
- [x] 接入 production SchedulingSnapshot/ScheduleService、Commit wake 与权限/Calendar 选择/同步状态 UI
- [x] 从所选 Calendar 执行 30 天有界 refresh，并把失败保留为可重试状态
- [x] 直接用户 `0–1440` 分钟提醒提前量、当前安全作业 durable requeue 与 in-flight stateVersion 再收敛
- [x] 授权后立即 foreground wake，以及 `calendar_provisioning_unknown` 的 Settings 两步用户核对/释放 intent/重试入口
- [ ] 产品负责人关闭 DEC-012；当前保守 projection/privacy/source/sound 仅为可替换基线
- [ ] iOS/Android Development Build 验证真实 SQLite migration/restart 和 Calendar/Notification permission/account/source/readback/delivery/cancel/process-crash

Phase 4 实现与正式关闭项：

- [x] `0004` UserPreference、PreferenceService 与 production SqliteSchedulingSnapshot
- [x] Intl DST/工作窗口与统一 Timeline minute→pixel 几何
- [x] Today/Calendar/Capture/Task 完整手工排程约束编辑与两步取消/有界分页收件箱/Schedule Preview/Settings 路由与核心本地流程
- [x] Preview 过期/丢失/冲突、设置缺失、同步待处理与权限状态用户文案
- [x] Preview 结构化摘要、任务标题、before/after、跨日日期、时区/Busy/Deadline/保护结论、未排程原因与 warning 中文展示
- [x] iOS/Android Hermes bundle、typecheck、lint、单元与架构门禁
- [x] Calendar 选择、local-only 与 30 天有界 refresh UI
- [x] Today 独立用户 Replan Preview 与权限/待核对状态直达 Settings
- [x] Calendar TimeBlock Reanimated 布局过渡与系统 Reduce Motion
- [x] Calendar 所选日 Replan Preview 与前/后日读屏动作
- [x] Calendar 周一至周日日期条与 Today Empty 的添加/查看本周/主动 Relax 路径
- [x] Calendar 结构化块类型/状态，以及 started/completed/past 块的只读调整与深链保护
- [x] Today 当前/Next 与调整页的结构化中文类型/状态及跨日日期展示
- [x] 提醒提前分钟数 UI、前置校验、持久化与当前计划提醒重检
- [x] drag/resize 受信 Preview、原子持久化提交、提交后锁定与显式解锁
- [x] iOS Simulator Development Build：离线 Capture/设置/Preview/Commit/Timeline/精调/锁定/解锁、收件箱/未来块进入 Task 编辑、取消确认面板与未授权状态
- [ ] 物理设备触摸 drag/resize、Android 运行与 Calendar/Notification 成功权限状态验收

Phase 5 技术实现与正式关闭项：

- [x] ExecutionSession / work-pause Interval / Achievement Domain 与 `0005` SQLite
- [x] start/pause/resume/finish_session/complete_task/abandon 状态机、幂等与重启恢复
- [x] Task 完成事务扩展、未来块清理、IntegrationJob、唯一 CompletionRecord/Achievement 与 opt-out
- [x] Today/Task 启动、低噪音 Focus、仅新建时显示且可跳过/关闭的 10 秒 Mindful Transition、明确完成分支、成就日/周/月/历史与编辑/hide/unhide
- [x] CASE-EXEC-01/02、CASE-ACH-01 自动化技术覆盖及事务晚期失败回滚
- [x] iOS Simulator E2E-003 核心链路和 `0000 → 0005` reload 持久化
- [ ] 产品负责人关闭 DEC-001，确认首轮试用范围与成功标准
- [ ] 物理 iOS/Android Development Build 验证 Focus 生命周期、进程终止恢复及成就回顾

Phase 6 技术实现与正式关闭项：

- [x] Hermes-compatible Agent Loop、状态事件、Registry、预算、Abort/timeout、streaming 与 Context Transform
- [x] 15 个 V1 Tool 的严格输入/输出 Schema、风险/审批、宿主 authority/operationId 与成功收据复用
- [x] Model Runtime complete/stream 适配、usage/Tool event 聚合、脱敏错误与 Fake Provider
- [x] `0006` 最小 AgentRun metadata、Repository/Application Service、重启恢复和隐私约束测试
- [x] 自然语言结构化 Preview 边界与 Provider 未配置时保留原文的明确手工降级 UI
- [x] CASE-AGENT-01/02/03/04、CASE-PRIVACY-01 自动化技术子集与当前完整 `bun run check`
- [ ] 产品负责人关闭 DEC-005，选择真实 Provider、凭据存储和数据出境边界
- [ ] 真实 Provider compatibility、自然语言质量与物理 iOS/Android E2E-001 验收

Phase 7 技术实现与正式关闭项：

- [x] Pure facts-to-features builder：五类行为统计、显式窗口/算法/置信 policy、稳定排序与排除计数
- [x] UserModelFeature Domain、`0007` Drizzle/migration/Repository 与同算法原子缓存替换
- [x] UserModelService 一致性事实快照、稳定 ID、新鲜度与事务失败回滚
- [x] Task/Execution 直接用户 `allEffortRecorded` 完整覆盖证据及 Agent 拒绝
- [x] `personalization.enabled.v1` 默认关闭、Settings 说明与 SchedulingSnapshot policy 输入边界
- [x] CASE-MODEL-01 自动化技术子集与当前完整 `bun run check`
- [ ] 产品负责人关闭 DEC-007，确认生产窗口、分类、样本阈值、启用阈值与 Scheduler 权重
- [ ] 按已接受 policy 启用/自动刷新特征，并完成物理 iOS/Android 产品与长期数据验收

Phase 8 技术实现与正式关闭项：

- [x] DailyReflection/EnergyCheckIn/RelaxSession Domain、严格 Runtime Schema 与 Application Service
- [x] `0008` Drizzle/migration/Repository、checksum、约束、升级与事务回滚
- [x] Reflection 的 CompletionRecord/TimeBlock 事实摘要、最多三个 Win、用户备注与无模型离线降级
- [x] Check-in 本地日/时区、可关闭入口、stateVersion 与 SchedulingSnapshot 最新有效记录接线
- [x] Relax 单 active、真实区间、completed/abandoned、时钟异常与 Focus/Today/Tab/adjust-today 流程
- [x] CASE-REFL-01、CASE-CHECKIN-01、CASE-RELAX-01、CASE-PSY-01 自动化技术子集与当前完整 `bun run check`
- [ ] 按已接受生产 policy 确认/启用 Check-in 软权重，验证关闭状态与跨时区产品体验
- [ ] 物理 iOS/Android Development Build 完成 E2E-005、Focus 返回、进程终止恢复和 `0008` migration smoke

Phase 9 技术实现与正式关闭项：

- [x] Calendar/Notification Provider 有界调用、宿主 Timer 注入与 Mobile 15 秒配置
- [x] 只读超时延迟重试、外部写超时保留 intent/不盲目重复副作用
- [x] 文件型 SQLite 多次进程关闭/重开、全 migration 重入与离线 pending 保持
- [x] Schedule/Execution/Completion/Achievement/Reflection/Relax 精确幂等及唯一事实组合验证
- [x] plan conflict、notification current-revision rebuild、migration failure rollback 既有回归继续通过
- [ ] 物理 iOS/Android E2E-001 至 E2E-005 与真实 OS Provider 强杀/超时/迟到结果故障注入
- [ ] 通知离线到点投递/重建及长时间运行、资源释放与电量影响验证

Phase 10 技术实现与正式关闭项：

- [x] App `0.1.0`、iOS/Android developer-facing 初始版本与三套独立 variant
- [x] 精确 EAS CLI、development/internal preview/production build 与 production submit profiles
- [x] production remote build-number autoIncrement 与 DEC-008 前显式 OTA disabled
- [x] `release:check`/`release:gate`、build/submit 命令、双平台 physical E2E evidence gate
- [x] 双语 store privacy 草案、机器 release checklist 与未决项显式 pending
- [x] production variant 双平台 Hermes export 和当前完整 `bun run check`
- [x] 已知旧开发 `0006` 占位 checksum 的严格 Schema 验证修复、Node 回归与 iOS Simulator 无清库 `0008` 升级/Relax 冒烟
- [ ] 授权 Expo owner/projectId/login、确认 store identifier、配置 Apple/Google signing 与 service account
- [ ] 关闭 DEC-008/009 等发布相关决策，补 Privacy Policy URL 和 store privacy/legal review
- [ ] EAS preview/production cloud build、签名制品安装、`0000 → 0008` 设备升级和两平台 E2E-001 至 E2E-005
- [ ] EAS Submit/TestFlight/Google internal draft 验证、最终 release checklist 与无高优先级阻塞确认

## Blocking Issues / Open Decisions

- Phase 1 正式关闭：[DEC-006](../docs/DECISIONS.md#dec-006)。
- Phase 2 产品范围正式关闭：DEC-006、DEC-011。技术实现和当前门禁已经完成；生产 Snapshot/Mobile、Expo SQLite 与 OS 同步作为后续集成证据单独跟踪。
- Phase 3 正式关闭：DEC-012，以及真实 iOS/Android SQLite/OS 故障验收。当前 Node/fake/native facade/bundle 证据都不能替代这些项。
- Phase 4 正式关闭：物理设备 CASE-TODAY-01/拖动缩放、Android 运行及 OS 权限状态验收；iOS Simulator 核心链路已通过。
- Phase 5 正式关闭：DEC-001 与物理 iOS/Android CASE-EXEC-01/02、CASE-ACH-01/E2E-003 验收；iOS Simulator 核心链路已通过。
- Phase 6 正式关闭：DEC-005、真实 Provider/凭据与自然语言质量、物理 iOS/Android E2E-001；Fake Provider 和自动化技术子集不能替代这些项。
- Phase 7 正式关闭：DEC-007 与按接受参数启用/刷新/消费特征，以及物理 iOS/Android 长期行为数据验收；显式参数测试与中性降级不能替代产品决定。
- Phase 8 正式关闭：Check-in 的生产软约束映射与物理 iOS/Android CASE-REFL-01、CASE-CHECKIN-01、CASE-RELAX-01、CASE-PSY-01、E2E-005 验收；Node SQLite、单元测试和 Hermes bundle 不能替代真机结果。
- Phase 9 正式关闭：物理 iOS/Android E2E-001 至 E2E-005、真实 Calendar/Notification 强杀/超时/迟到结果、通知离线重建和长期运行；主机文件型 SQLite 与 Fake/native facade 证据不能替代这些项。
- Phase 10 正式关闭：授权 Expo/Apple/Google 账号、project link、identifier、签名、DEC-008/009、Privacy Policy/问卷、preview/production cloud build、两平台升级/E2E 与 store submission。静态 release:check 和 Hermes export 不能替代这些项。
- 用户可用完整 App：工程计划已推进到最后 Phase，但仍需 Phase 1–10 的开放决策、真实 Provider/设备/OS 与签名商店闭环；当前技术门禁通过不能替代这些正式 Exit。

## User-Authorized Blocked-Task Skip Register

2026-09-12，用户明确授权：遇到无法由本地工程解决的任务时，标记阻塞原因后跳过，按至少 95% 的可执行范围继续。此授权仅改变本轮工程推进的优先级；不把跳过项写成已完成，也不改变 Requirement 的 MUST/SHOULD、正式 Phase Exit 或发布结论。

当前 101 条工程清单中有 80 条已完成、21 条未完成。21 条未完成项全部属于以下三组外部阻塞；剔除它们后，用户授权的本地可执行子集为 80 / 80（100%）。原始清单仍为 80 / 101（约 79%），因此正式产品/发布完成度不能按该子集对外宣称。

| Skip ID | 已跳过但未完成的任务 | 对应清单 / 后续解除条件 |
| --- | --- | --- |
| `BLOCKED-DECISIONS-001` | 产品、算法与隐私决策 | Phase 1/2 的 DEC-006/011，Phase 3 的 DEC-012，Phase 5 的 DEC-001，Phase 6 的 DEC-005，Phase 7/8 的 DEC-007，以及 Phase 10 的 DEC-008/009；按 [DECISIONS Resolution Input Packet](../docs/DECISIONS.md#resolution-input-packet) 由负责人关闭 |
| `BLOCKED-PROVIDER-DEVICE-001` | 真实 Provider、物理 iOS/Android、OS 与长期运行验收 | Phase 2–9 的真机交互、Calendar/Notification、Focus/Relax、E2E-001…005、强杀、超时、升级与离线投递证据；需要真实服务、设备、权限和人工审核 |
| `BLOCKED-RELEASE-AUTH-001` | EAS / Apple / Google / 商店与隐私发布授权 | Phase 10 的 Expo 登录、owner/projectId、identifier、签名、service account、Privacy Policy、问卷、cloud build 和 submit；只可由授权发布者按 [Authorized Release Handoff](../docs/10-BUILD-RELEASE.md#authorized-release-handoff) 执行 |

所有原有 `- [ ]` 条目保持未完成，便于恢复时逐项验收；上表是跳过登记，不是完成勾选。

## Next Task

继续已启动的[无需凭据优化计划 OPT-NC-20261003](PLAN.md#no-credential-optimization-plan)，当前优先恢复隔离 UI/Hermes 宿主并审查 OPT-07/09；逐包状态见 Optimization Execution Status。

既有用户授权的 80/80 子集没有剩余非跳过项，这不表示产品没有后续代码实施。恢复正式 Phase Exit 时，先解除上述三个 Skip ID 中相应的决策/服务/设备/授权条件，再实施真实 Provider 与 Mobile Agent/凭据接线、生产 policy/特征刷新等对应范围，完成真实 Provider/设备验收、`bun run release:gate`、production build/submit，并更新真实发布结论。本轮优化完成也不解除这些外部门禁。
