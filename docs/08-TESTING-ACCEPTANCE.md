# 08 — Testing & Acceptance

## 1. Testing Strategy

本文件定义计划中的验证要求，不代表测试已实现或通过。已执行检查、环境和结果只在 [STATUS](../.ai/STATUS.md) 记录。每条需求的 AC 组见 [Requirements](02-REQUIREMENTS.md)。

```text
Pure Logic
→ Unit / Property / Invariant

Adapters
→ Integration

UI
→ Component / Interaction

Critical User Journey
→ E2E

Architecture
→ Forbidden Dependency Checks
```

---

## 2. Unit Testing

重点：

- Task 状态机；
- Duration / Deadline；
- Scheduler；
- User Model；
- Agent Loop；
- Tool Schema；
- Reflection 事实约束。

---

## 3. Scheduler Tests

必须覆盖：

1. 不与 Busy Event 重叠；
2. 不移动 Locked Block；
3. 不移动 Completed Block；
4. Deadline；
5. Earliest Start；
6. Splittable；
7. Min/Max Block；
8. Insufficient Time；
9. Replan 最小扰动；
10. 相同输入稳定输出；
11. Time Zone；
12. DST 边界；
13. 缺少/耗尽估时、部分排入与不可行原因；
14. 正在执行块保护、手工移动后锁定；
15. 自有日历事件去重、输入已有硬冲突的保留/警告；
16. 相同分数稳定决胜，不读取隐式时钟/随机状态。

建议增加随机化 invariant test。

Scheduler 固定负载基准由 `bun run bench:scheduler` 执行，覆盖 50/200/500 Task、7/30 天范围、两种 Busy 密度及显式示例稳定性 policy。每次测量独立核对受保护事实、硬约束、工作量守恒、集合排列稳定性与输入不变；移动统计按既有块身份匹配，新增/删除不算移动。耗时在预热后采样，正确性检查不计入测量；经验 p95 必须附样本数和环境，不作为既定性能 SLA。Bun/Node 与 Hermes 结果单独报告，不设置会在普通 CI 中抖动的墙钟阈值。

---

## 4. Agent Tests

必须覆盖：

- maxTurns；
- Abort；
- Tool error；
- invalid tool args；
- unknown tool；
- risk confirmation；
- model stream interrupted；
- tool result returned to loop；
- Agent 不能直接写 DB；
- Context minimization。

Provider complete/原生 stream/自定义错误 mapper 使用合成敏感文本验证脱敏；Tool 异常和流错误事件不得泄露原始消息或任意 code/category。预算测试包括忽略 Abort 的 Provider、流、审批和 Tool，验证有界结束、无迟到事件/新工具启动，以及 complete/stream 中成功收据在后续 Provider 失败后可复用。停止等待不替代 Application durable 幂等和设备进程恢复证据。

`test:hermes` 在隔离开发宿主检查 HermesInternal/runtime properties，完整/流式 Fake Agent 必须有限结束、Tool 只执行一次且成功收据正确；同一宿主复用 Scheduler 合成场景与独立后置条件。每个模式的断言、固定 seed、预热/样本数和测量独立入证据。该 smoke 不消费生产 Capture、真实模型、业务 SQLite 或 OS Provider，不代替上述完整主机契约矩阵。Native Preference 诊断只使用独立合成数据库，经 Application Service 写读，记录固定阶段与错误类别，不输出 SQL/参数/stack；它与 Agent/Scheduler 结果单独判定。

本地可用性审查可单独执行 `usability-capture.yaml` 与 `usability-review.yaml`，使用已核对归属的 Android 测试设备、合成 Task/未来 Block 和显式 App/Metro 参数。覆盖 Preview 返回后显式添加下一任务、键盘/窄屏大字体、非法估时不写事实、设置动作与调整 Preview；结果和只读事实核对见 STATUS。改变测试设备字体后恢复原值；Native hierarchy/源码语义审查不能描述成实际 TalkBack/VoiceOver 已通过。

---

## 5. Database Tests

