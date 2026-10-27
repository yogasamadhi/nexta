# 06 — UI / UX

## 1. UX 原则

1. 首页优先显示“现在做什么”，而不是全部 Todo。
2. 计划变化要可解释。
3. 未完成 ≠ 失败。
4. 把“完成”视觉上变成正向反馈。
5. 一次只让用户处理一个主要决策。
6. Relax 是执行系统的一部分，不是内容商城。
7. 动画用于表达状态变化，不用于炫技。
8. 所有关键功能离线可用或有明确降级状态。

---

## 2. Information Architecture

V1 Tab Bar（暂定）：

```text
今天 | 日历 | + | 成就 | 放松
```

Settings：

- Today / Achievement 页面右上角进入。

---

## 3. Today

结构：

```text
Today Header
├─ 日期 / 状态
├─ 可选 Energy Check-in
│
├─ NOW
│  ├─ 当前任务
│  ├─ 时间块
│  ├─ 开始
│  └─ 重排/稍后
│
├─ NEXT
│  └─ 1–3 个后续块
│
└─ TODAY'S WINS
   └─ 完成摘要
```

不得默认展示几十条未完成任务。

Phase 8 已在 Today 加入可关闭的五级 Energy Check-in、基于当前记录发起 Replan Preview 的明确按钮、1 分钟 Relax 入口和 Daily Reflection 入口。Check-in 保存后只说明“本机可选软信号”，不声称排程一定改变；调整仍需经过同一个 Preview/Commit 流程。

Today 的当前块和 Next 与 Calendar 共用结构化 TimeBlock 类型/状态中文映射；非 Task 的 Break/Relax/Buffer 不显示成含糊的“保留时间”，跨日本地时间显示完整起止日期。Task 入口仍只指向对应 Task，不把展示文本作为控制流。

---

## 4. Calendar

V1 以 Day Timeline 为核心。

功能：

- Busy Event；
- Task TimeBlock；
- Break / Relax；
- Drag；
- Resize；
- Lock；
- Replan Preview。

TimeBlock 更新使用 Reanimated 的短布局过渡；过渡显式遵循系统 Reduce Motion，启用减弱动态效果时不强制播放位移动画。动画只表达同一稳定 TimeBlock 的位置/尺寸变化，不改变事实或延迟数据刷新。Calendar Header 提供“重新规划这一天”，以当前所选本地日已解析的 UTC 起止生成 Replan Preview；不会直接提交，也不会错误复用 Today 的范围。

Calendar Header 下方提供按周一至周日排列的本周日期条；选择日期只切换下方 Day Timeline，不一次读取或渲染无界任务列表。Today Empty 的“查看本周”进入该日期条所在的 Calendar，“放松”始终可由用户主动进入，不受 Today 是否显示恢复建议影响。

Timeline 以结构化类型和状态显示 Task/Break/Relax/Buffer；只有开始时间尚未到达的 `planned` 块显示调整或解锁动作。已开始、已完成或开始时间已到的块只能查看，Task 块可进入对应 Task，不得把保护事实标成可拖动或可解锁；调整页的直接深链也必须执行同样的只读保护。

Timeline 采用统一 minute → pixel 映射。

---

## 5. Capture（中央 +）

支持：

- 文本；
- 手工结构化创建（始终可用）；
- 后续可扩展语音。

输入示例：

> 下周五前把方案写完，大概 3 个小时。

流程：

```text
Input
↓
AI Parse
↓
Structured Preview
↓
Create
↓
Schedule Preview
↓
Commit
```

AI 不确定的信息用“待确认”表达。模型未配置、离线、超时或解析失败时保留原输入，并可直接进入手工表单；不能要求模型恢复后才能创建 Task。

手工流程：标题/说明/估时与可选排程约束 → 保存 inbox，或补足估时后进入 Schedule Preview。当前约束区可填写设备时区下的最早开始、Deadline、是否允许拆分、最短/最长块、分类与精力需求。只含日期的 Deadline 要展示其时区与“尚未形成精确硬截止”的解释；用户补充时刻后才直接进入 Preview，未知值不显示成 AI 已确认的精确值。日期/时间字段必须关闭可用的自动更正，并在边界规范化移动键盘可能生成的 Unicode 破折号/全角冒号，最终仍按严格格式和 DST 规则校验。Task 创建或编辑已经本地提交、但随后 Schedule Preview 失败时，界面必须明确说明“任务已保存、预览未生成”，不得把两个独立结果合并成一次含糊失败。Schedule Preview 的摘要、Busy 完整度、块类型、未排程原因和风险提示必须由结构化 code 在展示层本地化；不得直接向中文界面暴露 Scheduler 的内部英文诊断，也不得靠解析英文 message 判断业务含义。

