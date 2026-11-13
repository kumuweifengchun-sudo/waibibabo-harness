/** Workspace rename and removal dialogs, keyed by their captured request. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, IconFolderCloseRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { DirectoryFlowOwnerProps, WorkspaceActionRequest, WorkspaceBrowserProps } from '../contract/slots.ts'
import css from './WorkspaceBrowser.module.css'

type Props = Pick<WorkspaceBrowserProps, 'renameWorkspace' | 'deleteWorkspace' | 'settleWorkspaceAction' | 'useWorkspaceAccess' | 't'> & {
  request: WorkspaceActionRequest
  workspaces: readonly WorkspaceView[]
  directoryFlowAvailable: boolean
  renderDirectoryFlow: (owner: DirectoryFlowOwnerProps) => ReactNode
}

/** @param props - captured request, current Workspace list, and existing mutations. @returns the active dialog. */
export function WorkspaceDialogs({
  request, workspaces, renameWorkspace, deleteWorkspace, settleWorkspaceAction, useWorkspaceAccess, t,
  directoryFlowAvailable, renderDirectoryFlow,
}: Props) {
  const canEditDirectories = useWorkspaceAccess(request.workspaceId, 'workspace/edit')
  const canRename = useWorkspaceAccess(request.workspaceId, 'workspace/rename')
  const composingRef = useRef(false)
  const renameTarget = request.action === 'rename' ? request : null
  const [renameDraft, setRenameDraft] = useState(request.displayTitle)
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [initialDirectories] = useState(() => {
    const workspace = workspaces.find(row => row.workspaceId === request.workspaceId)
    return [...(workspace?.directories ?? (workspace === undefined ? [] : [workspace.path]))]
  })
  const [directories, setDirectories] = useState(initialDirectories)
  const [pickingDirectory, setPickingDirectory] = useState(false)
  const directoriesChanged = directories.length !== initialDirectories.length
    || directories.some((path, index) => path !== initialDirectories[index])
  const renameTrimmed = renameDraft.trim()
  // Self is excluded by identity, not by title: the draft is seeded with the
  // localized label, which for an automatically titled Workspace equals its
  // own displayed title without being a conflict with itself.
  const renameDuplicate = renameTarget !== null && renameTrimmed !== ''
    && workspaces.some(w => w.workspaceId !== renameTarget.workspaceId && w.title === renameTrimmed)
  const renameBlocked = renaming || pickingDirectory || renameTrimmed === '' || directories.length === 0
    || !canRename && !canEditDirectories || directoriesChanged && !canEditDirectories
    || renameTarget === null || renameTrimmed === renameTarget.storedTitle && !directoriesChanged || renameDuplicate
  const closeRename = () => {
    if (renaming || pickingDirectory) return
    settleWorkspaceAction()
    setRenameError(null)
  }
  const confirmRename = () => {
    if (renameBlocked) return
    setRenaming(true)
    setRenameError(null)
    const saving = directoriesChanged || !canRename
      ? renameWorkspace(renameTarget.workspaceId, renameTrimmed, directories)
      : renameWorkspace(renameTarget.workspaceId, renameTrimmed)
    saving.then(() => {
      setRenaming(false)
      settleWorkspaceAction()
    }).catch((reason: unknown) => {
      setRenaming(false)
      setRenameError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  const deleteTarget = request.action === 'delete' ? request : null
  const [deleting, setDeleting] = useState(false)
  const [deleteCommittedId, setDeleteCommittedId] = useState<WorkspaceId | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  useEffect(() => {
    if (deleteCommittedId === null
      || workspaces.some(workspace => workspace.workspaceId === deleteCommittedId)) return
    setDeleting(false)
    setDeleteCommittedId(null)
    settleWorkspaceAction()
  }, [deleteCommittedId, workspaces, settleWorkspaceAction])
  const closeDelete = () => {
    if (deleting) return
    settleWorkspaceAction()
    setDeleteError(null)
  }
  const confirmDelete = () => {
    /* v8 ignore next -- the Modal is absent without a target and its button is disabled while deleting. */
    if (deleting || deleteTarget === null) return
    setDeleting(true)
    setDeleteCommittedId(null)
    setDeleteError(null)
    deleteWorkspace(deleteTarget.workspaceId).then(() => {
      // Keep the confirmation pending until this component has rendered the
      // committed list projection without the deleted id. Closing earlier
      // exposes one stale React frame to the next Create Workspace gesture.
      setDeleteCommittedId(deleteTarget.workspaceId)
    }).catch((reason: unknown) => {
      setDeleting(false)
      setDeleteError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return <>
    <Modal
      open={renameTarget !== null}
      onClose={closeRename}
      closeLabel={t('close')}
      title={t('workspace.editTitle')}
      footer={(
        <>
          <Button variant="outline" disabled={renaming || pickingDirectory} onClick={closeRename}>{t('cancel')}</Button>
          <Button variant="primary" disabled={renameBlocked} onClick={confirmRename}>{t(renaming ? 'workspace.saving' : 'workspace.save')}</Button>
        </>
      )}
    >
      <input
        className={css.renameInput}
        value={renameDraft}
        aria-label={t('field.workspaceName')}
        data-modal-autofocus
        disabled={renaming || !canRename && !canEditDirectories}
        onFocus={(e) => { e.target.select() }}
        onChange={(e) => { setRenameDraft(e.target.value); setRenameError(null) }}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={() => { composingRef.current = false }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !composingRef.current) {
            e.preventDefault()
            confirmRename()
          }
        }}
      />
      <div className={css.directoryHeading}>{t('workspace.folders')}</div>
      <div className={css.directoryList}>
        {directories.map((path, index) => <div className={css.directoryRow} key={path}>
          <IconFolderCloseRegular size={18} />
          <div className={css.directoryPath} title={path}>
            <strong>{path.split(/[\\/]/).filter(Boolean).at(-1) ?? path}</strong>
            <span>{path}</span>
          </div>
          <Button variant="ghost" size="sm" disabled={!canEditDirectories || renaming || pickingDirectory || index === 0}
            aria-label={t(index === 0 ? 'workspace.primaryPath' : 'workspace.setPrimaryPath', { path })}
            onClick={() => { setDirectories([path, ...directories.filter(value => value !== path)]); setRenameError(null) }}>
            {t(index === 0 ? 'workspace.primary' : 'workspace.setPrimary')}
          </Button>
          <Button variant="ghost" size="sm" disabled={!canEditDirectories || renaming || pickingDirectory || directories.length === 1}
            aria-label={t('workspace.removeFolderPath', { path })}
            onClick={() => { setDirectories(directories.filter(value => value !== path)); setRenameError(null) }}>
            {t('workspace.removeFolder')}
          </Button>
        </div>)}
        {canEditDirectories && directoryFlowAvailable && <Button variant="ghost" size="sm" disabled={renaming || pickingDirectory}
          onClick={() => { setRenameError(null); setPickingDirectory(true) }}>{t('workspace.addFolder')}</Button>}
      </div>
      <p className={css.directoryHint}>{t('workspace.foldersHint')}</p>
      {renameDuplicate && (
        <div className={css.renameError} role="alert">{t('conflict.named', { name: renameTrimmed })}</div>
      )}
      {renameError !== null && <div className={css.renameError} role="alert">{renameError}</div>}
    </Modal>
    {pickingDirectory && renderDirectoryFlow({
      open: true, busy: renaming,
      onPicked: (path) => {
        setDirectories(current => current.includes(path) ? current : [...current, path])
        setPickingDirectory(false)
      },
      onCancel: () => { setPickingDirectory(false) },
      onError: (message) => { setPickingDirectory(false); setRenameError(message) },
    })}

    <Modal
      open={deleteTarget !== null}
      onClose={closeDelete}
      closeLabel={t('close')}
      title={t('delete.workspace')}
      {...deleteTarget === null
        ? {}
        : { description: t('delete.desc', { name: deleteTarget.displayTitle }) }}
      footer={(
        <>
          <Button variant="outline" disabled={deleting} onClick={closeDelete}>{t('cancel')}</Button>
          <Button
            variant="outline"
            className={css.deleteAction}
            disabled={deleting}
            onClick={confirmDelete}
          >
            {t('delete.workspace')}
          </Button>
        </>
      )}
    >
      {deleting && <div className={css.deleteStatus} role="status">{t('delete.pending')}</div>}
      {deleteError !== null && <div className={css.renameError} role="alert">{deleteError}</div>}
    </Modal>
  </>
}
