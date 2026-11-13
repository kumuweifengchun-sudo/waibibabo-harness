/** User-triggered image generation in the existing main-panel navigation. */
import { useEffect, useId, useState } from 'react'
import { Button, Input, Modal, IconSparkleRegular, IconLoadingOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ImageOutputId, Sub2apiGroupId } from '../types.ts'
import { PlatformLogin, PlatformNotice, type PlatformProps } from './PlatformCommon.tsx'
import css from './Platform.module.css'
import styles from './ImagePanel.module.css'

/** @param props - Icon size owned by the existing sidebar. @returns the shared generation icon. */
export function ImagePanelIcon({ size }: PropsRuntime<'sidebar.panellist'>) { return <IconSparkleRegular size={size} /> }

/** @param props - Current account, image draft and explicit generation action. @returns native image generation page. */
export function ImagePanel(props: PlatformProps) {
  const account = props.useAccount(value => value.view)
  return account?.status === 'signed-in' ? <ImageContent key={account.profile?.id} {...props} />
    : <div className={css.page}><PlatformLogin {...props} /></div>
}

function ImageContent(props: PlatformProps) {
  const account = props.useAccount(value => value.view)
  const state = props.usePlatform(value => value)
  const [enlarged, enlarge] = useState<ImageOutputId | null>(null)
  const { t, updateImageDraft, loadImageModels } = props
  const groups = account?.groups.filter(group => group.imageGeneration) ?? []
  const draft = state.imageDraft
  const group = groups.find(value => value.id === draft.groupId) ?? groups[0]
  const groupId = group?.id
  useEffect(() => { if (groupId !== undefined) void loadImageModels(groupId) }, [groupId, loadImageModels])
  const busy = state.loading.images
  const suggestions = state.imageModelsGroup === groupId ? state.imageModels : []
  const preview = state.imageResult?.images.find(image => image.id === enlarged)
  const formId = useId()
  const resultId = useId()
  const sizeValid = draft.size === '' || /^[1-9]\d*x[1-9]\d*$/u.test(draft.size)
  const images = state.imageResult?.images ?? []
  return <div className={css.page}><section className={styles.page}>
    <header className={styles.pageHead}>
      <h2><IconSparkleRegular size={24} />{t('imageTitle')}</h2>
      <p className={css.muted}>{t('imageDescription')}</p>
    </header>
    <div className={styles.workspace}>
      <form className={styles.composer} aria-labelledby={formId} onSubmit={(event) => {
        event.preventDefault()
        if (group !== undefined) void props.generate({ ...draft, groupId: group.id })
      }}>
        <header className={styles.sectionHead}>
          <h3 id={formId}>{t('imageSettings')}</h3>
          <Button variant="ghost" size="sm" disabled={busy || groupId === undefined || state.loading.imageModels}
            onClick={() => { if (groupId !== undefined) void loadImageModels(groupId) }}>{t('imageRefreshModels')}</Button>
        </header>
        <label className={styles.field}>{t('imageGroup')}<select value={group?.id ?? ''} disabled={busy || groups.length === 0}
          onChange={(event) => { updateImageDraft({ groupId: event.target.value as Sub2apiGroupId }) }}>
          {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select></label>
        {groups.length === 0 && <p className={css.muted}>{t('imageNoGroups')}</p>}
        <ImageModel value={draft.model} suggestions={suggestions} loading={state.loading.imageModels} disabled={busy} t={t}
          change={(model) => { updateImageDraft({ model }) }} />
        <PlatformNotice t={t} loading={false} error={state.errors.imageModels} />
        <label className={styles.field}>{t('imagePrompt')}<textarea value={draft.prompt} placeholder={t('imagePromptHint')}
          rows={5} required maxLength={32000} disabled={busy}
          onChange={(event) => { updateImageDraft({ prompt: event.target.value }) }} /></label>
        <div className={styles.options}>
          <label className={styles.field}>{t('imageCount')}<Input className={styles.input ?? ''} type="number" min={1} max={10} value={draft.count} disabled={busy}
            onChange={(event) => { updateImageDraft({ count: Number(event.target.value) }) }} /></label>
          <ImageSize value={draft.size} disabled={busy} t={t} change={(size) => { updateImageDraft({ size }) }} />
        </div>
        <p className={styles.hint}>{t('imageSizeHint')}</p>
        <Button className={styles.generate} variant="primary" type="submit"
          disabled={busy || group === undefined || !draft.model.trim() || !draft.prompt.trim() || !sizeValid}>
          {t(busy ? 'imageGeneratingAction' : 'imageGenerate')}
        </Button>
      </form>
      <section className={styles.results} aria-labelledby={resultId}>
        <header className={styles.resultHead}>
          <div className={styles.sectionHead}>
            <h3 id={resultId}>{t('imageResult')}</h3>
            {images.length > 0 && <span className={styles.resultCount}>{t('imageResultCount', { count: String(images.length) })}</span>}
          </div>
          <p className={styles.hint}>{t('imageMemory')}</p>
        </header>
        <PlatformNotice t={t} loading={false} error={state.errors.images} />
        {busy && images.length > 0 && <div className={styles.working} role="status">
          <IconLoadingOutlineRegular className={css.spin} size={16} /><span>{t('imageGenerating')}</span>
        </div>}
        {state.errors.images !== null && images.length > 0 && <p className={css.muted}>{t('imageRetained')}</p>}
        {images.length === 0 ? <div className={styles.empty} role="status">
          <div className={styles.emptyIcon}>{busy ? <IconLoadingOutlineRegular className={css.spin} size={28} />
            : <IconSparkleRegular size={28} />}</div>
          <h4>{t(busy ? 'imageGeneratingAction' : 'imageEmptyTitle')}</h4>
          <p>{t(busy ? 'imageGenerating' : 'imageEmpty')}</p>
        </div> : <div className={styles.images}>
          {images.map((image, index) => {
            const save = state.imageSaves[image.id]
            return <figure className={styles.imageCard} key={image.id}>
              <button type="button" className={styles.imageThumbnail} aria-label={t('imageEnlarge', { index: String(index + 1) })}
                onClick={() => { enlarge(image.id) }}>
                <img src={image.source} alt={t('imagePreview', { index: String(index + 1) })} referrerPolicy="no-referrer" />
              </button>
              <figcaption className={styles.imageCaption}>
                <span>{t('imagePreview', { index: String(index + 1) })}</span>
                <div className={styles.imageActions}>
                  <Button variant="outline" size="sm" disabled={save?.status === 'saving'}
                    onClick={() => { void props.saveImage(image.id) }}>{t(save?.status === 'saving' ? 'imageDownloading' : 'imageDownload')}</Button>
                  {!image.source.startsWith('data:') && <a href={image.source} target="_blank" rel="noopener noreferrer">{t('imageOriginal')}</a>}
                </div>
              </figcaption>
              {image.revisedPrompt && <details className={styles.revisedPrompt}>
                <summary>{t('imageRevisedPrompt')}</summary><p>{image.revisedPrompt}</p>
              </details>}
              {save?.status === 'saving' && <progress aria-label={t('imageDownloading')} />}
              {save?.status === 'saved' && <p role="status" className={styles.saveStatus}>{t('imageSaved', { path: save.path ?? '' })}</p>}
              {save?.status === 'requested' && <p role="status" className={styles.saveStatus}>{t('imageDownloadRequested')}</p>}
              {save?.status === 'cancelled' && <p role="status" className={styles.saveStatus}>{t('imageDownloadCancelled')}</p>}
              {save?.status === 'failed' && <p role="alert" className={css.error}>{t('imageDownloadFailed')}</p>}
            </figure>
          })}
        </div>}
      </section>
    </div>
    <Modal open={preview !== undefined} title={t('imageFullPreview')} closeLabel={t('close')} onClose={() => { enlarge(null) }}
      className={styles.imageDialog ?? ''}>
      {preview !== undefined && <img className={styles.imageFull} src={preview.source} alt={t('imageFullPreview')} referrerPolicy="no-referrer" />}
    </Modal>
  </section></div>
}

function ImageModel({ value, suggestions, loading, disabled, t, change }: Pick<PlatformProps, 't'> & {
  value: string
  suggestions: readonly string[]
  loading: boolean
  disabled: boolean
  change: (model: string) => void
}) {
  const id = useId()
  const [manual, setManual] = useState(value !== '' && !suggestions.includes(value))
  return <div className={styles.field}>
    <div className={styles.sectionHead}>
      <label htmlFor={id}>{t(manual ? 'imageManualModel' : 'imageModel')}</label>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => { setManual(!manual) }}>
        {t(manual ? 'imageChooseModel' : 'imageEnterModel')}
      </Button>
    </div>
    {manual ? <Input className={styles.input ?? ''} id={id} value={value} placeholder={t('imageModelHint')} required disabled={disabled}
      onChange={(event) => { change(event.target.value) }} />
      : <select id={id} value={value} disabled={disabled || loading} required
        onChange={(event) => { change(event.target.value) }}>
        <option value="">{t(loading ? 'imageModelsLoading' : 'imageSelectModel')}</option>
        {value !== '' && !suggestions.includes(value) && <option value={value}>{value}</option>}
        {suggestions.map(model => <option key={model} value={model}>{model}</option>)}
      </select>}
  </div>
}

