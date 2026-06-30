# 标定点列表编辑器优化设计

## 背景

当前“位置/速度标定”中，用户直接在多条输入行中编辑目标矢量，并立即参与标定。用户希望将逻辑调整为：先在单独输入区填写名称、类型和 ECI 矢量，再添加到标定点列表。标定点列表承担显示、编辑、删除和显示/隐藏标定点的职责，交互应类似轨道列表。

## 目标

- 输入区只维护一个待添加或待编辑的标定点。
- 点击“添加至标定列表”后，目标进入标定点列表。
- 列表项右侧提供显示/隐藏、编辑、删除按钮。
- 列表不再使用颜色圈区分标定点。
- “标定全部”只对已添加到列表中的目标运行。

## 输入区

输入区继续使用四行布局：

- 第一行：名称、类型。
- 第二行：`x`。
- 第三行：`y`。
- 第四行：`z`。

类型为位置时，`x/y/z` 单位显示 `km`；类型为速度时，单位显示 `km/s`。

按钮语义：

- 默认状态：主按钮为“添加至标定列表”。
- 编辑状态：主按钮为“保存修改”，旁边显示“取消编辑”。
- 输入校验失败时，在输入区下方显示错误，不改变列表。

## 标定点列表

列表参考轨道列表样式：

- 无颜色圈。
- 主体显示名称、位置/速度类型和标定状态，不显示矢量摘要。
- 标定后显示命中数、无解或输入状态。
- 单击主体展开/收回详细结果。
- 右侧按钮依次为显示/隐藏、编辑、删除。

显示/隐藏只影响该目标对应的 3D 标定点，不删除目标，不清空结果。

编辑列表项时，将该项回填到输入区，并进入编辑状态。保存后更新该列表项，清空该项旧标定结果和 3D 标记，等待重新标定。

删除列表项时移除该目标、对应结果和 3D 标定点。如果列表为空，“标定全部”显示“请先添加标定点”。

## 数据模型

新增：

```js
calibrationDraftTarget: {
  name: '',
  mode: 'position',
  vector: { x: '', y: '', z: '' },
}
calibrationEditingTargetId: null
calibrationEditorError: ''
```

保留：

```js
calibrationTargets: []
calibrationResult: null
calibrationExpandedTargetIds: Set
hiddenCalibrationTargetIds: Set
```

`calibrationTargets` 只保存已添加目标。`calibrationDraftTarget` 不参与标定，除非用户点击添加或保存。

## 测试计划

扩展静态测试：

- HTML 包含 `calibration-target-editor` 和 `calibration-editor-error`。
- 主按钮文本为“添加至标定列表”。
- 存在“标定点列表”标签。
- app 中存在 `calibrationDraftTarget`、`calibrationEditingTargetId`、`addOrSaveCalibrationTarget`、`editCalibrationTarget`、`deleteCalibrationTarget`。
- 结果列表项不再渲染 `.color-dot`。

验证：

- 聚焦运行 `node --test test/static-files.test.mjs`。
- 全量运行 `node --test`。
- 语法检查 `js/app.mjs`、`js/scene.mjs`、`js/orbit.mjs`、`js/vector-calibration.mjs`。
- 浏览器验证添加、编辑、删除、显示/隐藏和标定结果展开。

## 不在范围

- 不改变标定求解算法。
- 不做拖拽排序。
- 不持久化标定点列表到 localStorage。
- 不新增批量导入/导出标定点。
