// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { zh as common } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { DirectoryFlowOwnerProps } from '../src/client/contract/slots.ts'
import { WorkspaceDialogs } from '../src/client/rows/WorkspaceDialogs.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const id = 'workspace' as WorkspaceId
const workspace: WorkspaceView = {
  workspaceId: id, title: 'App', path: '/projects/front', directories: ['/projects/front'],
  sessionIds: [], createdAt: '', updatedAt: '',
}

function mount(renameWorkspace = vi.fn(async () => {}), canEditDirectories = true) {
  let picker: DirectoryFlowOwnerProps | undefined
  const settled = vi.fn()
  render(<WorkspaceDialogs request={{ action: 'rename', workspaceId: id, displayTitle: 'App', storedTitle: 'App' }}
    workspaces={[workspace]} renameWorkspace={renameWorkspace} deleteWorkspace={async () => {}}
    settleWorkspaceAction={settled} useWorkspaceAccess={(_id, action) => action === 'workspace/rename' || canEditDirectories}
    t={makeTranslate(zh, common)} directoryFlowAvailable
    renderDirectoryFlow={(owner) => { picker = owner; return null }} />)
  return { settled, renameWorkspace, pick: (path: string) => { act(() => picker?.onPicked(path)) },
    cancel: () => { act(() => picker?.onCancel()) } }
}

it('keeps folder grants unavailable to a rename-only role', async () => {
  const view = mount(vi.fn(async () => {}), false)
  expect(screen.queryByRole('button', { name: '添加文件夹' })).toBeNull()
  fireEvent.change(screen.getByLabelText('工作区名称'), { target: { value: 'New name' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存' })) })
  expect(view.renameWorkspace).toHaveBeenCalledWith(id, 'New name')
})

it('adds folders, changes the primary, and submits all grants together', async () => {
  const view = mount()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '移除文件夹：/projects/front' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '添加文件夹' }))
  view.pick('/projects/back')
  fireEvent.click(screen.getByRole('button', { name: '添加文件夹' }))
  view.pick('/projects/mobile')
  fireEvent.click(screen.getByRole('button', { name: '设为主要文件夹：/projects/back' }))
  fireEvent.click(screen.getByRole('button', { name: '移除文件夹：/projects/mobile' }))
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '主要文件夹：/projects/back' }).disabled).toBe(true)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存' })) })
  expect(view.renameWorkspace).toHaveBeenCalledWith(id, 'App', ['/projects/back', '/projects/front'])
  expect(view.settled).toHaveBeenCalledOnce()
})

it('retains the draft and shows a failed save without closing the editor', async () => {
  const view = mount(vi.fn(async () => { throw new Error('请先关闭终端') }))
  fireEvent.click(screen.getByRole('button', { name: '添加文件夹' }))
  view.cancel()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '添加文件夹' }))
  view.pick('/projects/back')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存' })) })
  expect(screen.getByRole('alert').textContent).toBe('请先关闭终端')
  expect(screen.getByText('/projects/back')).toBeTruthy()
  expect(view.settled).not.toHaveBeenCalled()
})
