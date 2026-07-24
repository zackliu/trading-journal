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
13. **图层是绘制结构，不是分类**：journal 全局图层只决定截图与 annotation 的页面绘制顺序，不进入 tag/group、Annotation-Tag Index、SavedView 或统计；完整页面 `objects[]` 是唯一精确 paint order，过滤掉结构标题后的可排列对象子序列才按图层成块，不再持久化 numeric `zIndex`。系统基层永久最底；已用层的相对顺序不可改变，只有未被页面对象或 stamp 使用的空层可在建库时重排。

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
- Verified commands (Windows, Node 22.22, npm 10.9): bootstrap `npm install` (postinstall rebuilds better-sqlite3 for Electron); build `npm run build`; typecheck `npm run typecheck`; lint `npm run lint`; run `npm run dev`; default gate `npm test` (Vitest pure logic → build → full Playwright + Electron suite), unit-only `npm run test:unit`, or e2e-only `npm run test:e2e` after a prior `npm run build`; package `npm run package` (→ `dist/win-unpacked/TradingJournal.exe`).

## 4. Slice 1：Durable Entry & Annotation-Tag Store

目标：应用能把一次「创建 Entry」请求保存成**重启后可读**的 Entry 记录与 annotation-tag 投影，数据落在一个可移植文件夹里。

**用户动作流程与直觉逻辑**：用户仍看不到界面，但这层立下一条贯穿全程的直觉铁律——**一份复盘只存一次、永不复制**。他日后会把同一张复盘图归到许多 tag 下，心里默认「这还是那一张、我没在到处复制它」；正是「Entry 是唯一真相、tag 是派生投影」的建模让这个默认永远成立。

实现范围：

- 数据模型契约：`Entry`、`Annotation`、`Tag`（`group:value`）、`ResultDimension`（用户预定义维度：id、label、type ∈ `string` | `number`）、annotation 上的可选 `Result`（`{ dimensionId → string | number }`）、`SavedView`（TypeScript 类型 + schema 校验）。
- 可移植数据文件夹：解析/创建数据目录，内含 `app.sqlite` 与 `images/`。
- SQLite schema 与 migration：`entries`、`annotations`、`entry_tags`、`annotation_tags`、`result_dimensions`、`annotation_results`、`saved_views`。
- Electron main 进程内的 Entry Store：create / load 一个 Entry（image 引用、canvas JSON blob、entry tags；canvas JSON 内含每个 annotation 的 tag 与可选 result）。
- Annotation-Tag Index：`annotations`、`annotation_tags`、`annotation_results` 表作为 Entry 内 annotation 及其 tag 与 typed result 的去规范化投影，随 Entry 写入同步（annotation id、entry id、geometry(bounds)、tag、result 维度/值）；result 的类型以 `result_dimensions` 为准（string / number 分列存储）。文字超链接是独立投影，由 Slice 10 定义，不塞进 annotation 的分类投影。
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

**用户动作流程与直觉逻辑**：用户打开软件，看到的是一个像 PPT 一样眼熟的外壳——顶部一条 Ribbon、左边是他的复盘缩略图、中间一大块白页。他点「New」或直接 Ctrl+V 贴张图，中间立刻出现一张可涂画的白页，工具栏亮起来，他就能像在 PPT 上一样框选、画箭头、写字。直觉上「这一整块白页就是我这次复盘」、「截图只是我贴上去的一张图、能随便挪」、「新截图稳定落在基层上方、刚手画的东西一定出现在最高层最上面，不会一画完就被遮住」、「画完自动回到选择、鼠标一放就能拖」。这一版先把**外壳与画布手感**做成成品，后续每个 slice 只是往这套眼熟的布局里填真实行为，用户不必重新学界面。

实现范围分两部分。

**A. 主界面外壳（App Shell，一次把布局立好；除已接行为的部分外多为占位）**

- **单一 Office 式 Ribbon（无模式切换、无返回）**：顶部常驻一条 Ribbon（品牌 + 标签页 `Home / Draw / Tags / Browse / Stats`，每页内是带标题的分组命令），底部一条状态条（健康点 + 保存态「Saving… / All changes saved」 + zoom 控件）。命令按上下文启用 / 禁用：无复盘打开时 `Draw` 工具与删除置灰，无选中对象时删除所选 / 排列置灰；打开复盘自动切到 `Draw` 页。**编辑即自动保存**，故无「未保存」门控；手动 Save 按钮在 `Home` 页、全局 Ctrl+S 为习惯性「立即保存」（见 §8）。
- **主体左栏 + 中间画布，无 Daily / 编辑器两态切换**：左栏（group→tag 导航 + 复盘缩略图廊）｜中间（打开复盘时是 Canvas 编辑器，否则「开始复盘」空状态）。同一外壳常驻，打开复盘即在中间渲染画布，不再有「进编辑器 / 返回」两态。**Stamp 印章条不是独立右栏——自 Slice 5 起它并入中间这张画布**（复盘页右侧、一条细分隔线、共享同一缩放，见 §8）。
- **本 slice 已接行为的部分**：`Home`（新建 / 保存 / 删除复盘）、`Draw`（画布工具 / 样式 / 排列，见 B）、左栏复盘缩略图廊 + 右键「删除复盘」、状态栏 zoom 控件。
- **为后续 slice 预留的占位（图标 / 空面板 / 区域，无行为）**：**Stamp 印章条**（可复用组件，Slice 5 起并入中间画布右侧）、`Tags` 页（Slice 6 起改为 `Review` 页 = entry 级 tag + 快捷选择）、`Home` 的 Settings 词表窗口与选中标注才出现的 `Annotation` 上下文页（Slice 6）、左栏按单一 group 维度 pivot 分桶的**浏览行为**与 `Browse` 页（Slice 6）、搜索 / 布尔查询 / 保存视图入口（Slice 7）、`Stats` 页统计入口（Slice 8）。标注的 tag / result 编辑自 Slice 6 起走 `Annotation` 上下文页；稳定内部地址与文字超链接由 Slice 10 完成。
- 这些占位是**非功能骨架**（图标、按钮、空面板、区域标题），真正行为在各自 slice 接入，不在本 slice 实现。

**B. Canvas 标注层（本 slice 真正实现的能力）**

- **画布 = 一张固定尺寸的白色“页面”（复盘面）。** 页面尺寸**与贴入的截图无关**，新建复盘默认 **2900×1600**（随 Entry 存在 `canvas_json` 的 `tjPage:{width,height}`，日后可支持改页面尺寸）。白色底色始终存在，这张页面本身就代表这个复盘。几何坐标为页面像素坐标；显示缩放（zoom）只影响显示、不影响存储。
- **标题带 + 常规工作区（画布总尺寸不变）**：页面顶部切出一条约 **100px 的标题带** `[0,0,pageW,TITLE_H]`（一层极淡暖色底 + 底部发丝线，属 `tjChrome`——渲染、进缩略图、**不序列化、不算标注**）；下方 `[TITLE_H,pageH]` 是常规工作区（故比原来稍矮）。每个复盘恒有**一个标题文本框**（`tjRole:'title'`，横在带内、大字深墨、可自由编辑）：进 `canvas_json` 与缩略图，但**无 `tjId` 故绝不进标注索引**、**空时不被「空文本框自动丢弃」删掉**（显示淡灰占位 `点击添加标题`，打字即消失、不存为内容）、**不可单独删除**（`loadEntry` 若缺失即补一个，保证恒有）。**默认落点在常规区**：`fitActiveToCanvas`、首图 contain、新粘贴/截图都居中于 `[TITLE_H,pageH]`；但**手动画到标题带里不拦**（其它对象不做位置限制）。左栏不显示标题文字（空就空着），缩略图仍是整页快照、比例不变。
- **缩放（zoom）与适配窗口**：页面按一个 zoom 比例显示，状态栏右下角有 `−／滑块／＋／百分比` 控件（百分比 = 当前显示像素∶页面真实像素，100% = 1:1），与 PPT 一致。默认 **fit 模式**：自动缩放让整页放进可视区；窗口变大 / 最大化时 fit 比例随之变大。用户手动缩放则切到固定比例；点百分比回到 fit。画布大于可视区时容器出现滚动条。
- **截图是页面上的图片对象（可选中 / 缩放 / 移动 / 叠放），不是背景。** 每张截图按内容 hash 存 `images/<hash>`，在 `canvas_json` 里以 `tj-image://<hash>` 作为 `src` 引用（hash 引用，**非 base64 字节**）。允许在同一页面上**叠加多张截图**（例：把复盘图撑满页面，再从别处截一张小图贴在其上）。
- **截图不决定页面尺寸**：贴入的截图只是页面上的对象。首图按“适配页面(contain，保持比例、不失真)”居中放置，之后的截图按较小尺寸（约页面 60% 内）居中；**第一张与后续截图都走同一层级原语——插入基层最上面**，没有“首图特殊置底”分支。截图落地后可自由缩放 / 移动 / 改层级。
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
- **图层与适配**：用户手画的新 annotation 一律插入当前最高图层最上面；图片可右键“适配画布(Fit to page，保持比例、居中撑满、不失真)”。主页面右键与 Ribbon Arrange 提供八个无歧义命令：`层内上移一位 / 层内下移一位 / 本层置顶 / 本层置底 / 上移图层 / 下移图层 / 置于最顶部 / 置于最底部`；不提供任意“移到图层…”菜单。跨层命令只对单选启用；多选全部在同一图层时可做层内排列并保持相对顺序。具体图层目录、删除与 Stamp 目标层由 Slice 5 完成。
- **锁定 / 解锁**：右键任意对象可“锁定”——锁定后该对象**不能被点选 / 拖动 / 缩放 / 误删**（常用于把底图钉住，方便在其上标注），悬停显示普通光标而非移动光标；但**右键仍能命中它**，菜单相应变为“解锁”，并可继续执行上述排列命令。锁定状态随 `canvas_json` 持久化（对象上的 `tjLocked`）。
- 用户自建图章库（占位，后续实现）：把选中的单个形状保存为可复用 stamp；系统不预置固定图章、不支持组合 stamp。
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
- 第一张与后续每张截图都进入基层最上面；已有更高图层对象仍绘制在截图之上。
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

- 用户把一个形状保存为一个自定义图章；系统未预置任何默认图章。

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

## 7. Slice 4：Annotation Tagging、Result & 索引接线

目标：给画布上任意 annotation（框 / 文本框 / 箭头 …）打 group 下的 tag、并可给它设一个可选的 typed `result`，使它成为可查询、可统计、可高亮指认的元素；笔记就是可打 tag 的文本框 annotation。没有任何特殊标注类型。最终编辑入口是 Slice 6 的 `Annotation` 上下文页，本 slice 负责先立稳 annotation payload、typed result 与索引同步契约。

**用户动作流程与直觉逻辑**：用户用选择工具点中某个框 / 箭头 / 文字，Ribbon 像 Office 的上下文格式页一样出现 `Annotation` 页；他在同一个地方给**这枚标注本身**打 tag、（可选）登记结果，取消选择后页面自然消失。文本框没有另一套“笔记属性”机制：文字就是笔记，整枚文本框仍与任何形状一样承载 tag / result。所有分类与结果都跟着被选对象走，不需要在远处寻找一个常驻 Inspector。

实现范围：

- 选中任意 annotation → `Annotation` 上下文页：给它加 / 删 group 下的 tag（group 与 tag 值用户自定义），编辑即随 canvas 自动保存。
- 同一上下文页能给该 annotation 设 / 改 / 清可选的 `result`：从用户预定义的 result 维度里选维度并填值，值类型为 string 或 number（由维度定义决定）。result 只用于统计、不进浏览导航。
- result 维度管理：用户可预定义 result 维度（id、label、type ∈ string | number）；app 不预置维度。
- 笔记 = 文本框 annotation：其文本即笔记，本身也能打 tag；没有独立 note 字段。
- annotation 的 geometry 用 page 像素坐标；一个 Entry 可含多个截图对象与多个带 tag 的 annotation。
- 写入随 Entry 同步进 Annotation-Tag Index（tag 进 `annotation_tags`、result 进 `annotation_results`）。
- **不再有常驻 Inspector 右栏**——右栏让位给 Stamp 库（Slice 5）；标注的 tag / result 统一由 `Annotation` 上下文页编辑。对象级 links 不属于本 slice；引用能力由 Slice 10 的稳定地址 + 文字超链接统一承担。

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

Scenario-based test：`scenario: an annotation carries an optional typed result used only for statistics`

Given：

- 用户预定义了两个 result 维度：一个 number（如 R 倍数）、一个 string（如 回调深度）。
- 选中一个代表入场的 annotation，在 `Annotation` 上下文页设 R 倍数=1.0、回调深度=深；另一个说明文本框不设 result。

Expect：

