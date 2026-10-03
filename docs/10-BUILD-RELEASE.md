# 10 — Build & Release

## 1. Target Platforms

V1：

- iOS
- Android

Web / Desktop 非 V1 正式交付目标。

---

## 2. Build Modes

```text
development
preview
production
```

开发必须使用 Expo Development Build。

不以 Expo Go 作为完整能力验证环境。

---

## 3. Build Tooling

采用：

- EAS Build
- EAS Submit
- Expo Updates 保持关闭，是否启用 production OTA 在上线前按 DEC-008 确认

`apps/mobile/eas.json` 是当前 EAS 机器配置源，和移动端 `package.json` 放在同一项目根目录。根工作区将 `eas-cli` 精确锁定为 `24.3.0`；profiles 使用 `development / preview / production` 三套 EAS environment，并通过非 Secret `APP_VARIANT` 解析独立 display name、scheme 与 bundle/package identity。客户端可读值不能作为 Secret；账号 token、签名材料和 store service account 不得写入 `eas.json` 或仓库。

当前版本基线为 App `0.1.0`、iOS build `1`、Android versionCode `1`。EAS 以 remote appVersionSource 管理后续 developer-facing build number，production profile 自动递增；首次关联已有商店记录时必须先由授权发布者核对远端值，不能覆盖或重复已使用的 build number。

---

## 4. Scripts

Phase 0 已建立以下入口。实际通过记录只写入 STATUS；后续阶段必须随着能力增加扩展对应测试，不能因入口存在而宣称业务功能已覆盖。

| 命令 | 职责 |
| --- | --- |
| `bun run dev` | 启动开发服务 |
| `bun run ios` / `bun run android` | 启动对应 Development Build 工作流 |
| `bun run format` / `bun run format:check` | 格式修复 / 只读格式检查 |
| `bun run lint` | 静态规则 |
| `bun run typecheck` | 所有已建立工作区类型检查 |
| `bun run test` | Pure TS 与适用的组件/单元测试 |
| `bun run test:architecture` | forbidden import 与跨包依赖方向 |
| `bun run test:integration` | 当前阶段的 Repository/Application/Fake Adapter 集成 |
| `bun run docs:check` | 文档链接、引用、覆盖矩阵与清单 |
| `bun run release:check` | 校验版本、三套 Expo/EAS variant、OTA 默认、发布清单与隐私草案；只证明静态配置，不证明账号/签名/商店可用 |
| `bun run build:check` | 当前阶段已建立 App 的配置与 bundler/export 检查；不等于原生签名/真机验证 |
| `bun run check` | 顺序聚合 format:check、lint、typecheck、test、test:architecture、test:integration、docs:check、build:check |
| `bun run test:e2e` | 读取经审核的物理 iOS/Android 证据并要求 E2E-001…005 全部通过；缺文件、模拟器或 pending 项均失败 |
| `bun run build:preview:ios` / `build:preview:android` | 创建可内部安装的 EAS preview build |
| `bun run build:ios` / `build:android` | 创建 production store build；需要已授权 EAS 项目与签名 |
| `bun run submit:ios` / `submit:android` | 用 production submit profile 提交；Android 默认 internal track + draft，最终推广仍需人工审核 |
| `bun run release:gate` | 先执行完整仓库门禁，再验证两平台物理设备 E2E 证据；不自动构建或提交商店 |

`test:e2e` 要求设置 `NEXTA_IOS_DEVICE_EVIDENCE` 与 `NEXTA_ANDROID_DEVICE_EVIDENCE`，指向根据 `release/device-evidence.*.example.json` 复制并填写的审阅结果。每个平台必须是 physicalDevice，记录设备、OS、build identifier、测试者、时间，并为 E2E-001 至 E2E-005 每项提供至少一条证据引用。该命令验证证据完整性，不替代实际按第 11 节和 Testing 文档执行旅程。

