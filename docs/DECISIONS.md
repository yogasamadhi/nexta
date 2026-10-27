# Open Decisions

此文件集中记录尚未接受的产品或技术选择。`Open` 不等于阻塞整个项目，只阻塞表中指定的能力或阶段；进入相关实现前必须检查。已接受架构决策保存在 [ADR](ADR/README.md)，实际进展保存在 [STATUS](../.ai/STATUS.md)。

关闭事项时记录结论、日期、依据和相关规范/ADR；禁止只删除条目。表内默认行为是当前实现边界，不代表已验证最终方案。

| ID | 状态 | 待决策内容 | 影响阶段 / 关闭条件 | 生效前默认行为 |
| --- | --- | --- | --- | --- |
| <a id="dec-001"></a>DEC-001 | Open | 首批试用人群、观察周期、产品成功阈值 | Phase 5 试用前由产品负责人确定；不阻塞 Phase 0 | 保留现有目标用户与 V1 范围；以手工任务到真实完成的闭环准备试用，不宣称价值已验证 |
| <a id="dec-002"></a>DEC-002 | Open | 自动重排允许移动的块数、累计偏移量、临近开始保护窗口、Undo 保留期 | 自动提交分支启用前完成产品评审和边界验收 | 可自动计算 Preview；提交由用户确认。跨天、Deadline 风险、受保护块不进入自动提交 |
| <a id="dec-003"></a>DEC-003 | Open | 最终品牌与可迁移包标识 | 原生应用标识锁定前 | 使用中性工程命名，不将暂定品牌绑定 bundle/package ID |
| <a id="dec-004"></a>DEC-004 | Closed (2026-09-12) | Expo / RN / UI 库兼容组合及 Runtime Schema 库版本 | Phase 0 已完成最小 iOS/Android Development Build 与依赖验证 | 使用已验证的锁定基线；补丁维护见下方记录，任何升级重新执行相同验证 |
| <a id="dec-005"></a>DEC-005 | Open | 首发模型 Provider 与生产调用凭据模式 | Phase 6 真实 Provider 接入前 | 先用 Fake Provider 验证统一接口；用户 BYOK 存 SecureStore；不把项目共享密钥打包进客户端 |
| <a id="dec-006"></a>DEC-006 | Open | TaskDependency 是否进入 V1 实际交付 | Phase 1 正式关闭/Schema 范围定稿前确认存储范围；Phase 2 正式关闭前确认调度支持范围 | 当前 `0000/0001` Schema 不创建 TaskDependency，也不创建依赖 Repository/Service/Tool；Core 对依赖输入显式返回 unsupported，不假装能排依赖任务 |
| <a id="dec-007"></a>DEC-007 | Open | Task 分类来源、用户模型窗口/阈值/置信度公式与策略权重 | Phase 7 启用个性化前，用固定样本和可解释规则评审 | 保留事实与版本化统计定义；缺样本/分类时不输出强结论，不调整排程权重 |
| <a id="dec-008"></a>DEC-008 | Open | Production OTA | Phase 10 发布前 | 未接受前不启用 Production OTA；不阻塞开发构建 |
| <a id="dec-009"></a>DEC-009 | Open | 本地数据库加密、系统备份策略、用户导出/恢复范围 | Phase 10 隐私与数据丢失风险评审前；新增导出前独立 ADR | Secret 使用 SecureStore；不宣称数据库已加密或数据可恢复；不新增临时备份/导出通道 |
| <a id="dec-010"></a>DEC-010 | Open | Task 重新打开、历史完成更正与历史 Achievement 撤销体验 | 提供这些交互前；不阻塞首次完成闭环 | 不暴露未定义的 reopen/delete 历史操作；保留稳定完成证据与取消/隐藏能力，不静默改写历史 |
| <a id="dec-011"></a>DEC-011 | Open | Task priority 词表/排序、splittable 正式默认，以及 schedulingPolicy 词表与调度语义 | Phase 2 生产 policy/Snapshot Adapter 定稿及正式关闭前完成产品与算法评审；不阻塞 Phase 1 持久化或显式 policy 的技术验证 | Task 创建缺省使用 `normal` / `false` / `flexible`；priority 与 schedulingPolicy 仍按非空不透明字符串保存。Core 只接受调用方显式 `priorityRanks`，按输入的 splittable 布尔硬约束排程，不赋予 schedulingPolicy 隐含语义；当前测试 policy 不构成产品词表或默认策略 |
| <a id="dec-012"></a>DEC-012 | Open | Calendar/Notification 的生产投影策略：哪些 TimeBlock/status 投影、日历事件与提醒的标题/正文隐私级别、产品推荐的默认提醒提前量/预设、Android Calendar source/account、通知声音/振动/channel | Phase 3 正式关闭、权限 UI 定稿和真实设备验收前由产品、隐私与平台实现共同确认；用户可配置提醒提前量的交互已实现，仍需真机验证最终默认与预设 | 采用可替换的保守实现基线并由宿主显式注入：仅 future `planned` task TimeBlock 投影到 App-owned Calendar；仅为同类块注册提醒，用户未保存偏好时 lead = 0，Settings 可保存 `0–1440` 分钟覆盖值并安全重排当前提醒；通知权限不请求 sound，Android channel 不默认启用声音/振动；不投射 Task description，Task title 暴露默认关闭/须显式配置。App Calendar 容器 title/color 与 Android source/account 必须显式配置，source/account 缺失时不猜测创建。测试 policy 不是产品默认，以上基线也不代表决策已接受 |

