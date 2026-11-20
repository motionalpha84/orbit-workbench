// Bound DOM work for large imports without limiting the underlying dataset.
const lists = new WeakMap();
export function pageRecords(container, records, render, pageSize = 80) {
  let state = lists.get(container);
  if (!state) {
    const toolbar = document.createElement('div'); toolbar.className = 'list-pagination';
    const input = document.createElement('input'); input.type = 'search'; input.placeholder = '搜索轨道'; input.setAttribute('aria-label', '按轨道名称搜索');
    const previous = document.createElement('button'); previous.type = 'button'; previous.textContent = '‹'; previous.setAttribute('aria-label', '上一页');
    const label = document.createElement('span'); label.setAttribute('aria-live', 'polite');
    const next = document.createElement('button'); next.type = 'button'; next.textContent = '›'; next.setAttribute('aria-label', '下一页');
    toolbar.append(input, previous, label, next);
    state = { toolbar, input, previous, label, next, page: 0, query: '' }; lists.set(container, state);
    input.addEventListener('input', () => { state.query = input.value.toLocaleLowerCase(); state.page = 0; render(); input.focus({ preventScroll: true }); });
    previous.addEventListener('click', () => { state.page--; render(); });
    next.addEventListener('click', () => { state.page++; render(); });
    toolbar.addEventListener('click', (event) => event.stopPropagation());
  }
  if (records.length <= pageSize && !state.query) { state.page = 0; return records; }
  const filtered = state.query ? records.filter((record) => String(record.name).toLocaleLowerCase().includes(state.query)) : records;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  state.page = Math.max(0, Math.min(state.page, pages - 1));
  state.label.textContent = `${state.page + 1}/${pages} · ${filtered.length}`;
  state.previous.disabled = state.page === 0; state.next.disabled = state.page === pages - 1;
  container.append(state.toolbar);
  if (!filtered.length) { const empty = document.createElement('p'); empty.className = 'empty-list'; empty.textContent = '没有匹配的轨道'; container.append(empty); }
  return filtered.slice(state.page * pageSize, (state.page + 1) * pageSize);
}