阶段报告必须说明实际覆盖。尚未接入的业务/平台集成写明未覆盖；不得用空套件成功宣称 V1 功能已通过。Phase 0 的最小原生 Development Build 单独验收并记录。

Calendar/Notification 的 Application、SQLite、Expo Adapter 代码、注入 native facade 测试或仅前台 Mobile Runtime 组合通过，均不等于系统权限、真实投递或端到端产品路径通过。Phase 3 必须另外记录平台、OS 版本、账户/source、权限初始状态、前后台/终止场景及实际 readback。

---

## 5. Signing

- iOS Signing 通过安全的 Apple Developer 流程；
- Android Signing Key 不入 Git；
- CI Secret 使用平台 Secret Store。

---

## 6. Versioning

采用：

```text
SemVer（代码版本）
+
平台 build number
```

Schema 另有 DB schema version。

用户可见版本、iOS buildNumber 与 Android versionCode 均由 App Config 显式声明；production EAS build 使用 remote build version 自动递增。Marketing version 变化仍必须通过代码评审同步移动包版本、隐私草案、release checklist 和 migration 兼容性，不能只改 EAS 远端值。

---

## 7. Database Migration

发布前必须：

- 从上一个 Production Schema 做 Upgrade Test；
- 当前开发历史至少验证 `0000 → … → 0008`，不得改写既有 SQL/checksum；
- 验证失败路径；
- 禁止 destructive reset。

Node SQLite upgrade/rollback 证明 migration 协议，不替代 Expo SQLite Development Build 在 iOS/Android 上的打开、升级、事务、写读与 App 重启持久化 smoke。

Phase 9 的文件型 Node SQLite 组合场景还必须真实关闭/重开连接，并验证重复 migration、响应丢失后的 operationId 重放、Execution/Relax active 状态恢复、完成证据唯一及离线 IntegrationJob 保持。该证据仍不能替代移动 OS 强杀、真实 Provider 超时、通知离线投递或物理设备长期运行。

早期未发布 Development Build 的 `0006_phase6_agent_runs` 曾记录全零占位 checksum。当前兼容桥只在该唯一旧标记、其他历史全部正确且 SQLite 中 `agent_runs` 表与索引和固定 `0006` SQL 精确一致时，才在事务内条件更新 checksum；这不是通用历史修复或跳过校验机制。Node SQLite 已覆盖成功保留数据、缺索引拒绝、任意错误 checksum 拒绝与其他历史损坏不改写；iOS 26.5 Simulator 已无清库验证旧库继续升级到 `0008`、integrity `ok` 和已有事实保留。两平台 production/物理设备仍必须各自执行升级测试。

---

## 8. Release Channels

```text
development
internal / preview
production
```

development profile 含 expo-dev-client 且 internal distribution；preview 是不含开发工具的 internal build；production 生成商店制品。DEC-008 仍为 Open，因此 App Config 对三个 variant 都显式 `updates.enabled = false`，EAS profiles 不设置 OTA channel。接受 OTA 后必须先补 expo-updates/runtimeVersion/兼容与回滚 ADR/测试，不得只添加 channel 字符串。

---

## 9. Rollback

JS-only OTA 如果启用，必须保证：

- 与 DB Schema 兼容；
- 不回滚到无法读取新 Schema 的版本。

Native / Schema Breaking Release 不依赖简单 OTA 回滚。

---

## 10. CI

至少：

```text
format:check
lint
typecheck
unit
architecture test
integration
docs:check
build:check
```

Release Branch 增加：

```text
mobile build smoke
critical E2E
```

---

## 11. Release Checklist

```text
[ ] Version bump
[ ] Changelog
[ ] Migration tested
[ ] iOS build PASS
[ ] Android build PASS
[ ] Calendar permissions PASS
[ ] Notifications PASS
[ ] Offline core PASS
[ ] Agent smoke PASS
[ ] Scheduler regression PASS
[ ] Security checklist PASS
[ ] Production OTA / 加密 / 系统备份与恢复边界决策完成
[ ] V1 MUST 验收证据齐全，未交付 SHOULD 已说明
[ ] Privacy text reviewed
[ ] Store metadata reviewed
```

