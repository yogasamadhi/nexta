# 01 — Product

## 1. 产品愿景

构建一个真正理解用户执行节奏的 AI Personal Execution Agent。

它不是“帮用户把日程排满”，而是帮助用户：

1. 把模糊的想法变成可执行行动；
2. 把行动安排到现实可用的时间里；
3. 在变化发生后持续维护计划；
4. 专注当前这一件事；
5. 看见自己真实完成过什么；
6. 从真实执行数据中逐渐找到更适合自己的节奏。

核心愿景：

> **计划未来，专注当下，看见成长。**

---

## 2. 产品定位

### 当前定位

**Mobile-first + Local-first 的 AI Personal Execution Agent**

### 不是

- 传统 TodoList 加一个聊天框；
- 纯 Calendar App；
- 单纯 AI 日程生成器；
- 冥想内容平台；
- 心理治疗工具；
- 企业项目管理软件；
- 24×7 后台自治 Agent。

### 核心区别

传统工具关注：

> “还有多少事没做？”

本产品同时关注：

> “下一步做什么？”  
> “现实中怎么安排才做得完？”  
> “没做完以后怎么调整？”  
> “我已经完成了什么？”  
> “怎样安排更符合我真实的执行习惯？”

---

## 3. 目标用户

V1 主要面向：

- 个人知识工作者；
- 学生；
- 自由职业者；
- 同时管理工作、学习与生活事务的人；
- 容易出现 Todo 堆积、计划过载、估时失真、拖延或“做了很多却觉得自己什么都没完成”的用户；
- 愿意使用 AI，但希望个人任务、执行数据尽量留在本地的用户。

V1 不针对：

- 企业协同团队；
- 重型项目管理组织；
- 临床心理健康用户场景；
- 需要复杂资源调度的组织。

---

## 4. 用户痛点

### P1：Todo 记录很多，但不知道现在该做什么

任务系统记录“未来”，却没有维护一份现实可执行的当前计划。

### P2：计划很快失效

会议插入、任务拖延、估时错误后，用户需要手工重新安排。

### P3：计划只考虑时间，不考虑“这个人真的会不会做”

不同时间段、不同任务类型、不同连续工作时长会显著影响实际完成率。

### P4：传统 Todo 长期制造“欠债感”

完成以后任务消失，用户持续看到未完成列表，而看不到已经完成的真实证据。

### P5：过度效率化会导致疲劳

“把时间塞满”不是可持续执行。恢复、放松和注意力切换应进入计划系统。

---

## 5. 核心价值

### 5.1 可执行

把 Goal / Task 转成具体 TimeBlock，而不是停留在列表。

### 5.2 可适应

计划变化时持续 Replan，而不是让用户手工修日历。

### 5.3 可学习

从实际耗时、开始时间、跳过、推迟、完成率等数据中学习用户真实节奏。

### 5.4 正向反馈

把完成沉淀为 Achievement / Success Diary，提供基于事实的自我效能反馈。

### 5.5 可持续

把专注、恢复、轻量反思纳入执行系统，而不是追求日程最大填充率。

### 5.6 Local-first

任务、执行、成就、用户模型等核心数据默认留在本地设备。

---

## 6. 核心产品循环

```text
Goal / Idea
    ↓
AI Understand
    ↓
Task / Project
    ↓
Scheduler Core
    ↓
TimeBlock
    ↓
Execute
 ↙      ↘
Done    Missed / Changed
 ↓          ↓
Win       Replan
 ↓          ↓
Success    │
Diary      │
 ↓          │
Reflection │
 ↓          │
User Model ┘
    ↓
Better Scheduling
```

---

## 7. 典型使用场景

### 场景 A：自然语言收集

用户：

> 下周五前把汇报 PPT 做完，大概需要 4 小时，这两天比较忙。

系统：

- 创建任务；
- 识别 Deadline；
- 建议拆分；
- 获取 Calendar 空闲时间；
- 调用 Scheduler 生成计划；
- 给出可解释的排程结果。

### 场景 B：计划失效

用户原计划 14:00–16:00 写方案，但 14:00 新增会议。

系统：

- 检测冲突；
- 保留 Locked / External Event；
- 重新安排受影响 TimeBlock；
- 保证 Deadline；
- 如果无法保证，明确提示风险。

### 场景 C：没有按计划开始

系统不将用户标记为“失败”，而是：

- 记录未开始；
- 根据当前时间和剩余任务重新计算；
- 学习该时段执行率；
- 给出新的现实方案。

### 场景 D：完成任务

用户完成任务后：

