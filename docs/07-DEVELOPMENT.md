# 07 — Development

## 1. Repository

采用 Monorepo。

```text
apps/mobile
packages/*
docs
.ai
```

Bun 作为包管理与脚本入口。

Hermes 是 Mobile JS Runtime；Bun 不作为 App Runtime。

---

## 2. Package Boundaries

### Pure Packages

以下包必须保持平台无关：

```text
domain
application
agent-tools
scheduler-core
agent-core
user-model（算法部分）
```

禁止 import：

```text
expo
react
react-native
node:*
```

Ports 属于 Application 或纯契约模块；Infrastructure 只能实现并由 Composition Root 注入。架构检查除 forbidden import 外，也检查反向依赖，例如 application → database 与 domain → application。规则依据 [ADR-0009](ADR/0009-application-commit-and-recovery.md)。

### Infrastructure Packages

允许平台实现：

```text
database
calendar
notifications
model-runtime
```

---

## 3. TypeScript Rules

- strict mode；
- 禁止无理由 `any`；
- public Contract 必须显式类型；
- Enum 优先使用 string union；
- 所有外部输入 Runtime Validate；
- 时间值不得混用裸 string 与 Date；
- 使用 [数据模型的时间语义](04-DATA-MODEL.md#23-时间语义)，区分 Instant / LocalDate / TimeZone，明确 `[start, end)` 与 DST 校验。
- 移动端本地日期/时间表单不能用 `new Date("YYYY-MM-DDTHH:mm")` 猜设备时区；应经 IntlTemporalAdapter 显式解析并处理 DST gap/fold。键盘智能标点需要先规范化，再执行严格格式校验。

---

## 4. Naming

```text
Entity: Task, TimeBlock
Service: TaskService
Port: CalendarProvider
Adapter: ExpoCalendarAdapter
Repository: TaskRepository
Error: SchedulingConflictError
Tool: task.create
```

---

## 5. Validation

边界必须校验：

- Agent Tool Input
- LLM Structured Output
- DB Migration Input
- External Calendar Data
- User Import
- Future Sync Payload

推荐统一 Zod 或等价 Runtime Schema。

未经 ADR 不得在多个包混用不同 Schema 库。

---

## 6. Error Handling

禁止：

```ts
catch {}
```

禁止用 `null` 模糊表示所有失败。

错误必须可分类、可记录、可转成 UI 状态。

---

## 7. Logging

日志必须：

- 有 level；
- 有 category；
- 不打印 Secret；
- 不默认打印完整 LLM Context；
- 不打印完整用户日历内容；
- Agent Tool 记录 Tool Name / Result Status，而非敏感 Payload 全量。

---

## 8. Configuration

环境配置：

```text
development
preview
production
```

Secret 不写入 Git。

Provider Key：

- 用户 BYOK → SecureStore；
- 项目开发 Key → 仅开发工具/构建服务按需安全注入，不通过客户端环境变量打包为生产共享凭据；生产调用方式见 DEC-005。

---

## 9. Database Migration

- Migration 文件入库；
- 每次 Schema Change 必须有测试；
- 禁止自动 reset；
- Upgrade Fail 必须安全停止并提供错误状态；
- Migration 完成后再启动依赖新字段的逻辑。

---

## 10. Git Workflow

建议：

```text
main
feature/*
fix/*
refactor/*
docs/*
```

每个变更尽量对应 Requirement / Task。

Commit 示例：

```text
feat(scheduler): add deterministic plan preview
fix(calendar): avoid duplicate app events
docs(agent): clarify tool risk levels
```

---

## 11. Dependency Policy

新增依赖前检查：

1. 是否能用平台能力解决；
2. 是否维护活跃；
3. 是否支持 Expo / Hermes；
4. 是否引入 Node-only API；
5. 是否显著增加 bundle；
6. 是否影响 Native Build；
7. 是否可被更小的库替代。

大型依赖需说明理由。

---

## 12. NativeWind / gluestack

- 锁定验证过的版本；
- 不盲目使用 `latest`；
- 升级必须跑 iOS + Android Regression；
- Design Token 尽量统一定义，避免 Screen 内硬编码。

---

## 13. Reanimated

动画只表达：

- TimeBlock 移动；
- 状态变化；
- Focus / Relax；
- Success feedback；
- 页面过渡。

必须支持 Reduce Motion。

---

## 14. Agent Development

任何 Agent Tool 必须包含：

```text
name
description
risk
inputSchema
outputSchema
execute
tests
```

禁止 Tool 直接拿到任意 DB Handle。

必须通过受限 Application Service。

---

## 15. Scheduler Development

Scheduler 变更必须：

- 增加 deterministic test；
- 增加 invariant test；
- 记录 algorithm version；
- 不破坏已提交 Plan 的审计解释。

固定负载测量使用 `bun run bench:scheduler`。Fixture 与独立后置不变量位于 `tests/benchmarks/scheduler`，计时、Git/主机信息与结果文件写入仅位于 `scripts/benchmark-scheduler.ts`，不向 Pure Core 引入 Node、时钟或文件副作用。测试目录中的显式 policy 仅用于测量，不构成生产权重决定。

本地 UI 驱动使用 `bun run test:ui`，流程源位于 `tests/ui/flows`，平台控制与只读测试库断言位于 `scripts/test-ui.ts`。稳定 testID 只标识现有控件，不作为业务 authority；合成 fixture 经真实 UI/Application Service 写入，禁止生产清库、任意写表或伪造成就的测试入口。Runner 只允许 ownership receipt 与实际名称/UDID/AVD 对齐的专用设备重装 development App；已有用户设备不能被自动接管。两平台新安装的测试沙盒仅调整 Expo 开发菜单的首启、引导和悬浮按钮偏好，避免诊断控件遮挡业务按钮，不写业务数据库。Android 只读事实经 run-as/sqlite3 -readonly 获取；短暂 ADB transport loss 可以有界等待重连后重新读取，但数据库错误和业务断言不能重试隐藏，任务创建和提交不自动重试。网络禁用与本地开发 bridge 分别记录。原始构建/驱动日志与截图位于忽略的 `.artifacts/`，结构化结果另存 `.ai/evidence/optimization/`。

第三方组件不能仅凭 TypeScript 接受 `className` 就假设 NativeWind 已适配。当前 `react-native-safe-area-context` 的 SafeAreaView 使用原生 `style` 提供必要 flex、背景与居中布局；文字和原生滚动组件仍沿用现有样式体系。主动 Relax 内容须可滚动，窄屏/大字体下结束与离开动作保持可达。UI 驱动在每阶段前重建专用 Android 的 ADB localhost 转发，以应对连接恢复后映射丢失；该开发通道不启用业务网络。

实际 Hermes 验证使用独立 `apps/mobile/testing` Expo 宿主及 `bun run test:hermes`。该入口不属于生产 Router，不访问业务 SQLite/真实 Provider；执行有限 Fake Agent、纯排程场景，以及仅在独立合成数据库上的 Native Preference 诊断。宿主计时允许使用 performance.now，不能将测试计时或文件/ADB 控制移入 Pure Core。脚本只重启已核对归属的 development App，记录 Hermes runtime properties、代码摘要、原生 App 版本、断言与样本；没有模拟器/宿主时单列未执行。

本地构建、UI 驱动与 profiler 的大型生成物使用 `.artifacts/`，该目录由 Git、格式、lint 与文档清单检查排除。可入库的合成结果摘要位于 `.ai/evidence/optimization/`，实际验证结论统一记录在 STATUS；禁止保存真实用户内容或凭据。

---

## 16. Code Review Checklist

```text
[ ] 是否越过 package boundary
[ ] 是否新增隐式 side effect
[ ] 是否破坏 offline
[ ] 是否引入 Node-only API
[ ] 是否有 runtime validation
[ ] 是否泄露 secret / privacy data
[ ] 是否需要更新 docs
[ ] 是否需要 ADR
[ ] 是否有 tests
```


---

## 17. 应用用例与可靠性

- 实现 Task/Execution/Commit 时同时建立事务、版本与操作幂等；不等到 Phase 9 才补基础保障。
- SQLite 与 OS Adapter 不组成一个原子事务；本地事实与待同步作业先事务写入，再执行外部操作。失败语义以 [Commit Contract](05-API.md#commit-contract) 为准。
- UI 串联多个 Application 用例时必须分别呈现已提交结果：例如 Task create/update 成功而后续 Preview 失败，不能向用户暗示 Task 也已回滚或诱导重复创建。
- 业务规则只有应用服务/Domain 一套实现，UI 和 Agent 共用；不得让 Tool 自行 patch 完成状态。
- Goal/Project/Task 等用户列表必须通过 Application Service 的有界查询 Contract；稳定排序和 cursor 校验在应用层收口，Screen 不直接取 Repository，也不把手工百分比写成 Goal 进度。
- 测试使用注入时钟、固定输入与 Fake Adapter。崩溃注入至少覆盖本地提交后响应丢失、外部创建后映射未写入；不通过盲目重试掩盖不确定结果。
- Calendar/Notification Provider 调用必须在 Composition Root 统一设置有限超时并注入 Timer；只读超时与可能写入的超时使用不同恢复语义，测试必须分别覆盖。
- 会改变既有 OS 投影的偏好必须在同一事务推进 stateVersion 并建立 durable 重排意图；不得重置 processing、待核对或带未解决 ExternalMutationIntent 的作业。Provider 调用期间输入变化时，worker 应 checkpoint 已核验结果后重新排队收敛。
- 前台权限请求或直接用户释放 Calendar provisioning 待核对 intent 后，Mobile 宿主必须 best-effort 唤醒前台协调器；授权/requeue/intent 删除的本地事务已经提交时，唤醒失败不得伪装为写入失败或诱导重复确认。
- Task 完成或取消等终态操作必须复用应用层计划变更辅助逻辑：同一事务收口 Session/Interval/Block、Task、OperationRecord、ScheduleState、必要 SchedulePlan 与 IntegrationJob。取消不能生成 CompletionRecord/Achievement；存在 Block 变化时不能只推进 stateVersion 而遗漏 planRevision/外部投影清理。
- 组合可靠性测试应使用文件型 SQLite 真正关闭/重开连接，验证 migration 重入、active 状态恢复、operationId 精确重放、唯一完成事实和 durable pending Job；内存 Fake 不能单独证明进程恢复。
- migration 历史修复不得成为通用跳过 checksum 的入口；若为未发布开发构建增加兼容桥，必须固定唯一 id/from/to checksum、先验证其他历史和实际 Schema 完全匹配、在事务内条件更新，并覆盖成功、Schema 不匹配、任意错误 checksum 与其他历史损坏测试。生产历史仍只能追加 migration。
- 尚无生产 Schema 的阶段可完善设计，但第一次落地后 Schema 变化必须配迁移；不把 Markdown 字段表当作已运行的数据库。

## 18. 文档维护

- Requirement ID 与 AC ID 保持稳定；需求、Phase、场景与验证方法的映射由 `08-TESTING-ACCEPTANCE.md` 维护。
- 产品范围和自治权限等未决项先登记 `DECISIONS.md`，注明影响阶段与当前默认行为；实现不得静默跨过未决边界。
- README 维护概览和入口，CONTEXT 维护稳定摘要，STATUS 维护实际状态与验证证据；避免复制易变版本列表。
- 代码任务更新相关 Canonical Docs、映射与 STATUS；纯文档任务记录链接/引用/结构和语义检查，不把代码检查标为通过。
- ADR 保存决定及原因；实现细节放在规范文档。历史 ADR 保留，补充决策明确与既有 ADR 的关系。
