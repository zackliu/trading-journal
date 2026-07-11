# Trading Journal (方案 B) — 产品与领域简介

> 本文件是当前的**产品边界、领域模型与主张**的唯一事实来源（source of truth）。设计发生变化时，直接把相关小节改写成最终形态，不要追加"修改说明 / 根据最新讨论"。

## 1. 主张（Thesis）

用一个专门的应用替代目前基于 PowerPoint 的交易复盘工作流。核心不是"再做一个画图工具"，而是把**标注产物**、**分类标签**、**图表来源**三件事拆开，用多对多的**分组标签（group 化的 tag）**取代线性文件夹，从而：

- 一张复盘图**只存一份**，却能同时出现在任意多个分类视图里，不再靠复制。
- 分类是**多维正交标签**的组合查询，而不是"决定放进哪个盒子"。
- 图里**某个具体元素**（入场框、文本框…）属于哪个 tag，可以被精确标记、查询，并在浏览该 tag 时**短暂高亮**指认出来。
- 用户可选择开启一个**只读 AI Access extension**，把结构化复盘、统计与盘面证据通过标准 MCP 提供给自己信任的兼容 agent；Trading Journal 不绑定模型供应商，也不允许 agent 修改 journal。

## 2. 现状与痛点

用户目前在 PPT 里：把 TradingView 截图贴进幻灯片，用箭头/矩形/趋势线/文字做价格行为（price action）标注，然后把幻灯片归到左侧的 section（如 `Wedge-Top-Failed (5)`）。

痛点：

- **一维线性 section**：一张幻灯片只能属于一个 section。一张图同时属于两个不同分类时，只能**物理复制**再归入另一个 section。
- **"复制"其实略有区别**：同一张图在 setup 视角下会**多画一个蓝框**，指认这张图里的哪一笔、哪个位置才是这个 setup。所以它不是纯复制，而是"同一底图 + 一个额外的、指向具体交易的标记"。
- **计数与分类全靠手工维护**；无法按标签组合查询，也无法做任意维度的组合统计。

## 3. 第一性拆解

在 PPT 里，"这张标注图"与"它属于哪一类"是**同一个对象**（幻灯片放在哪个 section = 它的分类），这就是被迫复制的根因。正确的拆解是把三样东西分开：

| 层 | 含义 | 在 PPT 里的现状 |
| --- | --- | --- |
| **Artifact（标注产物）** | 一张固定复盘页 + 0..n 个截图对象 + 你画的分析标注 | 幻灯片本体 |
| **Tags（分类）** | 贴在 artifact 上的标签，多对多 | 被压平进一维 section 名 |
| **Source（图表来源）** | 截图的原始图表（V1 是静态截图） | 幻灯片里的图片 |

一旦拆开，**"section"不再是物理文件夹，而是"保存的标签查询"（动态视图）**。同一 artifact 打了多个标签，就自动出现在多个视图里，只维护一份。

## 4. 核心领域模型

```
Entry（一次复盘 / 一个 chart context）——durable，存一份
├─ page         固定尺寸白色复盘页（尺寸随 Entry 存在 canvas_json）
├─ screenshots  0..n 个静态截图对象（可移动 / 缩放 / 堆叠，bytes 按 hash 存 images/）
├─ annotations  页面上的所有标注元素（框 / 线 / 箭头 / 文本框 / 组…）
│                 每个 annotation 自带 geometry(bounds)、可带 0..n 个 tag、可带一个可选的 result、可 link 到别的 annotation
├─ entryTags    贴在整张复盘上的 tag（Tag[]）
└─ image        可选 cover hash（仅供页面首次渲染前 fallback，不是唯一底图）

Tag = group:value    group = 分类维度（用户自定义、可枚举）→ UI 第一层；value → UI 第二层
Result = annotation 上可选的、多维、typed 的结果记录（仅用于统计、不进浏览导航）
       = { dimension → value }；dimension 用户预定义，value 类型为 string 或 number
```

要点：

