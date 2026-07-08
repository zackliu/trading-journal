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
11. **测试方式（两层）**：因 better-sqlite3 按 Electron ABI 编译,领域测试分两层——(a) **纯逻辑单测**:tag 解析、布尔查询构造、result 聚合数学等**无 native 依赖**的模块用 **Vitest** 在 Node 跑(首个纯逻辑模块出现时即引入,约 Slice 7/8);(b) **契约 / 持久化 scenario test**:store/query/stats API(领域 slice 1、2、4、5、6、7、8、9、10)通过 **Playwright + Electron** harness 从 renderer 调 `window.api.<op>` 断言领域行为,**不绕过契约直接读 SQLite**。骨架 slice(0)跑启动冒烟;画布/视图 slice(3、5、6)驱动 renderer 跑真实交互并断言派生结果。
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
- Decided tech: renderer UI = **React** (Vite-bundled, canvas kept imperative outside React); canvas = **Fabric.js** v6 (MIT; imperative, mounted outside React); shell = **Electron** (JS/TS, no Rust); storage = local **SQLite** (better-sqlite3) for entries/annotations/tags/results/views/stats + an `images/` folder for screenshots (referenced by hash, not base64-embedded), all under one portable data folder. Migration (reproduce the user's PPT annotations — boxes, text, arrows — as native editable annotations, not flat screenshots; high-difficulty) remains deferred research (see §14 与 brief 技术决策). Group/result vocabulary (which groups/tags/result dimensions exist) is user-defined at runtime, not a project decision. Do not assume other tech until it is chosen and recorded in this note.
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

- **单一 Office 式 Ribbon（无模式切换、无返回）**：顶部常驻一条 Ribbon（品牌 + 标签页 `Home / Draw / Tags / Browse / Stats`，每页内是带标题的分组命令），底部一条状态条（健康点 + 保存态「Saving… / All changes saved」 + zoom 控件）。命令按上下文启用 / 禁用：无复盘打开时 `Draw` 工具与删除置灰，无选中对象时删除所选 / 排列置灰；打开复盘自动切到 `Draw` 页。**编辑即自动保存**，故无「未保存」门控；手动 Save 按钮在 `Home` 页、全局 Ctrl+S 为习惯性「立即保存」（见 §8）。
- **主体左栏 + 中间画布，无 Daily / 编辑器两态切换**：左栏（group→tag 导航 + 复盘缩略图廊）｜中间（打开复盘时是 Canvas 编辑器，否则「开始复盘」空状态）。同一外壳常驻，打开复盘即在中间渲染画布，不再有「进编辑器 / 返回」两态。**Stamp 印章条不是独立右栏——自 Slice 5 起它并入中间这张画布**（复盘页右侧、一条细分隔线、共享同一缩放，见 §8）。
- **本 slice 已接行为的部分**：`Home`（新建 / 保存 / 删除复盘）、`Draw`（画布工具 / 样式 / 排列，见 B）、左栏复盘缩略图廊 + 右键「删除复盘」、状态栏 zoom 控件。
- **为后续 slice 预留的占位（图标 / 空面板 / 区域，无行为）**：**Stamp 印章条**（可复用组件，Slice 5 起并入中间画布右侧）、`Tags` 页（Slice 6 起改为 `Review` 页 = entry 级 tag + 快捷选择）、`Home` 的 Settings 词表窗口与选中标注才出现的 `Annotation` 上下文页（Slice 6；词表演化 Slice 9）、左栏按单一 group 维度 pivot 分桶的**浏览行为**与 `Browse` 页（Slice 6）、搜索 / 布尔查询 / 保存视图入口（Slice 7）、`Stats` 页统计入口（Slice 8）。标注的 tag 编辑自 Slice 6 起走 `Annotation` 上下文页，result / link 走 Slice 4 的右键浮窗。
- 这些占位是**非功能骨架**（图标、按钮、空面板、区域标题），真正行为在各自 slice 接入，不在本 slice 实现。

**B. Canvas 标注层（本 slice 真正实现的能力）**

- **画布 = 一张固定尺寸的白色“页面”（复盘面）。** 页面尺寸**与贴入的截图无关**，新建复盘默认 **2900×1600**（随 Entry 存在 `canvas_json` 的 `tjPage:{width,height}`，日后可支持改页面尺寸）。白色底色始终存在，这张页面本身就代表这个复盘。几何坐标为页面像素坐标；显示缩放（zoom）只影响显示、不影响存储。
- **标题带 + 常规工作区（画布总尺寸不变）**：页面顶部切出一条约 **100px 的标题带** `[0,0,pageW,TITLE_H]`（一层极淡暖色底 + 底部发丝线，属 `tjChrome`——渲染、进缩略图、**不序列化、不算标注**）；下方 `[TITLE_H,pageH]` 是常规工作区（故比原来稍矮）。每个复盘恒有**一个标题文本框**（`tjRole:'title'`，横在带内、大字深墨、可自由编辑）：进 `canvas_json` 与缩略图，但**无 `tjId` 故绝不进标注索引**、**空时不被「空文本框自动丢弃」删掉**（显示淡灰占位 `点击添加标题`，打字即消失、不存为内容）、**不可单独删除**（`loadEntry` 若缺失即补一个，保证恒有）。**默认落点在常规区**：`fitActiveToCanvas`、首图 contain、新粘贴/截图都居中于 `[TITLE_H,pageH]`；但**手动画到标题带里不拦**（其它对象不做位置限制）。左栏不显示标题文字（空就空着），缩略图仍是整页快照、比例不变。
- **缩放（zoom）与适配窗口**：页面按一个 zoom 比例显示，状态栏右下角有 `−／滑块／＋／百分比` 控件（百分比 = 当前显示像素∶页面真实像素，100% = 1:1），与 PPT 一致。默认 **fit 模式**：自动缩放让整页放进可视区；窗口变大 / 最大化时 fit 比例随之变大。用户手动缩放则切到固定比例；点百分比回到 fit。画布大于可视区时容器出现滚动条。
- **截图是页面上的图片对象（可选中 / 缩放 / 移动 / 叠放），不是背景。** 每张截图按内容 hash 存 `images/<hash>`，在 `canvas_json` 里以 `tj-image://<hash>` 作为 `src` 引用（hash 引用，**非 base64 字节**）。允许在同一页面上**叠加多张截图**（例：把复盘图撑满页面，再从别处截一张小图贴在其上）。
- **截图不决定页面尺寸**：贴入的截图只是页面上的对象。首图按“适配页面(contain，保持比例、不失真)”居中放置并置于最底；之后的截图按较小尺寸（约页面 60% 内）居中叠在上层，均可自由缩放 / 移动 / 改层级。
- **左栏缩略图 = 页面渲染快照**（`renderThumbnail()` 视口无关地把整页截成 JPEG，随每次自动保存刷新，故反映所有绘制与叠图，见 §8）。空白复盘的缩略图就是一张白页（不特殊处理、不显示 “blank”）。**`Entry.image` 退化为封面 hash 兜底**：仅在页面尚未渲染出快照前（如粘贴导入但未编辑的复盘）供缩略图回退，并在打开某复盘且 `canvas_json` 无任何对象时把封面按 contain 适配页面居中作为首图插入（ingest 种子）。捕获截图或首次贴图时设为该 hash，叠加图不改封面。
- 基础绘图原语：线、矩形、箭头、水平线、文字、自由手绘；PPT 级样式：描边色、填充色（含 rgba）、透明度、线宽、**实线 / 虚线 / 点线**（`strokeDashArray`）。
- **线 / 箭头按两端编辑**：线、水平线、箭头是"两点"对象（Fabric `Polyline`，箭头为额外渲染箭头的 `Polyline` 子类并注册进 classRegistry 以持久化），选中后显示**两个端点手柄**——拖端点只改那一端、拖线身整体移动；**不给它们图片式的缩放 / 旋转包围盒**。矩形等面积形状仍用包围盒手柄，**四角自由拉伸**（各角独立改宽 / 高、按住 Shift 才等比；手柄为 Office 式小白点、细而清晰，小图上也好用）。端点几何随 `canvas_json` 持久化。
- **文字 = Office 式文本框**（Fabric `Textbox` 子类 `TextBoxAnnotation`，注册进 classRegistry）。逻辑对齐 Office：
  - **定宽、自动换行、自动高**：文本框有一个宽度，文字在框内自动换行、高度随内容自动增长。**按字符换行（`splitByGrapheme`）**——中文 / 日文等无空格文字、以及无空格长串都能折行，故收窄宽度**永远**能增加行数（不会因为“整行是一个词”而卡住缩不下去）。
  - **缩放＝改宽度；宽度优先、高度自适应**：**左右手柄与四角手柄都可拖，但都只改宽度**（文字重新换行），字号与边框粗细**恒定、绝不被缩放**（不像图片）。高度始终自动贴合内容——把宽度收窄到比文字还窄只会**增加行数**，**无法靠压高度来减少行数**（横向宽度优先，故无独立高度手柄；对齐 Office 的“resize-to-fit-text”）。字号只由 Text 组控件改。
  - **边框 / 填充是"框"的属性**（Stroke / Fill 控件，`boxStroke / boxStrokeWidth / boxFill / boxDash`），边框画在文字后面、粗细恒定；文本框 `padding` 与所画框对齐，使选中框线与可见边框重合。
  - **文字颜色（`fill`）与字号（`fontSize`）各有专门控件**（Text 组：文字色 + 字号下拉，像 Office）。
  - **可编辑**：放置后即进入编辑、双击可再编辑；**空文本框在退出编辑时被丢弃**（像 Office，没打字＝没建，不留痕、不脏）。
  - 框属性与文字属性都随 `canvas_json` 持久化。
- **无边框（No border）选项**：Stroke 组的“No border”把描边设为无——**仅对矩形与文本框生效**（矩形 `strokeWidth`＝0、文本框 `boxStrokeWidth`＝0）；线 / 箭头忽略它（它们本身就是描边，不能无边框）。
- 交互：选择 / 变换手柄、撤销 / 重做（功能区按钮 + 快捷键 **Ctrl+Z** 撤销、**Ctrl+Y / Ctrl+Shift+Z** 重做；在输入框内则让位给原生撤销；撤销/重做后即 `saveNow` 落盘并刷新缩略图，与页面同步）、按住 Ctrl 约束水平 / 竖直 / 45°；**画完任一形状 / 文字后自动切回选择(箭头)模式**（自由手绘保持画笔态以便连续画），于是鼠标移到任意对象上**始终**显示可移动(move)光标（与 PPT 一致，无需先选中一次）。
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
- 若是首图，则把封面 hash 写入 `Entry.image`（缩略图渲染前的兜底 / ingest 种子；左栏缩略图本身是页面渲染快照，见 §8）。

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

- **Slice 3 (main-interface shell + Canvas annotation layer) — implemented, iterating visually.** The renderer is a full app shell built around a **single unified Office-style Ribbon** (brand + tab strip `Home / Draw / Tags / Browse / Stats`; grouped commands with captions). There is **no separate editor mode / no Back button** — the same ribbon is always present and its commands **enable/disable by context**: `Home` always offers **New** (blank review) and a **Delete** that greys out unless a review is open; `Draw` tools/stroke/dash/fill/arrange grey out unless a review is open, delete-selected + arrange grey out unless an object is selected (`hasSelection`). Editing **auto-saves** (see §8), so there is no dirty gate — the manual Save button lives on the `Home` tab (New / Save / Delete) plus a global Ctrl+S. Opening a review auto-reveals the `Draw` tab. The three-region body is **left rail (Groups list with an always-present “All reviews” count + Reviews thumbnail gallery)**, **center (the Fabric editor when a review is open, else a “Start a review” empty state with a New action)**, and **no right rail** — the Stamp library merged into the center canvas as a right-hand strip in Slice 5 (see §8). Review thumbnails live in the **left rail** and carry a **right-click context menu** (Delete review). **The canvas is a fixed-size white “page” that *is* the review** — default **2500×1600, independent of any pasted image** (stored in `canvas_json` as `tjPage`); page-pixel geometry, shown through a **zoom** system (a `−／slider／＋／%` control at the status-bar bottom-right; default **fit-to-window** that grows with the window, like PowerPoint). **Screenshots are movable/resizable/stackable image objects on the page, not a background** — paste/drop stores bytes once (`ingest:store-image`), inserts a `FabricImage` whose `src` is `tj-image://<hash>` (hash ref, never base64 in JSON); the first image is placed **contained** (fills the page preserving aspect, no page resize) + goes to back + writes the `Entry.image` cover hash (a fallback before the page renders a snapshot — the list thumbnail is the rendered page, see §8), later images come in smaller and stack on top; opening an entry whose `canvas_json` is empty but has a cover inserts that cover contained as the base image. **New** creates a blank Entry (no image, `image_hash=''` sentinel — no migration, boots at `user_version` 1) opening a blank white page; pasting with no review open captures a new Entry via `ingest:image-entry` and opens it. Editor = **Fabric.js v6** kept imperative **outside React** in `src/renderer/src/editor/canvasController.ts`: tools (select / rect / line / arrow / hline / text / freehand; **line/hline/arrow are two-point `Polyline` / registered `ArrowPoly` objects edited by draggable endpoint handles via `createPolyControls`, not image-style scale/rotate boxes; **text is an Office-style editable `Textbox` subclass (`TextBoxAnnotation`) that draws its own bordered/filled box — **width-only resize — sides *and* corners drag but only change width (font & border never scale); height auto-fits content, so narrowing below the text width just adds lines (width has priority, no height handle)**, plus a **No border** option (rect & text box only — sets stroke width 0; line/arrow ignore it), empty box discarded on exit; Stroke/Fill control the box, a separate Text ribbon group sets text colour (`fill`) + font size**), PPT styles (stroke colour + width, fill + opacity, **solid/dashed/dotted** via `strokeDashArray`, text colour + font size), undo/redo, Ctrl-constrain (H/V/45°), `hasSelection` via Fabric selection events, **auto-return to the select tool after finishing a shape/text** (so hover always shows the move cursor, PPT-style; freehand stays active), **z-order (bring-to-front / send-to-back), fit-image-to-page (contain, preserves aspect, no distortion), and lock/unlock (a `tjLocked` object is pinned — not selectable/movable/deletable but still right-clickable, hover shows a non-move cursor; the flag persists in `canvas_json`)** via a **right-click canvas context menu** (`fireRightClick`/`stopContextMenu`) and the ribbon Arrange group, plus `addImage(url)` for paste-in; a **zoom** system (fixed page + fit-to-window via `setViewport`/`ResizeObserver`, `zoomIn/zoomOut/setZoomPercent/fitToViewport`, surfaced as the status-bar zoom control). Save writes `canvas_json` (`canvas.toJSON()` incl. image objects’ `tj-image://` src + white page + `tjPage`) via `store:update-entry-canvas`; **image bytes never enter the JSON**. Later-slice features remain **placeholders** (group→tag nav, Inspector tag/result, browse/query, stats, stamps). Tests: `tests/e2e/editor.spec.ts` (canvas-JSON save round-trip; open-review-shows-editor with Draw tools enabled; New→blank white page; right-click thumbnail→Delete; paste→movable image object referenced by `tj-image://` hash in a saved JSON whose `tjPage` is a fixed 2500×1600; finishing a shape returns to the select tool; the fixed page shows a fit-to-window zoom control whose % rises on zoom-in; right-click an image → Lock, whose `tjLocked` flag persists, then the menu flips to Unlock; line & arrow save as two-point segments (arrow as `ArrowPoly`) and revive on reload; the text tool types text into a `TextBoxAnnotation` (an empty box is discarded) saved with its box props plus text `fill`/`fontSize`, and revives). Shell/canvas aesthetics verified by manual visual review (`test-results/boot.png`, `editor.png`), not brittle static assertions.
- **文字 / 绘图样式修改对齐 Office（格式跟随选择 + 部分文字格式 + 粗体）**：Ribbon 的 Draw 样式控件不再是「只写的持久画笔」，而是**选中物的读数**——`onSelectionStyle` 回读单选对象的 stroke / fill / opacity 与文本框的 boxStroke / boxFill / 文字色 / 字号 / 粗体，喂给控件（`selectionStyle ?? 持久默认`）。一条统一原语按**作用范围**分派：文字级三属性（颜色 `fill` / 字号 `fontSize` / 粗体 `fontWeight`）作用于**当前字符选段**（编辑中选了一段 → `setSelectionStyles`），否则作用于**整框**（对象级 `set` + `removeStyle(该属性)` 清掉逐字符残留使其胜出）；边框 / 填充 / 透明度永远整框，天然分类、无 dirty 特判。选段靠**按下控件瞬间快照**（`snapshotTextSelection`，早于失焦——Fabric `exitEditingImpl` 会把选区塌缩）保住，`r.obj === obj` 守卫使陈旧快照无害。新增 `bold` 运行期默认与 Ribbon 粗体按钮（`onMouseDown` 快照 + `preventDefault` 保住编辑态）。逐字符 `styles` / `fontWeight` 是 Fabric Textbox 原生序列化字段，随 `canvas_json` 往返、**无 schema 变更、无迁移**。`editor.spec.ts` 加三项：粗体只作用选中字符且持久、整框粗体覆盖并清 run、格式跟随选择回读。**全套 82 项 e2e 全绿。**
- **新建与复盘间导航（Ctrl+N + 滚轮）**：全局 **Ctrl/Cmd+N** = 新建空白复盘（`window` keydown、`preventDefault`，等价 `Home → New`）。主画布滚轮先滚动 `.editor__stage` 自身滚轴；**滚到顶 / 底边界后、或页面 fit 无滚轴时**，滚轮进入左栏**上一 / 下一条**复盘（下滚 = 列表下一条、上滚 = 上一条；一次手势一步、450ms 节流；到两端即停）。React 的 `onWheel` 是 passive、不能 `preventDefault`，故在 `.editor__stage` 上挂**非 passive** native `wheel` 监听；节流戳 / 列表 / `switchTo` 走稳定 refs，使处理器恒定、不随每次编辑的 dirty 抖动而重挂。**根因修复**：`switchTo(sameId)` 现为 no-op——此前重开**已打开**的复盘会把 `controllerRef` 置空、却因 `key` 不变而不重挂 `CanvasEditor`，`onReady` 不再触发 → 缩放 / 工具失效（点左栏当前高亮缩略图即复现）。`tests/e2e/navigation.spec.ts` 三项（Ctrl+N 建空白复盘且只建一份；fit 无滚轴时滚轮上 / 下切换；缩放出竖直滚轴后**中段滚动不切换、抵达底边才切换**）兜底；全套 **37 项 e2e 全绿**。
- **Ctrl 约束对「创建」与「修改」一视同仁（消除创建期特例）**：线 / 箭头按住 Ctrl 吸附到 H / V / 45° 原先**只在初次画线时**生效（`onMove` 的 `snapTo45`）；现在**拖动已存在端点手柄时同样生效**。把 `snapTo45` 提到 `annotations.ts` 导出、由创建路径与端点控制**共用同一约束**（不再是绘制手势的特权）：`attachSegmentControls` 包裹每个 poly 端点控制的 `actionHandler`，当 `ctrlKey` 且是两点线段时，以**对侧固定端点**为锚把指针 `snapTo45` 后再交给 Fabric 原生 handler（锚点场景坐标 = `new Point(pts[a]-pathOffset).transform(calcTransformMatrix())`）。因 `reattachControls` 在 hydrate 时也调它，**旧数据的线一并享受**、且**不改类 / 不改 `canvas_json` 形态**（符合数据契约）。`editor.spec.ts` 加「Ctrl 修改端点也约束」用例（同一手柄：不按 Ctrl 自由、按 Ctrl 吸平）。**研究到的其它创建期特例**：`hline`（水平线工具）只在**创建时**强制 `y=startY`，落地后是普通两点线段（无「我是水平」标记）——现可靠新的编辑期 Ctrl 吸附临时保持水平，若要「永远水平」需在模型里加标记（属数据契约变更，未做）；矩形是**反向不对称**——创建期无 Shift 正方约束，而编辑期缩放角点靠 `uniformScaling:false` 支持 Shift 保持长宽比（未改，待定）。全套 **88 项 e2e 全绿**。
- **量度目标绘图工具 `MM`（Measured Move / 测量投影）**：三条等距水平线——基准线、量度线（一条腿）、1:1 投影线（两条腿，即「翻倍」目标）；纯**页面像素几何、不绑价格**（符合 V1 不变量，只在截图上量距离）。**两锚点驱动、一个公式覆盖四象限、无特例**：A 在基准线、B 在量度线，`dx=B.x−A.x / dy=B.y−A.y`，`宽=max(|dx|,MM_MIN_WIDTH) / 高=2|dy|`，`mmFlipX=dx<0`（决定锚点在左/右端、线向哪边延伸）、`mmFlipY=dy<0`（决定向上/向下翻倍）；三条线画在盒子的上缘/中线/下缘，投影线派生、无手柄。几何存成**普通轴对齐盒子**（`width/height/left/top` + `mmFlipX/mmFlipY`），`setMmFromAnchors` 被**创建拖拽与端点拖拽共用**，故「修改 = 创建」。**新的 Fabric 子类 `MeasuredMove extends FabricObject`**（`classRegistry` 注册、`_render` 用统一 `stroke` 画三条实线、无填充、无虚线、无逐线层次），`ensureAnnotation` 使其**天然可打标签/可查询/可高亮**（bounds=三线外接盒），走 `TJ_PROPS` 序列化 `mmFlipX/mmFlipY`（**仅 `canvas_json`、无 SQLite schema 变更、无迁移**）。两个圆手柄经 `attachMmControls`（创建时 + `reattachControls` 加载/克隆时都挂）；命中用 Office 式沿线容差带 `measuredMoveContainsPoint`（三条线任一带内即命中，不吃中间空盒），并入 canvas 的 `_pointIsInObjectSelectionArea` 覆盖与 `hitsStamp`。样式经 Ribbon 边色/线宽/透明度调（`applyStylePatch` 的通用 else 分支天然适配：非 Rect 故**不吃 fill、不吃 borderless**，正合「MM 无填充、像线」）。**丢弃是不好的（会丢东西）——MM 永不丢**：`onUp` 恒保留，裸击（无拖）也留一条 `MM_MIN_WIDTH` 宽、零高的平线（可后续拉开）。无 Ctrl（线本就水平）。Ribbon Draw 页加 `tool-mm` 按钮（三横线图标，中线略短）。`editor.spec.ts` 加两项（画 MM→三等距/方向 flag/可标签且编辑=创建改间距不增删；裸击不丢、留最小宽零高）。全套 **90 项 e2e 全绿**。

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

目标：Stamp 库是主复盘画布**同一张画布上**的一条**印章条（strip）**——复盘页在左、一条**很窄的分隔线**、右边是装用户可复用绘图印章的印章条；页与条**都是白色、共享同一缩放**。用户把画好的标记存成 stamp，以后从印章条一拖即在复盘页上落一份**连 tag 一起带来**的副本，省去「重复画 + 重复打标签」。因为页与条同处一张画布、同一缩放，拖入 / 拖出**尺寸一致、拖动连续不消失**。stamp 只含绘图、不含截图。

**用户动作流程与直觉逻辑**：用户画了个满意的标记（比如一个红框配“DT”），想以后复用——他解开顶部的**调色板锁**，把它拖过那条分隔线进印章条，它就地**变成一枚 stamp**。以后任何复盘里（默认锁定），他在印章上按下往复盘页一拖：跟着光标滑过分隔线的是**一份半透明的副本**（**印章原件在条里纹丝不动**）、**尺寸不变**，一松手落到复盘页就**变成实体**、**连当初的 tag 一起带过来**。直觉上「复盘页和调色板是连在一起的一整张纸，我在同一张纸上平移取用」「**锁定**时往外拖是复制（半透明副本落地成实体、原件不动）；**解锁**时整块画布如一体，在页与条之间**自由移动**——把 stamp 拖到页就是把它**移出调色板**（不是复制）、把绘图拖进条就是收纳。」

实现范围：

- **Stamp 库 = 主画布右侧的印章条**：与复盘页同处**一张 Fabric 画布**（`page[0..pageW] ｜ gap 分隔线 ｜ strip`），**共享同一缩放**、跨区拖动**连续不裁剪**。对象归属由**位置分区**决定（中心 x 落在页区还是条区）。页与条都是白色纸面，只由一条很窄的分隔带区分。**只含绘图、不含截图**。
- **存储按区拆分**：`serializePage()` 只写页区对象 → Entry 的 `canvas_json`；`serializeStrip()` 只写条区对象 → 全局 **Stamp store**（存一份、跨复盘、独立于任何 Entry）；`serializeAll()` 供撤销 / 重做。`extractAnnotations()` 只投影**页区**标注（条区 stamp 不进 Entry 索引）。
- **调色板锁（默认锁定）**：功能区一个锁。**锁定态 = 固定库**：条里 stamp 拖到页 = **复制**（半透明幽灵→实体、原件不动、新 id）；条内挪动 / 页对象拖进条一律**弹回**（不改库、不新增）。**解锁态 = 整块画布如一体**：在页与条之间自由移动——把 stamp 拖到页 = **移出调色板**（成为该页标注、**同 id**、非复制，库相应少一枚）、把绘图拖进条 = **变成 stamp**、条内挪动 = rearrange。
- **拖出＝复制到页（半透明幽灵→实体）**：锁定态在 stamp 上按下拖动，跟随光标的是**一份半透明副本（幽灵）**——**印章原件不选中、不移动**；落到页那一刻幽灵变实体，是一个**新 annotation（新 `tjId`）**，**带几何 + 样式 + tag，不带 result / links**（result 是某笔交易的结果、link 指向具体标注 id，复制它们无意义）。落下副本即刻按其 tag 进入该复盘索引、可查。**库不变**（拖出不写库）。
- **拖入＝移动进条（仅解锁）**：把页上一个绘图拖过分隔线进条 → 它**离开复盘、成为 stamp**（带当时的 tag）；写库 + 写该复盘。因同画布同缩放，尺寸与拖动都连续一致。截图（无 `tjId`）拖进条会被弹回（截图不能当 stamp）。
- **Ctrl+C / Ctrl+V ＝统一的「把剪贴板粘到页面」**：Ctrl+C 复制选中绘图到内部剪贴板；Ctrl+V 把剪贴板内容作为**页面上的对象**粘上——有内部复制的绘图就粘一份副本（略偏移）、否则系统剪贴板里的截图就粘一张图片对象（**与既有截图粘贴同一机制，不特判截图**）。
- **单个对象为单位**：不做组合 stamp（一次拖一个对象）。
- stamp 携带的 tag 就是它被拖入时带的 tag（可有可无、纯视觉印章就没 tag）；条里也可对某个 stamp 右键浮窗改它的 tag（与 Slice 4 同一浮窗）。

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
- 换一个复盘打开，印章条里同样有这个新 stamp（库全局、不属于单一 Entry）。

Scenario-based test：`scenario: copy-paste duplicates a drawing as an independent annotation`

Given：

- 画布上选中一个绘图。

Expect：

- Ctrl+C 后 Ctrl+V → 旁边出现一份副本；两者是**各自独立**的 annotation（不同 `tjId`），原件不受影响。

**实现状态（已落地，25/25 e2e 全绿）**

- **Slice 5 (stamp palette) implemented as ONE continuous canvas.** 复盘页与 stamp 印章条同处一张 Fabric 画布：`page[0..2500] ｜ gap(20, 细分隔带) ｜ strip(760)`、`sceneH = pageH`、整张背景 `#ffffff`，**共享一个缩放**（fit 覆盖整条场景）。对象归属由 `regionOf()`（中心 x ≥ `pageW + GAP/2` 即条区）判定。因同画布同缩放，**拖入 / 拖出尺寸一致、跨区拖动连续不消失**——这正是本次从「独立右栏画布（`zoom=1`，拖动会被裁剪 / 尺寸跳变）」重做为单画布的原因。
- **Stamp store（持久化边界）**：migration `002` bumps `user_version` → 2，单例 `stamp_library(id=1, canvas_json, updated_at)`；`stampStore.ts` 的 `getStampLibrary` / `saveStampLibrary` 走 typed `stamp:*` IPC（zod 校验、renderer 不开 SQLite）。全局、跨复盘、独立于任何 Entry。
- **按区拆分存储**：`CanvasController.serializePage()`→Entry 的 `canvas_json`、`serializeStrip()`→库、`serializeAll()`→undo/redo；`extractAnnotations()` 只投影页区标注。stamp 存**统一场景坐标**（pageW 固定 2500，不做偏移）。分隔带是一条柔和的**渐变光影缝**——`tjChrome` 背景对象、横向 warm-shadow 渐变、两端淡出融进两侧白页（非硬灰线），`excludeFromExport`、不入分区 / 序列化 / 标注逻辑。
- **自动保存 = 编辑即保存（PPT 直觉，无手动保存心智）**：每次提交编辑都走单一入口 `pushHistory()` → `onContentChanged`；`App.saveNow()` 一次写 Entry 页 + 库，并**本地实时刷新该条缩略图**（`setEntries`，不重拉整表）。`saveNow` 合并并发写（一次在飞、期间再来的请求收尾后补跑一次）、始终序列化最新状态，杜绝乱序丢写；切换复盘前 `await saveNow()` flush。**缩略图 = 页面渲染快照**（`renderThumbnail()` 视口无关地截 `[0..pageW]×[0..pageH]` 为 JPEG data URL，存 `entries.thumbnail`，migration `003` → `user_version` 3；`Entry.image` cover 仅作首帧渲染前的兜底）。手动 **Save 按钮在 Home 页**（`entryOpen` 即可用，非 dirty 门控）+ 全局 **Ctrl+S**（皆为习惯性「立即保存」，等价一次 flush）；状态栏被动显示「Saving… / All changes saved」。
- **调色板锁（默认锁定，功能区 `stamp-lock` 开关 → `setPaletteLocked`，切换即 `applyTool` 重算可选态）**：锁定态下条区 stamp 不可选中（但 evented、光标 `copy`），在其上按下拖动走**幽灵路径**：`startGhostDrag` 克隆一份 `tjGhost` 半透明副本跟随光标（拖拽期无框选，统一由下条 `mouse:down:before` 抑制），`finishGhostDrag` 在页区松手则 `solidifyCopy`（从**源对象**而非幽灵重建，新 `tjId`、去 result/links，即使异步幽灵未渲染也能落地）。**解锁后条区 stamp 可选中**，拖拽走 `handleDrop`（记 `dragHome` / `didMove`，mouse:up 结算）：解锁 strip→page = **移出**（同对象、同 `tjId` 落到页、离开库，因库 stamp 从不被投影故不会撞 id）；解锁 page→strip(绘图) = 变 stamp；解锁 strip→strip = rearrange；锁定 page→strip / 截图→strip = 弹回。任何编辑（页或条区）经 `onContentChanged` 自动保存（同存 Entry 页 + 库）。
- **不变式：库存 stamp 永远在条区（修复重大 bug）**。`loadEntry` 加载库 stamp 时，若某 stamp 落在页区（旧分栏版本把 stamp 存在 ~0–240 的页区坐标）就**将其平移进条区**。否则这类 stamp 会（a）渲染在每个复盘的**页上**（“new 复盘主界面有东西”），（b）被多个 Entry 当作页区标注**投影**——`annotations.id` 是全局主键，于是第二个 Entry 保存时 `UNIQUE constraint failed: annotations.id`。因条区 stamp 被 `extractAnnotations` 排除，保证在条区即保证从不被投影。
- **共享标注模型** 仍在 `editor/annotations.ts`（`ArrowPoly` / `TextBoxAnnotation` 及控件挂载、`TJ_PROPS`，类只注册一次），页与条共用。Ctrl+C/V 统一「粘到页面」不变；条里 stamp 右键走 Slice 4 同一浮窗改 tag。
- **修复：Ctrl+C/V 改为「最近者胜」而非固定优先（bug ①）**。原先 Ctrl+V 总是**先**看内部绘图剪贴板、而它一旦被 Ctrl+C 写入就**永不清空**，于是本会话里复制过任意绘图后，从系统剪贴板粘一张截图会**永远被那份旧绘图遮蔽**（截图贴不进来）。改法两处、不加截图特判：Ctrl+V 先看系统剪贴板有无图片（有 → 贴截图并清掉内部剪贴板；无 → 才贴内部绘图）；Ctrl+C 从 `keydown` 改挂 `copy` 事件（与 `paste` 对称），复制绘图时用 `clipboardData.setData` **接管系统剪贴板**、清掉其中残留截图——使「系统剪贴板是否有图片」成为可靠的**最近**信号，连反向场景（先截图入系统剪贴板、再 Ctrl+C 绘图、Ctrl+V）也正确落到绘图副本。`stamp-library.spec.ts` 加一项 recency 回归：复制绘图后粘系统截图 → 页面新增一张图片对象、绘图**不**被复制。
- **修复：往文本框里粘贴 = 纯文本、随框自身样式（文字颜色 bug + 粘成图片 bug）**。两个根因：（a）Fabric 文本复制会把**源的逐字符样式**（含 `fill`）带进目标框，于是从一个 text 复制文字到另一个后，目标框的**逐字符色**盖过对象级 `fill`，功能区「文字色」控件再也调不动——设 `config.disableStyleCopyPaste = true` 全局关掉逐字符样式复制，粘贴的文字一律采用**目标框自身**的颜色/字号；`applyStylePatch` 里改文字色/字号时顺手清空 `styles`（治愈历史遗留的逐字符样式框）。（b）粘贴处理器**先看图片**，于是在文本框里粘一段「同时带图片表示」的外部文字会被贴成一张图片——改为**文本框优先**：`onPaste` 先判断当前是否有文本框在编辑（`isEditingText` → 交给 Fabric 隐藏 textarea 原生插入、绝不当图片）或被选中（`insertTextIntoActiveTextBox` 把 `text/plain` 追加进框、新字符随框样式、保留框内已有的逐字符格式），只有当目标不是文本框时才走「最近者胜」的图片/绘图分支。`editor.spec.ts` 加一项：选中文本框后粘「文字＋图片」→ 文字追加进框（`HiWorld`）、页面**不**新增图片、框无逐字符样式。
- **修复：按不可选对象不再「拉出框选」**。Fabric 的 mousedown 对**任何 evented 但不可选**的目标（钉住/锁定的绘图、锁定态条区 stamp）都会起橡皮筋框选（源码条件 `this.selection && (!target || !target.selectable …)`）——于是**按住一个锁定绘图拖动会「从中拉出一个选中框」并框走别的对象**（正是用户报的 bug）。根因修复：在 `mouse:down:before`（早于 Fabric 的框选判定）里，若按下目标不可选就 `canvas.selection = false` 抑制本次框选、`mouse:up` 复原（`selectionSuppressed` 标志）；空白处按下仍正常框选。幽灵路径的选择开关也并入此处（`startGhostDrag` / `finishGhostDrag` 不再各自 toggle `selection`）。`regression.spec.ts` 加一项：先证复现（按住锁定 A 扫过 B 再删，B 被框走删掉）再证修复（B 不被框走）。
- **修复：从条区拖出 stamp 的命中，与悬停光标统一（斜线拖出错的那根 / 横线拖出空的 老 bug）**。`stripStampUnder` 原先用**轴对齐包围盒**判定并返回 z 序最上者，而悬停光标 / 选择走 `_pointIsInObjectSelectionArea` 覆写——对 `Polyline` 是**沿描边的屏幕带**（`segmentContainsPoint`）。两套命中对「线」必然打架：斜线的对角包围盒巨大且相互重叠 → 点在虚线描边上却落进上层实线的盒子 → 拉出**错误那根**（随 z 序，故"和最初点的位置息息相关"）；横线的点集包围盒是近乎零高的薄片、而悬停带 `6/zoom + sw/2` 宽得多 → 存在「带内、盒外」死区 → **光标显示可拖却拉出空的**。根因修复：抽出共享 `hitsStamp(o, p)`——`Polyline` 用 `segmentContainsPoint`、其余用包围盒——使拖出与悬停用**同一命中模型**（"光标说能拖的，拉出的就正是那一根"）；保留"自己做几何、不依赖 Fabric target"以不回退调色板发死那条修复。斜线交叉/紧贴时按 z 序取最上一根（你确实同时贴着两根，合理）。`stamp-library.spec.ts` 加两项（均先临时回退证其能抓住 bug）：两枚包围盒重叠的斜线、按下层描边 → 拉出下层那根（非 z 序最上）；细横线、在描边带内盒外按下 → 稳定拉出。**全套 84 项 e2e 全绿。**
- **修复：编辑中的文字不再因"没先点别处"而丢失（数据安全，最高优先）**。根因三合一：Fabric 焦点离开画布**不退出编辑**（`blur()` 只停光标闪烁）、打字过程**不置 dirty**（构造器无 `text:changed`，只有退出编辑才 `onTextEditExit → pushHistory`）、而 `switchTo` 只在 `dirty` 时 `saveNow`——于是切复盘（rail 点击 / **滚轮** / New / 跳 link）或关窗 / 刷新时，刚打但未提交的文字随 `dispose` 一起被丢。修复：控制器加 `commitTextEditing()`（当前在编辑就 `exitEditing()`，走正常提交 / 空框丢弃 + 自动保存路径）与 `isDirty()`；`switchTo` **先 `commitTextEditing()`、再按控制器实时 `isDirty()` `await saveNow()`**（不再用 React 里过时的 `editorState.dirty` 闭包值）；加 `beforeunload` 兜底关窗 / 刷新（`saveNow` 的 IPC **同步派发**给主进程，故 unload 前必送达）。**刻意未用"打字防抖自动保存"**——评估发现它会引入"空框被自动保存后又清空、却在重载后复活"等隐蔽副作用；`beforeunload` 同步派发既可靠又无此副作用。`editor.spec.ts` 加两项（均经临时抽掉 `commitTextEditing` 证其能抓住 bug：切换 / 重载后 `canvasJson` 为空）：打字后 Ctrl+N 切换、上一条复盘仍有该文字；打字后 reload、文字仍在。
- **修复：删除复盘加二次确认**（破坏性且 UI 不可恢复）。右键「Delete review」/ 功能区 Delete 均改为弹 `ConfirmDialog`，Cancel / Esc / 点外 = 保留。`editor.spec.ts` 更新删除测试（先点 `confirm-ok`）并加「取消则保留」一项。**全套 87 项 e2e 全绿。**
- **布局**：独立右栏列已移除，`.body` 两列（`224px minmax(0, 1fr)`）、`.app` 加 `grid-template-columns: minmax(0, 1fr)` 防止宽画布把网格撑破视口（否则条区会被推到窗外）。`TagPopover` 视口 clamp 改为随内容变化用 `ResizeObserver` 重夹（结果维度展开时 Save 不再溢出屏幕）。
- 旧 `StampRailController` / `shell/StampRail.tsx` / DOM 幽灵拖拽编排已删除。`tests/e2e/stamp-library.spec.ts` 改为在**同一画布**内按 场景坐标 → 元素比例 定位拖拽（page ↔ strip）。
- **顺带修的 UX**：在已有复盘打开时点 `Home` → `New` 建新复盘，Ribbon 现在会随 `entryId` 变化自动切回 `Draw` 页（原先停在 `Home`，新复盘看不到画笔工具）。新增 `tests/e2e/regression.spec.ts` 用**真实操作序列**兜底两个 bug：旧页坐标 stamp 被治愈进条区且不再投影为标注、连开多份复盘反复保存不再撞 `annotations.id`、空白新复盘页为空。stamp scenario 增加「解锁后拖出 = 同 id 移出（非复制）、库清空」一项。既有 21 项 + stamp 5 项 + regression 4 项共 **30 项 e2e 全绿**。

## 9. Slice 6：Entry Tags、词表注册表与 Browse（浏览）

目标：把「给复盘 / 标注打分类标签」与「按分类浏览复盘」一次做成一个闭环——用户先在一个**词表注册表**里声明自己的 group 与 tag 值，然后在 Ribbon 上一键给**整张复盘**（`Review` 页）或**选中的标注**（`Annotation` 上下文页）打这些 tag，最后在左栏**任选一个 group 维度**把整个库分桶浏览、点开大图时带该 tag 的标注短暂高亮。一份 Entry 在任意 group / tag 下浏览，零复制。（原 Entry Tags 与 Browse 合并：二者是同一件事的写侧与读侧，拆开各自没有可演示的回报。）

**用户动作流程与直觉逻辑**：用户脑子里是「这张复盘的 day structure 是 X、品种是 NQ」——这些是**关于整张图的属性**，跟贴在某个框上的 tag 分得很清。他先在 `Home → Settings`（独立窗口）把词汇建好：group「day-structure」下若干值、group「symbol」下若干值……（系统不预置任何目录）。回到某张复盘，`Review` 页上就摆着他钉上来的几个 group 的快捷选择，点一下就打上，非常省事。当他点中画布上某个标注时，Ribbon **像 Office 一样冒出一个 `Annotation` 上下文页**（正如选中图片才出现 Shape Format），里面**同一套** group & tag 快捷选择，只是这次打给这个标注。浏览时，左栏顶部是一个**看起来就可点**的维度选择器（默认「All reviews」）：点开像下拉一样列出他建的所有 group，选一个（比如 symbol），左栏立刻按这个维度分成一段段可折叠的桶（NQ、ES……），每段里是命中的复盘缩略图；点一张在中间看大图，**带这个 tag 的标注亮 ~1.5s**——他一眼就知道「这张为什么归到 NQ」。选「All reviews」则是所有复盘按**年-月**自动分段（隐性时间结构，不是他建的 group、也不出现在 Settings 或打标签选项里），保证每张复盘一定有处可现。同一张图出现在好几个桶里时，他清楚**还是那一张、没有副本**。

实现范围：

**A. 数据模型契约（先契约、后 UI）**

- **词表注册表（新增一等公民）**：`TagGroup { id(slug), label, pinned }` ＋ `TagValue { groupId, value(slug), label? }`。group 与其值**独立于是否被用过**就存在、可声明——这是 pivot 下拉、快捷选择、Settings 三处的共同数据源。新增表 `tag_groups`、`tag_values`（migration `004`）。仍严守「app 只给机制、不预置目录」：目录全部用户建，只是从「用过才隐式存在」升级为「可预先声明」。
- **输入即自然文本，id 自动派生**：用户在 Settings 与快捷条里键入人类写法（`TRD`、`Trading Range Day`、`上升日`），系统 `slugify` 成稳定 id（小写、空格 / 标点转连字符、保留 CJK 等 unicode 字母数字）、原文存为 `label` 显示；**用户从不手打 kebab**。`group:value` 查询、计数、浏览都用 slug id；chip / 桶 / 列表都显示 label。
- **`date` 仍是结构性、系统维护的 entry tag**：**不进注册表、不进 Settings、不作为打标签选项**；「All reviews」按其年-月派生分桶。
- Tag 仍是 `group:value`、kebab；entry 级与 annotation 级共用同一套 tag 机制，唯一区别是贴在整张 Entry 还是某个 annotation 上（group 无「单值 / 多值」之分，任意对象可带任意多个 tag）。

**B. Settings 独立窗口（group & tag 增删查改 + 排序）**

- `Home` 页一个 **Settings** 按钮 → **独立的模态窗口**：列出所有 group（含 label、pinned）与各自的值，可**新增 / 删除 group、新增 / 删除值、勾「钉到快捷选择」**（pinned）。**新建值只在这里做**（Ribbon 只选不建）。
- **可拖排序**：group 与 group 内的值都渲染成带 ☰ 拖柄的行，**按住拖柄上下拖**即可改顺序（`tag_groups` / `tag_values` 的 `sort` 落库，migration `005`）；Ribbon 一律按此顺序渲染。拖动时被拖行跟随光标、其余行平滑让位（CSS transform 过渡），松手落位、写回顺序。
- 用户输入自然文本（见 A）：值 / group 名都键入人类写法，id 由 `slugify` 派生、原文存 label。
- 本 slice 只做**声明 / 删除 / 排序**；**重命名 / 合并 + 批量迁移引用**这类演化留给 Slice 9。
- 全部经 store API，renderer 不直接开 SQLite。

**C. Review 页与 Annotation 上下文页（同一套快捷标签控件）**

- **`Review` 页**（原 `Tags` 页改名）：展示并编辑**这张复盘的 entry 级 tag**——每个 pinned group 是一个**固定宽度块**（组间一条很淡的细线分隔，谁也不推谁），块内值 chip 按 Settings 顺序、**已选(applied)浮到最前**始终可见；**长名 chip 省略号 + 悬停显示全名**；**放不下的收成 `+N` 展开钮**，点开一个**每组一个、限高可滚、带搜索框**的伸缩板（覆盖画布、点外/Esc 收），列全部值(applied 置顶)、点即打 tag。**只选不建**（新建走 Settings）。
- **`Annotation` 上下文页**：**仅在选中某个 annotation 时出现**（Office contextual tab：出现即可点击，但**不抢占 `Draw`**——保持连续绘图；点该页即可给选中标注打 tag；取消选中即隐藏、Ribbon 回 `Draw`），承载**与 `Review` 页完全相同**的一套 group & tag 快捷选择，作用于选中的 annotation。二者共用同一个快捷标签控件（target = 整张 Entry 或选中 annotation），不写两套。
- **标注的 tag 编辑从右键浮窗迁到 `Annotation` 上下文页**；`Annotation` 页在 tag 快捷选择之外还**并排承载结果登记**（result 维度：`choices` 预设值单选 chips / `number` 数字框，与 tag 一个手感）；Slice 4 的右键浮窗**收敛为「Links…」**（跨图链接是标注独有、较低频，留在贴着对象的浮窗）。**结果类型（result 维度与其预设值）在 Home 的「Settings → Result」注册表里声明**，镜像 group & tags 的注册表设计（migration 006 加 `result_dimension_values`）。

**D. entry-tag 写入路径**

- 新增 store API `setEntryTags(entryId, Tag[])` ＋ typed IPC：entry tag 是 Entry 的属性、与 canvas 无关，**编辑即保存**（与自动保存同一直觉）。`updateEntryCanvas` 仍只管 canvas + 缩略图 + annotation 投影，不碰 `entry_tags`。
- annotation 级 tag 仍随 canvas 保存经 `extractAnnotations()` 投影（Slice 4 既有路径）。

**E. 左栏 pivot 浏览（取代原两层树，接入 `Browse` 页与左栏）**

- 顶部一个**维度选择器**（默认「All reviews」，外观即「可点」）：点开列出注册表里所有 group；选中即把整个库按该维度分桶。
- **选某个 group G**：按 G 的各**值**分成可折叠的**手风琴桶**；某值桶 = 在 entry 级**或** annotation 级带 `G:值` 的复盘（**并集、按 Entry 去重**），桶计数 = 去重 Entry 数；桶内竖排该批缩略图。该维度下无任何值的复盘不出现（「All reviews」保证它仍有处可现）；空桶就空着、不特殊处理。
- **选「All reviews」**：所有复盘按**年-月**分桶（从 `date` 派生），桶内按时间排。年-月是隐性时间结构，**不在 Settings、不可打标签**。
- **左栏日期排序开关**：pivot 选择器右侧一个低视觉权重的小图标按钮（`sort-toggle`，`data-dir=desc|asc`），切换复盘的日期顺序——`desc`＝由近及远（**默认**，最新在上），`asc`＝由远及近；同时作用于**年-月桶的顺序**与**每个桶内复盘的顺序**（对任意 pivot 维度的桶内排序同样生效）。`entries` 由 store 给的是最新在前，`asc` 时在 renderer 侧 `reverse()`；`yearMonthBuckets(entries, dir)` 再按 dir 排月键。会话态、不落库（默认恒为 `desc`）。
- 每个桶头部左侧有**明显直觉的折叠三角**；对桶头（或左栏）**右键**有「全部折叠 / 全部展开」。折叠态只影响显示、不影响命中。
- 点某张缩略图 → 中间画布渲染该 Entry 大图（复用现有画布；右侧仍是 Stamp 印章条）。
- 读侧 API：`listGroups()`（注册表 ＋ 每值命中计数）、`queryEntriesByTag(tag)`（并集、去重 Entry 摘要）；「All reviews」复用 `listEntries()` 在 renderer 按年-月分组。**只读索引 / entry tags，绝不扫描 canvas JSON**。

**F. 短暂高亮（render 期派生、不落库）**

- 经某个值桶点开复盘时，画布对**带该 `group:值` 的 annotation** 在其 bounds 上画一圈 **~1.5s 后淡出的光晕**；多个携带者一起亮。entry 级命中无高亮目标（只是打开）。
- 高亮几何从「当前 tag ＋ annotation bounds」在 render 期算出；切换维度 / 重开复盘不残留；持久化数据里无高亮 / 浏览态字段。

Scenario-based test：`scenario: a declared group and value are usable before any review uses them`

Given：

- 用户在 Settings 里新建 group `symbol` 及值 `nq`、`es`，此前无任何复盘用过它们。

Expect：

- `tag_groups` / `tag_values` 出现该 group 与两个值；`listGroups()` 能读回。
- pivot 维度选择器与 `Review` 页快捷选择立刻可用（无需先有复盘用过）。
- 删除未被使用的值 `es` 后它从注册表消失，其它不受影响。

Scenario-based test：`scenario: quick-picking a value on the Review tab tags the whole entry and is queryable`

Given：

- 一张打开的复盘；group `symbol` 被 pinned。

Expect：

- 在 `Review` 页点 `symbol:nq` → 该 `group:value` 经 `setEntryTags` 存入 `entry_tags`，重开后仍在。
- `queryEntriesByTag({symbol, nq})` 命中该 Entry；`entries` 只有一行。
- 再点一次 `symbol:nq` 取消 → entry tag 移除，查询不再命中。

Scenario-based test：`scenario: the Annotation contextual tab appears on selection and tags the annotation`

Given：

- 打开复盘并选中一个矩形标注。

Expect：

- Ribbon 出现 `Annotation` 上下文页（不抢占 `Draw`，点该页即可编辑）；取消选中即隐藏。
- 在其中点 `setup:h2` → 该 tag 随 canvas 保存投影进 `annotation_tags`，`queryAnnotationsByTag` 命中该标注。
- 该控件与 `Review` 页是同一套（同机制，无特殊标注类型）。

Scenario-based test：`scenario: browsing by a group lists value buckets (entry ∪ annotation) and opens one full-size with zero copies`

Given：

- 三张复盘：A 的 entry 带 `symbol:nq`，B 的某标注带 `symbol:nq`，C 带 `symbol:es`。

Expect：

- pivot 选 `symbol` → 出现 `nq` 桶（含 A、B，去重计数=2）与 `es` 桶（含 C）。
- 点 A 的缩略图 → 中间画布渲染 A 大图。
- A 同时出现在别的维度桶里时，`entries` / `images` 无第二份拷贝。

Scenario-based test：`scenario: All reviews buckets every review by year-month, and date is neither a settings group nor a tagging option`

Given：

- 多张不同 `date` 的复盘。

Expect：

- pivot 选「All reviews」→ 复盘按**年-月**分桶、新→旧、桶内按时间排；每张复盘都出现在某个年-月桶里。
- `date` / 年-月**不**出现在 Settings 的 group 列表，也**不**出现在 `Review` / `Annotation` 的打标签选项里。

Scenario-based test：`scenario: opening via a value bucket briefly highlights the carrying annotations, and the highlight is derived not persisted`

Given：

- 浏览 `setup:h2` 桶，命中某 Entry，其一个标注带 `setup:h2`。

Expect：

- 打开大图后，对带 `setup:h2` 的标注在其 bounds 画 ~1.5s 淡出光晕；视口不缩放 / 不平移；其余标注不被持久淡化。
- 切到别的维度或重开该 Entry 后不残留上一个高亮；Entry 持久化数据里无高亮 / 浏览态字段。

Scenario-based test：`scenario: buckets collapse and a right-click collapses or expands all, without changing results`

Given：

- 某 pivot 维度下有多个值桶。

Expect：

- 每个桶可折叠 / 展开；桶头左侧折叠三角明显。
- 桶头右键「全部折叠 / 全部展开」对所有桶生效。
- 折叠态只影响显示，不改变桶命中与计数。

**实现状态（已落地，47/47 e2e 全绿）**

- **Slice 6（Entry Tags、词表注册表与 Browse）已落地。** 词表注册表成为一等公民：migration `004`（`user_version` → 4）建 `tag_groups` / `tag_values`；`store/vocabulary.ts` 做 group/value 声明 / 删除 / pin 与 `listGroups`（每值带 distinct-entry 计数）；`store/tagQuery.ts` 的 `entryIdsForTag` / `countEntriesForTag` 以 `entry_tags UNION annotation_tags` 求**并集去重**。`date` 不进注册表，仍是结构性系统 entry tag。
- **写入 / 读取契约**：`entryStore.setEntryTags`（替换用户级 tag、**过滤并保留结构性 `date`**）、`entryStore.queryEntriesByTag`（并集去重的 `EntrySummary`）。新增 typed IPC `store:set-entry-tags` / `store:query-entries-by-tag` / `vocab:*`（list/define/delete group、define/delete value、set-pinned），全部 zod 边界校验、preload 白名单桥接，renderer 不开 SQLite。id 校验放宽为 unicode slug（`^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$`），配合 renderer 的 `shell/slug.ts`——用户键入 `TRD` / `上升日`，存为 slug id + 原文 label。
- **渲染层**：Ribbon `Tags` 页改为 **`Review` 页** + 选中标注才出现的 **`Annotation` 上下文页**（出现但**不抢占 `Draw`**），二者共用 `shell/QuickTag.tsx`：每个 pinned group 是**固定宽度块**（组间细线分隔、applied 浮到最前、长名省略号 + 悬停、放不下收成 **`+N` → 每组一个限高可滚带搜索的伸缩板**，浮层盖画布、点外即收；**只选不建**）；`Home` 的 **Settings** 开 `shell/SettingsDialog.tsx` 独立模态窗做词表增删 + pin + **拖排序**（`shell/SortableList.tsx` 手写指针拖拽、兄弟项平滑让位；group 与值都带 ☰ 拖柄；`sort` 落库 migration `005`；**新建值只在此**）；左栏 `shell/GroupBrowser.tsx` pivot 浏览（维度下拉 + 值桶 / 年-月手风琴 + 折叠 / 全部展开）；`canvasController.flashTagHighlight` 在 `after:render` 画 **~1.15s 柔和琥珀光晕**（device-space 分层 shadow-blur，短促 bloom 后向外溢出淡出；无硬描边、不覆盖对象内部；派生、`capturing` 挡缩略图、不落库 / 不入 history）；Slice 4 右键浮窗收敛为 **Links**（result 编辑迁至 `Annotation` 页）。
- **Ribbon 双行版式**：band 固定高（92px）、**跨所有页等高**（`tests/e2e/ribbon.spec.ts` 断言）；`Draw` 页刻意排成**双行簇**（Tools 4+3、Stroke / Fill&opacity / Text / Edit / Arrange 皆两行；组名作**底部小标题**），为将来扩容留量；`Review` / `Annotation` 的 QuickTag 直接渲染，chip **两行环绕**、组名同样落到**底部小标题**，长 chip 不半截裁切；`BrowserWindow` 设 `minWidth: 980`（band 内容 966px），保证缩窗时 `Draw` **永不横向溢出**。
- **测试**：`tests/e2e/vocab-browse.spec.ts`（11 项：注册表声明 / 删除、entry tag 存查且 `date` 不被覆盖、并集去重 + 计数 + 零复制、`Review` 一键打 tag → 进桶、Settings 自然文本 → slug id + label、**排序落库并跨重启持久**、**溢出组收成搜索伸缩板并从全表打 tag**、`Annotation` 上下文页选中即现 + 打 tag、All reviews 年-月且 `date` 不入 Settings/pivot、折叠 / 全部展开、高亮派生不落库）；`annotation-popover` 与 `stamp-library` 改为经 Ribbon 快捷控件打 tag（浮窗只留 result / link）；`tests/e2e/ribbon.spec.ts` 断言 band 跨五页**等高不变量**。**47/47 e2e 全绿**。
- 已验证命令：`npm run typecheck`、`npm run lint`、`npm run build`、`npm test`（Playwright + Electron，47 项）。

## 10. Slice 7：View 查询引擎（两维度筛选 + 保存的视图）

目标：用户能用**两个维度**（Entry 存在 + Annotation 共现）组合分类 tag 与 typed `result` 谓词，把复盘库筛成一个结果集；计数随当前筛选实时重算；并把一次组合**存成命名的「视图」**，下次点开自动重跑（section = 活的查询，不是文件夹）。

**用户动作流程与直觉逻辑**：用户想「给我看**牛市日**里、我做**成功**的 **H2 多头**」。他在视图构建器里把条件按语义分放两栏——描述**整页 / 当天**的（`day-structure:bull`）放 **Entry 维度**（整页存在即可）；描述**某一笔交易**的（`setup:h2`、`side:long`、`outcome:win`）放 **Annotation 维度**，后者必须**落在同一枚标注上**（「就是那一笔 H2 多头赢了」，而不是这页里分别有 H2、有个 win）。结果实时收窄、桶上的数随之变；满意就「存成一个栏目」。直觉上「level 不是 tag 生来带的，而是我做这个视图时决定把它当整页条件还是某一笔条件」，「同一笔」的精确性天然由 Annotation 维度的共现表达。

实现范围：

- **两维度 `ViewQuery`（typed + zod 校验，不是 DSL 字符串）**：
  - `entry: TagPredicate[]` —— **Entry 维度**：每个谓词要求该 Entry 在 `entry_tags` 里带该 group 的某个值（组内 OR、组间 AND）；整页存在即可。
  - `annotation: TagPredicate[]` + `results: ResultPredicate[]` —— **Annotation 维度**：必须存在**同一枚 annotation**，同时满足所有 annotation tag 谓词（组内 OR）与所有 result 谓词（string：等值 / 多选；number：区间 `gte` / `lte`），全部 AND 在这枚标注上。
  - `TagPredicate = { group, values[] }`；`ResultPredicate = { dimension, in?[]（string 维度）, gte? / lte?（number 维度）}`。
  - **命中** = Entry 维度在该 Entry 成立 **且** 存在一枚满足整个 Annotation 维度的 annotation；某一维度为空则不约束。
  - **level 是 view 里的选择，不是 group 的固有属性**：同一 group 可在不同视图落到 `entry` 或 `annotation` 维度。注册表与 Slice 6 打标签 UI **不变**（两级本就分别落 `entry_tags` / `annotation_tags`）。
- **`result` 进筛选（仅 Annotation 维度）**：typed 谓词；`result` 仍**不是 tag、不做 pivot 分桶维度、不驱动高亮**。
- **只读索引**：`entry_tags` / `annotation_tags` / `annotation_results`（均带 `entry_id`），不扫 canvas JSON。引擎返回**命中 Entry + 每个 Entry 里共现命中的 annotation id**（供高亮）。既有 `saved_views` 表已在 migration 001，**本 slice 不需要 migration**。
- **B1：筛选收窄 + pivot 分组 + 随上下文计数**：`ViewQuery` 收窄人群；现有 pivot 仍把幸存者按一个分类 group 分桶；每个值的计数按当前筛选**重算**（context-sensitive）。`date` 不作筛选面，仍是结构性 pivot。
- **SavedView**：把 `ViewQuery` 存进 `saved_views`（`query_json`），命名 / 列出 / 删除 / 可重跑；**只存查询、不物理装载 artifact**；出现在 pivot 选择器里与「All reviews」并列。
- **高亮**：打开某视图命中的复盘时，发光的是**共现命中的那枚 annotation**（按 id 派生，不落库 / 不入 history / 不进缩略图）。

Scenario-based test：`scenario: a view matches entry-existence AND single-annotation co-occurrence`

Given：

- 复盘 E1 的 entry 带 `day-structure:bull`，其标注 A1 带 `setup:h2` + `side:long` + result `outcome:win`，标注 A2 带 `setup:h2` 但 `outcome:loss`；复盘 E2 的 `setup:h2` 与 `outcome:win` 分处两枚不同标注。

Expect：

- `entry=[{day-structure:[bull]}], annotation=[{setup:[h2]},{side:[long]}], results=[{outcome in [win]}]` 只命中 E1，且返回的共现命中 annotation 是 A1。
- E2（H2 与 win 分处两枚标注）**不命中**。结果来自索引查询，不扫 canvas JSON。

Scenario-based test：`scenario: the same group filters at either dimension depending on the view`

Given：

- 复盘 E1 在 entry 级带 `setup:h2`；复盘 E2 只在某标注上带 `setup:h2`。

Expect：

- 把 `setup:h2` 放 **Entry 维度** → 命中 E1、不命中 E2；放 **Annotation 维度** → 命中 E2、不命中 E1（level 由视图决定，非 group 声明）。

Scenario-based test：`scenario: a number result predicate narrows within the co-occurring annotation`

Given：

- 复盘各含一枚 `setup:h2` 标注，result `r-multiple` 分别为 `2.0` 与 `-1.0`。

Expect：

- `annotation=[{setup:[h2]}], results=[{dimension: r-multiple, gte: 1}]` 只命中带 `2.0` 那枚所在的复盘。

Scenario-based test：`scenario: one entry appears under multiple views with no second stored row`

Given：

- 一张复盘的两枚标注分别带 `setup:h2` 与 `setup:wedge`。

Expect：

- `annotation=[{setup:[h2]}]` 与 `annotation=[{setup:[wedge]}]` 都命中这张复盘；`entries` 表仍只有一行，无为第二个视图复制。

Scenario-based test：`scenario: context-sensitive counts recompute under the active filter`

Given：

- 5 张复盘，其中 3 张 entry 带 `day-structure:bull`，各复盘的 `setup` 分布不一。

Expect：

- 无筛选时 pivot-by-`setup` 的桶计数是全局；加 Entry 维度 `day-structure:bull` 后，桶计数只数这 3 张牛市日复盘里的 `setup` 分布。

Scenario-based test：`scenario: a saved view re-runs its query, it is not a folder`

Given：

- 把某 `ViewQuery` 存成 SavedView；之后新增一张满足该查询的复盘 / 标注。

Expect：

- 重跑该 SavedView，新命中自动出现；`saved_views` 只存 `query_json`，不装载 artifact；删除该 SavedView 不影响任何复盘。

**实现状态（迭代 1 后端 + 迭代 2 UI 均已落地，55/55 e2e 全绿）**

- **两维度查询引擎已落地。** `shared/domain.ts` 新增 `TagPredicate` / `ResultPredicate` / `ViewQuery`（`entry` / `annotation` / `results` 三数组）/ `ViewMatch`；`store/viewQuery.ts` 的 `runViewQuery`（**Entry 维度** `entry_tags` 存在求交 ∩ **Annotation 维度**共现：所有 tag/result 谓词 `EXISTS` 在同一 `annotations.id` 上）返回命中 Entry + 共现命中 annotation id；`queryEntriesByView`（复用 `entryStore.summariesForIds`，newest-first）；`countGroupValuesUnderView`（随上下文计数：命中集 ∩ 每个注册表值的并集命中）。**level 由查询决定**（谓词放哪个数组），不在 group 上声明；注册表与 Slice 6 打标签 UI 未改。
- **SavedView 已落地。** `store/savedViewStore.ts`（create / list / get / delete，复用既有 `saved_views` 表，**无需 migration**）；`createSavedView` 存 `JSON.stringify(ViewQuery)`；重跑 = 解析 `queryJson` 再 `runViewQuery`，新命中自动出现；删除只删查询、不动任何复盘。
- **契约边界**：`store/validation.ts` 的 `viewQuerySchema`（`in` 为原文 string、`gte` / `lte` 有限 number、至少约束一项）+ `savedViewNameSchema`；typed IPC `view:run` / `view:query-entries` / `view:count-group-values` / `view:create-saved` / `view:list-saved` / `view:get-saved` / `view:delete-saved`，全 zod 边界校验、preload 白名单桥接。
- **测试**：`tests/e2e/view-query.spec.ts`（6 项：entry 存在 ∧ 单标注共现、同一 group 两维度择一、number result 阈值收窄、一 Entry 多视图零复制、随上下文计数、SavedView 活查询非文件夹）。**53/53 e2e 全绿**。
- 已验证命令：`npm run typecheck`、`npm run lint`、`npm run build`、`npm test`（Playwright + Electron，55 项）。
- **迭代 2（UI）已落地。** Ribbon `Browse` 页更名为 **`View`**（等高 band 不变；`Filter` 组「Edit filter… / Clear / 摘要」+ `Saved views` 组快速加载下拉）；`shell/ViewBuilder.tsx` 两栏模态构建器——**Entry conditions（whole review）**与 **Annotation conditions（one trade）**，各 group 下值作 `vchip` 开关，Annotation 栏含 **result 谓词**（string→`distinctResultValues` 取到的值 chips、number→min/max），底部**保存 / 加载 / 删除**视图；左栏 `GroupBrowser` 顶部 **filter bar**（entry chip 绿、annotation chip 蓝、Clear），buckets 在**筛选幸存者**上分桶、计数随上下文；打开命中复盘时 `canvasController.flashAnnotationHighlight(ids)` 高亮**共现命中的那枚标注**（沿用琥珀光晕、派生不落库）。新增只读 IPC `view:result-values`。测试 `tests/e2e/view-ui.spec.ts`（2 项：构建器收窄 + 双色 chip、SavedView 列入选择器且重跑）+ `ribbon.spec.ts` 更名断言。

## 11. Slice 8：Statistics

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

## 12. Slice 9：词表演化与 result 维度管理（post-MVP）

目标：在 Slice 6 已落地的词表注册表（声明 / 删除 group 与值、钉快捷选择）之上，让用户管理**分类词表**（group 与其 tag 值）和 **result 维度**随时间的**演化**——重命名、合并，且已有引用一致更新、计数守恒。不在 brief §8 MVP 内(post-MVP 硬化)。

**用户动作流程与直觉逻辑**：用了一阵后，用户想「把这两个其实是一回事的 tag 合并」「给这个 group 改个名」——改完所有旧引用自动跟着更新、计数守恒。直觉上「我在整理我的**词汇表**，不是逐张去改图」。

实现范围：

- 在 Slice 6 的 Settings 之上，为每个 group / 值 / result 维度显示**使用计数**（读 Annotation-Tag Index / entry tags / annotation_results），供演化操作参考。
- 改显示名：**只改显示 label，稳定 id 不变**（就地铅笔编辑）；改 id（含批量迁移全部引用）留待后续。
- 合并两个 tag 值（把 A 的引用并入 B 并删除 A）；合并 / 删除 result 维度同理。
- 删除 group / tag 值 / result 维度 = **软删除（归档）**：对**有使用**的项二次确认后置 `archived=1`（隐藏出快捷选择 / pivot / 活跃 Settings），引用（`entry_tags` / `annotation_tags` / `annotation_results`）与计数**不动**、可从 Archived 恢复；未使用的项直接归档。**不做**破坏性级联移除引用。
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

- 软删除（归档）后该维度不在活跃词表 / 统计中列出，但 `annotation_results` 行**保留**（可 Restore 复原），其它维度不受影响。

**实现状态（重命名 + 软删除 + 二次确认 + 归档永久删除已落地；合并 / 改 id 迁移未做。70/70 e2e 全绿）**

- migration `007`（`user_version` → 7）给 `tag_groups` / `tag_values` / `result_dimensions` / `result_dimension_values` 各加 `archived INTEGER NOT NULL DEFAULT 0` 列。
- **重命名 = 只改显示 label，稳定 id 不变**：`EditableName`（铅笔 → 就地输入，Enter/失焦提交、Esc 取消）复用 `defineGroup` / `defineValue` / `defineResultDimension` 的 upsert（同 id + 新 label）。因 `ON CONFLICT DO UPDATE … archived = 0`，「声明」同时**复活**同 id 的归档项（Add 重新输入即恢复）。result **值**逐字存储、其本身即 label，故不提供重命名。
- **删除 = 软删除（归档）**：`deleteGroup` / `deleteValue` / `deleteResultDimension` / `deleteResultValue` 改为 `UPDATE archived = 1`；`listGroups` / `listResultVocabulary` 过滤 `archived = 0`；`restore*` 置回 0；`listArchivedGroups` / `listArchivedResults` 列出归档项。引用与计数完全不动——归档纯粹是词表层。
- **对有使用的项二次确认**：Settings 内删除按钮在 `count > 0` 时弹 `ConfirmDialog`（"N reviews use this…"，可 Cancel / Archive），未使用项直接软删；两个 Settings 底部有可折叠 **Archived** 区，每项带 Restore。
- **归档项永久删除（“清空回收站”，仅 tag group/value）**：Archived 区每个归档 tag 行除 Restore 外还有一个垃圾桶按钮，直接 `DELETE FROM tag_groups/tag_values WHERE … AND archived = 1`（`purgeGroup` / `purgeValue`，IPC `vocab:purge-group` / `vocab:purge-value`）。**只清词表注册行、绝不级联**到 `entry_tags` / `annotation_tags`（tag 用法与注册表本就无 FK，删组仅在注册表内 FK 级联到其值声明）。**result 维度不做永久删除**：`annotation_results.dimension_id` 是 RESTRICT 外键且投影时需维度类型在册，硬删会违约/破坏重存，故 result 归档区维持 Restore-only。
- **使用计数**：`listGroups` 每值 distinct-entry 计数（Slice 6 已有）；result 现每维度 + 每值 distinct-entry 计数（`countEntriesForDimension` / `countEntriesForResultValue`，读 `annotation_results`），`ResultDimensionView` / `ResultDimensionValue` 带 `count`。
- 新增 domain 契约：`ArchivedVocab` / `ArchivedResults`（+ 其元素类型）；IPC 增 `vocab:restore-group` / `vocab:restore-value` / `vocab:list-archived` / `result:restore-dimension` / `result:restore-value` / `result:list-archived`。
- **未做（留本 slice 续做）**：改 id 的批量引用迁移、合并两个 tag 值 / result 维度。
- 验证命令：`npm run typecheck && npm run lint && npm run build && npx playwright test`。测试：重写 `result-vocab.spec.ts` 的删除断言为软删 / 归档 / 恢复 / 重命名保 id+用量；`vocab-manage.spec.ts` 覆盖重命名只改 label 保 id、未使用值静默归档 + 恢复、有使用值二次确认 + 归档 + 恢复且引用不动，以及**归档 tag 永久删除只清注册行、不级联 entry/annotation 用法**（含垃圾桶按钮 UI）。

## 13. Slice 10：编辑与生命周期（post-MVP）

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

## 14. Slice 依赖顺序与完成定义

- Slice 0 无前置依赖，是其余所有 slice 的运行前提（工具链 + 可运行外壳 + 进程边界）。
- 主干：Slice 0 → 1 → 2 → 3 → 4（骨架 → 存储契约 → 导入 → 画布 + 主界面外壳 → 给 annotation 打 tag 与 result）。
- **主界面外壳在 Slice 3 一次立好**（Ribbon `Home / Draw / Tags / Browse / Stats` + 三区布局）：`Home`/`Draw`/画布 / 左栏缩略图 + 右键删除已接行为，其余为占位。后续 slice 把功能**填进外壳预留的占位或就地入口**，不另造界面：Slice 4 = 标注的**右键浮窗**（tag / result；不再是常驻 Inspector）、Slice 5 = **右栏 Stamp 库**、Slice 6 = `Tags`→`Review` 页 entry tag + `Home` 的 Settings 词表窗口 + 选中标注的 `Annotation` 上下文页 + 左栏 pivot 浏览 + 短暂高亮（填 `Browse` 页）、Slice 7 填查询 / 保存视图入口、Slice 8 填 `Stats` 页。
- Slice 4 依赖 1/3（Entry 存储 + 画布标注）；Slice 5 依赖 3/4（画布 + 带 tag 的标注数据）；Slice 6 依赖 1/3/4（entry 存储 + 画布 + 标注 tag 机制：词表注册表 + entry/annotation 打 tag + 按维度浏览 + 高亮）；Slice 7 依赖 4/6（跨 annotation 级与 entry 级标签的布尔查询 + 保存视图）；Slice 8（统计）依赖 4/6/7（对 tag 切片 + 对 result 统计）。
- **post-MVP**（不在 brief §8 MVP）：Slice 9（词表演化：重命名 / 合并 / 迁移 + result 维度管理，UI 落在 Settings 窗口）依赖 6/7/8（先有注册表、查询、统计才谈演化）；Slice 10（生命周期）依赖 1/4——**删除复盘本身已在 Slice 3 落地**，Slice 10 只补图片引用计数 GC 与 annotation 级改 / 删。
- 项目级未决项见 §15「待定决策」（UI 框架、PPT 迁移范围）；领域测试策略已在原则 #11 定为两层。
- 每个 slice 的完成定义：其 scenario test 全绿 + 该 slice 的用户可观察能力可演示 + 未引入违规（扫描 canvas JSON 做查询/统计、复制 artifact 满足视图、把高亮/浏览态落库、内置默认词表/图章、把某种 annotation 特判成特殊标注类型、把 result 做成可浏览的 tag/group 或塞进浏览导航）。
- 每完成一个 slice，把该 slice 的落地状态与已验证命令记进它自己的「实现状态」段，不写进 `AGENTS.md`。

## 15. 待定决策（项目级，未收敛）

以下选择尚未拍板,但会影响后续 slice。按 product-spec-writing 约定集中放这里,不散落进设计正文。UI 框架已定为 **React**（见 brief §10 与 §1，已在 Slice 0 落地并验证），领域测试策略已定为两层（见原则 #11）;余下未决:

- **PPT 存量迁移是否属于目标**——brief §10 现列为「后续研究、高难度」。要把历史 PPT 复盘搬进来成可编辑 annotation 则需专门立项；否则明确「只面向新复盘」。此项不定,不影响其余 slice 的推进。
