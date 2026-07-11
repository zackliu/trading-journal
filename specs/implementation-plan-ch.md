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
8. **截图对象与 annotation 几何统一用 page 像素坐标**（V1 静态截图），不绑定价格 / 时间轴。
9. 标签是 `group:value`、kebab-case、稳定 id；一个分类是被查询引擎泛化匹配的 tag 值，**不是硬编码分支**。
10. **进程边界**：Electron **main** 拥有 Entry Store、Annotation-Tag Index、Tag & Query 引擎、统计、SQLite 与图片文件（durable / query 边界）；**renderer** 拥有 Fabric 画布与渲染/视图层。二者通过一套 typed IPC 契约（store/query API）通信；renderer 不直接开 SQLite 或读写文件。Slice 9 的 AI companion 是受 main 监管的独立进程，只接收专用 `JournalReadApi` 判别联合，不接收混合 IPC、DB path 或任何 write capability。
11. **测试方式（两层 + AI 协议边界）**：因 better-sqlite3 按 Electron ABI 编译，领域测试分两层——(a) **纯逻辑单测**：tag 解析、布尔查询构造、result 聚合数学等无 native 依赖模块用 **Vitest** 在 Node 跑；(b) **契约 / 持久化 scenario test**：Slice 1–8 的 store/query/stats API 通过 **Playwright + Electron** harness 断言领域行为，不绕过契约直接读 SQLite。Slice 9 另用真实 MCP client 覆盖 Streamable HTTP、安全拒绝、分页快照、媒体资源与 non-mutation，并由 GitHub Copilot 做真实多模态 handoff；绝不通过 renderer 的混合 `window.api` 冒充 extension 边界。
12. **本计划不含**：PPT 迁移（brief §10 后续研究）、可回放/实盘图表、多端同步、云后端、经纪/回测/行情、内置模型或 agent。可选 AI Access 只把用户授权的当前 journal 证据交给外部兼容 agent，不构成 Trading Journal 云后端。

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
- Decided tech: renderer UI = **React** (Vite-bundled, canvas kept imperative outside React); canvas = **Fabric.js** v6 (MIT; imperative, mounted outside React); shell = **Electron** (JS/TS, no Rust); storage = local **SQLite** (better-sqlite3) for entries/annotations/tags/results/views/stats + an `images/` folder for screenshots (referenced by hash, not base64-embedded), all under one portable data folder. Migration (reproduce the user's PPT annotations — boxes, text, arrows — as native editable annotations, not flat screenshots; high-difficulty) remains deferred research in the brief. Group/result vocabulary (which groups/tags/result dimensions exist) is user-defined at runtime, not a project decision. Do not assume other tech until it is chosen and recorded in this note.
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
- **为后续 slice 预留的占位（图标 / 空面板 / 区域，无行为）**：**Stamp 印章条**（可复用组件，Slice 5 起并入中间画布右侧）、`Tags` 页（Slice 6 起改为 `Review` 页 = entry 级 tag + 快捷选择）、`Home` 的 Settings 词表窗口与选中标注才出现的 `Annotation` 上下文页（Slice 6）、左栏按单一 group 维度 pivot 分桶的**浏览行为**与 `Browse` 页（Slice 6）、搜索 / 布尔查询 / 保存视图入口（Slice 7）、`Stats` 页统计入口（Slice 8）。标注的 tag 编辑自 Slice 6 起走 `Annotation` 上下文页，result / link 走 Slice 4 的右键浮窗。
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
- **端点手柄抓取区放大（可点区大、可见点不变）**：线 / 箭头 / MM 两端"经常点不到"。`annotations.ts` 的 `enlargeHandleHit(control)` 把控件 `sizeX/sizeY=20`、`touchSizeX/Y=30`（屏幕 px、zoom 无关）放大 hit 盒，同时把 `control.render` 换成自写的 `renderHandleDot`——按 `cornerSize` 画小圆点、**无视 sizeX**（因 `renderCircleControl` 的可见半径= `sizeX||cornerSize`，只调 sizeX 会连圆点一起撑大）。`attachSegmentControls`（poly 端点）与 `attachMmControls`（MM a/b）都调它。离端点/线体带外按下仍能抓端点：Fabric `findTarget` 先查 `activeObject.findControl(pointer)`，命中控件即进 transform。`editor.spec.ts` 加两项（离端点 8px 抓线→变斜；离 MM handle 8px 抓→height 变、A 不动）。全套 **93 项 e2e 全绿**。
- **MM 两端点对称（修复"拖一端推另一端"）**：原 `setMmFromAnchors` 把 `width` 夹到 `MM_MIN_WIDTH`、且 `left/top` 锚在第一参 A 上——拖 A 靠近 B 时按最小宽从 A 撑开，把"固定"的 B **推走**（拖 B 却不推 A），即用户说的"规定谁必须在左/右"、不对称。**修复：`setMmFromAnchors` 去掉 clamp（`width=|dx|`，可为 0），每个锚点精确落在自己的点、谁都不特权、左右自由穿越**。最小宽度降为**创建期专属**：controller `mmCreatePoint` 只在 onDown/onMove 的 mm 分支把第二点夹到离起点 ≥`MM_MIN_WIDTH`（裸击/近竖直拖仍留可抓的宽度）；编辑期用原始 pointer、无最小值。`editor.spec.ts` 加「endpoints are symmetric」（拖 A 到 B 同列→B 不动 + A 到达 B 列；已回归验证旧 clamp 下该测试 fail）。全套 **94 项 e2e 全绿**。

## 7. Slice 4：Annotation Tagging、Result & 编辑浮窗

目标：给画布上任意 annotation（框 / 文本框 / 箭头 …）打 group 下的 tag、并可给它设一个可选的 typed `result`，使它成为可查询、可统计、可高亮指认的元素；笔记就是可打 tag 的文本框 annotation。没有任何特殊标注类型。**编辑入口是贴着该 annotation 的右键浮窗，不是常驻面板。**

**用户动作流程与直觉逻辑**：用户在某个框 / 箭头 / 文字上**右键 →「Tags & result…」**，就地弹出一个贴着它的小浮窗，在里面给这个标注打 tag、（可选）填这次的结果、或连一条到另一张图的对比线；填好点 **Save** 收起，点到别处就当没改、自动收起。直觉上「我是在**这个元素本身**上做标记」——所以浮窗紧贴它，而不是跑到右边一个远远的常驻面板；文本框也走同一个右键入口设置，不跟「双击＝进入打字」的手感打架。

实现范围：

- 右键任意 annotation →「Tags & result…」→ **贴着该对象的浮窗**：给它加 / 删 group 下的 tag（group 与 tag 值用户自定义）。**Save 提交并收起；点浮窗外＝取消未保存改动并收起。**
- 浮窗也能给该 annotation 设 / 改 / 清可选的 `result`：从用户预定义的 result 维度里选维度并填值，值类型为 string 或 number（由维度定义决定）。result 只用于统计、不进浏览导航。
- result 维度管理：用户可预定义 result 维度（id、label、type ∈ string | number）；app 不预置维度。
- 笔记 = 文本框 annotation：其文本即笔记，本身也能打 tag（右键同一浮窗设置）；没有独立 note 字段。
- annotation 的 geometry 用 page 像素坐标；一个 Entry 可含多个截图对象与多个带 tag 的 annotation。
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
- 本 slice 的词表能力包含声明、排序、稳定 id 下改显示名、软归档 / 恢复与使用计数；不提供合并或改 id 的批量引用迁移。
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
- **词表演化基线已并入本 slice**：migration `007` 给 group / value / result dimension / result value 注册表增加 `archived`；重命名只改 label、稳定 id 不变；删除改为软归档并可 Restore，使用引用与计数不动；有使用的项先二次确认；归档 tag 可永久清除注册行但绝不级联 `entry_tags` / `annotation_tags`，result dimension 因类型与 FK 契约不提供硬删。`listGroups` / `listResultVocabulary` 返回 distinct-entry 使用计数。未实现的合并 / 改 id 不再列为后续路线。
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

## 11. Slice 8：Statistics —— 从自己的复盘证据回答一个问题

目标：Stats 不是一屏固定 KPI，也不是通用 BI / 回测工具；它把用户已经记录的分类与 result 组成一个短而完整的复盘闭环：**圈定结果样本 → 选择一个 result 问题 → 可选一个分类 group 做对比 → 回到原图核对证据**。用户能回答「这个分类下的结果分布怎样」「在不同市场背景下是否不同」，同时始终看得见样本量、缺失值和原始复盘，不被一个脱离证据的百分比误导。

### 用户动作流程与直觉逻辑

1. 用户先在 View 中用 Entry 条件和 Annotation 条件圈出自己关心的分类，例如某种整图背景 + 某类标注。点击 `Stats` 后，Stats **一次性复制当前 View 的分类条件**；若当前 View 含 result predicates，Stats 不继承它们，并明确提示「已忽略 N 个结果筛选，避免只统计预先挑过的结果」。之后 Stats 配置在本次会话内独立保留；`Use current View` 才重新导入。
2. 用户在 Ribbon 中只处理四件事：`Sample`（查看 / 编辑分类范围）、`Period`（All / 30D / 90D / Custom）、`Measure`（一次一个 result 维度）、`Compare`（None 或一个分类 group）。number measure 可再填一个中性条件，如 `≥ 1` 或 `≤ 0`；系统称其为 **condition match**，不擅自解释成 win。
3. 主区切到全宽 Stats workspace，不把报表塞进 Ribbon，也不在 canvas 上盖卡片。顶部先显示口径：`scope Entries / population samples / contributing Entries / recorded / missing / coverage`；用户先知道「这些数字由多少记录构成」，再看均值或占比。
4. Overall 先回答一个问题。number 显示 mean、median、可选 threshold 的 `matched / recorded`；string 用带精确 count / recorded 百分比的水平分布条。所有百分比同时显示分子 / 分母，`recorded = 0` 时显示 N/A，missing 永远不当作 0 或亏损。
5. 若选择 Compare，下面只按**一个** group 展开对比。每行是该 group 一个 value 的独立 membership cohort，按词表顺序排列，不按表现排名；另有 `No value` 行。若同一样本带同 group 多个值，它会出现在多行，页面明确提示「N 个样本出现在多个 rows；rows 不应相加」。
6. 点击 Overall、cohort、string segment、threshold matched / not matched、recorded / missing 的 `Review examples`，切回既有左栏 + canvas，并显示固定返回条 `Statistics examples: … / Back to Statistics`。examples 是对当前 StatsQuery 的临时重跑，不保存为 SavedView、不复制 Entry、不建立第二套 gallery；返回后恢复 Stats 的 measure、compare、threshold 与滚动位置。由 result 选出的 examples **不触发 result-derived highlight**。

### 设计取舍

- **不用固定交易 dashboard**：系统不知道哪个 string 值代表 win，也不知道 number 维度是否「越大越好」；因此不硬编码胜率、Profit Factor、Sharpe、drawdown、equity curve 或 MAE/MFE。用户若定义 string outcome，会自然看到每个值的占比；若定义 number R，可用 mean / median 和自定义 threshold 回答相同问题。
- **不用多轴 pivot**：Slice 8 最多 Compare 一个 group。多个 group × 多个 result 的任意透视会把日常复盘变成 BI 工具，也会快速产生无法解释的小样本格子。
- **不自动下结论**：统计只描述手工记录，不做显著性检验、预测、排名或「最佳 setup」建议。`recordedCount < 10` 时显示中性提示「Very small sample — review the examples」，但不隐藏数字。
- **证据优先**：每个主要数字都能回看构成它的原始 Entries；Stats 不保存第二份 artifact，也不把聚合结果落库。

### Population 与分母口径

- 统计单位始终是一枚 annotation（UI 称「结果样本」），不是 Entry。同一 Entry 可贡献多个样本；不得称为系统识别出的「全部交易」，因为领域模型没有特殊 Trade 类型。
- Entry predicates 与日期先筛 Entries。
- Annotation predicates 非空时，population = 在这些 Entries 中满足全部 annotation 分类 predicates 的 annotations；这些 annotations 即使尚未填写所选 measure，也留在 population，因而 missing / coverage 有真实分母。
- Annotation predicates 为空时，population 显式采用 `active-result-bearing`：在 Entry / 日期范围内，至少带任一**活跃 result dimension**记录的 annotations。它只代表「已有某项结果记录的样本」；完全没填任何 result 的 annotation 不进入此默认 population，也不把纯说明文字 / 图形误算成样本。
- `scopeEntryCount` = Entry / 日期条件命中的 Entries；`populationCount` = population annotations；`contributingEntryCount` = population 所在的 distinct Entries；`recordedCount` = 所选 dimension 有值的 population；`missingCount = populationCount - recordedCount`；`coverage = recordedCount / populationCount`。
- `active-result-bearing` 中的「活跃」固定为查询执行时 `result_dimensions.archived = 0`。该默认 population 的 missing / coverage 文案必须写成 `Not recorded for <measure> / result-bearing samples`，因为系统不知道所选维度是否适用于并集里的每个样本；只有 `matching-annotations` 由用户用分类 predicates 明确定义 eligible population 后，UI 才可称为该范围的填写 coverage。
- number mean / median / threshold rate 与 string 分布都只以 `recordedCount` 为分母。stored 但已不在活跃预设词表中的 string 值仍必须列出，保证各 segment 与 recordedCount 对账。
- Period 使用结构性 `date` 的闭区间 calendar date；`30D` = 今天及之前 29 天，`90D` 同理。统一共享 `effectiveDate = entry_tags 中的 date tag ?? createdAt 的本地 calendar date` 解析器，report 与 examples 必须使用同一结果。默认 `All`，不暗中缩小样本。

### Compare 语义

- `compareBy.level = entry`：population annotation 继承其 Entry 对该 group 的 membership，适合比较整图 / 交易日背景。
- `compareBy.level = annotation`：只看同一 population annotation 自己的 tag membership，适合比较样本自身分类。
- group 可多值，所以 cohort 独立、允许重叠。report 返回：
  - `multiAssignedPopulationCount`：属于该 group 两个以上 values 的 unique population annotations；
  - `unassignedPopulationCount`：该 level 下没有该 group value 的 population annotations。
- cohort values 从 population 中实际存在的 `entry_tags / annotation_tags` membership 生成：活跃值按用户词表顺序，仍被使用的 archived / unregistered 值随后列出并标记，最后才是 `No value`。`No value` 只表示该 level 完全没有这个 group 的 tag；归档值绝不能被算作 No value。
- UI 每行同时显示 `population n / distinct Entries / recorded / coverage`；不显示 cohort 合计，也不要求 cohort 汇总等于 Overall。Overall 始终按 unique population annotations 计算。

### 领域契约

```ts
interface StatsDateRange {
  from: string; // YYYY-MM-DD, inclusive
  to: string;   // YYYY-MM-DD, inclusive
}

type StatsPopulation =
  | { kind: 'matching-annotations'; predicates: TagPredicate[] }
  | { kind: 'active-result-bearing' };

interface StatsScope {
  entry: TagPredicate[];
  population: StatsPopulation;
  dateRange?: StatsDateRange;
}

interface StatsThreshold {
  op: 'gte' | 'lte';
  value: number;
}

interface StatsCompareBy {
  level: 'entry' | 'annotation';
  group: string;
}

interface StatsQuery {
  scope: StatsScope;
  dimension: string;
  threshold?: StatsThreshold; // number dimension only
  compareBy?: StatsCompareBy; // at most one group
}
```

```ts
interface StatsSampleCounts {
  contributingEntryCount: number;
  populationCount: number;
  recordedCount: number;
  missingCount: number;
  coverage: number | null; // populationCount = 0 -> null
}

interface NumberAggregate {
  kind: 'number';
  mean: number | null;
  median: number | null;
  threshold?: {
    op: 'gte' | 'lte';
    value: number;
    matchCount: number;
    rate: number | null; // recordedCount = 0 -> null
  };
}

interface StringAggregate {
  kind: 'string';
  segments: Array<{
    value: string;
    label?: string;
    archivedOrUnregistered: boolean;
    count: number;
    rate: number | null; // recordedCount = 0 -> null
  }>;
}

type StatsAggregate = NumberAggregate | StringAggregate;

interface StatsCohort extends StatsSampleCounts {
  value: string | null; // null = No value
  label: string;
  archivedOrUnregistered: boolean;
  aggregate: StatsAggregate;
}

interface StatsReport {
  measure: { id: string; label: string; type: 'string' | 'number' };
  scopeEntryCount: number;
  counts: StatsSampleCounts;
  overall: StatsAggregate;
  cohorts?: StatsCohort[];
  overlap?: {
    multiAssignedPopulationCount: number;
    unassignedPopulationCount: number;
  };
}

type StatsExamplesSegment =
  | { kind: 'all' }
  | { kind: 'recorded' }
  | { kind: 'missing' }
  | { kind: 'string-value'; value: string }
  | { kind: 'threshold-match' }
  | { kind: 'threshold-miss' }; // recorded but not matched; never includes missing

interface StatsExamplesQuery {
  stats: StatsQuery;
  cohortValue?: string | null;
  segment: StatsExamplesSegment;
}

interface StatsExamplesEntry {
  entryId: string;
  annotationIds: string[];
}
```

`StatsQuery` validation 固定：`matching-annotations.predicates` 非空；date 是真实 `YYYY-MM-DD` 且 `from <= to`；dimension 当前活跃；threshold 仅允许 number dimension；compare group 当前可用。`StatsReport` 的 aggregate 必须与 `measure.type` 同 kind；mean / median / rate / coverage 在零分母时一律为 `null`，不返回 0。

`StatsExamplesQuery` 返回 exact `StatsExamplesEntry[]` membership。它是只读、transient 的统计 drill-down contract，不扩展 SavedView、不持久化命中 ID。renderer 用既有 rail / canvas 展示 distinct Entries，并带 Back to Statistics session；result 不产生 brief-highlight。examples bar 显示 `This review: N matching samples` 与 Previous / Next；进入某 Entry 时对当前匹配 annotation 使用普通 canvas selection 定位（非光晕、非 result highlight、非持久化），同一 Entry 有多枚样本时可逐枚切换。

### UI 结构

- `Stats` tab 是分析 workspace，而不是普通 canvas 命令页：选中时 body 使用完整报表布局；切回 Home / Draw / Review / View 即回 canvas。Stats 状态留在 App session，不写 journal。
- Ribbon `Stats` band：
  - `Sample`：口径摘要、`Edit sample…`、`Use current View`；
  - `Period`：All / 30D / 90D / Custom segmented control；
  - `Measure`：活跃 result dimension 下拉；number 时出现 `≥ / ≤ + value`；
  - `Compare`：None，或按分组标题列出的 `Review tag · <group>` / `Sample tag · <group>`。
- 主报表是不嵌套卡片的全宽区段：Population 摘要带 → Overall → Compare table / distribution。number compare 用紧凑表格；string overall 用水平条，compare 用 100% stacked distribution + 精确 count / coverage。
- 空态：
  - 无活跃 result dimension：`No result dimensions yet` + `Define result…`；
  - scope 无 population：`No samples match this scope` + `Edit sample` / `Review matching entries`；
  - population 有值但 selected dimension recorded = 0：显示真实 population 与 0% coverage，提供 `Choose another result` / `Review missing examples`，不显示 0 均值；
  - 查询失败：明确错误 + Retry，不回退旧 report。

### 数据与边界

- Stats 只读 `entries.created_at`、`entry_tags`（含结构性 date）、`annotations`、`annotation_tags`、`annotation_results`、result dimension registry；绝不扫描 canvas JSON。
- 聚合与 examples 查询在 Electron main 的 Tag & Query Engine 边界，经 typed IPC + zod validation 暴露；renderer 不直接读 SQLite。
- 不新增或修改 Entry / Annotation / canvas_json 持久化格式；StatsQuery、report、examples session 均不落 journal DB，因此 Slice 8 不需要 schema migration。
- median、rate、overlap 等纯数学放入无 native 依赖的纯函数模块，并在 Slice 8A 引入 Vitest；SQLite 查询只负责产生结构化 population rows，不在 renderer 做 SQL 语义。

### 实现分解

1. **Slice 8A — 统计口径与聚合契约**：定义 StatsQuery / StatsReport / validation；从索引读取 population rows；实现 pure aggregate（number / string / median / threshold / coverage / overlap）；typed IPC；领域测试。无 UI、无 schema 变化。
2. **Slice 8B — Overall workspace + evidence loop**：让 Ribbon Stats 控制 App workspace；实现 Sample scope、Period、Measure、number threshold、population 摘要与 Overall；同时交付 Overall / recorded / missing / string segment / threshold examples、普通 selection 定位与 Back to Statistics。session 保留配置；完整空态与错误态。
3. **Slice 8C — Compare**：最多一个 group 的 entry / annotation cohort、实际 membership values、archived 标记、No value / overlap 提示与 cohort examples；复用 8B 已验证的 evidence loop。

### Scenario-based tests

`scenario: default statistics disclose their population and coverage`

- 无 annotation predicates 时，只把带任一活跃 result 的 annotations 放入 population；纯笔记 / 图形不进入。
- report 同时给出 scopeEntryCount、populationCount、contributingEntryCount、recorded、missing、coverage；missing 不进入 measure 分母；默认 population 的文案不把 missing 称为「应该填写却漏填」。

`scenario: number and string results use explicit denominators`

- number 覆盖负数、0、奇 / 偶数样本 median、gte / lte threshold；mean / median / rate 只基于 recorded。
- string 每值 count / recorded rate 对账；归档预设值若仍有 recorded rows 也出现在分布中。

`scenario: statistics inherit classification scope but never result selection bias`

- 从同时含 entry tag、annotation tag、result predicates 的 View 进入 Stats；只复制两级分类条件，显示忽略 result filter 的提示。
- threshold 只产生 matched 指标，不缩小 Overall denominator。

`scenario: comparing by a multi-value group keeps cohorts honest`

- 分别验证 entry-level 与 annotation-level membership；同一样本多值时进入多行；No value、multiAssigned、unassigned 正确。
- 活跃值、仍被使用的 archived / unregistered 值、No value 顺序和对账正确；归档 membership 不进入 No value。
- Overall 按 unique population 计算；cohort rows 允许重叠，不断言 rows 汇总等于 Overall，也不按表现排序。

`scenario: editing a result updates the live report`

- number / string result 修改或清除后，recorded、missing、coverage、aggregate 与 cohort 实时变化；不需手工刷新，Entry 数不变。

`scenario: statistics examples return to the source evidence without copies`

- Overall / cohort / string segment（含具体 value）/ threshold / missing drill-down 返回 exact Entry + annotation membership；threshold miss 不含 missing；一张 Entry 多枚样本时可逐枚普通选中定位；左栏每个 Entry 仍只有一个 durable row。
- examples 不保存为 SavedView，不改变 Stats 配置，不持久化命中 ID；Back 恢复 Stats；result 条件不触发 canvas brief-highlight。

`scenario: date presets use the structural review date`

- All / 30D / 90D / Custom 使用闭区间 date；边界日计入；无 date 的旧 Entry 按 createdAt-day fallback；examples 与 report membership 完全一致。

### 明确不做

- 固定内置 result 维度、win 值或 R 阈值；Profit Factor / Sharpe / drawdown / equity curve / MAE / MFE。
- 两个以上 compare groups、多维 pivot、相关性矩阵、自动排名、显著性检验、AI 交易建议。
- 把 result 变成 tag、browse bucket 或 highlight；把 annotation 特判成 TradeMarker；复制 Entry 来保存报表或 examples。

## 12. Slice 9：Read-only AI Access Extension（post-MVP）

目标：用户可以让**自己选择、自己信任的兼容 agent**读取当前 Trading Journal 中的结构化复盘与视觉证据，帮助完成近期复盘、分类对比、反例 / 离群样本检查、相似案例回看、跨图 link 追踪与数据完整性审计。Trading Journal 只提供本机、按需、可撤销的只读 MCP 数据能力；它不内置模型、不绑定供应商、不替用户保存 AI 结论，并且**永远不向 agent 暴露任何 journal write 能力**。本 slice 按用户要求先于 Slice 8 落地；Slice 8 未实现期间不暴露 statistics / data-gaps 空壳 tool。

这里的 extension 是一个**第一方可选 companion package / process**，不是通用第三方插件平台。用户可以使用任何通过支持矩阵验证、能连接本 extension Streamable HTTP MCP 能力的 agent；不承诺所有 agent 都支持 Authorization header、Resources 或 image content。

### 用户动作流程与直觉逻辑

1. `Home → App settings → AI` 是独立 Settings 页面，默认是 Off；`General` 页只管 journal data，不与 AI 内容混排。用户第一次点 `Start` 时只确认一件事：`While AI Access is on, any client using the copied local configuration can read this entire journal, including text and chart images, and may send it to its model provider. Trading Journal cannot control that provider.` **确认并 Start 就是完整只读授权**，不再出现逐 agent、逐字段或逐图片权限步骤。
2. Start 后页面只有 `Copy Copilot config` 与 `Stop`。应用自动维护一个本机 access key，并把它放进复制出的 Streamable HTTP 配置；用户不创建 connection、不命名 agent、不管理 credential，也不在 Trading Journal 中选择模型、填写模型 API key 或登录 AI 供应商。
3. 用户可先编辑 **Agent Guide**，告诉 agent 自己的图该怎么读：图表方向 / 布局、颜色与形状含义、常用 stamp、入场 / 出场 / 无效点如何标、bar count 的两端与 candle / interval 口径、result 如何解释、哪些视觉线索不能从截图推断。Prompt Library 中的内置工作流可编辑 / 启停 / 恢复默认，也可新增自定义 prompt。
4. 用户在自己的 agent 里选择这些 MCP prompts 或直接提问，例如：
  - 「总结最近 90 天我记录的 setup，先看样本和统计，再挑原图证据。」
  - 「比较两个市场背景下同一 setup 的结果，找结果相反的盘面。」
  - 「找出 R 倍数离群的样本，逐张看入场 annotation 周围的图。」
  - 「哪些明确属于这个 setup 的样本还没填 result？」
  - 「沿着这些 annotation links 回顾我当时如何修正判断。」
5. Agent 先调用有界结构化查询，再为少量候选 annotation 请求视觉证据包。包同时提供已提交页面、编号 locator、局部 focus、可用时的原始截图 native crop，以及 annotation geometry ↔ screenshot instance 的结构化映射；不会先把整个 journal 和全部图片一次性塞进上下文。回答引用 `A1 + annotationId + Entry date / id`，并把结构化事实、视觉观察与推断分开。Slice 8 将来落地后可再增加直接委托其统计 contract 的 tool，但不由 AI layer 预做另一套统计。
6. 应用状态栏与 AI Access 页面只显示当前连接数、正在调用的 tool / resource / prompt 与最近 20 次读取摘要。日志仅保存在内存，Stop / 重启即清空，不写 journal。
7. 用户点 `Stop`、关闭应用或切换 workspace，就立即终止所有 sessions，并令 cursor 与 resource link 失效。若复制的配置曾被不该持有的人拿到，`Reset access key` 一次使所有旧 HTTP 配置失效；它放在 Advanced，不成为日常流程。

### 支持范围与威胁模型

- **兼容 agent**：支持当前已验证 MCP protocol version、Streamable HTTP 与 bearer header 的 client。若 client 不支持 Resources / image content，它仍可使用结构化 tools，但不能声称看过盘面图片。
- **Start 的含义**：AI Access On 时，任何持有复制配置的本机 client 都被视为获准读取当前整个 journal，包括结构化数据、可读文字和 chart images。分页、rate limit、单次结果上限只保护性能 / 上下文，**不是**授权边界。
- **外部数据流**：companion 自身不上传数据、不调用模型；但外部 agent 可能把读取到的文本 / 图片发送给其模型供应商。Trading Journal 通过首次 Start 的一次性完整披露、显眼 On 状态与 Stop / Reset key 控制出口，不替外部 provider 做隐私保证。
- **journal 内容是不可信证据**：annotation text、标题、图片中的文字都可能包含指令式内容。MCP 输出把它们标记为 `untrusted journal evidence`，从不拼接成 server instruction；这能降低 prompt-injection 风险，但不能保证外部 agent 不受图片 / 文本影响。
- **工程级只读保证**：这是第一方受审计代码，不是运行任意第三方 extension 的 OS sandbox。保证的是「通过 MCP 可达的能力不能修改 journal」；port、access-key reference、Agent Guide 与 Prompt Library 等 machine-local 设置由主应用写入本机配置，不属于 journal data write。

### 进程与数据边界

```text
Compatible agent
  │  Streamable HTTP
  ▼
AI Access companion (supervised utility process)
  │  strict MessagePort request union
  ▼
JournalReadService (Electron main)
  ├─ dedicated SQLite connection: readonly + fileMustExist + PRAGMA query_only=ON
  ├─ read repositories: entries / index / views / stats only
  └─ VisualEvidenceService → isolated read-only offscreen renderer
```

- companion 由 Electron main 启动、监控和终止；崩溃只使 AI Access 离线，不使主应用退出。companion 不接收 workspace path、SQLite path、DB handle、`IpcApi` 或任意文件路径。
- main 新建独立 `JournalReadApi` 与严格判别联合；**不能**从现有读写混合 `IpcApi` 做 `Pick<>`，也不能设计通用 `invoke(method,args)`。MessagePort 只接受精确 allowlist operations，未知 operation 直接拒绝。
- `JournalReadService` 在 workspace migration 完成后，单独以 `readonly: true / fileMustExist: true` 打开当前 SQLite，并执行 `PRAGMA query_only=ON`。read repository 不导入 Entry Store / vocabulary / stamp 等 writer；架构 lint 阻止 extension / read package import write modules。
- app main 是当前 workspace 的唯一 owner。extension 读取**最后一次已提交 autosave**，MCP 调用绝不触发 flush / save，也不等待或修改 renderer 正在编辑的页面。所有结构化响应带 `snapshotAt`、`journalInstanceId` 与相关 `updatedAt`，让 agent 知道证据时点。
- VisualEvidenceService 使用专用 hidden / offscreen renderer + `StaticCanvas`、与编辑器相同的 Fabric class registry 和共享的纯 page-scene 配方；它只接收单 Entry 的已提交 `canvas_json` 与经校验的 image bytes，在内存派生 geometry、screenshot transform、locator 与 PNG。page scene 只含白页、screenshot objects 与 annotations，不含 selection、stamp strip、brief highlight 或编辑器 chrome。它不复用 `CanvasController`、没有 store preload、没有 autosave / history / selection 写回路径。
- extension 不新增 AI 专用索引、embedding、vector DB、SavedView 副本或持久化报告；查询 / stats 复用既有 index 与 Slice 8 contract，视觉证据和 pagination snapshot 只在内存缓存。

### Streamable HTTP 与连接安全

- 使用官方 MCP SDK 实现 Streamable HTTP，不手写 JSON-RPC / session 状态机；以协议协商支持兼容版本，并至少覆盖 MCP `2025-06-18` 的 initialize、POST / GET、JSON / SSE、`Mcp-Session-Id`、protocol-version header 与 DELETE teardown。
- 首次启用时选择一个随机可用端口并保存到 machine-local config，之后保持稳定，便于 agent 配置长期复用；端口冲突时明确报错并让用户选择 / 重新生成，绝不静默漂移。
- 只绑定 `127.0.0.1`，不绑定 `0.0.0.0`、LAN 或公网。每个请求验证 remote address 与精确 `Host: 127.0.0.1:<port>`；无 wildcard CORS。
- 所有 POST / GET / DELETE 请求都必须带 `Authorization: Bearer <token>`；token 绝不放 URL/query。整个 AI Access 服务只有一把由应用自动生成的 256-bit access key，constant-time compare；Windows 通过 Electron safeStorage / DPAPI 加密，machine config 只存密文，**没有明文 fallback**。若 OS-protected encryption 不可用则不能 Start。用户只通过 Copy config 使用它；`Reset access key` 生成新 key 并关闭全部 sessions。
- 默认并永久拒绝任何带 `Origin` 的请求；Slice 9 不支持 browser MCP client，也不实现 CORS / OPTIONS。无 Origin 的 native client 仍必须通过 bearer auth。若未来需要 browser client，必须单独设计精确 Origin、严格 preflight 与 provider 风险，不在本 slice 留开关。
- session id 必须随机且不可预测；Stop / Reset access key 立即关闭全部 sessions。设置 body / response / image byte / pixel、并发、调用频率与超时上限；错误不泄露 DB path、image path、SQL 或 stack。
- 本 slice 不开放 remote access。未来若支持非 loopback，必须单独设计 HTTPS + MCP OAuth 2.1 / resource audience validation；不能把当前 bearer token 搬到公网。

### 专用只读领域契约

```ts
interface AiReadContext {
  journalInstanceId: string;
  accessEpoch: string;
  sessionId: string;
  snapshotAt: string;
}

type JournalReadRequest =
  | { op: 'overview' }
  | { op: 'list-vocabulary'; input: VocabularyQuery }
  | { op: 'search-entries'; input: EntrySearchQuery }
  | { op: 'search-samples'; input: SampleSearchQuery }
  | { op: 'entry-context'; input: EntryContextQuery }
  | { op: 'linked-context'; input: LinkedContextQuery }
  | { op: 'visual-evidence'; input: VisualEvidenceQuery }
  | { op: 'read-resource'; input: { uri: string } };
```

`JournalReadRequest` 是封闭联合；其中不存在 mutation、raw SQL、raw canvas JSON、filesystem path 或 generic method 字段。每个 input 都有 runtime validation；MCP tool 返回 typed `structuredContent`（另带兼容 text JSON）。

### MCP Tools（少而强、组合使用）

| Tool | 用途与主要输入 | 有界输出 |
| --- | --- | --- |
| `get_journal_overview` | 当前 journal 的 Entry / sample 数、effective date 范围、group / result / SavedView 数、各 result recorded count | 小型摘要 + server / app / schema / read-api version；不输出全词表 |
| `list_vocabulary` | `kind = groups / results / saved-views`、includeArchived、cursor | 稳定 id、label、type、usage count / query 描述；分页 |
| `search_entries` | typed `ViewQuery` 或 `savedViewId`、date range、sort、cursor | Entry id / date / entry tags / matching sample count / context resource link；Entry 为单位 |
| `search_samples` | Entry predicates + 同一 annotation 共现的 tag / result predicates、date range、result existence / missing、稳定排序、cursor | annotation id / bounds / tags / results + Entry id / date；不读 canvas JSON |
| `get_entry_context` | 单个 `entryId` | Entry tags、indexed annotations、results、links、受限 title / text objects 与 media resource links；不返回 raw JSON |
| `get_linked_context` | 起始 `annotationId`、depth（默认 1、最大 2） | 有界 link graph；处理循环、broken link，节点 / 边数硬上限 |
| `get_visual_evidence` | 单个 `entryId` + 1..8 个属于该 Entry 的 `annotationIds` | 创建 revision-bound `VisualEvidenceBundle`；返回 manifest、核心 image content 与延迟 resource links，不接受任意 image id / path / bbox |

- 不提供通用 `get_media` tool。`get_visual_evidence` 只编排一个有界证据包；inline image content、resource read 与后端缓存全部复用同一 VisualEvidenceService、ownership check 与 bundle revision，不形成第二条媒体权限路径。
- 不提供任意全文搜索、embedding 或视觉相似度 API。Agent 可以先用结构化 tag / result 缩小候选，再读取少量图片自行比较；不能为了“相似案例”扫描全库 canvas JSON 或建立隐形向量库。
- `search_samples` 保持 Slice 7 的同一 annotation 共现语义。Slice 8 未实现时 `tools/list` 中明确没有 statistics / data-gaps；未来若接入，只能直接复用 Slice 8 contract，AI extension 不拥有另一套 query / stats engine。

### 分页、快照与有界读取

- list / search 默认 `limit = 20`，最大 50；稳定排序必须带 id tie-breaker。服务按稳定 sort key 物化**单个最多 1000 rows 的内存窗口**，cursor 到达窗口尾时可携带 opaque continuation 打开下一窗口，直至穷尽授权范围；同时返回 `narrowQueryHint` 鼓励 agent 优先按日期 / tag / result 收窄。1000 不是总结果截断。
- cursor 是不透明随机值，绑定 `accessEpoch + sessionId + journalInstanceId + queryHash + window boundary + snapshot sequence + offset`，TTL 10 分钟；不保持长 SQLite transaction。下一窗口从前一窗口最后稳定 sort key 继续，同一 snapshot sequence 内不得重复 / 漏项；cursor 不可跨 access epoch / session / app instance 使用。
- Stop、Reset access key、workspace switch、app restart 或 snapshot TTL 到期均返回明确 expired error，不回退成新的查询结果。分页内不重复、不跳项；新写入只出现在下一次查询 snapshot。
- 持 access key 的 client 可通过多次合法查询遍历当前整个 journal；上限只保护 app 响应、模型上下文和误操作，不宣称防止导出数据。

### MCP Resources 与可验证视觉证据

`resources/list` 只列 journal overview 与当前 Agent Guide 这两个具体 resource，**不枚举全库 Entry**；其余 parameterized URI 只由 `resources/templates/list` 声明。单纯把整页图和 annotation bounding box 交给模型不足以建立可靠对应：bbox 会丢失箭头方向、线段端点、折线路径与多截图关系，而视觉模型本身也不擅长精确空间定位和密集对象计数。因此视觉入口统一为 `get_visual_evidence` 创建的临时 `VisualEvidenceBundle`。

#### Bundle 生命周期与交付

- `VisualEvidenceQuery` 必须给出一个 `entryId` 和 1..8 个属于该 Entry 的 `annotationIds`。超出上限由 agent 分批请求；服务不接受调用方自造 bbox、image hash、文件路径或全库图片扫描。
- bundle 绑定 `accessEpoch + sessionId + journalInstanceId + entryId + evidenceRevision`。`evidenceRevision` 由已提交 `canvas_json` digest、Entry `updatedAt` 与所有引用 image hashes 派生；Stop、workspace switch、session teardown、TTL 到期、整包 LRU 淘汰或 Entry revision 改变后全部 links 以区分原因的 expired / evicted error 明确失效，不回退到新内容。
- tool result 用 `structuredContent` 返回 manifest；`content` 按「asset id 文本标签 → ImageContent」相邻排列，并为所有资产返回 `ResourceLink`。为兼容已实测不会自动把 ResourceLink 图片交给模型的 Copilot host，`overview / locator / focus / source locator+clean` 在 20 MiB inline 预算内都直接进入同一次 tool result；source pair 原子纳入或原子省略。超限资产列入 `omittedInlineAssetIds`，仍保留可读 link，不能静默省略或只给半对。
- MCP Resource 可被 client 读取，不代表图片一定会被送入模型。支持矩阵必须分别验证「client 能读 resource」与「多模态模型实际收到 ImageContent」；text-only 或未转发图片的 client 只能使用 manifest，必须明确说明没有进行盘面视觉分析。
- bundle、marks、派生 geometry、PNG 与 native crop 都只存在于有界内存 LRU；不写 journal、machine config、临时文件或第二套 AI 索引。LRU 只能按整个 bundle 原子保留 / 淘汰，不能单独淘汰 locator、clean 或 manifest；source-native pair 同时生成并占用预算，任一成员超限就拒绝整对并返回明确原因，不能留下无法对照的半对证据。

#### 最小证据包

| Asset / Resource URI template | 内容 | 约束 |
| --- | --- | --- |
| `trading-journal://journal/{instance}/overview` | 有界 JSON journal overview | structured |
| `trading-journal://journal/{instance}/entries/{entryId}/context?rev={updatedAt}` | 单 Entry context JSON | 含受限 title / text；有界解析，不返回 raw JSON |
| `trading-journal://journal/{instance}/entries/{entryId}/thumbnail?rev={updatedAt}` | 400px 导航预览 | 不能作为唯一盘面证据 |
| `trading-journal://journal/{instance}/evidence/{bundleId}/manifest` | `VisualEvidenceManifest` | 与 tool `structuredContent` 同一 schema / revision |
| `trading-journal://journal/{instance}/evidence/{bundleId}/overview` | 已提交 page composition | 含全部用户 annotations；不含 AI marks |
| `trading-journal://journal/{instance}/evidence/{bundleId}/locator` | overview + `A1 / A2 …` locator | 与 overview 同尺寸、同 page-to-render transform |
| `trading-journal://journal/{instance}/evidence/{bundleId}/annotations/{mark}/focus?context={level}` | 单 annotation 周围的实际 composition | 保留全部用户 annotations；mark 位于 crop 外部 gutter，不 dim 其它对象 |
| `trading-journal://journal/{instance}/evidence/{bundleId}/annotations/{mark}/source?context={level}&variant={locator|clean}` | 可选 source-native locator / clean pair | 只有唯一、完整、可逆的 screenshot 空间映射时存在；两图必须同 ROI / frame |
| `trading-journal://journal/{instance}/evidence/{bundleId}/annotations/{mark}/underlay?context={level}` | 可选 page-underlay crop | source-native 不安全时的派生 fallback；隐藏 journal annotations 并显式列出 removed ids |

- `overview` 与 `locator` 使用完全相同的输出 frame，并都预留同尺寸外部 gutter；overview 的 gutter 留空，locator 的 mark / legend 放在 gutter，leader 或 outline 终止于 annotation `paintBounds` 外缘，不覆盖目标盘面。locator 是用于对应 id 的派生图，不能拿来数 bar。
- `focus` 是用户真实已提交 composition 的局部视图，A-mark 同样放在外部 gutter；不隐藏、不淡化、不改写任何 annotation。默认只生成 `near`；`tight / wide` 由同一 bundle 延迟读取，不预生成全部尺寸。
- source-native 资产按需成对读取：`locator` 与 `clean` 使用同一个整数 source-pixel ROI、同一输出 frame 和同尺寸外部 gutter。locator 把 A-mark、精确 source-local 边界 / 路径 / 端点以细线派生 overlay 映射到 native chart pixels；clean 的 chart 区域完全不画 overlay，供 agent 查看被 annotation / locator 遮住的 candle。两图都无损编码为 PNG，clean 的 chart 区域不缩放，保证 VisualEvidenceService 输出来自原始 decoded raster samples，但不声称与原文件压缩 bytes 相同，也不能保证外部 MCP client / 模型不再缩放。locator 负责「指哪里」，clean 负责「那里实际有什么」；需要精细视觉判断或 bar count 时必须成对读取，不能只看其中一张。
- `underlay` 是「隐藏 annotations 后重新渲染 page crop」的反事实派生图，不是用户看到的页面。它只与对应 focus 成对提供，标注 `derived: true`、`notUserVisibleComposition: true`、`removedAnnotationIds`，只帮助看被遮住的 raster，不能用来推断用户意图；无法安全生成时不提供任何 chart-only 资产。

#### Manifest、geometry 与截图映射

- manifest 明确定义三个坐标空间：持久化 `pagePx`、bundle 输出 `renderPx`、每个 screenshot instance 的原始 `sourcePx`；返回完整 affine `pageToRender`、`sourceToPage` 与可逆时的 `pageToSource`，不让 agent 猜缩放比例。每个 asset descriptor 另返回 pixel dimensions、外部 gutter / chart `contentRect`、page / source ROI、对应 crop transform、clipping 与 paired asset id，保证 locator / clean / focus 的关系可由程序验证。非等比缩放 / skew 的质量信息返回 $2 \times 2$ 线性部分及 singular-value `min / max`，不用一个虚假的 `sourcePixelsPerPagePixel` scalar。
- 每个 annotation 返回 bundle 内稳定但不持久化的 `markId + annotationId`、index 中用于查询 / 高亮的 `indexBounds`、包含 stroke / arrowhead / text-box 外框的派生 `paintBounds`、style、z-order、受限 text，以及 index 提供的 tags / result / links。若 index 与 `canvas_json` 的 `tjId` 对不上，返回 integrity error / warning；不能让 canvas 中的 tag / result 成为第二事实来源。
- geometry 是判别联合：rect / text 返回变换后 quad；line / arrow 返回 start、end、`arrowTip` 与 arrowhead polygon；polyline 返回路径点；MeasuredMove 返回 anchors / levels；group / stamp 返回有界 composite child geometry；freehand Path 返回 `precision: 'flattened'`、误差容限与点数；未知 class、奇异矩阵或不支持的 clip / filter 返回 `unsupported`，绝不静默降级成 bbox。`arrowTip` 只描述图形端点，不命名为 `target / entry / exit`。
- 所有 geometry adapter 从 hydrated Fabric object 使用 `calcTransformMatrix()` 派生 page geometry；Polyline / Arrow 计入 `pathOffset`，TextBox 计入自绘 padding，MeasuredMove 复用编辑器 anchor / level 公式，image 计入 scale / rotation / skew / flip / crop 与受支持的 group transform。`getBoundingRect()` 只做候选预筛与 crop envelope，不决定精确关联。
- 每个 screenshot object 都是独立实例 `S1 / S2 …`，即使引用相同 hash 也不合并；manifest 返回 native size、page quad、z-order、可见 source region 与 transform。annotation ↔ screenshot 只称为 **spatial association**：点报告 inside，线报告相交长度，面报告相交面积；重叠截图、跨图 annotation、clip 或多个候选一律返回 `ambiguous` 和全部候选，不按最近、最大面积或最高 z-order 偷选。
- 只有唯一 spatial candidate、矩阵可逆、目标 geometry 完整位于该 screenshot 的可见 source region 时才提供 `source`。`geometryClipped` 与 context margin 导致的 `contextClipped` 分开报告；quality 另含 native crop availability、source resolution、association、overlapping annotation count 与 occlusion `none / partial / substantial / unknown`。
- 空间唯一只证明像素映射，不证明语义归属。框的哪两边定义区间、箭头尖端是否代表入场、stamp 中心是否是事件点，都只能来自 User-authored Agent Guide；guide 未定义时 agent 必须提问或标为 uncertain。

#### 读取安全与范围

- 不提供全局 `image/{hash}` 或 `file://` URI。source ownership 只解析目标 Entry 的 cover + 单 Entry `canvas_json` 中 `tj-image://<hash>` 引用，绝不为验证 source 扫描全库；路径穿越、跨 Entry source、未知 annotation、伪造 bundle、过期 revision 一律拒绝且不泄露路径。
- 单 Entry text / media-ref 解析使用结构化 JSON parser，设输入字节、对象深度、对象数、总字符数上限；只提取 title、text object、`tjId` 映射、geometry 所需对象字段和 image refs。分类 / 搜索 / 统计仍只读 Annotation-Tag Index，绝不扫描 canvas JSON。
- renderer 无 `CanvasController`、事件监听或 contextBridge store API；限制输出尺寸、总像素、PNG bytes、并发与 timeout。所有 tool inline / resource read 共用相同 bundle cache 和 ownership check，缓存不写磁盘。
- image bytes 先 sniff MIME 并验证为受支持图片；resource 返回 MCP binary / image content，不返回磁盘路径。每个资源标注 `audience: ['assistant','user']`、revision / lastModified、asset kind 和 `untrusted evidence`。

### 可编辑 Agent Guide 与 MCP Prompt Library

#### Agent Guide：教 agent 如何读我的图

AI Access 提供一份用户可编辑的 Markdown guide，初始模板只有帮助性标题，不预置任何颜色 / 形状语义：

```md
# How to read my trading journal
## Chart layout and axes
## Visual legend: colors, boxes, arrows and stamps
## How I mark entries, exits and invalidation
## How I count bars and include interval endpoints
## Annotation and note conventions
## How I interpret my result dimensions
## Analysis rules, caveats and things not to infer
```

- 用户可以用自然语言写「时间从左到右」「红框表示候选区域而非实际入场」「某个 stamp 的中心才是 entry」「蓝箭头尖端是事后说明而非目标」「bar count 两端都算 candle，若问间隔则是 candle 数减一」「不要从截图猜精确价格」等个人约定。
- guide 是**用户主动写入的可信 AI 配置**，与 journal 中的 title / note / OCR-like image text（不可信 evidence）严格区分。它存于 machine-local AI config，不进入 journal，不随 Entry 保存。
- MCP `resources/list` 除 overview 外还列出 `trading-journal://agent-guide/{revision}`；`get_journal_overview` 也返回该 resource link。Agent 可先读 guide 再查询数据。
- 每个 `prompts/get` 返回的 prompt messages 都把当前 guide 作为独立、标明 `User-authored Agent Guide` 的首段内容，再附具体 workflow prompt；guide 为空时明确 `No chart-reading guide configured`，不偷偷套系统默认解释。

#### Prompt Library：可编辑的复盘工作流

```ts
interface AiPromptArgument {
  name: string;        // snake_case, stable within this prompt
  description: string;
  required: boolean;
}

interface AiPromptTemplate {
  id: string;          // slug; built-in id stable, custom id creation后不改
  title: string;
  description: string;
  enabled: boolean;
  body: string;        // Markdown, max 16 KiB
  arguments: AiPromptArgument[]; // max 12
  source: 'built-in' | 'custom';
}
```

- 内置模板不是硬编码不可改的“系统提示词”；它们只是可用起点：
  - `understand_my_journal`：先读 Agent Guide、词表与 result dimensions，复述 agent 将如何理解这些约定并指出仍不清楚之处；
  - `inspect_entry_visual`：按 `entry_id` 与选中 annotation 创建 visual evidence bundle，依次读 guide → manifest → overview / locator → focus / chart-only；用 `A-mark + annotationId` 引证，并区分 observed / inferred / uncertain，不从截图编造精确价格或伪精确 bar count；
  - `review_recent_period`：先 overview / stats，再取少量代表、反例与 missing examples，引用 Entry date / id；
  - `compare_classifications`：用同一 denominator 比较 cohorts，明确 overlap / sample size，再看盘面；
  - `inspect_outliers`：按 number result 找离群样本，读取 visual evidence bundle，区分数据事实、视觉观察与假设；
  - `find_counterexamples`：在相同结构化条件下找相反 result，禁止把少数图直接推成规律；
  - `audit_data_quality`：在明确 eligible population 下查缺 result / tag、broken links 与 coverage。
- 用户可编辑 built-in 的 title / description / body / arguments、启停、Duplicate、Reset to default；可 Add custom prompt，并删除 custom prompt。修改只写 machine-local AI config；不改变 journal。
- body 中 `{{argument_name}}` 必须对应 arguments 中声明的字段；保存时验证 snake_case、重复名、必填参数、长度与未知 placeholder。`prompts/get` 对 arguments 做长度 / 类型验证后纯文本替换；不执行代码、URL、SQL 或 template expression。
- MCP 声明 `prompts: { listChanged: true }`。`prompts/list` 只列 enabled prompts（分页）；`prompts/get` 返回当前 guide + 已解析 workflow messages。用户在应用中保存 / 启停 / 新增 / 删除 prompt 后，所有在线 sessions 收到 `notifications/prompts/list_changed`。
- Prompt 可以指导 agent 调用 tools 与读取 resources，但 server 本身不自动执行 prompt、不调用 sampling / LLM。Prompt arguments 与返回内容不能绕过 JournalReadApi、resource ownership、分页和只读边界。

machine-local AI config 至少保存：stable port、access-key credential reference、Agent Guide、Prompt Library overrides / custom prompts。它与 journal data folder 分离；MCP 没有修改 guide / prompt 的 tool 或 resource，只有 Trading Journal UI 能写这些配置。

### UI：Home → App settings → AI

- Settings 窗口有固定 `General / AI` 两页；默认打开 General，切到 AI 才看到 AI Access。切页不关闭窗口，也不丢失尚未保存的 Agent Guide / Prompt Library 草稿；两页共用固定 header / tabs，各自内容独立滚动。
- 顶部状态：`Off / Listening on 127.0.0.1:<port> / N clients`。日常操作只有 Start / Stop、Copy Copilot config；首次 Start 显示完整只读与外部 provider 披露，之后页面始终显示 `AI Access On = full read of this journal, including text and images`。
- 不显示 Connections、agent name、权限矩阵、token、Origin、LAN 或 remote 设置。所有连接共享同一完整只读范围。Advanced 只有 `Reset access key`，用于一次性让所有旧配置与 session 失效；用户无需日常管理。
- `Agent Guide` 是一个有 starter headings 的大文本编辑区，Save / Reset starter / Preview compiled guide；长内容区封顶滚动。
- `Prompt Library` 是限高可滚列表：enabled、title、description、Edit、Duplicate；built-in 有 Reset，custom 有 Delete；顶部 Add prompt。编辑 modal 包含 title、stable id（新建时自动 slug）、description、arguments 与 Markdown body，并实时预览 `prompts/get` 将返回的 messages。
- `Recent activity` 只显示最近 20 次时间、MCP clientInfo（若提供，仅作显示、不作为身份）、tool / resource / prompt、row / byte count、成功 / 拒绝；只在内存。请求进行时状态栏显示低干扰 AI read 指示。
- Stop 后 guide / prompts / stable endpoint 配置仍在 machine-local config，但无 listener。切 workspace 时服务先 Stop；再次 Start 才把新 workspace 完整授权给同一 access key。

### 无 write 的可证明性

1. MCP `tools/list` / resources / prompts 中没有 create、update、delete、tag、result、note、save、export-all、execute、SQL 或 filesystem tool。
2. `JournalReadRequest` 是封闭 allowlist；未知 tool、大小写 / 前缀 / 同义 write 名、额外 HTTP route 与不支持 method 全部拒绝。
3. companion 不获得 DB path；main read service 使用 readonly SQLite + `query_only`，测试中直接尝试 INSERT / UPDATE / DELETE / PRAGMA write 必须失败。
4. extension package dependency rule 禁止导入 store writers、preload `IpcApi`、`fs` journal paths；VisualEvidence renderer 无 write preload。
5. non-mutation audit 在一轮完整调用前后比较 canonical journal domain digest：排序后的 Entries（含原始 canvas_json）、tags、annotations、results、views、stamp library、image 文件名 + bytes hash 全部不变。不能只比较物理 `app.sqlite` hash，因为 WAL / checkpoint / `schema_meta` provenance 可变化而不代表用户数据变化。
6. extension 不创建 schema / migration，不向 journal 写 session、cursor、cache、log、prompt 或 AI report；machine-local stable port、access-key reference、Agent Guide 与 Prompt Library 是唯一配置写入，且 MCP 无修改这些配置的能力。

### 实现分解

1. **Slice 9A — Read boundary + threat model**
  - 冻结 `JournalReadApi`、tool / resource output schemas、Start = full-read grant、access epoch、query snapshot / cursor contract；
  - 建 dedicated readonly / query-only connection 与 read repositories；复用 Slice 7 / 8 query / stats 语义；
  - 完成 pagination snapshot、canonical domain digest、write-attempt rejection 与 package import boundary tests；
  - 无 HTTP、无 UI、无 schema migration。
2. **Slice 9B — Supervised MCP companion + simple local access**
  - utility process supervisor + strict MessagePort；官方 SDK Streamable HTTP；stable loopback endpoint、session、单一 access key、Origin rejection / Host / auth / limits；
  - Home → App settings 的 General / AI 分页；AI 页的一次性完整披露、Start / Stop、Copy Copilot config、应用内 VS Code 配置步骤、Advanced Reset key、轻量内存 activity；
  - 独立 MCP client 的 initialize / tools / pagination 互操作测试，并以 GitHub Copilot 做最终 agent integration。
3. **Slice 9C1 — Visual Evidence Contract**
  - 冻结 `VisualEvidenceBundle` / manifest schema、geometry adapters、三个坐标空间、screenshot spatial association、revision 生命周期与 byte / pixel / annotation limits；
  - 实现共享 page-scene 的专用 offscreen renderer、Set-of-Mark locator、focus、source-native / underlay 资产和有界 LRU；不接 MCP、不加 schema migration；
  - 完成 transform / pixel 确定性测试后才允许把视觉证据接到外部 client。
4. **Slice 9C2 — Entry context + MCP visual delivery + editable prompts**
  - bounded 单 Entry text / image-ref parser；`get_visual_evidence`、bundle-bound resource templates、ImageContent / ResourceLink 交付；
  - linked context、Agent Guide resource、built-in/custom Prompt Library、prompts/list/get/list_changed；
  - visual ownership、oversize / malformed / prompt-injection-as-data、prompt template validation、renderer non-write、multi-image composition 与真实 multimodal client handoff tests。

### Scenario-based tests

`scenario: AI Access is off by default and exists only while the app owns the workspace`

- 新安装 / 新机器配置下无 listener；首次 Start 明确说明这是当前 journal 的完整只读授权（结构化数据 + 文字 + 图片），确认后只监听 stable `127.0.0.1:<port>`。
- Stop / app quit / workspace switch 后 endpoint、sessions、cursors、resource links 全失效；再次 Start 才授权当前 workspace。
- companion crash 不使主应用退出；用户可重新 Start。

`scenario: a compatible Streamable HTTP client receives the complete read-only capability`

- 独立 clients 完成 initialize / protocol negotiation / session；tools / resources / prompts 一致，session-bound bundle 不可跨 client 读取。
- GitHub Copilot 在同一次 tool call 中实际收到 source locator / clean pair；不支持 image content 的 client 明确报告能力限制，而不是静默声称看过图片。

`scenario: connection security rejects every invalid, browser, or non-loopback request`

- 缺失 / 错误 / URL query token、错误 Host、LAN remote、任意非空 Origin、OPTIONS、额外 route、unsupported method / protocol version 全部拒绝。
- Stop 关闭 listener；Reset access key 立即使所有旧 HTTP 配置与 sessions 失效；错误不含路径、SQL 或 stack。

`scenario: every MCP operation leaves the journal domain digest unchanged`

- 对每个 tool / resource / prompt 运行正常、分页、错误与取消路径；再尝试 create / update / delete / tag / save / SQL 名称变体。
- 调用前后 canonical domain rows、canvas_json、stamp library 与 image bytes digest 完全相同；readonly DB 上任何 write statement 失败。

`scenario: structured searches preserve journal query semantics and exhaustible snapshot pagination`

- Entry 与 annotation level predicates、同一 annotation 共现、result predicates、SavedView 与 date range 结果同 Slice 7；一份 Entry 仍一行。
- 超过 1000 个相同业务条件的 rows 也可经多个窗口穷尽且无重复 / 漏项；期间新增数据不混入旧 snapshot sequence；TTL / app instance / client 不匹配时明确 expired。

`scenario: a single Entry context exposes bounded text and grounded annotation evidence`

- 服务 On 时可读 tags / bounds / results / links、受限 title / note 与视觉 resource；只解析该 Entry 且截断超限文本 / 对象。首次 Start 披露图片和机器可读文字都会提供给 client。
- journal 文本中的指令按 untrusted evidence 原样返回，不进入 tool description / prompt instruction。

`scenario: visual evidence deterministically maps annotation ids to chart pixels`

- overview 正确包含白页、多 screenshot 与全部用户 annotations；locator 与 overview frame / transform 完全一致，`A1 / A2` legend 映射正确，marks / leader 不覆盖目标 `paintBounds`；focus 保留真实 composition。
- rect / text / line / arrow / polyline / freehand / MeasuredMove / composite 在 scale / rotation / skew / flip / group transform 下得到正确 page geometry；arrow tip、stroke / arrowhead paint bounds、Path precision 与 unsupported 降级均显式。
- 单图唯一且完整时 source crop 的中心 chart pixels 与原始 decoded raster ROI 逐像素一致，reference gutter 不改 chart pixels；重复 hash 的实例、重叠截图、跨图 annotation、clip、奇异矩阵与边缘截断返回正确 association / warning，不偷偷挑 source。
- underlay 只在 source-native 不可用且可安全派生时出现，并带 `notUserVisibleComposition + removedAnnotationIds`；不能把它误作用户原图或 annotation 语义证据。
- forged / cross-entry source、path traversal、未知 annotation、伪造 / 过期 bundle、超 annotation / pixel / byte 请求被拒；响应无磁盘 path。offscreen renderer 不调用 store write，cache 只在内存并随 revision / Stop 失效。
- 至少一个真实 multimodal MCP client 证明 tool 的 ImageContent 与 resource image 最终都到达模型，并在同一次模型调用中同时交付 source locator / clean pair；不支持图像转发的 client 明确降级。已知 synthetic candlestick fixture 用于人工兼容评估 mark ↔ annotation 与 bar-count 表现，模型随机输出不作为 CI 硬门。

`scenario: the editable Agent Guide teaches compatible agents how to read this user's charts`

- 用户在 UI 写入颜色 / 形状 / stamp / 入场点 / 不可推断事项后，`agent-guide` resource 与每个 `prompts/get` 的首段都返回同一 revision；空 guide 不补系统猜测。
- journal 中含指令式文字时仍作为 untrusted evidence，不能覆盖 user-authored guide 或 server tool contract。

`scenario: editing the Prompt Library updates MCP prompts without granting prompt writes`

- built-in prompt 可编辑、disable、reset、duplicate；custom prompt 可新增 / 编辑 / 删除。invalid placeholder、重复 argument、超限 body 被 UI validation 拒绝。
- 在线 client 的 `prompts/list` 只列 enabled prompts；保存 / 启停 / 新增 / 删除后收到 `notifications/prompts/list_changed`；`prompts/get` 校验 arguments并返回 guide + resolved workflow。
- MCP 不存在 create/update/delete prompt tool；未知 prompt mutation request 被拒；配置只写 machine-local AI config，canonical journal digest 不变。

`scenario: evidence-first prompts cite reviews and never mutate or execute`

- 默认或用户编辑后的 prompts 先查 population / stats，再选 examples，视觉分析先读 guide 与 manifest，再用 `A-mark + annotationId + Entry id / date` 引证。回答区分 structured fact / observed / inferred / uncertain，并说明 small sample。
- bar count 只能在同 ROI 的 source-native locator / clean pair 上尝试：先用 locator 确认 A-mark 的边界，再在 clean 的未缩放 chart pixels 上计数。回答说明两端是否计入、数的是 candles 还是 intervals、crop 是否截断和置信度。无 guide、无完整 source pair、边界模糊或分辨率不足时只给范围或明确不能精确回答；绝不把视觉计数写成结构化行情事实。
- server 不发 sampling request、不调用 LLM、不自动执行 prompt、不生成 write tool call、不持久化报告或建议。

### 明确不做

- 任何 journal write tool / resource：不自动打 tag、改 result、写 note、建 SavedView、删 Entry、保存 AI 总结或执行“确认后写入”。**本 slice 不留 future write hook。**
- 任意 SQL、数据库文件下载、任意文件路径、全库 raw canvas_json / image dump、通用 filesystem resource。
- 内置聊天 UI、模型选择、API key 管理、模型调用、sampling、agent 编排、第三方 extension runtime / marketplace。
- embeddings、vector DB、全库全文索引、自动视觉相似度模型；结构化筛选后由外部 agent 按需看图。
- OCR / candle detector、截图转 OHLC、价格 / 时间轴绑定或精确 bar-count service；视觉 bundle 只提高 grounding，不把静态截图升级为行情数据。
- LAN / remote server、后台常驻 daemon、app 关闭后继续服务；远程 OAuth 属独立未来设计，不复用本地 token。
- 实时行情、预测、下单、回测、自动排名或把 AI 输出当作事实。AI 只能读取用户已记录的证据并在外部对话中提出分析。

### 依赖与完成定义

- Slice 9 当前只依赖 Slice 6 / 7 的词表与 query semantics，以及 image / canvas data contract；按用户要求不等待 Slice 8。Slice 8 将来落地后，statistics 接入是直接委托其 contract 的后续扩展，不改变当前 read boundary。
- Slice 9 完成 = 9A / 9B / 9C1 / 9C2 scenario tests 全绿 + Streamable HTTP client 与 GitHub Copilot 真实多模态 handoff 可用 + security / non-mutation audit 通过 + golden-DB 保持绿色。
- 未引入 schema / canvas_json migration；AI connection、token、session、cursor、cache、log 和 report 都不进入 journal data folder。

**实现状态（已落地，Slice 8 按要求跳过）**

- 已实现 7 个真实只读 tools：overview、vocabulary、Entry search、sample search、Entry context、linked context、visual evidence；`tools/list` 不含 statistics / data-gaps，也没有任何 write / SQL / filesystem 能力。
- 已实现 Streamable HTTP companion、loopback / Host / bearer / Origin 防护、session 与 rate / concurrency / cursor / image byte 上限、DPAPI 加密 access key、Start / Stop / Reset，以及 Home → App settings 独立 AI 页内的 Copilot 配置步骤、Agent Guide 与 Prompt Library。
- AI Supervisor、readonly repository、Fabric 与 Sharp 只在用户点 Start 后动态加载；AI Access Off 的正常 main bundle 保持轻量，不让可选 extension 拖慢每次应用启动。packaged `TradingJournal.exe` 已验证可加载 lazy chunk、Sharp / libvips 与 companion。
- visual evidence 已覆盖 exact Rect / line / arrowhead / polyline / MeasuredMove / text / group bounds、unsupported Path 拒绝 source pair、重复 hash screenshot instance、crop / transform、session / revision ownership，以及同 ROI source locator / clean pair。
- 真实 GitHub Copilot CLI integration 已通过：Copilot 实际调用 overview → search → context → visual evidence，在同一上下文收到 5 张图片，正确返回 `A1 → count-zone`、可见累计编号 `3, 6, …, 30`，并按 center-in-rectangle 口径数出 8 根 candle；随机模型输出不作为 CI 硬门，协议 / 像素行为由 deterministic e2e 固定。
- 最终验证：`npm run typecheck`、`npm run lint`、`npm run build`、`npm run package`、`npm run test:package-ai` 全绿；完整 Playwright + Electron suite **107 / 107** 全绿（list reporter、workers=1、测试窗口不抢焦点）。
