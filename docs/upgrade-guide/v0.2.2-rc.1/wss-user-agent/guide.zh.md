---
kind: upgrade-guide
description: "模型提供方请求使用 WSS 产品 User-Agent，替代上游产品标识。"
---

# WSS 请求标识

[English](guide.md) | 中文

## 变更

默认提供方 `User-Agent` 从 `deepseek-harness/<version> (+https://github.com/deepseek-ai/deepseek-harness)` 改为 `wss/<version>`。版本与桌面界面一致，来自 `packages/llm/llm/src/waibibabo-product.json`，独立于工作区包版本。`AppIdentity.url` 为可选字段；提供网址的自定义标识保留注释。DeepSeek 模型列表的兼容性检查继续使用传输包版本和 `deepseek-harness` 元数据键。

## 迁移

1. 将按上游产品名称匹配的网关过滤、白名单和日志查询更新为接受 `wss/` 加桌面产品版本。
2. 发起模型请求并查看网关收到的请求头，确认 `User-Agent: wss/<version>` 不带网址后缀。
