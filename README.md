# Trading Journal（交易复盘日志）

一个替代 PowerPoint 复盘工作流的桌面应用：把交易图表截图贴到白色复盘页上、做价格行为标注，再用**多对多的分组标签（`group:value`）**分类。同一张复盘**只存一份**，却能出现在任意多个分类视图里，不再靠物理复制。

> 产品边界与领域模型的唯一事实来源是 [trading-journal-brief-ch.md](trading-journal-brief-ch.md)；实现切片计划见 [specs/implementation-plan-ch.md](specs/implementation-plan-ch.md)；给协作/AI 的工作规范见 [AGENTS.md](AGENTS.md)。

## 核心特性

如果你以前用 PowerPoint 复盘，一定遇到过这个痛点：一张标注好的图，为了同时归到"高二形态"和"追单情绪"两类，就得复制两份、贴到两个位置，越攒越乱。这个应用就是来解决它的——**同一张复盘只存一份，却能同时出现在任意多个分类里**，全靠打标签，而不是复制文件。

先用一个完整场景把流程串起来（下面出现的分组、标签、结果维度**都是你自己定义的**，应用不预设任何词汇）：

> **收盘后**，你想复盘今天一笔 EURUSD 的交易。
> 1. 顶部 **Home** 页点 **New** 新建一张空白复盘页，直接 **Ctrl+V** 把两张截图（5 分钟、1 小时）贴上去，拖一拖排好位置。
> 2. 切到 **Draw** 页，在入场那根 K 线上画个框，再拉一个文本框写两句当时的想法。
> 3. 选中那个框，顶部会多出一个 **Annotation** 页：给它打上标签 `形态:高二`、`情绪:追单`，并记下这笔的结果 `盈亏:亏损`、`R:-1.2`。
> 4. 一周后想复习"我做砸的高二"：在左侧把浏览维度切到 `形态`、点 `高二`，或在 **View** 页组合"形态=高二 且 有一个标注结果=亏损"——一秒列出所有相关复盘；点开时，当初打了标签的那个框还会**短暂发光**帮你指认。

下面逐个说明每块能力**怎么用、有什么用**。

### 复盘页：一张页面 = 一条完整复盘

一张白色页面，上面放**一或多张截图**（可移动、叠放、缩放的图片对象）、你画的**标注**、以及给整页打的标签。它是复盘的最小单位，**编辑即自动保存、永远只存一份**。

- **怎么用**：**Home** 页 **New** 建页后 **Ctrl+V**（或拖拽）把截图贴进去；如果当前没有打开任何复盘，直接 Ctrl+V 会自动新建一条并把截图放进去。
- **用处**：把同一笔交易的多周期截图放在同一页对照着看，而不是散落在几个文件里。

### 标注 + 分组标签：打完标签，之后按标签找回

标签的形式是"分组:值"（`group:value`），比如 `形态:高二`、`品种:EURUSD`、`情绪:追单`——分组是维度，值是具体分类。**任意标注**（框 / 文本框 / 箭头 / 手绘…）或**整张页**都能打任意分组的标签。

- **怎么用**：选中某个标注 → 顶部 **Annotation** 页用快捷标签开关打标签；想给整页打，用 **Review** 页的快捷标签。分组和标签值在 **Home → Group & tags** 里定义。
- **用处**：分类不再靠文件夹、也不靠复制。同一张复盘可以同时属于"高二"和"追单"，你只管打标签、不搬文件。
- **高亮指认**：从左侧某个标签桶点开一条复盘时，当初带这个标签的那个元素会**短暂发光**，一眼看出"我当时标的是哪儿"。

### 浏览与视图（View）：分类是"活的查询"，不是死文件夹

左侧栏可以按任意**分组**展开：每个值下面列出命中的复盘缩略图，并带实时数量；想要更精细的组合，就在 **View** 页搭一个查询。

- **怎么用**：左侧顶部的切换器选一个分组维度（或 **All reviews**），即可按 `形态 / 品种 / 情绪…` 浏览；**View** 页 **Edit filter…** 可组合多个条件（整张页要满足哪些标签 + 某个标注要同时满足哪些标签/结果），筛出命中的复盘。
- **保存视图（Saved views）**：把常看的组合存成一个视图，下次在 **View** 页一点就重跑——它永远返回**最新**命中的复盘，不是一份静态快照。
- **场景**：存一个"我做砸的高二"（形态=高二 且 有标注结果=亏损）、一个"追单复盘"，像固定的"智能文件夹"一样随时点开，新加的复盘会自动进来。