- 该 annotation 的 result 进入 `annotation_results`（number 与 string 分列，类型以 `result_dimensions` 为准），可读回、可供统计；未设 result 的文本框在 `annotation_results` 无行。
- result 不出现在任何 group→tag 浏览导航或浏览高亮里——它只是 annotation 上的 typed 统计属性。
- 改 / 清该 annotation 的 result 后，索引同步更新。

**实现状态（已落地；其中旧对象级 Links 能力由 Slice 10 移除）**

- **数据模型与投影 — 已落地。** 画布上任意对象（矩形 / 线 / 箭头 / 水平线 / 文本框 / 自由手绘）在创建时被打上稳定 `tjId` 与空 `tjTags`，即成为可打 tag 的 annotation；截图（`FabricImage`）不带 `tjId`，不是 annotation。`tjId / tjTags / tjResult / tjLinks` 随 `canvas_json` 持久化（`toObject` 白名单）并在重开时复活——没有任何一种 annotation 类型被特判。
- **投影进 Annotation-Tag Index**：编辑器保存路径改为 `updateEntryCanvas(id, canvasJson, annotations)`，同一事务里写 `canvas_json` 并把 `controller.extractAnnotations()`（读对象的 `tjId` + `getBoundingRect()` 页面像素 bounds + tags/result/links）投影进 `annotations / annotation_tags / annotation_results`，**不触碰 `entry_tags`**（那是 Slice 6）。tag 查询与 result 读回只走索引，不读 canvas JSON。
- **右键浮窗（`shell/TagPopover.tsx`）取代常驻 Inspector**：右键任意 annotation → 上下文菜单「Tags & result…」→ 贴着对象弹出浮窗；用**本地草稿**编辑 **Tags**（chip + kebab 校验）、**Result**（按维度 number/string，`<details>` 内可定义新维度——定义维度是全局动作、即时生效）、**Links**（Copy as link target / Link to copied / 列表带 Go 跳转 + ✕）。**Save 提交（`applyAnnotationEdits` 整体写回 + `saveCanvas` 投影）并收起；点浮窗外 / Esc 取消未保存改动并收起**。常驻 Inspector 已移除，右栏成为 Stamp 库占位（Slice 5）。
- **单向 link 跨 Entry**：浮窗「Copy as link target」把该 annotation 记入 App 级 `linkClipboard`（跨 Entry 切换保留）→ 在别处的浮窗「Link to copied」把它加入草稿 links、Save 写回 `tjLinks`；`locateAnnotation(id)` 解析所属 Entry，「Go」跳到该 Entry 并选中目标（`CanvasEditor.onLoaded` + `controller.selectAnnotationById`）。反向「谁 link 到我」由查询 links 得到，不存反向边。
- 契约 / DB 表 / 投影函数 / 边界校验（`annotationsSchema`、`result_dimensions` typed result 分列存储）在 Slice 1 已建，本 slice 是「画布 ↔ 索引 ↔ 右键浮窗」的接线。新增 `tests/e2e/annotation-popover.spec.ts` 覆盖四个 scenario（打 tag 即可查询 / 未打 tag 不入查询 / typed result 增改清 / 跨 Entry link + 跳转），连同既有 17 项共 21 项 e2e 全绿。

## 8. Slice 5：Stamp 库（可复用绘图调色板）

目标：Stamp 库是主复盘画布**同一张画布上**的一条**印章条（strip）**——复盘页在左、一条**很窄的分隔线**、右边是装用户可复用绘图印章的印章条；页与条**都是白色、共享同一缩放**。同时建立 journal 全局图层目录：基层永久最底，已用层的相对顺序受保护，完全空的用户层可在建库时调整位置；页面对象按“图层 + 层内顺序”稳定绘制，每枚单对象 stamp 指定一个目标图层。用户从印章条拖出 stamp 时，副本不仅带 tag，也直接落到预定视觉深度，不再取决于拖出先后。

**用户动作流程与直觉逻辑**：用户打开图层管理，列表顶部明确写“最上层 / 覆盖下方”，底部明确写“最下层 / 固定基层”。他从永久基层向上添加自己理解的层次并命名；刚建且尚未使用的层显示绿色“空图层 · 可拖动调整”和拖动手柄，拖过层间时插入线展开预告落点。层一旦承载页面对象或 stamp 就显示锁定状态，不能再拖乱；改名和删除仍走各自入口。页面对象右键时，第一眼先看到它隶属哪个图层；高频的「挪上 / 挪下」就在一级，低频排列收进「其他选项」。他画了个满意的标记，解开顶部的**调色板锁**，把它拖进印章条，原对象当前所属层就成为这枚 stamp 的目标层；解锁状态下右键 stamp，菜单顶部和「选择图层」入口都显示当前层，展开后当前项带勾，点另一个层即可切换。以后任何复盘里（默认锁定），他把 stamp 往页面一拖：原件纹丝不动，半透明副本落地后自动进入目标层最上面。直觉上「建库时空挡位可以整理，装入内容后层次就稳定」「图层决定它应该压住谁，层内顺序才决定同类对象谁在前」「Stamp 只记落层，不在库里谈前后移动」「主页面才是我微调前后关系的地方」。新截图无论第几张都进入基层最上面；新手绘永远进入最高层最上面，所以刚创建的内容立即可见。

实现范围：

- **journal 全局图层目录**：新增稳定 `CanvasLayer { id, name }` 契约与持久化表。初始化一个稳定 id 的基层；基层永远最底、不可删除，允许重命名。用户层新增到当前最高层上方；全 journal 中 `objectCount=0 && stampCount=0` 的用户层可拖动重排，已用层无拖动入口。main 在提交完整顺序时重新扫描使用情况，要求 id 恰好完整一次、基层仍为第一项、全部已用层的相对序列不变；成功只更新目录 `sort`，不改写 Entry 或 stamp JSON。图层名称是显示词，不是 tag/group，不进入查询与统计。
- **页面绘制不变量**：每个截图与 annotation 在 Fabric JSON 中持久化 `tjLayerId`；结构标题与 `tjChrome` 不进入图层。完整页面 `objects[]` 仍是唯一精确 paint order；过滤掉结构标题后的可排列对象子序列从底到顶规范化为「基层对象 + 各上层对象」，同层对象连续且保持层内顺序，结构标题在完整数组中的固定位置不被排列命令移动。缩略图与 AI 视觉证据直接消费完整数组，不增加 numeric `zIndex`。Stamp strip 的对象数组只表达条内展示顺序，stamp 的 `tjLayerId` 仅表达落地目标层。
- **统一插入规则**：第一张与后续截图都插入基层最上面；新手绘 annotation 插入最高图层最上面；内部复制 annotation 保留源图层并插入该层最上面；stamp 副本插入其目标图层最上面。截图落地后可以像普通页面对象一样改层。
- **主页面排列命令**：Ribbon 直接提供 `层内上移一位 / 层内下移一位 / 本层置顶 / 本层置底 / 上移图层 / 下移图层 / 置于最顶部 / 置于最底部` 八个差异化图标按钮。右键菜单顶部显示当前隶属图层，一级只留高频「挪上 / 挪下」，其余六项进入「其他选项」二级菜单。上移图层进入紧邻上层最下面，下移图层进入紧邻下层最上面，绝对置顶进入最高层最上面，绝对置底进入基层最下面。不提供“移到图层…”菜单。多选时所有跨层命令禁用；只有全部选中对象同属一层时才启用层内排列，并保持其相对顺序。无实际变化时不写 history、不触发 autosave。
- **对象边界**：截图可以执行全部排列命令；锁定对象仍可由右键排列，锁定只冻结位置、尺寸和删除。结构标题不出现在图层管理里，也不响应排列。Palette 锁定时 Stamp 不开放右键编辑；解锁后 Stamp 右键只显示当前目标层与「选择图层」二级菜单，不显示任何层内/跨层排列命令。当前层带勾，选择新层与 Annotation Ribbon 的 Target layer 共用 `setStampTargetLayer`，只改 `tjLayerId`，不改变 stamp 在条中的位置。
- **删除图层 = 不可撤销的向下合并**：删除任一用户层时，该层在所有 Entry 中的对象全部改属紧邻下方图层，stamp 目标层也改为该下方层；因两个层原本相邻，只改 `tjLayerId`、绝不移动任何 `objects[]` 元素，故所有页面与 stamp strip 的绘制顺序保持不变。删除空层也要确认；基层无删除入口。删除不进入当前 Entry 的 undo。
- **严重警告与原子提交**：删除前对全 journal 统计受影响的 Entry、页面对象与 stamp 数量，明确显示并入的下方图层，文案说明“对象内容不会删除，但原图层结构无法恢复”，确认按钮为危险操作“删除并合并”。main process 先结构化解析并校验所有受影响文档，再用一个 SQLite transaction 同时更新图层目录、全部受影响 Entry 和 stamp library；任一步失败全部回滚，不能由 renderer 逐 Entry autosave 拼接。
- **v10 forward migration**：在现有 migration 链末尾追加迁移，创建基层与图层目录；为所有既有截图、annotation 与 stamp 写入基层 id，结构标题不写，保持每份 `objects[]` 的原顺序、几何、id、tag、result、`tjTextLinks` 与图片引用不变。任一 canvas/stamp JSON 损坏则整次迁移回滚；沿用迁移前自动备份与 too-new guard。新增带真实 stamp library 数据的 golden fixture，不能继续依赖 stamp 行为空的 v7 fixture 证明安全。
- **Stamp 库 = 主画布右侧的印章条**：与复盘页同处**一张 Fabric 画布**（`page[0..pageW] ｜ gap 分隔线 ｜ strip`），**共享同一缩放**、跨区拖动**连续不裁剪**。对象归属由**位置分区**决定（中心 x 落在页区还是条区）。页与条都是白色纸面，只由一条很窄的分隔带区分。**只含绘图、不含截图**。
- **存储按区拆分**：`serializePage()` 只写页区对象 → Entry 的 `canvas_json`；`serializeStrip()` 只写条区对象 → 全局 **Stamp store**（存一份、跨复盘、独立于任何 Entry）；`serializeAll()` 供撤销 / 重做。`extractAnnotations()` 只投影**页区**标注（条区 stamp 不进 Entry 索引）。
- **调色板锁（默认锁定）**：功能区一个锁。**锁定态 = 固定库**：条里 stamp 拖到页 = **复制**（半透明幽灵→实体、原件不动、新 id）；条内挪动 / 页对象拖进条一律**弹回**（不改库、不新增）。**解锁态 = 整块画布如一体**：在页与条之间自由移动——把 stamp 拖到页 = **移出调色板**（成为该页标注、**同 id**、非复制，库相应少一枚）、把绘图拖进条 = **变成 stamp**、条内挪动 = rearrange。
- **拖出＝复制到页（半透明幽灵→实体）**：锁定态在 stamp 上按下拖动，跟随光标的是**一份半透明副本（幽灵）**——**印章原件不选中、不移动**；落到页那一刻幽灵变实体，是一个**新 annotation（新 `tjId`）**，进入 stamp 的目标图层最上面，**带几何 + 样式 + tag，不带 result**（result 是某笔交易的结果，复制它无意义）。若 stamp 的可编辑文字含文字超链接，副本像普通 Office 文字复制一样保留同一 target 的 `textLinks`；可见的链接样式不会在落地时失效。落下副本即刻按其 tag 进入该复盘索引、可查。**库不变**（拖出不写库）。
- **拖入＝移动进条（仅解锁）**：把页上一个绘图拖过分隔线进条 → 它**离开复盘、成为 stamp**（带当时的 tag，并保留原 `tjLayerId` 作为目标层）；写库 + 写该复盘。因同画布同缩放，尺寸与拖动都连续一致。截图（无 `tjId`）拖进条会被弹回（截图不能当 stamp）。
- **Ctrl+C / Ctrl+V ＝统一的「把剪贴板粘到页面」**：Ctrl+C 复制选中绘图到内部剪贴板；Ctrl+V 粘贴内部 annotation 时保留源图层并进入该层最上面；系统剪贴板中的截图则统一进入基层最上面。两者仍使用同一“把剪贴板内容物化为页面对象”入口，不按第一张/后续截图分叉。
- **单个对象为单位**：不做组合 stamp（一次拖一个对象）。
- stamp 携带的 tag 就是它被拖入时带的 tag（可有可无、纯视觉印章就没 tag）；要改库内 stamp 的 tag 或目标图层，先解锁并选中它，再走同一上下文入口，不另造一套排列菜单。

Scenario-based test：`scenario: dragging a stamp onto a review drops a tagged copy while the palette keeps the stamp`

Given：

- 库里有一个带 `<group>:<value>` 的 stamp；打开某复盘。

Expect：

