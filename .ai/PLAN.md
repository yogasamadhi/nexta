# Implementation Plan

本文件维护顺序、阶段依赖与退出条件；实际状态见 [STATUS](STATUS.md)，需求/AC/验证映射见 [Testing](../docs/08-TESTING-ACCEPTANCE.md#requirement-matrix)，阶段前置决策见 [DECISIONS](../docs/DECISIONS.md)。

Phase 0 工程基线已建立，后续从 Phase 1 开始实现产品能力；实时进展与验证证据只在 [STATUS](STATUS.md) 维护。V1 MUST 范围保持不变；最早可试用闭环在 Phase 5 使用手工任务入口，Phase 6 再接自然语言。跨阶段需求不能因早期子集完成而标整条 DONE。

2026-10-03 新增[无需凭据的优化执行计划](#no-credential-optimization-plan)，用于后续目标模式执行。它是既有 Phase 0–10 的工程优化轨道，不新增 Phase 11，不改变原清单的 80/80 子集或 21 个正式未完成项；编写本计划不代表工作包已经实施。

## Phase 0 — Repository Foundation

### Goal

建立可长期 AI Coding 的工程骨架。

### Deliverables

- Monorepo
- `apps/mobile`
- core packages（包含 application 与纯 Ports；不提前实现业务）
- TypeScript strict
- lint / format
- test
- architecture check
- CI skeleton
- docs:check（链接、引用、覆盖映射、清单）
- 验证目标依赖组合与 Runtime Schema 选型（DEC-004）
- 最小 iOS + Android Development Build

### Exit

```text
pnpm run check
```

可稳定通过，并分别记录 iOS/Android 最小 Development Build 的实际结果。脚本职责见 10-BUILD-RELEASE；未覆盖业务测试不得伪装为业务通过。

---

## Phase 1 — Domain & Persistence

### Goal

完成第一批业务实体和 SQLite 基础。

### Related Requirements

- REQ-TASK-001
- REQ-GOAL-001
- REQ-OFFLINE-001

### Deliverables

- Domain types / Task 状态迁移 / Goal-Project-Task 关系
- application 用例与 Repository / UnitOfWork / Clock Ports
- Drizzle schema（TaskDependency 须先处理 DEC-006）
- migrations
- repositories
- Task CRUD 与手工完成的 CompletionRecord 基础事务
- OperationRecord、输入版本与活动事实基础；原始估时快照
- migration failure / transaction rollback / invalid transition 测试
- Goal / Project 基础关联与归档，复杂依赖和历史重开遵守待决策边界
- Goal/Project Mobile 入口、有界列表、真实进度、从 Goal/Project 拆出 Task 与两步归档

### Exit

通过应用服务/Repository 集成测试离线创建、编辑、明确完成 Task；完成证据唯一，非法输入和迁移失败安全停止。UI 不作为此阶段退出前提。

---

## Phase 2 — Scheduler Core

### Goal

建立与 UI/LLM 无关的确定性调度核心。

### Related

- REQ-SCHED-001
- REQ-SCHED-002
- REQ-SCHED-003

### Deliverables

- scheduling input/output
- hard constraints
- soft scoring
- split blocks
- replan
- warnings / unscheduled remaining effort
- 应用层内存 Preview、stateVersion / planRevision、Commit 与幂等
- 过期 Preview / 新输入 / 提交响应丢失 / 重复 operationId 测试
- invariant tests（运行中与手动锁定块保护、时间/DST、稳定决胜）

### Exit

Scheduler 纯测试通过 CASE-SCHED-01/02/03；应用层通过 CASE-COMMIT-01 的版本/时间检查与事务幂等。外部同步使用 Fake Ports，不以尚未接入 OS 为理由省略本地事务保障。

---

## Phase 3 — Calendar & Notifications

### Goal

接入系统真实时间环境。

### Related

- REQ-CALENDAR-001
- REQ-CALENDAR-002
- REQ-NOTIF-001

### Deliverables

- permissions；后台只读状态、前台显式请求与 permission-blocked requeue
- bounded listBusyEvents、ExternalCalendarEventSnapshot 与 complete-only refresh coverage
- App-owned calendar container/event 与 verified binding
- notification mapping；稳定 `(timeBlockId, type)` 身份
- schedule rebuild；显式 injected projection/lease/retry policy
- IntegrationJob / CalendarBinding / NotificationBinding 与本地事务联动
- ExternalMutationIntent write-ahead/checkpoint；跨 Job/revision 稳定 scope 去重
- 自有事件去重、重复实例、complete/partial/乱序刷新、权限拒绝
- OS 创建后映射未写入的 intent-first 恢复、owned-marker inventory 与不确定结果处理
- channel claim/lease/token/attempt/revision fence；过时同步作业不得覆盖最新计划
- Calendar/Notification production policy 与隐私边界决策（DEC-012）

### Current implementation boundary

平台无关 Domain/Application、`0002`/`0003` SQLite migration/repositories、ExternalMutationIntent、Calendar/Notification Integration worker、Expo Adapter 代码与注入 native facade 测试已经落地。Mobile Composition 已打开并迁移 Expo SQLite，构造真实 Adapter/Service，并以 AppState active 前台协调器按通道 drain durable Job；它没有后台 daemon，也不会自动弹权限框。Phase 4 已接入 production SchedulingSnapshot/ScheduleService、Commit wake、显式权限/日历范围设置、所选 Calendar 的 30 天有界 refresh、同步状态 UI，以及直接用户可配置的 `0–1440` 分钟提醒提前量；偏好变化会推进 stateVersion，并以 durable Job 安全重排当前提醒，投影期间的版本变化会触发再次收敛。授权成功后 Mobile 会立即 best-effort 唤醒重新入队的通道；Settings 还为 `calendar_provisioning_unknown` 提供两步用户核对/释放 intent 入口，其他冲突仍保持不可盲目解除。iOS Simulator 已验证提醒偏好写入与 permission-required 作业重排；仍需完成 iOS/Android 的权限、Calendar account/source、读写回读、Notification 实际提前投递/取消、进程终止恢复与隐私/声音行为验收。当前 DEC-012 保守 policy 是可替换实现基线，不是已接受的产品定稿；技术实现通过不能替代这些 Exit 证据，Phase 3 在真实设备验收前不得正式标记 DONE。

### Exit

关闭 DEC-012 并在真实设备上证明 Plan → Calendar → Notification 可工作；CASE-COMMIT-02、CASE-CALENDAR-01/02、CASE-NOTIF-01 验证权限降级、重试与未知结果。清楚区分本地已提交与通道同步状态。Fake provider、Node SQLite、Hermes bundle 或注入 native facade 测试都不能单独满足本 Exit。

---

## Phase 4 — Today / Calendar UI

### Related Requirements

- REQ-TODAY-001
- REQ-TASK-001
- REQ-SCHED-003
- REQ-OFFLINE-001

### Goal

建立产品第一核心体验。

### Deliverables

- Tab Bar 骨架（仅已实现能力可操作）
- 手工创建/编辑 Task 与缺估时 inbox
- Today
- Timeline
- TimeBlock rendering
- drag / resize foundation
- schedule preview / 过期 / 同步待处理 / 权限 / 离线状态
- drag / resize 提交后锁定与显式解锁

### Exit

用户可离线从手工 Task 看到可执行日程并调整；CASE-TODAY-01 与 Preview/权限状态可验收。未实现 Focus/Relax 不显示为已完成能力。

### Current implementation boundary

Mobile 已提供 Today、Day Timeline、中央手工 Capture、Task 编辑、两步取消、独立“重新规划今天”、Schedule Preview/显式 Commit 与 Settings；手工表单已接最早开始、Deadline、拆分、块边界、分类与精力约束，并以设备 IANA 时区严格解析本地日期/时间。Task 编辑将预计总时长、显式剩余估时和只读派生实际投入分开，修改后调用 Replan；未排程项可直接返回对应 Task 修正并生成新 Preview。date-only Deadline 保留原意但补充具体时刻前不直接排程；智能标点会先规范化，不绕过 DST/顺序校验。Today 的有界分页收件箱、候选卡和未来 Calendar Block 均可再次进入 Task 编辑，不把缺估时任务变成不可达数据；空状态可添加任务、进入带周一至周日日期条的 Calendar 或主动进入 Relax，主动 Replan 也不依赖 Check-in/Reflection/Relax，仍只进入统一 Preview/Commit。Calendar 也可用所选本地日已解析的 UTC 范围生成“重新规划这一天”Preview，不直接提交或误用 Today 范围。Today/Calendar/调整页用结构化中文类型/状态和无歧义跨日日期区分块，只有未来 planned 块进入调整/解锁；started、completed 和开始时间已到的块保持只读，调整深链同样防护。Application 从一致 Snapshot 给 Preview 变更、未排程项和 warning 附加只读任务标题，Mobile 以结构化 code 生成中文摘要/原因，显示 before/after、跨日日期、IANA 时区、Busy 新鲜度、Deadline 与受保护块结论；不将标题作为提交 authority，也不将 Scheduler 英文内部 message 当作展示或控制流。Task 取消通过应用事务结束活跃执行、清理未完成块并重建必要同步作业，不生成完成证据。Settings 只在用户点击时请求 Calendar/Notification 权限，并可显式选择忙碌来源、执行 30 天有界 refresh 或保存为 local-only。生产 Snapshot 从同一 SQLite 事务读取偏好、Task、TimeBlock、Busy cache 与版本，Intl Adapter 处理 DST 日界线和工作窗口。Calendar 中稳定 TimeBlock 的位置/尺寸变化使用遵循系统 Reduce Motion 的 Reanimated 短布局过渡，动画不参与事实计算。TimeBlock 调整页支持整块拖动、上下边缘缩放、15 分钟吸附及等价的无障碍精调按钮；受信 Preview 经版本/Busy/工作窗口/Task 约束校验后，以原子 SchedulePlan 提交并锁定，显式解锁会建立另一计划版本。iOS 26.5 Simulator Development Build 已验证手工 Task → local-only 设置 → Preview/Commit → Timeline → 15 分钟调整/锁定 → 显式解锁，以及当前 `0000 → 0005` 实际 SQLite 写读与重启持久化；收件箱/未来块编辑入口、完整约束写入和取消确认面板已在 Simulator 验证，物理 iOS/Android 手势、Reduce Motion 实机表现和 OS 权限/Provider 行为仍缺证据，因此 Phase 4 仍为 IN PROGRESS。

---

## Phase 5 — Execution & Success Diary

### Goal

建立从“计划”到“完成”的闭环。

### Related

- REQ-EXEC-001
- REQ-ACH-001
- REQ-FOCUS-001

### Deliverables

- execution session / 工作与暂停区间 / 重启恢复
- focus mode
- finish_session / complete_task / abandon 明确区分
- 完成事务扩展：Session、CompletionRecord、用户允许的成就、未来块清理
- achievement
- Today's Wins
- 重复完成、活跃 Session 唯一、无计时完成、opt-out 和时钟异常测试

### Exit

手工 Task → Schedule → Start → 明确完成整个任务 → 用户允许的 Achievement 全链路成立；CASE-EXEC-01/02、CASE-ACH-01、E2E-003 通过。首轮试用前关闭 DEC-001；该退出不宣称自然语言 Capture 已交付。

### Current implementation boundary

Pure Domain/Application 与 `0005` SQLite 已实现 ExecutionSession、work/pause Interval、Achievement、唯一活跃 Session/开放区间/成就来源、幂等 start/pause/resume/finish/abandon、完成事务扩展、未来块清理和 durable IntegrationJob。Mobile 已接 Today/Task 启动、reload 可恢复的低噪音 Focus、明确 finish_session/complete_task/abandon/需要更多时间路径，以及带 CompletionRecord/Task/Project/Goal 来源的成就日/周/月/历史回顾、编辑和 hide/unhide。新建 Session 首次进入 Focus 时提供默认启用、可立即跳过且可在 Settings 关闭的 10 秒 Mindful Transition；一次性信号接收后清除，恢复已有 Session、reload 与 Relax 返回不重复，且不新增执行事实。自动化 CASE-EXEC-01/02、CASE-ACH-01 与 iOS 26.5 Simulator 的 E2E-003 核心链路通过；DEC-001、物理 iOS/Android Focus/进程终止验证及前序 OS Provider 证据仍未关闭，因此 Phase 5 不能正式标记 DONE。

---

## Phase 6 — Local Agent Runtime

### Goal

建立 Hermes-compatible Tool Agent。

### Related

- REQ-CAPTURE-001
- REQ-PRIVACY-001
- REQ-AGENT-001
- REQ-AGENT-002
- REQ-AGENT-003
- REQ-AGENT-004

### Deliverables

- agent loop
- tool registry
- tool schema
- risk policy
- abort
- streaming
- model adapter
- 完整 V1 Tool Matrix，动态风险、具体授权与幂等
- 自然语言 Preview 与手工降级入口
- Context 允许列表、日志脱敏与 Fake Provider
- 真实 Provider 接入前关闭 DEC-005

### Exit

E2E-001 与 CASE-AGENT-01/02/03/04、CASE-PRIVACY-01 通过；自然语言经同一应用服务创建 Task、Preview 与授权提交，完整 Tool Matrix 可验证。模型中断不重复写入，Hermes 与真实 Provider 验证单独记录。

### Current implementation boundary

Pure `agent-core` 已实现有限 Agent Loop、完整/流式 Model Contract、部分工具 JSON 缓冲、maxTurns/maxToolCalls/run timeout/Abort、Tool Registry、Approval Hook、成功调用收据复用、Context Transform 与前台 Event Coordinator；`agent-tools` 已将 15 个 V1 Tool 逐项绑定到 Application Service，输入/输出使用严格 Runtime Schema，写操作的 operationId/authority 只由宿主生成。`model-runtime` 已提供统一 Adapter、usage/error 映射与可脚本化 Fake Provider。`0006_phase6_agent_runs` 只持久化最小运行 metadata，不保存聊天全文；Task/Achievement 分页、cached Busy 读取和按当前 planRevision 的 Notification reconciliation 已补齐应用入口。自然语言 Capture 有受校验的非持久化结构化 Preview 边界，Mobile 在 Provider 未配置时明确保留原文并转入手工确认。CASE-AGENT-01/02/03/04 与 CASE-PRIVACY-01 的自动化技术子集已覆盖；DEC-005、真实 Provider 兼容、自然语言设备 E2E-001 和生产凭据仍未关闭，因此 Phase 6 不能正式标记 DONE。

---

## Phase 7 — User Model & Replan Intelligence

### Goal

让系统开始学习真实执行模式。

### Related

- REQ-USERMODEL-001
- REQ-SCHED-002

### Deliverables

- estimate bias
- hourly completion rate
- session statistics
- 统计窗口/分类/置信度与权重评审（DEC-007）
- 用户关闭个性化与无样本降级
- scheduler soft constraint integration

### Exit

关闭 DEC-007 后通过 CASE-MODEL-01：固定事实按定义重建特征，未知/部分投入不冒充完整样本；关闭或样本不足时不影响 Scheduler。

### Current implementation boundary

Pure User Model builder、版本化 `0007` UserModelFeature 缓存、UserModelService 原子重建/新鲜度快照、直接用户完整投入覆盖确认、个性化关闭设置，以及 SchedulingSnapshot 到 policy 的特征边界已经实现。自动化技术子集验证未知/部分样本排除、系统 replan 与用户 skip 分离、稳定重建/回滚和“缓存存在也不影响当前中性排程”。DEC-007 仍未关闭，因此 production 观察窗口、分类/阈值/权重没有默认值，Mobile 不允许从关闭切到启用，也不自动刷新或消费特征；技术核心完成不能替代该 Phase Exit。

---

## Phase 8 — Reflection, Check-in & Relax

### Goal

加入正向反馈与可持续节奏。

### Related

- REQ-REFL-001
- REQ-CHECKIN-001
- REQ-RELAX-001
- REQ-PSY-001

### Deliverables

- daily reflection
- energy check-in
- relax tab
- breathing/pause/stretch
- adjust-today flow

### Exit

CASE-REFL-01、CASE-CHECKIN-01、CASE-RELAX-01、CASE-PSY-01 与 E2E-005 通过；Relax / Reflection 与 Today/Replan 可连接，离线有明确能力，不改变自治边界。

### Current implementation boundary

Phase 8 技术核心已经实现：Domain/Application、`0008` SQLite migration/repositories、事实型 Reflection、按记录时区归属的五级 Check-in、真实区间 Relax 状态机、两个可关闭入口偏好，以及 Today/Focus/Relax/Reflection/Replan Mobile 流程均已接入。自动化覆盖 CASE-REFL-01、CASE-CHECKIN-01、CASE-RELAX-01、CASE-PSY-01 的技术子集、幂等、时钟回拨、单 active、migration/checksum/约束/回滚，并验证 SchedulingSnapshot 只把捕获时刻前最新 Check-in 交给 policy。当前 production neutral policy 不消费 Check-in，正式软权重仍需结合生产调度 policy 评审；物理 iOS/Android E2E-005 尚未完成，因此不能正式满足完整 Exit。

---

## Phase 9 — Reliability & Offline

### Goal

综合验证真实移动端不稳定环境；前面阶段已经具备基础事务、幂等、恢复和离线能力，本阶段增加组合故障与长期运行覆盖。

### Deliverables

- crash recovery
- plan version conflict
- offline degradation
- provider timeout
- calendar sync pending
- notification rebuild
- migration robustness

### Current implementation boundary

Phase 9 自动化可靠性基线已经实现：Calendar/Notification Provider 在 Mobile Composition Root 统一采用可配置的有界调用（当前 15 秒）；只读超时进入延迟自动重试，可能产生外部副作用的超时保留 write-ahead ExternalMutationIntent 并进入可核对状态，不盲目重复写入。真实文件型 SQLite 组合测试跨多次关闭/重开验证完整 migration 重入、Schedule Commit 响应丢失重放、Execution active/paused 恢复、Completion/Achievement/Reflection/Relax 精确幂等，以及 Calendar/Notification 离线时 6 个 durable pending Job 不丢失本地事实。既有测试继续覆盖 plan version conflict、通知按当前 revision 重建、migration 失败回滚与外部 intent checkpoint 故障。

该证据是主机自动化技术子集，不是完整 Phase Exit：尚未在物理 iOS/Android 上完成 E2E-001 至 E2E-005、真实 Provider 超时/终止窗口、通知离线投递/重建或长时间运行测试，因此 Phase 9 不能正式标记 DONE。

### Exit

E2E-001 至 E2E-005 在要求的网络/权限状态下通过；组合故障注入不重复业务事实或副作用，不丢失本地提交；所有未解决问题在 STATUS 记录，阻断核心正确性的缺陷不得带入发布。

---

## Phase 10 — Build & Release

### Goal

准备首个公开 Beta。

### Deliverables

- EAS config
- signing
- store privacy text
- release checklist
- critical E2E
- migration upgrade test
- preview / production channel
- OTA、备份/加密/恢复范围的发布前决策（DEC-008/009）
- V1 MUST / SHOULD 交付清单与真实验收证据

### Current implementation boundary

Phase 10 发布工程技术骨架已经建立：App 使用 `0.1.0` / iOS build `1` / Android versionCode `1`；三套 variant 具有独立安装 identity，`apps/mobile/eas.json` 定义 development、internal preview 与 production build/submit profile，根工作区精确锁定 EAS CLI 并提供 preview/production build、submit、release check/gate 命令。production developer-facing 版本由 EAS remote source 自动递增；DEC-008 未关闭时三个 variant 均显式关闭 OTA。静态 release gate 会校验 EAS/App 版本、环境、无 Secret env、双语隐私草案与外部阻塞清单；设备 gate 要求物理 iOS/Android 的 E2E-001 至 E2E-005 完整证据，缺证据即失败。

升级测试还发现早期未发布 Development Build 曾为 `0006_phase6_agent_runs` 写入全零占位 checksum。启动迁移现在只在该唯一已知 id/checksum、其余历史完全匹配且 `agent_runs` 表和索引与当前固定 `0006` SQL 精确一致时原子修复历史标记；任何缺失/被改写 Schema、其他错误 checksum 或非前缀历史仍严格拒绝。iOS 26.5 Simulator 已在不清库的情况下把该真实旧库修复并继续升级到 `0008`，原有 Task/Completion/Achievement 可见，SQLite integrity 为 `ok`，并完成 Relax → 呼吸入口 → 完成 → Today 的 E2E-005 模拟器冒烟；该证据不替代两平台物理设备验收。

当前不能完成签名或商店提交：仓库没有可由 AI 猜测的 Expo owner/projectId、Apple/Google 账号、证书、service account、Privacy Policy URL，也没有关闭 DEC-008/009 等产品/隐私决策。EAS CLI 配置解析已验证会进入账号认证边界，但主机未登录；production/preview cloud build、签名、物理设备关键 E2E 与 store review 均保持 pending，不能用静态配置、Hermes export 或 Simulator 替代。

### Exit

10-BUILD-RELEASE 的 Release Checklist 与 08-TESTING-ACCEPTANCE 的 Release Gate 满足；V1 MUST 均可追溯验收，未交付 SHOULD 已明确说明；无高优先级已知阻塞。原生构建、升级迁移与真机结果不能用 Fake Adapter 测试替代。

---

## Deferred

- Cloud Sync
- Desktop
- Web
- Health integration
- Native Local LLM
- External Calendar write
- Email / IM connectors

---

## User-Authorized Blocked-Task Skip Boundary

2026-09-12，用户授权在无法由本地工程解决的任务阻塞后，明确记录原因并跳过，继续完成至少 95% 的可执行范围。该授权不关闭任何 Decision、不替代真机或商店验收，也不允许把外部条件伪造成完成。

截至该授权，Phase 0–10 的本地技术交付与自动化门禁均已推进到计划末端；STATUS 的 21 个未勾选项全部归入以下外部任务组：

- `BLOCKED-DECISIONS-001`：DEC-001/005/006/007/008/009/011/012 的负责人结论；
- `BLOCKED-PROVIDER-DEVICE-001`：真实模型 Provider、物理 iOS/Android、OS Provider、E2E-001…005 与长期运行验收；
- `BLOCKED-RELEASE-AUTH-001`：EAS/Apple/Google 账号、identifier、签名、Privacy Policy、商店问卷、cloud build 与 submit。

这些任务在 [STATUS](STATUS.md#user-authorized-blocked-task-skip-register) 保持未完成并可追溯。它们不计入用户授权的本地可执行范围：已完成 80 项 / 可执行 80 项；原始正式清单仍是 80 / 101，不能据此宣称完整发布或所有正式 Phase Exit 已完成。

---

<a id="no-credential-optimization-plan"></a>
## No-Credential Optimization Plan

### Objective and scope

计划 ID：OPT-NC-20261003。目标是在不要求用户提供 Token、API Key、Expo/Apple/Google/GitHub 账号或签名材料的条件下，完成下面九个工作包，交付可追溯的本地代码基线、可重复的排程基准、实际运行的本地 UI 旅程、必要的可用性与可靠性修复、模型契约和时间上下文准备，以及待决策方案。

输入依据：[项目分析](STATUS.md#2026-10-03-project-analysis)、[外部参考研究](STATUS.md#2026-10-03-external-reference-research)、[DECISIONS](../docs/DECISIONS.md)。实际进展与命令结果只写入 [Optimization Execution Status](STATUS.md#optimization-execution-status)，本节维护稳定的任务、依赖和验收条件。

可以安装无需账号的必要本地测试工具，创建本地提交和 codex/ 前缀分支，修复已证明违反现有规范的问题。复用当前依赖与框架，测试工具只进入开发工具链；不引入大型生产依赖或进行无关重构。Git 身份必须使用现有有效配置，缺失时记录具体环境缺口，不伪造身份。

本轨道不执行真实云模型请求、EAS cloud build、商店提交、远端推送，不使用项目共享密钥，不假装已获得物理设备证据。生产 priority/权重/拆分、个性化、自动提交/Undo、备份/导出/加密、Calendar/Notification 投影仍遵循对应 Open Decision 的现行默认。DEC-005 未接受前不选定首发 Provider，也不将 Fake Provider 接入生产用户路径。

### Work packages and dependencies

| ID | 优先级 | 工作包 | 前置依赖 | 关联既有验收 |
| --- | --- | --- | --- | --- |
| OPT-01 | P0 | 环境预检与本地 Git 基线 | 无 | Development / Security / 仓库门禁 |
| OPT-02 | P0 | 排程性能与计划移动基准 | OPT-01 的安全/数据隔离预检；Git 提交不阻塞本地测量 | REQ-SCHED-001/002；CASE-SCHED-01/02/03 |
| OPT-03 | P0 | 本地 Development Build UI 自动化 | OPT-01 的环境与数据隔离预检 | REQ-TASK-001、REQ-EXEC-001、REQ-ACH-001、REQ-OFFLINE-001；E2E-003/004 的本地子集 |
| OPT-04 | P1 | 移动端可用性审查与必要修复 | OPT-03 的可运行宿主；可提前进行静态/组件审查 | REQ-TODAY-001、REQ-FOCUS-001；CASE-TODAY-01、CASE-TASK-01、CASE-EXEC-01/02 |
| OPT-05 | P1 | 通用 ModelProvider / Agent 契约缺口 | OPT-01 的安全预检 | REQ-AGENT-001/002/003；CASE-AGENT-01/02/03、CASE-PRIVACY-01 |
| OPT-06 | P1 | Capture 时间上下文与中文案例 | OPT-05 | REQ-CAPTURE-001；CASE-CAPTURE-01 |
| OPT-07 | P1 | 本地事务与恢复覆盖审查 | OPT-01 的数据隔离预检 | CASE-COMMIT-01/02、CASE-OFFLINE-01、CASE-NOTIF-01、CASE-EXEC-02 |
| OPT-08 | P1 | 架构、依赖与文档一致性收口 | 审查可提前；最终收口依赖 OPT-02 至 OPT-07 | REQ-PRIVACY-001；架构、文档与完整仓库门禁 |
| OPT-09 | P1 | 受决策约束的方案与验收包 | 方案草拟可独立；最终结合 OPT-02/04/06/07 的可获得证据 | DEC-001/002/005/007/009/011/012；不关闭决策 |

推荐顺序：OPT-01 → OPT-02 → OPT-03 → OPT-04 → OPT-05 → OPT-06 → OPT-07 → OPT-09 → OPT-08 → 最终验收。依赖只描述工作先后，不授权启动子 Agent 或并发修改相同文件；本轨道默认由同一 Agent 顺序实施。

### OPT-01 — Environment and Git baseline

1. 重读 AGENTS、Context、Status、相关 Canonical Docs；检查工作树、已有修改、Git 历史与身份。先确认现有实现和测试，避免把已有能力重新列为待实现。
2. 检查 pnpm/Node、Xcode/simctl、可用 Simulator runtime、Android SDK/adb/emulator、Java 与候选 UI 驱动。只记录工具版本、是否可用和失败类别，不输出凭据、环境变量全集或用户身份内容。2026-10-03 预检只证明 simctl 可调用；没有 booted device，Maestro/adb 不在 PATH，不能据此声称任一平台已可执行。
3. 审查将入库的文件、Secret 与生成物忽略规则；保留用户工作，不运行 destructive reset 或清理真实数据库。需要新增工具或下载运行环境时先查官方安装/兼容说明，再完成无需账号的合理准备。
4. 使用已配置的 Git 身份建立本地基线提交，记录 commit SHA；后续优化使用 codex/ 分支或复用适合当前任务的分支。若已有提交，不重新初始化或覆盖历史；不配置远端、不推送。

验收：有经过敏感文件审查的可追溯本地提交；环境清单、隔离测试位置与基线验证结果进入 STATUS。身份或 runtime 缺失只阻塞相应子项，继续执行不依赖该条件的工作包。

### OPT-02 — Scheduler benchmarks

实施位置以 packages/scheduler-core、tests/unit/scheduler 和 scripts 为主；计时、文件输出、运行环境读取只位于测试/脚本宿主，不进入 Pure Core。参考 Smart Agentic Calendar 的场景组织，不导入其 Node/Repository 排程器或默认权重。

1. 使用固定 seed、显式 now/时区/policy，构造 50/200/500 Task、7/30 天 horizon，以及低/高 Busy 密度、locked/started/completed 保护块、可拆分/不可拆分、截止紧张等有代表性的组合。限制矩阵规模，记录每个实际运行的组合。
2. 测量 schedule/replan 的预热后耗时分布、移动块数/总偏移分钟、未排程剩余工作量与关键不变量。变化量采用稳定身份与明确匹配规则，无法匹配的新增/删除单列，不能伪装成移动。
3. 建立独立脚本入口和结构化结果，记录 fixture/seed、样本数、运行时、设备/主机类别、代码与 policy 版本。Node 结果与 Hermes 结果分开；Hermes 可运行时采集，缺环境时标明未测量。
4. 仅对证据显示的热点作保持公共行为的局部优化；同输入输出、硬约束、保护块、版本与确定性不能退化。不在本任务调整生产权重或创造未经接受的性能 SLA。

验收：所有规定负载维度有可重复测量记录；固定输入输出稳定、保护与约束检查通过；输出含未优化基线。若修热点，附同环境/同输入前后对比。该包完成不要求人为制造性能改善。

### OPT-03 — Actual local UI journeys

实施位置以 apps/mobile、测试目录和本地驱动脚本为主；优先考察已有文档推荐的 Maestro，实施时重新核对官方平台支持和版本兼容。只使用本地 Development Build，不使用 Expo Go 或付费 Cloud runner。保留现有 test:e2e 的物理证据校验职责。

1. 建立独立 UI 驱动入口、可理解的失败退出码与启动说明；记录驱动版本。至少使一个可用平台的本地 Development Build 实际执行旅程，另一平台配置与未执行原因如实记录。
2. 使用独立模拟器/测试 App 沙盒和合成数据。fixture 经 Application Service 写入；不得给生产 App 增加任意写库、清库或伪造完成的测试后门，不能清除用户现有数据。
3. 执行手工 Task → Preview → Commit → Today/Calendar → Focus 开始 → 暂停 → App 重启恢复 → 继续 → 明确完成 → Achievement 回顾，以及禁用网络后的手工闭环。验证缺估时 inbox 可达、用户拒绝 Preview 不改写计划、重复点击不重复创建事实。
4. 对计时、任务状态与成就采用业务断言，不能只断言“页面能打开”。用稳定无障碍标识和有界条件等待，避免依赖固定坐标、长 sleep、跨测试顺序或已有用户数据。
5. 同一干净测试起点连续运行两次通过；保存执行命令、平台/OS/build、结果和可核对的日志/截图。日志只含合成数据。

验收：独立 runner 已实现，至少一个本地平台的上述旅程实际通过两次。模拟器旅程、手工 Capture 和 Fake OS 行为分别标记，不填写 E2E-001 的真实自然语言或任何 physicalDevice 证据。若所有本地平台均无法运行，源码准备可登记 PARTIAL，OPT-03 保持 BLOCKED，不能作为整个目标完成依据。

### OPT-04 — Mobile usability

对 Today、Capture、Task 编辑、Calendar/块调整、Preview、Focus、Achievement、Settings 与 Relax 做有界审查，优先检查窄屏/大字体、键盘遮挡、滚动与拖动、读屏标签/焦点、disabled/busy、空状态和错误恢复。参考 Super Productivity 的专注暂停、触摸滚动和时区回归思路，不移植其 UI 技术栈。

只修复可复现且违反现有 UI/UX、无障碍或状态规则的问题。Pause 后实际计时停止，恢复不重复过渡；本地已保存而后续 Preview 失败时应保留事实和正确提示。以单元/组件/实际 UI 中适合的证据验证；不为低影响文案修改增加机械测试。

验收：审查范围、发现、修复与复测结果可追溯；没有尚未处理的本轮高优先级可复现缺陷。确无问题时可用审查证据完成，不为了制造交付而重做页面或改变产品规则。容量阈值、新偏好入口等新行为转入 OPT-09。

### OPT-05 — Model and Agent contract preparation

审查 packages/agent-core、agent-tools、model-runtime 和 tests/unit/agent 的已有覆盖；在现有 Fake Provider/通用 ModelProvider 上补真实缺口，不选择未接受的 Provider 或 SDK。

覆盖完整与流式响应、分段 Tool JSON、非法 Schema、未知工具、maxTurns/maxToolCalls/run timeout、Abort、迟到结果，以及工具已提交后流失败的幂等边界。验证模型不能伪造 authority/operationId，错误不包含 raw response、Prompt、Secret 或 stack。新增测试应证明业务/安全不变量，不重复现有实现断言。

验收：契约覆盖矩阵记录已有/新增证据，相关测试和架构检查通过；公开工具和风险语义保持不变。Hermes 执行可用时用隔离开发/测试宿主验证 Fake Provider 的有限运行，不对生产 Capture 开放假 AI；无法执行 Hermes 时单列未验证，不把 Node 或 bundle 成功写成真实 Hermes/Provider 通过。

### OPT-06 — Capture time context

先评审并同步 docs/05-API 与 docs/09-SECURITY 的最小时间 Context 约定，再实施 packages/agent-tools 的技术变更及测试。候选字段为参考 Instant、IANA timeZone 与 locale；由宿主受控注入并运行时校验，不读取隐式时钟或将日历正文、Check-in、Secret 加入 Context。保持现有 Schema、uncertainFields、非持久化草稿和直接用户确认边界，迁移调用方与测试，不静默破坏 Contract。

使用合成中文案例覆盖相对日期、周界/跨年、不同参考时区、DST、仅日期 Deadline、模糊时间/缺估时、取消/失败，以及模型额外字段或伪造权限。存在多种解释的“周五/下周”等输入应保留不确定性，不由测试私自确立产品默认。

验收：时间上下文 Contract/安全允许字段已同步；合法上下文准确进入请求，非法上下文在调用 Provider 前拒绝；date-only 和未知字段不补造精确时间/时长。Fixture 验证的是上下文传递与输出校验，不将脚本化绝对日期当作中文解释准确率，也不建立新的自制 NLP 产品或真实 Provider 接入。

### OPT-07 — Recovery coverage

对照现有 Application/真实 Node SQLite/native facade 测试建立缺口矩阵，重点审查 Preview 失效/版本冲突、提交响应丢失、重启后的 active/paused 执行、完成证据唯一、迁移失败回滚、离线 pending Job、ExternalMutationIntent 与迟到/过时 worker fence。优先复用现有文件型数据库与注入时钟设施。

只有发现未证明的不变量时才增加故障注入；发现实现错误则局部修复并复测。所有数据库操作使用隔离测试库；不改写已发布 migration/checksum，不新增恢复后门，不把 unknown 当作 missing，也不将此包扩展为备份/导出功能。

验收：每个审查重点有已有测试引用或新增证据；真实文件型 SQLite 场景证明关闭/重开与事实完整性。若无缺口，以覆盖审查记录完成。OS 强杀/真实投递未执行时仍保留对应外部门禁。

### OPT-08 — Architecture, dependencies and documentation

检查反向依赖、Pure Core 禁止导入、Tool 到 Application 边界、UI 不直接访问表、Secret 不进入业务 SQLite/输出，以及开发工具不进入 production bundle。审查疑似未使用依赖的实际运行时/native plugin 用途，只删除已确认无用途且可验证的项；不顺带升级框架或重写大型服务。

为本轮实际实现的 benchmark/UI runner 更新 docs/07-DEVELOPMENT、docs/08-TESTING-ACCEPTANCE 与 docs/10-BUILD-RELEASE 的职责和运行环境；必要时同步 API/Security/ADR/CONTEXT。所有新 Markdown 文件都更新 MANIFEST，易变执行结果只在 STATUS 汇总。

验收：架构、依赖与敏感输出审查有证据；代码、脚本、文档职责一致；相关检查与最终完整门禁通过。没有发现依赖问题时不强行删除或添加扫描服务。

### OPT-09 — Decision proposals

将下列优化整理为候选方案、取舍、兼容/数据影响、验收案例和需要负责人明确的最小输入，可写入 DECISIONS 的候选方案区并引用本轮证据；原条目继续 Open，生效前默认保持原样。方案文档不等于正式实现或决策接受。

| 对应决策 | 方案交付范围 | 本目标内不启用的能力 |
| --- | --- | --- |
| DEC-001 | 小规模试用方案；首次开始耗时、Preview 接受/修改、计划移动和维护时间的指标定义；本地最小数据采集取舍 | 招募承诺、已验证价值、默认远端遥测 |
| DEC-011 / DEC-007 | 基础 priority/拆分/稳定性；显式允许/偏好窗口；容量缺口与补救选项；学习特征/Check-in 的低影响候选映射 | 定稿权重、生产个性化、新分类默认或未经用户同意扩展工作窗口 |
| DEC-002 | 前台事件合并/Preview 过期与新鲜度；自动提交风险及 Undo 的候选边界 | 后台常驻 Agent、自动提交、未定义的 Undo |
| DEC-005 | 通用适配验收、Provider 选择维度、BYOK/SecureStore 获取/撤销和费用/错误展示方案 | 首发 Provider 决定、真实请求或客户端共享 Key |
| DEC-009 | 备份位置、加密/导出/恢复范围、schema/version 校验、完成证据唯一和外部 binding 重核对；独立 ADR 草案要点 | 备份/导出通道、加密已验证声明、Cloud Sync |
| DEC-012 | 权限恢复、Android source/account、通知标题/声音/默认与真实设备故障注入检查表 | 新投影默认、静默外部事件修改或伪造设备结果 |

验收：每个列出的决策都有候选取舍、待定参数和验收边界；明确哪些结论来自测量、哪些仍是假设。无需负责人立即回答，也不能把候选方案标成 Accepted ADR。

### Verification and evidence

以下是本轮执行时拟新增的入口，编写本计划时尚不存在，不能预先写成通过。实施者应先建立、文档化并检查实际可执行性：

| 拟新增入口 | 职责 | 通过证据 |
| --- | --- | --- |
| pnpm run bench:scheduler | OPT-02 的固定负载基准；默认不进入普通正确性 CI 的时间阈值门禁 | 实际结果、seed/版本/运行时与约束检查 |
| pnpm run test:ui | OPT-03 的本地 UI 驱动；平台通过显式参数/配置选择 | Development Build 旅程断言、两次运行结果 |
| pnpm run test:hermes | OPT-02/05 的隔离 Hermes 测试宿主；与 UI 顺序执行 | 实际 Hermes runtime、有限 Fake Agent 与固定排程场景结果 |

既有 pnpm run test:e2e 保持双物理设备证据门禁，pnpm run check 不因本轮优化自动要求未配置的 native runtime。UI runner 的 CI 接入如需本地 runner/原生宿主，按真实可用环境单独配置，不把未运行 job 描述为远端 CI 已通过。

每个工作包记录：状态、变更文件、命令与退出码、环境/覆盖、证据引用、未解决问题、下一步。结构化合成数据结果可放入 .ai/evidence/optimization/；较大的截图、原始构建/驱动日志放入被忽略的本地目录，STATUS 保留结果摘要和位置，不入库用户数据或凭据。禁止只填“已运行”而不保留可核对结果。

每次修改先运行相关检查。阶段收口执行 pnpm run check；全部工作完成且没有新变更后不重复无意义的全量测试。仅文档修改运行 format:check/docs:check 和链接/引用/映射/语义核查；没有业务修改时实现与代码测试标“不适用”，不伪造代码验证。

### Goal lifecycle and completion

本计划仅定义后续执行目标，不自动启动目标、设置 Token 预算或建立定时任务。目标模式的结果、验证面和约束写法参考 [OpenAI 官方 Goals 指南](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)；实际生命周期服从当前宿主提供的目标工具与用户指令。

每轮开始重读 STATUS 的执行表，选择未完成且依赖满足的工作包；先查证实现再修改。遇到账号、产品决定、身份、runtime、权限或设备缺口时记录受影响范围，并继续独立工作；先尝试当前授权范围内可行的本地修复，不把一般测试失败视为外部阻塞。

只有无独立工作可推进且必须依赖用户输入/外部状态改变时才报告目标无法继续；若使用宿主 blocked 状态，按其规则要求同一阻塞在至少三个连续目标轮次重复后再设置。不能自动 paused、用预算耗尽冒充完成，或把工作包的 BLOCKED/跳过算作 DONE。

本目标仅在以下条件全部成立时完成：

- OPT-01 至 OPT-09 全部有实际验收证据并标记 DONE；允许审查类任务以“已审查，无需修改”完成，不能用跳过替代环境依赖任务。
- 本地 Git 基线和优化提交可追溯；benchmark 与 UI runner 是真实可用命令，至少一个本地 Development Build 平台的规定旅程连续两次通过。
- 所有本轮实现与相关测试完成，pnpm run check 通过；涉及 native 依赖的改动有对应实际 Development Build 证据。
- Canonical Docs、必要 ADR、CONTEXT、PLAN、STATUS 和 MANIFEST 按实际影响同步；无未处理的本轮高优先级已知缺陷。
- 真实 Provider、另一未执行平台/Hermes、物理设备、未决产品参数和发布条件逐项保留真实边界；本目标完成只表示本轮本地优化完成，不表示 V1 或原正式 Phase Exit 完成。

### Ready-to-use goal prompt

在当前项目聊天中启用目标模式后，使用下列目标文本；也可直接发送“启动目标模式，按以下目标执行”。目标文本只定义执行范围；计划文件本身不自动启动目标。

```text
完成 /Volumes/A/code/project/nexta/.ai/PLAN.md 中 OPT-NC-20261003（No-Credential Optimization Plan）的 OPT-01 至 OPT-09。先读 AGENTS.md、CONTEXT、STATUS 和对应 Canonical Docs，按依赖逐包实施，不要求我填写 Token、API Key 或发布账号。允许准备必要的无需账号本地测试工具、创建本地 Git 提交与 codex/ 分支；不推送或发布，不选择未接受的 Provider，不关闭 Open Decision，不改生产权重/个性化/自动提交/备份默认。
完成以工作包实际验收证据、可重复排程基准、至少一个本地 Development Build 平台两次通过 UI 旅程、完整 pnpm run check 以及文档同步为准。每轮更新 STATUS 的 Optimization Execution Status，继续未完成且依赖满足的任务。不能将 Fake Provider、bundle 或模拟器结果当作真实模型/物理设备证据，不能把跳过项记为 DONE。
遇到外部条件缺失先记录并推进其他独立工作；没有可行路径时按宿主目标规则报告阻塞、保留未完成项和最小解除条件。全部验收满足后报告代码提交、测试/测量结果、文档影响与剩余外部门禁，结束目标。
```

## Account and Sync Implementation Track

2026-10-25 用户批准的独立扩展，依据 ADR-0010；不改写原 80/101 或 80/80 清单。相关需求：REQ-AUTH-001 / AC-AUTH-001、REQ-SYNC-001 / AC-SYNC-001；验证 CASE-AUTH-01、CASE-SYNC-01。

1. 确定内部账号/完整事实/冲突/设备归属契约，保留 Local-first。
2. Kratos v3、PostgreSQL 18、sqlc/pgx、迁移、账号与设备隔离。
3. 原子批次、租户游标、初始化暂存、冲突与精确重放。
4. SQLite 追加迁移、必要操作来源、Outbox 与无回声导入。
5. 移动端资料隔离、SecureStore、登录/同步/冲突与独立 OS 投影。
6. 真实 PostgreSQL、两 SQLite 客户端、共享契约与 UI/仓库检查；原有发布门禁独立保留。

实际实现、命令、失败及限制只记入 STATUS；本轮无邮件验证/找回、AI 网关、公网部署或跨设备计时接管。