- Migration from previous schema；
- Constraint；
- Index；
- Transaction rollback；
- Achievement evidence integrity；
- Plan/input version conflict；
- CompletionRecord 与 Achievement 来源唯一约束；
- 同时最多一个 running/paused Session；
- OperationRecord / IntegrationJob 与业务写入同事务；
- 本地提交后响应丢失及外部创建后映射未写入恢复。
- `0000 → 0001 → 0002 → 0003` 顺序升级、固定 checksum、重复运行与 late migration rollback；
- IntegrationJob legacy processing 安全转换、notBefore、每通道 claim/lease、过期重领、token + attempt CAS 与旧 worker 拒写；
- Calendar Snapshot/Coverage 的 nullable occurrence 唯一性、complete/partial 删除边界与 Busy stateVersion；
- verified Calendar container/event、Notification identity 与 revision-fenced upsert/delete；
- ExternalMutationIntent 的 job/scope 双唯一、最小 canonical payload、父 Job RESTRICT、intent-first claim，以及 OS 成功后 checkpoint 崩溃的留存/恢复；
- refresh/worker 完成阶段发生晚期错误时 Snapshot/Coverage/Binding/Job/版本完整回滚。

---

## 6. Calendar Integration

至少模拟：

- permission denied；
- empty calendar；
- overlapping events；
- recurring event snapshot；
- complete 与 partial refresh、乱序结果和 bounded range；
- app event create/update/delete；
- external event immutable rule；
- App Calendar 不按 title 猜测、verified container authority；
- 创建/更新/删除响应丢失后的 reconciliation、重复身份和用户编辑 conflict；
- complete/partial/unknown owned-marker inventory 与本地 binding 丢失恢复；
- OS 副作用前 durable intent、跨 revision scope 去重、verified checkpoint 后清除；
- 旧 revision、并发 worker、lease 过期与 permission foreground requeue；授权成功后 Mobile 立即唤醒，拒权不唤醒，唤醒失败保留已提交事实；Calendar provisioning 用户确认先提交再唤醒。

当前已用 Application fake provider、注入 native facade 与真实 Node SQLite 覆盖上述平台无关协议，包括“OS create 返回后、本地 binding checkpoint 前失败”时 intent 保留并避免第二次 create；Expo Calendar Adapter 代码可封装 native API，但真实 iOS/Android 权限、账户/source、重复事件差异、OS 回读及 App 被终止后的恢复仍须设备验收。

---

## 7. Notification Tests

- plan commit registers notification；
- replan cancels obsolete；
- task complete cancels future reminder；
- duplicate scheduling prevented；
- denied permission degrades safely；
- `(timeBlockId, type)` 稳定身份不随 revision 改变；
- schedule/cancel 未知结果先回读，missing/unknown/conflict 不混同；
- complete/partial/unknown owned-marker inventory 与丢失 binding 恢复；
- schedule/cancel 前 durable intent，verified checkpoint 或 missing readback 后原子清除；
- 旧 worker/revision 不能覆盖新 binding，权限请求只由前台动作触发；
- 标题/正文、默认提前量、Android channel 和 sound 由显式 policy/config 控制；
- 用户提醒提前量只接受 `0–1440` 整数，缺失回退到显式宿主默认；有效变化推进 stateVersion、重排当前安全作业，非法/幂等值不制造副作用；
- 偏好在 Provider 调用期间变化时，已核验结果安全 checkpoint，旧快照释放为 pending 后再次收敛；processing、待核对和未解决 intent 不被偏好写入抢占。

