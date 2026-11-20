# 导入功能 · 前后端对接说明

版本 2.0 · 2026-10-23。本文是「资产 → 导入」改版的对接依据：说明**前端已完成的窗口与数据处理**，以及**后台需要补充的接口**。本轮按要求只搭建前端，`server.mjs`、`server/`、计算模块均未修改；现有接口（[server/API.md](../server/API.md)）保持原样可用。

## 1. 现状一览

| 能力 | 前端（已完成） | 后台（待对接） | 当前效果 |
| --- | --- | --- | --- |
| 导入工作环境 JSON | 原有流程，仅改名 | 无需改动 | 完整可用 |
| 导入轨道六要素 TXT | 每行一条轨道（与六要素组同格式，兼容旧版逐行数值）→ 导入窗口 → 选择中心天体 | 中心天体参数化（§4.1） | 选「地球」完整可用；其它天体为「待后台接入」，不可选 |
| 导入统一六要素组 TXT | 新格式解析 → 导入窗口 → 选择中心天体 → 填入组名 | 同上 | 同上 |
| 导入轨迹 TXT（位置矢量） | 解析、平滑、ECI/ECEF 换算、工作台绘制、时间同步标记、悬停信息、列表显隐/删除 | 轨迹数据集与帧（§4.3）、星下点与标定（§4.4）、工作环境持久化（§4.5） | 工作台可见、可播放；**仅本次会话保留**，不进入星下点、标定与 JSON 导出 |
| 说明 → 导入格式 | 四种格式示例、字段说明、下载示例；资产中「格式」按钮直达，关闭说明后回到资产 | 无 | 完整可用 |
| 工作台 MODEL 菜单 | 只显示当前 BODY 与 MODEL；行侧箭头展开侧栏选择中心天体 / 动力学模型；J2、J3 仅地球 | 中心天体参数化（§4.1） | 地球完整可用；其余天体灰显「待后台接入」 |

## 2. 交互流程

```
资产
├─ 导入工作环境 JSON ─────────────────────────────→ applyWorkbenchSnapshot（替换场景）
└─ 导入轨道 / 轨迹数据（展开）
   ├─ 导入轨道六要素   → parseOrbitText        ┐
   ├─ 导入统一六要素组 → parseElementGroupText ├→ 导入窗口 M-08：预览表 + 必选「中心天体」→ applyElementsImport（替换场景）
   └─ 导入轨迹         → parseTrajectoryText   → smoothTrajectory → 导入窗口 M-08：预览表 + 平滑预览图 + 必选「坐标系」→ addTrajectories（叠加）
```

- 解析在选择文件后立即进行；格式错误不打开窗口，错误显示在档案区错误条，含行号与列号（§3）。
- 导入窗口的「确认导入」在作出选择前保持禁用（悬停提示「请先选择中心天体 / 坐标系」）。`Esc`、关闭按钮、取消、点击遮罩均只取消本次导入，不关闭资产。
- 中心天体卡片：地球可选；月球、火星、太阳以「待后台接入」灰显。对接后按 §4.1 的能力声明动态启用。
- 六要素与六要素组**替换**当前场景（与原 TXT 导入一致，窗口内提示将被替换的轨道数）；轨迹**叠加**在工作台，不影响轨道名册。

## 3. TXT 格式规范（前端解析即为规范实现）

说明弹窗中的四个示例由测试 `test/trajectory.test.mjs`「every import example in Help parses」逐一用解析器校验，文档与代码不会漂移。

### 3.1 轨道六要素（每行一条轨道）

```
# GROUP: 轨道组001
# name       a(km)   e       i(°)   Ω(°)   ω(°)   ν(°)
LEO-01       8000    0.001   51.6   40     30     0
MOLNIYA-02   26560   0.72    63.4   120    270    10
```