## Resolution Input Packet

为避免把未授权推断写成产品事实，关闭 Open 条目时负责人应至少给出下表所列输入；这些字段是决策记录所需信息，不构成推荐答案。结论仍必须按本文件底部模板保留日期、依据、负责人角色和受影响的规范链接。

| 决策 | 负责人需要明确的最小输入 |
| --- | --- |
| DEC-001 | 首批试用人群与招募/同意边界、观察周期、成功指标及阈值、失败或提前停止条件 |
| DEC-002 | 自动提交是否进入首发；如进入，允许变化的块数/累计偏移/临近开始窗口、Undo 保留期与冲突回退体验 |
| DEC-003 | 用户可见品牌、iOS bundle ID / Android package ID、后续迁移或改名责任边界 |
| DEC-005 | Provider 与模型范围、账号/区域/数据保留限制、BYOK 获取与撤销流程、生产错误与费用可见性要求 |
| DEC-006 | V1 是否支持 TaskDependency；如支持，关系类型、循环/删除语义、迁移与 Scheduler 行为；如不支持，明确延后范围 |
| DEC-007 | Task 分类来源、统计观察窗口、样本阈值/置信度公式、允许影响 Scheduler 的权重与用户可见解释 |
| DEC-008 | 是否启用 Production OTA；如启用，runtimeVersion、灰度范围、回滚条件与 Schema 兼容策略 |
| DEC-009 | SQLite 加密取舍、系统备份规则、导出/恢复范围、数据丢失提示、隐私/法律审核依据 |
| DEC-010 | 是否提供 reopen、历史完成更正或 Achievement 撤销；如提供，审计记录与不可逆边界 |
| DEC-011 | priority 词表和排序、splittable 默认值、schedulingPolicy 词表及每个值的调度语义 |
| DEC-012 | 投影哪些 Block/status、Calendar/Notification 可见字段、推荐提醒默认/预设、Android source/account、声音/振动/channel 与对应隐私审核结论 |

## Optimization Candidate Packet — OPT-NC-20261003

以下为本轮无需凭据优化的可评审方案。全部关联条目继续 **Open**；表首生效前默认行为不变，不启用候选参数、生产个性化、自动提交、备份或新的 OS 投影。候选需要的负责人输入见上表，当前无需填写 Token 或账号。

### DEC-001 — Small trial and evidence

候选 A：先由少量自愿用户验证手工 Task → Preview → 明确完成闭环，观察一周；候选 B：待真实 Provider 验收后试用自然语言入口，能评估输入收益，但依赖模型选择、费用与隐私同意。人数、一周周期和成功阈值均是待评审建议，不是招募承诺或已验证结论。

