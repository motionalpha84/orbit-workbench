# 本机计算接口

服务默认监听 `http://127.0.0.1:4174`。前端与 API 同源，无需安装 npm 依赖。所有数值传播、参考轨道采样、尾迹、星历、地面轨迹历史和矢量标定在 Node.js `worker_threads` 中执行；HTTP 主线程管理队列和静态资源。JSON 或 Float64 二进制结果都在计算线程中编码。

`PORT` 可调整端口，`ORBIT_WORKERS` 可指定 1–16 个线程，默认 `min(4, CPU 可用核心数 − 1)`，至少 1 个。只允许本机 Host 与同源 API 请求。服务器不暴露服务端源文件、测试、历史归档或启动脚本。

## 通用数据

轨道输入 `records` 为数组，元素为：

```json
{
  "id": "orbit-1",
  "name": "LEO",
  "color": "#80e8d2",
  "visible": true,
  "elements": {
    "semiMajorAxisKm": 7000,
    "eccentricity": 0.001,
    "inclinationDeg": 51.6,
    "raanDeg": 40,
    "argPeriapsisDeg": 30,
    "trueAnomalyDeg": 0
  }
}
```

也接受原项目的 `record.orbit.elements`。服务端重新校验根数，不信任客户端提交的派生参数。`perturbationModel` 为 `two-body`、`j2`、`j3`，默认 `two-body`。复用原项目 `js/orbit.mjs` 与地面轨迹、标定模块，保持原有数值模型；J2/J3 仍为原模型近似，没有升级为高精度数值积分器。

## 队列

- `GET /api/health`：返回 `ok`、`workers`、`running`、`queued`、`completed`、`failed`、`cancelled`、`retainedJobs`、`resultBytes`、`limits`。
- `POST /api/jobs`，JSON `{ "type": "prepare", "payload": { ... } }`：返回 HTTP 202 和任务描述。
- `GET /api/jobs`：`{jobs:[...], ...队列统计}`，不列出短暂的直接计算请求。
- `GET /api/jobs/:id`：状态和进度。
- `GET /api/jobs/:id/result`：完成返回 200 和结果，未完成返回 202，失败 422，取消 410。
- `DELETE /api/jobs/:id`：取消排队或运行中的任务，已完成的任务保持完成状态。
- `GET /api/events`：可选 SSE，`job` 事件携带任务描述，首条 `health` 事件携带队列统计。

任务描述：`{id,type,status,progress,completed,total,createdAt,startedAt,finishedAt,durationMs,resultBytes,error?}`。`progress` 范围 0–1；时间戳为 Unix 毫秒。状态为 `queued`、`running`、`completed`、`failed`、`cancelled`。

## 计算类型

各类型都可用 `POST /api/compute/:type` 直接等待结果，或通过队列提交。直接请求断开时自动取消任务，结果在响应后立即释放。计算超时限制为 120 秒。

### prepare

输入 `{records,perturbationModel,referenceSampleCount:1800,elapsedSeconds:0}`。

返回 `{records:[{id,orbit,initialState,reference:[{positionKm,elapsedSeconds}]}],perturbationModel,referencePointBudget}`。`orbit` 为原 `computeOrbit` 结果，另附 `orbit.initialState`。参考轨道采用原项目按弧长重采样方法；`referenceSampleCount` 是几何采样上限。

### frame

输入 `{records,elapsedSeconds,perturbationModel,trailCount:130,groundTrack?}`。

返回 `{elapsedSeconds,perturbationModel,records:[{id,state,trail:[{x,y,z}]}],trailCount,tracks?,groundTrack?}`。`state` 为完整 `propagateOrbit` 输出，位置 km，速度 km/s。隐藏轨道仍返回状态，但不计算尾迹。尾迹时间跨度与原项目一致。

可选 `groundTrack`：

```json
{
  "sessionId": "browser-tab-unique-id",
  "resetToken": "0",
  "resetIds": [],
  "startUtcMs": 1704067200000,
  "activeIds": ["orbit-1"],
  "referenceSampleCount": 1800,
  "maxCatchUpPoints": 600,
  "window": {"mode": "revs", "pastRevs": 2, "pastSeconds": 0}
}
```