| 规则 | 说明 |
| --- | --- |
| 行结构 | 每行一条轨道：`名称 a e i Ω ω ν`，共 7 列；ν 可省略（6 列）按 0。单位 a / km，角度 / ° |
| 分隔符 | 行内含逗号或 Tab 时按逗号/Tab 分隔（名称可含空格），否则按空白分隔 |
| 注释与表头 | `#` 开头为注释；第一条数据行的第 2 列不是数值时视为表头跳过 |
| 组名 | 可选 `# GROUP: 名称`（也接受 `组名`、`轨道组`，`:` 或 `=`），导入后填入资产组名；旧版逐行格式同样读取该注释 |
| 与六要素组的关系 | 行格式与组名规则完全相同（同一解析器 `parseElementLines`），只是资产中的入口不同 |
| 旧版兼容 | 第一条数据行少于 6 列时按旧版「名称行 + 逐行一个数值」解析，已有文件无需改写 |
| 返回 | `parseOrbitFile` → `{ groupName, records: [{ name, semiMajorAxisKm, eccentricity, inclinationDeg, raanDeg, argPeriapsisDeg, trueAnomalyDeg }] }`；`parseOrbitText` 只返回 `records` |
| 错误 | 与 §3.2 相同的行 / 列提示；只有注释时报 `TXT 文件为空。` |

实现：`js/importers.mjs` `parseOrbitFile`（按首行列数分派）→ `parseElementLines` / `parseLegacyOrbitText`。

**轨道组默认名**：保存轨道组时组名留空，按 `轨道组001`、`轨道组002`… 取第一个未被占用的编号（`js/app.mjs` `defaultAssetGroupName`）；组名输入框占位文字显示下一个默认名。

### 3.2 统一六要素组（与 §3.1 同一行格式 + 组名）

```
# GROUP: 轨道组001
# name   a(km)     e       i(°)   Ω(°)   ω(°)  ν(°)
SSO-01   7078.137  0.0010  98.19  100.0  90.0  0.0
```

| 规则 | 说明 |
| --- | --- |
| 行结构 | 每行一条轨道：`名称 a e i Ω ω ν`，共 7 列；ν 可省略（6 列）按 0 |
| 分隔符 | 行内含逗号或 Tab 时按逗号/Tab 分隔（名称可含空格），否则按空白分隔 |
| 注释 | `#` 开头；`# GROUP: 名称`（也接受 `组名`、`轨道组`，`:` 或 `=`）给出组名 |
| 表头 | 第一条数据行的第 2 列不是数值时视为表头跳过 |
| 返回 | `{ groupName, records: [{ name, semiMajorAxisKm, eccentricity, inclinationDeg, raanDeg, argPeriapsisDeg, trueAnomalyDeg }] }` |
| 错误 | `第 N 行应为「名称 a e i Ω ω ν」共 7 列（ν 可省略），实际 K 列。` / `第 N 行第 K 列（i）不是有效数值。` / `第 N 行第 1 列应为轨道名称。` / `六要素组文件中没有轨道数据。` |

根数取值范围（a > R⊕、0 ≤ e < 1 等）仍由现有 `buildOrbitRecordsFromSerialized` → 后台 `prepare` 校验，错误显示在导入窗口内，窗口不关闭。

### 3.3 轨迹（位置矢量，新）

```
# NAME: TRJ-01
# t(s)    x(km)        y(km)        z(km)
0         7000.000     0.000        0.000
60        6985.363     281.037      354.580
```

| 规则 | 说明 |
| --- | --- |
| 行结构 | `t x y z`（4 列，km），或 `t x y z vx vy vz`（7 列，速度 km/s）；同一条轨迹须统一列数 |
| 时间 `t` | 相对仿真起始的秒数，或 ISO 8601 UTC（`2026-10-23T06:00:00Z`，无时区按 UTC，日期与时间间可用空格）；同一条轨迹须统一类型；严格递增 |
| 多条轨迹 | `# NAME: 名称`（也接受 `名称`、`轨迹名称`）开始一条新轨迹；未命名的单条轨迹取文件名 |
| 约束 | 每条至少 2 个时刻；位置矢量不能为零；单文件最多 100,000 个采样点 |
| 坐标系 | **不写在文件中**，导入窗口中必选 ECI（J2000）或 ECEF |
| 返回 | `[{ name, timeOrigin, hasVelocity, samples: [{ t, positionKm:{x,y,z}, velocityKmS? }] }]`；`t` 为相对本条首个时刻的秒数，`timeOrigin` 为 `{kind:'elapsed', elapsedSeconds}` 或 `{kind:'utc', utcMs}` |
| 错误 | 列数、时间格式、时间类型/列数前后不一致、未严格递增、零矢量、点数不足、超过上限，均带行号 |