- 从库拖到画布 → 该复盘多出一个**新 id** 的 annotation，带该 stamp 的 tag，按该 tag 可查到它、母 Entry 是当前复盘。
- 副本进入 stamp 指定的目标图层最上面；该层以上对象仍在它上方，该层以下对象仍在它下方。
- 库里那个 stamp 仍在、内容不变（拖出是复制，不搬走）。

Scenario-based test：`scenario: a dropped stamp copy carries tags and text hyperlinks but not result`

Given：

- 库里一个文字 stamp 带着 tag、result，并含指向某个现存 Entry 的超链接。

Expect：

- 落到画布的副本带 tag，文字超链接仍指向同一 Entry，但 `result` 为空。

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
- 副本保留原件的图层并进入该层最上面。

Scenario-based test：`scenario: empty layers can be arranged while every used layer keeps its protected order`

Given：

- 一个迁移到当前 schema 的 journal，尚未创建用户图层。

Expect：

- 图层管理只显示一个稳定 id 的基层；基层固定在列表最下方，没有删除或重排入口，但可以重命名；列表顶部和底部明确说明覆盖方向。
- 连续新增两个图层时，它们依次追加到当前最高层上方；未使用层显示拖动手柄与层间插入预告，可插入任意两层之间。
- 任一层被页面对象或 stamp 使用后立即变为锁定状态；renderer 不提供拖动入口，main 也拒绝任何改变已用层相对顺序或移动基层的请求。
- 空层重排前后，全部 Entry 与 stamp 的 `canvas_json` 逐字不变，既有对象 paint order 与视觉遮挡关系不变。
- 重命名只改变显示名，页面对象与 stamp 的稳定图层引用、绘制顺序和缩略图均不改变。

Scenario-based test：`scenario: screenshots share one base-layer insertion rule while new drawings stay visible`

Given：

- 页面已有基层对象、两个上层对象；用户依次粘贴第一张和第二张截图，然后手画一个矩形。

Expect：

- 两张截图都进入基层最上面，第二张在第一张上方；不存在首图特殊置底路径。
- 原有上层对象仍绘制在两张截图上方。
- 新矩形进入当前最高图层最上面，创建完成时立即可见。
- 截图落地后可由单选跨层命令移出基层。

Scenario-based test：`scenario: layer-local arrange commands never cross a layer boundary`

Given：

- 基层、一个中间层和最高层各有多个重叠对象；选择中间层中的一个对象。

Expect：

- `层内上移一位 / 层内下移一位` 每次只跨过本层紧邻的一个对象；到本层边界后命令禁用。
- `本层置顶 / 本层置底` 只移动到本层首尾，`layerId` 不变，其他层对象顺序不变。
- 无实际变化的边界命令不新增 undo history，也不触发 autosave。
- 保存、关闭并重开后，层归属与层内顺序完全一致。

Scenario-based test：`scenario: single-object cross-layer arrange uses exact boundary insertion positions`

Given：

- 页面从底到顶为 `基层[B1,B2] ｜ 中层[M1,M2] ｜ 顶层[T1,T2]`。

Expect：

- 对 `M1` 执行“上移图层”后得到 `中层[M2] ｜ 顶层[M1,T1,T2]`；它只进入紧邻上层一次并落在该层最下面。
- Undo 后对 `M1` 执行“下移图层”得到 `基层[B1,B2,M1] ｜ 中层[M2]`；它落在紧邻下层最上面。
- “置于最顶部”进入最高层最上面；“置于最底部”进入基层最下面。
- 最上层对象的“上移图层”和基层对象的“下移图层”禁用；每个有效命令恰好一个 undo/redo 步骤。

Scenario-based test：`scenario: multi-selection can reorder within one layer but can never change layers`

Given：

- 用户多选同一层中的若干对象，随后又建立一个跨层多选。

Expect：

- 同层多选可执行四个层内命令，选中对象保持原相对顺序并作为稳定块移动。
- 任意多选状态下，`上移图层 / 下移图层 / 置于最顶部 / 置于最底部` 全部禁用。
- 跨层多选时四个层内命令也禁用；任何禁用命令都不改变 canvas、图层归属或 history。

Scenario-based test：`scenario: locked objects remain arrangeable while the structural title stays outside layers`

Given：

- 页面有一个锁定截图、一个锁定 annotation 和结构标题。

Expect：

- 两个锁定页面对象仍可从右键执行层内与跨层排列，之后继续保持锁定。
- 结构标题不出现在图层对象列表，不带 `tjLayerId`，也不响应任何排列命令；标题带与 `tjChrome` 永远不被普通对象的“置于最底部”压住。

Scenario-based test：`scenario: deleting a used layer merges downward without changing any visual order`

Given：

- journal 有 `基层 ｜ L1 ｜ L2 ｜ L3`；多个 Entry 在 `L2` 有页面对象，stamp library 也有目标为 `L2` 的 stamp；各层对象互相重叠以便观察遮挡。

Expect：

- 删除对话框显示受影响的 Entry 数、页面对象数、stamp 数和目标下方图层 `L1`，明确“对象内容不会删除，但原图层结构无法恢复”，危险按钮为“删除并合并”。取消时 canonical journal digest 完全不变。
- 确认后所有 `L2` 页面对象与 stamp 目标只改属 `L1`；每份页面和 stamp strip 的 `objects[]` 元素、顺序、geometry、id、tag、result、`tjTextLinks` 与图片引用逐项不变。
- 删除前后主页面、缩略图和 AI clean overview 的像素遮挡顺序一致；tag 查询、统计与 brief-highlight 结果不变。
- Ctrl+Z 不恢复被删除图层；应用重启后原图层结构仍不存在。

Scenario-based test：`scenario: top, empty, base, and failed layer deletions obey the hard boundaries`

Given：

- journal 分别存在一个有对象的最高层、一个无页面对象但仍被 stamp 引用的层、一个真正空层和永久基层。

Expect：

- 删除最高层时对象并入紧邻下层最上面，原全局顺序不变。
- 被 stamp 引用的层不是空层；删除时必须统计并改写该 stamp 目标。真正空层仍显示严重确认，确认后只删除目录行。
- 基层没有删除入口；即使绕过 UI 调用契约也被拒绝，journal digest 不变。
- 故障注入使任一受影响 Entry 的 canvas JSON 校验失败时，图层目录、所有 Entry 与 stamp library 在同一个事务中全部回滚，不留下半合并状态。

Scenario-based test：`scenario: an older journal migrates every drawable into the base layer without reordering`

Given：

- 一个 schema v9 golden journal，含多个 Entry 的重叠截图/annotations、结构标题，以及真实非空的 stamp library；对象带 tag、result、文字链接和图片引用。

Expect：

- 升级创建永久基层；所有既有截图、annotation 与 stamp 都引用基层，结构标题仍无图层归属。
- 每份 page/stamp `objects[]` 的元素和原顺序完全不变，所有 review、annotation、tag、result、`tjTextLinks`、图片 hash 与视觉遮挡关系均保留。
- migration 前生成 v9 backup，schema 升到 v10；损坏任一 canvas/stamp JSON 会让整个 migration 回滚并保持原数据库不变。

**实现状态（Stamp 基础 + journal 全局图层已落地）**

- **journal 全局图层 — 已落地。** Schema v10 追加 `canvas_layers` 与永久基层；migration 结构化升级全部 Entry/stamp JSON，给 drawable 写 `tjLayerId:'base'`、跳过结构标题并保持数组顺序，golden v7 fixture 现含真实旧 Stamp。main-owned `canvasLayers` store 提供只向上新增、稳定 id 重命名、全 journal usage 摘要、仅空层重排、删除预检和单事务“向下合并”；重排边界要求基层不动且全部已用层相对顺序不变，成功只更新既有 `sort`，无 schema/canvas migration。Home → 图层管理以顶部/底部方向标、空层手柄、已用锁定态和动画插入线表达堆叠关系；删除显示 Entry/对象/Stamp 计数与不可恢复警告，成功后强制重载当前 Canvas。
- **插入与排列 — 已落地。** 第一张/后续截图统一插入基层顶部，手绘插入最高层顶部，复制保留源层，Stamp 按目标层落地；Annotation 页与解锁 Stamp 右键共用目标层选择。CanvasController 只重排页面 drawable slots，标题/chrome/strip 不动；Ribbon 提供八个中文精确命令及八枚可区分图标，右键顶部显示隶属层、一级只留「挪上 / 挪下」、其他六项进入自适应左右展开的「其他选项」二级菜单。多选只允许同层排列、全部跨层命令禁用，边界 no-op 不写 history。`canvas-layer-store.spec.ts` 与 `canvas-layers.spec.ts` 覆盖目录、usage、空层拖排不改任何 JSON、已用层拒排、菜单真实展开 opacity、Stamp 当前层勾选/切换、插入、层内/跨层边界、多选、严重删除与迁移。
- **迁移数据安全加固 — 已落地。** 既有库先经 readonly too-new probe，拒开时主库与 sidecar 零残留；迁移前必须完成并验证 WAL checkpoint，备份先写临时文件、独立 `quick_check` + schema version 校验后才原子改名。一次打开的整条 pending migration chain 与所有 `user_version` bump 共用一个事务，任一步失败都回到起始版本；异常连接显式关闭。v9 golden 逐对象证明完整 canvas 树除新增 `tjLayerId` 外不变，v7/v9 malformed fixtures 以文件 SHA-256 证明失败后源库完全不变，生成的备份可独立恢复。

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

**用户动作流程与直觉逻辑**：用户脑子里是「这张复盘的 day structure 是 X、品种是 NQ」——这些是**关于整张图的属性**，跟贴在某个框上的 tag 分得很清。他先在 `Home → Settings`（独立窗口）把词汇建好：group「day-structure」下若干值、group「symbol」下若干值……（系统不预置任何目录）。回到某张复盘，`Review` 页上就摆着他钉上来的几个 group 的快捷选择，点一下就打上，非常省事。当他用选择工具点中画布上某个标注时，Ribbon **像 Office 一样出现并自动进入 `Annotation` 上下文页**（正如点中图片后进入 Shape Format），里面**同一套** group & tag 快捷选择，只是这次打给这个标注；刚画完标注产生的自动选中仍停在 `Draw`，不会打断连续绘图。浏览时，左栏顶部是一个**看起来就可点**的维度选择器（默认「All reviews」）：点开像下拉一样列出他建的所有 group，选一个（比如 symbol），左栏立刻按这个维度分成一段段可折叠的桶（NQ、ES……），每段里是命中的复盘缩略图；点一张在中间看大图，**带这个 tag 的标注亮 ~1.5s**——他一眼就知道「这张为什么归到 NQ」。选「All reviews」则是所有复盘按**年-月**自动分段（隐性时间结构，不是他建的 group、也不出现在 Settings 或打标签选项里），保证每张复盘一定有处可现。同一张图出现在好几个桶里时，他清楚**还是那一张、没有副本**。

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
- **`Annotation` 上下文页**：**仅在选中某个 annotation 时出现**。用户用选择工具直接点击 annotation 时，Ribbon 自动进入该上下文页，可立即打 tag 或登记 result；刚完成绘制、Stats 证据定位等程序化自动选中只让该页出现，仍保留当前页签，避免打断连续动作。取消选中即隐藏，Ribbon 回 `Draw`。该页承载**与 `Review` 页完全相同**的一套 group & tag 快捷选择，作用于选中的 annotation；二者共用同一个快捷标签控件（target = 整张 Entry 或选中 annotation），不写两套。
- **标注的 tag 编辑从右键浮窗迁到 `Annotation` 上下文页**；`Annotation` 页在 tag 快捷选择之外还**并排承载结果登记**（result 维度：`choices` 预设值单选 chips / `number` 数字框，与 tag 一个手感）。右键不再承担 annotation 属性表单；Slice 10 在同一上下文菜单上提供 `Copy link`，并只在文字选区 / 既有超链接上显示对应的链接命令。**结果类型（result 维度与其预设值）在 Home 的「Settings → Result」注册表里声明**，镜像 group & tags 的注册表设计（migration 006 加 `result_dimension_values`）。

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