已保存任务从 Preview 返回后，可以重新生成该任务的预览，或显式“添加另一个任务”。后者只清空当前表单；不得删除、重复创建或修改已保存任务，也不代表接受先前的候选计划。

Phase 4/5 提供手工入口；Phase 6 已加入自然语言原文区与结构化确认区。Provider 未配置时界面明确显示降级状态，完整保留原文并转入手工确认，不猜测日期、Deadline 或时长。受校验的模型结构化 Preview 边界已实现，但真实 Provider 选择与设备 E2E 仍等待 DEC-005；内部试用页面只展示已实现能力。

Today Header 提供“收件箱”入口，使用有界游标分页展示尚未进入计划的 Task；缺估时 Empty State 还要提供直接入口，不能只提示用户存在待补信息。候选 Task 卡提供编辑入口。未来日历块先进入时间块调整页，再提供“查看与编辑任务”，使用户可以在不改变排程的情况下修改或取消该 Task。以上入口复用 TaskService，不在 Screen 直接读 SQLite。

Today 始终提供独立的“重新规划今天”动作，直接用户不需要先填写 Check-in、完成 Reflection 或结束 Relax 才能请求 Replan；该动作仍只生成 Preview，必须沿统一确认/Commit 路径。同步状态为权限阻塞或待核对时，状态卡提供进入 Settings 的直接动作。

### Task 编辑与取消

Task 编辑页可修改普通字段、进入 Focus、明确完成或取消非终态 Task。预计总时长与显式剩余估时必须分开编辑：页面只读展示由可信区间派生的实际投入，不能用预计值覆盖；剩余估时留空表示按总估时减可信投入派生，原估时耗尽但未完成时提示用户填写新的剩余估时。保存并重新排程必须调用 Replan。Preview 的未排程项提供回到对应 Task 的直接入口，修正后生成新 Preview，不提交或复用旧 Preview。取消必须采用两步确认：第一步只展开影响说明，第二步按钮才执行终态写入；用户可选择“保留任务”返回编辑。说明必须明确当前专注会结束、关联未完成时间块会取消、Calendar/Notification 将重新核对，并且不会生成完成记录或成就。事务失败时保留页面与输入并显示“未提交”，不得只改 UI 状态。

### Goal / Project

收件箱提供“目标与项目”入口，不占用 V1 五个核心 Tab。Goal 列表支持本地创建、可选目标日期、有界分页和真实进度摘要；Goal 详情可直接拆出关联 Task、创建关联 Project，并从 Project 创建关联 Task。Goal 进度只能读取 Task/Project 完成事实，无有效 Task 时显示“暂无可汇总任务”，不能显示虚假的 0%。Goal/Project 归档使用两步确认，明确关联任务与完成历史保留。

---

## 6. Achievement

核心目标：

> 让用户看到真实完成过什么。

页面：

```text
今天
本周
本月
历史
```

每条 Achievement 展示：

- 真实完成事项；
- 时间；
- 已记录投入及完整/部分/未知标识（如有）；
- 项目/目标；
- 可选 AI Summary；
- Evidence / Source 可追溯。

避免：

- 夸张称赞；
- 虚假的连续成就；
- 把所有小动作都包装成重大成功。

---

## 7. Focus Mode

开始任务后：

```text
当前任务
预计 / 已用时间

[结束本次专注]
[完成整个任务]
[需要更多时间]
[暂停 / 暂时无法继续]
```

可选 10–20 秒 Mindful Transition：

> 放下刚才的事情。  
> 现在只处理这一件事。

必须可关闭。

当前 Mobile 实现固定为 10 秒：只有用户从 Today/Task 确实新建 ExecutionSession 后首次进入 Focus 时显示，提供“立即开始”跳过按钮；Settings 的“专注过渡”开关由直接用户保存，缺设置默认启用。一次性导航信号在 Focus 接收后立即清除，恢复已有 running/paused Session、App reload、直接重开 Focus 或从 Relax 返回都不重复显示。过渡只属于低干扰展示，不新增持久化 Session 状态，也不延迟或改写已经开始的真实执行区间。

执行事实可保留秒级精度，但 Today 的候选任务和当前时间块、Focus、Task 与 Inbox 的分钟文案不得直接暴露浮点尾数：整分钟直接显示，零到一分钟显示“少于 1 分钟”，其他小数分钟显示为“约 N 分钟”。该格式化只影响展示，不回写或舍入数据库事实。