| 指标 | 候选定义与解释边界 | 最小采集方式 |
| --- | --- | --- |
| 首次开始耗时 | 从本次试用首个 Capture 提交到用户首次 execution.start；分别报告输入耗时与等待排程/主动延后，不把空闲等待算为 UI 速度 | 用户同意后本地记录合成事件时间；也可由试用主持人记录，不新增默认远端遥测 |
| Preview 接受/修改 | 以唯一 previewId 为分母，区分提交、放弃、失效与修改后重新预览；重复点击不重复计数 | 现有 Preview 内存生命周期不足以还原历史；如需长期统计，先评审最小本地事件 Schema/保留期 |
| 计划移动 | 同 existingBlockId 的 moved/resized、新增/删除分别计数；报告开始时间偏移绝对值及跨日，不把新块当移动 | OPT-02 已有合成基准方法，可作为离线分析定义，不代表真实用户容忍阈值 |
| 维护时间 | 用户主动设置、编辑、核对 Preview/同步失败的时间，与专注时长分开；离开 App 的间隔不推断为维护 | 自愿短问卷或有界本地会话记录；不记录原文、键盘输入或屏幕内容 |
| 事实质量 | 完成/成就唯一来源、未知耗时比例、暂停恢复失败和计划冲突率；单个缺陷优先按事实修复 | 已有事务/计时事实加匿名数量；不以成功率掩盖数据损坏 |

验收：试用前定稿同意与退出/删除流程、指标分母和停止条件；同一行为重复提交不增加次数，缺数据明确 unknown；负责人给出人群、人数/周期、可接受阈值和提前停止条件。当前基准/UI/脚本化模型结果只验证工程行为，不证明产品价值。

### DEC-011 / DEC-007 — Scheduling policy candidates

基础策略候选：以显式 priorityRanks、deadline/earliestStart、splittable 与 min/maxBlock 作为可解释输入，保持硬约束优先；比较不引入稳定性偏好与较强保留原位置两个版本。OPT-02 的移动统计和同输入等价方法可用于评审，但示例权重不得复制到生产。splittable 缺省是否允许仍由 DEC-011 决定，现行 false 不变。

时间偏好候选 A：只提供显式允许窗口，作为硬约束；候选 B：允许窗口之外另有偏好窗口，作为软评分并显示偏离原因。增加字段需版本化 Domain/Schema、Snapshot/API 和迁移；旧 Task 没有窗口时沿用现行工作窗口，不从历史行为推断硬禁止，也不默认扩展工作时段。

容量候选：Preview 显示需求分钟、可用分钟、未排程分钟及覆盖/Busy 新鲜度；不能把部分日历缓存当完整容量。补救项为用户明确改估时/优先级、允许拆分、改截止或调整工作窗口，每项重新 preview；不自动延后 Deadline、填造估时或扩大工作窗口。容量提醒阈值、窗口长度和是否只提示一次待评审。

学习候选 A：只展示事实与置信度，不影响排程；候选 B：用户开启后，以充分样本的估时偏差或时段完成分布影响有界软评分，设置最大影响幅度和解释/关闭入口。Check-in 是单次主观软信号，可用作用户可关闭的低影响参考，不得生成诊断或强制降负荷。分类来源、样本阈值、窗口、置信度算法与权重都由 DEC-007 定稿；缺样本/关闭开关维持中性。

验收：固定输入重跑确定性；锁定/开始/完成块保护；硬约束优先于软偏好；跨时区/DST 与空容量可解释；关掉学习后恢复中性输出，缺样本不改变权重。最小输入：词表/顺序、拆分默认、policy 语义、窗口硬/软取舍、容量提示阈值、统计窗口/置信度和最大影响幅度。不能用本地 Node 时间测量推断手机 SLA。

### DEC-002 — Foreground coalescing and commit safety

候选 A：在现有前台 Event Coordinator 中按 trigger/业务版本合并重复事件，仅生成最新 Preview；输入变化或 TTL 失效后重新读取 Snapshot。候选 B：保留用户可见的待核对 Preview 队列，信息更完整，但要处理过时项与维护成本。两者都不建立常驻后台 Agent，coalescing 不丢弃 durable IntegrationJob。

自动提交候选限于负责人明确接受的低风险 diff：移动块数、累计开始时间偏移、临近开始保护窗口和跨日规则全部显式；任何 Busy 不完整、Deadline 风险、版本冲突或受保护块变动均回到用户核对。未定义 Undo 前继续手工提交。Undo 候选保存有界的计划前后快照及 operation 身份，只回退仍匹配版本且未开始的块；外部同步是新作业，不能撤销已经发生的执行事实。