- 用户点击矩形后，Ribbon 出现并自动进入 `Annotation` 上下文页；刚完成绘制的自动选中仍停在 `Draw`；取消选中即隐藏。
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
- **渲染层**：Ribbon `Tags` 页改为 **`Review` 页** + 选中标注才出现的 **`Annotation` 上下文页**（用户点击 annotation 时默认进入；绘制完成或 Stats 定位造成的自动选中不抢当前页），二者共用 `shell/QuickTag.tsx`：每个 pinned group 是**固定宽度块**（组间细线分隔、applied 浮到最前、长名省略号 + 悬停、放不下收成 **`+N` → 每组一个限高可滚带搜索的伸缩板**，浮层盖画布、点外即收；**只选不建**）；`Home` 的 **Settings** 开 `shell/SettingsDialog.tsx` 独立模态窗做词表增删 + pin + **拖排序**（`shell/SortableList.tsx` 手写指针拖拽、兄弟项平滑让位；group 与值都带 ☰ 拖柄；`sort` 落库 migration `005`；**新建值只在此**）；左栏 `shell/GroupBrowser.tsx` pivot 浏览（维度下拉 + 值桶 / 年-月手风琴 + 折叠 / 全部展开）；`canvasController.flashTagHighlight` 在 `after:render` 画 **~1.15s 柔和琥珀光晕**（device-space 分层 shadow-blur，短促 bloom 后向外溢出淡出；无硬描边、不覆盖对象内部；派生、`capturing` 挡缩略图、不落库 / 不入 history）；Slice 4 右键浮窗收敛为 **Links**（result 编辑迁至 `Annotation` 页）。
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

**实现状态（Slice 8A / 8B / 8C 已落地）**

- **统计 contract 与查询边界已落地。** `shared/domain.ts` 定义 `StatsScope / StatsQuery / StatsReport / StatsExamplesQuery`；main 侧 `store/statistics.ts` 只读 annotation-tag index、entry tags、result registry 与 `entries.created_at`，同一份 population rows 同时驱动 report、exact examples 和 date-scoped Scope Entries。typed IPC 全部经 zod 校验；不读 `canvas_json`。
- **纯聚合已落地。** `store/statsAggregate.ts` 负责 mean、奇偶 median、number threshold、string distribution、coverage、overlap 与 exact segment membership；零分母统一返回 `null`。Vitest 2 覆盖 5 条纯数学 contract，默认 `npm test` 已把 unit gate 纳入全套。
- **Overall workspace 与 evidence loop 已落地。** Stats 首次复制当前 View 的 Entry / annotation 分类条件并剥离 result predicates；Ribbon 提供 Sample、All / 30D / 90D / Custom、单一 Measure、number condition 与一个 Compare group。全宽 workspace 显示 scope Entries、population samples、contributing Entries、recorded / missing 与明确分母；默认 `active-result-bearing` 全程使用 result-bearing 限定文案，不冒充 eligible coverage。
- **单组 Compare 已落地。** Entry / annotation level 明选；cohort 按词表顺序，保留实际使用的 archived / unregistered values 与 `No value`；多值样本允许进入多行并显示 overlap，Overall 始终按 unique annotation 计算。string 颜色跨 Overall / cohort 保持同值同色，number / string 的 cohort 指标都能回看精确证据。
- **证据与数据安全已落地。** 任一 Overall / cohort / recorded / missing / string segment / threshold 可回既有 rail + canvas；同 Entry 多样本用 Previous / Next 普通 selection，不触发 result highlight。evidence session 绑定 dispatch-time query + revision，Entry 删除或 result 编辑会重算；进入 / 返回 Stats 必须先完成当前 canvas save，失败时留在编辑器并显示保存错误。Stats 配置、report 与命中 id 全为 session state，不建 SavedView、不复制 Entry、不落库。
- **持久化契约未变化。** 无 SQLite migration、无 `canvas_json` 变化、无第二份 artifact / report store。专项为 5 / 5 Vitest + 11 / 11 Statistics Playwright；最终 `npm run typecheck`、`npm run lint`、`npm test` 全绿，完整 Playwright + Electron suite **118 / 118**。

## 12. Slice 9：Read-only AI Access Extension（post-MVP）

目标：用户可以让**自己选择、自己信任的兼容 agent**读取当前 Trading Journal 中的结构化复盘与视觉证据，帮助完成近期复盘、分类对比、反例 / 离群样本检查、相似案例回看、文字超链接脉络追踪与数据完整性审计。Trading Journal 只提供本机、按需、可撤销的只读 MCP 数据能力；它不内置模型、不绑定供应商、不替用户保存 AI 结论，并且**永远不向 agent 暴露任何 journal write 能力**。当前 MCP tool surface 不提供通用 statistics / data-gaps tool；后续若增加，必须直接委托 Slice 8 contract，不能在 AI layer 另做一套统计。

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
  - 「沿着笔记文字里的内部超链接，回顾我当时如何修正判断。」
5. Agent 先调用有界结构化查询，再为少量候选 annotation 请求视觉证据包。包同时提供已提交页面、编号 locator、局部 focus、可用时的原始截图 native crop，以及 annotation geometry ↔ screenshot instance 的结构化映射；不会先把整个 journal 和全部图片一次性塞进上下文。回答引用 `A1 + annotationId + Entry date / id`，并把结构化事实、视觉观察与推断分开。若后续增加通用 statistics tool，它直接委托已落地的 Slice 8 contract，不由 AI layer 预做另一套统计。
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
  | { op: 'create-visual-artifacts'; input: VisualArtifactPlanRequest }
  | { op: 'advance-progressive-reveal'; input: ProgressiveRevealAdvanceRequest }
  | { op: 'read-resource'; input: { uri: string } };
```

`JournalReadRequest` 是唯一封闭联合；其中不存在 journal mutation、raw SQL、raw canvas JSON、filesystem path、filesystem write 或 generic method 字段。visual artifact plan、逐帧 reveal 与 artifact byte chunks 都是只读派生。每个 input 都有 runtime validation；MCP tool 返回 typed `structuredContent`（另带兼容 text JSON）。

### MCP Tools（少而强、组合使用）

| Tool | 用途与主要输入 | 有界输出 |
| --- | --- | --- |
| `get_journal_overview` | 当前 journal 的 Entry / sample 数、effective date 范围、group / result / SavedView 数、各 result recorded count | 小型摘要 + server / app / schema / read-api version；不输出全词表 |
| `list_vocabulary` | `kind = groups / results / saved-views`、includeArchived、cursor | 稳定 id、label、type、usage count / query 描述；分页 |
| `search_entries` | typed `ViewQuery` 或 `savedViewId`、date range、sort、cursor | Entry id / date / entry tags / matching sample count / context resource link；Entry 为单位 |
| `search_samples` | Entry predicates + 同一 annotation 共现的 tag / result predicates、date range、result existence / missing、稳定排序、cursor | annotation id / bounds / tags / results + Entry id / date；不读 canvas JSON |
| `prepare_sample_study` | 显式 annotation/result population、可选 date、result dimensions、明细 / nearby-text 上限 | 一次返回 exact sample / Entry 分母、recorded / missing、string counts / number summary、按 Entry 聚合的命中样本与邻近文字、可直接传给 batch visual 的分包计划 |
| `get_entry_context` | 单个 `entryId` | Entry tags、indexed annotations、results、受限 title / text objects 及其 `textLinks`、media resource links；不返回 raw JSON |
| `get_linked_context` | 起始 `InternalLinkTarget`、depth（默认 1、最大 2） | 有界文字超链接图：source text/range/display、typed target、循环与 broken target；节点 / 边数硬上限 |
| `get_visual_evidence` | 单个 `entryId` + 0..8 个属于该 Entry 的 `annotationIds` | 创建 revision-bound `VisualEvidenceBundle`；无 annotation 时用于安全列出 screenshot instances，有 annotation 时另返回 locator / focus / source pair；不接受任意 image id / path / bbox |
| `get_visual_evidence_batch` | `prepare_sample_study.visualBatches[n].requests`；最多 4 Entries / 8 annotations | 一次返回跨 Entry manifests 与有效图片；所有图片共享 inline byte budget，source locator / clean pair 原子纳入或省略 |
| `create_visual_artifacts` | `bundleId` + 1..16 个 typed specs；source spec 另选 bundle 内 `screenshotId` | 创建 immutable、revision-bound artifact plan；可产出原始存储 bytes、instance source window、source/page ROI、annotation context、bar alignment probe 或已接受 proposal 的 progressive reveal |
| `advance_progressive_reveal` | `planId + planHash + revealId + action = start / next / previous / seek` | 每次只返回当前一帧与进度；同一调用不暴露后续 frame resource link，避免分析 agent 一次看到未来序列 |
| `read_visual_artifact_chunk` | `planId + planHash + itemId + offset + maxBytes` | 按最多 768 KiB raw bytes 返回 base64 chunk、next offset、总长度、checksum 与建议文件名；让具备 repo / terminal 工具的外部 agent 自己保存，不接收路径 |

- 不提供通用 `get_media` tool。`get_visual_evidence` 只编排一个有界证据包；inline image content、resource read 与后端缓存全部复用同一 VisualEvidenceService、ownership check 与 bundle revision，不形成第二条媒体权限路径。
- 不提供通用 image command 或 filesystem tool。原图、所有 crop、probe 与 reveal frame 必须走同一 VisualArtifactService；每个 source selector 都是当前 session 的 `bundleId + screenshotId`，不能用 image hash 或磁盘路径创建旁路。
- Companion 对一份 single / batch visual result 只发一次内部 `read-resources` RPC 读取全部图片，不再每张图单独跨进程往返。Agent 应优先使用 study / batch 工具，只有追查单张异常时才回退到 search / context / single visual 原语。
- 不提供任意全文搜索、embedding 或视觉相似度 API。Agent 可以先用结构化 tag / result 缩小候选，再读取少量图片自行比较；不能为了“相似案例”扫描全库 canvas JSON 或建立隐形向量库。
- `search_samples` 保持 Slice 7 的同一 annotation 共现语义。当前 `tools/list` 明确没有通用 statistics / data-gaps；后续若接入，只能直接复用 Slice 8 contract，AI extension 不拥有另一套 query / stats engine。
- 所有 tool-level 领域 / validation 失败返回稳定 `{ code, message, hint, field?, retryable }`。错误隐藏 SQL、路径与 stack，但不得隐藏可操作原因；例如错误 population 提示使用 `query.annotation`，未知 result dimension 提示 `list_vocabulary(kind='results')`，过期 evidence 提示重建 bundle。

### 分页、快照与有界读取

- list / search 默认 `limit = 20`，最大 50；稳定排序必须带 id tie-breaker。服务按稳定 sort key 物化**单个最多 1000 rows 的内存窗口**，cursor 到达窗口尾时可携带 opaque continuation 打开下一窗口，直至穷尽授权范围；同时返回 `narrowQueryHint` 鼓励 agent 优先按日期 / tag / result 收窄。1000 不是总结果截断。
- cursor 是不透明随机值，绑定 `accessEpoch + sessionId + journalInstanceId + queryHash + window boundary + snapshot sequence + offset`，TTL 10 分钟；不保持长 SQLite transaction。下一窗口从前一窗口最后稳定 sort key 继续，同一 snapshot sequence 内不得重复 / 漏项；cursor 不可跨 access epoch / session / app instance 使用。
- Stop、Reset access key、workspace switch、app restart 或 snapshot TTL 到期均返回明确 expired error，不回退成新的查询结果。分页内不重复、不跳项；新写入只出现在下一次查询 snapshot。
- 持 access key 的 client 可通过多次合法查询遍历当前整个 journal；上限只保护 app 响应、模型上下文和误操作，不宣称防止导出数据。

### MCP Resources 与可验证视觉证据

`resources/list` 只列 journal overview 与当前 Agent Guide 这两个具体 resource，**不枚举全库 Entry**；其余 parameterized URI 只由 `resources/templates/list` 声明。单纯把整页图和 annotation bounding box 交给模型不足以建立可靠对应：bbox 会丢失箭头方向、线段端点、折线路径与多截图关系，而视觉模型本身也不擅长精确空间定位和密集对象计数。因此视觉入口统一为 `get_visual_evidence` 创建的临时 `VisualEvidenceBundle`。

#### Bundle 生命周期与交付

- `VisualEvidenceQuery` 必须给出一个 `entryId` 和 0..8 个属于该 Entry 的 `annotationIds`。空数组只生成 overview 与 screenshot-instance manifest，供原图 / crop 计划安全选 source；有 annotation 时生成既有 grounding 资产。超出上限由 agent 分批请求；服务不接受调用方自造 image hash、文件路径或全库图片扫描。
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
- 每个 annotation 返回 bundle 内稳定但不持久化的 `markId + annotationId`、index 中用于查询 / 高亮的 `indexBounds`、包含 stroke / arrowhead / text-box 外框的派生 `paintBounds`、style、z-order、受限 text，以及 index 提供的 tags / result；若是文本框，另从文字超链接投影返回 `textLinks`。若 index 与 `canvas_json` 的 `tjId` 对不上，返回 integrity error / warning；不能让 canvas 中的 tag / result / textLinks 成为第二事实来源。
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

### Visual artifacts、Agent-owned export 与 Progressive Reveal

#### 用户与 agent 的完整动作闭环

1. Agent 先用结构化 query 找到 Entry，再调用 `get_visual_evidence(entryId, [])`；manifest 用 `S1 / S2 …` 展示每个 screenshot instance 的 native dimensions、instance source window、page quad 与 transform。即使两个对象引用相同 hash，agent 仍必须按实例选择，不能按 hash 猜图。
2. 普通研究图片走 `create_visual_artifacts`：agent 可预览原始文件、截图实例 source window、任意整数 source ROI、page ROI 或 annotation context。tool 返回 plan manifest、少量 inline previews 与其余 session-bound resources；计划不写盘。
3. 需要降低 hindsight bias 时，agent 先为一块 source-native chart ROI 创建 `bar-alignment-probe`。probe 把当前 `anchorCenterX + spacingPx` 提案画在整块 ROI locator 上，并为开头、中部、结尾各生成 1:1 native locator / clean magnifier pair、像素尺、候选 center 序号和可直接调整的 `anchorDeltaPx / spacingDeltaPx`。Agent 可反复新建 probe；应用内同一校准面也允许用户拖 ROI、anchor 与 spacing guides 并 Approve。
4. `bar-reveal` 只能引用当前 session 内一个显式接受的 `probeId + proposalHash`，不能重新提交另一套 centers。`advance_progressive_reveal` 在 `start` 后每次只交付一张当前帧；`next` 前进一步，`previous / seek` 只在已揭示范围内移动，绝不返回未来 frame URI、总图 contact sheet 或可枚举资源模板。
5. 用户要把图片长期放进自己的 repo / 研究目录时，agent 对 plan item 或已经揭示的当前 frame 调 `read_visual_artifact_chunk`，按 `nextOffset` 读完并用 checksum 校验，再使用 **agent 自身已有的** workspace / terminal 文件工具写入用户指定目录。MCP 不接收、不猜测、不创建该目录；文件冲突策略也由用户与 agent 决定。
6. Stop / 切 workspace / Entry revision 改变会让 bundle、plan、probe、已揭示 frame items 与 byte chunks 全部失效。已经由 agent 写入其 repo 的文件不归 Trading Journal 管理，MCP 也没有 list/read/delete/rename 用户 repo 文件的能力。

#### Typed artifact specs

```ts
type VisualArtifactSpec =
  | { kind: 'source-original'; screenshotId: string }
  | { kind: 'instance-source-window'; screenshotId: string }
  | { kind: 'source-region'; screenshotId: string; roi: PixelRect }
  | { kind: 'page-region'; roi: PixelRect; composition: 'committed-page' | 'clean-underlay' }
  | { kind: 'annotation-context'; annotationId: string; contextPx: number; composition: 'committed-page' | 'source-clean' }
  | { kind: 'bar-alignment-probe'; screenshotId: string; roi: PixelRect; proposal: UniformBarAlignment }
  | { kind: 'bar-reveal'; acceptedProbeId: string; acceptedProposalHash: string; fromBar: number; toBar: number };

