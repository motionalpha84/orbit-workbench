## 轨道模拟工作台

本项目是一个本地网页应用，用于在浏览器中演示 ECI / ECEF 坐标系下的轨道仿真、星下点轨迹和位置矢量/速度矢量标定。

## 运行环境

项目无法运行时，通常是因为缺少本地 Web 服务环境，或直接双击打开了 `index.html`。

需要准备：

- Windows 10/11，或其他可运行 Node.js 的系统。
- Node.js 20.11 或更高版本，推荐安装官网标记为 LTS 的版本。
- 现代浏览器，例如 Microsoft Edge、Chrome 或 Firefox。
- 完整项目目录，包括 `index.html`、`server.mjs`、`js/`、`styles.css`、`assets/`、`vendor/` 等文件。

不需要执行 `npm install`。Three.js 等前端依赖已经放在 `vendor/` 中。

不要直接双击 `index.html` 运行。项目使用 ES Module、纹理和本地静态资源，应该通过 `server.mjs` 启动本地 Web 服务后访问。

## 安装 Node.js

如果电脑上没有 Node.js，推荐使用官方安装包（已安装请跳过该步骤）：

1. 打开 Node.js 官方下载页：`https://nodejs.org/en/download`。
2. 选择标记为 `LTS` 的版本。
3. Windows 用户下载 `Windows Installer (.msi)` 并运行安装程序。
4. 安装过程中保持默认选项即可，尤其要保留自动配置 `PATH` 的选项。
5. 安装完成后，关闭并重新打开 CMD 或 PowerShell。
6. 执行以下命令确认安装成功：

```bash
node -v
npm -v
```

只要 `node -v` 显示 `v20.11.0` 或更高版本，就可以运行本项目。`npm` 会随官方 Node.js 安装包一起安装，但本项目当前不需要执行 `npm install`。

如果公司电脑没有管理员权限，可以让管理员安装 Node.js LTS，或使用官方页面提供的免安装压缩包版本，并把解压目录加入用户 `PATH`。

## Windows 启动方式

推荐双击：

```bat
start-workbench.bat
```

默认启动地址：

```text
http://127.0.0.1:4173
```

脚本会优先使用 Codex 桌面环境自带的 Node.js。如果是在其他电脑上运行，且没有 Codex 自带 Node.js，请先安装 Node.js，然后再运行脚本。

## 手动启动

在项目目录中打开终端，运行：

```bash
npm start
```

看到类似输出后，在浏览器打开对应地址：

```text
ECI orbit workbench running at http://127.0.0.1:4173
```

也可以直接运行：

```bash
node server.mjs
```

## 配置网页端口

默认端口是 `4173`。如果端口被占用，可以通过环境变量 `PORT` 修改。

Windows CMD：

```bat
set PORT=4180
start-workbench.bat
```

Windows PowerShell：

```powershell
$env:PORT = "4180"
.\start-workbench.bat
```

也可以直接手动启动：

```powershell
$env:PORT = "4180"
node .\server.mjs
```

macOS / Linux / Git Bash：

```bash
PORT=4180 node server.mjs
```

然后访问：

```text
http://127.0.0.1:4180
```

当前服务固定监听 `127.0.0.1`，即只允许本机访问。如果要换端口，只需要改 `PORT`，不需要修改代码。

## 常见无法运行原因

- 没有安装 Node.js：安装 Node.js 20.11 或更高版本后重试。
- Node.js 版本过旧：`server.mjs` 使用较新的 ESM 能力，旧版 Node 可能无法启动。
- 直接打开 `index.html`：请改用 `start-workbench.bat` 或 `node server.mjs`。
- 端口被占用：设置新的 `PORT`，例如 `4180`、`4181`。
- 只复制了部分文件：请复制完整项目目录，尤其是 `assets/`、`vendor/`、`js/`。
- 在错误目录运行命令：请在包含 `server.mjs` 的项目根目录运行。

## 功能

- 支持 `ECI` / `ECEF` 坐标系切换。
- 输入轨道六要素生成航天器轨迹、粒子尾迹和完整轨道参考。
- 多轨道管理、颜色设置、轨道悬停提示、选中高亮和截图导出。
- 支持二体运动、`J2` 摄动和 `J3` 摄动模型。
- 支持位置矢量/速度矢量标定，并可管理多个标定目标。
- 模拟仿真时刻显示、启动、暂停、重置、速度倍率和现实运行时长限制。
- 支持 `JSON` 导入导出和 `TXT` 批量导入。

## 测试

项目使用 Node.js 内置测试运行器：

```bash
npm test
```

如果不使用 npm，也可以直接运行：

```bash
node --test
```

## 贡献与安全

欢迎通过 Issue 或 Pull Request 反馈问题和改进建议。提交前请阅读 `CONTRIBUTING.md`，安全相关问题请按 `SECURITY.md` 私下报告。

## 许可证

本仓库当前未声明开源许可证。公开发布前，建议由仓库维护者根据实际授权意愿添加 `LICENSE` 文件。
