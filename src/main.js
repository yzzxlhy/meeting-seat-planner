/**
 * main.js — 交互与副作用
 *
 * 所有会改变 state 的入口都在这里：DOM 事件 → 校验 → pushHistory → 修改 state → render → 存档。
 * 渲染层不认识业务规则，state 层不认识 DOM，三方职责不重叠。
 */

'use strict';

/* 注意：S 已由 state.js 在顶层声明，此处不再重复声明，避免合并成单文件后重复绑定。 */

/* ========== 存档 ========== */

let saveTimer = null;
let dirty = false;

function collectState() {
  return {
    version: 30,
    people: S.people,
    seats: S.seats,
    units: S.units,
    absent: Array.from(S.absent.entries()),
    zones: S.zones,
    layout: S.layout,
    font: S.font,
    namesOnly: S.namesOnly,
    showNumbers: S.showNumbers,
    showAxis: S.showAxis,
    meta: S.meta
  };
}

function saveState(showHint) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collectState()));
    dirty = false;
    if (showHint) {
      $('saveHint').textContent = `已保存 · ${new Date().toLocaleTimeString('zh-CN')}`;
    }
  } catch (err) {
    $('saveHint').textContent = '保存失败：浏览器存储不可用。';
  }
}

function scheduleSave() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveState(true), 600);
}

/** 读取存档，兼容旧版 seating-tool-state-v28。 */
function loadState() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      for (const key of LEGACY_STORAGE_KEYS) {
        const legacy = localStorage.getItem(key);
        if (legacy) { raw = legacy; break; }
      }
    }
  } catch (err) {
    return false;
  }
  if (!raw) return false;

  try {
    const d = JSON.parse(raw);

    if (d.version === 30) {
      S.people = d.people || [];
      S.seats = d.seats || [];
      S.units = d.units || [];
      S.absent = new Map(d.absent || []);
      S.zones = d.zones || [];
      S.layout = d.layout || { rows: [10, 10], aisles: [] };
      S.font = d.font || { zone: 0, unit: 0, name: 0 };
      S.namesOnly = !!d.namesOnly;
      S.showNumbers = d.showNumbers !== false;
      S.showAxis = d.showAxis !== false;
      S.meta = d.meta || { stage: '主  席  台', meeting: '', date: '', fontPreset: 'gongwen' };
      if (!S.meta.fontPreset) S.meta.fontPreset = 'gongwen';
    } else {
      /* 旧版（v28）结构迁移 */
      const rows = parsePositiveInts(d.rowSeats);
      S.layout = {
        rows: rows.length ? rows : [10, 10],
        aisles: parsePositiveInts(d.aisles)
      };
      S.people = d.people || [];
      S.seats = d.seatSlots || [];
      S.units = d.seatUnits || [];
      S.absent = new Map(d.absentSeats || []);
      S.zones = (d.zones || []).map((z) => ({ ...z, showName: z.showName !== undefined ? z.showName : true }));
      S.font = {
        zone: d.zoneNameFontOffset || 0,
        unit: d.unitFontOffset || 0,
        name: d.seatNameFontOffset || 0
      };
      S.namesOnly = !!d.namesOnly;
      S.showNumbers = true;
      S.showAxis = true;
      S.meta = { stage: '主  席  台', meeting: '', date: '', fontPreset: 'gongwen' };
      if (!S.seats.length) syncSeatArrays();
    }

    App.zoneIdSeq = S.zones.reduce((max, z) => Math.max(max, z.id || 0), 0);

    /* 与布局对齐 */
    syncSeatArrays();
    if (!S.units.length || S.units.length !== S.seats.length) {
      const units = new Array(S.seats.length).fill('');
      S.units.forEach((u, i) => { if (i < units.length) units[i] = u; });
      S.units = units;
    }
    return true;
  } catch (err) {
    return false;
  }
}

function syncInputs() {
  $('rowSeats').value = S.layout.rows.join(',');
  $('aisles').value = S.layout.aisles.join(',');
  $('people').value = S.people.join('\n');
  $('meetingName').value = S.meta.meeting || '';
  $('meetingDate').value = S.meta.date || '';
  $('stageLabel').value = S.meta.stage || '主  席  台';
  $('fontPreset').value = S.meta.fontPreset || 'gongwen';
}

