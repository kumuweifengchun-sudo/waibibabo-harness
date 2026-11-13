// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

it('restores product brand slots after remount and releases all contributions on disposal', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    const locale = new LocaleRuntime(ctx, undefined, { languages: ['zh-CN'], preference: 'zh', fixedLocale: 'zh' })
    ctx.provide('locale', locale)
    const declare = () => slots.register({ name: 'root', children: {
      'sidebar.brand.mark': { kind: 'single', scope: 'root' },
      'sidebar.brand.name': { kind: 'single', scope: 'root' },
      'conversation.hero.brand.mark': { kind: 'single', scope: 'root' },
      'conversation.hero.brand.name': { kind: 'single', scope: 'root' },
    } }, (_props: PropsRenderSlots<'sidebar.brand.mark' | 'sidebar.brand.name'
      | 'conversation.hero.brand.mark' | 'conversation.hero.brand.name'>) => null)
    const fiber = ctx.plugin({ inject, apply })
    await fiber.await()
    const holes = ['sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark', 'conversation.hero.brand.name'] as const
    for (const hole of holes) expect(slots.entries(hole)).toHaveLength(0)
    const remove = declare()
    await Promise.resolve()
    for (const hole of holes) expect(slots.entries(hole)).toHaveLength(1)
    expect(locale.bind('waibibabo.brand')('name')).toBe('Waibibabo Harnesss')
    expect(locale.bind('waibibabo.brand')('shortName')).toBe('WSS')
    expect(locale.bind('waibibabo.brand')('version')).toBe('0.1.0')
    remove()
    for (const hole of holes) expect(slots.entries(hole)).toHaveLength(0)
    declare()
    await Promise.resolve()
    for (const hole of holes) expect(slots.entries(hole)).toHaveLength(1)
    await fiber.dispose()
    for (const hole of holes) expect(slots.entries(hole)).toHaveLength(0)
    expect(locale.bind('waibibabo.brand')('name')).toBe('name')
  } finally { await ctx.fiber.dispose() }
})
