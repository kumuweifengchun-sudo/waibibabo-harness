---
kind: upgrade-guide
description: "Workspace.path now follows the selected primary directory, while sandbox grants follow every authorized folder."
---

# Workspace directories

English | [中文](guide.zh.md)

## Change

`Workspace.path` and `WorkspaceView.path` identify the current primary directory and can change after a folder edit. Use `WorkspaceId` for stable identity. `directories` lists authorized folders, primary first. Existing single-directory records load without manual conversion. Session headers and conversation logs are unchanged; historical primary paths retain Session membership without retaining filesystem grants.

With the workspace registry mounted, sandbox policy resolves current workspace folders on each operation, including subagent calls. Active tasks and open terminals block folder changes. New Sessions and workspace forks use the primary directory; existing Sessions retain their working directory.

## Migration

1. Update Host and Client together. Consumers must not cache `path` as an immutable identity or as the complete writable directory set. Older Host views without `directories` represent `[path]`.
2. Use the workspace menu’s Edit action to add folders and choose the primary. Scoped roles need `workspace/edit` for folder grants; `workspace/rename` remains title-only. Existing owner deployments need no configuration edits. Deployment-wide `additionalWritableRoots` remain independent grants.
3. Confirm that all configured folders appear after restarting and that a new Session starts in the primary directory. Keep the updated Host for this data directory: older Hosts do not preserve multi-folder metadata when rewriting workspace records.