- 记录实际耗时；
- 生成 Achievement；
- 成功日记保存真实证据；
- User Model 更新估时偏差与执行模式。

### 场景 E：状态较差

用户 Check-in 表示精力低。

系统：

- 不做医疗判断；
- 优先安排低认知负荷任务；
- 提供可选短时 Relax；
- 必要时降低非关键计划密度。

---

## 8. V1 核心能力

本节描述 V1 能力范围；必须程度以 [需求文档](02-REQUIREMENTS.md) 的 Priority 为准。SHOULD 不自动升级为 MUST，内部阶段完成也不等于整个 V1 已交付。

1. AI Inbox / Capture
2. Task / Project 基础管理
3. Goal（轻量）
4. System Calendar Read
5. App Calendar / TimeBlock Write
6. Deterministic Scheduling
7. Dynamic Replanning
8. Today / Now
9. Local Notification
10. Execution Session
11. Achievement / Success Diary
12. Daily Reflection
13. Energy Check-in
14. Relax
15. Basic User Model
16. Local Agent Runtime
17. Offline-first

### 8.1 首个可试用闭环

按 [实施计划](../.ai/PLAN.md)，Phase 5 首先形成：

```text
手工创建 Task → 本地排程与 Preview → Today → 开始执行
→ 明确完成任务 → 真实完成记录 → Today's Wins
```

自然语言 Capture 与 Agent 在 Phase 6 接入同一条应用服务路径。手工入口长期保留，支持离线和模型不可用场景。该顺序不删除 V1 的 AI、User Model、Reflection 或 Relax 范围。

### 8.2 待验证的产品假设

首轮试用关注以下假设；它们是研究目标，不是已获得的用户结论：

- 用户能从 Today 选出当前可执行任务并开始；
- 计划被打断后，用户能理解调整并继续行动；
- 完成记录帮助用户回顾真实投入与成果，且不增加负担；
- 自动调整带来的便利大于反复确认与计划变动的打扰。

可观察证据包括开始任务的路径、重排的接受/撤销原因、完成记录的真实性与回顾反馈。首批试用人群、观察周期和成功阈值见 [DEC-001](DECISIONS.md#dec-001)。默认通过自愿试用反馈和本地数据验证，不据此新增遥测或外发执行历史。

### 8.3 计划维护的用户控制

系统可以自动计算新的候选计划。是否自动提交由用户授权与确定性风险策略共同决定；模型输出不构成授权。

尚未完成自动重排阈值决策时，默认展示 Preview，由用户提交。受保护时间块、跨天变化和 Deadline 风险的处理规则见 [重排需求](02-REQUIREMENTS.md#replan-policy)；待验证参数见 [DEC-002](DECISIONS.md#dec-002)。

---

## 9. V1 Tab Bar

暂定：

```text
今天 | 日历 | + | 成就 | 放松
```

Settings / Account 从页面右上角进入。

如果后续用户验证表明“成就”使用频率不足，可调整为二级入口；不得未经产品决策自行变更。

---

## 10. 明确非目标

V1 不做：

- Team Collaboration
- 企业权限体系
- Web / Desktop 正式客户端
- 社交社区
- 完整 Habit App
- 冥想课程商城
- 心理诊断、治疗、危机干预
- 自动读取所有聊天 App 内容
- 常驻后台 Agent
- Hermes 直接本地大模型推理
- 自动修改用户原有第三方日历事件
- 通用 Coding Agent
- Agent 自主执行高风险外部操作
- 全功能 Cloud Sync（可预留架构）

---

## 11. 产品边界

### 心理学

使用范围：

- 自我效能感；
- 执行意图；
- 行为反馈；
- 轻量自我反思；
- 认知负荷与节奏；
- 非医疗正念式专注。

禁止：

- 诊断；
- 疾病判断；
- 治疗承诺；
- 将完成率等同人格或心理状态；
- 用“惩罚”强化执行。

### 正念

正念服务于：

- 从过去任务切换到当前任务；
- 一次只处理一件事；
- 短时恢复；
- 降低信息噪音。

不做：

- 大型冥想内容平台；
- 宗教化表达；
- 医疗化效果承诺。

---

## 12. 未来方向

- Native Local LLM Runtime
- 多设备 Sync
- Desktop Companion
- 更完整 Goal / Project Graph
- Apple Health / Health Connect（需独立隐私决策）
- 自动识别个人最佳工作节奏
- Calendar / Email / File Agent Connectors
- 更丰富的个人执行模型
- 可解释的 Scheduling Policy
- Personal Execution OS
