---
kind: upgrade-guide
description: "The Python SDK now requires Pydantic 2.14 or later within the 2.x series."
---

# Python SDK requires Pydantic 2.14 or later

English | [中文](guide.zh.md)

## Change

The Python SDK raises its minimum Pydantic version from 2.12 to 2.14 to include upstream security fixes. Projects that pin an older Pydantic version must update their dependency constraint before upgrading the SDK.

## Migration

1. Change the Pydantic constraint in your `pyproject.toml`, requirements file, or constraints file to allow `pydantic>=2.14,<3`.
2. Regenerate your lockfile if you use one and reinstall the project. Run `python -c "import pydantic; print(pydantic.__version__)"` in the project environment and confirm that it reports a version in the supported range.