- “结束本次专注”结束 Session/关联时间块，任务可继续保留剩余计划；“完成整个任务”明确结束 Task 并清理未来未开始块。“需要更多时间并重新排程”先持久化结束本次 Session，再以该 Task 为关注范围调用 Replan；后续 Preview 失败不得把已结束的 Session 误报为未保存。
- 点击明确完成按钮已构成该动作授权，不重复询问同一完成意图。模糊聊天输入不能被模型解释成完成事实。
- 正在暂停时重启 App 仍显示暂停；活动计时恢复时展示已记录区间，计时异常提示核对，不输出虚假精确耗时。
- 同时存在 running/paused Session 时，启动另一任务先提示处理当前 Session。
- 结束后可选择不生成成就；此选择不影响真实 Task 完成记录。
- Task 与 Focus 的“完成整个任务”区域提供默认不选中的“全部实际投入都已被计时记录”。文案必须说明只有确认没有遗漏线下/未计时投入时才选择；不选不阻塞完成，只把已有可信计时标成部分覆盖或保持未知。该声明不能从聊天含义、预计时长或 Agent 推断得到。

---

## 8. Relax

首页：

```text
放松

现在需要什么？

[1 分钟呼吸]
[3 分钟放空]
[5 分钟拉伸]
[环境声 / 静默]

今日专注 Xh Xm
建议恢复 Ym（如果有足够数据）
```

结束：

```text
现在怎么样？

[开始任务]
[再休息一会]
[调整今天]
```

当前 Mobile 已提供 1 分钟呼吸、3 分钟放空、5 分钟拉伸和环境声/静默入口；首版环境声选项执行离线静默模式，不申请音频权限。页面从 SQLite active RelaxSession 恢复倒计时展示，只有用户点击完成或放弃时才保存真实结束区间。Focus 入口先暂停当前 Execution，结束 Relax 后可明确恢复；Today/Relax Tab 结束后可开始任务、再休息或进入调整今天 Preview。完成 Relax 不等于完成 Task。

---

## 9. Daily Reflection

不做长问卷。

建议最多：

```text
今天完成了什么？
哪件事值得记住？
明天需要调整什么？
```

优先自动生成事实摘要，再允许用户补充。

当前 Reflection 页面按设备当前 IANA 时区计算本地日，只读取当天 CompletionRecord、Task TimeBlock 与活跃 Task：摘要显示真实完成和计划块状态差异，Wins 最多三个且关联完成证据；无记录时明确说明不会代写成果。用户备注与本地事实分开保存，可从建议进入 Replan Preview。固定文案不提供诊断、治疗承诺或人格评价。

---

## 10. Scheduler Preview

必须明确：

- 哪些时间块移动；
- 为什么移动；
- 是否影响 Deadline；
- 哪些任务排不进去；
- 调度时区、日历快照新鲜度、已锁定/正在执行块的保留情况；
- 已观测到但无法自动解决的受保护块冲突。

每条变更必须显示同一 Preview Snapshot 中的任务标题（非 Task 块使用类型名）、新增/调整/取消类型、跨日无歧义的日期时间、结构化变更原因；调整同时显示 before/after，取消显示原区间。页面还要直接显示 IANA 调度时区、Busy 完整度/捕获时刻、Deadline 风险结论，并说明 completed/started/locked 块受保护。未排程项与实体级 warning 应带对应任务标题，不能让多个任务只显示无法区分的通用原因。

默认展示“提交调整”。自动重排尚未启用时不暗示系统已经移动计划。自动阈值接受并由用户启用后，显示简短变化说明及有效期内撤销入口。

拖动/缩放成功提交后显示锁定状态，用户可显式解锁。当前 Mobile 时间块调整页支持整块拖动、上下边缘缩放、15 分钟吸附、受信 Preview 与明确“确认调整并锁定”；同时提供可访问的 15 分钟精调按钮，覆盖整块前移/后移以及开始、结束边界的提前/延后，不能把手势作为唯一操作方式。Application 会再次校验工作窗口、Busy、Task 约束和版本。连带调整需要展示完整 diff；跨天、Deadline 风险或其他高风险变化遵守同一确认流程。Preview 过期时提示重新生成，不用旧确认直接提交新方案。

示例：

```text
因为 14:00 新增会议：

写方案
14:00–16:00
→ 15:30–17:30

仍可在周五前完成。
```

---

## 11. Empty State

### Today Empty

> 今天暂时没有必须完成的事情。

提供：

- 添加任务；
- 查看本周；
- 放松。

### Achievement Empty

> 这里会保存你真实完成过的事情。

---

## 12. Permission State

Calendar / Notification 权限必须：

