# 02 — Requirements

## 1. 规则

所有 V1 需求必须有 Requirement ID。

必要程度（不是实现状态）：

```text
MUST   V1 必须
SHOULD V1 推荐
FUTURE 后续
```

需求编号稳定保留。每条需求有 `AC-*` 验收组；分阶段落点与验证方式见 [测试与验收映射](08-TESTING-ACCEPTANCE.md#requirement-matrix)。当前实现状态以 [STATUS](../.ai/STATUS.md) 为准，未决规则见 [DECISIONS](DECISIONS.md)。

---

## REQ-CAPTURE-001 — 自然语言任务收集

**Priority:** MUST

用户可以用自然语言输入任务、目标或想法。

系统必须：

- 识别标题；
- 识别显式日期/时间；
- 识别 Deadline；
- 提取预计时长（如用户提供）；
- 不确定信息不得伪造确定值；
- 生成结构化 Preview；
- 经运行时 Schema Validation 与 Application Service 后创建；Agent 入口额外经过 Tool 校验。

手工创建长期可用，不依赖 AI Parse。缺失时长可先存为 inbox；需要排程时要求补充，或展示待确认估时，不静默假造值。

**Acceptance — AC-CAPTURE-001**

- “周五前完成报告，大概 2 小时”能生成 Deadline + Duration；
- 模糊输入不会静默生成虚假精确时间；
- 创建失败不会留下半写入状态。

---

## REQ-TASK-001 — Task 基础模型

**Priority:** MUST

Task 至少支持：

- title
- description
- status
- priority
- estimatedDuration
- actualDuration（从有效执行区间派生；未知不填充，禁止任意 patch）
- earliestStart
- deadline
- splittable
- minBlockDuration
- maxBlockDuration
- energyDemand
- projectId
- parentTaskId
- schedulingPolicy

**Acceptance — AC-TASK-001**

- Task 可创建、编辑、完成、取消；
- 状态迁移有校验；Task、TimeBlock 与 Session 的完成分别处理，见 [状态规则](04-DATA-MODEL.md#state-transitions)；
- Project 基础关联与归档可保留 Task，删除及复杂依赖不借 Task CRUD 隐式实现；
- 业务层不允许非法 Duration。

---

## REQ-GOAL-001 — 轻量 Goal

**Priority:** SHOULD

Goal 用于表达长期意图，可关联 Project / Task。

V1 不要求复杂 OKR。

**Acceptance — AC-GOAL-001**

- 可创建 Goal；
- 可从 Goal 拆出 Task；
- Goal 进度由关联 Task / Project 汇总，不手工制造虚假进度。

---

## REQ-SCHED-001 — 自动排程

**Priority:** MUST

Scheduler 根据：

- Deadline
- Priority
- Duration
- Earliest Start
- Existing Calendar Events
- Working Hours
- Locked TimeBlocks
- Splittable
- Min/Max Block
- Energy Demand / User Preference

生成可执行 TimeBlock。

**Acceptance — AC-SCHED-001**

- 新生成/移动的块不与 Busy Event 重叠；输入中已有受保护块冲突保留事实并显式报告；
- 不违反 Locked Block；
- 未支持的依赖、缺少预计/剩余时长返回明确原因，不输出貌似可执行的块；
- 所有结果可重复计算；
- 相同输入与版本必须产生稳定结果；
- 无法排入时明确返回 Unscheduled + Reason。

---

## REQ-SCHED-002 — 动态重排

**Priority:** MUST

以下事件可触发 Replan：

- 新增/变更 Calendar Event；
- Task 未按计划完成；
- 用户手动移动 TimeBlock；
- Task Duration 变化；
- Deadline 变化；
- 用户主动请求；
- Check-in 触发策略变化。

**Acceptance — AC-SCHED-002**

- 已完成 TimeBlock 不被移动；
- Locked TimeBlock 不被移动；
- 正在执行的时间块不被重排移动；拖动/缩放后的块默认锁定，用户可显式解锁；
- 尽量最小化已有计划扰动；
- Deadline 风险必须显式提示。

---

## REQ-SCHED-003 — Preview / Commit

**Priority:** MUST

重排先生成 Preview。默认由用户确认提交；用户显式开启且确定性策略判为低风险时可自动提交。自动阈值未确定时不启用自动提交，见 [DEC-002](DECISIONS.md#dec-002)。

**Acceptance — AC-SCHED-003**

- Preview 不写持久化；
- Commit 必须校验 Preview 的输入 stateVersion；已提交 planRevision 与算法/策略版本分别管理；
- Plan 已过期时不得直接提交旧 Preview；输入版本与时间有效性校验见 [Commit Contract](05-API.md#commit-contract)；
- 同一提交重试返回同一结果，不重复创建事件、通知或业务记录；
- 自动提交必须有变化记录与可验证的 Undo 路径；Undo 冲突时展示新 Preview，不覆盖较新事实。

---

## REQ-TODAY-001 — Now / Today

**Priority:** MUST

首页优先回答：

> “我现在应该做什么？”

至少展示：

- 当前推荐任务；
- 当前 TimeBlock；
- 预计剩余时长；
- 开始按钮；
- 接下来 1–3 个关键块；
- 今日 Wins 摘要。

不得默认把全部未完成 Todo 作为首页主体。

**Acceptance — AC-TODAY-001**

- 无当前块时展示可执行候选或明确空状态；候选不可执行时展示原因，不输出虚假推荐。
- 开始动作进入 Execution；当前、后续 1–3 块和今日真实 Wins 可区分。
- 日历权限拒绝或离线时仍展示本地数据及新鲜度。

---

## REQ-CALENDAR-001 — 系统日历读取

**Priority:** MUST

在用户授权后读取系统日历的 Busy Event。

**Acceptance — AC-CALENDAR-001**

- 未授权时有 Permission State；
- 拒绝权限时 App 仍可使用本地计划；
- 不读取超出实际调度需要的范围；
- Calendar Adapter 与 Domain 解耦。

---

## REQ-CALENDAR-002 — App 日历写入

**Priority:** MUST

V1 优先写入 App 自有 Calendar。

**Acceptance — AC-CALENDAR-002**

- 创建的 TimeBlock 可同步为系统日历事件；
- 删除/移动自己的 TimeBlock 可同步；
- 不静默修改用户原有第三方事件。

---

## REQ-NOTIF-001 — 本地提醒

**Priority:** MUST

Scheduler Commit 后生成本地通知计划。

**Acceptance — AC-NOTIF-001**

- 通知由 OS 调度，不依赖 JS 常驻；
- Replan 后旧通知必须撤销/更新；
- 用户可配置提醒提前量；
- App 无网络时仍可触发已注册本地通知。

---

## REQ-EXEC-001 — Execution Session

**Priority:** MUST

用户点击“开始”后创建 Execution Session。

支持：

- start
- pause
- resume
- complete
- abandon

**Acceptance — AC-EXEC-001**

- 实际耗时可计算；
- App 重启后 Session 状态可恢复，包括仍处于暂停中的区间；
- 同时最多一个 running 或 paused Session；重复 start/complete 不创建重复 Session；
- 无计时记录的手工完成可成立，实际耗时保持未知；
- 完成任务时将实际数据反馈给 User Model。

---

## REQ-ACH-001 — Achievement / Success Diary

**Priority:** MUST

V1 的 Achievement 以真实 Task 完成事件为依据；Milestone 通过明确的任务完成证据表达，不新增无需求定义的 Milestone 实体。

原则：

- 必须基于真实完成事件；
- AI 可润色表达，但不得虚构不存在的成果；
- 必须保留来源证据。

**Acceptance — AC-ACH-001**

- Achievement 必须关联稳定 CompletionRecord；无计时 Session 的手工完成也是有效来源，但不得推算实际耗时；
- 同一完成事件至多产生一条 Achievement，反复调用 Tool 不重复生成；
- 用户可编辑标题和备注；
- 用户可选择不记录某项；
- 日/周可回顾。

---

## REQ-REFL-001 — Daily Reflection

**Priority:** SHOULD

每日提供 1 分钟以内轻量复盘：

- 今日完成；
- 计划与实际差异；
- 1–3 个 Wins；
- 一个可执行的明日调整建议。

不得输出人格评价或医疗判断。

**Acceptance — AC-REFL-001**

- 摘要中的完成、投入与 Wins 能关联本地事实；未知耗时不补造。
- 模型不可用时可显示本地事实摘要并填写备注。
- 不输出人格评价、诊断或未发生的成果。

---

## REQ-CHECKIN-001 — Energy Check-in

**Priority:** SHOULD

用户可用极简方式记录主观精力：

```text
很低 / 偏低 / 一般 / 不错 / 很好
```

**Acceptance — AC-CHECKIN-001**

- 默认不强制；
- 不解释成医疗状态；
- Scheduler 可把它作为软约束；
- 用户可关闭。

---

## REQ-RELAX-001 — Relax

**Priority:** MUST

Tab Bar 提供“放松”。

V1 提供：

- 1 分钟呼吸
- 3 分钟放空
- 5 分钟拉伸
- 简单环境声 / 静默模式（音频能力可按 Phase 实施）

**Acceptance — AC-RELAX-001**

- 不要求注册课程；
- 不做医疗承诺；
- Relax Session 可记录开始/结束/时长；
- 用户可从 Focus / Today 直接进入；
- 结束后可选择“开始任务 / 再休息 / 调整今天”。

---

## REQ-FOCUS-001 — Mindful Focus

**Priority:** MUST

开始任务时进入低噪音 Focus Mode。

Focus Mode 主要展示：

- 当前任务；
- 剩余/已用时间；
- 完成；
- 需要更多时间；
- 暂时无法继续。

不得持续展示大量未完成任务。

**Acceptance — AC-FOCUS-001**

- 结束本次专注与完成整个任务是可区分的动作，结果遵守数据模型的状态迁移。
- 更多时间和暂时无法继续进入明确的延长/暂停/结束路径，必要时产生重排 Preview。
- 重启恢复后展示可解释的计时状态；不存在依赖界面定时器才正确的事实。

---

## REQ-USERMODEL-001 — 基础执行模型

**Priority:** MUST

V1 至少学习：

- Task 类型的估时偏差；
- 时段完成率；
- 平均 Session 长度；
- 推迟/跳过频率；
- Split Block 的完成情况。

所有统计必须有：

- sampleCount
- confidence
- lastUpdatedAt

样本不足不得做强结论。

**Acceptance — AC-USERMODEL-001**

- 每项输出能说明统计口径、样本数、版本与更新时间；相同事实及版本产生稳定结果。
- 未分类、耗时未知、观察窗口未闭合的数据不冒充完整样本。
- 未达到已配置样本阈值时不影响 Scheduler；阈值未定时采用不启用个性化的降级行为。

---

## REQ-AGENT-001 — Local Agent Runtime

**Priority:** MUST

Agent Loop、Tool Registry、Tool Execution、Agent State、Memory Metadata 在设备本地运行。

**Acceptance — AC-AGENT-001**

- Hermes Compatible；
- 不依赖 `node:*`；
- 不依赖 Shell / Process；
- 可中止；
- 可限制 maxTurns；
- 每个 Tool 有 Schema 与风险级别；
- Agent Crash 不破坏业务事务。

---

## REQ-AGENT-002 — Agent Tool Set

**Priority:** MUST

V1 工具至少包括：

```text
task.create
task.update
task.complete
task.list

calendar.listBusy

scheduler.preview
scheduler.commit
scheduler.replan

execution.start
execution.complete

achievement.create
achievement.list

notification.reschedule

preference.read
preference.update
```

**Acceptance — AC-AGENT-002**

- 本节每个工具均有输入/输出 Schema、应用服务入口、风险判定和错误/幂等约定。
- task.complete、execution.complete、achievement.create 遵守同一完成证据规则；重复调用不重复制造完成与成就。
- scheduler.replan 只产生 Preview；实际提交必须走 scheduler.commit。

---

## REQ-AGENT-003 — Model Adapter

**Priority:** MUST

Agent Core 不绑定单一 LLM Provider。用户未配置 Provider 时手工入口与本地核心仍可用。

支持统一接口：

- complete / stream
- tool calling
- abort
- usage metadata
- provider error mapping

V1 可采用远端模型推理；Agent 仍然是 Local Runtime。

**Acceptance — AC-AGENT-003**

- Fake Provider 可验证 complete、stream、tool calling、abort、usage 与统一错误。
- 流式工具参数完成且通过校验后才执行；部分 JSON 不触发写操作。
- Provider 中断不重放已经成功的写操作，真实 Provider 的兼容性单独记录。

---

## REQ-AGENT-004 — Event-driven Agent

**Priority:** MUST

Agent 不常驻后台。

合法触发：

- 用户输入；
- App 前台恢复；
- 用户完成任务；
- Calendar Change；
- 通知点击；
- OS Background Task 获得执行窗口；
- 用户手动 Replan。

**Acceptance — AC-AGENT-004**

- 只在列出的实际事件被观测且执行窗口有效时运行。
- App 恢复时重新读取本地事实及可用日历；不假定后台已实时接收到变更。
- 重复触发可合并，后台窗口终止不会丢失已提交事实，未完成工作可在前台恢复。

---

## REQ-OFFLINE-001 — Offline-first

**Priority:** MUST

离线时必须支持：

- 查看 Today；
- 查看 Calendar 本地数据；
- 创建/编辑 Task；
- 开始/完成 Execution；
- 完成任务；
- Success Diary；
- Relax；
- 本地排程。

需要 LLM 的增强功能可降级。

**Acceptance — AC-OFFLINE-001**

- 从手工入口创建 Task → 本地 Preview/Commit → 开始 → 完成任务 → 成就回顾全链路不调用远端模型。
- Calendar/Notification 权限拒绝时本地提交仍可成功，并显示同步或权限状态。
- 断网期间不显示未完成的日历读取或模型请求为已成功。

---

## REQ-PRIVACY-001 — 最小数据外发

**Priority:** MUST

调用远端模型时仅发送当前任务必要 Context。

禁止默认发送：

- 整个数据库；
- 全量历史 Success Diary；
- 全量 Calendar；
- Secret；
- 无关个人内容。

**Acceptance — AC-PRIVACY-001**

- 使用包含无关日历与历史成就的测试数据时，Provider 请求仅包含当前操作需要的字段。
- Prompt、工具结果和日志不包含 Secret；Provider 鉴权仅由受限凭据适配层处理。
- Context 字段允许列表及用户权限由应用策略控制，模型不能扩大读取范围。

---

## REQ-PSY-001 — 非医疗心理学边界

**Priority:** MUST

系统可使用：

- 自我效能；
- 执行意图；
- 行为反馈；
- 正念式专注；
- 轻量复盘。

不得：

- 诊断心理疾病；
- 解释用户“为什么有某种心理问题”；
- 宣称治疗效果；
- 根据完成率给用户负面人格标签。

**Acceptance — AC-PSY-001**

- Focus、Relax、Reflection、User Model 的固定文案与生成样例不出现诊断、治疗承诺或负面人格标签。
- 不确定的推断可省略，真实完成数据不能被转写成心理病因。


---

<a id="replan-policy"></a>
## 跨需求规则 — 自动重排与用户控制

本节共同约束 REQ-SCHED-002/003、REQ-FOCUS-001 与 REQ-AGENT-002/004；验收场景见 CASE-SCHED-02、CASE-SCHED-03、CASE-COMMIT-03。

| 触发/变更 | 系统可自动做什么 | 提交条件 / 用户反馈 |
| --- | --- | --- |
| 用户手动 Replan、未开始、估时变化 | 基于当前事实生成 Preview | 默认确认；开启自动策略且全部条件满足后可自动提交，并显示变更原因 |
| Calendar Change | 刷新授权范围内的快照、检查冲突、生成 Preview | 仅处理实际观测到的变更；App 未运行时不承诺即时维护 |
| 跨本地日移动、引入/扩大 Deadline 风险、大范围变更 | 提供替代方案和原因 | 始终确认；大范围数值阈值未定时不进入自动分支 |
| completed、started 或 locked Block | 保留事实并报告冲突 | 重排不得移动；Locked 只能通过用户显式解锁后再 Preview |
| 用户拖动/缩放 | 校验合法性、生成待提交调整；调整后的块 locked=true | 用户确认的有效拖动可提交该变更；连带调整超出已展示范围时另做 Preview |
| Check-in、Relax 结束 | 记录用户输入，按软约束计算建议 | 不自动解释为医疗状态；仍遵守同一提交策略 |
| App 恢复/后台窗口 | 对齐本地事实、重试待同步工作 | 不绕过确认，不要求 LLM 才能完成本地恢复 |

自动提交必须同时满足：用户已启用；策略版本与阈值已接受；仅调整同一调度本地日内的未锁定、未开始未来块；无新增/扩大 Deadline 风险；不批量取消；变化量与临近开始窗口均在策略内；Preview 有效。任一条件未知或不满足，展示 Preview。风险由应用层按实际 diff 判定。

Undo 是基于当前版本的反向变更：仅撤销该操作拥有且仍可安全恢复的未来计划，不删除真实 Execution/Completion；版本、时间或 Busy 事实变化时返回冲突并重新 Preview。保留期见 DEC-002，未确定前不开放依赖 Undo 的自动提交。