interface UniformBarAlignment {
  direction: 'left-to-right';
  anchorBar: number;
  anchorCenterX: number;
  spacingPx: number;
}

interface VisualArtifactChunkRequest {
  planId: string;
  planHash: string;
  itemId: string;
  offset: number;
  maxBytes: number; // 1..786432
}
```

- `PixelRect` 使用整数 sourcePx / pagePx，`x/y >= 0`、`width/height >= 1`，必须完整位于其声明空间；服务不静默 clamp。`instance-source-window` 是 Fabric image object 的 source window，不冒充经 page clipping / z-order 后的“实际可见区域”。
- `source-original` 返回 ingest 时保存文件的逐 byte 原件与原 MIME/checksum；所有 crop、probe、reveal frame 与 page render 都确定性编码为无损 PNG。首版不生成 animated GIF/WebP，因为许多 MCP client / 模型只读取第一帧；逐帧 PNG 才是可寻址、可校验的事实载体。
- `UniformBarAlignment` 是 agent / 用户确认的像素提案，不是 candle detector 输出。首版只支持同一 ROI 内均匀间距；遇到缺口、非线性压缩或多个 panel spacing 不一致时，拆成多个 ROI / plan，不引入一个让 agent 手工提交任意长 `centersX[]` 的脆弱接口。
- probe 解析出完整 `centersX[]` 与相邻中线 `cutoffsX[]` 并写入 manifest。proposal hash 覆盖 bundle revision、screenshot instance、ROI、alignment 与 resolved arrays；接受只表示调用方显式选用该提案，不声称模型真正看过或系统已验证 candle。
- reveal frame 固定为同一个 ROI 尺寸，cutoff 左侧逐像素保留 source-clean 原图，右侧全部替换为完全不透明的中性遮罩；cutoff 位于当前 bar 与下一 bar center 的中线。它不平移 / 缩放历史像素，也不带 journal annotations / AI locator。manifest 逐帧记录 bar index、centerX、cutoffX 与 source checksum。
- 静态原图本身可能已有指标、趋势线、文字、入场 / 出场或结果标记；遮住右侧像素不能删除左侧已经编码的未来信息。校准 agent 若看过完整 ROI 或全部 magnifier，也不再是盲测 agent。应用把“校准”和“逐帧分析”作为两个可分离步骤，并在 manifest 标记 `calibrationExposedFuture: true`；产品只称 progressive reveal / 降低 hindsight bias，不称 replay 或 no-hindsight。

#### Plan、resource 与只读 bytes 安全

- plan 绑定 `accessEpoch + sessionId + journalInstanceId + entryId + evidenceRevision + canonical spec hash`，TTL 10 分钟；最多 16 specs、240 reveal frames、512 items、512 MiB 预估编码 bytes。超限在生成前返回 estimate 与收窄建议。
- 普通 artifact resource 为 `trading-journal://journal/{instance}/artifacts/{planId}/{itemId}`；逐帧分析不使用可枚举 URI，而由 `advance_progressive_reveal` 逐次 inline 当前 PNG。plan cache 与 bundle 一样只在有界内存 LRU，原图与 frame 可按 item 惰性生成。
- `read_visual_artifact_chunk` 只能读取当前 session / revision / plan 中已经存在的 item；不能传 URI、hash 或 path。`offset` 必须落在 item 内，response 返回 raw byte offset / length、独立 base64 chunk、`nextOffset`、完整 item byte count / SHA-256 / suggested filename；chunk 边界不改变 item checksum。
- progressive reveal 每生成一张当前帧，就把该帧注册成一个**已揭示 item**并在响应中返回 `itemId + suggestedFilename`；chunk reader 可读取这些已揭示帧，但未来 frame 尚无 item id，不能枚举或越权下载。
- `create_visual_artifacts`、`advance_progressive_reveal` 与 `read_visual_artifact_chunk` 全部标 `readOnlyHint: true`。companion 及 main 不导入任何研究目录 writer，不新增 HTTP download route，不返回 access key / 磁盘路径；agent 的 repo 写入不属于 Trading Journal activity。

### 可编辑 Agent Guide 与 MCP Prompt Library

#### Agent Guide：教 agent 如何读我的图

AI Access 提供一份用户可编辑的中文 Markdown guide。初始内容写入用户已经确认的稳定约定：三图时左上 1h、左下 15m、右侧主图 5m；单图通常为 5m；主图蓝线是 5m EMA20、橙线是叠加的 1h EMA20；每 3 根显示一次累计 bar 编号并在交易日结束后重置；红色小块是 sell、绿色小块是 buy、反色外圈表示失败入场，标记通常位于 entry bar 正上 / 下方；倾斜线通常是趋势 / 通道，横线必须动态研判；橙色文本框是一般想法 / 入场理由，紫色文本框是待研究疑问；纯白背景是 RTH、浅灰背景是 ETH。未确认的线条颜色、竖向虚线与底部指标明确列为“不可擅自推断”：

