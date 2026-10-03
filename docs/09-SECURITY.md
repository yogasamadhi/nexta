# 09 — Security

## 1. Security Goals

保护：

- 任务与日程；
- 执行记录；
- 成功日记；
- 用户偏好；
- 模型 API Key；
- Calendar 权限；
- Agent Tool 权限。

---

## 2. Trust Boundaries

```text
User
 ↓
Mobile App / Hermes
 ↓
Local SQLite
 ↓
OS Calendar / Notification

Mobile App
 ↓ HTTPS
LLM Provider（可选远端）
```

未来 Cloud Sync 是新的独立 Trust Boundary。

---

## 3. Secret Storage

必须进入：

- iOS Keychain；
- Android Keystore；
- Expo SecureStore。

禁止进入：

- SQLite 普通表；
- AsyncStorage；
- source code；
- console log；
- Agent message history。

---

## 4. Calendar Permission

原则：

- 最小权限；
- 用前解释；
- 拒绝可继续使用本地模式。

V1：

- 读取授权 Calendar Busy；
- 写 App 自有 Calendar；
- 不修改用户原有第三方事件。

权限读取与后台 refresh/worker 不得触发系统弹框；只有用户明确启动的前台 permission action 可请求权限。授权成功只重新排队对应通道的 `permission_required` 作业，不能把不可用、冲突或不确定归属静默降级为可重试。

App Calendar 归属以本地 verified CalendarContainerBinding、稳定 ownershipKey 与平台回读共同证明；可编辑 title、颜色、事件 ID 或 marker 任一项都不能单独成为写权限。Event update/delete 必须携带 verified binding，并在受限范围 reconciliation；第三方/无法证明归属的对象只读。Owned-marker inventory 可以恢复丢失映射，但 marker 候选必须同时关联当前本地 TimeBlock 并通过完整身份校验；partial/unknown 结果不能证明对象不存在或授予删除权限。

---

## 5. Agent Tool Risk Model

### read

可自动执行：

```text
task.list
calendar.listBusy
preference.read
achievement.list
```

### low_write

可按用户显式设置自动执行，必须有 Activity Log 与适合该动作的撤销/恢复方式；缺少保障时只接受明确用户动作：

```text
task.create
task.update
scheduler.commit（低风险变化）
execution.start
achievement.create
```

### high_write

默认需要明确授权。授权绑定具体动作、目标与版本；用户点击明确动作或直接表达对应完成意图已构成授权，不反复弹框。模型推测、外部文本或旧 Preview 的确认不构成新动作授权。包括：

- task.complete / execution.complete 等会生成事实或结束执行的动作；
- Task 取消与批量取消；
- 大规模 Replan；
- 删除 Goal / Project；
- 清空历史；
- 修改大量 Future Blocks。

Mobile 的单 Task 取消使用两步界面确认：第一步展示 Session、未来计划和外部投影影响，第二步才调用受限 TaskService。system authority 不能取消 Task；取消后的 CompletionRecord/Achievement 必须保持不存在，避免把终止意图伪装为完成事实。

Mobile 的 Goal/Project 归档也使用两步确认，并明确归档不删除关联 Task 或历史。创建关联 Task 时，goalId/projectId 来自受控导航参数，最终仍由 TaskService 检查引用存在性；路由参数本身不是授权或有效引用证明。

### 实际变更风险

