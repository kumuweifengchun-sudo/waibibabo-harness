# Waibibabo Harnesss · WSS

<img src="packages/bundle/waibibabo/src/client/assets/colorful.png" alt="Waibibabo Harnesss 产品图标" width="96" height="96">

👋 **把歪比巴卜平台的模型能力，带到你的本地工作区。**

Waibibabo Harnesss（简称 **WSS**）是基于 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 定制的 AI 智能体桌面客户端。它保留 DSH 的插件体系、文件操作、终端、Skills 与任务协作能力，并接入[歪比巴卜平台](https://www.waibibabo.com)的账号、模型、额度、用量、生图及订阅服务，面向中文用户提供统一的使用入口。

你可以让它分析项目、修改代码、执行命令、整理文档，也可以直接使用平台模型生成图片、查看消耗和管理订阅。平台负责模型服务、授权与计费；客户端负责在当前电脑上组织任务和执行本地工具。

🌐 [歪比巴卜平台](https://www.waibibabo.com) · 📘 [桌面端使用与配置](apps/desktop/WAIBIBABO.md) · 🧩 [平台账号接入说明](packages/credentials/sub2api-account/README.md) · 🛡️ [安全说明](SAFETY.zh.md)

## 🧭 内容导航

- [主要功能](#features)
- [歪比巴卜平台接入](#platform)
- [相较 DSH 的定制](#customizations)
- [快速上手](#getting-started)
- [从源码运行](#run-from-source)
- [数据、权限与使用限制](#data-and-limits)
- [开发与项目结构](#development)
- [项目来源与许可证](#license)

<a id="features"></a>

## ✨ 主要功能

WSS 将智能体工具与平台服务放在同一个客户端中。实际可用能力取决于启用的插件、模型支持范围、账号分组和本地权限。

| 功能 | 可以做什么 |
| --- | --- |
| 💻 代码与文件处理 | 阅读和搜索项目、编辑文件、分析代码、整理文档，配合本地工具完成开发任务。 |
| 🛠️ 命令与终端 | 执行构建、脚本等命令，使用持久终端和后台任务。 |
| 📂 多文件夹工作区 | 将前端、后端、移动端等多个目录加入同一工作区，并指定主要目录，方便跨项目协作。 |
| 🤖 多模型使用 | 从平台分组加载可用模型，配置协议、推理等级、上下文容量和输入输出预算。 |
| 🤝 任务规划与协作 | 通过计划、子智能体、工作流和自动化组织多步任务；具体能力由当前插件组合提供。 |
| 🧩 Skills 与 MCP | 加载本地技能，通过 MCP 连接外部工具，并按需扩展 Cordis 插件。 |
| 💬 会话与上下文 | 保存会话历史，按模型预算压缩上下文，并通过相关插件检索历史内容。 |
| 🎨 图片生成 | 使用平台生图分组提交提示词，选择模型、数量与尺寸，预览、放大并下载结果。 |
| 💳 平台账户服务 | 查看余额和使用日志，访问充值入口，管理订阅订单及发票申请。 |
| 🔐 权限与审批 | 通过权限策略、操作审批及沙箱隔离约束本地工具的访问范围。 |

例如，可以在选定工作区后交给它这样的任务：

> 帮我梳理前后端项目的登录流程，找出需要修改的位置，并完成相关代码调整。

> 整理这个项目的部署文档，并使用项目已有的命令检查修改涉及的部分。

<a id="platform"></a>

## 🌐 歪比巴卜平台接入

桌面端通过配套 Sub2API 服务接入平台。登录后使用账号所属分组的模型，无需手动复制平台 API 密钥；可用模型、价格、额度和购买资格以服务端返回为准。

### 👤 账号与授权

- 支持邮箱密码登录，也支持通过系统浏览器一键授权；启用双重验证的账号需要输入身份验证器验证码。
- “平台账号”展示账号资料、剩余额度和今日消耗；侧栏同步展示并定期刷新余额。
- 支持刷新账号资料、退出登录，并提供平台设备授权管理入口。
- 密码不持久化；桌面授权凭据由本地 Host 管理，模型调用使用分组对应的短期推理密钥。

### 🧠 模型、协议与线路

在设置的“模型”模块中选择分组、调整模型配置，再在对话中选择需要使用的模型。

| 配置项 | WSS 提供的能力 |
| --- | --- |
| 模型分组 | 加载平台允许当前账号使用的分组和模型，并保存手动选择。 |
| 协议适配 | 支持 OpenAI Responses、Chat Completions、Claude Messages 和 Gemini 原生接口；按模型及平台声明自动选择，也可逐模型覆盖。 |
| 推理等级 | 根据模型能力显示可选档位，实际支持情况取决于模型与网关。 |
| 模型容量 | 提供 256K、475K、1M 上下文预设及自定义预算，支持全局设置和逐模型覆盖；实际可用上限由模型决定。 |
| 账号线路 | 独立选择登录、账号资料、用量和订单等服务使用的连接地址，支持自动检测与手动指定。 |
| 模型线路 | 从平台公布的 API 地址中独立选择对话和生图线路，支持自动检测与手动指定。 |
| Responses 传输 | 默认使用 HTTP/SSE 流式传输；Responses 模型可单独选择 WS，复用连接，并在符合条件时回退 HTTP/SSE。 |

账号线路与模型线路分开配置，切换其中一个不会替代另一个的选择。WS 的兼容性、恢复与可能产生的额外用量见[账号包说明](packages/credentials/sub2api-account/README.md#use-this-package)。

### 🎨 图片生成

侧栏“生图”提供独立于对话的生图分组选择，可从平台加载模型，也可手动填写模型名。支持比例预设、自定义宽高、结果缩略图、放大预览和下载反馈。

平台需要为对应分组开启生图权限并提供图片生成接口。草稿和结果仅在当前客户端账号会话中保留，退出或重启后清空，需要保留的图片请及时下载。

### 📊 用量、充值、订阅与发票

| 入口 | 支持的操作 |
| --- | --- |
| 使用日志 | 按日期、模型、分组和请求方式筛选平台用量，翻页查看 Token、缓存、费用、耗时和请求详情。 |
| 前往平台充值 | 使用浏览器打开平台充值页面，余额充值由网站完成。 |
| 充值与订阅 | 查看套餐说明、当前订阅和订单，创建订阅订单，通过支付链接或二维码付款，并手动核对支付状态。 |
| 发票申请 | 计算开票费用、提交付款截图、修改待开具申请、查看处理进度并下载发票。 |

这些功能依赖配套服务端接口和账号权限。支付结果以平台核验为准；发票金额、手续费和材料要求见[账号接入说明](packages/credentials/sub2api-account/README.md#use-this-package)。

<a id="customizations"></a>

## 🛠️ 相较 DSH 的定制

WSS 继续使用 DSH 与 Cordis 的插件架构。文件工具、终端、会话、Skills、MCP 和智能体协作等基础能力来自上游；本仓库围绕歪比巴卜平台提供产品组合与专项增强。

| 方面 | WSS 的定制行为 |
| --- | --- |
| 产品品牌 | 使用 Waibibabo Harnesss / WSS 名称、独立图标、安装标识与产品版本；模型请求标识为 `wss/<产品版本>`。 |
| 中文体验 | 桌面界面固定中文，助手默认使用中文交流；README 以中文作为项目首页。 |
| 平台账号 | 桌面组合启用歪比巴卜账号提供方，替换上游官方账号入口，并关闭独立 API 密钥引导弹窗。 |
| 平台服务 | 增加平台模型分组、额度、使用日志、独立连接线路、生图、订阅订单与发票入口。 |
| 模型控制 | 增加平台模型的协议覆盖、容量与预算配置、能力对应的推理等级及 Responses WS 选择。 |
| 工作区 | 支持同一工作区管理多个源文件夹，指定主要目录，并按目录列表授予工作区写入权限。 |
| 助手上下文 | 使用 WSS 产品身份，保留任务工作区和工具规则，关闭上游 Harness 自身开发上下文的默认注入。 |
| 验证策略 | 通过产品插件提示智能体按改动范围选择验证，极低风险修改可跳过自动化测试；用户明确要求的验收仍需执行。 |
| 数据目录 | 默认使用 `~/.waibibabo`，与上游 `~/.dsh` 分开；Electron 界面配置也使用独立产品目录。 |
| 遥测与更新 | 桌面组合禁用上游产品遥测和 Session Log 上传相关服务；当前未配置产品自动更新源与强制更新服务。 |

上述平台接入和产品策略主要作用于 WSS 桌面组合。普通 CLI 与 Web 配置保留各自的组合方式，不能把启动上游 npm 包或普通 Web UI 视为启动 WSS 桌面产品。

<a id="getting-started"></a>

## 🚀 快速上手

### 使用桌面客户端

1. 安装与你的系统匹配的 WSS 桌面构建，并启动应用。
2. 在登录窗口使用歪比巴卜账号登录，或选择浏览器授权。
3. 在“设置 → 模型”中确认分组和模型，按需调整账号线路与模型线路。
4. 添加工作区；跨前后端项目时，可通过工作区菜单的“编辑”加入多个文件夹。
5. 在对话中选择模型并提交任务；需要图片时，打开侧栏“生图”。

首次使用前请阅读[安全说明](SAFETY.zh.md)。平台账号需要具备相应分组和额度，本地任务需要当前电脑具备项目所需的运行环境。

<a id="run-from-source"></a>

### 从源码运行

开发环境要求 **Node.js ≥ 24.9.0**，pnpm 版本以根目录 [package.json](package.json) 的 `packageManager` 为准。在本仓库根目录执行：

```sh
pnpm install
pnpm run build --profile waibibabo
pnpm run start:desktop
```

产品构建准备运行产物并执行聚合类型检查，`start:desktop` 使用已构建产物启动桌面开发实例。完整环境与构建说明见[开发指南](docs/development.zh.md)和[桌面产品说明](apps/desktop/WAIBIBABO.md#构建与验收)；Windows 安装包构建另见[签名与打包说明](apps/desktop/windows-signing/README.zh.md)。

<a id="run"></a>

### 普通 Web UI 开发入口

已经完成仓库构建后，可通过以下命令启动普通 Web 配置，并按终端打印的地址手动访问：

```sh
pnpm dsh web --no-open
```

此入口用于通用 Web UI 与插件开发，模型配置方式见 [Web UI 指南](docs/user/guide/index.zh.md)。需要完整的平台账号和品牌组合时，使用上面的 WSS 桌面入口。

<a id="data-and-limits"></a>

## 🔐 数据、权限与使用限制

- **本地执行与平台调用**：文件、命令、工作区和本地 Skills 在当前电脑上使用；提供给模型的对话、代码片段和附件会发送至所选模型服务，本地执行不代表离线推理。
- **独立数据目录**：默认数据位于用户目录的 `.waibibabo`。可通过 `DSH_HOME` 覆盖，复用其他产品的数据目录前请先备份，详见[产品配置](apps/desktop/WAIBIBABO.md#产品配置)。
- **多目录授权**：工作区内修改权限覆盖当前列出的全部源文件夹；修改目录配置前，需先停止相关运行任务并关闭终端。移除目录不会删除磁盘文件或历史会话。
- **服务端配套**：平台必须部署桌面 OAuth、设备授权管理、用量、订阅和发票等对应接口及必要数据库迁移。客户端支持某项功能，不代表任意旧版 Sub2API 已提供该接口。
- **尚未提供的能力**：当前未接入平台统一管理与分发 Skills，也未配置 WSS 自动更新服务；本地 Skills 仍可使用。
- **开发者预览**：项目及上游仍在迭代，升级可能涉及不兼容变更。真实账号登录、扣费、支付、系统浏览器回跳和安装体验，需要配套部署后单独验收。

平台部署条件、凭据处理与具体限制以[桌面产品说明](apps/desktop/WAIBIBABO.md#服务端要求)和[账号包说明](packages/credentials/sub2api-account/README.md)为准。

<a id="development"></a>

## 🧑‍💻 开发与项目结构

平台定制通过组合包、账号插件和桌面配置接入；开发相关功能时，先找到对应的实现与说明。

| 位置 | 主要职责 |
| --- | --- |
| [apps/desktop](apps/desktop/WAIBIBABO.md) | Electron 桌面外壳、产品配置、安装与打包。 |
| [packages/bundle/waibibabo](packages/bundle/waibibabo/README.md) | WSS 产品组合、品牌界面、助手身份与验证策略。 |
| [packages/credentials/sub2api-account](packages/credentials/sub2api-account/README.md) | 平台登录、模型路由、线路、生图、用量、订阅和发票。 |
| [packages/workspace/workspace](packages/workspace/workspace/README.zh.md) | 工作区、源文件夹与主要目录管理。 |
| [packages](packages/README.zh.md) | DSH 核心、模型、工具、会话、技能及其他插件。 |
| [docs](docs/development.zh.md) | 开发流程、架构、用户指南和参考资料。 |

参与开发请先阅读[贡献指南](CONTRIBUTING.zh.md)、[架构文档](docs/architecture.zh.md)和 [AGENTS.md](AGENTS.md)。本仓库的平台定制问题请在[本仓库 Issues](https://github.com/kumuweifengchun-sudo/waibibabo-harness/issues)反馈，并提供复现步骤及脱敏日志。

<a id="license"></a>

## 🙌 项目来源与许可证

WSS 基于 [DeepSeek AI 的 DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 开发，插件运行时由 [Cordis](https://github.com/cordiverse/cordis) 驱动。感谢上游项目及其贡献者；[上游文档](https://deepseek-harness.github.io/deepseek-harness/)可用于了解通用架构与工具能力，WSS 平台定制以本仓库说明为准。

本项目采用 [MIT 许可证](LICENSE)，第三方依赖与许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
