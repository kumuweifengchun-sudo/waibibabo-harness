/** 歪比巴卜产品只发布中文说明；上游文档继续使用各自的语言规则。 */

/** 仅发布中文介绍的产品包。 */
export const CHINESE_PRODUCT_PACKAGES = ['packages/bundle/waibibabo', 'packages/credentials/sub2api-account'] as const

/** 只维护中文版的桌面迁移指南。 */
export const CHINESE_PRODUCT_UPGRADE_GUIDE = 'docs/upgrade-guide/v0.2.2-rc.1/waibibabo-desktop/guide.md'

/**
 * 将中文产品文档的结构标签交给现有结构校验器，不修改文档正文。
 * @param file - 仓库相对路径。
 * @param source - 原始 Markdown。
 * @returns 仅在指定产品 README 中转换结构标签的校验文本。
 */
export function productDocValidationText(file: string, source: string): string {
  if (!CHINESE_PRODUCT_PACKAGES.some(directory => file === directory + '/README.md')) return source
  const headings: Record<string, string> = {
    '## 概述': '## Summary', '## 目录': '## Table of Contents', '### 开发备注': '### Dev Note',
    '## 模型体验': '## Model Experience', '#### KV Cache 影响': '#### KV Cache effect',
    '#### 模型可见内容': '#### What the model sees', '#### Token 影响': '#### Token effect',
    '### 产品身份': '### Product identity',
    '## 已知限制与延后工作': '## Known Limitations and Deferred Work',
  }
  return source.split('\n').map(line => headings[line.trimEnd()] ?? (line.startsWith('无，因为') ? 'None, as ' + line.slice(4).replace(/。$/u, '.') : line)).join('\n')
}
