# ADR-0001 — Mobile-first with Expo

**Status:** Accepted

## Context

产品最重要入口是随手收集、系统日历、通知、Now、Focus、完成打卡与 Relax，天然发生在手机。

## Options

1. Desktop-first
2. Web-first
3. Native iOS/Android 双独立项目
4. Expo + React Native

## Decision

V1 采用：

- Expo SDK 58
- React Native
- Hermes
- Expo Router
- NativeWind 5
- gluestack-ui v5
- Reanimated 4

## Reasons

- iOS + Android 单一产品代码基线；
- 设备能力满足 Calendar / Notification；
- Reanimated 适合 Timeline / TimeBlock；
- 与 Local-first 架构兼容；
- 开发速度高。

## Consequences

- 必须使用 Development Build；
- 依赖必须验证 Hermes / Expo 兼容；
- Node-only 包不可直接引入。
