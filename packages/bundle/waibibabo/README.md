---
description: "在桌面配置中增加歪比巴卜平台登录、模型分组、余额和用量，并保留本地任务与技能执行。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-waibibabo

## 概述

桌面配置在基础层和 Web 层之后包含此层。用户登录歪比巴卜后即可选择平台模型，无需复制 API 密钥。本地文件、终端和 Skills 保持可用。平台计费和授权仍由 Sub2API 服务端负责。

桌面界面固定中文，不显示语言切换选项。产品介绍和接入说明只保留一份中文版。

客户端名称为 Waibibabo Harnesss，简称 WSS，产品版本从 0.1.0 开始。侧栏显示简称和版本，会话首页显示完整名称和版本，两处及登录弹窗、平台账号页均使用[彩色标志](src/client/assets/colorful.png)。安装和应用图标保存在 [icon.png](src/client/assets/icon.png)，[白色标志](src/client/assets/white.png)作为原始素材保留。组合包通过品牌插槽注册名称、版本和图标，卸载时撤销注册。桌面 Host 使用自身的依赖清单解析此模块，使独立安装环境也能加载品牌界面。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

桌面端通过其管理的 `desktop` 配置自动组合此包。默认平台地址为 `https://www.waibibabo.com`。`WAIBIBABO_PLATFORM_ORIGIN` 可指定其他源站；本地 HTTP 开发还需设置 `WAIBIBABO_ALLOW_LOOPBACK_HTTP=1`。平台网站和网关应保持在该源站下。

账号页面支持邮箱密码、可选双重验证、浏览器授权，以及余额和用量刷新；分组、协议、全局容量与逐模型覆盖位于模型设置。主界面使用彩色图标；侧栏账号展示自动更新的额度。账号包定义[登录与凭据行为](../../credentials/sub2api-account/README.md)。[桌面升级指南](../../../docs/upgrade-guide/v0.2.2-rc.1/waibibabo-desktop/guide.md) 说明安装标识和数据目录。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

产品组合通过 `system-prompt.harnessIdentity` 将默认助手身份设为 Waibibabo Harnesss（WSS），独立于 Agent 预设的 persona 前缀。产品禁用 `harness-dev-context`，不注入上游产品的源码位置与 GUI 开发说明；工具规则和任务工作区上下文仍然保留。声明完整提示词的预设继续使用其自定义内容。

[配置补丁](cordis.patch.yml) 禁用官方账号登录、对应的模型路由与账号界面、官方品牌装饰，以及上游产品遥测。补丁挂载产品品牌与 Sub2API 账号提供方，并关闭独立 API 密钥引导弹窗。基础层和 Web 层继续提供本地工具、会话存储和 Skills。[共享产品配置](../../llm/llm/src/waibibabo-product.json) 统一管理产品名称、简称、独立版本、应用标识、主目录和更新策略；界面与 `wss/<version>` 请求头使用同一版本。源码工具通过 [product.ts](src/product.ts) 读取配置，构建时将其值内联到桌面外壳和品牌组件；共享 JSON 的编译副本以 `lib/types/waibibabo-product.json` 随 LLM 包发布。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [账号包](../../credentials/sub2api-account/README.md)：登录、模型凭据和限制。
- [Web 组合包](../web-app/README.zh.md)：本地任务界面。
- [基础组合包](../base/README.zh.md)：共享工具和 Skills。

<a id="model-experience"></a>
## 模型体验

### 产品身份

#### 模型可见内容

`system-prompt.harnessIdentity` 将默认助手身份设为 Waibibabo Harnesss（WSS），保留工作区上下文及已有工具指令，不增加工具。

#### Token 影响

产品身份随系统提示词发送，每次请求占用少量输入 token。

#### KV Cache 影响

产品身份进入系统提示词前缀；修改该配置会改变后续请求的提示词内容，并可能使此前的前缀缓存失效。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 必须部署配套 Sub2API 桌面接口和数据库迁移后才能登录。
- 此组合包不分发平台管理的 Skills，也不配置产品更新服务器。

<a id="dev-note"></a>
### 开发备注

无。