- **Entry 是 durable 对象**，永远只存一份，绝不为了出现在第二个分类而复制。
- **没有特殊的"TradeMarker"类型**：任意 annotation 都能带任意 group 的 tag。入场框带 `setup:<value>` 只是其中一例，文本框带某个"日内结构"group 的 tag 是另一例——二者机制完全相同。"被 tag 的元素在浏览该 tag 时高亮"是**通用行为**，setup 一点都不特殊。
- **笔记就是文本框 annotation**：文本框的内容即笔记，且它本身也能打 tag。没有独立的 note 字段。
- **tag 可贴在两个层级**：整张 Entry（entryTags），或某个具体 annotation（annotation.tags）。
- **所有对象与 annotation 的 geometry 用 page 像素坐标**；截图只是页面里的 image object。V1 仍只处理静态截图，不绑定价格 / 时间轴。
- **annotation 可互相 link**，用于"类似但语境不同"这类跨图对比。

## 5. 分组标签（Group / Tag）模型

用户脑中的分类本就是多个正交维度，PPT 只能压平成一维 section。改用**分组标签**：tag 归属于 group，group→tag 是两层结构（正对应 UI 左侧的两层导航）。

**app 只提供 group-tag 机制，不预置固定的 group 目录**：有哪些 group、每个 group 有哪些 tag（value），都由用户自行定义、增删。下表只是一种可能配置的示例，不是内置默认集；唯一结构性 group 是 `date`（用于时间排序）。

| Group（示例，均由用户定义） | 通常贴在 | 说明 |
| --- | --- | --- |
| `setup` | annotation（入场框等） | 该笔交易代表的形态 |
| 某个"日内结构"group | Entry 或某个文本框 annotation | 对整张图或某段结构的分类 |
| `instrument` / `timeframe` / `session` … | Entry | 整张图的元数据 |
| `date`（结构性 group） | Entry | 交易日，用于排序 |

- **结构性区分（机制，非词表）**：tag 贴在 **Entry 级**还是 **annotation 级**。annotation 级 tag 决定"浏览该 tag 时高亮哪个元素"；entry 级 tag 只把整张图纳入。
- 标签命名统一为 `group:value`，value 用 kebab-case、稳定 id（见 tagging-conventions skill）。
- 分类从"放进哪个盒子"变成"贴哪些 tag + 事后任意布尔组合查询"，例：`structure:<value> AND setup:<value>`。
- **"该笔结果"不是 group/tag**：结果（如 R 倍数、回调深度）是 annotation 上的**可选 typed `result`**，只用于统计、不进浏览导航；详见 §5.1，不要把它做成 `outcome` group。

## 5.1 结果（Result）——annotation 上的 typed 统计属性

`result` 与 group/tag 是两个不同机制，区别明确：**tag 进左侧浏览导航、是分类切片轴；result 不进浏览导航、是被度量的结果**。

- **挂载**：`result` 挂在 **annotation 级**（代表一笔交易 / 一个入场的 annotation），可选——不需要的 annotation（如纯说明文本框）不填。
- **多维 + 正交**：一个 result 可同时含多个维度，每维一根独立轴（示例：R 倍数、回调深度……，维度可继续扩展），绝不把两维融进一个值。
- **typed**：每个维度的值类型是 **string**（类别，如 回调深度=深）或 **number**（如 R 倍数=1.0）；当前只支持这两种类型。
- **用户预定义维度**：有哪些 result 维度、各自的显示名与类型（string / number），由用户在系统里预定义；app 只给机制，不预置维度词表。
- **只服务统计**：result 用于"在某些 tag 切片下度量结果分布"（见 §8 与统计 slice）；它不进 group→tag 浏览导航，也不参与浏览高亮。
- **统计单位是结果样本，不是 Entry**：一枚纳入 population 的 annotation 是一个结果样本；同一 Entry 可有多个样本。系统没有特殊 Trade 类型，也不把一张图默认算作一笔交易。
- **population 口径显式可见**：有 annotation 分类条件时，population 是满足这些条件的 annotations；没有 annotation 分类条件时，population 是带有任一活跃 result 记录的 annotations。后者只能表示「已有某项结果记录的样本」，不能被称为「全部交易」。
- **缺失不等于 0 / 亏损**：选择某个 result 维度后，只有该维度有值的样本进入该维度的均值、分布与条件命中率；未填该维度的样本单列为 missing。若 population 由明确的 annotation 分类条件定义，可把它理解为该范围内的填写 coverage；若使用默认「带任一活跃 result 的样本」population，只能写成「所选维度在这些 result-bearing samples 中未记录」，不能暗示这些样本都应填写该维度。

