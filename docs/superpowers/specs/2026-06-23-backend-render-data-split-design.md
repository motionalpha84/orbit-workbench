# 前后端渲染数据拆分设计

## 背景

当前轨道模拟工作台是一个静态网页应用。`server.mjs` 只负责提供静态文件，浏览器端的 `js/app.mjs` 同时处理 DOM 交互、应用状态、轨道计算调度、Three.js 场景更新、星下点地图数据更新和导入导出。轨道传播在 `js/orbit.mjs`，星下点计算在 `js/groundtrack.mjs` 与 `js/groundtrack-history.mjs`，3D 渲染在 `js/scene.mjs`，2D 地图绘制在 `js/groundtrack-view.mjs`。

本次需求是把项目拆成前后端：前端只负责显示和交互，后端负责计算与渲染。经确认，“后端渲染”在本项目中定义为：后端生成前端可直接绘制的渲染数据，包括轨道参考点、尾迹采样点、当前点、星下点地图路径、统计结果和导出内容；前端仍使用浏览器 WebGL 和 Canvas 将这些数据画出来，不由后端输出图片流或视频流。

## 目标

- 将轨道计算、摄动传播、轨迹采样、星下点计算、区域统计、CSV 数据生成迁到后端 API。
- 前端保留现有界面和交互，不再直接调用轨道传播和星下点计算函数。
- 后端返回结构化渲染数据，前端只做状态展示、交互处理、时间推进、插值和 buffer/canvas 更新。
- 保持现有本地启动方式：双击 `start-workbench.bat` 或运行 `node server.mjs`。
- 保持现有离线资源策略，不引入在线地图服务或网络瓦片。

## 非目标

- 不把 Three.js/WebGL 真正搬到服务端。
- 不做后端图片帧、视频流或远程桌面式渲染。
- 不重做页面 UI 布局。
- 不新增数据库、登录、多用户会话或远程部署能力。
- 不改变当前二体、J2、J3 模型的物理语义。

## 设计选择

采用 HTTP 批量预计算方案。

用户新增或修改轨道、切换摄动模型、切换性能档位、修改 UTC 起点、打开星下点地图或改变地图窗口时，前端请求后端生成对应的渲染数据。播放过程中，前端使用后端已返回的采样数据按当前仿真秒显示，不在浏览器内重新求解二体、J2 或 J3 传播。

这个选择比逐帧 HTTP 请求更流畅，也比 WebSocket 推送更简单。它贴合当前项目的静态网页结构，同时满足“后端计算并生成渲染数据，前端只负责显示数据和处理交互”的边界。

## 架构

项目拆成三个层次：

- `backend/`：Node 后端业务模块。负责轨道计算、渲染数据生成、星下点数据生成、区域统计、CSV 生成和 API 请求处理。
- `shared/`：前后端共享的数据契约、默认值、响应格式和轻量常量。该层不依赖 DOM、Canvas、Three.js 或 Node HTTP。
- `js/`：前端交互和绘制模块。保留 DOM 事件、状态展示、Three.js 场景对象、Canvas 地图对象和导入导出交互；通过 `js/api-client.mjs` 与后端通信。

`server.mjs` 从静态文件服务器升级为静态文件与 API 共存的本地 HTTP 服务。静态文件仍从项目根目录读取，`/api/*` 请求交给后端路由处理。

## 后端模块

`backend/http-utils.mjs`

- 读取 JSON 请求体。
- 发送统一 JSON 响应。
- 发送文本响应，例如 CSV。
- 处理请求体过大、非法 JSON、方法不允许和未找到的 API。

`backend/orbit-service.mjs`

- 接收轨道六要素。
- 调用轨道校验和计算逻辑。
- 返回标准轨道记录、周期、近地点高度、远地点高度、速度范围、初始 ECI 位置和速度。

`backend/render-data-service.mjs`

- 为 3D 场景生成可绘制数据。
- 返回每条轨道的完整参考轨迹点、播放采样点、尾迹采样窗口、当前点插值所需数据、地球自转角和坐标系轴旋转角。
- 应用性能预算，限制每条轨道最大参考点数和播放采样点数。

