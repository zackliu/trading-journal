# Trading Journal 实现计划（Implementation Plan）

状态：实现计划
读者：implementer、reviewer

## 1. 目的

这份文档把 [产品与领域简介](../trading-journal-brief-ch.md) 拆成可实现、可测试、可 review 的 coding slices。它不按源码目录排序，而**按用户可观察的能力**排序：每个 slice 完成一个完整、可演示的行为，而不是一层横切的技术设施。

每个 slice 都必须有 scenario-based test，证明**领域行为与公共契约**（查询命中、视图渲染、统计、持久化往返），而不是证明某个 Fabric 内部结构或 private helper 被调用。

技术栈已定（见 brief §10）：Electron 薄壳 + React（renderer UI）+ Fabric.js 画布 + 本地 SQLite（better-sqlite3）+ `images/` 文件夹，全部在一个可移植数据文件夹下。

## 2. 实现原则

1. 先做契约（TypeScript 类型 + SQLite schema），再做实现与 UI。UI 读写契约，不自造存储形态。
2. **Entry Store 是 durable truth，Annotation-Tag Index 是派生投影**：annotation 及其 tag 从 Entry 派生并与之同步；所有 tag 查询与统计只读 Annotation-Tag Index 与 entry tags，**绝不扫描 canvas JSON**。
3. **一份 Entry、多视图、零复制**：视图 = 查询 + 渲染模式；绝不为某个分类或视图复制 artifact。
4. **高亮是 render 期派生**：浏览某 tag 时，对带该 tag 的 annotation 做**短暂高亮**（不缩放视口、不持久淡化其余），从当前 tag 与 annotation bounds 算出，**不落库**。
5. **app 提供机制，不预置目录**：group、group 内的 tag 值、可复用图章一律由用户自定义/设计；系统不内置默认集；`date` 是唯一结构性 group。文档里的任何具体名字都只是示例。
6. **没有特殊标注类型，tag 放置分两级**：任意 annotation 都可带任意 group 的 tag；tag 贴 **Entry 级**或 **annotation 级**，annotation 级 tag 决定浏览该 tag 时高亮哪个元素；同一事实不两处存储。**一笔的结果不是 tag**：它是 annotation 上一个可选的 typed `result`（多维、每维 string 或 number、维度用户预定义），**只用于统计、不进浏览导航**，绝不做成 `outcome` group、也绝不融进 `setup` 等 tag 值。
7. **图片字节存一份**：截图按内容 hash 存 `images/<hash>`，DB/canvas 按 hash 引用，**不 base64 塞进 canvas JSON**。
8. **annotation 几何用 image 像素坐标**（V1 静态截图），不绑定价格/时间轴。
9. 标签是 `group:value`、kebab-case、稳定 id；一个分类是被查询引擎泛化匹配的 tag 值，**不是硬编码分支**。
10. **进程边界**：Electron **main** 拥有 Entry Store、Annotation-Tag Index、Tag & Query 引擎、统计、SQLite 与图片文件（durable / query 边界）；**renderer** 拥有 Fabric 画布与渲染/视图层。二者通过一套 typed IPC 契约（store/query API）通信；renderer 不直接开 SQLite 或读写文件。
11. **测试方式（两层）**：因 better-sqlite3 按 Electron ABI 编译,领域测试分两层——(a) **纯逻辑单测**:tag 解析、布尔查询构造、result 聚合数学等**无 native 依赖**的模块用 **Vitest** 在 Node 跑(首个纯逻辑模块出现时即引入,约 Slice 7/9);(b) **契约 / 持久化 scenario test**:store/query/stats API(领域 slice 1、2、4、5、6、7、9、10、11)通过 **Playwright + Electron** harness 从 renderer 调 `window.api.<op>` 断言领域行为,**不绕过契约直接读 SQLite**。骨架 slice(0)跑启动冒烟;画布/视图 slice(3、5、8)驱动 renderer 跑真实交互并断言派生结果。
12. **本计划不含**：PPT 迁移（brief §10 后续研究）、可回放/实盘图表、多端同步、云后端、经纪/回测/行情。

## 3. Slice 0：项目骨架与可运行外壳（Walking Skeleton）

目标：把整套工程骨架搭好，产出一个**能启动的空壳应用**——`npm run dev` 拉起 Electron 窗口、main 进程存活、可移植数据文件夹与空 SQLite 能创建/打开、一条 typed IPC ping 在 main↔renderer 往返成功；build / test / lint / package 工具链跑通并记进 `AGENTS.md`。本 slice **不含任何领域功能与契约**——领域契约（Entry / Annotation / Tag / Result / SavedView）与领域表从 Slice 1 起，Fabric 画布从 Slice 3 起。

**用户动作流程与直觉逻辑**：用户此刻还没有任何可操作界面——这一层对他是隐形的。但它兑现了最底层的直觉承诺：双击能秒开、关掉再开东西还在、数据就在一个文件夹里可带走。后面所有「随手记、随手存、不怕丢」的手感，都建立在这层空壳先稳稳跑起来之上。

实现范围：

- 仓库与工具链：`package.json`、TypeScript 配置、Electron 主/渲染进程构建（如 Vite + electron-builder 或等价），以及 `dev` / `build` / `test` / `lint` / `package` 脚本。
- Electron 进程边界骨架：main 进程创建 `BrowserWindow` 加载 renderer；preload 暴露**最小 typed IPC 桥**；renderer 为一个空白占位页。安全基线：开启 `contextIsolation`、关闭 `nodeIntegration`、preload 只暴露白名单 channel。
- 可移植数据文件夹引导：main 进程解析/创建数据目录，内含可打开的空 `app.sqlite`（better-sqlite3）与空 `images/`；建立 migration 运行器并跑一个 no-op 占位（真正的表从 Slice 1 起）。
- 最小 typed IPC 契约骨架：一个 `ping` / 健康检查 channel（renderer 调用 → main 应答），验证桥路可用；**不含任何 store / query API**（那些从 Slice 1 起）。
- 记录已验证命令：把跑通的 bootstrap / build / test / lint / run / package 命令记进本 slice 末尾「实现状态」段。

Scenario-based test：`scenario: the app boots to an empty shell with an open data folder`

Given：

- 一个空的数据文件夹路径（首次启动）。

Expect：

- 应用启动后出现一个 Electron 窗口，renderer 加载成功、无控制台错误。
- 数据文件夹被创建，内含可打开的空 `app.sqlite` 与空 `images/`；以同一文件夹「重启」不报错、不重建。
- renderer 发起的 `ping` 经 typed IPC 得到 main 的应答（进程桥路连通）。
- 此时不存在任何领域表 / 领域契约（它们从 Slice 1 起）。

**实现状态（已落地）**