## 6. 视图 = 同一份产物的多种渲染（按 group / tag 浏览）

不再有"两份图"，也不再有"专门的 Setup 视角"；只有**一份 Entry，按不同 group/tag 浏览时的不同渲染**：

- **导航**：左侧两层可折叠（OneNote 式）——第一层 group，第二层 group 内的 tag。选中某个 tag = 跑查询 `tag == 该 tag`。
- **缩略图**：命中的 Entry 以缩略图竖向排列（像现在 PPT 左侧）。
- **大图**：点某张缩略图，右侧放大成完整图（像现在 PPT 主区）。
- **高亮**：若该 tag 贴在某些 annotation 上，打开大图时对这些 annotation 做**短暂高亮**，让人一眼知道"这个元素关于这个 tag"。不缩放视口、不持久淡化其余。
- **Daily Review** 只是"浏览 `date` 这个结构性 group、按时间排"的一个实例，不是独立特例。

"浏览某 tag 时指认对应元素"——因为 annotation 自带 bounds，高亮直接用它的 bounds。**高亮是 render 期派生、非破坏性、不产生第二份存储、不落库。**

## 7. 已确定的机制决策

以下为当前目标态选择的**单一机制**（不是可选分支）：

- **白页 + 静态截图对象 + page 像素坐标**：V1 的 review surface 是固定尺寸白页，页面可放一张或多张静态截图；截图与 annotation 都以 page-pixel geometry 存储，不绑定价格 / 时间轴。
- **笔记就是可打 tag 的文本框 annotation**：没有独立的 entry / marker note 字段。
- **没有特殊标注类型**：任意 annotation 都可带 group 下的 tag；"setup 高亮"只是"被 tag 的 annotation 在浏览该 tag 时高亮"的一个实例，必须 general 化，不特判。
- **高亮 = 对带该 tag 的 annotation 短暂高亮**（不缩放视口、不持久淡化），在 render 期计算，不落库。
- **tag 可贴在 Entry 或 annotation 两个层级**；annotation 级决定高亮目标。
- **annotation 支持互相 link**，用于跨图对比。
- **结果 = annotation 上可选的 typed `result`**：多维、每维 string 或 number、维度用户预定义；**只用于统计、不进浏览导航**，与 tag 是两套东西，绝不做成 `outcome` group、也绝不融进某个 tag 值。
- **绝不复制 artifact 来满足某个视图**：视图 = 查询 + 渲染模式。
- **app 提供机制，不预置目录**：group、group 内的 tag 值、可复用图章一律由用户自定义/自己设计，系统不内置一套预先设计好的默认集；`date` 是唯一结构性 group。文档里出现的任何具体名字都只是示例。
- **AI 接入只有只读能力**：AI Access 是默认关闭、由用户显式开启的第一方 extension。用户点 Start 就表示把当前 journal 的结构化数据、可读文字和视觉证据完整授权给本机连接的兼容 agent；不再设计逐 agent / 逐数据类型权限。它不提供 create / update / delete / tag / save、任意 SQL、任意文件路径或自动回写；外部 agent 的回答与建议也不成为 journal 数据。
- **用户可教 agent 如何读自己的图**：AI Access 提供一份可编辑的 Agent Guide 与可编辑 Prompt Library。用户可写明图表布局、颜色 / 形状 / 图章含义、入场点标记方式、哪些视觉线索可以或不可以推断，以及希望 agent 如何引用证据。它们是 machine-local AI 配置，由用户在应用里编辑；agent 只能经 MCP `prompts/list` / `prompts/get` 和 guide resource 读取，不能修改。
- **视觉对应不能只靠 annotation bounds**：AI Access 按单个 Entry 生成临时视觉证据包：未加 AI 标记的完整已提交页面、用 `A1 / A2 …` 明确对应 annotation id 的 locator、每个 annotation 的局部 focus，以及可安全映射时从原始截图 native pixels 取得的同 ROI locator / clean crop pair；同时给出 shape、端点 / 路径、页面坐标、截图实例与变换关系的结构化 manifest。locator 与 crop 都是只读派生证据，不写回 journal；截图上的空间相交也不自动代表用户语义，箭头尖端、框选区间与 stamp 含义仍以 Agent Guide 为准。
- **视觉观察不等于结构化行情事实**：外部多模态 agent 可以在高分辨率原图 crop 上观察 K 线并尝试计数，但静态像素没有价格 / 时间轴语义，视觉模型对精确定位和密集对象计数也可能出错；Trading Journal 保留 native crop 的服务端像素，也无法保证外部 client / 模型不再缩放。系统不保证精确 bar count、价格或时间；边界、遮挡、截断或分辨率不足时，agent 必须说明计数口径与不确定性，而不能把估计当作数据库事实。