```md
# 我的交易复盘图解读指南
## 回答语言与证据层级
## 常见图表布局与周期
## EMA
## Bar 编号与计数
## 入场点标记
## 线条与区域
## 文本框与交易时段背景
## 当前尚未定义的视觉元素
## 不可过度推断
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
  - `review_entry_progressively`：围绕一个用户给定或 guide 可确认的入场 annotation 选择 source-native 局部 panel / ROI；先用远距离累计编号或多个相邻 candle centers 估 spacing，以头 / 中 / 尾 magnifier 的 residual 快速区分 phase 偏移和 spacing 累计漂移，通常一轮估计 + 一轮修正后接受 proposal；用 plan-local bars 把 `fromBar / toBar` 放在入场前后有限窗口，而不是截图首尾，再按 `start → 逐帧记录 → next` 复盘；
  - `review_recent_period`：先 overview / stats，再取少量代表、反例与 missing examples，引用 Entry date / id；
  - `compare_classifications`：用同一 denominator 比较 cohorts，明确 overlap / sample size，再看盘面；
  - `inspect_outliers`：按 number result 找离群样本，读取 visual evidence bundle，区分数据事实、视觉观察与假设；
  - `find_counterexamples`：在相同结构化条件下找相反 result，禁止把少数图直接推成规律；
  - `audit_data_quality`：在明确 eligible population 下查缺 result / tag、broken links 与 coverage。
- 用户可编辑 built-in 的 title / description / body / arguments、启停、Duplicate、Reset to default；可 Add custom prompt，并删除 custom prompt。修改只写 machine-local AI config；不改变 journal。
- 新版本增加 built-in 时按稳定 id 合并到既有 machine config：已存在的 prompt 完整保留用户编辑与 enabled 状态，custom prompt 原样保留，只追加此前不存在的 built-in；不能用新默认覆盖用户正文。
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
- `Bar reveal calibration` 从具体 Entry / screenshot instance 打开一个有界校准 modal：原生 1:1 ROI、可拖的左右边界、anchor guide、第二条 spacing guide，以及开头 / 中部 / 结尾三个同步放大窗；用户调整后点 Approve 生成与 agent probe 相同的 proposal hash。它不自动识别 candle，也不显示“AI 已验证”。
- `Recent activity` 只显示最近 20 次时间、MCP clientInfo（若提供，仅作显示、不作为身份）、tool / resource / prompt、row / byte count、成功 / 拒绝；只在内存。请求进行时状态栏显示低干扰 AI read 指示。
- Stop 后 guide / prompts / stable endpoint 配置仍在 machine-local config，但无 listener。切 workspace 时服务先 Stop；再次 Start 才把新 workspace 完整授权给同一 access key。

### 端到端只读与 journal non-mutation 的可证明性

1. MCP `tools/list` / resources / prompts 中没有 create、update、delete、tag、result、note、save、execute、SQL、任意 path、filesystem write 或通用 filesystem tool；图片 export 仍是 read-only bytes。
2. `JournalReadRequest` 是唯一封闭 allowlist；artifact chunk request 只有 `planId + planHash + itemId + offset + maxBytes`。未知 tool、大小写 / 前缀 / 同义 write 名、额外 HTTP route 与不支持 method 全部拒绝。
3. companion 不获得 DB path；main read service 使用 readonly SQLite + `query_only`，测试中直接尝试 INSERT / UPDATE / DELETE / PRAGMA write 必须失败。
4. extension package dependency rule 禁止导入 store writers、preload `IpcApi` 与任何 fs writer；VisualEvidence renderer 无 write preload。chunk reader 只对内存 Buffer 做 `subarray` / base64，不打开目标文件。
5. non-mutation audit 在一轮完整调用前后比较 canonical journal domain digest：排序后的 Entries（含原始 canvas_json）、tags、annotations、results、views、stamp library、image 文件名 + bytes hash 全部不变。不能只比较物理 `app.sqlite` hash，因为 WAL / checkpoint / `schema_meta` provenance 可变化而不代表用户数据变化。
6. extension 不创建 schema / migration，不向 journal 或 machine config 写 session、cursor、cache、log、导出记录或 AI report；machine-local stable port、access-key reference、Agent Guide 与 Prompt Library 仍只能由 Trading Journal UI 修改。Agent 若把 bytes 写入自己的 repo，那是外部工具行为，不成为 Trading Journal 数据或配置。

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
5. **Slice 9D1 — Unified visual artifact contract**
  - `get_visual_evidence` 支持 0 annotation；冻结 screenshot-instance selector、typed ROI / artifact specs、plan / item manifest、original-byte 与 deterministic PNG contract；
  - VisualEvidenceService 拆出共享 source ownership / revision snapshot，原图、instance window、source/page/annotation crop 全部复用该 snapshot；
  - 接 MCP resource / bounded inline preview；无永久写盘、无 schema / canvas migration。
6. **Slice 9D2 — Agent/user bar calibration + progressive analysis**
  - uniform alignment proposal、整 ROI overlay、三段 native magnifier locator / clean pairs、proposal hash / acceptance；
  - session-bound reveal cursor 与 `start / next / previous / seek-within-revealed`，每次只 inline 当前 PNG；
  - Settings / Entry 的人类 calibration modal 与真实多模态 agent 调参测试；不做自动 candle detection 或动画格式。
7. **Slice 9D3 — Read-only byte export for agent-owned repos**
  - 为普通 plan items 与已揭示 frames 建统一 item registry；冻结 chunk request / response、offset、max bytes、checksum 与 suggested filename；
  - MCP `read_visual_artifact_chunk` 只读取 session/revision-bound item Buffer，不接受路径、不写文件、不新增 HTTP route；
  - 真实 coding agent 用自身 terminal / workspace tool 把多 chunk 合并到临时 repo 并校验 SHA-256；没有文件工具的 client 明确只能查看，不能声称已保存。

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

- 服务 On 时可读 tags / bounds / results、受限 title / note 及其文字超链接与视觉 resource；只解析该 Entry 且截断超限文本 / 对象。首次 Start 披露图片和机器可读文字都会提供给 client。
- journal 文本中的指令按 untrusted evidence 原样返回，不进入 tool description / prompt instruction。

`scenario: visual evidence deterministically maps annotation ids to chart pixels`

- overview 正确包含白页、多 screenshot 与全部用户 annotations；locator 与 overview frame / transform 完全一致，`A1 / A2` legend 映射正确，marks / leader 不覆盖目标 `paintBounds`；focus 保留真实 composition。
- rect / text / line / arrow / polyline / freehand / MeasuredMove / composite 在 scale / rotation / skew / flip / group transform 下得到正确 page geometry；arrow tip、stroke / arrowhead paint bounds、Path precision 与 unsupported 降级均显式。
- 单图唯一且完整时 source crop 的中心 chart pixels 与原始 decoded raster ROI 逐像素一致，reference gutter 不改 chart pixels；重复 hash 的实例、重叠截图、跨图 annotation、clip、奇异矩阵与边缘截断返回正确 association / warning，不偷偷挑 source。
- underlay 只在 source-native 不可用且可安全派生时出现，并带 `notUserVisibleComposition + removedAnnotationIds`；不能把它误作用户原图或 annotation 语义证据。
- forged / cross-entry source、path traversal、未知 annotation、伪造 / 过期 bundle、超 annotation / pixel / byte 请求被拒；响应无磁盘 path。offscreen renderer 不调用 store write，cache 只在内存并随 revision / Stop 失效。
- 至少一个真实 multimodal MCP client 证明 tool 的 ImageContent 与 resource image 最终都到达模型，并在同一次模型调用中同时交付 source locator / clean pair；不支持图像转发的 client 明确降级。已知 synthetic candlestick fixture 用于人工兼容评估 mark ↔ annotation 与 bar-count 表现，模型随机输出不作为 CI 硬门。

`scenario: one screenshot instance produces exact, bounded visual artifacts`

- 无 annotation 的 bundle 仍列出 S1 / S2；同一 hash 的两个 cropped / transformed instances 必须按 screenshotId 得到各自 source window，伪造 / 跨 Entry / 跨 session id、过期 revision 与直接 hash 全部拒绝。
- `source-original` bytes / MIME / SHA-256 与 ingest 文件完全相同；source ROI 的 PNG decoded pixels 与原图对应整数区域逐像素一致；page ROI 在 rotation / scale / crop 下与 committed composition 对应，`clean-underlay` 明列 removed annotation ids。
- plan hash 对 canonical specs 与 revision 确定；resources、inline preview 与最终 materialization 使用同一 item checksum，没有 preview 一套、导出另一套的漂移。

`scenario: agent and user can calibrate a progressive bar reveal without pretending it is replay`

- synthetic fixture 的已知 `anchorCenterX / spacingPx` 在开头 / 中部 / 结尾 probe 中得到相同候选 centers；微调 phase / spacing 后 proposal hash 改变，final reveal 拒绝未知、过期或 hash 不符的 probe。
- 每帧尺寸恒定；cutoff 历史侧 decoded pixels 与 source ROI 完全相同，未来侧每个 pixel 都是不透明遮罩；相邻帧只多揭示下一 cutoff 区间，无 annotation / locator 混入 clean frame。
- `start` 只给首帧，`next` 只给下一帧；resource list / template / manifest 不泄露未来帧 URI，`seek` 不能越过 highestRevealedFrame。完整 sequence / contact sheet 只允许在分析完成后的 materialization 中生成。
- 真实多模态 client 完成一次「读取三个局部 probe pair → 调整 spacing / phase → 接受 proposal → 连续 next」；CI 只硬断言协议、像素和上下文没有未来 frame，不断言随机模型一定数对 candle。
- manifest 明示静态截图、指标 / 标记泄露与 `calibrationExposedFuture`；同一 agent 看过完整 ROI 后不能把该次分析标成 strict blind，UI / tool description 均不出现真实 replay / no-hindsight 保证。

`scenario: a coding agent saves exact artifact bytes into its own repo without MCP write access`

- chunk request 对普通 artifact 与当前已揭示 frame 返回连续、无重叠 / 缺口的 raw-byte ranges；逐块 base64 decode + append 后的总 bytes、MIME 与 SHA-256 与 resource item 完全相同。
- offset 越界、maxBytes 超限、伪造 plan/item/hash、另一 session、过期 revision 与尚未揭示的未来 frame 都拒绝；response 没有 absolute / relative path、access key、journal hash 或任意写命令。
- 真实 coding agent 可用自己的 workspace / terminal tool 保存 suggested filename 到用户指定 repo；同一个 MCP client 若没有文件工具必须明确说明只能读取，不能声称 Trading Journal 已替它落盘。完整流程前后 journal canonical digest、image bytes 与 machine config 完全不变。

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
- 任意 SQL、数据库文件下载、任意文件路径、全库 raw canvas_json / image dump、通用 filesystem resource 或任何 server-side 文件写入；artifact chunk 只能读取当前 session 的 validated plan item。
- 内置聊天 UI、模型选择、API key 管理、模型调用、sampling、agent 编排、第三方 extension runtime / marketplace。
- embeddings、vector DB、全库全文索引、自动视觉相似度模型；结构化筛选后由外部 agent 按需看图。
- OCR / candle detector、截图转 OHLC、价格 / 时间轴绑定或精确 bar-count service；bar spacing 由 agent / 用户校准，视觉 bundle 与 progressive reveal 都不把静态截图升级为行情数据。
- 真实 replay、动态坐标轴 / 指标重算、从原图移除既有未来标记、strict no-hindsight 保证，以及首版 animated GIF/WebP；分析以逐次 PNG frame 为唯一机制。
- LAN / remote server、后台常驻 daemon、app 关闭后继续服务；远程 OAuth 属独立未来设计，不复用本地 token。
- 实时行情、预测、下单、回测、自动排名或把 AI 输出当作事实。AI 只能读取用户已记录的证据并在外部对话中提出分析。

### 依赖与完成定义

- Slice 9 当前实现只依赖 Slice 6 / 7 的词表与 query semantics，以及 image / canvas data contract。Slice 8 已落地；AI statistics 接入仍是直接委托其 contract 的后续扩展，不改变当前 read boundary。
- Slice 9 完成 = 9A / 9B / 9C1 / 9C2 scenario tests 全绿 + Streamable HTTP client 与 GitHub Copilot 真实多模态 handoff 可用 + security / non-mutation audit 通过 + golden-DB 保持绿色。
- 未引入 schema / canvas_json migration；AI connection、token、session、cursor、cache、log 和 report 都不进入 journal data folder。

**实现状态（已落地；当前 tool surface 不含通用 Statistics）**

- 已实现 12 个真实只读 tools：既有 overview、vocabulary、Entry search、sample search、sample study、Entry context、linked context、single visual、batch visual，加 `create_visual_artifacts`、`advance_progressive_reveal` 与 `read_visual_artifact_chunk`。`tools/list` 不含 statistics / data-gaps，也没有任何 write / SQL / filesystem 能力；所谓 export 只是返回 bytes，保存到 repo 由外部 agent 自己的工具完成。
- 高效研究路径已落地：`list_vocabulary → prepare_sample_study → get_visual_evidence_batch`。Vocabulary 同时返回 Entry-level usage、annotation sample count 与 annotation distinct-Entry count；study 从完整 population 计算分母，明细截断不改变统计，并附最近文字与视觉批次。稳定错误 code / hint 取代模糊的 `Journal read request failed`。
- 已实现 Streamable HTTP companion、loopback / Host / bearer / Origin 防护、session 与 rate / concurrency / cursor / image byte 上限、DPAPI 加密 access key、Start / Stop / Reset，以及 Home → App settings 独立 AI 页内的 Copilot 配置步骤、Agent Guide 与 Prompt Library。
- AI Supervisor、readonly repository、Fabric 与 Sharp 只在用户点 Start 后动态加载；AI Access Off 的正常 main bundle 保持轻量，不让可选 extension 拖慢每次应用启动。packaged `TradingJournal.exe` 已验证可加载 lazy chunk、Sharp / libvips 与 companion。
- visual evidence 已覆盖 exact Rect / line / arrowhead / polyline / MeasuredMove / text / group bounds、unsupported Path 拒绝 source pair、重复 hash screenshot instance、crop / transform、session / revision ownership，以及同 ROI source locator / clean pair。
- visual artifacts 已覆盖空 annotation bundle 的 screenshot-instance discovery、原文件逐 byte 输出、instance source window、source/page/annotation crop、probe locator / clean / 头中尾 magnifier、已接受 proposal 的 progressive reveal，以及普通 item / 已揭示 frame 的 checksum-bound chunk 读取。未来 frame 在 `next` 前没有 item id，不能经 resource 或 chunk 提前读取。
- Prompt Library 已内置 `review_entry_progressively`：参数只包含 Entry、可选入场 annotation、入场前后 bars 与研究问题；workflow 用远距离编号 / 多 candle center 得到首版 spacing，再按头 / 中 / 尾 residual 区分 phase 偏移与累计 spacing 漂移，并以 plan-local bars 从入场附近的有限窗口开始 reveal，不默认从截图第一根开始。MCP `prompts/get` e2e 验证参数替换、校准公式、逐帧纪律及不含任何真实测试图参数。既有 machine config 按 prompt id 只补新增 built-in，保留用户对旧 built-in 的编辑 / enabled 状态和全部 custom prompts。
- 一张真实多 panel TradingView 截图已通过实际 Entry → MCP 路径验证：第一版 spacing 在长距离后出现累计漂移；按头 / 中 / 尾 residual 修正后，三段同时对齐图内累计 bar 编号。局部主图 ROI 创建完整 reveal definition 后只实际推进前三帧；三个 frame 的历史侧与 source-clean 均为 0 mismatch pixels，未来侧均为 0 non-mask pixels。测试图片只存在隔离临时 journal 与 ignored `test-results`，具体尺寸 / ROI / spacing 未写入 prompt、fixture 或正式 repo 资产。
- 真实 GitHub Copilot CLI integration 已通过：Copilot 实际调用 overview → search → context → visual evidence，在同一上下文收到 5 张图片，正确返回 `A1 → count-zone`、可见累计编号 `3, 6, …, 30`，并按 center-in-rectangle 口径数出 8 根 candle；随机模型输出不作为 CI 硬门，协议 / 像素行为由 deterministic e2e 固定。
- 最终验证：`npm run typecheck`、`npm run lint`、`npm run build`、`npm run package`、`npm run test:package-ai` 全绿；AI Access 专项 **5 / 5**。Slice 8 合入后默认 `npm test` 再次全绿：Vitest **5 / 5**、完整 Playwright + Electron suite **118 / 118**（list reporter、workers=1、测试窗口不抢焦点）。

## 13. Slice 10：稳定内部地址与文字超链接（重做引用）

目标：彻底移除当前「annotation 保存一组 annotation ids + 应用内 link clipboard + Links 浮窗」的对象级 link 能力，改成用户一眼就懂的统一机制：**每个 Entry / annotation 都能复制一个不会随改名或移动而变化的内部地址；任意可编辑文字区间都能把这个地址变成 Office 式超链接，并完整支持打开、编辑、取消、局部删字、整段删除与 undo/redo。** 首版只链接当前 journal 内的 Entry / annotation，不执行外部 URL、文件路径或其它协议。

### 用户动作流程与直觉逻辑

1. 用户在左栏任意 Entry 缩略图上右键，点 `Copy link`；或在画布任意 annotation 上右键，点同名命令。系统把 `trading-journal://journal/{journalId}/{entry|annotation}/{targetId}` 的 canonical 地址写入**系统剪贴板**，随后轻量提示 `Link copied`。目标没有被“创建一份引用记录”，journal 也没有变化——用户只是拿到了这个东西本来就有的地址。
2. 用户双击进入标题或文本框编辑，选中一段非空文字，右键点 `Link…`（`Ctrl/Cmd+K` 完全等价）。对话框只有 `Text to display` 与 `Link`：前者就是当前选区；如果刚才复制的系统剪贴板文本恰好是合法内部地址，后者已经自动填好，否则为空。用户可改显示文字或粘贴另一个内部地址；`Save` 一次完成文字替换 + 加链接，`Cancel` / `Esc` / 点遮罩关闭且不留下半次修改。
3. 保存后，只有那段字符呈现克制的 Office 式链接色与下划线。未进入文字编辑时，鼠标只有压在链接字符上才变成手形 pointer，单击直接前往；压在同一文本框的普通字符 / 空白处仍是选择对象。进入文字编辑后，普通单击继续放光标，`Ctrl/Cmd+单击` 才前往，避免“想改字却被传送”。
4. 用户在链接字符上右键，可 `Open link`、`Edit link…`、`Remove link`。Edit 复用同一对话框并预填当前显示文字 / 地址；Remove 只拿掉链接语义，文字及其颜色、字号、粗体等用户格式原样保留。对选区重新执行 `Link…`，会把该选区统一改为一个 target，选区外原有链接片段不受影响。
5. 用户像普通文字一样按 Backspace / Delete：删掉几个字符只会让链接变短，剩下的字仍可点击；最后一个链接字符也删掉时，链接才随之消失。新字在链接**内部**输入会继承 target，在区间首尾之外输入不会“黏”进链接。创建、改显示文字、改地址、取消、局部删除与整段删除都进入同一画布 history；一次 Undo 同时恢复文字、区间和 target，Redo 对称。
6. 前往 Entry 时切换到那条复盘；前往 annotation 时先由索引解析所属 Entry，再切换、选中目标并做一次短暂非持久化提示。跳转前必须提交当前文字编辑并完成 autosave；保存失败就留在原处明确报错，绝不为了导航丢字。目标后来被彻底删除时，源文字与地址仍保留；点击提示目标已不存在，右键仍可 Edit / Remove。