/* ========== 提示 ========== */

function notify(message) {
  $('seatHint').textContent = message;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => {
    $('seatHint').textContent = '图面宽度随座位数自适应，窄屏可横向滚动';
  }, 3200);
}

/* ========== 业务动作 ========== */

function withHistory(mutator) {
  pushHistory();
  const changed = mutator();
  if (changed === false) {
    App.history.pop();
    return false;
  }
  render();
  scheduleSave();
  return true;
}

function applyRoster() {
  pushHistory();
  resetSeating($('people').value, { clearZones: false });
  render();
  scheduleSave();
  notify(`已按名单排座 · ${S.people.length} 人`);
}

function commitLayout() {
  const rows = parsePositiveInts($('rowSeats').value);
  if (!rows.length) {
    notify('每排座位数格式不对，示例：10,10');
    $('rowSeats').value = S.layout.rows.join(',');
    return;
  }
  const aisles = parsePositiveInts($('aisles').value);
  const sameRows = rows.join(',') === S.layout.rows.join(',');
  const sameAisles = aisles.join(',') === S.layout.aisles.join(',');
  if (sameRows && sameAisles) return;

  pushHistory();
  S.layout.rows = rows;
  S.layout.aisles = aisles;
  render();
  scheduleSave();
}

/* --- 座位编辑 --- */

function editSeatName(idx) {
  const anchor = document.querySelector(`.seat[data-seat="${idx}"]`);
  if (!anchor) return;
  const person = S.seats[idx];
  if (person == null) {
    openEditor(anchor, {
      value: '',
      maxLen: 20,
      placeholder: '姓名',
      onSave: (value) => {
        if (!value.trim()) return;
        withHistory(() => fillSeat(idx, value));
      }
    });
    return;
  }
  openEditor(anchor, {
    value: S.people[person] || '',
    maxLen: 20,
    placeholder: '姓名',
    onSave: (value) => {
      const ok = withHistory(() => renamePerson(person, value));
      if (!ok) return;
    }
  });
}

function editUnit(idx) {
  const anchor = document.querySelector(`.seat[data-seat="${idx}"]`) || document.querySelector(`[data-seat="${idx}"]`);
  if (!anchor) return;
  openEditor(anchor, {
    multiline: true,
    value: S.units[idx] || '',
    maxLen: 60,
    maxLines: UNIT_MAX_LINES,
    placeholder: '单位（最多 3 行）',
    onSave: (value) => {
      const normalized = joinLines(value, UNIT_MAX_LINES);
      if (normalized === (S.units[idx] || '')) return;
      withHistory(() => {
        S.units[idx] = normalized;
        return true;
      });
    }
  });
}

function editZoneName(zone) {
  const anchor = document.querySelector(`.seat[data-seat="${zone.seats[0]}"]`);
  if (!anchor) return;
  openEditor(anchor, {
    multiline: true,
    value: zone.name,
    maxLen: 40,
    maxLines: ZONE_NAME_MAX_LINES,
    placeholder: '团体名称（最多 3 行）',
    onSave: (value) => {
      const normalized = joinLines(value, ZONE_NAME_MAX_LINES);
      if (!normalized || normalized === zone.name) return;
      withHistory(() => {
        zone.name = normalized;
        return true;
      });
    }
  });
}

function insertAtGap(gapIdx) {
  const anchor = document.querySelector(`[data-gap="${gapIdx}"]`);
  if (!anchor) return;
  openEditor(anchor, {
    value: '',
    maxLen: 20,
    placeholder: '姓名',
    hint: `插入到 ${gapIdx + 1} 号前`,
    onSave: (value) => {
      if (!value.trim()) return;
      const ok = withHistory(() => insertSeatBefore(gapIdx, value));
      if (!ok) notify('座位已满，无法插入。请先在左侧增加座位。');
    }
  });
}

function toggleAbsent(idx) {
  if (S.seats[idx] == null) return;
  withHistory(() => markAbsent(idx));
}

