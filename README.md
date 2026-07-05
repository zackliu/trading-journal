# Trading Journal（交易复盘日志）

一个替代 PowerPoint 复盘工作流的桌面应用：把交易图表截图贴到白色复盘页上、做价格行为标注，再用**多对多的分组标签（`group:value`）**分类。同一张复盘**只存一份**，却能出现在任意多个分类视图里，不再靠物理复制。

> 产品边界与领域模型的唯一事实来源是 [trading-journal-brief-ch.md](trading-journal-brief-ch.md)；实现切片计划见 [specs/implementation-plan-ch.md](specs/implementation-plan-ch.md)；给协作/AI 的工作规范见 [AGENTS.md](AGENTS.md)。

## 核心特性

- **复盘页（Entry）**：一张白色页 + 一或多张截图（可移动/叠放/缩放的图片对象）+ 标注 + 页级标签，存一份、永不复制。
- **可打标签的标注**：任意标注（框 / 文本框 / 箭头…）都能挂任意分组的标签；浏览某标签时，携带它的元素会**短暂高亮**指认。
- **分组标签而非文件夹**：分类是 `group:value` 标签的组合查询（保存的动态视图），`date` 是唯一结构性分组。
- **标注级结果（Result）**：每笔交易的结果是标注上可选、可多维、带类型的 `result`，用于筛选与统计，但**不是**标签。
- **词表自管理**：分组 / 标签值 / result 维度都由用户定义，可就地重命名（改显示名、id 不变）、软删除（归档，可恢复），删除有使用的项会二次确认。
- **本地优先**：所有数据存本地 SQLite + 图片文件，无需联网、无账号。

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
| `npm test` | 先 `build` 再跑 Playwright 端到端测试 |
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

产物是单个安装文件 `dist/TradingJournal-<version>-Setup.exe`（`<version>` 取自 `package.json` 的 `version`，当前 `0.0.0`，即 `TradingJournal-0.0.0-Setup.exe`）。把这个 `Setup.exe` 发给对方即可，双击后：

- 可选择安装目录（`allowToChangeInstallationDirectory`）；
- 按用户安装、**不需要管理员权限**（`perMachine: false`、`oneClick: false`）；
- 自动创建开始菜单 / 桌面快捷方式，并注册卸载程序（控制面板可卸载）；
- 卸载时**默认保留**用户数据（`deleteAppDataOnUninstall: false`）。

打包行为在 [electron-builder.yml](electron-builder.yml) 里配置。

### 发布新版本

改 `package.json` 的 `version`（如 `0.1.0`）后重新 `npm run dist`，安装包文件名会随之变化。

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