验收：重复事件只计算一次或合并到最新版本；旧 Preview 不提交；本地成功后响应丢失不生成新 operation；Undo 过期/版本变化/执行开始明确拒绝；进程重启不扩大批准范围。最小输入：是否启用自动提交、四类阈值、Undo 保留期与冲突/过期体验，另需明确审批绑定的版本。候选不改变当前 Preview + 用户提交默认。

### DEC-005 — Provider and BYOK acceptance

选择维度：目标地区可用性、中文结构化输出、工具/流式协议完整度、Hermes/RN 的 HTTP/SSE 兼容、取消与超时、费用/配额可见性、数据保留/区域承诺和用户撤销能力。候选 A 为一个最小直连适配器；候选 B 为宿主后端代理，能集中费用/限流，但增加服务器、账号和数据披露范围，不能默认为 V1 范围。当前不选择厂商、模型或 SDK。

BYOK 候选流程：用户了解发送范围和费用后主动保存到 SecureStore；调用时按需读取，Prompt、普通 SQLite、AgentRun 和日志不含 Key。撤销时删除对应 Secret 并中止新请求/清除内存引用；已发送的请求能否撤销由 Provider 能力决定，不宣称保证删除远端数据。后台自动请求、重试额度、最大输出和费用展示需要显式设置；断网/未配置仍可手工 Capture。

验收包：真实 complete/stream、分段/缺失/重复 tool 参数、429/auth/network/invalid response、上游忽略 Abort、超时与迟到结果、Schema/authority 伪造、Context 允许字段和错误脱敏；再执行实际中文时间语料与用户确认旅程。OPT-05/06 的 Fake 与上下文 fixture 只完成通用契约准备，真实质量/费用/区域结论待接入验证。最小输入：Provider/模型、地区/账号与数据保留边界、BYOK 获取/撤销、请求费用和错误展示规则。

### DEC-009 — Backup, export and restore boundaries

候选 A：依赖明确审核的系统备份，维护成本低，但恢复可见性和用户控制受 OS 限制；候选 B：用户主动导出加密归档并选择位置，控制更强，但涉及口令丢失、密钥派生、格式维护与错误恢复；候选 C：SQLite 加密与上述备份组合，需要实际 native/升级/性能验证。App 私有目录内的文件不能被当作独立于卸载的数据保障。当前无新增导出/备份通道，不宣称数据库加密。

独立 ADR 草案要点：归档版本、完整性校验、加密/密钥所有权、备份目的地与保留/删除、支持的 schema 范围、恢复到新库后校验再原子替换、失败时保留原库、Secret 与 OS identity 的排除/重核对。导出包括哪些 Task/Completion/Session/Interval/Achievement/偏好由负责人明确；派生缓存可重建，未解决 intent 不能被解释为副作用未发生。

恢复验收：截断/篡改/错误口令/未知 schema/不足空间均不破坏原库；迁移保持 checksum 历史与唯一 Completion/Achievement FK；恢复后重新请求必要权限、核对外部 binding/未解决意图，unknown 不作 missing；重试不重复创建事件。OPT-07 的事务/进程重开证据证明本地可靠性，不证明备份或设备卸载后恢复。最小输入：加密取舍、位置/保留期、导出实体、密钥与丢失提示、恢复兼容窗口及隐私审核。

### DEC-012 — OS projection and fault verification

隐私候选 A：事件/锁屏使用通用任务提醒，不显示 Task title；候选 B：用户明确开启后显示标题，说明共享 Calendar/锁屏可见性，仍不发送 description。声音/振动、channel 和提前量预设单独同意，不把当前测试值当推荐默认。

Android source/account 候选：由权限后的实际只读来源列表供用户选择，或由产品明确支持的 App-owned 本地容器方案；来源不支持/不存在时显示可恢复状态，不猜账户、不修改原第三方事件。权限恢复只来自前台明确动作，worker 仅核对现有授权。