## 8. MVP 范围

1. Ingest：粘贴/导入一张截图，创建一个 Entry。
2. Canvas 标注：基础绘图原语（线、框、箭头、水平线、文字、自由手绘）+ PPT 级样式（描边/填充/透明度）；**用户自建的可复用图章库**（自己设计并保存组件，系统不预置固定几个）。
3. 给任意 annotation（框 / 文本框 / …）打 group 下的 tag、并可给它设一个可选的 typed `result`（多维、每维 string 或 number、维度用户预定义）；笔记就是文本框 annotation；annotation 可互相 link。
4. Entry 级 group 标签（贴整张图；`date` 为结构性 group）。
5. Tag & query 引擎：布尔组合查询、每个 tag 的自动计数、保存为视图。
6. 按 group/tag 浏览的 UI：左侧 group→tag→缩略图两层可折叠导航（缩略图竖排，像 PPT），右侧完整大图；打开时对带该 tag 的 annotation 短暂高亮。
7. 统计：在全屏 Stats workspace 中先用分类 tag 与日期圈定结果样本，一次只观察一个 result 维度；string 维度给计数 / 占比，number 维度给均值、中位数与用户定义的阈值命中率。可按**一个** Entry 级或 annotation 级分类 group 对比，并显示样本量、来自多少 Entry、recorded / missing / coverage；任一总体、cohort 或分布段都可回到既有左栏与 canvas 查看原始复盘证据。Stats 不继承 result filter、不按表现排名、不生成预测或交易建议。

### 8.1 可选扩展：Read-only AI Access（post-MVP）

- Trading Journal 可启动一个由应用监管的本机只读 MCP companion；用户把连接配置交给自己选择的兼容 agent，应用本身不内置 LLM、不保存模型 API key、不调用模型。
- agent 可先按日期、Entry / annotation tag、result 与 SavedView 做有界查询和统计，再按需为少量 annotation 取得单 Entry 视觉证据包；包中的 overview、编号 locator、focus、原图 native locator / clean pair 与结构化几何共同建立「annotation id ↔ 页面标记 ↔ 局部盘面」的对应，而不是让模型只凭一个 bounding box 猜目标。
- AI Access 默认关闭；用户点 Start 即一次性授权当前 journal 的结构化数据、machine-readable text 与 chart images。外部 agent 取得内容后可能发送给其模型供应商，开启界面必须明确披露；不再要求用户配置细粒度权限。
- extension 只能读取当前打开的 journal；应用关闭、切换 workspace 或 Stop 后，session、cursor 与 media link 立即失效。持连接 key 的本机 client 被视为有权遍历整个当前 journal；分页是性能 / 上下文控制，不是授权边界。
- Agent Guide 与 Prompt Library 可在 AI Access 中编辑、启停、恢复默认或新增自定义模板，并通过 MCP Prompts 暴露。配置存在 machine-local app config，不写进 journal，也不允许 agent 远程修改。
- 只有真正把 MCP image content / resource 交给多模态模型的兼容 client 才具备盘面视觉分析能力；text-only 或未转发图片的 client 只能使用结构化数据，必须明确说明没有看过图。
- AI 输出只用于外部对话与研究，不自动创建 tag、修改 result、写 note、保存报告、下单或改变任何 Entry。若用户采纳建议，仍由用户回到应用手工编辑。

## 9. 非目标（Out of Scope）

- 不做实时行情、下单/经纪、回测引擎、指标平台。
- 不做通用绘图工具；只做交易复盘标注所需的子集 + 图章库。
- V1 不接可回放/实盘图表；annotation 不绑价格轴。
- 不把 screenshot 自动转换成 OHLC / 价格轴 / 时间轴，不内置 candle detector，也不承诺从像素中得到精确 bar count。
- 不做内置 AI 聊天、模型托管、agent 编排或云端 journal 后端；只提供用户显式开启的本机只读 MCP extension。Trading Journal 不保证外部 agent 的结论正确，也不把其输出视为交易建议或执行指令。