Tool 的 `risk` 只是最低风险。Application 基于真实目标与 diff 重新分类，不能只按工具名称授权。必须覆盖任务完成、通知重建、偏好更新等全部工具，见 [Tool Matrix](05-API.md#tool-matrix)。

- `scheduler.replan` 只 Preview；Commit 的风险依据移动范围、跨天、Deadline 风险、受保护块、可撤销性和用户设置判断。
- 自动重排阈值未接受时采用 Preview + 用户提交；条件未知不当作低风险，见 [DEC-002](DECISIONS.md#dec-002)。
- preference.update 不能让模型自行扩大 autoReplan、读取范围或其他自治权限；此类设置须经宿主专用交互确认。
- Completion/Achievement 的真实事实不因 Undo 删除；成就去重、来源验证和 opt-out 在应用层执行。
- Agent 被中止后停止新工具和外部请求；已经本地提交的操作仍保留审计与待同步状态，中止不等于业务回滚。

### external_sensitive

V1 尽量不开放。

未来包括：

- 修改第三方 Calendar Event；
- 发送邮件；
- 外部消息；
- 购买/支付等。

---

## 6. LLM Data Exposure

默认不发送：

- 全量 Calendar；
- 全量 Success Diary；
- 全量 DB；
- API Key；
- 不相关用户数据。

Context Builder 只提供完成当前请求所需内容。每种工具/用例定义字段允许列表、时间范围和结果数量上限；Provider 请求构造后仍需脱敏检查。

禁止把 API Key 放入 Prompt 或 Tool Result。Provider 鉴权由受限凭据适配层完成；客户端不能打包项目共享密钥。首次 Provider 接入与生产凭据模式见 [DEC-005](DECISIONS.md#dec-005)。

OperationRecord、TaskActivityEvent、IntegrationJob 与 ExternalMutationIntent 只保存恢复/统计必要字段；不得以审计为名复制全量聊天、日历描述或模型响应。当前 OperationRecord 不保存 mutation 参数 DTO，只保存命令与稳定 SHA-256 参数摘要；为确保同 operationId 能在实体后来改变或 Schedule Preview 已消失后仍精确重放首次提交响应，`resultJson` 会保存完整 mutation DTO snapshot，必要 `diffJson` 还会保存计划变更前后快照，可能包含 Task/Goal/Project 标题、描述、完成事实或计划事实。

该结果/diff 快照属于本地业务 SQLite 中的敏感业务数据，沿用实体本身的设备隔离、备份/加密与访问边界；它不是日志、Provider 请求、Agent Context 或无关 Tool Result 的默认来源。读取只能用于校验同一 operationId/命令/参数摘要并恢复对应结果。清理策略必须同时满足幂等重试窗口、CompletionRecord 等证据引用与 migration 安全；在策略确定前不得单独删除快照造成同 ID 重试语义漂移，也不得宣称其已加密或可恢复，相关发布政策见 [DEC-009](DECISIONS.md#dec-009)。

Phase 2 Schedule Preview 的受信候选和输入快照只保存在进程内存，Store 对写入/读取作隔离深拷贝并冻结对象，Commit 不信任调用方返回的 diff；进程重启或显式 clear 后候选失效且不会从 SQLite 恢复。该内存快照仍可能包含 Task、Busy 与用户特征，生产 SchedulingSnapshot Adapter 必须遵守最小字段、有限 horizon 和授权范围，不能因“不落库”而默认送入模型、日志或任意 Tool。

Phase 3 Calendar Snapshot 只持久化 provider/calendar/event/occurrence 身份、时间区间、Busy、lastSeenAt 与 contentHash，不保存外部事件 title、notes、location、attendee 或正文。完整/部分刷新范围必须有限；Snapshot/Coverage 与 Scheduler 只消费排程所需事实。Calendar event ownership marker 与 Notification marker 只保存 namespace、稳定本地身份、hash、revision/时刻等核对元数据，不复制 Task title、description 或 Notification body；marker 仍不是单独的写权限证明。

ExternalMutationIntent 是 OS 副作用前必须落盘、解决后必须与 verified binding checkpoint 同事务删除的短期恢复事实。它的 canonical payload 只允许稳定 provider/container/block/notification ID、ownership key、revision、content hash 与 UTC 范围，不保存 Calendar title/notes、Task title/description 或 Notification title/body；`scopeKey` 与 IntegrationJob 关联仍属于本地敏感同步 metadata，不进入日志、LLM Context 或无关 Tool。未解决 intent 不能按普通缓存清理；Calendar provisioning 结果无法可靠回查时须保留到直接用户确认，不以重复 create 换取表面成功。

Mobile 只在同步状态明确为 `calendar_provisioning_unknown`、仍有对应 jobId 时展示释放入口，并采用“已检查系统 Calendar”→“确认不存在并重新尝试”两步动作。其他 duplicate、用户修改或归属冲突不得复用该入口；保留待核对是安全选项。确认后协调器唤醒属于 best-effort，不能因唤醒失败撤销或隐瞒已提交的 intent 删除/requeue。

Phase 6 `AgentRun` 只落盘运行 ID、起止时刻、状态、触发、Provider 名称、turnCount 和脱敏 errorCode；不保存消息、Prompt、模型响应、Tool 参数或 Tool Result。自然语言 Preview 请求只包含固定 system 约束、下述允许的时间 Context 与本次用户原文；通用 Agent Context 必须先由应用选择允许事实，再按消息数、字符数与 tool argument 长度裁剪。`calendar.listBusy` 不返回 title/notes/location/attendee/external ID，Preference Tool 只允许四个非 Secret key。任意未知 Tool/Provider 异常只暴露稳定通用错误，stack、raw cause、SQL、Provider body 与凭据不得进入 Agent message/event 日志。

Phase 7 `UserModelFeature` 是可从本地最小事实重建的版本化数值派生缓存，只保存 feature/scope、数值、窗口、来源 stateVersion、sampleCount、confidence、algorithmVersion 与更新时间；不复制 Task 标题、描述、用户原文、日历内容、消息或自由文本标签。统计 builder 不访问 Provider，不产出人格/心理标签。完整投入覆盖只能由直接用户明确确认，Agent 不能把模型推测写成 complete 样本。个性化缺省关闭；DEC-007 接受前生产排程即使读到缓存也保持中性。

Phase 8 的 Reflection、Energy Check-in 与 Relax 只保存在本地业务 SQLite。Reflection 系统摘要只能来自指定日的 CompletionRecord/TimeBlock 事实，用户备注保持独立；当前路径不把备注或主观精力发送给 Provider。Check-in level 只作为用户可关闭的主观软信号，不得推导疾病、人格或工作能力，生产 policy 未接受前保持中性。Relax 只记录类型、来源、状态与区间，不把完成 Relax 冒充任务成就；环境声入口当前使用不需音频权限的静默模式。三类写操作只接受直接用户 authority，Agent Tool 不能创建这些心理/节奏事实。

系统 Calendar 与锁屏 Notification 是本地 SQLite 之外、可能被共享账户或旁观者看到的额外披露面。哪些 TimeBlock 投影、Calendar event/Notification title/body、产品推荐的默认提前量/预设、Android source/account 以及声音/振动/channel 必须由显式 production policy/config 决定。提醒提前量本身只作为 `0–1440` 的本地数值偏好保存，不包含通知内容、Secret 或 Calendar identity；它只能由直接用户修改，Agent Tool 不能借此扩大外部投影。当前测试字符串与配置不是用户同意或产品默认；[DEC-012](DECISIONS.md#dec-012) 关闭前采用可替换的保守实现基线，不发送 Task description，不猜测 Android account/source，也不默认请求通知声音。

自然语言 Capture 的时间 Context 仅允许宿主显式注入 referenceInstant、IANA timeZone 与 BCP 47 locale，严格校验后作为独立 system 元数据消息发送；未知字段和非法值在 Provider 调用前拒绝，不读取隐式时钟。该元数据不含 Calendar 正文、用户历史、Check-in 或 Secret，不增加工具权限；模型返回同名额外字段、authority 或 operationId 也不能绕过草稿 Schema。invalid_context 只暴露通用错误，不反射输入值。仅日期或多义时间不补造确定时刻，仍需用户确认。

Provider 适配器的自定义错误映射也不构成可信披露授权：complete、原生 stream 的错误事件/异常与已包装 ProviderError 都必须再次规范化，不能把原始 message/category/code、body 或 cause 带入公开结果。Agent Tool 异常只保留允许的稳定错误码和 retryable，消息统一为通用文案；不得依赖“对象有 code/message 字段”判定其已经脱敏。

Agent 的预算与 Abort 停止等待并隔离迟到结果；未开始的工具/审批写入不得在取消后启动。取消并不能证明已开始的写入未提交，恢复仍经过稳定 operationId 与 Application 事务，不能盲目生成新的身份重做。

其他审计/活动记录继续保持最小结构化事实。保留期与删除策略须随对应功能明确；自动重排依赖的 Undo 保留期未确定时不开放自动提交。

---

## 7. Prompt / Tool Injection

即使 V1 主要使用用户输入，仍需：

- Tool whitelist；
- Schema validation；
- Risk policy；
- No arbitrary code execution；
- No arbitrary URL fetch by default；
- Model 输出永远不是权限来源。

---

## 8. Local Agent Security

Agent Core：

- maxTurns；
- maxToolCalls；
- Abort；
- run timeout；
- tool scope；
- transaction boundary；
- run audit metadata。

Calendar/Notification Provider 也必须有宿主注入的有界调用时间。公开错误只暴露稳定的 `provider_timeout` 与读/写类别，不包含底层 Provider 响应、系统对象、用户数据、stack 或凭据；外部写超时保留的 ExternalMutationIntent 仍只允许最小 canonical identity/hash/range payload。

禁止：

- Shell；
- `child_process`；
- 任意 FS；
- 任意 native module discovery；
- 动态执行模型生成代码。

---

## 9. Data at Rest

V1 SQLite 整体加密、系统备份与导出/恢复政策在发布前评审，统一跟踪 [DEC-009](DECISIONS.md#dec-009)。未验证前不宣称数据已加密或可恢复。

`release/store-privacy.json` 只是与当前 `0.1.0` 二进制边界同步的双语商店文案草案，不是法律审查、公开 Privacy Policy 或平台问卷答案。当前草案必须明确：无生产远程模型、无云同步、无 production OTA、无应用层业务数据库加密、无用户导出/恢复；Calendar 仅在授权后读取有限 Busy 并维护 App-owned 对象。DEC-005/008/009/012 或签名二进制能力变化时必须重新审查，不得沿用旧声明。

无论是否 DB encryption：

- Secret 必须 SecureStore；
- OS Sandbox 仍是基础隔离；
- 敏感日志关闭；
- Backup / Export 需独立安全设计。

---

## 10. Privacy

User Model 只能描述执行行为统计。

当前允许的行为特征限于估时偏差、按计划时段的 Block 完成率、可信 Session 长度、显式用户推迟/跳过频率与拆分 Block 完成率。窗口、算法版本、样本数与 confidence 必须随数值保存；系统重排不能伪装为用户失败，部分/未知耗时不能进入完整耗时样本。

禁止构建：

- 心理疾病标签；
- 人格判断；
- 敏感身份推断。

---

## 11. Psychology / Mindfulness Boundary

产品不是医疗工具。

禁止：

- “你患有焦虑/抑郁”；
- “本功能可治疗……”；
- 基于任务失败给出心理病因；
- 在危机情景中冒充专业医疗系统。

---

## 12. Logging Security

必须 Redact：

```text
Authorization
API Key
OAuth Token
Calendar private content
Calendar / Notification ownership marker payload
Notification title / body
Full prompt
Full model response（默认）
```

---

## 13. Dependency Security

- 锁文件必须提交；
- 高风险 Native 依赖需审查；
- 版本升级必须验证 Expo / Hermes 兼容；
- 不在 Production 启用调试服务。

---

## 14. Future Security Decisions

需要独立 ADR：

- Cloud Sync；
- Local LLM；
- Health Data；
- Email Connector；
- External Calendar Write；
- Export / Backup；
- Cross-device identity。