### 结果登记（Result）：记录每笔的输赢/盈亏，用来筛选和统计

结果**不是标签**，而是记在标注上、可选、可多维、带类型的数据——比如 `盈亏`（赢/输/保本，选择型）、`R`（-1.2，数字型）。它专门用于筛选和统计，不会混进你的分类标签里。

- **怎么用**：用选择工具点击标注会自动进入 **Annotation** 页；选择型维度点一下选值、数字型维度直接填数字。维度和它的可选值在 **Home → Result** 里定义。
- **场景**：给入场框记 `盈亏:亏损`、`R:-1.2`，之后在 **View** 里筛"所有 R 小于 -1 的复盘"，或进入 **Stats** 看某类形态的结果分布。

### 统计（Stats）：从数字回到原图证据

**Stats** 以 annotation 为结果样本，不把一张 Entry 自动当成一笔交易。它会明确显示 population、来自多少条复盘、recorded / missing 和分母；缺失结果不会被当成 0。

- **怎么用**：先在 **View** 圈定整图和 annotation 的分类范围，再打开 **Stats**；结果筛选会被主动忽略，避免只统计预先挑过的输赢。选择 All / 30D / 90D / Custom、一个 result measure，以及可选的一个 Entry 级或 annotation 级 group 做 Compare。
- **数字结果**：显示 mean、median，以及自己设定的 `≥ / ≤` condition match；系统不会擅自把某个阈值叫作胜率。
- **选择结果**：显示每个值的精确 count / recorded 占比；Compare 行允许多值重叠，并明确提示不能把各行相加。
- **回看证据**：Overall、cohort、recorded / missing、字符串分段和 threshold 都可点 **Review examples** 回到原复盘；同一 Entry 有多个样本时用 Previous / Next 逐个普通选中，返回后 Stats 配置和滚动位置仍在。

### 图章库（Palette）：把常用标注存起来，随手拖出来复用

页面右侧有一条**图章条**，放你反复要用的标注组合（比如画好的"趋势线 + 标签"、或一个写着"追单-别再犯"的红框）。图章库是**全局共用**的，所有复盘都能取。

- **怎么用**：在 **Draw** 页把 **Palette** 切到 **Unlocked**，就能把画好的标注拖进右侧条存成图章；切回 **Locked** 后，从条里往页面拖会拖出一份**副本**使用（原件留在库里）。
- **用处**：不用每条复盘都重画同一套标注，拖一份出来即可。

### 按日期回看（Daily Review）

每条复盘有一个**交易日**日期（可随时改）。左侧默认按 **年-月** 分组，像翻日历一样回看某天/某月做了哪些复盘——这其实就是浏览内置的 `date` 分组。

- **怎么用**：**Review** 页有日期输入框可改这条复盘的交易日；左侧切换器选 **All reviews** 就按年月分桶。

### 词表自管理：分组 / 标签值 / 结果维度都归你管

所有分类词汇都由你自己建立，可以随时维护，不怕建错。

- **怎么用**：**Home → Group & tags**（分组与标签）、**Home → Result**（结果维度）里增删改。**就地重命名**只改显示名、底层 id 不变（已打的标签不受影响）；不想要的项**归档**进"回收站"（可恢复），删除**正在使用**的项会先告诉你有多少条复盘在用、二次确认。
- **场景**：把"情绪"分组改名叫"心态"，或把一个用错的值归档，都不会弄乱已有复盘。

### 本地优先、自动保存、数据安全