function restoreSeat(person) {
  pushHistory();
  const result = restoreAbsent(person);
  if (!result.ok) {
    App.history.pop();
    const messages = {
      missing: '该人员不在缺席名单中。',
      range: '原座位已不存在，无法恢复。请先增加座位数。',
      full: '原座位后方已无空位，无法递补恢复。请先增加座位或标记他人缺席。'
    };
    notify(messages[result.reason] || '恢复失败。');
    return;
  }
  render();
  scheduleSave();
}

function clearSeatAt(idx) {
  const person = S.seats[idx];
  const hasUnit = (S.units[idx] || '').trim() !== '';
  if (person == null && !hasUnit) return;
  withHistory(() => clearSeat(idx));
}

/* --- 团体模式 --- */

function toggleZoneMode(force) {
  App.zoneMode = typeof force === 'boolean' ? force : !App.zoneMode;
  App.zoneSelection.clear();
  $('zoneToolbar').classList.toggle('is-open', App.zoneMode);
  $('zoneBtn').textContent = App.zoneMode ? '退出标注模式' : '标注团体区域';
  if (App.zoneMode) {
    $('zoneNameInput').value = '';
    $('zoneShowName').checked = true;
    renderColorPicker();
  }
  render();
}

function renderColorPicker() {
  const picker = $('colorPick');
  picker.replaceChildren(...PALETTE.zones.map((color) => el('button', {
    type: 'button',
    style: `background:${color}`,
    'aria-label': `选择颜色 ${color}`,
    'aria-pressed': color === App.zoneColor ? 'true' : 'false',
    dataset: { color }
  })));
}

function toggleZoneSeat(idx) {
  if (App.zoneSelection.has(idx)) App.zoneSelection.delete(idx);
  else App.zoneSelection.add(idx);
  $('zoneSelCount').textContent = String(App.zoneSelection.size);
  render();
}

function confirmZone() {
  const name = joinLines($('zoneNameInput').value, ZONE_NAME_MAX_LINES);
  if (!name) { notify('请填写团体名称。'); return; }
  if (!App.zoneSelection.size) { notify('请至少选择一个座位。'); return; }

  withHistory(() => {
    App.zoneIdSeq += 1;
    S.zones.push({
      id: App.zoneIdSeq,
      name,
      color: App.zoneColor,
      seats: Array.from(App.zoneSelection).sort((a, b) => a - b),
      showName: $('zoneShowName').checked
    });
    return true;
  });

  toggleZoneMode(false);
  notify('团体区域已创建。');
}

/* --- 导出 --- */