`backend/groundtrack-service.mjs`

- 生成星下点地图渲染数据。
- 返回地图路径段、当前星下点、跨日期线断线后的 segments、轨道颜色、UTC 时间、动力学模型和筛选结果。
- 生成框选区域统计。
- 生成 CSV 文本。

`backend/api-router.mjs`

- 根据路径分发 API。
- 把业务异常转换为统一错误响应。
- 保持 API 无浏览器依赖，便于 Node 测试直接调用。

`shared/contracts.mjs`

- 定义 API 版本号。
- 定义支持的摄动模型、性能模式和默认窗口参数。
- 定义统一响应格式：`{ ok: true, data }` 和 `{ ok: false, error }`。
- 定义错误字段：`code`、`message`、`details`。

## API

`POST /api/orbit`

请求体：

```json
{
  "elements": {
    "name": "LEO-01",
    "semiMajorAxisKm": 7000,
    "eccentricity": 0.001,
    "inclinationDeg": 51.6,
    "raanDeg": 40,
    "argPeriapsisDeg": 30,
    "trueAnomalyDeg": 0
  },
  "color": "#568c87"
}
```

响应数据：

```json
{
  "id": "orbit-id",
  "name": "LEO-01",
  "color": "#568c87",
  "visible": true,
  "orbit": {
    "elements": {
      "semiMajorAxisKm": 7000,
      "eccentricity": 0.001,
      "inclinationDeg": 51.6,
      "raanDeg": 40,
      "argPeriapsisDeg": 30,
      "trueAnomalyDeg": 0
    },
    "periodSeconds": 5828.51664,
    "meanMotionRadS": 0.001078,
    "initialMeanAnomalyRad": 0
  },
  "metrics": {
    "periodSeconds": 5828.51664,
    "periapsisAltitudeKm": 621.863,
    "apoapsisAltitudeKm": 635.863,
    "speedRangeKmS": { "min": 7.54, "max": 7.56 },
    "initialPositionKm": { "x": 0, "y": 0, "z": 0 },
    "initialVelocityKmS": { "x": 0, "y": 0, "z": 0 }
  }
}
```

`POST /api/scene-render-data`

请求体包含轨道记录、当前仿真秒、摄动模型、坐标系、性能设置和是否需要参考轨道。响应返回：

- `earthRotationAngleRad`
- `frameAxesRotationAngleRad`
- `orbits[].referencePoints`
- `orbits[].playbackSamples`
- `orbits[].tailSamples`
- `orbits[].current`

前端使用这些数组更新 Three.js geometry 和 marker，不在 `scene.mjs` 内调用 `propagateOrbit` 或 `sampleOrbit`。

`POST /api/ground-track-render-data`

请求体包含轨道记录、当前仿真秒、UTC 起点、摄动模型、地图窗口、性能设置和筛选轨道 ID。响应返回：

- `tracks[].segments`
- `tracks[].pastSegments`
- `tracks[].currentSegments`
- `tracks[].current`
- `tracks[].points`
- `window`

前端使用这些数据调用 `GroundTrackView.setData()` 绘制地图。

`POST /api/ground-track-region-stats`

请求体包含当前地图渲染数据或轨道记录与区域 bounds。响应返回区域命中的轨道数量、点数、每条轨道的时间范围、经纬度范围和动力学模型。

`POST /api/ground-track-csv`

请求体包含当前地图渲染数据或生成渲染数据所需的参数。响应返回 `text/csv; charset=utf-8`。

## 前端数据流

新增 `js/api-client.mjs` 作为前端唯一 API 入口。它负责：

- `fetch` 调用。
- 请求取消，避免快速修改输入时旧结果覆盖新结果。
- 统一解析 `{ ok, data, error }`。
- 把网络错误转换为前端可显示消息。

`js/app.mjs` 的职责调整为：

- 读取表单、文件和控制项。
- 调用 API 获取轨道记录和渲染数据。
- 保存当前 UI 状态、选择状态、播放状态和最近一次可用渲染数据。
- 把渲染数据传给 `OrbitScene` 和 `GroundTrackView`。
- 在播放循环中推进时间，并从已有采样数据中选择或插值当前显示点。