仓库中的 `release/release-checklist.json` 是机器可检查的发布入口清单，`release/store-privacy.json` 是中英文商店隐私文案草案。它们明确保留 pending 外部门禁，不得因为 `release:check` 通过而把隐私、签名或商店审核标记为完成。真实发布前至少补齐：

- Expo 项目 owner/projectId 与中性 bundle/package identifier 的商店可用性确认；
- Apple Developer/App Store Connect 与 Google Play 授权、签名和 service account；
- DEC-001/005/006/007/008/009/011/012 的相关结论；
- 公共 Privacy Policy URL 及按签名二进制复核的 Apple App Privacy / Google Data safety；
- 两平台 production migration、权限、Calendar/Notification、离线/强杀、Agent 与 E2E-001…005 证据。

### Authorized Release Handoff

发布负责人可按以下顺序提供外部输入；不得把账号密码、token、证书或 service account 文件贴入仓库、Issue、聊天记录或证据 JSON。

1. 产品、隐私和算法负责人先按 [DECISIONS 的 Resolution Input Packet](DECISIONS.md#resolution-input-packet) 关闭影响首发的条目，并更新对应 Canonical Docs / ADR。
2. 授权发布者在本机登录 EAS，确认 Expo owner/projectId 与 iOS/Android identifier 的可用性；签名和商店 service account 只通过对应平台的 Secret / Credentials 流程配置。
3. 使用经授权的 preview build，在各一台物理 iOS、Android 设备上执行 E2E-001…005 和本章的 Calendar / Notification 清单；从 `release/device-evidence.*.example.json` 建立经审核的证据文件，再执行 `bun run test:e2e`。
4. 基于最终签名二进制审核 Privacy Policy URL、Apple App Privacy 与 Google Data safety；全部外部门禁具备可追溯依据后，才运行 production build、submit 与最终 `bun run release:gate`。

### Phase 3 Device Evidence

Calendar 至少记录：

- 首次未授权、拒绝、再次请求/Settings 恢复，且 background worker 不弹框；
- 选定 iOS/Android Calendar source/account 上创建 App-owned Calendar，重启后按 verified ownership readback；
- 有界 Busy 查询、重复事件实例、complete/partial 能力与自有事件去重；
- 创建、移动、删除、用户在系统 Calendar 编辑、重复身份，以及进程在 intent 已提交、外部成功、本地 binding checkpoint 前后分别终止的恢复；
- 不修改第三方事件。

Notification 至少记录：

- 未授权、拒绝、Settings 恢复与后台不弹框；
- 未来提醒注册、`0` 与非零用户提前量的实际触发时间、非法值拒绝、离线到点投递、重排更新/取消、App 重启及进程终止恢复；
- iOS 锁屏/预览内容与 Android channel、声音/振动的实际配置符合 [DEC-012](DECISIONS.md#dec-012) 的最终结论；
- 稳定身份不会重复注册，旧 revision/过期 worker 不覆盖新计划。

Phase 3 正式关闭还必须证明 production SchedulingSnapshot 与 ScheduleService 已由 Mobile Composition 接入，并由产品关闭 DEC-012 后验证最终 Projection policy；当前显式注入的保守基线、测试 fixture 中的 policy 或 source 都不构成已接受的发布决策。


## 12. 验证证据

每次验证记录日期、命令/手工步骤、平台与环境、覆盖范围、结果和失败原因。依赖组合由 DEC-004 跟踪；文档中的设计版本不构成兼容证据。离线、Calendar、Notification 与计时恢复必须保留真实设备验证记录。

仅文档修改时执行文档检查并在 STATUS 标明代码检查不适用/尚不可运行，不能运行不存在的脚本后省略失败或改写为通过。
