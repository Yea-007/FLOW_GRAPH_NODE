# 花笺 · FLOW_GRAPH_NODE

花笺是一款 Windows 本地 Markdown 便签应用，基于 Tauri 2、Rust 和 React。你可以在主窗口整理笔记，通过全局快捷键随手记录，也可以把常用笔记固定在桌面。

![花笺主窗口，左侧是笔记列表，右侧是编辑和预览区](Docs/images/主窗口截图.png)

## 下载安装

打开 [GitHub Releases](https://github.com/Yea-007/FLOW_GRAPH_NODE/releases/latest)，在 **Assets** 中下载 Windows x64 的 `-setup.exe` 安装包并运行。

## 主要功能

- **Markdown 编辑与预览** 支持 GitHub Flavored Markdown、KaTeX 数学公式和本地图片预览，可在编辑、预览和分栏视图间切换。
- **笔记树** 通过右键菜单创建子笔记，拖动笔记即可调整层级或顺序。
- **预览编辑** 选中预览中的文字可设置文字颜色、背景色和字号。双击普通文字可局部修改，修改会同步到 Markdown 正文。代码和公式可在源码视图中编辑。
- **快捷小窗与桌面磁贴** 默认按 `Ctrl+Space` 或通过系统托盘唤出快捷小窗。常用笔记可以固定为桌面磁贴。
- **本地存储与导入导出** 支持导入和导出 `.md` 文件。可在设置中更改笔记目录、快捷键、主题和自动保存选项。

![同时打开多个快捷便签窗口](Docs/images/小窗多开示例.gif)

## 笔记存放位置

Windows 默认把笔记正文保存在 `%USERPROFILE%\Documents\花笺\notes`。备份时请保留整个 `花笺` 数据目录，以保留笔记层级、排序和设置。如果更改过笔记目录，也请备份该目录及其中的 `.floral-styles` 文件夹。导出的单个 `.md` 文件包含 Markdown 正文，预览中的颜色、背景色和字号保存在独立的样式文件中。

## 从源码运行与构建

- [Node.js 22.12 或更高版本](https://nodejs.org/)，以及 npm
- [Rust 工具链](https://www.rust-lang.org/tools/install)，使用 Windows MSVC 目标
- Visual Studio C++ Build Tools（勾选“使用 C++ 的桌面开发”）和 Microsoft Edge WebView2。参见 [Tauri 的 Windows 前置要求](https://v2.tauri.app/zh-cn/start/prerequisites/#windows)。

```powershell
git clone https://github.com/Yea-007/FLOW_GRAPH_NODE.git
cd FLOW_GRAPH_NODE
npm ci
npm run tauri dev
```

运行测试并构建 Windows 安装包：

```powershell
npm test
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run tauri build
```

安装包生成在 `src-tauri/target/release/bundle/nsis/`。

## 项目来源与许可证

本项目基于 [Achilng/floral-notepaper](https://github.com/Achilng/floral-notepaper) 二次开发，沿用 [MIT 许可证](LICENSE)。