同一 `sessionId` 始终分配给同一线程，历史只存服务端。首次打开从当前仿真时刻开始；之后增量累积，保留原来的日期变更线分段逻辑。`resetToken` 改变时清空整个会话历史；`resetIds` 仅清除指定轨道。`activeIds` 控制当次返回与采样的轨道。会话最多保留 8 个/线程，30 分钟未使用会过期；线程重启也会清除该线程历史。响应 `groundTrack.reset` 指示新建/重置，`groundTrack.truncated` 指示因总点数预算裁剪了最早历史。

### groundtrack

输入与 `frame` 相同，但只更新并返回地面轨迹，`records` 结果为空。可把地面轨迹选项直接放顶层，或放 `groundTrack` 中。

### calibration

输入 `{records,perturbationModel,sampleCount,targets:[{id,name,mode,vector:{x,y,z}}]}`。`mode` 为 `position` 或 `velocity`。

返回原 `calibrateOrbitVectorTargets` 的完整结果 `{status,perturbationModel,targets,hits}`。保留输入错误、最近点、命中、目标分组等原有行为。

### ephemeris

输入 `{records,perturbationModel,times:[0,60,120]}`，或 `{records,startElapsedSeconds:0,stepSeconds:60,sampleCount:100}`。

返回 `{times,records:[{id,states:[完整传播状态]}],perturbationModel}`。别名 `POST /api/ephemeris` 同样支持。

## 容量与回收

- 每任务最多 5,000 条轨道；请求最多 16 MiB，结果最多 64 MiB。
- 每次参考轨道最多 300,000 点；尾迹最多 200,000 点，随批次自动降低显示采样点数，不改变传播公式。
- 每次星历最多 100,000 个轨道状态；超出须分批请求。
- 每个地面轨迹会话最多 300,000 个历史点，超出移除最早历史；API 明确返回裁剪标记。
- 最多 64 个排队任务；完成任务最多保留 32 个、128 MiB 或 10 分钟，先到限制即回收。过期任务返回 404。
- 取消通过共享内存标记协作终止；1.5 秒内无法退出则终止该线程并补建。意外退出、超时也会补建线程，其当前任务标记失败。
- 400 为无效 JSON，413 为请求过大，415 为 Content-Type 错误，422 为无效参数/计算失败，429 为队列已满，503 为服务关闭中。

验证：`node --test test/backend.test.mjs`。该集成套件验证三种传播模型数值一致性、状态/尾迹/星历、标定、地面历史、取消、线程故障恢复及静态资源访问边界。

## v2：注册数据集、采样缓存与 Float64 帧

旧接口和上述 JSON 结果形状全部保留。`GET /api/health` 新增 `capabilities: {datasets:true,compactFrames:true}` 和 `datasets` 容量统计。

### 数据集生命周期

```http
POST /api/datasets
Content-Type: application/json

{"records":[...原轨道输入...]}
```

返回 201：`{datasetId,revision:1,records:轨道数,expiresInMs:1800000}`。

- `GET /api/datasets/:id` 返回描述并刷新使用时间。
- `PUT /api/datasets/:id`，body `{revision:当前版本,records:[...]}`，以比较当前版本的方式更新，返回递增版本。不匹配返回 409 / `DATASET_REVISION`。
- `DELETE /api/datasets/:id` 删除当前数据集，重复删除仍返回成功。
- 所有计算接口和异步队列都接受 `{datasetId,revision,...原计算选项}`，省略 `records`。不能同时提交数据集引用和根数。
- 已提交任务固定使用提交时的不可变版本；随后更新/删除数据集不会改变排队任务的输入。
- 数据集保留于服务进程内存，默认最多 16 份、64 MiB、30 分钟未使用过期；达到预算按最近使用回收。服务重启后需要重新注册。这是运行时数据集缓存，不替代显式工作区/JSON 持久保存。
- 过期、不存在、已回收的数据集返回 410 / `DATASET_EXPIRED`。版本检查发生在计算入队之前。

### 帧传输

```http
POST /api/compute/frame
Content-Type: application/json
Accept: application/vnd.orbit.frame+binary

{"datasetId":"...","revision":1,"elapsedSeconds":600,"perturbationModel":"j3","trailCount":32}
```