function csvCell(value) {
  const text = String(value == null ? '' : value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCSV() {
  const lines = ['座位号,排,姓名,单位,状态,团体'];
  for (let r = 0; r < S.layout.rows.length; r++) {
    const offset = rowStart(r);
    for (let i = 0; i < S.layout.rows[r]; i++) {
      const idx = offset + i;
      const m = seatModel(idx);
      lines.push([
        m.number,
        r + 1,
        m.hasPerson ? m.person : '',
        m.unitLines.join(' / '),
        m.hasPerson ? '就座' : '空位',
        zoneNamesAt(idx).join('、')
      ].map(csvCell).join(','));
    }
  }
  if (S.absent.size) {
    Array.from(S.absent.entries())
      .sort((a, b) => a[1] - b[1])
      .forEach(([person, seat]) => {
        lines.push([`原${seat + 1}号`, '', S.people[person], '', '缺席', ''].map(csvCell).join(','));
      });
  }
  downloadBlob('\uFEFF' + lines.join('\r\n'), '座次表.csv', 'text/csv;charset=utf-8');
}

function buildOrderText() {
  if (S.namesOnly) {
    return S.seats.filter((p) => p != null).map((p) => S.people[p]).join('\n');
  }
  const lines = [];
  for (let r = 0; r < S.layout.rows.length; r++) {
    const offset = rowStart(r);
    lines.push(`【第 ${r + 1} 排】`);
    for (let i = 0; i < S.layout.rows[r]; i++) {
      const idx = offset + i;
      const m = seatModel(idx);
      const tails = [];
      if (m.unitLines.length) tails.push(`[${m.unitLines.join(' / ')}]`);
      const zones = zoneNamesAt(idx);
      if (zones.length) tails.push(`[${zones.join('、')}]`);
      lines.push(`${m.number}号\t${m.hasPerson ? m.person : '（空）'}${tails.length ? '\t' + tails.join('\t') : ''}`);
    }
    lines.push('');
  }
  if (S.absent.size) {
    lines.push('【缺席】');
    Array.from(S.absent.entries())
      .sort((a, b) => a[1] - b[1])
      .forEach(([person, seat]) => {
        lines.push(`${S.people[person]}\t（原 ${seat + 1} 号，缺席）`);
      });
  }
  return lines.join('\n');
}

async function copyOrderText() {
  const text = buildOrderText();
  try {
    await navigator.clipboard.writeText(text);
    notify(S.namesOnly ? '已复制纯姓名列表。' : '座次表已复制。');
  } catch (err) {
    const ta = el('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    notify('已复制。');
  }
}

function writeBackToPeople() {
  const names = S.seats.filter((p) => p != null).map((p) => S.people[p]);
  $('people').value = names.join('\n');
  notify(S.absent.size
    ? `已写回 ${names.length} 人；${S.absent.size} 位缺席者未包含，请手动加回。`
    : `已写回 ${names.length} 人。`);
}

/* ========== 事件绑定 ========== */

function bindEvents() {
  /* --- 左侧编制 --- */
  $('applyBtn').addEventListener('click', applyRoster);
  $('rowSeats').addEventListener('change', commitLayout);
  $('aisles').addEventListener('change', commitLayout);

  $('meetingName').addEventListener('input', (e) => {
    S.meta.meeting = e.target.value.trim();
    renderStatus();
    scheduleSave();
  });
  $('meetingDate').addEventListener('input', (e) => {
    S.meta.date = e.target.value.trim();
    renderStatus();
    scheduleSave();
  });
  $('stageLabel').addEventListener('input', (e) => {
    S.meta.stage = e.target.value;
    updateStageText();
    scheduleSave();
  });

  $('fontPreset').addEventListener('change', (e) => {
    S.meta.fontPreset = e.target.value;
    applyTheme();
    render();
    scheduleSave();
    notify(`字体已切换：${FONT_PRESETS[e.target.value].label}`);
  });

  $('saveBtn').addEventListener('click', () => saveState(true));

  $('resetBtn').addEventListener('click', () => {
    if (!confirm('将清空当前席位、团体与缺席记录，恢复到初始示例。确定继续？')) return;
    pushHistory();
    S.layout = { rows: [10, 10], aisles: [] };
    S.zones = [];
    S.absent = new Map();
    S.font = { zone: 0, unit: 0, name: 0 };
    S.namesOnly = false;
    S.showNumbers = true;
    S.showAxis = true;
    S.meta = { stage: '主  席  台', meeting: '', date: '', fontPreset: 'gongwen' };
    resetSeating('张三\n李四\n王五\n赵六\n钱七\n孙八', { clearZones: true });
    syncInputs();
    render();
    scheduleSave();
  });

  /* --- 工具条 --- */
  $('compactBtn').addEventListener('click', () => withHistory(compactSeats));
  $('undoBtn').addEventListener('click', () => {
    if (undo()) {
      syncInputs();
      render();
      scheduleSave();
      notify('已撤销上一步。');
    }
  });
  $('zoneBtn').addEventListener('click', () => toggleZoneMode());
  $('pngBtn').addEventListener('click', exportPNG);
  $('printBtn').addEventListener('click', () => window.print());
  $('numsBtn').addEventListener('click', () => {
    /* 纯显示偏好：不进撤销链，但要存档并同时作用于屏幕 / 打印 / PNG */
    S.showNumbers = S.showNumbers === false;
    render();
    scheduleSave();
    notify(S.showNumbers ? '座号已显示。' : '座号已隐藏，导出 PNG 同步不显示。');
  });
  $('axisBtn').addEventListener('click', () => {
    S.showAxis = S.showAxis === false;
    render();
    scheduleSave();
    notify(S.showAxis ? '中轴线已显示。' : '中轴线已隐藏，导出 PNG 同步不显示。');
  });

  /* --- 字号 --- */
  document.querySelectorAll('[data-font-step]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = btn.closest('[data-font-group]').dataset.fontGroup;
      const step = Number(btn.dataset.fontStep);
      S.font[group] = clamp(S.font[group] + step, FONT_OFFSET_MIN, FONT_OFFSET_MAX);
      render();
      scheduleSave();
    });
  });
  $('fontResetBtn').addEventListener('click', () => {
    S.font = { zone: 0, unit: 0, name: 0 };
    render();
    scheduleSave();
  });

  /* --- 团体工具条 --- */
  $('colorPick').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-color]');
    if (!btn) return;
    App.zoneColor = btn.dataset.color;
    renderColorPicker();
  });
  $('zoneConfirmBtn').addEventListener('click', confirmZone);
  $('zoneCancelBtn').addEventListener('click', () => toggleZoneMode(false));

  /* --- 团体列表 --- */
  $('zoneList').addEventListener('click', (e) => {
    const del = e.target.closest('[data-zone-delete]');
    if (!del) return;
    const id = Number(del.dataset.zoneDelete);
    withHistory(() => {
      S.zones = S.zones.filter((z) => z.id !== id);
      return true;
    });
  });
  $('zoneList').addEventListener('change', (e) => {
    const toggle = e.target.closest('[data-zone-toggle]');
    if (!toggle) return;
    const id = Number(toggle.dataset.zoneToggle);
    const zone = S.zones.find((z) => z.id === id);
    if (!zone) return;
    withHistory(() => {
      zone.showName = toggle.checked;
      return true;
    });
  });

  /* --- 座次表 --- */
  $('csvBtn').addEventListener('click', exportCSV);
  $('copyBtn').addEventListener('click', copyOrderText);
  $('txtBtn').addEventListener('click', () => {
    downloadBlob(buildOrderText(), S.namesOnly ? '座次-姓名.txt' : '座次表.txt', 'text/plain;charset=utf-8');
  });
  $('namesOnlyBtn').addEventListener('click', () => {
    S.namesOnly = !S.namesOnly;
    renderOrderTable();
    scheduleSave();
  });
  $('toPeopleBtn').addEventListener('click', writeBackToPeople);

  bindSeatMapEvents();

  /* --- 缺席标签 --- */
  $('absentPanel').addEventListener('click', (e) => {
    const tag = e.target.closest('[data-absent]');
    if (tag) restoreSeat(Number(tag.dataset.absent));
  });

  /* --- 座次表行内动作 --- */
  $('orderBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (btn && btn.dataset.seat != null) {
      const idx = Number(btn.dataset.seat);
      if (btn.dataset.action === 'unit') editUnit(idx);
      else if (btn.dataset.action === 'rename' || btn.dataset.action === 'fill') editSeatName(idx);
      return;
    }
    const absentBtn = e.target.closest('[data-absent]');
    if (absentBtn) restoreSeat(Number(absentBtn.dataset.absent));
  });

  window.addEventListener('resize', layoutAxis);
  window.addEventListener('beforeunload', () => { if (dirty) saveState(false); });
}

