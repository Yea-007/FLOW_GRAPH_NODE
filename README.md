# FLOW_GRAPH_NODE · 花笺

花笺是一款 Windows 桌面便签工具。用笔记树整理 Markdown，在分栏视图里边写边看，或按 `Ctrl+Space` 打开小窗随手记录。笔记保存在本机，可导出为 `.md` 文件。

**[下载 Windows x64 安装包](https://github.com/Yea-007/FLOW_GRAPH_NODE/releases/latest)**

在发布页的 **Assets** 中下载并运行以 `-setup.exe` 结尾的文件。

![花笺主窗口，笔记树、Markdown 编辑器和预览并排显示](Docs/images/主窗口截图.png)

## 写下第一篇笔记

1. 在主窗口选择 **新建笔记**，输入标题和正文。已有 `.md` 文件可通过 **导入 Markdown** 加入笔记库。
2. 用 **编辑**、**分栏** 和 **预览** 切换视图。预览支持 Markdown 表格、任务列表、数学公式和本地图片。
3. 在分栏或预览视图中，可以用顶部工具栏调整选中文字的颜色、背景和字号。点击预览中的任务框会同步更新 Markdown 的 `[ ]` 或 `[X]` 状态。普通正文在编辑区修改。

## 整理笔记并放到桌面

- **建立层级** 在侧栏右键点击一篇笔记，选择 **新建子笔记**。拖动已有笔记可以调整层级和顺序。
- **随手记录** 按 `Ctrl+Space` 或通过系统托盘打开快捷小窗。可在设置中自定义快捷键。
- **固定常用笔记** 在主窗口点击 **钉为磁贴**，即可在桌面上查阅常用清单或备忘。

![桌面上同时打开多个快捷便签小窗](Docs/images/小窗多开示例.gif)

## 导出与备份

- **导出单篇** 右键点击笔记，选择 **导出 Markdown**。导出的 `.md` 文件包含正文。预览中的文字颜色、背景色和字号另存在笔记目录的 `.floral-styles` 文件夹中。
- **备份整个笔记库** 默认数据目录为 `%USERPROFILE%\Documents\花笺`，其中包含笔记、层级和排序信息以及应用设置。备份时复制整个目录。如果在设置里指定了其他笔记目录，请同时备份自定义目录。

## 从源码启动

项目使用 Tauri 2、Rust 和 React。Windows 开发环境需要 Node.js 22.12 或更高版本、Rust MSVC 工具链、Visual Studio C++ Build Tools 和 Microsoft Edge WebView2。系统依赖的安装步骤见 [Tauri 的 Windows 开发环境说明](https://v2.tauri.app/zh-cn/start/prerequisites/#windows)。

```powershell
git clone https://github.com/Yea-007/FLOW_GRAPH_NODE.git
cd FLOW_GRAPH_NODE
npm ci
npm run tauri dev
```

运行前端和 Rust 测试，或构建 Windows x64 安装包。

```powershell
npm test
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run tauri build -- --target x86_64-pc-windows-msvc
```

x64 安装包位于 `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`。

## 项目来源

FLOW_GRAPH_NODE 基于 Achilng 的花笺项目二次开发。源码按 MIT 许可证分发。[上游项目](https://github.com/Achilng/floral-notepaper) · [MIT 许可证](LICENSE)