`js/scene.mjs` 的职责调整为：

- 保留 Three.js 场景、相机、控制器、材质、几何和截图。
- 接收后端返回的 `referencePoints`、`tailSamples`、`current`、地球自转角和坐标轴旋转角。
- 不再导入或调用轨道传播函数。

`js/groundtrack-view.mjs` 的职责基本保持：

- 接收后端返回的地图 tracks。
- 绘制底图、经纬线、路径段、当前点、辅助线、框选区域和 tooltip。
- 不调用轨道传播或星下点计算函数。

## 缓存与播放

后端返回的渲染数据带有 `signature`，由轨道参数、摄动模型、UTC 起点、性能档位、地图窗口和筛选轨道组成。前端保存最近一次成功响应。

当用户只是在播放、暂停、重置或改变播放倍率时，前端不重新请求后端，只使用已有采样数据更新显示。当用户改变影响物理结果或采样密度的参数时，前端重新请求对应 API。

若请求失败，前端保留上一次可用渲染数据并显示错误提示，避免视图立即变空。

## 错误处理

所有 JSON API 成功响应：

```json
{ "ok": true, "data": { "version": 1 } }
```

所有 JSON API 错误响应：

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "近地点必须高于地球表面。",
    "details": { "field": "semiMajorAxisKm" }
  }
}
```

后端负责轨道参数校验、请求体校验、摄动模型校验和性能参数归一化。前端只显示错误，不重复实现物理校验逻辑。

常用错误码：

- `BAD_JSON`
- `VALIDATION_ERROR`
- `UNSUPPORTED_MODEL`
- `NOT_FOUND`
- `METHOD_NOT_ALLOWED`
- `INTERNAL_ERROR`

## 测试计划

后端单元测试：

- 轨道计算返回指标和初始状态。
- 非法轨道参数返回结构化错误。
- 3D 渲染数据包含参考轨迹、播放采样、尾迹采样和当前点。
- 参考轨迹采样数量受性能预算限制。
- 星下点渲染数据包含断线后的 segments。
- 区域统计返回命中轨道和命中点。
- CSV 响应包含轨道名称、轨道 ID、仿真秒、UTC 时间、经度、纬度和动力学模型。

API 测试：

- `POST /api/orbit` 成功与失败响应。
- `POST /api/scene-render-data` 返回可绘制数据。
- `POST /api/ground-track-render-data` 返回地图 tracks。
- `POST /api/ground-track-region-stats` 返回统计。
- `POST /api/ground-track-csv` 返回 CSV 文本。
- `GET /index.html` 和静态资源仍可访问。
- 未知 `/api/*` 返回结构化 404。

前端静态和轻量集成测试：

- `js/app.mjs` 导入 `js/api-client.mjs`。
- `js/app.mjs` 不再直接导入 `computeOrbit`、`propagateOrbit`、`sampleOrbit`、`groundTrackPoint`。
- `js/scene.mjs` 不再导入 `js/orbit.mjs`。
- `js/groundtrack-view.mjs` 不导入轨道计算模块。
- `OrbitScene` 存在接收后端渲染数据的方法。
- 页面现有控件 ID 和本地启动脚本保持可用。

浏览器验证：

- 启动本地服务后页面可打开。
- 新增轨道后指标、3D 轨道、当前点和尾迹显示正常。
- 切换二体、J2、J3 后前端重新请求后端数据并刷新显示。
- 播放、暂停、重置、速度倍率仍可用。
- 星下点地图展开、筛选、窗口切换、框选统计和 PNG 导出仍可用。
- 后端 API 失败时页面显示错误并保留上一次可用视图。

## 验收标准

- `server.mjs` 同时提供静态文件和 `/api/*` 后端接口。
- 轨道传播、星下点计算、统计和 CSV 生成由后端执行。
- 前端不再直接执行轨道传播、采样或星下点计算。
- 3D 场景和 2D 地图只消费后端生成的渲染数据。
- 现有启动方式和主要交互保持可用。
- 自动化测试覆盖后端服务、API 合同和前端职责边界。