- **本地存储**：所有数据放在你选的本地文件夹里（`app.sqlite` + 图片文件），无需联网、无需账号；这个文件夹也可以放在 OneDrive 等同步盘里跨设备用（见[数据存储位置](#数据存储位置)）。
- **编辑即保存**：没有"保存"仪式，每次改动都自动落盘并刷新左侧缩略图；**Ctrl+S** 只是习惯性地"立即存一下"。
- **绝不弄坏旧数据**：升级 App 时会先自动备份、按需迁移，绝不静默破坏或降级打开你的历史复盘；万一某张截图暂时读不到（比如 OneDrive 还没同步下来），会明确提示"打不开、数据安全、可重试"，而不是甩给你一张空白页。

## AI Access（只读 MCP）

Trading Journal 可以在本机启动一个可选的 **MCP server**，让 GitHub Copilot 等兼容 agent 读取当前 journal，帮助做样本研究、盘面核对和渐进式复盘。应用本身不内置模型、不要求模型 API key，也不保存 AI 回答。

AI Access 默认关闭。打开 **Home → Settings → AI** 后：

1. 首次点击 **Start**，确认完整只读授权说明。开启期间，持有复制配置的本机 client 可以读取当前 journal 的结构化数据、文字和图表图片，并可能把内容发送给它所使用的模型服务商。
2. 点击 **Copy Copilot config**。
3. 在 VS Code 命令面板运行 **MCP: Open User Configuration**，把复制内容合并到 `servers` 下并保存。
4. 运行 **MCP: List Servers**，启动 `trading-journal`，再在 Copilot Chat 的 Agent 模式中选择 Trading Journal prompt 或直接提问。

Trading Journal 必须保持运行且 AI Access 为 **On**。点击 **Stop**、退出应用或切换数据文件夹后，现有 session、分页 cursor、图片 resource 和临时 visual plan 会立即失效。若配置意外泄露，可用 **Reset access key** 让所有旧配置失效。

### Agent 能做什么

- **结构化研究**：按日期、Entry tag、annotation tag、result 和 Saved View 搜索；一次准备明确的样本总体、Entry 数、recorded / missing、结果分布和后续视觉批次。
- **读取复盘上下文**：查看 Entry、annotation、tag、typed result、文字和 annotation links，并沿用户建立的 links 回看相关复盘。
- **可验证视觉证据**：取得已提交页面、`A1 / A2…` locator、annotation 局部 focus，以及能唯一映射时的原始截图 native locator / clean crop pair。图片与 Entry revision 绑定，annotation id、页面坐标和 screenshot instance 都有明确对应。
- **原图与多种裁剪**：按 screenshot instance 导出原始存储 bytes、当前图片对象的 source window、任意有界 source/page ROI 或 annotation context。响应包含 checksum 和建议文件名。
- **逐 bar 渐进复盘**：围绕入场点选择局部窗口，先校准当前截图的 bar center 间距，再一次只揭示一根新的 bar；未来帧在 `next` 前没有可读取的 item id。

### 围绕入场点渐进复盘

Prompt Library 内置 **“围绕入场点渐进复盘”**（`review_entry_progressively`）。它不会默认从截图第一根开始，而是从入场前足以理解 setup 的最小局部结构开始，逐根观察入场和其后的有限发展：

1. 用入场 annotation 确认正确的 screenshot / 周期 panel，并在原图像素坐标中选择入场前后的局部 ROI。
2. 优先用相距较远的累计 bar 编号估算首版间距；没有可靠编号时，用多个相邻 candle center 的间距中位数估算。
3. 同时检查 ROI 头部、中部和尾部的 locator / clean 放大图。三处等量偏移说明只需修 phase；偏差随距离增加则修 spacing；非线性漂移则缩小或拆分 ROI，不能强行接受。
4. 接受校准 proposal 后，用 plan-local bar 编号建立入场前后窗口。每看一帧，先记录当时可见信息下的结构、行动与失效条件，再调用 `next`。
5. 到达入场 bar 时，先回答“在不知道后续结果时是否会入场、依据是什么”，再继续揭示后续走势。

这项能力是对**静态截图做未来像素遮罩**，用于减少 hindsight bias，不是真实行情 replay。已经出现在可见区域里的指标、画线、文字或结果标记仍可能泄露未来信息；bar count、价格和时间也只是视觉观察，不能当作结构化行情事实。

### Agent Guide 与 Prompt Library

- **Agent Guide**：可写入个人图表布局、周期、颜色 / 图章含义、入场标记方式、bar count 口径和不可推断事项。Agent 会在视觉分析前读取它。
- **Prompt Library**：内置理解 journal、分析分类表现、检查单条复盘、围绕入场点渐进复盘、回顾近期样本和追踪 links 等工作流。模板可编辑、启停和复制，也可新增 custom prompt。
- 新版本增加 built-in prompt 时，只会补入此前不存在的模板；已经修改或禁用的模板和所有 custom prompt都会保留。

### 永久只读与保存到研究目录

MCP 的全部能力仍然是**只读**的：没有创建 / 修改 / 删除 Entry、tag、result、note 或 Saved View 的工具，也没有任意 SQL、文件路径或文件写入能力。AI Access 使用独立 readonly SQLite connection，并启用 `PRAGMA query_only=ON`。

图片“导出”只是返回 revision-bound resource / bytes、SHA-256 和建议文件名。若 coding agent 需要把原图、crop 或已经揭示的 frame 放进用户自己的 repo / 研究目录，它必须使用**自身已有的 workspace 或 terminal 文件工具**保存；Trading Journal 不接收目标路径，也不会替 agent 创建、覆盖或删除任何文件。没有文件工具的 client 只能查看图片，不能声称已经保存。

## 技术栈

- **Electron** —— 桌面外壳（main / preload / renderer 三进程）
- **React + TypeScript** —— 渲染层 UI
- **Fabric.js** —— 画布与标注
- **better-sqlite3** —— 本地持久化（原生模块）
- **zod** —— IPC 边界校验
- **electron-vite** —— 开发 / 构建工具链
- **electron-builder** —— 打包与安装包
- **Playwright** —— 端到端测试

## 环境要求

- **Node.js 18+**（推荐 20 LTS）与 npm
- **Windows**（当前打包目标为 Windows；main 进程用到原生模块 better-sqlite3，`npm install` 会自动为 Electron 重新编译）

## 开发启动

```powershell
# 1. 安装依赖（postinstall 会自动为 Electron 重新编译 better-sqlite3）
npm install

# 2. 启动开发模式（热重载：改 renderer 即时刷新，改 main/preload 自动重启）
npm run dev
```

`npm run dev` 会用 electron-vite 同时编译三个进程并拉起 Electron 窗口。首次启动会弹出引导，要求选择存放复盘数据的文件夹（见[数据存储位置](#数据存储位置)）。开发 / 测试时可用环境变量 `TJ_DATA_DIR` 直接指定一个隔离目录，跳过引导：

```powershell
$env:TJ_DATA_DIR = "$PWD\.devdata"; npm run dev
```

## 项目结构

```
src/
  main/         Electron 主进程：DB、迁移、IPC handler、store（entry / 词表 / result）、图片入库
  preload/      受控的 IPC 桥（白名单）
  renderer/     React UI：画布编辑器、Ribbon、词表/视图/结果对话框
  shared/       跨进程共享的领域类型与 IPC 契约
tests/e2e/      Playwright 端到端测试
specs/          实现切片计划
electron.vite.config.ts   electron-vite 配置
electron-builder.yml      打包 / 安装包配置
```

## 常用脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发模式（热重载） |
| `npm run build` | 编译 main / preload / renderer 到 `out/` |
| `npm run preview` | 预览生产构建 |
| `npm run typecheck` | 三个 tsconfig 全量类型检查 |
| `npm run lint` | ESLint 检查 |
| `npm run test:unit` | 跑 Vitest 纯逻辑单测 |
| `npm test` | 依次跑 Vitest、`build` 和 Playwright + Electron 全套测试 |
| `npm run test:e2e` | 仅跑 Playwright（复用现有 `out/` 构建） |
| `npm run package` | 生成**免安装可执行文件夹**（见下） |
| `npm run dist` | 生成 **Windows 安装包**（NSIS，见下） |
| `npm run rebuild` | 手动为当前 Electron 重新编译原生模块（better-sqlite3） |

提交前建议跑一遍质量门禁：

```powershell
npm run typecheck; npm run lint; npm test
```

## 打包与分发

产物统一输出到 `dist/`（已在 `.gitignore` 忽略，不入库）。首次打包时 electron-builder 会**联网下载**一次性的打包依赖（Electron 二进制、NSIS 等），之后走缓存。

### 方式一：免安装可执行文件夹（green / portable）

适合快速自用或临时发给别人试用：

```powershell
npm run package
```

产物在 `dist/win-unpacked/`，其中 `TradingJournal.exe` 即可直接双击运行。分发时把**整个 `win-unpacked/` 文件夹**打成 zip 发给对方，对方解压后双击 `TradingJournal.exe` 即可，无需安装。

> 注意：只发单个 `.exe` 不行——同目录下的 `.dll`、`resources/`、`locales/` 等都是运行必需的。

### 方式二：制作安装包（installer）

适合正式分发。生成 Windows 下常见的“下一步下一步”安装向导（NSIS）：

```powershell
npm run dist
```

产物是单个安装文件 `dist/TradingJournal-<version>-Setup.exe`（`<version>` 取自 `package.json` 的 `version`，当前 `0.3.0`，即 `TradingJournal-0.3.0-Setup.exe`）。把这个 `Setup.exe` 发给对方即可，双击后：

- 可选择安装目录（`allowToChangeInstallationDirectory`）；
- 按用户安装、**不需要管理员权限**（`perMachine: false`、`oneClick: false`）；
- 自动创建开始菜单 / 桌面快捷方式，并注册卸载程序（控制面板可卸载）；
- 卸载时**默认保留**用户数据（`deleteAppDataOnUninstall: false`）。

打包行为在 [electron-builder.yml](electron-builder.yml) 里配置。

### 发布新版本

改 `package.json` 的 `version` 后重新 `npm run dist`，安装包文件名会随之变化。

### 可选：自定义图标与代码签名

- **图标**：未设置图标时使用 Electron 默认图标（打包日志会提示 `default Electron icon is used`）。要自定义，把 `icon.ico` 放到 `build/` 目录（`buildResources` 已指向 `build`），electron-builder 会自动采用。
- **代码签名**：未配置签名证书时会跳过签名（日志 `signing is skipped`），产物仍可运行，但 Windows SmartScreen 可能对未签名安装包弹出提醒。正式对外分发建议配置代码签名证书。

## 数据存储位置

数据分两层，彼此独立：

1. **应用配置（机器本地的“指针”）**：`%APPDATA%\trading-journal\config.json`，只记住“复盘数据放在哪个文件夹”以及将来的 app 级偏好。它跟着这台机器走，不随复盘数据一起同步。
2. **复盘数据（真正的用户数据）**：由你**自己选择**的文件夹，里面是：
   - `app.sqlite` —— 复盘、标注、标签、result、保存的视图
   - `images/` —— 截图字节（按内容哈希命名）

   可以把这个文件夹放到 OneDrive 等同步目录，方便备份和多机访问。**没有默认位置** —— 首次启动会弹出引导要求你选一个文件夹；若配置指向的文件夹不存在（比如换了机器、同步没就绪），启动会停在引导界面，你可以重新选择，或把该文件夹准备好后点“重试”。

在应用内 **Home → Settings → General** 可查看当前数据文件夹、随时更换（直接使用新文件夹的数据、不复制旧数据）、或在资源管理器中打开它。

> 提示：SQLite 放在云同步目录时，请避免在两台机器上同时打开，以免同步过程中损坏数据库。

开发 / 测试时可用环境变量 `TJ_DATA_DIR` 直接指定数据文件夹（优先级高于 config.json，跳过引导）：

```powershell
$env:TJ_DATA_DIR = "$PWD\.devdata"; npm run dev
```

因为复盘数据不在安装目录里，卸载应用不会删除它；换机备份时复制这个数据文件夹即可。

## 数据安全与升级（0.1.0 起）

从 0.1.0 起，已保存的复盘数据被视为**受保护的数据契约**：任何 bug 修复或新功能都不得破坏现有数据，升级只能向前迁移、不丢数据。保障机制分三层：

- **向前迁移，只增不改**：SQLite 结构靠 `db.ts` 里 `MIGRATIONS` 数组按 `user_version` 逐版演进，只允许**追加**新迁移、绝不改动或删除旧迁移，每个迁移都保留 / 转换既有数据。
- **迁移前自动快照**：每次升级在应用任何待执行迁移**之前**，会把 `app.sqlite` 复制到数据文件夹的 `backups/`（保留最近若干份）；万一迁移出问题，可从这里恢复。
- **拒绝降级打开**：若某个复盘数据是被**更新版本**的应用写过的（schema 比当前应用还新），旧版应用会拒绝打开并提示你升级，绝不用不认识的结构去写它而损坏数据。

回归测试 `tests/e2e/data-migration.spec.ts` 会打开一个早期版本的真实复盘库（`tests/fixtures/journal-v*.sqlite`），断言迁移后每一条复盘、标注、标签、result、视图都完好——这是“升级不丢数据”的自动化证明。

## 许可

私有项目（`package.json` 中 `private: true`）。
