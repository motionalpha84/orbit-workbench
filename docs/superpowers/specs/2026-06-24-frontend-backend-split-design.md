# 前后端双进程拆分设计

## 背景

当前轨道模拟工作台是原生 HTML、CSS、浏览器 ES modules 应用。`server.mjs` 只提供静态文件，页面主要逻辑集中在 `js/app.mjs`；轨道传播在 `js/orbit.mjs`，星下点计算在 `js/groundtrack.mjs` 与 `js/groundtrack-history.mjs`，3D 场景显示在 `js/scene.mjs`，2D 星下点地图显示在 `js/groundtrack-view.mjs`。

本次需求是把项目拆成前后端：前端只负责显示和交互，后端负责计算与渲染数据生成。这里的“后端渲染”定义为：后端生成前端可直接绘制的数据，包括轨道参考点、播放采样点、尾迹点、当前点、星下点地图路径、区域统计和 CSV 内容；浏览器仍使用 Three.js 和 Canvas 进行实际绘制，不由后端输出图片流、视频流或远程桌面式画面。

本设计取代 `2026-06-23-backend-render-data-split-design.md` 中“`server.mjs` 同时提供静态文件和 `/api/*`”的单进程方案。本次确认采用独立前端静态服务和独立 Fastify 后端 API 服务两个进程。

## 目标

- 前端静态服务和后端 API 服务分离为两个进程。
- 后端使用 Fastify，默认监听 `http://127.0.0.1:26563`。
- 前端静态服务继续默认监听 `http://127.0.0.1:4173`。
- 保留双击 `start-workbench.bat` 的日常启动体验，同时新增 npm 脚本供开发调试。
- 前端通过可配置 API 地址访问后端，默认请求 `http://127.0.0.1:26563`。
- 将轨道计算、摄动传播、轨迹采样、尾迹数据、星下点路径、区域统计和 CSV 生成迁到后端 API。
- 前端保留现有页面布局、交互、Three.js 场景对象、Canvas 地图对象和本地播放控制。
- 播放时采用批量预计算：参数改变时请求后端，播放、暂停、重置和倍率变化时复用已有采样数据。

## 非目标

- 不把 Three.js 或 Canvas 真正搬到服务端。
- 不生成服务端图片帧、视频流或 WebRTC 画面。
- 不重做 UI 布局，不引入前端构建体系。
- 不新增数据库、登录、多用户会话或远程部署平台。
- 不改变二体、J2、J3 模型的物理语义。
- 不要求前后端立刻部署到不同机器，但保留 API 地址配置能力。

## 已确认决策

- 后端生成可绘制数据，前端继续使用 Three.js 和 Canvas 显示。
- 前后端拆成两个进程。
- 允许新增 `package.json` 和 npm 依赖。
- 默认本机运行，但 API 地址可配置，便于以后跨域或换端口部署。
- 播放数据采用批量预计算。
- 后端框架使用 Fastify。
- 保留双击脚本和 npm 脚本两种启动方式。
- 后端 API 默认端口为 `26563`，不是 `3001`。

## 架构

项目保持当前原生前端结构，不强制搬迁 `index.html`、`styles.css`、`js/`、`assets/` 和 `vendor/`。新增后端目录和前端 API 客户端：

- `server.mjs`：前端静态服务，默认端口 `4173`。
- `backend/app.mjs`：创建 Fastify app，注册 CORS、健康检查、API routes 和统一错误处理。
- `backend/server.mjs`：读取 `API_HOST` 与 `API_PORT` 并启动后端，`API_PORT` 默认 `26563`。
- `backend/routes/*.mjs`：按功能注册 API 路由。
- `backend/services/*.mjs`：轨道记录、3D 渲染数据、星下点渲染数据、区域统计、CSV 等业务服务。
- `shared/contracts.mjs`：共享 API 版本、枚举、默认值、响应格式和输入规范化。
- `js/api-client.mjs`：浏览器访问后端的唯一入口，统一处理 API 基址、请求取消、响应解析和错误消息。
- `package.json`：定义依赖和 `dev`、`frontend`、`backend`、`test` 脚本。
- `start-workbench.bat`：同时启动前端和后端，并打开 `http://127.0.0.1:4173`。