真机验收清单：首次拒绝/再次拒绝/设置撤销再授权；source 删除/账户切换；App-owned marker 被复制或外部对象已改；create/schedule 成功后响应丢失；部分 inventory/unknown；进程强杀后 intent/lease 恢复；旧 worker 迟到；0 与非 0 提前量真实投递、时区/DST/重启与通知交互。记录平台/OS、授权范围、回读和可见内容，模拟器或 Fake 不填 physicalDevice。最小输入：投影的 block/status、标题披露、推荐提前量/预设、source/account、声音/振动/channel 与隐私结论。

上述候选引用 [执行计划](../.ai/PLAN.md#no-credential-optimization-plan) 与 [实际证据](../.ai/STATUS.md#optimization-execution-status)。除可由本地代码/测试直接证明的事实，其收益、阈值和生产选择仍是假设，评审后才更新 Canonical Docs/必要 ADR。

## Closed Decision Records

### DEC-004 — Expo / RN / UI / Runtime Schema 基线

- 决策日期：2026-09-12。
- 结论：采用 Expo `57.0.22`、React Native `0.86.3`、React `19.2.3`；UI 基线采用 gluestack core `5.0.15`、NativeWind `5.0.0-preview.4`、react-native-css `3.0.7`、Tailwind CSS `4.2.0`，并锁定 lightningcss `1.30.1`；Runtime Schema 采用 Zod `4.6.2`。
- 包管理约束：pnpm 使用 hoisted node_modules 布局（`nodeLinker: hoisted`），精确解析结果保存在 `pnpm-lock.yaml`；NativeWind 仍是 preview 版本，因此升级前不得放宽其精确版本约束。
- 验证依据：`expo install --check` 无版本偏差，`expo-doctor` 21/21 通过；iOS/Android Hermes Bundle 均成功；iOS Development Build 在模拟器完成编译、签名、安装和页面加载；Android arm64 Debug Development Build 成功生成 APK，另有默认四 ABI 构建通过记录。
- 后续规则：任何影响该组合的升级必须重新运行 `pnpm run check`、`expo install --check`、`expo-doctor` 以及对应平台原生 Development Build；验证事实汇总于 [STATUS](../.ai/STATUS.md)。

兼容维护（2026-10-03）：iOS 27 SDK 要求 Scene lifecycle，现有标准 Swift AppDelegate 通过 SDK 57 的 `expo-build-properties` / `ios.enableSceneSupport` 生成 Scene 配置，按 Expo SDK 57 检查对齐兼容 patch；不改变 RN、React、UI 或 Runtime Schema 组合。历史关闭记录保留，当前精确版本以 manifest / lockfile 为准，完整仓库门禁、Expo 版本检查/doctor 和两平台本地 Debug Build 的实际结果在 STATUS 汇总。此维护不选择新框架或产品策略，也不表示 UI/物理设备验收完成。依据：[Expo Scene lifecycle 说明](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md)、[Apple Scene lifecycle 文档](https://developer.apple.com/documentation/uikit/transitioning-to-the-uikit-scene-based-life-cycle)。

兼容维护（2026-10-23，主版本升级）：按“主版本升级需重新验证”的规则把 Expo 基线从 SDK 57 升到 SDK 58。新的机器事实源为 Expo `58.0.17`、React Native `0.88.0`、React `19.3.0`；NativeWind 升到 `5.0.0-rc.0`、react-native-css 升到 `3.1.0-rc.0`（仍是精确版本约束，不放宽为范围），gluestack core `5.0.15`、Tailwind CSS `4.2.0`、lightningcss `1.30.1` 与 Zod `4.6.2` 保持不变。SDK 58 默认启用 UIKit scene lifecycle，因此移除 `expo-build-properties` 的 `ios.enableSceneSupport` 配置与该依赖；同时按 react-native-screens 的要求把 `UIViewControllerBasedStatusBarAppearance` 设为 YES，状态栏样式改由 View Controller 决定。react-native-css 3.1 起拒绝 class-qualified `:root` 选择器，主题只保留 `:root` 与 `@media (prefers-color-scheme: dark)`。`expo-sqlite` 移除 libSQL 能力、`expo-router` 导航内核变化、RN 0.88 Strict TypeScript API 默认开启与被移除的 RN API 属于本次升级的兼容评估范围，评估结论与实际门禁、原生构建证据汇总于 STATUS。本次升级不改变产品范围、Runtime Schema 组合或发布策略，也不表示物理设备验收完成。

## Decision Record Template

```text
ID / Status
问题与选择
影响的需求与实施阶段
生效前默认行为
负责人角色 / 决策日期
结论与验证依据
规范 / ADR / 验收场景链接
```

## <a id="dec-013"></a>DEC-013 — 内部账号与 Local-first 同步扩展

**Status:** Closed (2026-10-25)。负责人：用户直接确认。采用 Kratos v3 / sqlc+pgx / PostgreSQL 18；保留 Local-first，同时接入移动端。完整业务事实登录后自动同步，冲突人工处理，活跃专注/放松仅发起设备可操作，每设备单独开启 OS 投影。邮箱密码仅注册/登录及会话，不含验证/找回；只验收本地联调。本条批准新增范围，不关闭 DEC-005/007/009/011/012，不表示实现完成或授权公网发布。架构与影响见 ADR-0010、REQ-AUTH-001、REQ-SYNC-001。

## <a id="dec-014"></a>DEC-014 — 包管理与脚本运行时从 Bun 迁移到 pnpm + Node

**Status:** Closed (2026-10-26)。负责人：用户直接要求“不再使用 bun，使用 pnpm 替代”。

- 问题与选择：仓库原以 Bun 作为包管理器、脚本运行器和 TypeScript 脚本运行时（`bun run`、`bunx`、`bun run.ts`、`bun:sqlite`、`Bun.spawn`）。迁移到 pnpm 11 作为唯一包管理器与脚本入口，Node 24 作为仓库脚本运行时，TypeScript 脚本通过 `tsx` 执行。
- 结论：`bun.lock` / `bunfig.toml` / `@types/bun` 全部移除，新增 `pnpm-workspace.yaml`（`packages: apps/*, packages/*`）与 `pnpm-lock.yaml`；`nodeLinker: hoisted` 保持与原 Bun hoisted 布局一致的扁平 `node_modules`，避免 Expo/Metro/CocoaPods/Gradle 的原生解析路径变化；`lightningcss` 锁定 `1.30.1` 的约束迁移为 pnpm `overrides`（否则 react-native-css 编译会与原生绑定版本不匹配而失败）。仓库脚本从 Bun API 迁移到 Node API：`Bun.spawn` → `node:child_process`、`Bun.file` → `node:fs`、`Bun.sleep` → `node:timers/promises`、`bun:sqlite` → `node:sqlite`、`import.meta.dir` → 由 `import.meta.url` 推导；跨脚本公共逻辑收敛到 `scripts/lib/runtime.ts`。
- 影响的需求与实施阶段：不改变任何 Requirement、Acceptance Criteria、Phase Exit 或产品范围；影响的是开发工具链、CI 与文档命令表述。
- 补充决定（2026-10-26，用户直接要求“仅仅根目录运行项目的脚本使用 python，其他地方应该使用 nodejs 脚本的不要变”）：根目录交互入口由 `run.ts` 改为 `run.py`（`python3 run.py [--port 8081]`），删除原 TypeScript 入口；`package.json` 的 pnpm 脚本面保持全部为 Node/pnpm 命令，根入口直接以 `python3 run.py` 调用，不加入 Python 别名；`scripts/` 下的仓库门禁、测试与工具脚本保持 TypeScript，由 `tsx` 在 Node 24 下执行，不做语言替换。根入口的 App identity 改由 `expo config --type public --json` 读取，端口探测改用 Python `socket`，其余行为（复用/启动 `--offline` dev-client Metro、校验 manifest 项目路径、打开 iOS 模拟器与 Development Build、Ctrl+C 结束本次启动的 Metro）与原实现一致。
- 生效前默认行为：迁移完成前以 Bun 为准；迁移后所有命令以 pnpm 为准，不再保留 Bun 回退路径。
- 结论与验证依据：`pnpm install --frozen-lockfile` 在 CI 可复现；`pnpm run check` 全量通过（format、lint、typecheck、unit、architecture、integration、docs、release、server check、双平台 production Hermes bundle export）；`expo install --check` 与 `expo-doctor` 20/20；iOS/Android 原生 Debug Build 与 iOS Simulator 实际启动证据见 STATUS。
- 规范链接：ADR-0001（移动端基线）、DEC-004（依赖基线与升级规则）、[STATUS](../.ai/STATUS.md)。
