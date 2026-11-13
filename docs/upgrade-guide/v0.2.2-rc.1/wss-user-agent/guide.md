---
kind: upgrade-guide
description: "Model provider requests use the WSS product User-Agent instead of the upstream product identity."
---

# WSS request identification

English | [中文](guide.zh.md)

## Change

The default provider `User-Agent` changes from `deepseek-harness/<version> (+https://github.com/deepseek-ai/deepseek-harness)` to `wss/<version>`. The version matches the desktop UI and comes from `packages/llm/llm/src/waibibabo-product.json`, independently of workspace package versions. `AppIdentity.url` is optional; custom identities that supply a URL retain their comment. DeepSeek model-list compatibility checks continue to use transport package versions and the `deepseek-harness` metadata key.

## Migration

1. Update gateway filters, allowlists, and log queries that match the upstream product name to accept `wss/` followed by the desktop product version.
2. Make a model request and inspect the gateway's request headers. Confirm `User-Agent: wss/<version>` without a URL suffix.