`js/orbit.mjs` 与 `js/groundtrack.mjs` 当前包含纯计算逻辑。实现时可以先让后端直接导入这些模块以降低迁移风险；前端最终不再直接导入或调用其中的传播、采样、星下点计算函数。后续若需要更严格的边界，可把纯计算模块迁到 `shared/physics/` 或 `backend/physics/`，再更新测试。

## 后端 API

`GET /`

返回后端健康状态，便于用户直接在浏览器打开 `http://127.0.0.1:26563/` 确认后端已启动。

示例响应：

```json
{
  "ok": true,
  "service": "orbit-api",
  "version": 1
}
```

`POST /api/orbit`

接收轨道六要素和显示颜色，返回标准轨道记录、周期、近地点高度、远地点高度、速度范围、初始 ECI 位置和速度。前端新增或编辑轨道时调用此接口，不再直接执行 `computeOrbit`。

`POST /api/scene-render-data`

接收轨道列表、当前仿真秒、摄动模型、坐标系和性能设置，返回 3D 场景可绘制数据：

- `earthRotationAngleRad`
- `frameAxesRotationAngleRad`
- `orbits[].referencePoints`
- `orbits[].playbackSamples`
- `orbits[].tailSamples`
- `orbits[].current`

前端使用这些数据更新 Three.js geometry、marker、尾迹和指标显示。`js/scene.mjs` 不再调用 `propagateOrbit` 或 `sampleOrbit`。

`POST /api/ground-track-render-data`

接收轨道列表、当前仿真秒、UTC 起点、摄动模型、地图窗口、性能设置和筛选轨道 ID，返回星下点地图可绘制数据：

- `tracks[].segments`
- `tracks[].pastSegments`
- `tracks[].currentSegments`
- `tracks[].current`
- `tracks[].points`
- `window`

后端负责日期线断线、历史窗口裁剪和采样预算。前端只把 tracks 传给 `GroundTrackView.setData()`。

`POST /api/ground-track-region-stats`

接收当前地图 tracks 和框选 bounds，由后端返回命中轨道数量、点数、每条轨道的时间范围、经纬度范围和动力学模型。

`POST /api/ground-track-csv`

接收当前地图 tracks 或生成 tracks 所需参数，返回 `text/csv; charset=utf-8`。CSV 包含轨道名称、轨道 ID、仿真秒、UTC 时间、经度、纬度和动力学模型。

## 前端数据流

新增 `js/api-client.mjs`，默认 API 基址为 `http://127.0.0.1:26563`。它支持配置覆盖，例如：

- `window.__ORBIT_API_BASE_URL__`
- 或后续加入静态配置文件，例如 `config/runtime-config.js`

`js/app.mjs` 的职责调整为：

- 读取表单、文件、按钮和控制项。
- 调用 API 创建轨道记录和获取渲染数据。
- 保存 UI 状态、选择状态、播放状态和最近一次成功的后端渲染数据。
- 把 3D 数据传给 `OrbitScene`。
- 把星下点 tracks 传给 `GroundTrackView`。
- 在播放循环中推进时间，并从已有采样数据中选择或插值当前显示点。

当用户新增轨道、编辑轨道、切换二体/J2/J3、切换 ECI/ECEF、修改性能档位、修改 UTC 起点、修改星下点窗口或筛选轨道时，前端请求后端刷新对应渲染数据。

当用户只播放、暂停、重置或改变倍率时，前端不重新请求后端，只使用已有采样数据刷新画面。

请求失败时，前端保留上一次成功画面，并显示错误提示，避免视图立即变空。

## 错误处理

JSON API 成功响应使用统一结构：

