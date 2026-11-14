---
description: "歪比巴卜 Windows 桌面端的账号接入、中文界面、数据目录和构建说明。"
kind: reference
---

# Waibibabo Harnesss

Waibibabo Harnesss（简称 WSS）使用歪比巴卜平台账号执行本机任务，平台地址为 `https://www.waibibabo.com`。产品版本从 0.1.0 开始，界面固定中文，不提供语言切换入口。

## 使用方式

启动后在账号窗口选择邮箱密码登录或浏览器一键授权。启用双重验证的账号继续输入身份验证器验证码。登录后在设置的“模型”模块选择可用分组，再在对话模型选择器中选择模型；“平台账号”只展示账号、剩余额度、今日消耗额度及账号操作。项目文件、命令执行和本地 Skills 仍在当前电脑上使用。

浏览器批准授权后，客户端请求恢复并聚焦主窗口。回调页面使用产品名称和明暗主题卡片，分别展示登录成功或授权失败；授权码和令牌不写入页面内容。

“模型”模块按模型自动选择协议：OpenAI 使用 Responses，Claude 使用 Messages，DeepSeek 使用 Chat Completions，Gemini 使用原生 Gemini 接口。每个模型旁可手动覆盖协议或恢复自动选择。此处还可从平台发布的 API 线路中切换地址，影响对话与生图。登录弹窗和平台账号页可将“账号线路”设为自动或指定主站、CN2、直连地址，用于登录和账号数据；“模型线路”独立设为自动或指定平台地址，用于对话和生图。两者默认自动，界面展示当前连接地址。账号线路在退出和重启后保留，模型线路随当前登录记录保存。浏览器授权和已有账号身份仍使用主站标识。

“默认模型容量”提供 256K、475K、1M 上下文预设，并允许修改输入、输出预算；默认输入 224K、输出 32K，未单独设置的模型继承全局；每个分组内的模型可覆盖或恢复继承。自动压缩按实际输入预算预留输出和压缩空间。具体预算规则见[账号包说明](../../packages/credentials/sub2api-account/README.md#use-this-package)。

在设置中打开“使用日志”，或点击账号页面的同名按钮，按日期、模型、分组和请求方式查询平台记录；可翻页并查看 Token、缓存、费用及耗时详情。后台上传 Session Log 的设置与服务已从桌面组合移除。

侧栏“生图”选择生图分组和平台模型，也可自行填写模型名；尺寸支持比例预设及自定义宽高。可上传参考图并预览、移除，结合提示词生成图片。结果缩略图点击可放大，下载显示进行中和实际保存结果。“前往平台充值”直接打开浏览器充值页；设置中的“充值与订阅”可查看套餐、当前订阅和订单，套餐说明支持 Markdown，订阅订单创建后可打开支付页或扫码，付款后点击核对状态。“发票申请”可计算费用、提交两类付款截图、修改待开具申请、查看进度和下载发票。具体限制与错误处理见[账号包说明](../../packages/credentials/sub2api-account/README.md#use-this-package)。

## 多文件夹工作区

在侧栏工作区菜单中点击“编辑”，可为同一工作区添加前端、后端、移动端等多个源文件夹，并将其中一个设为主要目录。“保存”后，下次任务会获得当前目录列表；选择“工作区内修改”权限时，所有列出的目录都可读写。主要目录用于新会话的默认命令位置，已有会话保留当前目录，可通过绝对路径操作其他已授权目录。

目录配置会保存并在重启后恢复。移除目录不会删除磁盘文件，也不会移除历史会话；它只撤销该目录的工作区写入授权。运行中的任务、后台任务、子代理、自动化和打开的终端需先停止或关闭，才能修改目录。

## 服务端要求

配套 Sub2API 必须先部署桌面 OAuth 接口、授权确认页、设备授权管理页及数据库迁移，并将前端地址配置为平台 HTTPS 源站。部署细节见 Sub2API 项目的 `docs/waibibabo-desktop.md`。[账号包说明](../../packages/credentials/sub2api-account/README.md) 描述凭据存储、短期密钥和撤销限制。

多线路、充值订阅和发票需要同步更新 Sub2API 的桌面用户路由；设备 IP 与批量授权管理还需要 `256_desktop_device_activity.sql`；旧授权在下次客户端连接后获得 IP 记录。生图需要平台对应分组启用生图权限，并可访问 `/v1/images/generations`；参考图生成还需模型与线路支持 `/v1/images/edits`。

## 产品配置

产品名称、简称、版本、安装标识和主目录统一由 [waibibabo-product.json](../../packages/llm/llm/src/waibibabo-product.json) 管理。侧栏显示 WSS 和产品版本，会话首页显示完整名称及版本，均使用彩色产品图标，侧栏用户名右侧显示自动更新的剩余额度。模型 API 请求的 `User-Agent` 为 `wss/<产品版本>`，与界面共用版本配置。产品版本独立于底层工作区包版本；升级不会重写会话格式或已有数据。默认应用标识为 `com.waibibabo.desktop`，数据保存到用户目录下的 `.waibibabo`。显式设置 `DSH_HOME` 可覆盖该目录，复用已有目录前先备份。

全新安装默认位于 `%LOCALAPPDATA%\Programs\Waibibabo Harnesss`；已注册的安装保留其原目录，安装首页可重新选择位置。应用名称、快捷方式、卸载项和安装器均显示 Waibibabo Harnesss。Electron 界面配置位于 `%APPDATA%\Waibibabo Harnesss`，与 `.waibibabo` 中的账号和会话分开。

用户提供的原始图标保存在[产品图标](../../packages/bundle/waibibabo/src/client/assets/icon.png)。安装器、卸载器和应用图标使用此图；侧栏、会话首页、登录弹窗和平台账号页使用同目录下的 `colorful.png`，白色原始素材保存在 `white.png`。构建时从原图和产品名称生成浅色、深色及高分辨率安装图片。替换原图后，在 `apps/desktop` 运行 `pnpm run render:tray-icon` 更新 Windows 托盘资源。

`WAIBIBABO_PLATFORM_ORIGIN` 可指定其他平台源站；数字回环 HTTP 开发环境还需设置 `WAIBIBABO_ALLOW_LOOPBACK_HTTP=1`。桌面配置自动加载[歪比巴卜组合包](../../packages/bundle/waibibabo/README.md)，禁用上游账号入口和产品遥测。此发行版未配置自动更新源和强制更新服务。

## 构建与验收

源代码使用仓库要求的 Node.js 与 pnpm 版本。产品构建执行 `pnpm run build --profile waibibabo`，同时检查产物和聚合类型，并将产品名称写入页面标题。通过 `pnpm run start:desktop` 启动已构建的桌面程序。Windows 打包入口为 `apps/desktop/package.json` 中的 `package:win:x64:unsigned` 和签名发布命令；打包自动选择产品构建配置，签名要求见 [Windows 签名说明](windows-signing/README.zh.md)。Electron 运行时使用锁定依赖提供的 SHA-256 校验值验证，可复用本机缓存。

自动化检查与真实平台验收分开：实际账号登录、余额扣费、系统浏览器回跳及安装体验需要配套服务部署后验证。平台统一管理和分发 Skills 属于后续功能。

Windows 命令若在执行前报告 `SetNamedSecurityInfoW (Win32 5)`，表示系统拒绝沙箱修改目录安全信息。普通文件写入权限不足以完成此操作，还需要修改访问规则与完整性标签的权限；可检查目录“属性 → 安全”，或使用当前账号拥有完全控制权限的工作区。程序会保持沙箱保护并报告错误，不会自动放宽目录权限。
