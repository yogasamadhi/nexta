# Architecture Decision Records

命名：

```text
0001-title.md
0002-title.md
...
```

状态：

```text
Proposed
Accepted
Deprecated
Superseded
```

ADR 不删除历史。

`Accepted` 表示设计选择已接受，不表示工程实现、依赖版本或设备能力已验证。现有 ADR 中的技术版本是决策时的设计目标；Phase 0 兼容证据见 [DEC-004](../DECISIONS.md#dec-004) 与 [STATUS](../../.ai/STATUS.md)。

重大决策改变时，新建 ADR 并写：

```text
Supersedes ADR-XXXX
```

当前 ADR：

- [0001 — Mobile-first Expo](0001-mobile-first-expo.md)
- [0002 — Local-first SQLite + Drizzle](0002-local-first-sqlite-drizzle.md)
- [0003 — Deterministic Scheduler Core](0003-deterministic-scheduler-core.md)
- [0004 — Pi-inspired Local Agent Runtime](0004-pi-inspired-local-agent-runtime.md)
- [0005 — Agent / Scheduler Separation](0005-agent-scheduler-separation.md)
- [0006 — Event-driven Background Model](0006-event-driven-background-model.md)
- [0007 — Non-clinical Psychology & Mindfulness Boundary](0007-non-clinical-psychology-mindfulness.md)
- [0008 — Remote Inference First, Local Agent Runtime](0008-remote-inference-local-agent.md)
- [0009 — Application Services, Commit and Recovery](0009-application-commit-and-recovery.md)

- [ADR-0010 — Account-scoped Local-first Cloud Sync](0010-local-first-cloud-sync.md)：用户接受内部账号与完整业务事实同步边界；实际状态见 STATUS。