## 10. 技术决策

### 已定

- **UI 框架 = React**（renderer）。理由：生态与 AI 生成语料最大、桌面级组件最丰富、可靠性最高（与选 Fabric 同一逻辑）。**Fabric 画布保持命令式**——单独挂载、用 Fabric API 操作，隔离在 React reconciliation 之外；框架只管画布周围的导航 / inspector / 缩略图 / 统计。排除 Svelte / Vue / Solid（生态与语料更小、可靠性风险略高），本项目非必需。
- **画布技术 = Fabric.js**（MIT）。理由：需要 PPT 级任意描边色/填充色/透明度，Fabric 原生支持；MIT 无水印；API 老牌稳定、语料充足，AI 生成可靠。选择/变换手柄与文本编辑内置，其余编辑器功能（工具条、样式检查面板、撤销、按住 Ctrl 约束水平/垂直、把 annotation 打 tag、浏览 tag 时短暂高亮）由 AI 生成的常规代码补齐。备选 Konva（React-first / 更极致底层控制，能力相当）。排除 tldraw（自定义许可带水印、样式系统需改造才能任意配色、SDK 迭代快 AI 可靠性低）与 Excalidraw（手绘感）。
- **运行/存储形态 = Electron 薄壳 + 本地 SQLite（better-sqlite3）+ 图片文件夹**。web UI（Fabric）不变，外面套 Electron（纯 JS/TS、无 Rust；Obsidian/VS Code 同款），拿到原生文件系统与 SQLite。结构化数据（Entry / Annotation / group 标签 / annotation 的 typed result / SavedView / annotation-tag 索引 / 统计）进 SQLite，支持布尔多 group 查询，以及在 tag 切片上对 result 的聚合统计；截图作为文件存 `images/<hash>`，由 DB 按 hash 引用，**不 base64 塞进 canvas JSON**；canvas 用 Fabric `toJSON`（含 annotation 的 tag/link 自定义属性）按 Entry 存。整个数据是磁盘上一个可移植文件夹，可放进云盘备份/同步。排除 Tauri（需 Rust 工具链；官方插件之外的自定义原生逻辑要写 Rust，且 v1→v2 API 变动使 AI 生成可靠性低）。
- **AI Access = 第一方可选 extension + MCP companion**：extension 是独立受监管进程，不是通用第三方插件平台；transport 为只绑定 loopback 的 Streamable HTTP MCP。Start 是唯一的完整只读授权开关；一把由应用自动管理的本机 access key 只承担 transport 防护，不形成用户可见的权限系统。数据能力由 main 内独立 `JournalReadApi` 提供，使用 readonly SQLite connection + `PRAGMA query_only=ON`；companion 不获得 DB 路径、store write API 或文件系统路径。
- **AI 视觉证据 = 单 Entry、临时、可追溯的 evidence bundle**：查询 / 统计仍只读 annotation-tag index；视觉服务只解析该 Entry 已提交的 `canvas_json` 与其引用图片，用与编辑器相同的 Fabric class registry 和对象 transform 派生 geometry、locator 与 crop。bundle 绑定 session、workspace 与内容 revision，只存在内存，不新增 annotation geometry 表、AI 索引或 `canvas_json` migration。

### 后续研究（不阻塞首个实现，暂不细化方案）

- **从 PPT 迁移**：目标**不是**把幻灯片当静态截图导入，而是把用户在 PPT 里画的框、写的字、箭头等标注，用新 app 的原生组件**复刻成可编辑的 annotation**（框 / 文本框 / 箭头…、可打 tag），成为可查询、可高亮、可再编辑的元素，而不是压平的图片。这需要解析 PPT 的形状/文本/坐标并映射到 Fabric 对象与领域模型，属**高难度**工作。此处只记录诉求，方案留待后续专门研究。

## 11. 标签命名与术语

标签统一遵循 `group:value` 命名规范，见 `.github/skills/tagging-conventions/SKILL.md`。具体有哪些 group、每个 group 有哪些 tag 值，是**用户自定义的领域词表**，由用户维护，不写死在 skill 或 `src/` 里。