```json
{
  "ok": true,
  "data": {}
}
```

JSON API 错误响应使用统一结构：

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "近地点必须高于地球表面。",
    "details": {
      "field": "semiMajorAxisKm"
    }
  }
}
```

后端负责参数校验、请求体校验、摄动模型校验、性能参数归一化和业务异常转换。前端负责展示错误，不重复实现物理校验逻辑。

常用错误码：

- `BAD_JSON`
- `VALIDATION_ERROR`
- `UNSUPPORTED_MODEL`
- `NOT_FOUND`
- `METHOD_NOT_ALLOWED`
- `INTERNAL_ERROR`

## 启动方式

新增 `package.json`：

- `npm run frontend`：启动静态前端服务，默认 `4173`。
- `npm run backend`：启动 Fastify 后端，默认 `26563`。
- `npm run dev`：使用并行启动工具同时启动前端和后端。
- `npm test`：运行 Node 测试。

`start-workbench.bat` 保留给日常使用。它会检查依赖是否存在；若没有 `node_modules`，提示或执行安装；随后同时启动前端和后端，并打开 `http://127.0.0.1:4173`。如果端口被占用，脚本应显示清楚的错误信息，避免用户看到空白页却不知道原因。

## 测试计划

后端单元测试：

- 轨道记录服务返回标准轨道记录、指标和初始状态。
- 非法轨道参数返回结构化错误。
- 3D 渲染数据包含参考轨道、播放采样、尾迹采样和当前点。
- 性能模式限制采样数量。
- 星下点渲染数据包含按日期线拆分后的 segments。
- 区域统计返回命中轨道和命中点。
- CSV 响应包含预期列。

API 测试：

- `GET /` 返回健康状态。
- `POST /api/orbit` 成功与失败响应。
- `POST /api/scene-render-data` 返回可绘制数据。
- `POST /api/ground-track-render-data` 返回地图 tracks。
- `POST /api/ground-track-region-stats` 返回统计。
- `POST /api/ground-track-csv` 返回 CSV 文本。
- 未知 `/api/*` 返回结构化 404。
- 不支持的方法返回结构化 405。

前端边界测试：

- `js/app.mjs` 导入并使用 `js/api-client.mjs`。
- `js/app.mjs` 不再直接导入或调用 `computeOrbit`、`propagateOrbit`、`sampleOrbit`、`groundTrackPoint`、`groundTrackRegionStats`。
- `js/scene.mjs` 不再导入 `js/orbit.mjs`。
- `js/groundtrack-view.mjs` 不导入轨道计算模块。
- `server.mjs` 仍能提供静态资源。

浏览器验证：

- `npm run dev` 启动后，`http://127.0.0.1:4173` 页面可打开。
- `http://127.0.0.1:26563/` 返回健康状态 JSON。
- 新增 7000 km 圆轨道后，指标、3D 轨道、当前点和尾迹显示正常。
- 播放、暂停、重置和倍率变化正常。
- 切换 J2/J3 后重新请求后端并刷新显示。
- 打开星下点地图后 tracks 正常绘制。
- 框选统计由后端返回并显示。
- PNG 导出和 CSV 导出可用。
- 后端 API 失败时前端显示错误并保留上一次成功画面。

## 验收标准

- 前端静态服务与后端 Fastify API 服务是两个独立进程。
- 后端默认端口为 `26563`，前端默认端口为 `4173`。
- `npm run dev` 和 `start-workbench.bat` 都能同时启动前后端。
- 前端默认请求 `http://127.0.0.1:26563`，且 API 地址可覆盖。
- 轨道传播、采样、尾迹数据、星下点路径、区域统计和 CSV 生成由后端执行。
- 前端不再直接执行轨道传播、轨道采样或星下点计算。
- Three.js 和 Canvas 仍在前端负责实际绘制。
- 现有主要交互保持可用。
- 自动化测试覆盖后端服务、API 合同、前端职责边界和静态服务。
