/** 中文产品文档保留完整结构检查，其他文档不受产品语言策略影响。 */
import { describe, expect, it } from 'vitest'
import { productDocValidationText } from './product-chinese-docs.ts'
import { packageReadmeSummaryErrors } from './verify-package-readme-summaries.ts'

describe('Chinese product documents', () => {
  const file = 'packages/bundle/waibibabo/README.md'
  it('accepts the Chinese summary and still rejects a missing summary', () => {
    expect(packageReadmeSummaryErrors(file, '## 概述\n\n使用中文登录平台。\n\n## 目录\n')).toEqual([])
    expect(packageReadmeSummaryErrors(file, '## 目录\n')).toHaveLength(1)
  })
  it('maps only the product structural labels without exempting another package', () => {
    const source = '## 模型体验\n\n无，因为没有额外提示词。\n'
    expect(productDocValidationText(file, source)).toContain('None, as 没有额外提示词.')
    expect(productDocValidationText(file, '### 产品身份\n\n#### 模型可见内容\n\n#### Token 影响\n'))
      .toBe('### Product identity\n\n#### What the model sees\n\n#### Token effect\n')
    expect(productDocValidationText('packages/other/plugin/README.md', source)).toBe(source)
    expect(productDocValidationText(file, '## 缺失的章节\n')).toBe('## 缺失的章节\n')
  })
})
