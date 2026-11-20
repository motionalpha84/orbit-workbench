import { BackendClient } from './backend-client.mjs';
import { PreviewScene } from './preview-scene.mjs';

const $ = (id) => document.getElementById(id);
const designs = {
  command: { name: 'A / 深空指挥', title: '向轨道深处。', subtitle: '定义初始状态，推演每一种可能。', caption: 'A / 沉浸场景 · 悬浮仪表 · 薄荷青' },
  ivory: { name: 'B / 白曜实验室', title: '精密，始于定义。', subtitle: '明亮的仪表界面，安静的深空视野。', caption: 'B / 暖白仪表 · 左侧编辑 · 青灰层次' },
  matrix: { name: 'C / 航迹矩阵', title: '每条航迹，皆可掌控。', subtitle: '场景、任务与结果，在同一视野内。', caption: 'C / 任务优先 · 常驻队列 · 香槟金' },
};
const defaultElements = { semiMajorAxisKm: 7000, eccentricity: 0.001, inclinationDeg: 51.6, raanDeg: 40, argPeriapsisDeg: 30, trueAnomalyDeg: 0 };
const demoRecords = () => [
  { id: 'demo-leo', name: 'LEO-01', color: '#8ce8cd', visible: true, elements: { ...defaultElements, semiMajorAxisKm: 8000 } },
  { id: 'demo-polar', name: 'POLAR-02', color: '#d9e4f2', visible: true, elements: { ...defaultElements, semiMajorAxisKm: 8800, eccentricity: 0.03, inclinationDeg: 98, raanDeg: 112, trueAnomalyDeg: 135 } },
  { id: 'demo-transfer', name: 'ELLIPTIC-03', color: '#e2c881', visible: true, elements: { ...defaultElements, semiMajorAxisKm: 10800, eccentricity: 0.25, inclinationDeg: 27, raanDeg: 205, trueAnomalyDeg: 230 } },
];
let scene;
try { scene = new PreviewScene($('scene-container')); } catch (error) { $('scene-loading').innerHTML = '<b>三维场景无法初始化</b><small>请使用支持 WebGL 的浏览器并开启硬件加速。</small>'; console.error(error); }
const state = { design: 'command', records: [], prepared: [], selected: null, color: '#8ce8cd', time: 0, running: false, model: 'two-body', revision: 0, frameBusy: false, preparing: false, grid: true, labels: true, lastState: new Map(), frameMs: 0 };
const backend = new BackendClient({ onChange: updateBackend });
const format = (n, digits = 2) => Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let toastTimer;
function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3500); }
function setDesign(design) {
  if (!designs[design]) design = 'command';
  state.design = design;
  document.body.dataset.design = design;
  document.querySelectorAll('.design-switch button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.design === design)));
  $('scene-title').textContent = designs[design].title;
  $('scene-subtitle').textContent = designs[design].subtitle;
  $('design-caption').textContent = designs[design].caption;
  document.title = `轨迹演示 v2 · ${designs[design].name}`;
  const url = new URL(location.href); url.searchParams.set('design', design); history.replaceState(null, '', url);
  scene?.setTheme(design);
}
function updateBackend() {
  if (!backend) return;
  const connected = backend.connected;
  $('connection').classList.toggle('offline', !connected);
  $('connection').querySelector('b').textContent = connected ? '计算服务在线' : '计算服务离线';
  $('worker-count').textContent = backend.health?.workers ?? '—';
  const jobs = [...backend.jobs.values()];
  const active = jobs.filter((j) => ['queued', 'running'].includes(j.status));
  const job = active[0] ?? jobs.at(-1);
  $('waiting-count').textContent = active.filter((j) => j.status === 'queued').length;
  const progress = Math.round((job?.progress ?? 0) * 100);
  $('task-status').textContent = !connected ? '后台离线，点击重连' : active.length ? '正在计算轨道' : job?.status === 'failed' ? '任务失败' : job?.status === 'cancelled' ? '任务已取消' : '就绪，等待计算任务';
  $('task-percent').textContent = `${progress}%`;
  $('task-progress').style.width = `${progress}%`;
  $('cancel-task').disabled = !active.length;
  $('matrix-jobs').innerHTML = jobs.slice(-3).reverse().map((j) => `<div class="job-row"><span>${escapeHtml(j.label)}</span><span>${escapeHtml(j.type)}</span><span class="${j.status === 'completed' ? 'job-ok' : ''}">${({completed:'已完成',failed:'失败',cancelled:'已取消',running:'计算中',queued:'排队中'})[j.status] || escapeHtml(j.status)}</span><span>${format(j.durationMs, 0)} ms</span><span>${format((j.resultBytes || 0) / 1024, 1)} KB</span></div>`).join('') || '<div class="orbit-empty">任务将在这里显示实际进度与计算结果。</div>';
}
function renderLists() {
  const html = state.records.map((r) => `<div class="orbit-row ${r.id === state.selected ? 'selected' : ''}" style="--orbit-color:${r.color}"><button data-select="${r.id}" aria-label="选择轨道 ${escapeHtml(r.name)}"><b>${escapeHtml(r.name)}</b><small>a ${format(r.elements.semiMajorAxisKm, 0)} km / i ${format(r.elements.inclinationDeg, 1)}°</small></button><i class="orbit-indicator"></i><button class="delete-orbit" data-delete="${r.id}" aria-label="删除轨道 ${escapeHtml(r.name)}">×</button></div>`).join('') || '<div class="orbit-empty">从一条轨道开始。<br>设置六根数，生成你的第一条航迹。</div>';
  $('compact-list').innerHTML = html;
  $('full-list').innerHTML = html;
  $('orbit-count').textContent = String(state.records.length).padStart(2, '0');
  $('list-count').textContent = state.records.length;
  $('compact-count').textContent = String(state.records.length).padStart(2, '0');
}
function selectOrbit(id) {
  state.selected = state.records.some((r) => r.id === id) ? id : state.records[0]?.id ?? null;
  scene?.setSelected(state.selected);
  const record = state.records.find((r) => r.id === state.selected);
  $('selected-name').textContent = record?.name || 'NO ORBIT';
  $('selected-caption').textContent = record ? 'ORBIT TRACKING / ECI' : 'READY TO INITIALIZE';
  $('telemetry-name').textContent = record?.name || '暂无轨道';
  renderLists(); updateTelemetry();
}
function updateTelemetry() {
  const orbit = state.prepared.find((r) => r.id === state.selected)?.orbit;
  $('out-period').textContent = orbit ? `${format(orbit.periodSeconds)} s` : '—';
  $('out-periapsis').textContent = orbit ? `${format(orbit.periapsisAltitudeKm)} km` : '—';
  $('out-apoapsis').textContent = orbit ? `${format(orbit.apoapsisAltitudeKm)} km` : '—';
  $('out-speed').textContent = orbit ? `${format(orbit.speedRangeKmS?.min, 3)} – ${format(orbit.speedRangeKmS?.max, 3)}` : '—';
  const position = state.lastState.get(state.selected)?.positionKm || state.prepared.find((r) => r.id === state.selected)?.initialState?.positionKm;
  for (const axis of ['x', 'y', 'z']) $(`out-${axis}`).textContent = position ? format(position[axis], 3) : '—';
  const period = orbit?.periodSeconds || 5828;
  $('time-slider').max = Math.round(period);
  $('period-label').textContent = Math.round(period);
  const durationMinutes = period / 60;
  document.querySelectorAll('.ruler-labels span').forEach((el, i) => { const minutes = Math.round(durationMinutes * i / 3); el.textContent = `${String(Math.floor(minutes / 60)).padStart(2,'0')}:${String(minutes % 60).padStart(2,'0')}`; });
}
function updateTime() { $('sim-time').textContent = state.time.toFixed(1).padStart(7, '0'); $('time-slider').value = state.time % Number($('time-slider').max); }
function setRunning(running) {
  state.running = running && state.records.length > 0 && !state.preparing;
  $('play').innerHTML = state.running ? '<span>Ⅱ</span> 暂停 <small>PAUSE</small>' : '<span>▶</span> 运行 <small>RUN</small>';
  $('play').setAttribute('aria-label', state.running ? '暂停仿真' : '运行仿真');
}
function setPreparing(preparing) {
  state.preparing = preparing;
  for (const id of ['generate','model','clear-orbits','load-demo','time-slider','reset','play']) $(id).disabled = preparing;
  document.querySelectorAll('.delete-orbit').forEach((el) => el.disabled = preparing);
  $('generate').innerHTML = preparing ? '<span>后台计算中 <small>COMPUTING</small></span><b>⋯</b>' : '<span>生成轨迹 <small>INITIALIZE</small></span><b>↗</b>';
}
async function prepare(records, label = '轨道初始化', model = state.model) {
  if (state.preparing) return false;
  const revision = ++state.revision;
  setRunning(false); setPreparing(true); $('form-error').textContent = '';
  try {
    const result = await backend.run('prepare', { records, perturbationModel: model, referenceSampleCount: 500, elapsedSeconds: state.time }, label);
    if (revision !== state.revision) return false;
    state.records = records; state.prepared = result.records; state.model = model; state.lastState.clear();
    state.prepared.forEach((r) => state.lastState.set(r.id, r.initialState));
    scene?.setRecords(result.records, records);
    selectOrbit(state.selected);
    $('scene-model').textContent = { 'two-body': '二体模型', j2: 'J2 近似', j3: 'J3 近似' }[state.model];
    $('frame-status').textContent = `${records.length} 条轨道 / 后台已准备`;
    $('scene-loading').hidden = true;
    return true;
  } catch (error) {
    $('form-error').textContent = error.message;
    toast(error.message);
    if (state.records.length === 0) { $('scene-loading').hidden = true; $('frame-status').textContent = '等待生成轨道'; }
    return false;
  } finally { if (revision === state.revision) setPreparing(false); }
}
async function frame(time) {
  if (state.frameBusy || state.preparing || !state.records.length) return;
  state.frameBusy = true;
  const revision = state.revision;
  const start = performance.now();
  try {
    const result = await backend.frame({ records: state.records, elapsedSeconds: time, perturbationModel: state.model, trailCount: 0 });
    if (revision !== state.revision) return;
    state.time = result.elapsedSeconds;
    state.frameMs = performance.now() - start;
    result.records.forEach((r) => state.lastState.set(r.id, r.state));
    scene?.updateFrame(result); updateTime(); updateTelemetry();
    $('frame-status').textContent = `后台帧 ${state.frameMs.toFixed(0)} ms · ${state.records.length} ORBITS`;
  } catch (error) {
    setRunning(false); backend.connected = false; backend.error = error.message; updateBackend();
    $('frame-status').textContent = '后台连接异常，已暂停'; toast(error.message);
  } finally { state.frameBusy = false; }
}
function showPanel(name) {
  document.querySelectorAll('[data-inspector]').forEach((button) => button.classList.toggle('active', button.dataset.inspector === name));
  document.querySelectorAll('.inspector-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `panel-${name}`));
}
function openDialog(title, content, kicker = 'DESIGN REVIEW / V2') { $('dialog-title').textContent = title; $('dialog-content').innerHTML = content; $('dialog-kicker').textContent = kicker; if (!$('dialog').open) $('dialog').showModal(); }
function designInfo() {
  openDialog('三种工作空间，同一条真实轨道。', '<p>本轮用于选择视觉方向与操作布局。三版共用后台计算与场景状态，可以无缝切换对比。</p><div class="dialog-choices"><button data-pick="command">A / COMMAND<b>深空指挥</b><small>深空画布 · 左侧态势 · 右侧编辑<br>适合演示、探索和日常设计</small></button><button data-pick="ivory">B / LABORATORY<b>白曜实验室</b><small>暖白外壳 · 左侧输入 · 右侧仪表<br>适合长时间参数录入与检查</small></button><button data-pick="matrix">C / MISSION MATRIX<b>航迹矩阵</b><small>紧凑视图 · 常驻任务表 · 浅金强调<br>适合批量作业与计算状态观察</small></button></div><p><strong>已可操作：</strong>六根数生成、轨道选择与删除、后台播放、拖动时间、视角、图层、三种动力学模型、任务取消、控制台、轨道 JSON 导出。</p><p><strong>待设计确认后迁移：</strong>完整星下点、矢量标定、资产组与格式兼容、截图与分析导出，以及大批量性能优化。顶部 UTC 是布局示例，当前原型采用相对仿真时间。</p><p>可以直接告诉我“采用 A”，也可以组合，例如“A 的布局 + B 的面板 + C 的任务表”。</p>');
}
function migrationInfo(title = '功能迁移范围') {
  openDialog(title, '<p>这里是 <strong>v2 设计评审原型</strong>，完整功能迁移将在 UI 方向确定后进行。原 v1 保留在独立目录中。</p><p><strong>轨道与仿真：</strong>六根数、ECI / ECEF、二体 / J2 / J3、播放倍率、真实时长限制、显示与视角、粒子尾迹。</p><p><strong>星下点：</strong>历史窗口、多轨迹筛选、经纬度高亮、框选统计、PNG / CSV、关闭与最小化状态。</p><p><strong>矢量标定：</strong>多目标位置 / 速度、命中与最近点、箭头 / 连线 / 速度圆、动态结果。</p><p><strong>资产与导出：</strong>资产组的保存 / 重命名 / 载入 / 删除、旧 JSON / TXT 导入、JSON 导出、组合截图。</p><p><strong>后台：</strong>任务排队、进度、取消、重连、错误恢复。大批量将重点处理任务分块、数据复用、增量传输与批量绘制。</p><p>完整清单与代码位置已保存在项目 docs/v1-feature-inventory.md。此入口用于检查模块位置，尚未接入正式页面。</p>', 'FEATURE PARITY / MIGRATION');
}
document.querySelectorAll('.design-switch button').forEach((button) => button.addEventListener('click', () => setDesign(button.dataset.design)));
document.querySelectorAll('[data-inspector]').forEach((button) => button.addEventListener('click', () => showPanel(button.dataset.inspector)));
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => scene?.setView(button.dataset.view)));
document.querySelectorAll('[data-color]').forEach((button) => button.addEventListener('click', () => {
  state.color = button.dataset.color; $('custom-color').value = state.color;
  document.querySelectorAll('[data-color]').forEach((b) => b.classList.toggle('selected', b === button));
}));
$('custom-color').addEventListener('input', (event) => { state.color = event.target.value; document.querySelectorAll('[data-color]').forEach((b) => b.classList.remove('selected')); });
$('orbit-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (state.preparing) return;
  if (state.records.length >= 100) { $('form-error').textContent = '设计预览上限为 100 条，正式版本将另行进行大批量验收。'; return; }
  const elements = Object.fromEntries(Object.keys(defaultElements).map((key) => [key, Number(event.target.elements[key].value)]));
  const record = { id: crypto.randomUUID(), name: $('orbit-name').value.trim() || `ORBIT-${state.records.length + 1}`, color: state.color, visible: true, elements };
  if (await prepare([...state.records, record], `生成 ${record.name}`)) { selectOrbit(record.id); toast(`${record.name} 已由后台计算完成`); $('orbit-name').value = `LEO-${String(state.records.length + 1).padStart(2, '0')}`; }
});
$('clear-form').addEventListener('click', () => { for (const [key, value] of Object.entries(defaultElements)) $('orbit-form').elements[key].value = value; $('form-error').textContent = ''; });
$('model').addEventListener('change', async (event) => { const model = event.target.value; if (!state.records.length) { state.model = model; return; } if (!await prepare(state.records, '重新计算动力学模型', model)) event.target.value = state.model; });
for (const id of ['compact-list','full-list']) $(id).addEventListener('click', (event) => {
  const select = event.target.closest('[data-select]'); if (select) selectOrbit(select.dataset.select);
  const remove = event.target.closest('[data-delete]');
  if (remove && !state.preparing) {
    setRunning(false); state.revision++;
    state.records = state.records.filter((r) => r.id !== remove.dataset.delete);
    state.prepared = state.prepared.filter((r) => r.id !== remove.dataset.delete);
    scene?.setRecords(state.prepared, state.records); scene?.updateFrame({ records: [...state.lastState].filter(([id]) => state.records.some((r) => r.id === id)).map(([id, state]) => ({ id, state })) });
    selectOrbit(state.selected);
  }
});
$('scene-container').addEventListener('orbitselect', (event) => selectOrbit(event.detail.id));
$('clear-orbits').addEventListener('click', () => { if (state.preparing) return; setRunning(false); state.revision++; state.records = []; state.prepared = []; state.time = 0; state.lastState.clear(); scene?.setRecords([], []); selectOrbit(null); updateTime(); $('frame-status').textContent = '场景为空，等待生成轨道'; toast('预览场景已清空'); });
$('load-demo').addEventListener('click', async () => { if (await prepare(demoRecords(), '演示轨道组')) toast('已载入三条演示轨道'); });
$('play').addEventListener('click', () => { if (!state.records.length) { toast('请先生成一条轨道'); return; } setRunning(!state.running); });
$('reset').addEventListener('click', async () => { setRunning(false); state.revision++; state.time = 0; updateTime(); if (state.frameBusy) await new Promise((resolve) => { const timer = setInterval(() => { if (!state.frameBusy) { clearInterval(timer); resolve(); } }, 30); }); await frame(0); });
let seekTimer;
$('time-slider').addEventListener('input', (event) => { setRunning(false); state.revision++; const time = Number(event.target.value); $('sim-time').textContent = time.toFixed(1).padStart(7, '0'); clearTimeout(seekTimer); const seek = () => { if (state.frameBusy) { seekTimer = setTimeout(seek, 30); return; } frame(time); }; seekTimer = setTimeout(seek, 50); });
$('grid-toggle').addEventListener('click', () => { state.grid = !state.grid; $('grid-toggle').setAttribute('aria-pressed', String(state.grid)); scene?.setLayers({ grid: state.grid }); });
$('labels-toggle').addEventListener('click', () => { state.labels = !state.labels; $('labels-toggle').setAttribute('aria-pressed', String(state.labels)); scene?.setLayers({ labels: state.labels }); });
$('cancel-task').addEventListener('click', () => backend.cancel().catch((error) => toast(error.message)));
$('reconnect').addEventListener('click', async () => { if (await backend.checkHealth()) { toast('计算服务已连接'); if (!state.records.length) await prepare(demoRecords(), '演示轨道组'); } else toast('无法连接，请检查本机服务'); });
$('export-json').addEventListener('click', () => {
  const content = { schema: 'orbital-v2-design-preview', version: 1, perturbationModel: state.model, records: state.records };
  const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'orbit-v2-preview.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('已导出预览轨道 JSON；旧格式兼容将在正式迁移中验收');
});
$('design-info').addEventListener('click', designInfo); $('review-checklist').addEventListener('click', () => migrationInfo());
$('close-dialog').addEventListener('click', () => $('dialog').close());
$('dialog').addEventListener('click', (event) => { const choice = event.target.closest('[data-pick]'); if (choice) { setDesign(choice.dataset.pick); $('dialog').close(); } if (event.target === $('dialog')) { const rect = $('dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('dialog').close(); } });
$('open-help').addEventListener('click', () => openDialog('从一条轨道开始', '<p><strong>1.</strong> 在右侧输入六根数，点击“生成轨迹”。计算在本机 Node.js 线程池中完成。</p><p><strong>2.</strong> 拖动旋转地球，滚轮缩放；点击轨道标牌或列表选择轨道。“计算输出”显示选中轨道的实际结果。</p><p><strong>3.</strong> 点击“运行”，选择倍率，或拖动时间轴。播放每次只允许一个后台帧请求。</p><p><strong>4.</strong> 顶部 A / B / C 可切换整体布局，当前轨道与时刻保持。原型数据仅保留在本页会话，刷新会恢复演示轨道。</p><p>本轮先评审设计。星下点与标定入口显示迁移范围，完整业务在设计确定后接入。</p>', 'QUICK START'));
document.querySelectorAll('[data-panel]').forEach((button) => button.addEventListener('click', () => {
  const panel = button.dataset.panel;
  if (panel === 'workbench') showPanel('design');
  else if (panel === 'assets') { showPanel('list'); toast('当前展示场景轨道；完整资产组管理待正式迁移'); }
  else if (panel === 'groundtrack') migrationInfo('星下点 · 页面位置预留');
  else if (panel === 'calibration') migrationInfo('矢量标定 · 页面位置预留');
  else if (panel === 'console') openDialog('本机计算控制台', `<p>以下内容来自当前预览实际提交的任务。</p><div class="console-log">${escapeHtml(backend.logs.join('\n') || '暂无任务日志')}</div>`, 'COMPUTE ENGINE / LOG');
  else if (panel === 'settings') openDialog('显示设置', `<div class="settings-row"><span>当前设计</span><strong>${designs[state.design].name}</strong></div><div class="settings-row"><span>地球网格</span><strong>${state.grid ? '开启' : '关闭'}</strong></div><div class="settings-row"><span>轨道标牌</span><strong>${state.labels ? '开启' : '关闭'}</strong></div><div class="settings-row"><span>后台线程</span><strong>${backend.health?.workers ?? '—'}</strong></div><p style="margin-top:18px">使用视口底部的“网格 / 标牌”按钮调整显示；使用顶部的 A / B / C 切换设计。正式设置页将在定稿后接入性能预设与完整参数。</p>`, 'DISPLAY / SETTINGS');
}));
setDesign(new URL(location.href).searchParams.get('design') || 'command');
renderLists(); updateTime();
setInterval(() => { if (state.running && !state.frameBusy && !state.preparing && !document.hidden) frame(state.time + Number($('speed').value) * 0.08); }, 80);
setInterval(async () => { const connected = await backend.checkHealth(); if (!connected) setRunning(false); }, 10000);
if (await backend.checkHealth()) { await prepare(demoRecords(), '演示轨道组'); }
else { $('scene-loading').hidden = true; $('frame-status').textContent = '计算服务未连接'; toast('请启动本机后台后重试连接'); }
window.addEventListener('beforeunload', () => scene?.dispose());
