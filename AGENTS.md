# AGENTS.md

## 1. Project Entry

本项目是 **Nexta / 步迹（暂定）**：一个移动端优先、Local-first 的 AI Personal Execution Agent。

AI Coding Agent 的角色：

- 主要代码实施者；
- 测试实施者；
- 文档维护者；
- 架构边界守护者；
- 不替代人类做产品价值判断和重大范围决策。

核心产品哲学：

> **计划未来，专注当下，看见成长。**

> **用户只负责现在，系统负责维护之后的可执行计划。**

---

## 2. Source of Truth

```text
产品定位
→ docs/01-PRODUCT.md

需求
→ docs/02-REQUIREMENTS.md

架构
→ docs/03-ARCHITECTURE.md

数据模型
→ docs/04-DATA-MODEL.md

Contract / API
→ docs/05-API.md

UI/UX
→ docs/06-UI-UX.md

开发规范
→ docs/07-DEVELOPMENT.md

测试与验收
→ docs/08-TESTING-ACCEPTANCE.md

安全
→ docs/09-SECURITY.md

构建发布
→ docs/10-BUILD-RELEASE.md

重大设计决策
→ docs/ADR/

待决策事项 / 生效前默认行为
→ docs/DECISIONS.md

项目压缩上下文
→ .ai/CONTEXT.md

实施路线
→ .ai/PLAN.md

当前状态
→ .ai/STATUS.md
```

---

## 3. Session Start Protocol

每次开始新的 Coding Session：

```text
1. 读取 AGENTS.md
2. 读取 .ai/CONTEXT.md
3. 读取 .ai/STATUS.md
4. 判断当前任务与允许范围
5. 必要时读取 .ai/PLAN.md，并检查 docs/DECISIONS.md 中与当前阶段相关的待决策项
6. 按 Documentation Routing 加载相关 Canonical Docs
7. 检查当前实现，不假设文档等于代码
8. 再开始修改
```

---

## 4. Documentation Routing

### 产品范围变化

```text
01-PRODUCT
02-REQUIREMENTS
必要时 ADR / CONTEXT / PLAN
```

### Scheduler

```text
02-REQUIREMENTS
03-ARCHITECTURE
04-DATA-MODEL
05-API
07-DEVELOPMENT
08-TESTING-ACCEPTANCE
相关 ADR
```

### Agent / Tool Calling

```text
02-REQUIREMENTS
03-ARCHITECTURE
05-API
09-SECURITY
08-TESTING-ACCEPTANCE
ADR-0004 / ADR-0005
ADR-0009
```

### Calendar / Notification

```text
02-REQUIREMENTS
03-ARCHITECTURE
05-API
06-UI-UX
09-SECURITY
10-BUILD-RELEASE
```

### UI

```text
02-REQUIREMENTS
06-UI-UX
08-TESTING-ACCEPTANCE
```

### Database

```text
02-REQUIREMENTS
03-ARCHITECTURE
04-DATA-MODEL
07-DEVELOPMENT
08-TESTING-ACCEPTANCE
09-SECURITY
ADR-0009
```

### Execution / Completion / Plan Commit

```text
02-REQUIREMENTS
03-ARCHITECTURE
04-DATA-MODEL（状态迁移 / 完成证据）
05-API（应用事务 / 幂等 / 提交结果）
06-UI-UX
08-TESTING-ACCEPTANCE
ADR-0009
```

### User Model / Reflection / Success Diary

```text
01-PRODUCT
02-REQUIREMENTS
03-ARCHITECTURE
04-DATA-MODEL
06-UI-UX
09-SECURITY
```

### Build / Release

```text
07-DEVELOPMENT
09-SECURITY
10-BUILD-RELEASE
```

---

## 5. Hard Architecture Rules

以下规则未经 ADR 不得违反：

