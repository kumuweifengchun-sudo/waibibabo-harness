---
kind: upgrade-guide
description: "Python SDK 现在要求 Pydantic 2.14 或更高的 2.x 版本。"
---

# Python SDK 要求 Pydantic 2.14 或更高版本

[English](guide.md) | 中文

## 变更

Python SDK 将 Pydantic 的最低版本从 2.12 提高到 2.14，以纳入上游安全修复。锁定了旧版 Pydantic 的项目需要先更新依赖约束，再升级 SDK。

## 迁移

1. 修改项目的 `pyproject.toml`、依赖清单或约束文件，使 Pydantic 的依赖约束允许 `pydantic>=2.14,<3`。
2. 如果项目使用锁文件，请重新生成锁文件并重新安装项目。在项目环境中运行 `python -c "import pydantic; print(pydantic.__version__)"`，确认输出的版本在支持范围内。