- **Slice 0 (walking skeleton) implemented.** Runnable Electron shell: boots to a status screen, opens a portable data folder (`app.sqlite` + `images/`), and a typed `app:ping` IPC round-trips main↔renderer. Layout: `src/main` (Electron main, data folder, SQLite open + ordered migration runner), `src/preload` (contextBridge `window.api`), `src/renderer` (React shell: `main.tsx` + `App.tsx`), `src/shared/` (typed IPC + domain contracts), `tests/e2e/boot.spec.ts` (Playwright + Electron boot smoke test).
- Toolchain: **electron-vite** (separate main/preload/renderer builds) + **Vite** + **TypeScript**; renderer UI = **React** (`@vitejs/plugin-react`; a strict CSP is injected into the production build only, so dev keeps HMR/react-refresh); IPC payloads validated at the main-process boundary with **zod**; native `better-sqlite3` rebuilt for Electron's ABI via `electron-builder install-app-deps` (runs on `postinstall`); packaging via **electron-builder** (`--dir`); e2e via **@playwright/test** `_electron` (drives the real app, no browser download).
- Decided tech: renderer UI = **React** (Vite-bundled, canvas kept imperative outside React); canvas = **Fabric.js** v6 (MIT; imperative, mounted outside React); shell = **Electron** (JS/TS, no Rust); storage = local **SQLite** (better-sqlite3) for entries/annotations/tags/results/views/stats + an `images/` folder for screenshots (referenced by hash, not base64-embedded), all under one portable data folder. Migration (reproduce the user's PPT annotations — boxes, text, arrows — as native editable annotations, not flat screenshots; high-difficulty) remains deferred research (see §15 与 brief 技术决策). Group/result vocabulary (which groups/tags/result dimensions exist) is user-defined at runtime, not a project decision. Do not assume other tech until it is chosen and recorded in this note.
- Verified commands (Windows, Node 22.22, npm 10.9): bootstrap `npm install` (postinstall rebuilds better-sqlite3 for Electron); build `npm run build`; typecheck `npm run typecheck`; lint `npm run lint`; run `npm run dev`; e2e `npm test` (build + Playwright suite: boot + store + ingest + editor scenarios), or `npm run test:e2e` after a prior `npm run build`; package `npm run package` (→ `dist/win-unpacked/TradingJournal.exe`).

## 4. Slice 1：Durable Entry & Annotation-Tag Store

目标：应用能把一次「创建 Entry」请求保存成**重启后可读**的 Entry 记录与 annotation-tag 投影，数据落在一个可移植文件夹里。

**用户动作流程与直觉逻辑**：用户仍看不到界面，但这层立下一条贯穿全程的直觉铁律——**一份复盘只存一次、永不复制**。他日后会把同一张复盘图归到许多 tag 下，心里默认「这还是那一张、我没在到处复制它」；正是「Entry 是唯一真相、tag 是派生投影」的建模让这个默认永远成立。

实现范围：

- 数据模型契约：`Entry`、`Annotation`、`Tag`（`group:value`）、`ResultDimension`（用户预定义维度：id、label、type ∈ `string` | `number`）、annotation 上的可选 `Result`（`{ dimensionId → string | number }`）、`SavedView`（TypeScript 类型 + schema 校验）。
- 可移植数据文件夹：解析/创建数据目录，内含 `app.sqlite` 与 `images/`。
- SQLite schema 与 migration：`entries`、`annotations`、`entry_tags`、`annotation_tags`、`result_dimensions`、`annotation_results`、`saved_views`。
- Electron main 进程内的 Entry Store：create / load 一个 Entry（image 引用、canvas JSON blob、entry tags；canvas JSON 内含每个 annotation 的 tag 与可选 result）。
- Annotation-Tag Index：`annotations`、`annotation_tags`、`annotation_results` 表作为 Entry 内 annotation 及其 tag 与 typed result 的去规范化投影，随 Entry 写入同步（annotation id、entry id、geometry(bounds)、tag、result 维度/值、links）；result 的类型以 `result_dimensions` 为准（string / number 分列存储）。
- typed IPC 契约：renderer 通过 store API 调用 main，不直接访问 SQLite / 文件。

Scenario-based test：`scenario: creating an entry writes durable truth readable after restart`

Given：

- 数据文件夹为空，schema 已 migrate。
- 通过 store API 提交一个 create-entry 请求（image 引用 + canvas JSON + 一组 entry tags）；本 slice 用测试 harness 调 store API，真实 UI 入口从 Slice 2/3 起。

Expect：

- Entry 写入 `entries` 表，并可通过 store API 按 id 读回。
- 重开数据文件夹（模拟重启）后，同一 Entry 仍可读回，字段一致。
- canvas JSON 按原样保存，图片以引用而非 base64 存在。

Scenario-based test：`scenario: an annotation's tags and typed result are projected into the queryable annotation-tag index`

Given：

- 一个 Entry 携带两个带 tag 的 annotation（各带 geometry(bounds) 与 tag）；其中一个还带一个 typed `result`（如 R 倍数=1.0[number]、回调深度=深[string]）。

Expect：

- 两个 annotation 出现在 `annotations` 投影表，各自 entry id 指回母 Entry；其 tag 进入 `annotation_tags`；带 result 的那个其 result 维度/值进入 `annotation_results`（number 与 string 分列，类型以 `result_dimensions` 为准）。
- 可按 annotation 的 tag 查询到它们、并可读回其 result，无需读 canvas JSON。
- 更新 Entry 的 annotation / tag / result 后投影同步（新增/删除在索引里一致）。

**实现状态（已落地）**

- **Slice 1 (durable Entry & Annotation-Tag store) implemented.** SQLite migration `001` bumps `user_version` → 1 and creates `entries`, `entry_tags`, `annotations`, `annotation_tags`, `result_dimensions`, `annotation_results`, `saved_views`. Domain contracts in `src/shared/domain.ts` (Entry / Annotation / Tag / Result / ResultDimension / SavedView). Main-process store in `src/main/store/` — `entryStore` (create/update/get, transactional), `annotationIndex` (denormalized projection + `queryAnnotationsByTag`, reading the index not canvas JSON), `resultDimensions` (define/list); an annotation's optional typed `result` is stored string/number per its predefined dimension and is stats-only, never a tag. Typed `store:*` IPC exposed via preload with zod boundary validation; the renderer never opens SQLite. Tests: `tests/e2e/entry-store.spec.ts` (durable-after-restart, tag+result projection & update-sync, boundary rejection) driving `window.api` through the `tests/e2e/electronApp.ts` harness.

## 5. Slice 2：Screenshot Ingest

目标：粘贴或导入一张截图即可创建一个 Entry，图片按内容 hash 存一份。

**用户动作流程与直觉逻辑**：用户的动作就是最自然的那一下——**Ctrl+V**。他在别处截了图，回软件里一贴，一条复盘就诞生了，不必先「新建 / 命名 / 选路径」。直觉上「粘贴＝把手里的东西放进来」，所以同一张图贴两次也不该让磁盘多出一份字节（按内容 hash 去重）。这一下「贴进来就有了」是整个记录习惯的入口。

实现范围：

- Ingest：从剪贴板粘贴 / 文件导入 / 拖拽一张截图。
- 图片按内容 hash 存 `images/<hash>`；已存在则复用，不重复写。
- 创建 Entry，image 字段存 hash 引用。

Scenario-based test：`scenario: pasting a screenshot creates an entry with a hash-referenced image`

Given：

- 剪贴板里有一张图片。

Expect：

- `images/<hash>` 写入该图片字节。
- 新建 Entry 的 image 字段是该 hash 引用，不是 base64。
- Entry 能在最简 Daily 列表里被看到。

Scenario-based test：`scenario: importing the same image twice stores the bytes once`

Given：

- 同一张图片被导入两次（可属于两个不同 Entry）。

Expect：

- `images/` 下只有一个 `<hash>` 文件。
- 两个 image 引用都指向同一个 hash。

**实现状态（已落地）**

- **Slice 2 (screenshot ingest) implemented.** Paste (Ctrl+V) / drag-drop / file-pick a screenshot → bytes go to the `ingest:image-entry` IPC, which content-hashes (sha256) and writes `images/<hash>` once (dedupe by content), then creates an Entry (cover-image hash ref, opaque canvas JSON `{}`, a structural `date` tag). A privileged **`tj-image://<hash>`** protocol serves stored bytes to the renderer (no base64 in the DOM; hash validated, no path traversal); the production CSP allows `tj-image:`. Ingest owns image-asset storage (`src/main/ingest/imageStore.ts`) and Entry creation; `store:list-entries` feeds the review list. Tests: `tests/e2e/ingest.spec.ts` (a real `paste` ClipboardEvent creates an entry + thumbnail; the same image twice stores bytes once). Test files typecheck under `tsconfig.test.json` (DOM lib, for `page.evaluate` callbacks).

## 6. Slice 3：主界面外壳 & Canvas 标注层

目标：一次把**整个应用的主界面外壳**立起来——所有区域按目标布局摆好，后续 slice 才实现的功能先以**图标 / 占位**就位（不含行为）；同时实现其中真正的 **Canvas 标注**能力（在 Entry 底图上 PPT 级绘图、持久化、图章）。这层 UI（尤其外壳与占位）**预期多次视觉 / 交互迭代**——先有成品才好判断怎么改。

**用户动作流程与直觉逻辑**：用户打开软件，看到的是一个像 PPT 一样眼熟的外壳——顶部一条 Ribbon、左边是他的复盘缩略图、中间一大块白页。他点「New」或直接 Ctrl+V 贴张图，中间立刻出现一张可涂画的白页，工具栏亮起来，他就能像在 PPT 上一样框选、画箭头、写字。直觉上「这一整块白页就是我这次复盘」、「截图只是我贴上去的一张图、能随便挪」、「画完自动回到选择、鼠标一放就能拖」。这一版先把**外壳与画布手感**做成成品，后续每个 slice 只是往这套眼熟的布局里填真实行为，用户不必重新学界面。

实现范围分两部分。

**A. 主界面外壳（App Shell，一次把布局立好；除已接行为的部分外多为占位）**

- **单一 Office 式 Ribbon（无模式切换、无返回）**：顶部常驻一条 Ribbon（品牌 + 标签页 `Home / Draw / Tags / Browse / Stats`，每页内是带标题的分组命令），底部一条状态条（健康点 + dirty 标记 + zoom 控件）。命令按上下文启用 / 禁用：无复盘打开时 `Draw` 工具与删除置灰，无选中对象时删除所选 / 排列置灰，画布未脏时 Save 置灰；打开复盘自动切到 `Draw` 页。
- **三区主体，无 Daily / 编辑器两态切换**：左栏（group→tag 导航 + 复盘缩略图廊）｜中间（打开复盘时是 Canvas 编辑器，否则「开始复盘」空状态）｜右栏 Stamp 库（本 slice 为占位，Slice 5 接入）。同一外壳常驻，打开复盘即在中间渲染画布，不再有「进编辑器 / 返回」两态。
- **本 slice 已接行为的部分**：`Home`（新建 / 删除复盘）、`Draw`（全部画布工具 / 样式 / 排列 / 保存，见 B）、左栏复盘缩略图廊 + 右键「删除复盘」、状态栏 zoom 控件。
- **为后续 slice 预留的占位（图标 / 空面板 / 区域，无行为）**：右栏 = **Stamp 库**（可复用组件，Slice 5）、`Tags` 页 = entry 级 tag 与 `date`（Slice 6；词表 / 维度管理 Slice 10 后续也在此页）、左栏 group→tag 两层导航的**浏览行为**与 `Browse` 页（Slice 8）、搜索 / 布尔查询 / 保存视图入口（Slice 7）、`Stats` 页统计入口（Slice 9）。标注的 tag / result 编辑不再用常驻面板，而是 Slice 4 的**右键浮窗**。
- 这些占位是**非功能骨架**（图标、按钮、空面板、区域标题），真正行为在各自 slice 接入，不在本 slice 实现。

**B. Canvas 标注层（本 slice 真正实现的能力）**

- **画布 = 一张固定尺寸的白色“页面”（复盘面）。** 页面尺寸**与贴入的截图无关**，新建复盘默认 **2500×1600**（随 Entry 存在 `canvas_json` 的 `tjPage:{width,height}`，日后可支持改页面尺寸）。白色底色始终存在，这张页面本身就代表这个复盘。几何坐标为页面像素坐标；显示缩放（zoom）只影响显示、不影响存储。
- **缩放（zoom）与适配窗口**：页面按一个 zoom 比例显示，状态栏右下角有 `−／滑块／＋／百分比` 控件（百分比 = 当前显示像素∶页面真实像素，100% = 1:1），与 PPT 一致。默认 **fit 模式**：自动缩放让整页放进可视区；窗口变大 / 最大化时 fit 比例随之变大。用户手动缩放则切到固定比例；点百分比回到 fit。画布大于可视区时容器出现滚动条。
- **截图是页面上的图片对象（可选中 / 缩放 / 移动 / 叠放），不是背景。** 每张截图按内容 hash 存 `images/<hash>`，在 `canvas_json` 里以 `tj-image://<hash>` 作为 `src` 引用（hash 引用，**非 base64 字节**）。允许在同一页面上**叠加多张截图**（例：把复盘图撑满页面，再从别处截一张小图贴在其上）。
- **截图不决定页面尺寸**：贴入的截图只是页面上的对象。首图按“适配页面(contain，保持比例、不失真)”居中放置并置于最底；之后的截图按较小尺寸（约页面 60% 内）居中叠在上层，均可自由缩放 / 移动 / 改层级。
- **`Entry.image` = 封面 hash，仅供左栏缩略图**；空白复盘无封面（缩略图为 blank）。捕获截图或首次贴图时设为该 hash，叠加图不改封面。打开某复盘时若 `canvas_json` 无任何对象且该 Entry 有封面，则把封面按 contain 适配页面居中作为首图插入。
- 基础绘图原语：线、矩形、箭头、水平线、文字、自由手绘；PPT 级样式：描边色、填充色（含 rgba）、透明度、线宽、**实线 / 虚线 / 点线**（`strokeDashArray`）。
- **线 / 箭头按两端编辑**：线、水平线、箭头是"两点"对象（Fabric `Polyline`，箭头为额外渲染箭头的 `Polyline` 子类并注册进 classRegistry 以持久化），选中后显示**两个端点手柄**——拖端点只改那一端、拖线身整体移动；**不给它们图片式的缩放 / 旋转包围盒**。矩形等面积形状仍用包围盒手柄。端点几何随 `canvas_json` 持久化。
- **文字 = Office 式文本框**（Fabric `Textbox` 子类 `TextBoxAnnotation`，注册进 classRegistry）。逻辑对齐 Office：
  - **定宽、自动换行、自动高**：文本框有一个宽度，文字在框内自动换行、高度随内容自动增长。**按字符换行（`splitByGrapheme`）**——中文 / 日文等无空格文字、以及无空格长串都能折行，故收窄宽度**永远**能增加行数（不会因为“整行是一个词”而卡住缩不下去）。
  - **缩放＝改宽度；宽度优先、高度自适应**：**左右手柄与四角手柄都可拖，但都只改宽度**（文字重新换行），字号与边框粗细**恒定、绝不被缩放**（不像图片）。高度始终自动贴合内容——把宽度收窄到比文字还窄只会**增加行数**，**无法靠压高度来减少行数**（横向宽度优先，故无独立高度手柄；对齐 Office 的“resize-to-fit-text”）。字号只由 Text 组控件改。
  - **边框 / 填充是"框"的属性**（Stroke / Fill 控件，`boxStroke / boxStrokeWidth / boxFill / boxDash`），边框画在文字后面、粗细恒定；文本框 `padding` 与所画框对齐，使选中框线与可见边框重合。
  - **文字颜色（`fill`）与字号（`fontSize`）各有专门控件**（Text 组：文字色 + 字号下拉，像 Office）。
  - **可编辑**：放置后即进入编辑、双击可再编辑；**空文本框在退出编辑时被丢弃**（像 Office，没打字＝没建，不留痕、不脏）。
  - 框属性与文字属性都随 `canvas_json` 持久化。
- **无边框（No border）选项**：Stroke 组的“No border”把描边设为无——**仅对矩形与文本框生效**（矩形 `strokeWidth`＝0、文本框 `boxStrokeWidth`＝0）；线 / 箭头忽略它（它们本身就是描边，不能无边框）。
- 交互：选择 / 变换手柄、撤销 / 重做、按住 Ctrl 约束水平 / 竖直 / 45°；**画完任一形状 / 文字后自动切回选择(箭头)模式**（自由手绘保持画笔态以便连续画），于是鼠标移到任意对象上**始终**显示可移动(move)光标（与 PPT 一致，无需先选中一次）。
- **层级与适配**：右键画布对光标下对象弹出菜单——图片可“适配画布(Fit to page，保持比例、居中撑满、不失真)”，任意对象可“置于顶层 / 置于底层 / 删除”；功能区 Arrange 组提供相同操作。- **锁定 / 解锁**：右键任意对象可"锁定"——锁定后该对象**不能被点选 / 拖动 / 缩放 / 误删**（常用于把底图钉住，方便在其上标注），悬停显示普通光标而非移动光标；但**右键仍能命中它**，菜单相应变为"解锁"（并可继续置顶 / 置底）。锁定状态随 `canvas_json` 持久化（对象上的 `tjLocked`）。- 用户自建图章库（占位，后续实现）：把选中的一组形状保存为可复用图章；系统不预置固定图章。
- 序列化：`canvas.toJSON()`（含图片对象的 `tj-image://<hash>` src、白色页面底色）+ `tjPage`；**图片字节永不进 canvas_json，只进 `images/<hash>`**。

**验证方式**：外壳布局与占位**以人工视觉复核（截图）为准**，不写脆弱的静态断言（这层会反复改）；**Canvas 标注的领域行为**（持久化往返、贴图为对象、Ctrl 约束、画完回选择态、图章）用下面的 scenario test 断言。

Scenario-based test：`scenario: annotations persist and reload exactly on the entry`

Given：

- 一个带截图的复盘页面；用户画了框、线、文字并设了描边 / 填充 / 透明度 / 虚线。

Expect：

- 关闭并重开该 Entry，画布还原出完全一致的形状、位置、样式与叠放的截图对象。
- Entry 的 canvas JSON **不含 base64 图片字节**；截图以 `tj-image://<hash>` 引用形式存在。

Scenario-based test：`scenario: pasting a screenshot adds a movable image object referenced by hash`

Given：

- 在一个打开的复盘里粘贴 / 拖入一张截图。

Expect：

- 画布上新增一个可选中 / 缩放 / 移动的图片对象；保存后 canvas JSON 以 `tj-image://<hash>` 引用它、不含 base64 字节。
- 若是首图，则把封面 hash 写入 `Entry.image` 供左栏缩略图。

Scenario-based test：`scenario: finishing a shape returns to the select tool`

Given：

- 用户选了矩形 / 线 / 箭头工具并画完一笔。

Expect：

- 工具自动切回 select（箭头）态；此后鼠标移到任意对象上显示可移动光标。

Scenario-based test：`scenario: holding Ctrl constrains a line to horizontal or vertical`

Given：

- 用户在画线时按住 Ctrl 拖动。

Expect：

- 线被约束为水平或竖直（就近吸附），松开 Ctrl 恢复自由角度。
- 渲染是干净几何，无手绘感。

Scenario-based test：`scenario: a user-defined stamp can be saved and reused`

Given：

- 用户把一组形状保存为一个自定义图章；系统未预置任何默认图章。

Expect：

- 图章库初始为空（无内置默认集），保存后出现该用户图章。
- 插入该图章会在画布上生成对应形状，可再编辑。

**实现状态（已落地，视觉持续迭代）**

- **Slice 3 (main-interface shell + Canvas annotation layer) — implemented, iterating visually.** The renderer is a full app shell built around a **single unified Office-style Ribbon** (brand + tab strip `Home / Draw / Tags / Browse / Stats`; grouped commands with captions). There is **no separate editor mode / no Back button** — the same ribbon is always present and its commands **enable/disable by context**: `Home` always offers **New** (blank review) and a **Delete** that greys out unless a review is open; `Draw` tools/stroke/dash/fill/arrange/save grey out unless a review is open, delete-selected + arrange grey out unless an object is selected (`hasSelection`), and Save greys out unless the canvas is dirty. Opening a review auto-reveals the `Draw` tab. The three-region body is **left rail (Groups list with an always-present “All reviews” count + Reviews thumbnail gallery)**, **center (the Fabric editor when a review is open, else a “Start a review” empty state with a New action)**, and a **right rail** (placeholder — it becomes the Stamp library in Slice 5). Review thumbnails live in the **left rail** and carry a **right-click context menu** (Delete review). **The canvas is a fixed-size white “page” that *is* the review** — default **2500×1600, independent of any pasted image** (stored in `canvas_json` as `tjPage`); page-pixel geometry, shown through a **zoom** system (a `−／slider／＋／%` control at the status-bar bottom-right; default **fit-to-window** that grows with the window, like PowerPoint). **Screenshots are movable/resizable/stackable image objects on the page, not a background** — paste/drop stores bytes once (`ingest:store-image`), inserts a `FabricImage` whose `src` is `tj-image://<hash>` (hash ref, never base64 in JSON); the first image is placed **contained** (fills the page preserving aspect, no page resize) + goes to back + writes the `Entry.image` cover hash (for the thumbnail), later images come in smaller and stack on top; opening an entry whose `canvas_json` is empty but has a cover inserts that cover contained as the base image. **New** creates a blank Entry (no image, `image_hash=''` sentinel — no migration, boots at `user_version` 1) opening a blank white page; pasting with no review open captures a new Entry via `ingest:image-entry` and opens it. Editor = **Fabric.js v6** kept imperative **outside React** in `src/renderer/src/editor/canvasController.ts`: tools (select / rect / line / arrow / hline / text / freehand; **line/hline/arrow are two-point `Polyline` / registered `ArrowPoly` objects edited by draggable endpoint handles via `createPolyControls`, not image-style scale/rotate boxes; **text is an Office-style editable `Textbox` subclass (`TextBoxAnnotation`) that draws its own bordered/filled box — **width-only resize — sides *and* corners drag but only change width (font & border never scale); height auto-fits content, so narrowing below the text width just adds lines (width has priority, no height handle)**, plus a **No border** option (rect & text box only — sets stroke width 0; line/arrow ignore it), empty box discarded on exit; Stroke/Fill control the box, a separate Text ribbon group sets text colour (`fill`) + font size**), PPT styles (stroke colour + width, fill + opacity, **solid/dashed/dotted** via `strokeDashArray`, text colour + font size), undo/redo, Ctrl-constrain (H/V/45°), `hasSelection` via Fabric selection events, **auto-return to the select tool after finishing a shape/text** (so hover always shows the move cursor, PPT-style; freehand stays active), **z-order (bring-to-front / send-to-back), fit-image-to-page (contain, preserves aspect, no distortion), and lock/unlock (a `tjLocked` object is pinned — not selectable/movable/deletable but still right-clickable, hover shows a non-move cursor; the flag persists in `canvas_json`)** via a **right-click canvas context menu** (`fireRightClick`/`stopContextMenu`) and the ribbon Arrange group, plus `addImage(url)` for paste-in; a **zoom** system (fixed page + fit-to-window via `setViewport`/`ResizeObserver`, `zoomIn/zoomOut/setZoomPercent/fitToViewport`, surfaced as the status-bar zoom control). Save writes `canvas_json` (`canvas.toJSON()` incl. image objects’ `tj-image://` src + white page + `tjPage`) via `store:update-entry-canvas`; **image bytes never enter the JSON**. Later-slice features remain **placeholders** (group→tag nav, Inspector tag/result, browse/query, stats, stamps). Tests: `tests/e2e/editor.spec.ts` (canvas-JSON save round-trip; open-review-shows-editor with Draw tools enabled; New→blank white page; right-click thumbnail→Delete; paste→movable image object referenced by `tj-image://` hash in a saved JSON whose `tjPage` is a fixed 2500×1600; finishing a shape returns to the select tool; the fixed page shows a fit-to-window zoom control whose % rises on zoom-in; right-click an image → Lock, whose `tjLocked` flag persists, then the menu flips to Unlock; line & arrow save as two-point segments (arrow as `ArrowPoly`) and revive on reload; the text tool types text into a `TextBoxAnnotation` (an empty box is discarded) saved with its box props plus text `fill`/`fontSize`, and revives). Shell/canvas aesthetics verified by manual visual review (`test-results/boot.png`, `editor.png`), not brittle static assertions.

## 7. Slice 4：Annotation Tagging、Result & 编辑浮窗

目标：给画布上任意 annotation（框 / 文本框 / 箭头 …）打 group 下的 tag、并可给它设一个可选的 typed `result`，使它成为可查询、可统计、可高亮指认的元素；笔记就是可打 tag 的文本框 annotation。没有任何特殊标注类型。**编辑入口是贴着该 annotation 的右键浮窗，不是常驻面板。**

**用户动作流程与直觉逻辑**：用户在某个框 / 箭头 / 文字上**右键 →「Tags & result…」**，就地弹出一个贴着它的小浮窗，在里面给这个标注打 tag、（可选）填这次的结果、或连一条到另一张图的对比线；填好点 **Save** 收起，点到别处就当没改、自动收起。直觉上「我是在**这个元素本身**上做标记」——所以浮窗紧贴它，而不是跑到右边一个远远的常驻面板；文本框也走同一个右键入口设置，不跟「双击＝进入打字」的手感打架。

实现范围：

- 右键任意 annotation →「Tags & result…」→ **贴着该对象的浮窗**：给它加 / 删 group 下的 tag（group 与 tag 值用户自定义）。**Save 提交并收起；点浮窗外＝取消未保存改动并收起。**
- 浮窗也能给该 annotation 设 / 改 / 清可选的 `result`：从用户预定义的 result 维度里选维度并填值，值类型为 string 或 number（由维度定义决定）。result 只用于统计、不进浏览导航。
- result 维度管理：用户可预定义 result 维度（id、label、type ∈ string | number）；app 不预置维度。
- 笔记 = 文本框 annotation：其文本即笔记，本身也能打 tag（右键同一浮窗设置）；没有独立 note 字段。
- annotation 的 geometry 用 image 像素坐标；一个 Entry 可含多个带 tag 的 annotation。
- annotation links：把一个 annotation 单向关联到另一个 annotation（跨图对比）；反向「谁 link 到我」由对 links 的查询得到，不单独存反向边。
- 写入随 Entry 同步进 Annotation-Tag Index（tag 进 `annotation_tags`、result 进 `annotation_results`）。
- **不再有常驻 Inspector 右栏**——右栏让位给 Stamp 库（Slice 5）；标注的 tag / result / link 编辑一律走右键浮窗。

Scenario-based test：`scenario: any annotation can carry a group tag and become queryable`

Given：

- Entry 上有一个框和一个文本框；用户给框加 `setup:<value>`、给文本框加某个 `<structure-group>:<value>`。

Expect：

- 两个 annotation 都进入 Annotation-Tag Index，带各自 geometry(bounds) 与 tag。
- 按 `setup:<value>` 查到那个框、按 `<structure-group>:<value>` 查到那个文本框（读索引，不读 canvas JSON）。
- 二者机制完全相同——没有任何一种 annotation 类型被特判。

Scenario-based test：`scenario: an untagged annotation stays out of tag queries`

Given：

- 同一 Entry 上有一条没打 tag 的趋势线，和一个带 tag 的 annotation。

Expect：

- 只有带 tag 的 annotation 进入 tag 查询结果。
- 那条趋势线不出现在任何 tag 查询里，直到用户给它打 tag。

Scenario-based test：`scenario: an annotation links to another annotation for cross-chart comparison`

Given：

- 两个不同 Entry 各有一个 annotation；用户把 A link 到 B。

Expect：

- A 的 links 含 B 的 annotation id，从 A 可跳到 B。
- 「谁 link 到 B」通过查询 links 得到，系统不单独存储反向边。

Scenario-based test：`scenario: an annotation carries an optional typed result used only for statistics`

Given：

- 用户预定义了两个 result 维度：一个 number（如 R 倍数）、一个 string（如 回调深度）。
- 选中一个代表入场的 annotation，在**右键浮窗**里设 R 倍数=1.0、回调深度=深；另一个说明文本框不设 result。

Expect：

- 该 annotation 的 result 进入 `annotation_results`（number 与 string 分列，类型以 `result_dimensions` 为准），可读回、可供统计；未设 result 的文本框在 `annotation_results` 无行。
- result 不出现在任何 group→tag 浏览导航或浏览高亮里——它只是 annotation 上的 typed 统计属性。
- 改 / 清该 annotation 的 result 后，索引同步更新。

**实现状态（已落地，21/21 e2e 全绿）**

- **数据模型与投影 — 已落地。** 画布上任意对象（矩形 / 线 / 箭头 / 水平线 / 文本框 / 自由手绘）在创建时被打上稳定 `tjId` 与空 `tjTags`，即成为可打 tag 的 annotation；截图（`FabricImage`）不带 `tjId`，不是 annotation。`tjId / tjTags / tjResult / tjLinks` 随 `canvas_json` 持久化（`toObject` 白名单）并在重开时复活——没有任何一种 annotation 类型被特判。
- **投影进 Annotation-Tag Index**：编辑器保存路径改为 `updateEntryCanvas(id, canvasJson, annotations)`，同一事务里写 `canvas_json` 并把 `controller.extractAnnotations()`（读对象的 `tjId` + `getBoundingRect()` 页面像素 bounds + tags/result/links）投影进 `annotations / annotation_tags / annotation_results`，**不触碰 `entry_tags`**（那是 Slice 6）。tag 查询与 result 读回只走索引，不读 canvas JSON。
- **右键浮窗（`shell/TagPopover.tsx`）取代常驻 Inspector**：右键任意 annotation → 上下文菜单「Tags & result…」→ 贴着对象弹出浮窗；用**本地草稿**编辑 **Tags**（chip + kebab 校验）、**Result**（按维度 number/string，`<details>` 内可定义新维度——定义维度是全局动作、即时生效）、**Links**（Copy as link target / Link to copied / 列表带 Go 跳转 + ✕）。**Save 提交（`applyAnnotationEdits` 整体写回 + `saveCanvas` 投影）并收起；点浮窗外 / Esc 取消未保存改动并收起**。常驻 Inspector 已移除，右栏成为 Stamp 库占位（Slice 5）。
- **单向 link 跨 Entry**：浮窗「Copy as link target」把该 annotation 记入 App 级 `linkClipboard`（跨 Entry 切换保留）→ 在别处的浮窗「Link to copied」把它加入草稿 links、Save 写回 `tjLinks`；`locateAnnotation(id)` 解析所属 Entry，「Go」跳到该 Entry 并选中目标（`CanvasEditor.onLoaded` + `controller.selectAnnotationById`）。反向「谁 link 到我」由查询 links 得到，不存反向边。
- 契约 / DB 表 / 投影函数 / 边界校验（`annotationsSchema`、`result_dimensions` typed result 分列存储）在 Slice 1 已建，本 slice 是「画布 ↔ 索引 ↔ 右键浮窗」的接线。新增 `tests/e2e/annotation-popover.spec.ts` 覆盖四个 scenario（打 tag 即可查询 / 未打 tag 不入查询 / typed result 增改清 / 跨 Entry link + 跳转），连同既有 17 项共 21 项 e2e 全绿。

## 8. Slice 5：Stamp 库（可复用绘图调色板）

目标：右栏是一个**全局共享的 Stamp 库**——一块自由布局的小画布，装用户自己攒的可复用绘图印章。用户把画布上画好的标记存成 stamp，以后从右栏一拖即在复盘上落一份**连 tag 一起带来**的副本，省去「重复画 + 重复打标签」。stamp 只含绘图、不含截图。

**用户动作流程与直觉逻辑**：用户画了个满意的标记（比如一个红框配“DT”），想以后复用——他 **Ctrl+C / Ctrl+V** 复制出一个孪生体（原件留在这张复盘里），解开右栏顶部的**布局锁**，把孪生体拖进右栏，它就成了一枚印章。以后任何复盘里，他从右栏把印章往画布一拖：跟着光标的是**半透明的影子**，一落到画布就**变成实体**的一份副本，**连当初的 tag 一起带过来**，而右栏里的印章原样不动。直觉上「右栏是我的调色板，我从里面取用、取多少它都在」「往外拖是复制、（解锁后）往里拖是收纳」——所以往外绝不能把印章抠走，往里则是把我特意做好的那一份存进去。

实现范围：

- **Stamp 库 = 一份全局 canvas 文档**（自由布局，每个 stamp 是带 `tjTags` 的绘图对象；**只含绘图、不含截图**），复用现有画布 / 标注序列化；**全局共享、跨复盘**，独立于任何 Entry，存一份（新的 **Stamp store** 边界）。
- **布局锁（默认锁定）**：库顶部一个锁。锁定态只能从库往外拖副本；解锁态才能 ① 在库内自由挪动布局、② 从主画布把绘图拖入库。
- **拖出＝复制到画布**：从 stamp 拖向主画布，跟随光标的是**半透明幽灵**，落到画布那一刻生成实体——一个**新 annotation（新 `tjId`）**，**带出几何 + 样式 + tag，不带 result / links**（result 是某笔交易的结果、link 指向具体标注 id，复制它们无意义）。落下的副本即刻按其 tag 进入该复盘的索引、可被查询。**原 stamp 不动、库不变**（拖出不写库）。
- **拖入＝移动进库（仅解锁）**：把主画布上一个绘图对象搬进库——它**离开复盘、成为 stamp**（带着它当时的 tag）。配合 Ctrl+C/V 的正确用法：先复制孪生体（原件留在复盘），再把孪生体移进库。写库文档 + 写该复盘各自保存。
- **Ctrl+C / Ctrl+V ＝统一的「把剪贴板粘到页面」**：Ctrl+C 复制选中绘图到内部剪贴板；Ctrl+V 把剪贴板内容作为**页面上的对象**粘上——有内部复制的绘图就粘一份副本（略偏移）、否则系统剪贴板里的截图就粘一张图片对象（**与既有截图粘贴同一机制，不特判截图**）。
- **单个对象为单位**：不做组合 stamp（一次拖一个对象）。
- stamp 携带的 tag 就是它被拖入时带的 tag（可有可无、纯视觉印章就没 tag）；库内也可对某个 stamp 右键浮窗改它的 tag（与 Slice 4 同一浮窗）。

Scenario-based test：`scenario: dragging a stamp onto a review drops a tagged copy while the palette keeps the stamp`

Given：

- 库里有一个带 `<group>:<value>` 的 stamp；打开某复盘。

Expect：

- 从库拖到画布 → 该复盘多出一个**新 id** 的 annotation，带该 stamp 的 tag，按该 tag 可查到它、母 Entry 是当前复盘。
- 库里那个 stamp 仍在、内容不变（拖出是复制，不搬走）。

Scenario-based test：`scenario: a dropped stamp copy carries tags but not result or links`

Given：

- 库里一个 stamp 带着 tag。

Expect：

- 落到画布的副本带 tag，但 `result` 为空、`links` 为空。

Scenario-based test：`scenario: unlocking the palette lets a canvas drawing be moved in as a global stamp`

Given：

- 某复盘里有一个带 tag 的绘图；库处于锁定。

Expect：

- 锁定时无法把它拖入库；解锁后拖入 → 它从该复盘消失、成为库里一个带原 tag 的 stamp。
- 换一个复盘打开，右栏同样有这个新 stamp（库全局、不属于单一 Entry）。

Scenario-based test：`scenario: copy-paste duplicates a drawing as an independent annotation`

Given：

- 画布上选中一个绘图。

Expect：

- Ctrl+C 后 Ctrl+V → 旁边出现一份副本；两者是**各自独立**的 annotation（不同 `tjId`），原件不受影响。

**实现状态（未实现）**

- 未实现。Slice 3 外壳已把右栏留作 Stamp 库占位；本 slice 新增 **Stamp store**（全局 canvas 文档、存一份）、右栏的锁 / 自由布局 / 拖出复制（幽灵→实体）/ 拖入移动，以及画布内 Ctrl+C/Ctrl+V（与截图粘贴统一）。

## 9. Slice 6：Entry Tags

目标：Entry 能携带贴在整张图上的 group tag，外加结构性的 `date`。

**用户动作流程与直觉逻辑**：用户在 `Tags` 页给**整张复盘**贴标签（如这次的品种、大环境）——直觉上「这是关于整张图的属性，不指向某个具体标注」，跟 Slice 4 里贴在单个元素上的 tag 分得很清。`date` 永远自动在，让复盘天然按日排列，他不必手动组织时间线。

实现范围：

- Entry 级 tag 的增删改；group 与 tag 值由用户定义。
- `date` 作为结构性 group（总是存在，用于时间排序）。
- entry tags 写入 `entry_tags`，可查询。

Scenario-based test：`scenario: user-defined entry tags are stored and queryable`

Given：

- 用户在某 Entry 上新建一个 group 及 tag 值（此前系统无此 group）。

Expect：

- 该 `group:value` 存入 entry tags，可被查询命中。
- 该 group 是运行时用户创建的，不是内置集合里的。

Scenario-based test：`scenario: date is always present and orders entries chronologically`

Given：

- 多个 Entry 有不同 `date`。

Expect：

- 每个 Entry 都有 `date`。
- Daily 列表按 `date` 时间排序。

## 10. Slice 7：Tag & Query Engine

目标：用户能按任意标签组合检索 Entry / annotation，计数自动更新，并把查询保存成一个「视图」（section = 保存的查询，不是文件夹）。

**用户动作流程与直觉逻辑**：用户心里想的是「给我看所有 A 且 B 的复盘」，把几个 tag 一勾、结果实时出来；他还能把这组条件**存成一个“栏目”**，下次点开自动重跑——直觉上「栏目是一个**活的搜索**，不是我往里搬东西的文件夹」，所以永远不会有“复制一张图进某栏目”这回事。

实现范围：

- 布尔 tag 查询（AND / OR / NOT），跨 entry 级与 annotation 级标签，读 Annotation-Tag Index + entry tags。
- 每个 tag 的实时计数。
- SavedView：把一个查询存为命名视图并可重跑。

Scenario-based test：`scenario: a boolean tag query returns the matching annotations`

Given：

- 若干 annotation 带不同 group 下的 tag，若干 Entry 带不同 entry tag。

Expect：

- 查询 `<group-a>:<A> AND <group-b>:<X>` 返回同时满足的 annotation 及其母 Entry。
- 结果来自索引查询，不扫描 canvas JSON。

Scenario-based test：`scenario: an entry tagged under two tags appears in both queries with no second stored row`

Given：

- 一个 Entry 含两个 annotation，分别带 `<group>:<A>` 与 `<group>:<B>`。

Expect：

- 查询 `<group>:<A>` 与查询 `<group>:<B>` 都返回该 Entry（经各自 annotation）。
- `entries` 表里该 Entry 只有一行，没有为第二个分类复制。

Scenario-based test：`scenario: a saved view re-runs its query, it is not a folder`

Given：

- 用户把 `<group-a>:<A> AND <group-b>:<X>` 存为一个 SavedView。
- 之后新增一个满足该条件的 annotation。

Expect：

- 打开该 SavedView 时重跑查询，新命中自动出现。
- SavedView 不物理装载 artifact，只保存查询。

Scenario-based test：`scenario: tag counts update as tags change`

Given：

- 某 `<group>:<A>` 当前有 N 个命中。

Expect：

- 新增/移除一个带 `<group>:<A>` 的 annotation 后，该 tag 计数变为 N±1，无需手工维护。

## 11. Slice 8：Browse by Group / Tag

目标：在 Slice 3 外壳的 `Browse` 页 + 左栏接入两层可折叠导航（group → tag，OneNote 式）：选中 tag 后左栏缩略图廊按命中过滤，点某张缩略图即在**中间画布**渲染该 Entry，并对带该 tag 的 annotation 短暂高亮。复用外壳既有的左栏缩略图廊与中间画布，不另造两栏页。同一份 Entry 在任意 group/tag 下浏览，零复制。

**用户动作流程与直觉逻辑**：用户像用 OneNote 一样在左栏点开一个 group、点一个 tag，缩略图立刻筛成这一类；点一张就在中间看大图，且**带该 tag 的那个标注会短暂亮一下**——直觉上「我一眼就知道这张图为什么属于这个 tag」。同一张图出现在好几个 tag 下时，他很清楚这**还是那一张、没有副本**。Daily Review 不过是浏览 `date` 这个 group。

实现范围：

- 左栏 group→tag 导航接入行为：两层可折叠——第一层 group，第二层 group 内的 tag；选中 tag = 跑查询 `tag == 该 tag`（外壳已有「All reviews」入口与缩略图廊容器，本 slice 让 group→tag 选择真正驱动过滤）。
- 缩略图廊按选中 tag 过滤：命中的 Entry 竖排列出（复用 Slice 3 左栏缩略图廊，不新建列表）。
- 中间画布渲染：点某张缩略图 → 中间 Canvas 渲染该 Entry 的完整大图（复用 Slice 3 画布；右栏仍是 Stamp 库，不是第二个大图栏）。
- 短暂高亮：若该 tag 贴在某些 annotation 上，渲染时对这些 annotation 做**短暂高亮**（不缩放视口、不持久淡化其余）；entry 级 tag 只把整张图纳入，无高亮目标。
- 高亮从「当前 tag + annotation bounds」在 render 期算出，不写库。
- Daily Review = 选中 `date` 这个结构性 group 浏览、按时间排，不是独立特例。

Scenario-based test：`scenario: selecting a tag lists matching entries as thumbnails and opens one full-size`

Given：

- 若干 Entry 在某 group 下带同一个 tag。

Expect：

- 左侧导航能展开该 group 并选中该 tag。
- 缩略图廊竖排列出所有命中的 Entry。
- 点一张缩略图，中间画布渲染该 Entry 的完整大图。
- 同一个 Entry 在不同 tag 下浏览时，`entries` / `images` 没有第二份拷贝。

Scenario-based test：`scenario: opening an entry briefly highlights the annotations carrying the browsed tag`

Given：

- 浏览某 tag，命中某 Entry，其中一个 annotation 带该 tag。

Expect：

- 打开大图后，对带该 tag 的 annotation 做短暂高亮，让人一眼知道「这个元素关于这个 tag」。
- 视口不缩放、不平移；其余 annotation 不被持久淡化。
- 高亮所依据的几何来自 annotation bounds，不是另存的字段。

Scenario-based test：`scenario: highlight state is derived, not persisted`

Given：

- 浏览某 tag 打开某 Entry 触发高亮后，改浏览另一个 group，或直接重开该 Entry。

Expect：

- 不残留上一个 tag 的高亮。
- Entry 的持久化数据里不含高亮 / 浏览态字段。

Scenario-based test：`scenario: the two-level navigation collapses like OneNote`

Given：

- 左侧导航有多个 group，每个 group 内有多个 tag。

Expect：

- group 与其下的 tag 列表都可折叠 / 展开。
- 折叠态只影响导航显示，不影响查询结果。

## 12. Slice 9：Statistics

目标：用户能先用分类 tag 的布尔组合切片，再对命中 annotation 的 typed `result` 维度做聚合——string 维度给计数/占比，number 维度给均值与阈值命中率，并可按一个或多个分类 tag 分组。数据实时反映 tag 与 result。

**用户动作流程与直觉逻辑**：用户先用几个 tag 圈出一批交易，再问「这类形态我平均赚几个 R、胜率多少」，数字当场算出来——直觉上这是**对我自己手记结果的描述性统计**，不是回测、不是预测，所以 result 只在这里被聚合、绝不混进浏览导航。

实现范围：

- 从 Annotation-Tag Index 聚合：先按分类 tag 的布尔组合筛出一批 annotation，再对其 `result` 维度聚合。
- 度量：string result 维度 → 每个值的计数与占比；number result 维度 → 均值（及可选 min/max/median）与阈值命中率（如 R 倍数 ≥ 1 的占比）。
- 可选按一个或多个分类 tag（group 值）分组，得到分组 × 度量的表。
- 统计只读索引（`annotation_tags` + `annotation_results` + entry tags），不读 canvas JSON；这是对已手工记录的 result 的描述性查询，不是回测。

Scenario-based test：`scenario: results are aggregated over a tag-filtered population`

Given：

- 若干 annotation 带某分类 group 的 tag（如 setup），并带 typed result（number 维度如 R 倍数、string 维度如 回调深度）。

Expect：

- 给定一个分类 tag 切片（如 `setup:<value>`），number 维度给出均值与阈值命中率（如 R 倍数 ≥ 1 的占比），string 维度给出每个值的计数与占比。
- 数字与 Annotation-Tag Index 一致，不依赖 canvas JSON。

Scenario-based test：`scenario: grouping by a classification tag splits the result aggregates`

Given：

- annotation 分属不同 `setup` 值，各带 result。

Expect：

- 按 `setup` 分组时，每个 setup 值给出各自的 result 聚合（number 均值/命中率、string 计数/占比）。
- 与不分组的总体聚合口径一致（分组汇总回到总体）。

Scenario-based test：`scenario: editing an annotation's result updates the statistics`

Given：

- 一个 annotation 的某 number result（如 R 倍数）从 1.0 改成 2.0，或某 string result 值改变。

Expect：

- 相关聚合（均值、阈值命中率、计数/占比）随之变化，无需手工刷新。

## 13. Slice 10：词表与 result 维度管理（post-MVP）

目标：用户能管理自己定义的**分类词表**（group 与其 tag 值）和 **result 维度**随时间的演化——重命名、合并、删除,且已有引用一致更新。不在 brief §8 MVP 内(post-MVP 硬化)。

**用户动作流程与直觉逻辑**：用了一阵后，用户想「把这两个其实是一回事的 tag 合并」「给这个 group 改个名」——改完所有旧引用自动跟着更新、计数守恒。直觉上「我在整理我的**词汇表**，不是逐张去改图」。

实现范围：

- 列出所有 group 及其 tag 值、所有 result 维度（id、label、type），各带使用计数（读 Annotation-Tag Index / entry tags / annotation_results）。
- 改显示名：稳定 id 不变时只改 label；改 id 则批量迁移全部引用。
- 合并两个 tag 值（把 A 的引用并入 B 并删除 A）；合并 / 删除 result 维度同理。
- 删除 group / tag 值 / result 维度：显式（带确认）级联从 `entry_tags` / `annotation_tags` / `annotation_results` 移除引用,不留悬挂引用。
- 全部经 store API,索引、计数、统计随之一致。

Scenario-based test：`scenario: renaming a tag value updates every reference and its query`

Given：

- 若干 annotation / entry 带 `<group>:<old>`。

Expect：

- 重命名为 `<group>:<new>` 后,旧值查询为空、新值查询命中全部原对象,计数守恒,`entries` 无复制。

Scenario-based test：`scenario: merging two tag values consolidates references`

Given：

- `<group>:<a>` 命中 m 个、`<group>:<b>` 命中 n 个（对象可能重叠）。

Expect：

- 合并 a→b 后,`<group>:<b>` 命中去重并集,`<group>:<a>` 消失,计数正确。

Scenario-based test：`scenario: deleting a result dimension removes it from statistics`

Given：

- 一个 number result 维度被若干 annotation 使用。

Expect：

- 删除后 `annotation_results` 无该维度行,统计不再列出它,其它维度不受影响。

## 14. Slice 11：编辑与生命周期（post-MVP）

目标：在 Slice 3 已实现的「删除复盘」（左栏右键缩略图 → 删 `entries` 行 + DB 外键 `ON DELETE CASCADE` 自动清 tag / annotation / result 投影）之上，补齐它未覆盖的两件事——**图片按引用计数回收**，以及**改 / 删单个 annotation 的 tag 与 result**；系统保持索引、统计与图片资产一致。不在 brief §8 MVP 内。

**用户动作流程与直觉逻辑**：用户删掉一张复盘、或改掉某个标注的结果，系统悄悄保持一致——共享底图不会被误删、统计跟着变。直觉上「删就删干净、改就到处都对」，他不必操心底层残留。

实现范围：

- **图片引用计数 GC**：删除 Entry 时，`images/<hash>` 仅当无其它 Entry 再引用该 hash 时才回收，避免误删共享底图（当前 Slice 3 的删除只清 DB 行，不回收孤儿图片字节）。
- 编辑 annotation：改 / 删其 tag、改 / 清其 result,投影与计数、统计同步（打 tag / 设 result 的新增在 Slice 4,此处补删除与批量）。
- 删除单个 annotation：从画布与索引一并移除;指向它的 link 反向查询相应失效。
- 全程经 store API,不直接改 canvas JSON 做查询 / 统计。

Scenario-based test：`scenario: a shared image is kept until its last entry is gone`

Given：

- 两个 Entry 引用同一 `images/<hash>`。

Expect：

- 删除其一后该 hash 文件仍在；删除最后一个引用者后才回收。

Scenario-based test：`scenario: clearing an annotation's result updates statistics`

Given：

- 一个 annotation 带一个 number result。

Expect：

- 清除后相关统计聚合随之变化,该 annotation 仍存在（只是不再带 result）。

## 15. Slice 依赖顺序与完成定义

- Slice 0 无前置依赖，是其余所有 slice 的运行前提（工具链 + 可运行外壳 + 进程边界）。
- 主干：Slice 0 → 1 → 2 → 3 → 4（骨架 → 存储契约 → 导入 → 画布 + 主界面外壳 → 给 annotation 打 tag 与 result）。
- **主界面外壳在 Slice 3 一次立好**（Ribbon `Home / Draw / Tags / Browse / Stats` + 三区布局）：`Home`/`Draw`/画布 / 左栏缩略图 + 右键删除已接行为，其余为占位。后续 slice 把功能**填进外壳预留的占位或就地入口**，不另造界面：Slice 4 = 标注的**右键浮窗**（tag / result；不再是常驻 Inspector）、Slice 5 = **右栏 Stamp 库**、Slice 6 填 `Tags` 页（entry tag + `date`）、Slice 7 填查询 / 保存视图入口、Slice 8 填左栏 group→tag 导航浏览行为 + `Browse` 页、Slice 9 填 `Stats` 页。
- Slice 4 依赖 1/3（Entry 存储 + 画布标注）；Slice 5 依赖 3/4（画布 + 带 tag 的标注数据）；Slice 6 依赖 1（entry tag）；Slice 7 依赖 4/6（跨 annotation 级与 entry 级标签查询）；Slice 8 依赖 4/7（浏览＝查询 + 渲染 + 高亮）；Slice 9 依赖 4/7（对 tag 切片 + 对 result 统计）。
- **post-MVP**（不在 brief §8 MVP）：Slice 10（词表 / 维度管理，UI 落在 `Tags` 页）依赖 4/6/7/9（有 tag、result 与查询、统计后才谈演化）；Slice 11（生命周期）依赖 1/4——**删除复盘本身已在 Slice 3 落地**，Slice 11 只补图片引用计数 GC 与 annotation 级改 / 删。
- 项目级未决项见 §16「待定决策」（UI 框架、PPT 迁移范围）；领域测试策略已在原则 #11 定为两层。
- 每个 slice 的完成定义：其 scenario test 全绿 + 该 slice 的用户可观察能力可演示 + 未引入违规（扫描 canvas JSON 做查询/统计、复制 artifact 满足视图、把高亮/浏览态落库、内置默认词表/图章、把某种 annotation 特判成特殊标注类型、把 result 做成可浏览的 tag/group 或塞进浏览导航）。
- 每完成一个 slice，把该 slice 的落地状态与已验证命令记进它自己的「实现状态」段，不写进 `AGENTS.md`。

## 16. 待定决策（项目级，未收敛）

以下选择尚未拍板,但会影响后续 slice。按 product-spec-writing 约定集中放这里,不散落进设计正文。UI 框架已定为 **React**（见 brief §10 与 §1，已在 Slice 0 落地并验证），领域测试策略已定为两层（见原则 #11）;余下未决:

- **PPT 存量迁移是否属于目标**——brief §10 现列为「后续研究、高难度」。要把历史 PPT 复盘搬进来成可编辑 annotation 则需专门立项；否则明确「只面向新复盘」。此项不定,不影响其余 slice 的推进。