/* --- 席位图：点击 / 键盘 / 拖拽 --- */

function bindSeatMapEvents() {
  const rowsEl = $('rows');
  let suppressClick = false;
  let drag = null;

  rowsEl.addEventListener('click', (e) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }

    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      const seatEl = actionBtn.closest('.seat[data-seat]');
      if (!seatEl) return;
      const idx = Number(seatEl.dataset.seat);
      e.stopPropagation();
      const action = actionBtn.dataset.action;
      if (action === 'clear') clearSeatAt(idx);
      else if (action === 'unit') editUnit(idx);
      else if (action === 'fill') fillSeatInline(idx);
      else if (action === 'rename') editSeatName(idx);
      else if (action === 'zone-edit') {
        const zone = zoneAt(idx);
        if (zone) editZoneName(zone);
      }
      return;
    }

    const gapEl = e.target.closest('[data-gap]');
    if (gapEl && !App.zoneMode) {
      insertAtGap(Number(gapEl.dataset.gap));
      return;
    }

    const seatEl = e.target.closest('.seat[data-seat]');
    if (!seatEl) return;
    const idx = Number(seatEl.dataset.seat);

    if (App.zoneMode) {
      toggleZoneSeat(idx);
      return;
    }
    if (S.seats[idx] == null) fillSeatInline(idx);
    else toggleAbsent(idx);
  });

  rowsEl.addEventListener('keydown', (e) => {
    const seatEl = e.target.closest('.seat[data-seat]');
    if (!seatEl) return;
    const idx = Number(seatEl.dataset.seat);
    const seats = Array.from(rowsEl.querySelectorAll('.seat[data-seat]'));

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (App.zoneMode) toggleZoneSeat(idx);
      else if (S.seats[idx] == null) fillSeatInline(idx);
      else editSeatName(idx);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      clearSeatAt(idx);
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const pos = seats.indexOf(seatEl);
      const next = seats[clamp(pos + (e.key === 'ArrowRight' ? 1 : -1), 0, seats.length - 1)];
      if (next) next.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const rowEl = seatEl.closest('.row');
      const rowIdx = Number(rowEl.dataset.row);
      const targetRow = rowsEl.querySelector(`.row[data-row="${rowIdx + (e.key === 'ArrowDown' ? 1 : -1)}"]`);
      if (!targetRow) return;
      const peers = Array.from(targetRow.querySelectorAll('.seat[data-seat]'));
      if (!peers.length) return;
      const myPeers = Array.from(rowEl.querySelectorAll('.seat[data-seat]'));
      const ratio = myPeers.indexOf(seatEl) / Math.max(1, myPeers.length - 1);
      peers[Math.round(ratio * (peers.length - 1))].focus();
    }
  });

  /* 指针拖拽：鼠标与触摸同一套实现 */
  rowsEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const seatEl = e.target.closest('.seat[data-seat]');
    if (!seatEl || App.zoneMode) return;
    if (e.target.closest('[data-action]')) return;
    const idx = Number(seatEl.dataset.seat);
    if (S.seats[idx] == null) return;

    drag = {
      src: idx,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      srcEl: seatEl,
      targetEl: null
    };
  });

  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (!drag.active) {
      if (Math.hypot(dx, dy) < 6) return;
      drag.active = true;
      drag.srcEl.classList.add('is-dragging');
      closeEditor();
    }
    e.preventDefault();

    const under = document.elementFromPoint(e.clientX, e.clientY);
    const target = under ? under.closest('[data-seat], [data-gap]') : null;
    if (drag.targetEl && drag.targetEl !== target) drag.targetEl.classList.remove('is-drop-target');
    drag.targetEl = target && target !== drag.srcEl ? target : null;
    if (drag.targetEl) drag.targetEl.classList.add('is-drop-target');
  }, { passive: false });

  window.addEventListener('pointerup', () => {
    if (!drag) return;
    const { src, active, srcEl, targetEl } = drag;

    srcEl.classList.remove('is-dragging');
    if (targetEl) targetEl.classList.remove('is-drop-target');
    drag = null;

    if (!active) return;

    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 200);

    if (!targetEl) return;

    if (targetEl.dataset.seat != null) {
      const dst = Number(targetEl.dataset.seat);
      if (dst === src) return;
      withHistory(() => swapSeats(src, dst));
      notify(`已交换 ${src + 1} 号与 ${dst + 1} 号。`);
    } else if (targetEl.dataset.gap != null) {
      const before = Number(targetEl.dataset.gap);
      pushHistory();
      const changed = moveSeatBefore(src, before);
      if (!changed) {
        App.history.pop();
        return;
      }
      render();
      scheduleSave();
      notify(`已插入到 ${before + 1} 号前。`);
    }
  });
}

/** 空位就地填名（与座次表「填名」共用）。 */
function fillSeatInline(idx) {
  editSeatName(idx);
}

/* ========== 启动 ========== */

function boot() {
  applyTheme();

  if (!loadState()) {
    S.layout = { rows: [10, 10], aisles: [] };
    resetSeating($('people').value || '张三\n李四\n王五\n赵六\n钱七\n孙八', { clearZones: true });
  }

  syncInputs();
  bindEvents();
  render();
  App.booted = true;
}

document.addEventListener('DOMContentLoaded', boot);
