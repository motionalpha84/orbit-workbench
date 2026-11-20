const statusLabels = { queued: '排队中', running: '计算中', completed: '已完成', failed: '失败', cancelled: '已取消', canceled: '已取消' };
const types = { prepare: '轨道准备', frame: '仿真帧', calibration: '矢量标定', groundtrack: '地面轨迹', ephemeris: '星历' };
const seen = new Set();

function cell(row, className = '') {
  const td = row.insertCell();
  if (className) td.className = className;
  return td;
}

function span(className, text) {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

// Job ledger: id + label, type pill, status pill, segmented progress, timing, size, cancel.
export function renderTaskTable(client) {
  const table = document.getElementById('task-table');
  const body = document.getElementById('task-table-body');
  if (!table || !body) return;
  const jobs = [...client.jobs.values()].reverse();
  let count = table.querySelector('.task-count');
  if (!count) { count = document.createElement('span'); count.className = 'task-count'; table.querySelector('summary').append(count); }
  const active = jobs.filter((job) => ['queued', 'running'].includes(job.status)).length;
  count.textContent = active ? `${active} 项计算中` : `${jobs.length} 项记录`;
  if (!table.open) return;
  body.replaceChildren();
  if (!jobs.length) { const row = body.insertRow(); const td = row.insertCell(); td.colSpan = 7; td.className = 'task-empty'; td.textContent = '提交计算任务后，在这里查看进度、耗时与结果。'; return; }
  for (const job of jobs.slice(0, 32)) {
    const row = body.insertRow();
    row.dataset.status = job.status;
    if (!seen.has(job.id)) { seen.add(job.id); row.classList.add('new'); }
    const label = cell(row);
    label.append(span('id', `J-${String(job.id).replace(/[^\da-z]/gi, '').slice(0, 6).toUpperCase()}`), ' ', span('lb', job.label || types[job.type] || job.type));
    cell(row).append(span('ttype', types[job.type] || job.type));
    const status = span(`st ${job.status}`, statusLabels[job.status] || job.status);
    status.prepend(document.createElement('i'));
    status.title = job.error || '';
    cell(row).append(status);
    const percent = Math.round((job.progress || 0) * 100);
    const bar = span(`segbar sm${job.status === 'failed' ? ' fail' : ''}`, '');
    bar.style.setProperty('--p', String(percent));
    cell(row, 'prog').append(bar, ` ${percent}%`);
    cell(row, 'n').textContent = job.startedAt ? `${Math.round(job.durationMs ?? 0).toLocaleString()} ms` : '—';
    cell(row, 'n').textContent = job.resultBytes ? `${(job.resultBytes / 1024).toFixed(1)} KB` : '—';
    const actions = cell(row);
    if (['queued', 'running'].includes(job.status)) {
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消'; cancel.className = 'task-cancel rbtn'; cancel.setAttribute('aria-label', `取消任务 ${job.label || job.type}`);
      cancel.addEventListener('click', async () => {
        cancel.disabled = true;
        try { Object.assign(job, await client.request(`/api/jobs/${job.id}`, { method: 'DELETE' })); client.emit(); }
        catch (error) { client.log(`取消失败 · ${error.message}`); cancel.disabled = false; }
      });
      actions.append(cancel);
    }
  }
}