1. `scheduler-core` 必须是 **Pure TypeScript**。
2. `scheduler-core` 不得依赖 React、React Native、Expo、LLM SDK、SQLite。
3. Agent 不直接“凭语言模型感觉”决定最终排程；排程必须通过 `scheduler-core`。
4. `agent-core` 必须兼容 Hermes，不得依赖 `node:*`、`child_process`、Node FS、Shell。
5. Mobile V1 不引入常驻后台 Agent Daemon。
6. Agent 运行采用 Event-driven 模型。
7. 核心业务数据 Local-first，SQLite 为本地事实源。
8. Secret / API Key 不得写入普通 SQLite 业务表。
9. V1 读取用户授权的系统日历；写入优先使用 App 自有 Calendar，禁止静默修改用户原有外部事件。
10. Tool Input 必须经过运行时 Schema Validation。
11. Agent Tool 必须经过权限与风险等级控制。
12. UI 不得直接访问数据库表；必须经过 Repository / Application Service。
13. Domain 不依赖 Expo。
14. 数据库 Schema 机器事实源为 Drizzle Schema；Markdown 保存业务语义与约束。
15. Success Diary 必须来源于真实完成记录，不生成虚假的“成就”。
16. 心理学/正念功能属于生产力、自我反思和恢复支持，不得宣称心理治疗、诊断或医疗效果。
17. 未经明确决策，不引入 LangGraph.js。
18. 未经明确决策，不在 Hermes 中直接运行大语言模型推理。
19. 品牌名未定稿前，不将 `Nexta` / `步迹` 写死为不可迁移的 bundle/package 命名。

---

## 6. Change Rules

AI 不得为了完成当前任务：

- 随意重构无关模块；
- 随意更换框架；
- 随意加入大型依赖；
- 静默改变公共 Contract；
- 删除测试以让 CI 通过；
- 绕过架构边界；
- 将临时代码永久化；
- 把业务规则藏进 UI；
- 让 LLM 输出直接写入数据库而不校验；
- 在没有迁移策略时直接破坏持久化数据。

---

## 7. Documentation Evolution Protocol

文档是 Living Documentation。

- `MUST / SHOULD / FUTURE` 表示需求必要程度，不表示实现状态。
- ADR 的 `Accepted` 表示设计已接受，不表示代码、依赖兼容性或设备能力已验证。
- 当前实现与验证证据只在 `.ai/STATUS.md` 汇总；阶段依赖在 `.ai/PLAN.md` 维护。
- 待决策项统一记录于 `docs/DECISIONS.md`，包含影响阶段与生效前默认行为；不得由 AI 静默当作已接受决策实现。
- Canonical Docs 维护规则全文；README / CONTEXT 保留摘要和引用。涉及易变版本与状态时优先引用权威位置。

发现冲突时必须判断：

```text
实现错误？
→ 修实现

设计过时？
→ 更新 Canonical Docs
→ 必要时新建/替代 ADR
→ 同步 CONTEXT / PLAN / STATUS
```

禁止：

- 为服从旧文档坚持已知错误设计；
- 让代码长期静默偏离文档。

---

## 8. Documentation Impact Assessment

任务结束前逐项判断：

```text
[ ] Product
[ ] Requirements
[ ] Architecture
[ ] Data Model
[ ] API / Contracts
[ ] UI/UX
[ ] Development
[ ] Testing
[ ] Security
[ ] Build / Release
[ ] ADR
[ ] AI Context
[ ] Implementation Plan
[ ] Status
```

---

## 9. Verification Protocol

仓库工具链：pnpm 11（包管理、脚本入口，hoisted node_modules 布局）+ Node 24（仓库脚本运行时，通过 tsx 执行 TypeScript 脚本）。不再使用 Bun。

目标命令：

```bash
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run test:architecture
pnpm run test:integration
pnpm run docs:check
pnpm run build:check
```

仓库统一入口：

```bash
pnpm run check
```

移动端关键能力进入对应 Phase 后增加：

```bash
pnpm run test:e2e
```

任何不存在的命令应在 Phase 0 中建立，不得伪造“已通过”。

命令职责及分阶段验证环境以 `docs/10-BUILD-RELEASE.md` 为准。`build:check` 不等于真机 Development Build 通过。

仅修改文档且尚无工程脚本时，检查本地链接、Requirement / Acceptance / Phase 映射、ADR 索引、文档清单与跨文档语义；在 STATUS 中记录检查结果及未执行代码验证的原因。不得为了文档任务提前搭建业务工程。

---

## 10. Completion Protocol

任务只有同时满足以下条件才能标记 DONE：

```text
[ ] 实现完成
[ ] 相关测试完成
[ ] Acceptance Criteria 满足
[ ] Verification 通过
[ ] 相关 Canonical Docs 已同步
[ ] 必要 ADR 已创建
[ ] .ai/CONTEXT.md 必要时更新
[ ] .ai/PLAN.md 必要时更新
[ ] .ai/STATUS.md 已更新
```

纯文档任务中的实现、测试项可标为“不适用”，须有原因与文档验证证据；这不代表对应业务功能已完成。