### 契约先行

```ts
type InternalLinkTarget =
  | { kind: 'entry'; id: string }
  | { kind: 'annotation'; id: string };

interface InternalLinkAddress {
  journalId: string;
  target: InternalLinkTarget;
}

interface TextLinkSpan {
  start: number; // inclusive, 使用 Fabric 文字选区的同一位置单位
  end: number;   // exclusive
  target: InternalLinkTarget;
}
```

- migration 009 在 `schema_meta` 写入一次性的随机 `journal_id`；已有值永不重写，数据文件夹移动 / 改名不影响它。`Entry.id` 与 annotation 的 `tjId` 是 target 唯一真源；标题、日期、文字、tag、geometry 与数据文件夹路径都不进入地址。
- shared `formatInternalLink / parseInternalLink` 是 URI 的唯一 formatter / parser。固定语法为 `trading-journal://journal/{journalId}/{entry|annotation}/{targetId}`；两个 id 都经 `encodeURIComponent` 成为**单个** path segment。parser 拒绝 malformed percent encoding、username / port、query、fragment、空 / 额外 segment、未知 kind 与任意其它协议，并以 `format(parse(uri)) === uri` 强制 canonical round-trip；因此任意既有非空 id（含 `/`、`?`、`%`、CJK 或 emoji）都可逆。
- canonical URI 只用于系统剪贴板和对话框输入；`canvas_json` 与 `text_links` 只保存 same-journal typed `InternalLinkTarget`，不在每个 span 重复 `journalId`，也不靠运行时拆自由字符串。粘入另一 journal 的地址因 `journalId` 不同而明确 unresolved；系统不搜索磁盘、不自动切 workspace。
- `TextLinkSpan` 可存在于所有可编辑 `TextBoxAnnotation`，包括结构性 Entry 标题和普通文本框 annotation。显示文字永远由统一 range helper 按 Fabric 选区的同一 grapheme 位置单位从对象自身 `text` 读取，不在 span 里复制第二份；禁止直接假设 `start/end` 是 JavaScript UTF-16 offset。span 按 start 排序、非空、不重叠、不得越界，相邻且 target 相同的 span 归一化合并。
- 新建 / 修改时，typed parser 后还要验证 journal identity 与目标此刻存在；无效、其它 journal 或 unresolved 时 `Save` 禁用并在 Link 字段就地说明。self-link 是普通合法地址，不加隐藏特例。

### 文字编辑、样式与 history

- 把超链接实现为**附着在字符上的 mark**，持久化时压缩成 spans。唯一编辑原语是 `TextEditOperation { from, to, insertedGraphemes }`；一套纯函数以它同时变换文字链接 spans，键盘输入、粘贴、对话框改显示文字与程序化替换不得各写一套区间修补。
- `TextBoxAnnotation` 在 Fabric 6.9.1 自己处理文字的同一个 `onInput` 边界接入 `TextEditAdapter`：在调用 `super.onInput` 前捕获旧 `_text`、旧 `selectionStart / selectionEnd`，读取 hidden textarea 的 next value / selection，并用 Fabric 的 `_splitTextIntoLines(...).graphemeText` 与 `fromStringToGraphemeSelection` 按其原生 `onInput` 同一公式得到精确 remove range 与 inserted graphemes；调用 `super` 成功后只把这一个 operation 交给 span transformer。**禁止**在 `text:changed` 后用 LCS / 前后字符串猜 diff，因此重复字符也没有歧义。
- 该 adapter 必须覆盖普通键入、Backspace / Delete、selection replace、cut、纯文本 paste、hidden textarea 原生 undo / redo 与每次 IME composition input。composition 过程中 spans 随当前组合文字更新，但不 push canvas history；`compositionend` 只 normalize，退出编辑时把整个文字编辑 session 提交为一个 history step。所有程序化文字修改统一走 controller 的 `replaceTextRange`；除 hydrate / 初始构造外，不允许直接 `set('text', ...)` 绕过 adapter。
- 删除与替换保留未被删字符的 mark；完整覆盖一个 span 才移除。插入点严格位于某个 span 内，或替换区间完整位于同一个 span 内时，新字符继承 target；位于边界或跨越不同 targets 时，新字符默认为无链接。对话框创建 / 编辑是显式赋值，始终把最终显示文字的完整新区间设为所选 target。
- 对话框替换显示文字时，新 graphemes 沿用 Fabric 现有 selection replacement 规则继承选区起点的用户字符样式；链接色 / 下划线仍只是派生覆盖。选区外的 `styles` 与 links 均按同一 grapheme operation 平移 / 裁切，不另写特殊路径。
- 链接色 / 下划线是 `TextBoxAnnotation` render / style-resolution 时的**派生覆盖层**，不写进 Fabric 的用户字符 `styles`，也不持久化 visited 状态。Remove 后原有逐字符 fill / fontSize / fontWeight 立即恢复；hover / active 只做轻微派生反馈。缩略图按最终视觉正常包含链接外观，但不新增 canvas JSON 样式字段、history step 或 annotation-tag index 事实。
- 右键 / `Ctrl/Cmd+K` 在 Fabric 改变 active object、折叠 selection 或失焦**之前**冻结 `{ sourceKey, start, end, hitSpan, textRevision }`。打开 Dialog 前先把此前尚未提交的普通打字按内容差异提交为独立 history step（无变化不 push）；Dialog Save 的“替换显示文字 + 赋 target”只 push 一次，Cancel 不回滚此前已经输入的普通文字。Modal 打开期间 canvas 不可编辑，Save 仍校验 frozen revision。
- 每个用户可感知命令只 push 一次 history：Dialog Save、Remove link、一次已提交的文字编辑分别是一个原子快照；Dialog Cancel、Copy link、Open link 与 unresolved 错误不 push。undo/redo hydrate 后必须恢复 spans、派生样式、命中区和可点击行为。

### UI、剪贴板与命中

- Entry context menu 在每条 rail thumbnail 提供 `Copy link`；annotation context menu 对任意带 `tjId` 的页区 annotation 提供同名命令。stamp 库里的模板不是 Entry annotation target，不提供地址；截图对象也不是 annotation，不提供地址。
- 文字编辑中的非空选区显示 `Link…`；右键命中一个既有 span 时显示 `Open link / Edit link… / Remove link`，同时仍可见 `Copy link to annotation`（它复制的是该文本框 annotation 自身的地址，不是 span target）。选区跨多个 spans 时 `Link…` 以一个新 target 覆盖选区，外侧残片按字符 mark 规则保留。Context menu 使用上一步冻结的 selection / hit，不因右键本身重新选对象而漂移。
- 系统剪贴板读写走一套 typed preload/main 能力；不再有 React `linkClipboard` 会话态。打开创建对话框时只在剪贴板文本通过 canonical parser 后自动填 Link，普通文字、半截 URI 或外部 URL 一律不猜、不报打扰性错误。
- 点击命中复用 Fabric 的 inverse object transform、wrapped-line grapheme layout 与 cursor bounds，只在实际链接 glyph box 内触发；padding、边框、行尾空白与文本框其余区域不是链接热区。旋转、scale、zoom、换行、CJK 与 emoji 后，hover / contextmenu / click 必须使用同一 hit result，不得一处按整框、一处按字符。
- 链接激活统一延迟到 `pointerup`：按下后移动未超过 drag threshold 才算 click；超过 threshold 时，页区文字按正常对象拖动，锁定 stamp 按既有 ghost-copy 手感拖出，绝不先跳转。锁定 / 解锁 stamp 上的链接字符在无拖动 click 时可打开 target；stamp 模板自身仍不是可复制地址的 target。键盘可用 `Ctrl/Cmd+K` 打开、Tab 遍历两个字段与按钮、Enter 保存、Esc 取消；右键 `Open link` 为不便使用组合点击时的等价路径。
- 普通复制 / 粘贴或 duplicate 一只文字 annotation 时，文字、用户格式与 `textLinks` 一起复制，annotation 自身获得新 `tjId`，link targets 不变。Stamp 拖出也保留可见文字超链接、仍丢弃 result；不能出现库里看着是链接、落到页面却悄悄变普通文字的净效果特例。
- 页区 annotation 移入 stamp strip 时不再是 Entry 内可解析 target，指向它的既有链接暂时成为 broken；解锁后把**同一对象 / 同一 `tjId`**移回任一 Entry，地址随对象重新解析到新所属 Entry。这个生命周期沿用 Slice 5 的“移动保持身份”合同，不暗中换 id，也不把 stamp 加进 annotation index。

### 持久化、投影与旧能力退役