## 4. 后台对接

### 4.1 中心天体 `centerBody`

**前端现状**：

- 天体表 `js/bodies.mjs` `BODIES`：`{id, name, code, radiusKm, models, available}`，是 MODEL 菜单的唯一数据源；`available: false` 的天体显示「待后台接入」且不可选。
- **规则：J2 / J3 只对地球开放**（`models: ['two-body','j2','j3']`），其余天体只有 `two-body`。切换天体时 `modelForBody()` 保留当前模型，不可用则回落为 `two-body`，并按改模型处理（清空星下点历史与标定结果、标记场景未保存）。
- 工作台 MODEL 菜单：下拉只显示当前 BODY 与 MODEL 两行；每行左侧箭头（点击、或键盘 ←）向左展开侧栏，分别列出天体与动力学模型；选择后侧栏收起，下拉保留并显示新值。`Esc` 先收侧栏再收下拉。动力学侧栏按当前天体隐藏不适用的模型，并提示「J2 / J3 摄动仅适用于地球」。
- 导入窗口取得 `centerBody`，`applyElementsImport` 只接受 `earth`，写入 `state.centerBody`（工作环境 JSON 已有该字段）。

**后台需要：**

1. 天体常量表（建议放在 `js/orbit.mjs` 旁的新模块，后台与前端共用）：

   | id | μ km³/s² | 赤道半径 km | J2 | J3 | 自转角速度 rad/s |
   | --- | --- | --- | --- | --- | --- |
   | earth | 398600.4418 | 6378.137 | 1.08262668e-3 | −2.53265649e-6 | 7.2921159e-5 |
   | moon | 4902.800066 | 1737.4 | 2.0321e-4 | — | 2.6617e-6 |
   | mars | 42828.37 | 3396.19 | 1.96045e-3 | 3.15e-5 | 7.088218e-5 |
   | sun | 1.32712440018e11 | 695700 | — | — | 2.865e-6 |

   数值以后台选定的参考历书为准，上表供接口联调。界面按 `js/bodies.mjs` 的规则只为地球提供 J2 / J3；若后台以后为其它天体提供带谐项模型，需同时更新该表的 `models`。
2. 所有计算类型（`prepare`、`frame`、`groundtrack`、`calibration`、`ephemeris`）及 `POST /api/datasets` 接受顶层 `centerBody`，缺省 `earth`（旧请求不变）。目前 `orbit.mjs` 直接使用 `MU_EARTH_KM3_S2` 与地球 J2/J3，需改为按天体取参数。
3. 校验：未知天体返回 422 `摄动模型/中心天体不支持`；天体无 J2/J3 数据时选择 `j2`/`j3` 返回 422。
4. 能力声明：`GET /api/health` 的 `capabilities` 增加 `bodies: ["earth", ...]`。**前端对接点**：连接成功后按 `bodies` 设置 `BODIES[].available`（MODEL 侧栏随 `renderBodyOptions()` 重绘即可启用）；导入窗口 `input[name="import-body"]` 卡片当前写死 `disabled` + `is-pending`，同样按 `bodies` 去掉禁用；`applyElementsImport` 删除 `centerBody !== 'earth'` 的拦截；`applyWorkbenchSnapshot` 目前只恢复 `centerBody === 'earth'`，改为接受已声明的天体。
5. 非地球天体的星下点需要该天体的地图与自转模型；未提供前，星下点视图对非地球场景显示「暂不支持」。

### 4.2 统一六要素组

无需新接口：前端解析后与六要素 TXT 走同一 `records` 流程。组名只用于资产轨道组（浏览器本地存储）。若后续需要服务端批量导入（超大文件），可增加 `POST /api/import/element-group`，入参原文本、返回与 §3.2 相同的结构与错误文本。

