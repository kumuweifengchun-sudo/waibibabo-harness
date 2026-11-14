/** Connects the shared live model catalog to the composer's context meter. */
import type { InjectFace, PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ModelDirectoryState } from './directory.ts'

/** Live directory source owned by the Session binding. */
export interface ModelContextMeterInjected {
  hooks: { directory: ObservableSnapshot<ModelDirectoryState> }
}

type Props = InjectFace<ModelContextMeterInjected> & PropsRenderFactories

/**
 * Render usage against the selected route's current configured capacity.
 * @param props - Framework-bound directory hook and factory renderer.
 * @returns The context meter, hidden while the route or its capacity is unavailable.
 */
export function ModelContextMeter({ useDirectory, renderFactorySlot }: Props) {
  const contextWindow = useDirectory((directory) => {
    const selection = directory.current
    if (selection === null) return null
    const model = directory.groups.find(group => group.id === selection.provider)?.models
      .find(model => model.id === selection.model)
    return model?.contextWindow ?? null
  })
  return renderFactorySlot('conversation.context.meter', { contextWindow })
}