- 公共领域 / controller / IPC 字段统一叫 `textLinks: TextLinkSpan[]`；只有 Fabric `canvas_json` 的自定义序列化键叫 `tjTextLinks`，缺省为空。旧 Entry 加载时“缺字段 = 空”是明确 load-time upgrade；不出现 `textLinks` / `tjTextLinks` 两套并存的运行时模型。
- Entry Store 内部定义 `TextLinkSourceProjection = { source: { kind: 'entry-title' } | { kind: 'annotation'; annotationId: string }; text: string; textLinks: TextLinkSpan[] }`。`updateEntryCanvas` 不信任 renderer 另报一份 links：main 在**保存当前这一个 Entry**时用有字节 / 深度 / 对象数上限的结构化 parser 从本次 `canvas_json` 提取 title / text annotations 与 `tjTextLinks`，用 shared grapheme helper 校验 / normalize ranges，并要求 annotation source 出现在同事务的新 annotation 集中。`text` 只参与验证，不另存；这是写侧 projection，不是查询时扫描全库。
- migration 009 新建 `text_links`：`source_entry_id`（FK `entries`，source Entry 删除时 cascade）、`source_kind`（`entry-title | annotation`）、`source_object_id`（title = Entry id；annotation = `tjId`）、`start_grapheme`、`end_grapheme`、`target_kind`、`target_id`；以 source + start 为主键，CHECK 非空 / `end > start` / kind 合法，并建 `(target_kind, target_id)` 反查索引。target **刻意不设 FK / cascade**，否则删除目标会篡改源文字语义。
- Entry 保存时先由同一请求得到 durable canvas + annotations + normalized text-link projection，再在一个 SQLite transaction 里整体替换该 Entry 的 annotations/tags/results/text_links；任何一处校验失败全部回滚。投影写入只验证 source 与 grapheme bounds，**不要求 target 仍存在**：存在性只在用户新建 / 修改链接命令时检查。因此目标删除后的 broken link 可经历无关 autosave、重启和再次编辑而不丢失。
- `resolveInternalLink` 属于 Entry Store / annotation index 读边界：Entry target 直接按 id 读，annotation target 从 index 得到所属 Entry。renderer 只拿 typed resolve 结果，不直接查 SQLite。链接不是 tag、result 或 browse highlight，不进入任何 group bucket、View population 或 Statistics denominator。
- AI read contract 同步切到新模型：`get_entry_context` 返回受限文字及 `TextLinkSpan`。`get_linked_context` 从 typed Entry / annotation target 出发，同时沿 incoming / outgoing 邻接扩展到指定深度，但每条 edge 永远保留用户写下的 `source → target` 方向：Entry 节点的 outgoing 只来自其 title，annotation 节点的 outgoing 只来自该 annotation 自己的文本；非文本 annotation 没有 outgoing。broken target 返回 edge 但不继续扩展，cycle 去重，节点 / 边数硬上限不变。
- AI 的图拓扑与反查只读 `text_links`。投影不复制显示文字，因此仅对已经进入有界结果的少量 source Entries 使用现有 bounded single-Entry parser，并用同一个 grapheme range helper取得 `displayText`；绝不为文字全库扫描 `canvas_json`。旧 `Annotation.links` 不再出现在 read repository、visual manifest、prompt 或 canonical domain digest 中；canonical non-mutation digest 新增排序后的 `journal_id + text_links`。AI 仍永久只读。
- **旧能力整套删除**：移除 shared `Annotation.links / AnnotationHit.links`、zod `links`、Fabric `tjLinks`、`applyAnnotationEdits(...links)` / `setAnnotationResultLinks`、App `linkClipboard`、`TagPopover` 的 Copy target / Link to copied / Go / remove 列表、旧 IPC / repository link graph、旧 annotation-link e2e 与所有运行时 fallback。结果编辑只留在 `Annotation` 上下文页；右键浮窗组件若无其它职责则删除。
- 用户已明确旧对象级 link 无关紧要、可以丢弃，但其余复盘数据必须完整保留。migration 009 先依赖通用 migration backup 留下原始 v8 数据库，再在同一 migration transaction 内把历史 `annotations.links` 清成 `[]`，并从所有 Entry / stamp `canvas_json` 任意深度递归删除 `tjLinks` 字段；文字、annotation id、tag、result、geometry、对象顺序、图片引用与其它字段均保留。没有 `tjLinks` 的 JSON byte-for-byte 不改；需要清理时只做结构化 parse / delete / serialize。若整个 canvas / stamp JSON 本身 malformed，抛 `LegacyLinksMigrationError` 并回滚，绝不在无法证明安全时重写复盘。
- 本 slice **不把旧边猜测性转换成一段凭空生成的显示文字**，也不保留双路径。`migration001Initial` 已发布、不可改写，其中历史 `annotations.links` 列按 append-only 纪律物理保留；migration 009 成功后任何 domain type、post-migration store/read SQL、IPC、UI、AI 或行为测试都不再读写 / 暴露它。旧空 `tjLinks` 在 load-time upgrade 后不进入新的序列化白名单。
- 这是持久化契约变化：migration 前自动 backup、too-new guard、既有 golden-DB 链与现有 Entry / image / tags / results / canvas / views / stamps 必须保持。测试覆盖「无 legacy 字段时原文不变」「任意深度非空 / 非数组 `tjLinks` 只删除该字段」「malformed canvas 原子拒绝」与 committed v7 golden upgrade；另用真实 v8 backup 的临时副本核对所有领域表行数前后一致。发布时再 snapshot 新 schema fixture、同步 bump app version。
- Prompt Library 同步退役 shipped `trace_annotation_links`，新增 `trace_text_links`。machine-config migration 以旧 built-in 的已知默认 hash 区分：未改默认直接替换；用户改过的正文保留为 disabled custom copy 并明确标记 contract 已退役，同时安装新的 built-in。运行时不注册旧 built-in，也不保留旧 tool schema；用户自写 custom prompt 仍是用户内容，不会获得不存在的能力。

### 实现分解

1. **Slice 10A — Contract、纯函数与 migration safety**：先冻结 `InternalLinkAddress / InternalLinkTarget / TextLinkSpan / TextEditOperation / TextLinkSourceProjection`、canonical URI、grapheme range helper、span transform / normalize、migration 009 的 `journal_id + text_links + 精准 legacy cleanup`、typed resolve / IPC 与 golden tests；不接 UI。此阶段即可证明 arbitrary id round-trip、broken target 可存、旧 link 之外的复盘事实不变且原始 v8 库已有 backup。
2. **Slice 10B — Fabric 文字与 Office 式交互**：接 `TextEditAdapter`、`tjTextLinks` hydrate / serialize、派生 render、glyph hit、selection snapshot、Dialog、context menus、系统剪贴板、pointer-up click-vs-drag、autosave 与 history；普通文字 / duplicate / stamp 全部复用同一 operation / copy contract。
3. **Slice 10C — 导航、AI 与旧能力清除**：接 Entry / annotation resolve + save-before-navigation、broken target UI、`text_links` incoming/outgoing AI graph、bounded display extraction、Prompt Library machine-config migration；删除旧 domain / SQL / UI / tests，跑 package + real MCP smoke。10A–10C 是同一个发布 slice，10C 完成前不得发布双模型中间态。

### Scenario-based tests

`scenario: every Entry and annotation has one stable copyable internal address`

- 右键 Entry / annotation 的 `Copy link` 分别得到带稳定 `journalId` 的 canonical URI；改 Entry 标题 / 日期、改 annotation 文字 / 位置 / tag 后 URI 不变并仍解析到同一 id。`/ ? %`、CJK、emoji 等 arbitrary non-empty ids 均 format → parse 可逆，非 canonical encoding 与 query / fragment 被拒。
- 把 A journal 的 URI 粘到 B journal 时 Dialog 明确显示属于其它 journal、Save 不可用；不扫描磁盘、不误解析同 id。Copy 只改系统剪贴板，不改 canvas、DB domain digest 或 undo state。

`scenario: selected text becomes an Office-style internal hyperlink`

- 复制目标地址 → 选中一段文字 → 右键 `Link…`；即使 contextmenu 会改变 Fabric active state，冻结选区仍准确，Dialog 自动填显示文字与 Link。Save 后仅该段派生链接色 / 下划线，glyph 命中为 pointer。重开 Entry 后样式、span 与 target 一致；Remove 保留文字和原字符格式。
- wrapped / rotated / scaled / zoomed 文本只在实际 glyph box 显示 pointer / 打开；padding、边框、行尾空白不触发。文字编辑态普通 click 放光标，`Ctrl/Cmd+click` 才打开。

`scenario: hyperlink text editing obeys character marks and undo/redo`

- 在 span 内插字会扩展链接，在边界外插字不扩展；从前 / 中 / 后局部删除都只收缩 span，删完最后字符才移除。selection replace、cut、paste、hidden textarea 原生 undo / redo 与 IME composition 都产生明确 `TextEditOperation`，不靠字符串 diff。
- 纯函数 edit matrix 固定重复字符、CJK、surrogate emoji、combining mark、ZWJ sequence、换行、多 span / 跨 span replacement；任何时刻 range 不越 grapheme bounds、不重叠。创建、改显示文字 / target、Remove、局部删字分别 Undo / Redo 后，文字、规范化 spans、用户格式、视觉与点击目标完全恢复。

`scenario: following a link never loses the text being edited`

- 当前文本仍在编辑时打开 Entry / annotation 链接，先 commit + autosave 再导航；annotation 被选中并短暂提示。模拟 save 失败时不导航且原文字仍在；目标删除后点击得到 broken-target 提示，源文字可继续 Edit / Remove。
- broken link 经无关文字修改、canvas autosave、app 重启与 AI context read 后仍保留同一 target；只有用户 Remove / 覆盖该 range 或删尽字符才会消失。

`scenario: link click and stamp drag remain one unambiguous gesture`

- 在页区链接 glyph 按下后小范围释放才打开；拖过 threshold 则移动对象、不跳转。锁定 stamp 的同一 glyph 小范围释放打开 target，拖过 threshold 则出现 ghost 并落副本；原 stamp 不动。
- 页区对象移入 strip 后其 target 返回 broken，textLinks 仍随 stamp 保存；同一对象 / 同一 `tjId` 解锁移入另一 Entry 后 target 重新解析到新 Entry，incoming links 无需改写。

`scenario: copied text objects preserve hyperlinks without sharing identity`

- duplicate / paste / stamp 拖出一个含超链接的文字对象，新 annotation 有新 `tjId`，显示文字与 target 保留；修改副本 span 不影响原对象。Stamp 副本仍不带 result。

`scenario: the text-link projection is exact without duplicating display text`

- 保存含 title links 与多个 text-annotation links 的 Entry 后，`text_links` source / grapheme ranges / targets 与 canvas 一致，可按 target 反查；表中没有 display text。删除 source Entry 会 cascade source rows，删除 target Entry / annotation 不删除 incoming rows。
- 伪造 source、越界 / 空 / overlap span 或 annotation 不属于该 Entry 时，整个 canvas + annotation + text-link transaction 回滚；target 已不存在则仍允许原样重投影。

`scenario: migration retires the old link feature without discarding legacy data`

- committed v7 fixture 与带 legacy payload 的 v8 journal 升到 migration 009 后，既有 Entry、图片、tags、results、views、stamps 及 canvas 内除旧 link 字段外的内容不变，得到一个跨重开稳定的 `journal_id`；新文字超链接进入 `text_links` 并可按 target 反查。
- SQL `annotations.links` 统一清空，Entry / stamp canvas 任意深度的 `tjLinks` 字段被删除；其余字段深比较一致。malformed canvas / stamp JSON 会让整个 migration 回滚且 backup 已存在。公开 domain / IPC / AI surfaces 不再出现旧 links 数组，历史列不被任何 post-migration store/read SQL 使用。

`scenario: AI follows authored text links in both directions without inventing edges`

- Entry title → annotation、text annotation → Entry、cycle、incoming-only 与 broken target 共同组成 fixture；`get_linked_context` 同时扩展 incoming / outgoing，却逐边保留 source → target、准确返回 display range / text、截断与 broken 状态，且不扫描未入图的 Entry canvas。
- canonical digest 在完整 AI 调用前后包含同一 `journal_id + text_links`；machine config 不再注册旧 built-in，新的 `trace_text_links` 可用，编辑过的旧模板只作为 disabled custom text 留存。

### 完成定义

- 新增纯函数单测覆盖 URI parser / formatter、grapheme helper、Fabric-input-to-operation adapter、span normalization 与完整 edit matrix；Playwright + Electron 覆盖 context menus、clipboard 自动填充、Dialog、selection freeze、wrapped/rotated glyph pointer / click、编辑态 `Ctrl/Cmd+click`、stamp click-vs-drag、Remove、broken target、autosave 与 undo/redo。
- 更新 `tests/e2e/data-migration.spec.ts` 与 golden fixture；更新 AI Access tests，使 entry / linked context 只读取 `text_links`，并继续通过 canonical non-mutation digest。
- 删除旧实现与旧测试后执行 `npm run typecheck`、`npm run lint`、`npm run build`、专项 Playwright、`npm test`、`npm run package` 与 `npm run test:package-ai`；全库搜索除不可改写的 migration 001 历史 DDL 与本 slice 的退役说明外，不再出现 `tjLinks`、`linkClipboard`、`Annotation.links`、`Link to copied` 或旧 Links 浮窗。

**实现状态（已落地；v0.5.0 / schema v9）**

- 已落地 stable `journal_id`、canonical internal URI、typed `InternalLinkTarget / TextLinkSpan`、Fabric `tjTextLinks`、统一字符 mark 变换，以及 title / text annotation 的 Office 式派生链接外观。
- Entry / page annotation 右键 `Copy link`、文字选区 `Link…` / `Ctrl/Cmd+K`、Link Dialog、Open / Edit / Remove、broken-target 提示、save-before-navigation、局部删字与一次 Undo/Redo 已接入；duplicate / stamp copy 保留 `textLinks`，stamp 模板自身不提供地址。
- migration 009 在自动 backup 后精准清理三处 legacy payload，新增持久 `journal_id` 与无 target FK 的 `text_links` 反查投影；真实 v8 backup 的临时副本已成功迁到 v9，61 Entries / 705 annotations 及 tags、results、views、stamp 等 11 张领域表行数前后一致。Entry canvas、annotation index 与 text-link projection 同事务保存，旧 `annotations.links` 仅保留为 migration 001 的历史物理列，运行时不再读写。
- AI Entry context 与 linked context 已切到 `text_links`，支持 typed Entry / annotation 节点、incoming + outgoing 遍历、方向保留与 display text；旧 object-link tool semantics / built-in prompt 已退役，用户改过的旧 prompt 仅作为 disabled custom text 保留。
- 聚焦验证已通过：internal URI / legacy audit / span edit matrix / canvas projection unit tests，schema v7 → v9 golden migration，title hyperlink create → linked delete → Undo → Remove → Undo → Open，以及 secured MCP text-link graph。最终全库 gate 见本 Slice 合入时的验证记录。