### 4.3 轨迹数据集与帧

**前端现状**（`js/trajectory.mjs`，纯函数，可直接移植到 worker）：

- `smoothTrajectory(samples, {maxPoints: 6000})`：有速度时用三次 Hermite（同时吻合位置与速度），否则用向心 Catmull-Rom（α = 0.5，无尖点与自交）；首末段用三点二次外推虚拟点。每段步数按两点夹角每 1.5° 一步，1–32 步，总点数不超过 `maxPoints`。
- `trajectoryFrames(trajectory, epochMs)`：每个点按**其自身时刻**的格林尼治恒星时 θ(t) 换算：`r_ECI = Rz(θ)·r_ECEF`，`r_ECEF = Rz(−θ)·r_ECI`；输出 `{elapsed, eci, ecef}`。
- `trajectoryPositionAt(elapsed, points, seconds)`：按时间二分 + 线性插值；超出覆盖时段返回 `null`。
- 工作台（`js/schematic-scene.mjs`）：ECI 视图画 `eci`，ECEF 视图画 `ecef`；首个采样点为空心方块；仿真时间在覆盖时段内时画实心圆点与名称，否则名称落在终点；被地球遮挡段为淡虚线；悬停 8 px 内显示轨迹信息。仿真起始时刻改变时重新换算（按 `epochMs` 缓存）。

平滑精度（半径 7000 km 圆轨道，前端实测，用于后台实现的回归基准）：

| 采样间隔 | 相邻夹角 | Catmull-Rom 最大径向误差 | Hermite（含速度） |
| --- | --- | --- | --- |
| 60 s | 3.7° | 0.010 km | < 0.001 km |
| 150 s | 9.3° | 0.36 km | 0.012 km |
| 300 s | 18.5° | 5.5 km | 0.20 km |
| 600 s | 37.1° | 70 km | 3.2 km |

**建议后台接口**（沿用 v2 数据集约定）：

```http
POST /api/trajectories
Content-Type: application/json

{
  "trajectories": [{
    "id": "trj-uuid", "name": "TRJ-01", "frame": "ECI", "centerBody": "earth",
    "timeOrigin": { "kind": "utc", "utcMs": 1792735200000 },
    "samples": [{ "t": 0, "positionKm": {"x":7000,"y":0,"z":0}, "velocityKmS": {"x":0,"y":7.5,"z":0} }]
  }]
}
```

- 返回 201 `{trajectorySetId, revision, trajectories, samples, expiresInMs}`；`GET/PUT/DELETE /api/trajectories/:id` 与数据集相同（409 `DATASET_REVISION`、410 `DATASET_EXPIRED`）。
- 计算类型 `trajectory`（`POST /api/compute/trajectory`）：入参 `{trajectorySetId, revision, startUtcMs, maxPoints, smoothing: "auto" | "hermite" | "catmull-rom" | "linear"}`；返回 `{trajectories: [{id, elapsed: Float64[], eci: [{x,y,z}], ecef: [{x,y,z}]}]}`，二进制帧沿用 `frame-codec`（Float64）。
- `frame` 增加可选 `trajectorySetId/revision`，响应 `trajectories: [{id, inRange, state: {positionKm, velocityKmS?}}]`（当前时刻插值状态；无速度列时以平滑曲线差分给出速度）。
- 校验在服务端重做（§3.3 规则）；`samples` 上限沿用 100,000 点/请求，超出 413。

**前端切换点**：`addTrajectories()`（`js/app.mjs`）改为先注册 `POST /api/trajectories`，再以 `trajectory` 结果填充 `dense`（把 `eci/ecef` 直接交给 `scene.setTrajectories`，`frameTrajectory` 缓存改读后台结果）；`smoothTrajectory` 仍保留给导入窗口预览。后台不可用时维持当前前端绘制并在窗口提示。

### 4.4 星下点与标定