当前已实现 IntegrationService 与 Expo Notifications Adapter 的注入 facade 测试、真实 Node SQLite 的 unknown-create/intent/retry/reconciliation/安全偏好重排纵向测试，以及 Mobile 前台协调器 active/inactive、合并 wake、`pending` 再收敛、按通道 drain、关闭等待与用户动作 wake 测试；Settings 已接授权后立即消费和 Calendar provisioning 两步核对恢复。iOS Simulator 已验证 Settings 保存 15 分钟后本地偏好、stateVersion 与 permission-required 作业重排事实。仍没有真实设备权限、锁屏展示、声音/振动、离线投递、取消或进程重启证据。相关产品策略见 [DEC-012](DECISIONS.md#dec-012)。

---

## 8. UI Tests

重点：

- Today；
- Capture；
- Schedule Preview；
- Schedule Preview 使用结构化类型/原因/风险 code 生成本地化说明；显示 Snapshot 任务标题、跨日日期、调整 before/after、时区、Busy 新鲜度、Deadline 与受保护块结论，未知内部诊断不直接泄露；
- Calendar 的稳定 TimeBlock 更新使用 Reanimated 布局过渡并遵循系统 Reduce Motion；动画不参与事实计算；
- Calendar 可按所选本地日的真实 UTC 范围生成 Replan Preview，前/后一天与重排动作有读屏语义；
- Focus：新建 Session 时的 10 秒 Mindful Transition 可跳过、可在 Settings 关闭；恢复已有 Session、reload 与 Relax 返回不重复展示；秒级执行事实派生的分钟文案不泄露浮点尾数；
- Achievement；
- Relax；
- Permission；
- Offline；
- Empty；
- Error。

`bun run test:ui` 与 `test:e2e` 分开：前者用本地 Maestro 驱动 Development Build，后者保留物理设备证据门禁。手工旅程包含缺估时收件箱、拒绝 Preview 不改变计划、Task/Preview/Commit/Calendar/Focus/暂停/进程重启/继续/明确完成/成就来源，并用隔离 SQLite 只读断言核对唯一事实与暂停计时不增长。每次从重装测试 App 的干净沙盒开始；至少两次连续通过才满足对应重复性要求。网络禁用必须有实际平台证据，iOS 上无效果的飞行模式命令不能记为离线通过；未执行离线时结果必须明确标记 partial。当前实现/平台限制与实跑结果只记入 STATUS。

---

## 9. E2E Critical Journeys

### E2E-001 Capture → Schedule

```text
输入自然语言
→ 创建 Task
→ Preview
→ Commit
→ Calendar 出现 TimeBlock
```

### E2E-002 Conflict → Replan

```text
已有计划
→ 新增 Busy Event
→ Replan
→ 计划移动
→ 通知更新
```

### E2E-003 Execute → Achievement

```text
开始
→ 完成
→ Execution 保存
→ 明确完成整个任务
→ Task completed + CompletionRecord
→ 用户允许时 Achievement 生成
→ Today's Wins 显示
```

### E2E-004 Offline

```text
断网
→ 手工入口新建 Task
→ 本地排程
→ 开始/完成
→ 成就记录
```

### E2E-005 Relax

```text
打开 Relax
→ 1 分钟呼吸
→ 完成
→ 返回 Today
```

Simulator 冒烟可以验证页面接线、Expo SQLite 写读和迁移兼容路径，但不能填写物理设备 Evidence Gate。迁移测试还必须证明已知旧开发标记只在真实 Schema 完全匹配时修复，Schema/索引缺失、任意其他 checksum 或其他历史损坏均保持失败且不改写历史。

---

## 10. Security Tests

- Secret redaction；
- SecureStore；
- invalid tool schema；
- destructive action confirmation；
- LLM context minimization；
- no forbidden Node API；
- calendar write boundary。

---

## 11. Definition of Done

```text
[ ] 当前阶段负责的 Requirement AC 满足（部分交付不能标整条 DONE）
[ ] Typecheck 通过
[ ] Lint 通过
[ ] Unit tests 通过
[ ] Architecture tests 通过
[ ] Relevant integration 通过
[ ] Relevant E2E 通过
[ ] Docs 同步
[ ] 无高优先级已知阻塞
```

---

## 12. Release Gate

```text
[ ] iOS Development Build PASS
[ ] Android Development Build PASS
[ ] DB Migration PASS
[ ] Calendar Permission PASS
[ ] Notification Permission PASS
[ ] Offline Core PASS
[ ] No Secret in bundle/log
[ ] Crash-free smoke test
[ ] Critical E2E PASS
```


---

<a id="requirement-matrix"></a>
## 13. Requirement → Phase → Acceptance → Verification

本表是覆盖关系的权威索引，阶段顺序见 [PLAN](../.ai/PLAN.md)。阶段号表示首次落地与后续集成；Phase 9/10 的综合验证不替代首次实现时的基础可靠性测试。本表不表达实时完成状态；已实现子集、执行环境和仍缺证据只在 [STATUS](../.ai/STATUS.md) 记录。

| Requirement | Priority | AC 组 | Phase | 关键场景 / 验证方式 |
| --- | --- | --- | --- | --- |
| REQ-CAPTURE-001 | MUST | AC-CAPTURE-001 | 6；手工入口 4 | CASE-CAPTURE-01、E2E-001；Schema/模型失败/UI |
| REQ-TASK-001 | MUST | AC-TASK-001 | 1、4、5 | CASE-TASK-01、CASE-EXEC-01；状态机/事务 |
| REQ-GOAL-001 | SHOULD | AC-GOAL-001 | 1；集成回顾 5 | CASE-GOAL-01；关系/汇总/归档 |
| REQ-SCHED-001 | MUST | AC-SCHED-001 | 2 | CASE-SCHED-01/02；固定样例/属性/不变量 |
| REQ-SCHED-002 | MUST | AC-SCHED-002 | 2–5、7–8 | CASE-SCHED-02/03、E2E-002；重排与事件集成 |
| REQ-SCHED-003 | MUST | AC-SCHED-003 | 2–4 | CASE-COMMIT-01/02/03；事务/版本/幂等/Undo |
| REQ-TODAY-001 | MUST | AC-TODAY-001 | 4–5 | CASE-TODAY-01；有当前块/候选/空状态/离线 UI |
| REQ-CALENDAR-001 | MUST | AC-CALENDAR-001 | 3 | CASE-CALENDAR-01；Fake Adapter + 真机权限/回读 |
| REQ-CALENDAR-002 | MUST | AC-CALENDAR-002 | 3 | CASE-CALENDAR-02、CASE-COMMIT-02；归属/同步恢复 |
| REQ-NOTIF-001 | MUST | AC-NOTIF-001 | 3、5 | CASE-NOTIF-01；重建/取消/权限/真机通知 |
| REQ-EXEC-001 | MUST | AC-EXEC-001 | 5；完成事实基础 1 | CASE-EXEC-01/02、E2E-003；区间恢复/并发/状态机 |
| REQ-ACH-001 | MUST | AC-ACH-001 | 5 | CASE-ACH-01、E2E-003；来源/唯一/opt-out |
| REQ-REFL-001 | SHOULD | AC-REFL-001 | 8 | CASE-REFL-01；事实约束/离线摘要/UI |
| REQ-CHECKIN-001 | SHOULD | AC-CHECKIN-001 | 8 | CASE-CHECKIN-01；可关闭/软约束/时区 |
| REQ-RELAX-001 | MUST | AC-RELAX-001 | 8 | CASE-RELAX-01、E2E-005；Session/返回执行 |
| REQ-FOCUS-001 | MUST | AC-FOCUS-001 | 5 | CASE-EXEC-01/02；结束 Session 与完成 Task 的交互 |
| REQ-USERMODEL-001 | MUST | AC-USERMODEL-001 | 7；事实采集 1、3、5 | CASE-MODEL-01；固定数据/缺样本/关闭个性化 |
| REQ-AGENT-001 | MUST | AC-AGENT-001 | 6 | CASE-AGENT-01；Hermes/预算/中止/崩溃隔离 |
| REQ-AGENT-002 | MUST | AC-AGENT-002 | 6 | CASE-AGENT-02；完整 Tool Matrix/动态风险/幂等 |
| REQ-AGENT-003 | MUST | AC-AGENT-003 | 6 | CASE-AGENT-03；Fake/真实 Provider 的 complete/stream |
| REQ-AGENT-004 | MUST | AC-AGENT-004 | 6、9 | CASE-AGENT-04；事件合并/恢复/后台窗口终止 |
| REQ-OFFLINE-001 | MUST | AC-OFFLINE-001 | 1–8；9 综合 | CASE-OFFLINE-01、E2E-004；无模型/断网/权限拒绝 |
| REQ-PRIVACY-001 | MUST | AC-PRIVACY-001 | 1、3、6；10 发布 | CASE-PRIVACY-01；Context/日志/审计字段/凭据检查 |
| REQ-PSY-001 | MUST | AC-PSY-001 | 5、7、8、10 | CASE-PSY-01；文案与生成样例审查 |

SHOULD 若未交付，Beta 范围评审需明确列出，不删除 Requirement 或把缺失记为通过。

## 14. 关键验收场景

以下是可实施的 Given/When/Then 基线；测试数据使用注入时钟、固定时区和 Fake Adapter，真机检查另行记录。

| ID | Given / When | Then |
| --- | --- | --- |
| CASE-CAPTURE-01 | 输入“周五前写报告”；模型缺估时或失败；Task 创建后排程 Preview 失败 | 保留输入/日期语义，缺值待确认，可进入手工表单；不静默造时间；已创建 Task 明确显示本地已保存且不重复创建 |
| CASE-TASK-01 | Task 有有效约束；移动键盘输入本地日期/时间与智能标点；非法 Duration/时间顺序/块边界/状态 patch/父子环提交；创建缺估时 inbox；分别修改总估时/显式剩余估时并 Replan；编辑提交后 Preview 失败；取消 inbox 或正在执行/已排程 Task | 合法约束按 IANA 时区解析，date-only Deadline 保留日期/时区但不伪造硬截止；总估时、显式剩余值与派生实际投入不互相覆盖；非法写完整回滚；已提交编辑与未生成 Preview 分开表达；未排程项和缺估时 Task 可直接进入对应编辑页并生成新 Preview；未来 Calendar Block 可进入 Task 编辑；完成仅经用例并保存证据；取消关闭活跃区间并 abandon Session、取消关联未完成 Block、重建必要同步作业且不生成 CompletionRecord/Achievement，晚期失败整体回滚 |
| CASE-GOAL-01 | 创建 Goal/Project 并从 Goal 或 Project 拆出 Task；完成、取消、分页、归档 | Goal/Project 列表稳定有界且默认排除 archived；关联由 TaskService 校验；进度按数据模型计数、去重并排除 canceled/分组父项；归档两步确认并保留事实，分母为零显示无可汇总任务而不是 0% |
| CASE-SCHED-01 | Busy、Deadline、工作窗口、拆分限制与不足空闲 | 新块不破坏硬约束；未排入剩余工作量有原因；同输入同版本完全稳定 |
| CASE-SCHED-02 | Locked/Started/Completed 块与新增 Busy 冲突 | 保留受保护事实、报告冲突，不移动历史或运行中块，不宣称冲突已解决 |
| CASE-SCHED-03 | 用户从 Today 主动 Replan、拖动块或迟开始；跨天/临近开始等条件 | 主动请求可达且只生成 Preview；Preview 以任务标题区分变更/未排程项，显示 before/after、跨日日期、结构化原因、时区/Busy/Deadline/保护结论；只有未来 planned 块可调整/解锁，已开始、已完成或开始时间已到的块只读；拖动后锁定；按确定性策略 Preview/确认；阈值未知不自动提交 |
| CASE-COMMIT-01 | Preview 后 Task/Busy/时区改变，或时间过期/App 重启 | 旧 Preview 拒绝；事务内版本比较生效；不接受替换 diff 或沿用旧确认 |
| CASE-COMMIT-02 | 本地提交后响应丢失；OS 创建后映射写入前崩溃 | 复用 operationId 返回同一提交；同步状态独立；回读核对或进入待核对，不重复创建 |
| CASE-COMMIT-03 | 自动策略未接受；或启用自动提交后请求 Undo，期间另有更新/开始执行 | 前者不得自动提交；启用后验证安全反向变更或明确冲突/过期，不删除执行事实 |
| CASE-CALENDAR-01 | 拒权、重复实例、不完整/乱序刷新、自有事件回读 | 本地可用；限定读取范围；partial 不删除/不写 coverage；complete 原子删除未见项；仅有效 Busy 变化增版；自有 verified 映射不重复算 Busy |
| CASE-CALENDAR-02 | App 事件新增/移动/删除、响应未知、重复身份或被用户在系统日历修改 | 仅操作已验证 container/event 归属；reconcile-before-write、readback 后绑定；差异/未知可见；外部用户事件始终不可写 |
| CASE-NOTIF-01 | 重排/完成后旧提醒存在；权限拒绝、结果未知、lease 崩溃或过时作业返回 | 稳定身份去重；旧提醒取消或显式待处理，按最新计划恢复；旧 claim/revision 不将映射标为新版本已同步 |
| CASE-EXEC-01 | 4 小时 Task 拆四块；新建 Session 进入/跳过可选过渡，结束第一块、请求更多时间再明确完成整个任务 | 新建 Session 的 10 秒过渡可跳过/关闭且不改写执行事实；结束本次只结束 Session/Block；请求更多时间在提交 Session 后调用 Replan 且如实区分后续 Preview 失败；完成整个任务保存一次完成证据并取消未开始块 |
| CASE-EXEC-02 | running/paused 重启、重复开始/完成、从 Relax 返回、时钟异常 | 恢复区间与状态且不重复显示新建过渡、至多一个活跃 Session、无重复事实；abandon 不留下 started 块；异常计时可核对 |
| CASE-ACH-01 | 无计时手工完成、重复调用 achievement.create、选择不记录 | 稳定来源且唯一；未知耗时不补造；尊重 opt-out；隐藏不删除事实 |
| CASE-TODAY-01 | 存在当前块/只有候选/任务均不可排/无任务 | 显示相应 Now、原因或空状态，下一步可操作；空状态可添加任务、进入本周日期条或主动 Relax；Wins 来自真实完成 |
| CASE-MODEL-01 | 已知完整/部分/未知投入、显式跳过和系统重排混合样本 | 按文档分母分类；未知排除并显示样本数；未达阈值/关闭个性化时不影响排程 |
| CASE-REFL-01 | 本地完成记录存在、模型离线或生成虚构成果 | 可用事实摘要；拒绝无来源成果，允许用户备注 |
| CASE-CHECKIN-01 | 关闭 Check-in 或输入低精力，随后跨时区 | 不强制、不医疗化；按记录时区归属日期；只作软约束并遵守提交策略 |
| CASE-RELAX-01 | 从 Focus/Today 进入并完成/中止 Relax | 保存真实区间；可返回开始任务/再休息/调整今天，不伪造 Task 完成 |
| CASE-AGENT-01 | 达到预算、Abort、崩溃或未知工具 | 停止新执行；已提交事务可恢复；无 forbidden import |
| CASE-AGENT-02 | 逐个测试全部 Tool 的合法/非法参数及扩大权限请求 | 输入/输出校验、动态风险与权限生效；调用受限服务；不伪造完成、通知或权限 |
| CASE-AGENT-03 | partial tool JSON、流中断、Provider 错误、正常 complete/stream | 完整校验后才执行；统一 usage/error；不重放成功写操作 |
| CASE-AGENT-04 | 重复通知/恢复事件、后台窗口被终止 | 合并/去重；前台核对事实后恢复；不假定后台一直运行 |
| CASE-OFFLINE-01 | 关闭网络且未配置模型；手工 Task 到完成回顾 | 本地排程/执行/成就/Relax 可用；AI 明确降级，权限失败不破坏本地提交 |
| CASE-PRIVACY-01 | 数据集中包含 Secret、无关日历、历史日记 | Provider/日志/审计不出现禁止字段；请求范围与数量有界 |
| CASE-PSY-01 | 审查失败、低精力、Relax、Reflection 与模型样例 | 无医疗承诺、人格评价或虚构成就；不把执行状态当诊断 |

## 15. 文档与阶段门禁

- 文档检查包括相对链接及锚点、Requirement/AC/Phase/CASE/E2E 引用、ADR 索引、Manifest、待决策项与 STATUS 的一致性。
- Phase 0 建立 `bun run docs:check` 并纳入 `bun run check`。尚无工程脚本时可执行一次性本地检查，结果写 STATUS，不伪称 bun 检查通过。
- 代码/Integration/设备验证分开记录。Fake Adapter 通过不代表 OS 行为已验证；bundler 检查不代表真机 Development Build 通过。
- 任何缺失的当前阶段必需测试必须报告为未覆盖；不能用空测试套件的零退出码作为功能已验收证据。
