# Trading Journal (方案 B) — 产品与领域简介

> 本文件是当前的**产品边界、领域模型与主张**的唯一事实来源（source of truth）。设计发生变化时，直接把相关小节改写成最终形态，不要追加"修改说明 / 根据最新讨论"。

## 1. 主张（Thesis）

用一个专门的应用替代目前基于 PowerPoint 的交易复盘工作流。核心不是"再做一个画图工具"，而是把**标注产物**、**分类标签**、**图表来源**三件事拆开，用多对多的**分组标签（group 化的 tag）**取代线性文件夹，从而：

- 一张复盘图**只存一份**，却能同时出现在任意多个分类视图里，不再靠复制。
- 分类是**多维正交标签**的组合查询，而不是"决定放进哪个盒子"。
- 图里**某个具体元素**（入场框、文本框…）属于哪个 tag，可以被精确标记、查询，并在浏览该 tag 时**短暂高亮**指认出来。

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
| **Artifact（标注产物）** | 底图截图 + 你画的分析标注 | 幻灯片本体 |
| **Tags（分类）** | 贴在 artifact 上的标签，多对多 | 被压平进一维 section 名 |
| **Source（图表来源）** | 截图的原始图表（V1 是静态截图） | 幻灯片里的图片 |

一旦拆开，**"section"不再是物理文件夹，而是"保存的标签查询"（动态视图）**。同一 artifact 打了多个标签，就自动出现在多个视图里，只维护一份。

## 4. 核心领域模型

```
Entry（一次复盘 / 一个 chart context）——durable，存一份
├─ image        底图截图（V1：静态图片）
├─ annotations  画布上的所有标注元素（框 / 线 / 箭头 / 文本框 / 组…）
│                 每个 annotation 自带 geometry(bounds)、可带 0..n 个 tag、可带一个可选的 result、可 link 到别的 annotation
└─ entryTags    贴在整张图上的 tag（Tag[]）

Tag = group:value    group = 分类维度（用户自定义、可枚举）→ UI 第一层；value → UI 第二层
Result = annotation 上可选的、多维、typed 的结果记录（仅用于统计、不进浏览导航）
       = { dimension → value }；dimension 用户预定义，value 类型为 string 或 number
```

要点：

- **Entry 是 durable 对象**，永远只存一份，绝不为了出现在第二个分类而复制。
- **没有特殊的"TradeMarker"类型**：任意 annotation 都能带任意 group 的 tag。入场框带 `setup:<value>` 只是其中一例，文本框带某个"日内结构"group 的 tag 是另一例——二者机制完全相同。"被 tag 的元素在浏览该 tag 时高亮"是**通用行为**，setup 一点都不特殊。
- **笔记就是文本框 annotation**：文本框的内容即笔记，且它本身也能打 tag。没有独立的 note 字段。
- **tag 可贴在两个层级**：整张 Entry（entryTags），或某个具体 annotation（annotation.tags）。
- **annotation 的 geometry 用 image 像素坐标**（V1 静态截图）。
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

- **静态截图 + 像素坐标**：V1 底图是静态截图，annotation 几何用 image 像素坐标存储，天然对齐；不绑定价格/时间轴。
- **笔记就是可打 tag 的文本框 annotation**：没有独立的 entry / marker note 字段。
- **没有特殊标注类型**：任意 annotation 都可带 group 下的 tag；"setup 高亮"只是"被 tag 的 annotation 在浏览该 tag 时高亮"的一个实例，必须 general 化，不特判。
- **高亮 = 对带该 tag 的 annotation 短暂高亮**（不缩放视口、不持久淡化），在 render 期计算，不落库。
- **tag 可贴在 Entry 或 annotation 两个层级**；annotation 级决定高亮目标。
- **annotation 支持互相 link**，用于跨图对比。
- **结果 = annotation 上可选的 typed `result`**：多维、每维 string 或 number、维度用户预定义；**只用于统计、不进浏览导航**，与 tag 是两套东西，绝不做成 `outcome` group、也绝不融进某个 tag 值。
- **绝不复制 artifact 来满足某个视图**：视图 = 查询 + 渲染模式。
- **app 提供机制，不预置目录**：group、group 内的 tag 值、可复用图章一律由用户自定义/自己设计，系统不内置一套预先设计好的默认集；`date` 是唯一结构性 group。文档里出现的任何具体名字都只是示例。

## 8. MVP 范围