- 星下点：轨迹的 `ecef` 点直接换算经纬度，无需传播；建议 `groundtrack` 接受 `trajectorySetId`，按时间窗口裁剪并复用现有日期变更线分段与会话历史。
- 矢量标定：`calibration` 增加 `trajectorySetId`，对轨迹的平滑曲线做位置矢量匹配（速度目标仅对含速度列的轨迹有效），命中项 `orbitId` 换为 `trajectoryId`，前端标定点悬停逻辑已可复用（`calibrationMarker` 只依赖 `positionKm/elapsedSeconds/color/name`）。

### 4.5 工作环境 JSON

导出当前为 `version: 1`。建议升级为 `version: 3`（读取兼容 1/2）：

```json
{
  "version": 3,
  "snapshot": {
    "centerBody": "earth",
    "orbits": [ ... ],
    "trajectories": [{ "id": "...", "name": "TRJ-01", "color": "#E0703A", "visible": true, "frame": "ECEF",
                       "centerBody": "earth", "timeOrigin": {"kind": "elapsed", "elapsedSeconds": 0},
                       "samples": [{ "t": 0, "positionKm": {"x":7000,"y":0,"z":0} }] }]
  }
}
```

只保存原始 `samples`，平滑结果在导入时重算，保证可复现。前端改动点：`serializeWorkbenchSnapshot` / `applyWorkbenchSnapshot` 增加 `trajectories`；浏览器本地自动保存需设体积上限（建议超过 2 MB 时只保存在工作环境 JSON，不写 `localStorage`）。

## 5. 前端代码索引

| 位置 | 内容 |
| --- | --- |
| `index.html` `#import-data-toggle` `#import-data-options` | 资产导入：两大类、三个 TXT 选项与「格式」按钮 |
| `index.html` `#import-dialog` `#import-scrim` | 导入窗口 M-08：预览表、平滑预览图、中心天体 / 坐标系卡片 |
| `index.html` `#help-formats` | 说明 → 导入格式（四个示例、字段表、下载示例；英文段落为 `.hf-en`） |
| `js/importers.mjs` | `parseOrbitFile` / `parseOrbitText`（行格式 / 旧版自动识别，均支持 `# GROUP`）/ `parseElementGroupText` / `parseTrajectoryText` |
| `js/bodies.mjs` | 天体表与「J2 / J3 仅地球」规则 |
| `index.html` `#model-menu` `#body-flyout` `#dynamics-flyout`；`js/app.mjs` `setModelFlyout` `selectCenterBody` | MODEL 菜单：当前配置 + 侧栏选择 |
| `js/trajectory.mjs` | 平滑、坐标系换算、按时间取位置 |
| `js/app.mjs` | `readImportFile` → `openImportDialog` → `confirmImport` → `applyElementsImport` / `addTrajectories`；`renderTrajectories`；`trajectoryTooltipHtml`；`setHelpFormat` |
| `js/schematic-scene.mjs` | `setTrajectories`、轨迹绘制与悬停、`frameTrajectory` 缓存 |
| `test/trajectory.test.mjs`、`test/bodies.test.mjs` | 解析（含旧版六要素）、平滑精度、坐标系换算、说明示例可解析；天体与模型规则 |

## 6. 联调验收清单

1. `GET /api/health` 声明 `bodies` 后，导入窗口与 MODEL 侧栏中对应天体可选；未声明时保持灰显。选月球后 MODEL 侧栏只剩「二体」，原 J2 / J3 自动回落为二体。
2. 选月球导入 `a = 1837.4 km` 圆轨道，周期与 `2π√(a³/μ_moon)` 一致；同一文件选地球时报 a 小于地球半径。
3. 轨迹导入后刷新页面仍在（工作环境持久化）；导出 JSON 再导入，轨迹点逐位一致。
4. 同一 ECEF 轨迹在 ECI / ECEF 视图下绘制结果与前端实现的差异 < 1 m（采用相同 θ(t) 模型）。
5. `trajectory` 结果在 §4.3 精度表各采样间隔下误差不超过表中数值。
6. 轨迹星下点经纬度与 `ecef` 点直接换算一致；标定命中轨迹点时返回 `trajectoryId`。
7. 旧前端（不发送 `centerBody` / `trajectorySetId`）请求结果与 2.0 完全一致。
