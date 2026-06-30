# 标定面板交互优化设计

## 背景

当前“其他功能 / 位置/速度标定”已经支持多个命名 ECI 矢量同时标定，并按目标输出命中结果。用户希望进一步优化这个工具的呈现和交互，让输入区更紧凑，结果区更像轨道列表，并能按单个标定系列控制 3D 标定点显示。

本优化只调整 UI、结果状态和 3D marker 过滤，不改变标定求解算法、轨道传播模型、坐标系或命中判定逻辑。

## 标题区

标定工具标题仍为“位置/速度标定”。标题右侧只显示 `ECI`，右对齐，不再显示 `km / km/s` 等单位。

## 输入区

每个 ECI 标定目标保持独立行卡片，但内部布局改成四行：

- 第一行：名称输入与类型选择并排显示。
- 第二行：`x` 分量输入。
- 第三行：`y` 分量输入。
- 第四行：`z` 分量输入。

`x/y/z` 每行右侧显示单位。选择位置矢量时单位为 `km`，选择速度矢量时单位为 `km/s`。单位显示右对齐，随该行目标的类型即时切换。

输入区继续支持：

- 添加矢量。
- 删除矢量。
- 标定全部。
- 清除结果且保留输入行。

## 结果区

标定结果改成“标定系列列表”。每个目标矢量对应一条列表项，样式参考轨道列表：

- 左侧显示状态点。
- 中间主体显示目标名称、标定类型、命中数或错误/无解状态。
- 右侧显示可见性按钮。

左键单击列表主体时展开该系列详情；再次单击收回。展开详情包含：

- 输入目标矢量。
- 命中点列表，或最近点参考。
- 仿真时刻。
- ECI 位置。
- ECI 速度。
- 残差。
- 动力学模型。

输入错误、无可见轨道、无有效状态、无精确解都作为列表项状态展示。无精确解时若有最近点，展开后显示最近点详情。

## 标定点显示控制

每个标定系列有独立可见性状态：

- 默认可见。
- 点击右侧显示按钮后，该系列所有 3D 标定点隐藏。
- 再次点击后恢复该系列所有 3D 标定点显示。
- 隐藏状态不删除结果、不删除输入行、不重新求解。

当用户重新运行标定时，已有同 `targetId` 的显示/隐藏状态尽量保留。新增目标默认可见。删除输入行后，其旧结果和 marker 会随现有逻辑清空。

## 数据模型

`state.calibrationExpandedTargetIds` 存储已展开的结果系列 ID。

`state.hiddenCalibrationTargetIds` 存储 marker 被隐藏的目标 ID。

`calibrationMarkersFromBatchResult(result)` 会根据 `hiddenCalibrationTargetIds` 过滤命中点，再传给 `scene.setCalibrationMarkers(...)`。

## 测试计划

扩展静态文件测试：

- 标题右侧显示 `ECI`，不再显示 `km / km/s`。
- 输入区有四行布局相关类名。
- `x/y/z` 单位元素存在。
- 结果区包含列表项、展开按钮和可见性按钮相关类名或数据属性。
- app 中存在展开/收起、系列可见性状态和 marker 过滤函数。

扩展场景标定测试：

- 标定 marker 可携带 `visible: false` 并在标准化时保留。
- 缺省 marker 可见。

扩展应用静态合约测试：

- `renderCalibrationTargets` 根据 mode 输出 `km` 或 `km/s` 单位。
- 结果渲染支持 `data-calibration-result-target` 和 `data-calibration-target-visibility`。
- 可见性切换会重新调用 `scene.setCalibrationMarkers(calibrationMarkersFromBatchResult(...))`。

全量验证：

- `node --test`
- `node --check js\app.mjs`
- `node --check js\scene.mjs`
- `node --check js\orbit.mjs`
- `node --check js\vector-calibration.mjs`

浏览器验证按可用环境执行。若 Codex 内置浏览器或本机 Playwright 浏览器不可用，记录阻塞原因，并用自动化测试和服务端 HTML 合约验证替代。

## 不在本次范围

- 不改变核心标定算法。
- 不增加导入/导出标定目标。
- 不把标定结果同步到星下点地图。
- 不做拖拽排序。
- 不做跨会话持久化结果展开状态。