function ImageSize({ value, disabled, t, change }: Pick<PlatformProps, 't'> & {
  value: string
  disabled: boolean
  change: (size: string) => void
}) {
  const sizes = [
    { value: '', labelKey: 'imageSizeAuto' }, { value: '1024x1024', labelKey: 'imageSquare' },
    { value: '1536x1024', labelKey: 'imageLandscape' }, { value: '1024x1536', labelKey: 'imagePortrait' },
    { value: '1536x864', labelKey: 'imageWide' }, { value: '864x1536', labelKey: 'imageTall' },
  ] as const
  const [custom, setCustom] = useState(value !== '' && !sizes.some(size => size.value === value))
  const [width = '', height = ''] = value.split('x')
  return <div className={styles.field}>
    <label className={styles.field}>{t('imageSize')}<select disabled={disabled} value={custom ? 'custom' : value} onChange={(event) => {
      const next = event.target.value
      setCustom(next === 'custom')
      change(next === 'custom' ? value || '1024x1024' : next)
    }}>{sizes.map(size => <option key={size.value} value={size.value}>{t(size.labelKey)}</option>)}
      <option value="custom">{t('imageSizeCustom')}</option>
    </select></label>
    {custom && <div className={styles.dimensions}>
      <label className={styles.field}>{t('imageWidth')}<Input className={styles.input ?? ''} type="number" min={1} step={1} required disabled={disabled} value={width}
        onChange={(event) => { change(`${event.target.value}x${height}`) }} /></label>
      <label className={styles.field}>{t('imageHeight')}<Input className={styles.input ?? ''} type="number" min={1} step={1} required disabled={disabled} value={height}
        onChange={(event) => { change(`${width}x${event.target.value}`) }} /></label>
    </div>}
  </div>
}
