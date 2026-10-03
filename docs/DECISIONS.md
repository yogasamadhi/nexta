# Open Decisions

此文件集中记录尚未接受的产品或技术选择。`Open` 不等于阻塞整个项目，只阻塞表中指定的能力或阶段；进入相关实现前必须检查。已接受架构决策保存在 [ADR](ADR/README.md)，实际进展保存在 [STATUS](../.ai/STATUS.md)。

关闭事项时记录结论、日期、依据和相关规范/ADR；禁止只删除条目。表内默认行为是当前实现边界，不代表已验证最终方案。

| ID | 状态 | 待决策内容 | 影响阶段 / 关闭条件 | 生效前默认行为 |
| --- | --- | --- | --- | --- |
| <a id="dec-001"></a>DEC-001 | Open | 首批试用人群、观察周期、产品成功阈值 | Phase 5 试用前由产品负责人确定；不阻塞 Phase 0 | 保留现有目标用户与 V1 范围；以手工任务到真实完成的闭环准备试用，不宣称价值已验证 |
| <a id="dec-002"></a>DEC-002 | Open | 自动重排允许移动的块数、累计偏移量、临近开始保护窗口、Undo 保留期 | 自动提交分支启用前完成产品评审和边界验收 | 可自动计算 Preview；提交由用户确认。跨天、Deadline 风险、受保护块不进入自动提交 |
| <a id="dec-003"></a>DEC-003 | Open | 最终品牌与可迁移包标识 | 原生应用标识锁定前 | 使用中性工程命名，不将暂定品牌绑定 bundle/package ID |
| <a id="dec-004"></a>DEC-004 | Closed (2026-09-12) | Expo / RN / UI 库兼容组合及 Runtime Schema 库版本 | Phase 0 已完成最小 iOS/Android Development Build 与依赖验证 | 使用下方关闭记录中的锁定基线；任何升级重新执行相同验证 |
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

## Closed Decision Records

### DEC-004 — Expo / RN / UI / Runtime Schema 基线

- 决策日期：2026-09-12。
- 结论：采用 Expo `57.0.22`、React Native `0.86.3`、React `19.2.3`；UI 基线采用 gluestack core `5.0.15`、NativeWind `5.0.0-preview.4`、react-native-css `3.0.7`、Tailwind CSS `4.2.0`，并锁定 lightningcss `1.30.1`；Runtime Schema 采用 Zod `4.6.2`。
- 包管理约束：Bun 使用 hoisted linker，精确解析结果保存在 `bun.lock`；NativeWind 仍是 preview 版本，因此升级前不得放宽其精确版本约束。
- 验证依据：`expo install --check` 无版本偏差，`expo-doctor` 21/21 通过；iOS/Android Hermes Bundle 均成功；iOS Development Build 在模拟器完成编译、签名、安装和页面加载；Android arm64 Debug Development Build 成功生成 APK，另有默认四 ABI 构建通过记录。
- 后续规则：任何影响该组合的升级必须重新运行 `bun run check`、`expo install --check`、`expo-doctor` 以及对应平台原生 Development Build；验证事实汇总于 [STATUS](../.ai/STATUS.md)。

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
