# AI Context

## Project Summary

Nexta / 步迹（暂定）是 Mobile-first、Local-first 的 AI Personal Execution Agent。

> 把“想做什么”持续转化为现实可执行的“下一步”，记录真实完成与执行模式，让未来计划越来越适合用户本人。

## Scope and Status

- V1 范围和必要程度：[Product](../docs/01-PRODUCT.md) / [Requirements](../docs/02-REQUIREMENTS.md)。不要把 SHOULD 自动当作 MUST。
- 当前实现与验证证据：[STATUS](STATUS.md)。文档 Accepted 不等于已实现。
- 阶段依赖：[PLAN](PLAN.md)。首个闭环使用手工任务入口；自然语言随后接入同一应用用例。
- 未决问题及生效前默认行为：[DECISIONS](../docs/DECISIONS.md)。不得静默把候选设计变成既定范围。
- 用户已授权在本地无法解决的决策、Provider/真机与发布账号任务上记录阻塞并跳过，以完成至少 95% 的可执行范围；跳过清单见 [STATUS](STATUS.md#user-authorized-blocked-task-skip-register)，不等于正式 Phase 或发布完成。
- 2026-10-03 已规划并按用户目标启动[无需凭据优化轨道 OPT-NC-20261003](PLAN.md#no-credential-optimization-plan)：Git 基线、排程基准、本地 UI 自动化、可用性、模型契约、Capture 时间上下文、恢复覆盖、架构文档与待决策方案。九个包独立跟踪，不改写原 80/80 子集；实际状态见 [Optimization Execution Status](STATUS.md#optimization-execution-status)。
- 技术目标和兼容验证：[Architecture](../docs/03-ARCHITECTURE.md)。此摘要不复制易变版本。

V1 不包含团队协同、正式 Cloud Sync、Desktop/Web 客户端、心理医疗、本地 LLM 推理、修改第三方日历、常驻后台 Agent。

## Core System Model

```text
UI ────────────────┐
                   ↓
Agent → Tools → Application → Domain / Scheduler Core / User Model
                   ↓
                 Ports
                   ↑
           Repositories / Adapters

SQLite = local business truth
OS Calendar = external event truth
SecureStore = secret truth
```

Application 位于 `packages/application`；UI/Agent 共用用例，Composition Root 注入平台实现。Scheduler 只接受显式输入并返回稳定候选，不直接持久化或调用 OS。

## Hard Invariants

1. Domain、Scheduler、Agent Core 与 Application 不依赖 Expo/Node；Agent Tools 不直接访问 DB。
2. Agent 编排工具，最终排程必须经 Scheduler。
3. Agent 不常驻后台；实际观测到的事件与 OS 窗口驱动工作。
4. Secret 不进普通 SQLite、Prompt、日志或客户端共享密钥包。
5. 不静默修改第三方 Calendar Event；App 自有事件按稳定归属映射核对。
6. Calendar/Notification 的后台 refresh/worker 只读权限状态；系统权限请求只来自明确前台动作。
7. 外部结果 unknown 不等同 missing；只有稳定身份可核对且明确允许自动恢复的作业可重试，冲突/归属不明保持可见。
8. Task 完成、TimeBlock 结束、Session 结束是不同事实；不根据预计时长耗尽自动完成 Task。
9. Achievement 必须关联唯一 CompletionRecord，未知投入不补造。
10. User Model 只统计执行行为，不生成诊断或人格标签。
11. 未完成作为计划需要重新适配的信号，不作为人格失败。
12. 品牌未定稿，命名保持可迁移。

完整硬规则见 [AGENTS](../AGENTS.md)，不得只依赖摘要替代当前任务所需规范。

## Commit and Recovery

- Preview 不写 DB，候选保存在内存，以 previewId 引用；App 重启后重新预览。
- stateVersion 表示排程输入版本；planRevision 表示已提交计划版本；schedulerVersion/policyVersion 单独记录。
- Application 事务比较版本，并写本地事实、OperationRecord 与 IntegrationJob；随后同步 Calendar/Notification。
- 本地成功与外部同步状态分别报告；重复请求复用 operationId，未知外部结果先核对，不盲目再创建。
- IntegrationJob 按通道用 claim token、attempt、lease、notBefore 与 CAS fence 串行恢复；Provider 调用不持有 SQLite 事务。每个外部副作用前先独立持久化 ExternalMutationIntent，verified binding checkpoint 与 intent 删除同事务，Job 再以 claim CAS 收口；带未解决 intent 的工作优先恢复。
- Calendar/Notification Provider 在 Mobile Composition Root 统一包裹 15 秒有界调用。只读超时可延迟自动重试；权限请求或 create/update/delete/schedule/cancel 超时属于外部结果不确定，必须依赖 write-ahead intent 和 reconciliation，不能直接重复副作用。
- Calendar Snapshot 只有 complete refresh 可删除未见实例并写 coverage；Calendar/Notification binding 只保存平台 readback verified 的归属/身份。
- Owned-marker inventory 的 partial/unknown 不能推断外部对象不存在；Calendar provisioning 无可靠回查时必须保持待核对，只有直接用户确认缺失才能释放 intent。
- Calendar/Notification 投影由宿主显式 policy 注入；提醒提前量可由直接用户以 `notification.leadMinutes.v1` 保存 `0–1440` 分钟覆盖值，缺失时当前宿主显式默认 `0`。变化会推进 stateVersion 并安全重排当前 Notification Job；投影期间版本变化会在 checkpoint 已核验结果后再次收敛。权限授权或用户确认 Calendar provisioning 确实不存在后，Mobile 会 best-effort 唤醒前台协调器，唤醒失败不改写 durable 提交事实。产品推荐默认/预设仍属 DEC-012，测试值不构成产品默认。
- 默认 Preview + 用户提交；自动阈值未接受时不开放自动提交。
- 已完成、正在执行、Locked Block 不由 Replan 移动；手工拖动/缩放后默认锁定。
- ExecutionSession 与 work/pause Interval 是本地计时事实源；界面定时器只显示。每次 start/pause/resume/finish/abandon 都以同一 SQLite 事务更新 Session、开放区间、Task/Block、OperationRecord 与版本，App reload 后从事实恢复。
- finish_session 只结束本次 Session/关联 Block，complete_task 才创建唯一 CompletionRecord、按用户选择创建唯一 Achievement 并取消未来 planned Block；abandon 保留已投入区间但不生成完成事实。
- Task cancel 是另一条显式终态事务：关闭并 abandon 目标 Task 的活跃执行，取消关联 started/planned Block；Block 变化时推进 planRevision 并写两通道 durable Job。它不创建 CompletionRecord/Achievement，失败必须整体回滚。
- 计时墙钟倒退时区间结束钳制到开始时刻并标记 needs_review，不计入可信投入；无计时完成的实际耗时保持 unknown，Achievement 不补造时长。
- Agent Core 只接受列举的事件触发并受 maxTurns/maxToolCalls/run timeout/Abort 约束；流式参数必须完整结束并通过 Tool Schema 后才执行。read 可自动运行，写操作必须使用宿主批准证据，`external_sensitive` 在 V1 拒绝。
- V1 15 个 Agent Tool 只能调用受限 Application Service；模型不能提供 authority/operationId。Task/成就列表有界分页，Calendar Tool 只返回授权范围内缓存的 Busy 区间与新鲜度，不返回外部事件正文或身份；Notification Tool 只能核对当前 planRevision。
- `AgentRun` SQLite 只保存 id、开始/结束、状态、触发、Provider 名称、turnCount 与脱敏 errorCode，不保存消息或 Tool Result。聊天 Context 由应用显式选择，再经数量/字符边界裁剪；真实 Provider/凭据模式仍受 DEC-005 约束，未配置时自然语言原文转入手工表单。
- User Model 是 Pure TypeScript 的确定性 facts-to-features 层；观察窗口、algorithmVersion、聚合方式和 confidence 样本阈值全部显式传入。`0007` 只保存版本化数值派生缓存，原始事实仍是 Task/Completion/Session/Interval/Block/Event。
- 只有直接用户在完成时明确确认 `allEffortRecorded=true` 才产生 complete 耗时覆盖；Agent 不能代替确认。缺开关按个性化关闭处理；DEC-007 关闭前 production scheduling policy 即使读到缓存也保持中性。
- Reflection 只从指定本地日的 CompletionRecord、TimeBlock 与活跃 Task 生成离线事实摘要；最多三个 Win 必须关联完成证据，用户备注不能被改写成系统结论，刷新不改变排程版本。
- Energy Check-in 是直接用户记录的 1–5 主观软信号，记录时固定 localDate/timeZone 并推进 stateVersion；SchedulingSnapshot 只读取 now 之前最新一条，当前中性 production policy 不应用未评审权重。
- RelaxSession 记录 active/completed/abandoned 的真实区间；同时最多一条 active，时钟倒退钳制为 0/needs_review，完成 Relax 不等于完成 Task。Focus 必须先显式暂停再进入 Relax。
- Reflection/Check-in/Relax 不作诊断、治疗承诺或人格评价；Phase 8 写入只接受直接用户，当前不暴露为 Agent Tool。
- Mobile 手工 Task 约束使用设备 IANA 时区显式解析最早开始/Deadline，并校验 DST、顺序和块边界；date-only Deadline 只保存日期/时区，补充精确时间前不直接生成带硬截止的排程。移动键盘智能标点在严格校验前规范化。
- Mobile 串联 Task 保存与 Schedule Preview 时分别呈现结果；Task 已提交而 Preview 失败必须说明本地事实仍在，避免用户重复创建。
- Focus 的“需要更多时间”先提交 finish_session，再调用 scheduler.replan；Replan 失败不回滚或误报已保存的 Session 结果。
- 新建 ExecutionSession 首次进入 Focus 时可显示 10 秒 Mindful Transition；直接用户可立即跳过或在 Settings 关闭。一次性导航信号接收后即清除，恢复已有 Session、App reload、直接重开与 Relax 返回不重复；展示不新增或改写 Session/Interval 事实。
- 执行/估时分钟保留底层事实精度，Mobile 展示统一为整分钟、“少于 1 分钟”或“约 N 分钟”，不把秒数换算产生的长浮点尾数暴露给用户，也不把展示舍入写回事实。
- Task 编辑把 estimatedDuration 与显式 remainingDuration 分开；actualDuration 只读且来自可信区间。编辑后使用 Replan，未排程项可直接回到对应 Task 修正并生成新 Preview。
- 中文 Schedule Preview 从结构化变更、Busy 完整度、未排程原因和 warning code 生成展示文案；Application 从同一 SchedulingSnapshot 附加只读任务标题供核对，UI 显示 before/after、跨日日期、IANA 时区、Deadline 与受保护块说明。标题不参与 Commit authority，Scheduler 的英文内部 message 不直接作为 UI 或控制流依据。
- Calendar 在 Day Timeline 上提供周一至周日的有界日期条；Today 空状态可直接添加 Task、进入本周日期条或主动进入 Relax，不用先产生计划或开启恢复建议。
- Today、Calendar 和 TimeBlock 调整深链共用结构化中文类型/状态映射与跨日日期展示；只有开始时间尚未到达的 planned Block 暴露为可调整/解锁，started、completed 或开始时间已到的 Block 保持只读，Task Block 仍可进入 Task 详情。
- Goal/Project 由 Mobile Runtime 注入同一 Application UnitOfWork；列表稳定有界、默认排除 archived。Goal 进度只汇总关联 Task 事实；从 Goal/Project 创建 Task 仍由 TaskService 校验引用，两步归档保留任务和历史。

权威语义：[Contracts](../docs/05-API.md#commit-contract)、[Data Model](../docs/04-DATA-MODEL.md#state-transitions)、[ADR-0009](../docs/ADR/0009-application-commit-and-recovery.md)。

## Optimization Execution Boundary

执行 OPT-NC-20261003 时不要求用户提供服务凭据；先做环境/敏感文件预检，再按 PLAN 依赖实施。允许本地测试工具和可追溯提交，不推送或发布；生产策略、Provider 选择、自动提交、备份/导出等 Open Decision 默认保持原样，相关工作只交付候选方案。

完成证据必须包括实际基准、至少一个本地 Development Build 平台的 UI 旅程两次通过、完整仓库门禁与文档同步。benchmark/UI 命令的当前可用性和实际执行结果见 STATUS；现有 test:e2e 继续校验物理设备证据。缺账号、runtime、身份或设备时记录具体未完成项并推进独立任务；Node/Fake 宿主测试或 bundle 不能冒充 Hermes 执行，模拟器不能冒充物理设备，Fake 不能证明真实模型质量，跳过不能计为完成，也不能据此关闭原正式 Phase。

## Verification

需求/AC/Phase/CASE 映射见 [Testing](../docs/08-TESTING-ACCEPTANCE.md#requirement-matrix)；命令职责见 [Build & Release](../docs/10-BUILD-RELEASE.md)。

核心事务、版本冲突、重试、离线与区间恢复随首次功能实现。Phase 9 已在真实文件型 Node SQLite 上组合验证多次进程重开、迁移重复执行、提交/执行/复盘/Relax 精确重放及离线 pending 保持，并对 Provider 读/写超时作故障注入；这仍不替代物理 iOS/Android、真实 OS Provider、E2E-001 至 E2E-005 与长期运行证据。文档检查、Fake Adapter 测试、bundler 检查与真机能力各自报告，不互相代替。

Phase 10 的机器发布基线是 App `0.1.0`、EAS CLI `24.3.0`、development/preview/production 三套独立 variant、remote build-number source 与 production autoIncrement。DEC-008 未关闭时 OTA 显式关闭；release:check 只校验静态配置/隐私草案，release:gate 还要求两平台物理设备 E2E-001…005 证据。Expo/Apple/Google 账号、projectId、签名、商店 identifier 可用性、Privacy Policy URL 和 DEC-008/009 结论必须由授权人员提供，禁止 AI 填造占位值或把登录失败记为发布通过。

迁移历史默认严格按 id 前缀与固定 checksum 校验。唯一兼容桥是早期未发布 Development Build 的 `0006_phase6_agent_runs` 全零占位 checksum：只有其余历史正确且 SQLite 中 `agent_runs` 表/索引与当前固定 `0006` SQL 精确一致时才在事务内修复标记；不允许泛化为修改历史的入口。iOS Simulator 已无清库验证该旧库继续升级到 `0008` 并保留已有事实，物理 iOS/Android 仍须独立升级证据。
