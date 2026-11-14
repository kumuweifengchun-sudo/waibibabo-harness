// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelContextMeter } from '../src/client/ModelContextMeter.tsx'

afterEach(cleanup)

it('renders the selected provider capacity and follows updates without another request', () => {
  let directory: ModelDirectoryState = {
    current: { provider: 'selected', model: 'same-name' }, routable: true,
    groups: [
      { id: 'other', name: 'Other', models: [{ id: 'same-name', name: 'Other model', contextWindow: 1_048_576 }] },
      { id: 'selected', name: 'Selected', models: [{ id: 'same-name', name: 'Model', contextWindow: 262_144 }] },
    ],
    failures: [], status: 'ready', pending: null, error: null,
  }
  const store = createSnapshotStore(directory)
  const useDirectory = bindSnapshotSelector(store)
  const renderFactorySlot = vi.fn(() => null)
  render(<ModelContextMeter useDirectory={useDirectory} renderFactorySlot={renderFactorySlot} />)
  expect(renderFactorySlot).toHaveBeenLastCalledWith('conversation.context.meter', { contextWindow: 262_144 })
  directory = { ...directory, groups: directory.groups.map(group => group.id !== 'selected' ? group
    : { ...group, models: group.models.map(model => ({ ...model, contextWindow: 486_400 })) }) }
  act(() => { store.set(directory) })
  expect(renderFactorySlot).toHaveBeenLastCalledWith('conversation.context.meter', { contextWindow: 486_400 })
  directory = { ...directory, groups: directory.groups.slice(0, 1), routable: false }
  act(() => { store.set(directory) })
  expect(renderFactorySlot).toHaveBeenLastCalledWith('conversation.context.meter', { contextWindow: null })
  directory = { ...directory, current: null }
  act(() => { store.set(directory) })
  expect(renderFactorySlot).toHaveBeenLastCalledWith('conversation.context.meter', { contextWindow: null })
})