省略 Accept 时仍返回原 JSON。明确请求二进制时，响应 Content-Type 为 `application/vnd.orbit.frame+binary`，由 `js/frame-codec.mjs` 的 `decodeFrame(arrayBuffer)` 恢复原 frame 对象。

二进制布局：8 字节头（小端 ORB2 magic + JSON 头字节数），UTF-8 元数据头，补齐至 8 字节对齐，然后是小端 Float64 数值。协议版本为 1；状态中的全部坐标、速度、角度、派生根数和时间保留 Float64。未打包字段仍在元数据内保存；没有把权威状态转换为 Float32。轨迹尾迹使用连续 Float64 xyz；地图历史只传一次 pastSegments/currentSegments 并重建冗余 points/segments 数组，采样数量、历史窗口、日期变更线边界、重置和筛选语义保持不变。

`BackendClient.frame({records,...})` 的外部接口不变。客户端先通过 health 能力协商，再按不可变 records 数组身份注册一次，后续只发送引用。编辑轨道、颜色、名称或可见性时须提供新数组；界面使用 `wireRecords()` 维护这一约束。模型、时间、尾迹预算等仍是每次请求参数。过期、版本错误或服务重启后的缺失数据集允许自动重新注册并重试一次；计算失败不会转入浏览器传播。旧服务不声明能力时继续使用原 JSON API。

### worker 缓存与观测

- 每 worker 保留最多 16 个已准备数据集，合计最多 10,000 轨道。池知道各线程已接收的版本，只在冷请求/线程重启后向该线程克隆一次根数，后续帧连主线程到 worker 的根数重复克隆也省去。
- 参考采样按根数、模型、有效点数缓存；每 worker 总共最多 300,000 参考点、5,000 个缓存项。改变模型/预算自动失效；时间不影响零时刻参考轨道，但每次 prepare 的 initialState 仍重新按请求时间计算。
- 原地面历史 session affinity 不变；worker 重启后数据集能重新装载，地面历史仍明确返回 reset 标记。
- 直接结果响应增加 `Server-Timing`（compute/encode）、`X-Dataset-Cache`、`X-Reference-Cache-Hits`。异步任务完成描述增加 `timings` 和 `cache`。这些是诊断值，不改变原结果对象。
- 单个任务仍由一个 worker 计算；此版本优化注册、克隆、采样复用和传输，没有声称单个大批次已经多线程拆分。

### 验证和可复现实测

```powershell
node --test test/backend.test.mjs test/backend-client.test.mjs test/backend-v2.test.mjs
node server/benchmark.mjs
```

2026-10-19，Windows x64 / Node v24.20.0 / Intel i5-14600KF / 32 GiB，单 worker，J3、每轨 32 尾迹点，预热后各 5 轮，比较同一 v2 数值内核的旧 records/JSON 通道与注册数据集/Float64 通道。下表是 Node 客户端真实 HTTP 往返和解码中位时间，**不代表浏览器渲染 FPS**。

| 轨道数 | 请求 bytes：旧→新 | 响应 bytes：旧→新 | 往返+解码 ms：旧→新 | 参考 prepare 冷→热 ms |
| --- | ---: | ---: | ---: | ---: |
| 100 | 20,624 → 138 | 299,350 → 102,696 | 18.65 → 10.81 | 195.43 → 24.35 |
| 1,000 | 208,296 → 138 | 3,012,436 → 1,027,896 | 93.59 → 54.80 | 1,697.45 → 469.39 |
| 5,000 | 1,050,166 → 138 | 15,067,486 → 5,147,896 | 759.68 → 394.69 | 7,705.00 → 1,185.97 |

5,000 轨道时响应体积减少 65.83%，参考热请求命中 5,000 条；后台 prepare 计算部分从 6,578.014 ms 降至 28.327 ms，剩余时间主要包含完整参考点结果编码、传输与解析。首次注册仍需上传一次完整根数（对应上表规模分别 20,551 / 208,223 / 1,050,093 bytes）。硬件负载与数据分布会影响时间，应使用同一脚本复测；这项优化没有将显示预算或物理模型偷换成更低精度。