1. Ingest：粘贴/导入一张截图，创建一个 Entry。
2. Canvas 标注：基础绘图原语（线、框、箭头、水平线、文字、自由手绘）+ PPT 级样式（描边/填充/透明度）；**用户自建的可复用图章库**（自己设计并保存组件，系统不预置固定几个）。
3. 给任意 annotation（框 / 文本框 / …）打 group 下的 tag、并可给它设一个可选的 typed `result`（多维、每维 string 或 number、维度用户预定义）；笔记就是文本框 annotation；annotation 可互相 link。
4. Entry 级 group 标签（贴整张图；`date` 为结构性 group）。
5. Tag & query 引擎：布尔组合查询、每个 tag 的自动计数、保存为视图。
6. 按 group/tag 浏览的 UI：左侧 group→tag→缩略图两层可折叠导航（缩略图竖排，像 PPT），右侧完整大图；打开时对带该 tag 的 annotation 短暂高亮。
7. 统计：先用分类 tag 的布尔组合切片，再对命中 annotation 的 `result` 维度做聚合——string 维度给计数 / 占比，number 维度给均值与阈值命中率；例：某 `setup`（可再叠加其他 tag）下的 R 倍数均值与"深度回调"占比。

## 9. 非目标（Out of Scope）

- 不做实时行情、下单/经纪、回测引擎、指标平台。
- 不做通用绘图工具；只做交易复盘标注所需的子集 + 图章库。
- V1 不接可回放/实盘图表；annotation 不绑价格轴。

## 10. 技术决策

### 已定

- **UI 框架 = React**（renderer）。理由：生态与 AI 生成语料最大、桌面级组件最丰富、可靠性最高（与选 Fabric 同一逻辑）。**Fabric 画布保持命令式**——单独挂载、用 Fabric API 操作，隔离在 React reconciliation 之外；框架只管画布周围的导航 / inspector / 缩略图 / 统计。排除 Svelte / Vue / Solid（生态与语料更小、可靠性风险略高），本项目非必需。
- **画布技术 = Fabric.js**（MIT）。理由：需要 PPT 级任意描边色/填充色/透明度，Fabric 原生支持；MIT 无水印；API 老牌稳定、语料充足，AI 生成可靠。选择/变换手柄与文本编辑内置，其余编辑器功能（工具条、样式检查面板、撤销、按住 Ctrl 约束水平/垂直、把 annotation 打 tag、浏览 tag 时短暂高亮）由 AI 生成的常规代码补齐。备选 Konva（React-first / 更极致底层控制，能力相当）。排除 tldraw（自定义许可带水印、样式系统需改造才能任意配色、SDK 迭代快 AI 可靠性低）与 Excalidraw（手绘感）。
- **运行/存储形态 = Electron 薄壳 + 本地 SQLite（better-sqlite3）+ 图片文件夹**。web UI（Fabric）不变，外面套 Electron（纯 JS/TS、无 Rust；Obsidian/VS Code 同款），拿到原生文件系统与 SQLite。结构化数据（Entry / Annotation / group 标签 / annotation 的 typed result / SavedView / annotation-tag 索引 / 统计）进 SQLite，支持布尔多 group 查询，以及在 tag 切片上对 result 的聚合统计；截图作为文件存 `images/<hash>`，由 DB 按 hash 引用，**不 base64 塞进 canvas JSON**；canvas 用 Fabric `toJSON`（含 annotation 的 tag/link 自定义属性）按 Entry 存。整个数据是磁盘上一个可移植文件夹，可放进云盘备份/同步。排除 Tauri（需 Rust 工具链；官方插件之外的自定义原生逻辑要写 Rust，且 v1→v2 API 变动使 AI 生成可靠性低）。

### 后续研究（不阻塞首个实现，暂不细化方案）

- **从 PPT 迁移**：目标**不是**把幻灯片当静态截图导入，而是把用户在 PPT 里画的框、写的字、箭头等标注，用新 app 的原生组件**复刻成可编辑的 annotation**（框 / 文本框 / 箭头…、可打 tag），成为可查询、可高亮、可再编辑的元素，而不是压平的图片。这需要解析 PPT 的形状/文本/坐标并映射到 Fabric 对象与领域模型，属**高难度**工作。此处只记录诉求，方案留待后续专门研究。

## 11. 标签命名与术语

标签统一遵循 `group:value` 命名规范，见 `.github/skills/tagging-conventions/SKILL.md`。具体有哪些 group、每个 group 有哪些 tag 值，是**用户自定义的领域词表**，由用户维护，不写死在 skill 或 `src/` 里。
