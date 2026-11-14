/** Platform groups, model protocols, Responses transports and inference addresses in Models settings. */
import { useEffect, useId, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { ModelLimits, ModelProtocol, ModelProtocolChoice, Sub2apiGroupId } from '../types.ts'
import type { GatewayId, GatewayView } from '../platform-types.ts'
import type { AccountKey } from './locales.ts'
import { failureKeys } from './errors.ts'
import { PlatformLogin, PlatformNotice, type PlatformProps } from './PlatformCommon.tsx'
import css from './Platform.module.css'

const labels: Record<ModelProtocol, AccountKey> = { 'openai-completions': 'protocolChat', 'openai-responses': 'protocolResponses',
  'anthropic-messages': 'protocolMessages', 'google-generative-ai': 'protocolGemini' }
const choices: readonly ModelProtocolChoice[] = ['auto', 'openai-responses', 'anthropic-messages', 'openai-completions', 'google-generative-ai']

function ModelLimitsForm({ limits, busy, t, setModelLimits, title, hint, saved = true }:
  Pick<PlatformProps, 't' | 'setModelLimits'> & { limits: ModelLimits; busy: boolean; title: string; hint: string; saved?: boolean }) {
  const [draft, setDraft] = useState(limits)
  const presets = [{ value: 262144, labelKey: 'modelContext256K' }, { value: 486400, labelKey: 'modelContext475K' },
    { value: 1048576, labelKey: 'modelContext1M' }] as const
  const valid = Object.values(draft).every(value => Number.isSafeInteger(value) && value > 0)
    && draft.contextWindow >= 1024 && draft.maxInputTokens + draft.maxOutputTokens <= draft.contextWindow
  const changed = draft.contextWindow !== limits.contextWindow || draft.maxInputTokens !== limits.maxInputTokens
    || draft.maxOutputTokens !== limits.maxOutputTokens
  return <form className={css.form} aria-label={title}
    onSubmit={(event) => { event.preventDefault(); if (valid) void setModelLimits(draft) }}>
    <h3>{title}</h3><p className={css.muted}>{hint}</p>
    <label>{t('modelContextPreset')}<select disabled={busy}
      value={presets.some(preset => preset.value === draft.contextWindow) ? String(draft.contextWindow) : 'custom'}
      onChange={(event) => {
        const preset = presets.find(value => String(value.value) === event.target.value)
        if (preset !== undefined) setDraft({ ...draft, contextWindow: preset.value,
          maxInputTokens: Math.max(1, preset.value - draft.maxOutputTokens) })
      }}><option value="custom" disabled>{t('modelContextCustom')}</option>
      {presets.map(preset => <option key={preset.value} value={preset.value}>{t(preset.labelKey)}</option>)}
    </select></label>
    <div className={css.grid}>
      <label>{t('modelContextWindow')}<Input type="number" min={1024} step={1} required disabled={busy} value={draft.contextWindow}
        onChange={(event) => { setDraft({ ...draft, contextWindow: Number(event.target.value) }) }} /></label>
      <label>{t('modelMaxInput')}<Input type="number" min={1} step={1} required disabled={busy} value={draft.maxInputTokens}
        onChange={(event) => { setDraft({ ...draft, maxInputTokens: Number(event.target.value) }) }} /></label>
      <label>{t('modelMaxOutput')}<Input type="number" min={1} step={1} required disabled={busy} value={draft.maxOutputTokens}
        onChange={(event) => { setDraft({ ...draft, maxOutputTokens: Number(event.target.value) }) }} /></label>
    </div>
    {!valid && <p className={css.error} role="alert">{t('modelLimitsInvalid')}</p>}
    <div className={css.actions}><Button type="submit" variant="outline" disabled={busy || !valid || !changed && saved}>{t(busy ? 'modelLimitsSaving' : 'modelLimitsSave')}</Button>
      {!changed && <span className={css.muted}>{t(saved ? 'modelLimitsApplied' : 'modelUseGlobal')}</span>}</div>
    <p className={css.muted}>{t('modelLimitsUnits')}</p>
    <p className={css.muted}>{t('modelCompactionHint')}</p>
  </form>
}

function GatewayForm({ view, busy, t, selectGateway }: Pick<PlatformProps, 't' | 'selectGateway'> & { view: GatewayView; busy: boolean }) {
  const [selected, setSelected] = useState(view.selected)
  const [acknowledged, setAcknowledged] = useState(false)
  const chosen = view.endpoints.find(value => value.id === selected)
  return <form className={css.form} onSubmit={(event) => { event.preventDefault(); void selectGateway(selected, acknowledged) }}>
    <label>{t('gateways')}<select value={selected ?? ''} disabled={busy} onChange={(event) => {
      setSelected(event.target.value ? event.target.value as GatewayId : null); setAcknowledged(false)
    }}><option value="">{t('lineAuto')}</option>
      {view.selected !== null && !view.endpoints.some(value => value.id === view.selected) && <option value={view.selected} disabled>{t('gatewayCurrentMissing')}</option>}
      {view.endpoints.map(endpoint => <option key={endpoint.id} value={endpoint.id}>{endpoint.name && `${endpoint.name} · `}{endpoint.origin}{endpoint.insecure ? ` · ${t('gatewayHttp')}` : ''}</option>)}
    </select></label>
    {chosen?.description && <p className={css.muted}>{chosen.description}</p>}
    {chosen?.insecure && <label className={css.check}><input type="checkbox" checked={acknowledged} disabled={busy}
      onChange={(event) => { setAcknowledged(event.target.checked) }} />{t('gatewayConsent')}</label>}
    <p className={css.muted}>{t('lineActive', { value: view.active ?? t('lineUnresolved') })}</p>
    <div><Button type="submit" variant="outline" disabled={busy || selected !== null && (chosen === undefined || chosen.insecure && !acknowledged)}>{t(selected === null ? 'lineDetect' : 'gatewayApply')}</Button></div>
  </form>
}

/** @param props - Platform model actions and snapshots. @returns the product area in Models settings. */
export function ModelSection(props: PlatformProps) {
  const account = props.useAccount(value => value)
  const platform = props.usePlatform(value => value)
  const groupId = useId()
  const transportHintId = useId()
  const [editedModel, editModel] = useState('')
  const owner = account.view?.profile?.id
  const catalog = account.view?.models
  const { loadGateways, t } = props
  useEffect(() => { if (owner !== undefined) void loadGateways() }, [owner, catalog, loadGateways])
  const view = account.view
  if (view?.status !== 'signed-in') return <PlatformLogin {...props} />
  const edited = view.models.includes(editedModel) ? editedModel : ''
  const override = Object.hasOwn(view.modelLimitOverrides, edited) ? view.modelLimitOverrides[edited] : undefined
  return <section className={css.modelSection}>
    <h2>{t('platformModels')}</h2>
    {view.error !== null && <p role="alert" className={css.error}>{t(failureKeys[view.error])}</p>}
    <ModelLimitsForm key={`${view.profile?.id}:${JSON.stringify(view.modelLimits)}`} limits={view.modelLimits} busy={account.busy}
      t={t} setModelLimits={props.setModelLimits} title={t('modelLimitsTitle')} hint={t('modelLimitsHint')} />
    <div className={css.form}>
      <label htmlFor={groupId}>{t('group')}</label>
      <select id={groupId} value={view.selectedGroup ?? ''} disabled={account.busy || !view.groups.length}
        onChange={(event) => { if (event.target.value) void props.selectGroup(event.target.value as Sub2apiGroupId) }}>
        <option value="" disabled>{t('chooseGroup')}</option>
        {view.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
      </select>
      {!view.groups.length && <p className={css.muted}>{t('noGroups')}</p>}
    </div>
    <div className={css.models}>{view.modelProtocols.map(model => <div className={css.modelRow} key={model.model}>
      <span>{model.model}</span><div className={css.modelControls}>
        <select value={model.choice} disabled={account.busy || platform.loading.gateways}
          aria-label={`${model.model} · ${t('modelProtocol')}`} onChange={(event) => {
            const choice = choices.find(value => value === event.target.value)
            if (choice !== undefined && view.selectedGroup !== null) void props.setProtocol(view.selectedGroup, model.model, choice)
          }}>{choices.map(choice => <option key={choice} value={choice}>{choice === 'auto' ? `${t('protocolAuto')}（${t(labels[model.effective])}）` : t(labels[choice])}</option>)}</select>
        {model.transport !== null && <select value={model.transport} disabled={account.busy || platform.loading.gateways}
          aria-label={`${model.model} · ${t('modelTransport')}`} aria-describedby={transportHintId} onChange={(event) => {
            const transport = event.target.value
            if ((transport === 'sse' || transport === 'websocket') && view.selectedGroup !== null) {
              void props.setTransport(view.selectedGroup, model.model, transport)
            }
          }}><option value="sse">{t('transportSse')}</option><option value="websocket">{t('transportWebSocket')}</option></select>}
      </div>
    </div>)}</div>
    <p className={css.muted}>{t('modelHint')}</p><p className={css.muted}>{t('protocolHint')}</p>
    {view.modelProtocols.some(model => model.transport !== null) && <div id={transportHintId} className={css.transportHints}>
      <p className={css.muted}>{t('transportSseHint')}</p><p className={css.muted}>{t('transportWebSocketHint')}</p>
    </div>}
    <label className={css.form}>{t('modelOverrideTitle')}<select value={edited} disabled={account.busy}
      onChange={(event) => { editModel(event.target.value) }}><option value="">{t('chooseModel')}</option>
      {view.models.map(model => <option key={model} value={model}>{model} · {t(Object.hasOwn(view.modelLimitOverrides, model)
        ? 'modelUseCustom' : 'modelUseGlobal')}</option>)}
    </select></label>
    {edited && view.selectedGroup !== null && <>
      <ModelLimitsForm key={`${view.selectedGroup}:${edited}:${JSON.stringify(override ?? view.modelLimits)}`}
        limits={override ?? view.modelLimits} busy={account.busy} saved={override !== undefined}
        t={t} title={`${edited} · ${t('modelOverrideTitle')}`} hint={t('modelOverrideHint')}
        setModelLimits={async (limits) => {
          if (view.selectedGroup !== null) await props.setModelLimitOverride(view.selectedGroup, edited, limits)
        }} />
      {override !== undefined && <div><Button variant="ghost" disabled={account.busy}
        onClick={() => { if (view.selectedGroup !== null) void props.setModelLimitOverride(view.selectedGroup, edited, null) }}>{t('modelRestoreGlobal')}</Button></div>}
    </>}
    <div><Button variant="outline" disabled={account.busy} onClick={() => { void props.refresh() }}>{t('modelsRefresh')}</Button></div>
    <h3>{t('gateways')}</h3><p className={css.muted}>{t('gatewayHint')}</p>
    <PlatformNotice t={t} loading={platform.loading.gateways} error={platform.errors.gateways} />
    {platform.gateways !== null && <GatewayForm key={platform.gateways.selected} view={platform.gateways}
      busy={platform.loading.gateways} t={t} selectGateway={props.selectGateway} />}
    <div><Button variant="ghost" disabled={platform.loading.gateways} onClick={() => { void loadGateways() }}>{t('gatewayRefresh')}</Button></div>
  </section>
}