- 解释用途；
- 只在用户明确点击的前台流程触发系统权限请求；后台 refresh/worker 只读状态，不弹框；
- 拒绝后仍可使用；
- 提供再次开启路径；
- 不反复骚扰。

`not_determined`、可再次请求的 denied、必须去系统设置的 denied 与 unavailable 要给出不同动作。授权成功可重新排队该通道的 `permission_required` 作业；不得顺带重排 disabled、succeeded、superseded 或正在 processing 的作业。

当前 Application permission/requeue 协议、Expo Adapter、移动端用途说明、显式请求按钮与 Settings deep-link 已组合；系统弹框、拒绝分支和授权后 requeue 的真实 iOS/Android 行为仍未验收。

### 个性化设置

Settings 显示本地行为统计用途、当前开关和安全边界：只依据真实任务/计划/执行事实，不生成性格、心理或医疗标签。缺设置按关闭处理，关闭后不影响手工任务、Focus 或中性排程。

Phase 7 技术实现已经能保存 `personalization.enabled.v1` 并读取版本化 UserModelFeature，但 [DEC-007](DECISIONS.md#dec-007) 未关闭前，用户点击关闭状态不会启用，而是看到“统计口径和调度权重仍待评审”的明确说明；若数据库已有 true，用户仍可关闭。界面不得显示“已学习并优化”之类暗示个性化已生效的文案。

### 可持续节奏设置

Settings 可分别关闭 Energy Check-in 与 Today/Focus 的 Relax 建议；缺偏好时两者显示为可用但不强制。关闭不删除既有 Check-in/Relax 事实，也不影响 Relax Tab 的用户主动入口。页面明确说明这些记录用于节奏与计划，不是医疗评估。

---

## 13. Offline State

明确区分：

```text
本地能力可用
AI 云推理暂不可用
```

不得把离线等同“整个 App 不能用”。

---

## 14. Error State

用户友好：

| 实际状态 | 用户表达与动作 |
| --- | --- |
| 校验/版本冲突或本地事务失败 | “这次调整未提交，原计划未修改。”提供修正或重新预览 |
| Preview 过期 / App 重启丢失 Preview | “计划条件已变化，请重新预览。”保留用户输入 |
| 本地已提交、日历待同步 | “计划已更新，系统日历待同步。”展示重试/权限入口 |
| 本地已提交、通知权限拒绝 | “计划已保存，提醒尚未启用。”本地执行仍可继续 |
| 外部事件创建结果未知 | “计划已保存，日历同步结果待核对。”提供核对入口，不诱导重复提交 |
| App Calendar 创建结果未知且平台无法可靠回查 | Settings 展示两步待核对说明；只有用户先表示已检查 Calendar，再确认目标确实不存在，才允许释放 durable intent 并重试创建；可随时选择保留待核对状态 |
| 系统日历中的 App 事件被用户修改 | 展示本地与外部差异，用户选择恢复 App 事件或回到 Preview 调整本地计划 |
| 相同外部身份出现重复项或归属无法确认 | 显示“需要核对”，不把冲突项静默当作已同步，也不诱导盲目再创建 |
| Undo 过期或计划已有新变化 | 说明无法直接撤销，展示可行的新 Preview；不覆盖新事实 |

文字必须来自应用结果状态，不能把所有 Adapter 错误统一显示为计划未变。

显式 Calendar/Notification 权限请求返回 granted 后，当前前台会立即尝试消费刚重新入队的 durable Job，不要求用户手动切换后台。该唤醒失败时仍显示权限和本地提交的真实状态，下一次前台事件继续恢复，不能把它描述成权限申请失败。

而不是：

```text
SQLITE_CONSTRAINT / provider 500
```

### Calendar / Notification 内容与提醒设置

用户必须能理解哪些本地 TimeBlock 会投影到系统 Calendar、提醒何时触发，以及锁屏可能展示什么内容。Calendar 标题、Notification title/body、默认提前量、Android Calendar source/account、声音/振动/channel 都是产品与隐私选择，不由 worker 或 Adapter 猜测。

在 [DEC-012](DECISIONS.md#dec-012) 关闭前，Production Composition 必须显式注入可替换 policy；当前实现基线只处理 future planned task block，使用 generic Calendar/Notification title、无正文且 sound=false，Android source 缺失时不创建 Calendar。Settings 已提供“提前分钟数”输入，直接用户可保存 `0–1440` 的整数；未保存时使用显式保守默认 `0`，修改后会重新检查当前计划的提醒。非法输入不得部分保存同页其他设置，也不得改变既有提醒偏好。这个缺省值不是已接受的产品推荐默认；未配置可接受 policy 时，对应投影返回空并保持本地计划可用。不得默认把 Task description 或其他敏感内容暴露到共享日历、锁屏或通知预览。

---

## 15. Accessibility

至少：

- Dynamic Type；
- Screen Reader Label；
- 对比度；
- 不仅靠颜色表达状态；
- 动画支持 Reduce Motion；
- 重要动作目标尺寸符合移动端可点击标准。

底部导航必须保留平台安全区，避免手势区域或 Android 三键导航栏遮挡标签的点击目标；不得通过固定高度/底部间距覆盖导航组件提供的设备 inset。窄屏与大字体审查应同时确认文字可读和目标可点。

内容和系统状态栏须匹配当前背景的明暗，离开深色专注/放松界面后恢复浅色页面的可读状态栏。放松进行中的内容不能以固定容器裁掉结束或离开动作；窄屏与大字体下仍可滚动到这些动作。

---

## 16. Dangerous Action Confirmation

必须确认：

- 删除 Goal / Project 且会影响大量 Task；
- 批量取消未来 TimeBlock；
- 清空 Success Diary；
- 修改高风险权限或 Secret；
- 未来若开放外部日历写权限，删除/移动第三方事件。


---

## 17. 交互验收关联

Capture/Offline 见 CASE-OFFLINE-01；Focus 与完成语义见 CASE-EXEC-01/02；Preview/Undo 见 CASE-COMMIT-01/03；部分同步失败见 CASE-COMMIT-02。完整映射保存在 [Testing](08-TESTING-ACCEPTANCE.md#requirement-matrix)，本文件只维护用户可见行为。

---

## 18. Logo 候选资产

「向前的一步」候选将连续路径形的抽象 N 与一个代表当前行动的圆点结合，沿用现有界面的翡翠绿方向。图标使用深绿背景、米白路径与薄荷绿圆点；以宽笔画和留白保持移动端小尺寸可辨识。

- [App 图标 PNG](../output/imagegen/execution-agent-logo-v1.png)：1024×1024、不透明、完整正方形，外轮廓由平台裁切。
- [透明 Logo PNG](../output/imagegen/execution-agent-mark-v1.png)：1024×1024，便于后续组合与视觉评审。
- [图标预览](../output/imagegen/execution-agent-logo-v1-preview.png)与[小尺寸评审图](../output/imagegen/execution-agent-logo-v1-size-review.png)。
- [生成 Prompt](../output/imagegen/execution-agent-logo-v1.prompt.txt)与[生成及整理记录](../output/imagegen/execution-agent-logo-v1.provenance.json)。

第二版保留路径与当前行动圆点的语义，改用更几何的竖向笔画和直线对角连接。第一版保留供对比；第二版同样属于候选。

- [第二版 App 图标](../output/imagegen/execution-agent-logo-v2.png)与[透明 Logo](../output/imagegen/execution-agent-mark-v2.png)：均为 1024×1024。
- [第二版预览](../output/imagegen/execution-agent-logo-v2-preview.png)与[小尺寸评审图](../output/imagegen/execution-agent-logo-v2-size-review.png)。
- [第二版生成 Prompt](../output/imagegen/execution-agent-logo-v2.prompt.txt)、[原始生成图](../output/imagegen/execution-agent-logo-v2-generated.png)与[生成及整理记录](../output/imagegen/execution-agent-logo-v2.provenance.json)。

该资产属于可评审候选，最终品牌仍按 [DEC-003](DECISIONS.md#dec-003) 决策。当前请求交付视觉文件；正式接入原生图标、启动画面与品牌规范属于后续范围。实际生成与验证证据见 [STATUS](../.ai/STATUS.md#logo-candidate-delivery)。

## 19. 内部账号与同步

Settings 提供账号与同步入口。登录界面必须先说明目标、项目、任务、计划、执行/完成/成就、含用户备注的复盘、精力、放松及可移植偏好会在登录后自动上传；系统日历缓存、OS 身份、密钥及完整本地收据不上传。标明内部注册暂无邮箱验证与密码找回，不宣称端到端加密。

状态区分本地、同步中、待上传、断网、认证失效、冲突与重试。冲突页展示本地变化与云端事实，二次明确选择云端主线或按新版本提交本地修改；不允许强制覆盖完成证据。未采用分支可读且不计正常完成。其他设备活跃的 Focus/Relax 显示只读来源，不能用禁用按钮代替应用层授权约束。

本设备的系统日历/通知投影独立开启，新账号资料默认关闭；开启多台设备可能各自提醒。退出后保留账号资料并回到独立游客空间，不把其他账号内容混入。
