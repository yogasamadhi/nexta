# Nexta / 步迹（暂定）

> AI Personal Execution Agent  
> **计划未来，专注当下，看见成长。**

一个移动端优先、Local-first 的个人执行助手：把想法变成任务与可执行时间块，在变化后维护计划，支持当前执行，并保存真实完成记录。

名称尚未定稿，工程与原生应用标识不得绑定不可迁移的暂定品牌。

## 项目现状

Phase 0–10 的可自主实现工程与核心业务技术基线已经建立：仓库采用 Bun Monorepo，包含 Expo Development Build 移动端、11 个职责包、统一质量检查与 CI，并已实现手工任务、确定性排程、执行/成就、受控 Agent 边界、默认关闭的行为特征缓存、离线 Reflection/Energy Check-in/Relax、文件型 SQLite 进程恢复、有界 Provider 调用，以及版本化 EAS/隐私/发布门禁骨架。真实 Provider、OS/物理设备证据、开放产品决策、签名账号和商店审核仍未完成，因此当前不能称为完整发布版。实际任务、阻塞和验证证据以 [.ai/STATUS.md](.ai/STATUS.md) 为准；实施顺序见 [.ai/PLAN.md](.ai/PLAN.md)。

## 核心设计

- 移动端优先，iOS / Android 为 V1 目标。
- SQLite 保存本地业务事实；Secret 由 SecureStore 管理。
- 纯 TypeScript Scheduler 负责约束计算；本地 Agent 负责理解、工具编排与解释。
- UI 与 Agent 共用 Application Services，统一状态迁移、事务、版本、权限与恢复。
- 读取授权日历，写入 App 自有事件；通知由 OS 调度，Agent 不常驻后台。
- Task、TimeBlock、ExecutionSession 分别记录任务、计划与执行；成就来自真实完成证据。
- 模型不可用时，手工任务、本地排程、执行和回顾仍可使用。

V1 完整范围与 MUST/SHOULD 见 [产品](docs/01-PRODUCT.md) / [需求](docs/02-REQUIREMENTS.md)。首个内部可试用闭环在 Phase 5 使用手工任务入口，Phase 6 接自然语言边界，Phase 7 建立版本化行为特征，Phase 8 加入可持续节奏；正式启用仍受相应产品决策与设备验收约束。

## 技术与目录

技术选型、版本基线和包职责统一维护在 [Architecture](docs/03-ARCHITECTURE.md)，实际解析版本以 manifest 与 `bun.lock` 为准。依赖变更后必须重新执行双平台 Bundle 检查；涉及原生依赖时还要重新执行对应 Development Build。

当前目录：

```text
apps/mobile/
packages/
  domain/
  application/
  database/
  scheduler-core/
  agent-core/
  agent-tools/
  model-runtime/
  calendar/
  notifications/
  user-model/
  ui/
docs/
.ai/
```

## 开发入口

常用命令：

```bash
bun install
bun run dev
bun run ios
bun run android
bun run check
```

完整脚本职责、原生构建与发布门禁见 [Build & Release](docs/10-BUILD-RELEASE.md)。AI 编码会话先读 [AGENTS.md](AGENTS.md)。

## 文档入口

| 内容                              | 权威文档                                                                  |
| --------------------------------- | ------------------------------------------------------------------------- |
| 产品定位、V1 与验证假设           | [01 — Product](docs/01-PRODUCT.md)                                        |
| 需求、AC 与自治规则               | [02 — Requirements](docs/02-REQUIREMENTS.md)                              |
| 分层、依赖、平台与版本目标        | [03 — Architecture](docs/03-ARCHITECTURE.md)                              |
| 实体、状态迁移、时间与统计口径    | [04 — Data Model](docs/04-DATA-MODEL.md)                                  |
| 应用服务、工具、提交与恢复        | [05 — Contracts](docs/05-API.md)                                          |
| 界面与用户可见状态                | [06 — UI/UX](docs/06-UI-UX.md)                                            |
| 实施规范                          | [07 — Development](docs/07-DEVELOPMENT.md)                                |
| 需求/阶段/验收映射                | [08 — Testing](docs/08-TESTING-ACCEPTANCE.md#requirement-matrix)          |
| 权限、隐私与 Agent 风险           | [09 — Security](docs/09-SECURITY.md)                                      |
| 工程命令与发布                    | [10 — Build & Release](docs/10-BUILD-RELEASE.md)                          |
| 已接受的架构决策                  | [ADR 索引](docs/ADR/README.md)                                            |
| 待决策项及当前默认行为            | [DECISIONS](docs/DECISIONS.md)                                            |
| AI 稳定摘要 / 阶段计划 / 实际状态 | [CONTEXT](.ai/CONTEXT.md) / [PLAN](.ai/PLAN.md) / [STATUS](.ai/STATUS.md) |

[MANIFEST](MANIFEST.md) 只记录当前 Markdown 文件清单，不维护另一套产品或实施状态。
