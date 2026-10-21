/**
 * view.js — 渲染层
 *
 * 职责单一：把 state 变成 DOM / Canvas，不改变 state，不解释业务规则。
 * 座位渲染只有一条代码路径（buildSeat），不再按「团体 / 有人 / 空位」分成四份复制体。
 */

'use strict';

const $ = (id) => document.getElementById(id);

/* ========== 主题注入：CSS 变量与 Canvas 同源 ========== */

let appliedFontPreset = null;

function applyTheme() {
  const presetId = S.meta.fontPreset || 'gongwen';
  if (appliedFontPreset !== presetId) {
    applyFontPreset(presetId);
    appliedFontPreset = presetId;
  }
  const root = document.documentElement.style;
  const map = {
    '--paper': PALETTE.paper,
    '--paper-raised': PALETTE.paperRaised,
    '--paper-sunken': PALETTE.paperSunken,
    '--ink': PALETTE.ink,
    '--ink-soft': PALETTE.inkSoft,
    '--muted': PALETTE.muted,
    '--rule': PALETTE.rule,
    '--rule-strong': PALETTE.ruleStrong,
    '--accent': PALETTE.accent,
    '--accent-soft': PALETTE.accentSoft,
    '--axis': PALETTE.axis,
    '--stage': PALETTE.stage,
    '--stage-ink': PALETTE.stageInk,
    '--font-display': FONTS.display,
    '--font-body': FONTS.body,
    '--font-mono': FONTS.mono,
    '--seat-w': `${GEO.seatW}px`,
    '--seat-h': `${GEO.seatH}px`,
    '--seat-gap': `${GEO.gap}px`,
    '--aisle-w': `${GEO.aisle}px`
  };
  Object.entries(map).forEach(([k, v]) => root.setProperty(k, v));
}

/* ========== 通用节点工厂 ========== */

function el(tag, props, children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'style') node.setAttribute('style', value);
      else node.setAttribute(key, value);
    }
  }
  (children || []).forEach((child) => child && node.appendChild(child));
  return node;
}

/* ========== 座位 ========== */

/**
 * 唯一的座位构造器。所有分支差异只体现为「哪些子节点被创建」，
 * 不存在四份重复的事件绑定与 innerHTML 拼接。
 */
function buildSeat(idx) {
  const m = seatModel(idx);
  const selected = App.zoneMode && App.zoneSelection.has(idx);

  const cls = ['seat'];
  if (m.zone) cls.push('seat--zone');
  if (m.isEmpty) cls.push('seat--empty');
  if (selected) cls.push('seat--selected');

  const seat = el('div', {
    class: cls.join(' '),
    dataset: { seat: String(idx) },
    role: 'button',
    tabindex: '0'
  });

  if (m.zone) {
    seat.style.setProperty('--zone-color', m.zone.color);
    seat.style.setProperty('--zone-edge', darken(m.zone.color, 0.18));
    seat.style.setProperty('--zone-ink', m.ink);
  }

  if (m.showNumber) seat.appendChild(el('span', { class: 'num', text: `${m.number}` }));

  /* --- 团名块 --- */
  if (m.zone) {
    const block = el('div', {
      class: 'zone-name',
      style: `font-size:${m.zoneSize}px;color:${m.ink}`
    });
    m.zoneLines.forEach((line) => block.appendChild(el('span', { text: line })));
    seat.appendChild(block);
  }

  /* --- 单位块：排在姓名之上（单位通常比姓名长，放上面不挤名字） --- */
  if (m.unitLines.length) {
    const unit = el('div', {
      class: 'unit',
      style: `font-size:${m.unitSize}px`,
      dataset: { action: 'unit' },
      title: m.unitText.replace(/\n/g, ' / ')
    });
    m.unitLines.forEach((line) => unit.appendChild(el('span', { text: line })));
    seat.appendChild(unit);
  }

  /* --- 姓名行 --- */
  if (m.zone) {
    if (m.showNameRow) {
      if (m.hasPerson) {
        seat.appendChild(el('div', {
          class: 'name',
          text: m.person,
          style: `font-size:${m.nameSize}px;color:${m.ink}`
        }));
      } else {
        seat.appendChild(el('div', {
          class: 'name name--fill',
          text: '（空）+',
          style: `font-size:${m.nameSize}px;color:${m.ink}`,
          dataset: { action: 'fill' }
        }));
      }
    }
  } else if (m.hasPerson) {
    seat.appendChild(el('div', {
      class: 'name',
      text: m.person,
      style: `font-size:${m.nameSize}px`
    }));
  } else {
    seat.appendChild(el('div', { class: 'fill-hint', text: '+ 填名' }));
  }

  /* --- 单位占位：无单位时用绝对定位贴在底部，不占流内空间 --- */
  if (!m.unitLines.length && !(m.zone && !m.showNameRow && m.isEmpty)) {
    seat.appendChild(el('div', {
      class: 'unit unit--empty',
      text: '+ 单位',
      dataset: { action: 'unit' }
    }));
  }

  /* --- 角标动作 --- */
  if (m.zone) {
    seat.appendChild(el('button', {
      class: 'seat-action seat-action--edit',
      type: 'button',
      text: '✎',
      title: '编辑团体名称',
      'aria-label': '编辑团体名称',
      dataset: { action: 'zone-edit' }
    }));
  } else if (m.hasPerson) {
    seat.appendChild(el('button', {
      class: 'seat-action seat-action--edit',
      type: 'button',
      text: '✎',
      title: '修改姓名（避免双击与「标记缺席」冲突）',
      'aria-label': `修改 ${m.number} 号姓名`,
      dataset: { action: 'rename' }
    }));
  }
  seat.appendChild(el('button', {
    class: 'seat-action seat-action--clear',
    type: 'button',
    text: '×',
    title: '清空此座位',
    'aria-label': `清空 ${m.number} 号座位`,
    dataset: { action: 'clear' }
  }));

  const label = m.zone
    ? `${m.number} 号，团体 ${m.zone.name.replace(/\n/g, ' ')}${m.hasPerson ? '，' + m.person : '，空位'}`
    : `${m.number} 号，${m.hasPerson ? m.person : '空位'}`;
  seat.setAttribute('aria-label', label);
  seat.title = label;

  return seat;
}

function buildRow(rowIndex) {
  const count = S.layout.rows[rowIndex];
  const offset = rowStart(rowIndex);
  const map = computeSeatMap(count);
  const row = el('div', { class: 'row', dataset: { row: String(rowIndex) } });

  row.appendChild(el('span', { class: 'row-label', text: `${String(rowIndex + 1).padStart(2, '0')} 排` }));

  const columns = new Array(count).fill(null);
  for (let i = 0; i < count; i++) columns[map[i]] = offset + i;

  for (let col = 0; col < count; col++) {
    const isAisle = S.layout.aisles.includes(col);
    /* 空隙归属「它右侧那个座位」：插入即成为该座号，后续座号顺位后移。
       中心散开的座次下，这一条必须按座号而不是按列号解释，否则标签与实际结果错位。 */
    const anchorIdx = columns[col] != null ? columns[col] : offset + count;
    row.appendChild(el('div', {
      class: isAisle ? 'aisle' : 'seat-gap',
      dataset: { gap: String(anchorIdx) },
      title: `在 ${anchorIdx + 1} 号前插入`,
      role: 'button',
      tabindex: '-1',
      'aria-label': `在 ${anchorIdx + 1} 号前插入姓名`
    }));
    if (columns[col] != null) row.appendChild(buildSeat(columns[col]));
  }

  return row;
}

function renderRows() {
  const rows = $('rows');
  const frag = document.createDocumentFragment();
  for (let r = 0; r < S.layout.rows.length; r++) frag.appendChild(buildRow(r));
  rows.replaceChildren(frag);
}

/* ========== 中轴线 / 主席台对齐 ========== */

function layoutAxis() {
  const rowsEl = $('rows');
  const stage = $('stage');
  const axis = $('axis');
  /* 开关先于几何计算：隐藏时几何仍照常算，重新显示即可直接复用 */
  if (axis) axis.style.display = S.showAxis === false ? 'none' : '';
  const firstRow = rowsEl.querySelector('.row');
  if (!firstRow || !S.layout.rows.length) return;

  const seat1 = firstRow.querySelector('.seat[data-seat]');
  const byNumber = (n) => {
    const idx = n - 1;
    return idx < S.seats.length ? firstRow.querySelector(`.seat[data-seat="${idx}"]`) : null;
  };
  const s1 = byNumber(1);
  const s2 = byNumber(2);
  if (!s1) return;

  // 用 offsetLeft/offsetWidth：不受滚动位置影响，也不依赖 .num 文本（团体座位没有 .num 之外的结构差异）
  let axisX;
  const n0 = S.layout.rows[0];
  if (n0 % 2 === 0 && s2) {
    axisX = (s2.offsetLeft + s2.offsetWidth + s1.offsetLeft) / 2;
  } else {
    axisX = s1.offsetLeft + s1.offsetWidth / 2;
  }

  const seats = Array.from(firstRow.querySelectorAll('.seat[data-seat]'));
  const first = seats[0];
  const last = seats[seats.length - 1];
  const stageLeft = first.offsetLeft;
  const stageWidth = last.offsetLeft + last.offsetWidth - stageLeft;

  stage.style.width = `${stageWidth}px`;
  stage.style.marginLeft = `${stageLeft}px`;
  stage.style.marginRight = 'auto';
  stage.style.maxWidth = 'none';

  const axisTop = stage.offsetTop + stage.offsetHeight + 10;
  const rowsBottom = rowsEl.offsetTop + rowsEl.offsetHeight;
  axis.style.left = `${axisX}px`;
  axis.style.top = `${axisTop}px`;
  axis.style.height = `${Math.max(0, rowsBottom - axisTop - 8)}px`;

}

/* ========== 周边面板 ========== */

function renderZoneStrip() {
  const strip = $('zoneStrip');
  if (!S.zones.length) {
    strip.replaceChildren();
    return;
  }
  strip.replaceChildren(...S.zones.map((z) => {
    const ink = contrastInk(z.color);
    const chip = el('span', {
      class: 'zone-chip',
      style: `--chip-color:${z.color};--chip-ink:${ink};--chip-edge:${darken(z.color, 0.18)}`
    }, [
      el('span', { text: z.name.replace(/\n/g, ' / ') }),
      el('span', { class: 'range', text: zoneRangeText(z) })
    ]);
    return chip;
  }));
}

function renderTitleBlock() {
  /* 未填写的字段保留屏幕提示，但打上 data-empty，打印/出图时由 CSS 隐去。 */
  const setMeta = (id, value) => {
    const node = $(id);
    node.textContent = value || '（未填写）';
    if (value) node.removeAttribute('data-empty');
    else node.setAttribute('data-empty', 'true');
  };
  setMeta('tbMeeting', S.meta.meeting);
  setMeta('tbDate', S.meta.date);
  $('tbLayout').textContent = S.layout.rows.join(' + ');
}

function renderAbsent() {
  const panel = $('absentPanel');
  if (!S.absent.size) {
    panel.replaceChildren(el('span', { class: 'empty-hint', text: '暂无缺席人员' }));
    return;
  }
  const items = Array.from(S.absent.entries())
    .map(([person, seat]) => ({ person, seat }))
    .sort((a, b) => a.seat - b.seat);

  const list = el('div', { class: 'absent-list' });
  items.forEach(({ person, seat }) => {
    const tag = el('button', {
      class: 'absent-tag',
      type: 'button',
      title: '点击恢复，插回原座位，后面依次后移',
      dataset: { absent: String(person) }
    }, [
      el('span', { text: S.people[person] }),
      el('span', { class: 'seat-ref', text: `原 ${seat + 1} 号` })
    ]);
    list.appendChild(tag);
  });

  panel.replaceChildren(el('div', { class: 'label', text: '缺席 · 点击恢复' }), list);
}

function renderZoneList() {
  const wrap = $('zoneList');
  if (!S.zones.length) {
    wrap.replaceChildren(el('span', {
      class: 'empty-hint',
      text: '暂无团体区域。点「标注团体区域」后点击座位加入选区，选色、填名称，点「完成」。'
    }));
    return;
  }

  wrap.replaceChildren(...S.zones.map((z) => {
    const row = el('div', { class: 'zone-row' });
    row.style.setProperty('--zone-color', z.color);
    row.appendChild(el('span', { class: 'dot' }));
    row.appendChild(el('span', { class: 'range', text: zoneRangeText(z) }));
    row.appendChild(el('span', { class: 'zname', text: z.name }));
    row.appendChild(el('span', { class: 'spacer' }));

    const toggle = el('label', { class: 'check' }, [
      el('input', {
        type: 'checkbox',
        checked: z.showName ? 'checked' : null,
        dataset: { zoneToggle: String(z.id) }
      }),
      el('span', { text: '显示座位内姓名' })
    ]);
    row.appendChild(toggle);

    row.appendChild(el('button', {
      class: 'btn btn--ghost',
      type: 'button',
      text: '删除',
      dataset: { zoneDelete: String(z.id) }
    }));

    return row;
  }));
}

function renderOrderTable() {
  const body = $('orderBody');
  const table = $('orderTable');
  table.classList.toggle('is-names-only', S.namesOnly);
  $('namesOnlyBtn').textContent = S.namesOnly ? '显示完整内容' : '隐去其他内容';
  $('orderHint').textContent = S.namesOnly ? '仅姓名，可直接复制' : '按排次顺序';

  const frag = document.createDocumentFragment();

  for (let r = 0; r < S.layout.rows.length; r++) {
    const head = el('tr', { class: 'is-row-head' });
    head.appendChild(el('td', { colspan: '5', text: `第 ${r + 1} 排` }));
    frag.appendChild(head);

    const offset = rowStart(r);
    for (let i = 0; i < S.layout.rows[r]; i++) {
      const idx = offset + i;
      const m = seatModel(idx, { forExport: true });
      const tr = el('tr', { dataset: { seatRow: String(idx) } });

      tr.appendChild(el('td', { class: 'num', text: `${m.number} 号` }));
      tr.appendChild(el('td', {
        class: `name${m.isEmpty ? ' name--empty' : ''}`,
        text: m.hasPerson ? m.person : '（空）'
      }));

      const unitCell = el('td', {
        class: `unit-cell col-meta${m.unitLines.length ? '' : ' is-empty'}`,
        text: m.unitLines.length ? m.unitLines.join(' / ') : '+ 单位',
        dataset: { action: 'unit', seat: String(idx) }
      });
      tr.appendChild(unitCell);

      const zoneCell = el('td', { class: 'col-meta' });
      if (m.zone) {
        const ink = contrastInk(m.zone.color);
        const pill = el('span', {
          class: 'zone-pill',
          text: m.zone.name.replace(/\n/g, ' / '),
          style: `--pill-color:${m.zone.color};--pill-ink:${ink}`
        });
        zoneCell.appendChild(pill);
      }
      tr.appendChild(zoneCell);

      const actionCell = el('td', { class: 'actions col-meta' });
      actionCell.appendChild(el('button', {
        class: 'btn btn--ghost',
        type: 'button',
        text: m.hasPerson ? '改名' : '填名',
        dataset: { action: m.hasPerson ? 'rename' : 'fill', seat: String(idx) }
      }));
      tr.appendChild(actionCell);

      frag.appendChild(tr);
    }
  }

  if (S.absent.size) {
    const head = el('tr', { class: 'is-row-head' });
    head.appendChild(el('td', { colspan: '5', text: '缺席' }));
    frag.appendChild(head);

    const items = Array.from(S.absent.entries())
      .map(([person, seat]) => ({ person, seat }))
      .sort((a, b) => a.seat - b.seat);

    items.forEach(({ person, seat }) => {
      const tr = el('tr', { class: 'is-absent' });
      tr.appendChild(el('td', { class: 'num', text: `原 ${seat + 1} 号` }));
      tr.appendChild(el('td', { class: 'name', text: S.people[person] }));
      tr.appendChild(el('td', { class: 'col-meta' }));
      tr.appendChild(el('td', { class: 'col-meta' }));
      const cell = el('td', { class: 'actions col-meta' });
      cell.appendChild(el('button', {
        class: 'btn btn--ghost',
        type: 'button',
        text: '恢复',
        dataset: { absent: String(person) }
      }));
      tr.appendChild(cell);
      frag.appendChild(tr);
    });
  }

  body.replaceChildren(frag);
}

/* ========== 主渲染 ========== */

function render() {
  applyTheme();
  syncSeatArrays();
  renderRows();
  renderZoneStrip();
  renderAbsent();
  renderZoneList();
  renderOrderTable();
  renderTitleBlock();
  renderFontBar();
  renderViewToggles();
  renderUndo();
  layoutAxis();
  updateStageText();
}

/** 显示类开关（座号 / 中轴线）的按钮文案与无障碍状态。 */
function renderViewToggles() {
  const toggle = (id, on, onText, offText) => {
    const btn = $(id);
    if (!btn) return;
    btn.textContent = on ? onText : offText;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  toggle('numsBtn', S.showNumbers !== false, '隐藏座号', '显示座号');
  toggle('axisBtn', S.showAxis !== false, '隐藏中轴线', '显示中轴线');
}

function renderFontBar() {
  ['zone', 'unit', 'name'].forEach((key) => {
    const node = document.querySelector(`[data-font-value="${key}"]`);
    if (node) node.textContent = S.font[key] > 0 ? `+${S.font[key]}` : String(S.font[key]);
  });
  document.querySelectorAll('[data-font-group]').forEach((group) => {
    const key = group.dataset.fontGroup;
    const minus = group.querySelector('[data-font-step="-1"]');
    const plus = group.querySelector('[data-font-step="1"]');
    if (minus) minus.disabled = S.font[key] <= FONT_OFFSET_MIN;
    if (plus) plus.disabled = S.font[key] >= FONT_OFFSET_MAX;
  });
}

function renderUndo() {
  const btn = $('undoBtn');
  const n = App.history.length;
  btn.disabled = n === 0;
  btn.textContent = n ? `撤销（${n}）` : '撤销';
  $('compactBtn').disabled = stats().empty === 0;
}

function updateStageText() {
  const stage = $('stage');
  const text = S.meta.stage || '主  席  台';
  if (stage.textContent !== text) stage.textContent = text;
}

/* ========== 行内编辑器 ========== */

let editorNode = null;
let editorCommit = null;

function closeEditor() {
  if (!editorNode) return;
  const node = editorNode;
  editorNode = null;
  node.remove();
  document.removeEventListener('pointerdown', onEditorOutside, true);
}

function onEditorOutside(ev) {
  if (!editorNode) return;
  if (editorNode.contains(ev.target)) return;
  if (typeof editorCommit === 'function') editorCommit();
  else closeEditor();
}

/**
 * 打开行内编辑器（浮层）。
 * @param {HTMLElement} anchor 定位锚点
 * @param {{multiline?:boolean, value?:string, maxLen?:number, maxLines?:number, placeholder?:string, hint?:string, onSave:(v:string)=>void}} opt
 */
function openEditor(anchor, opt) {
  closeEditor();
  const rect = anchor.getBoundingClientRect();
  const multiline = !!opt.multiline;

  const input = multiline
    ? el('textarea', { placeholder: opt.placeholder || '', maxlength: String(opt.maxLen || 60) })
    : el('input', { type: 'text', placeholder: opt.placeholder || '', maxlength: String(opt.maxLen || 20) });
  input.value = opt.value || '';

  const hint = el('div', {
    class: 'editor-hint',
    text: opt.hint || (multiline ? 'Enter 换行 · Ctrl+Enter 保存' : 'Enter 保存 · Esc 取消')
  });

  const saveBtn = el('button', { class: 'btn btn--primary', type: 'button', text: '保存' });
  const cancelBtn = el('button', { class: 'btn btn--ghost', type: 'button', text: '取消' });
  const actions = el('div', { class: 'editor-actions' }, [saveBtn, cancelBtn]);

  const box = el('div', { class: 'editor' }, [input, hint, actions]);

  const width = Math.max(rect.width, multiline ? 190 : 132);
  const left = clamp(rect.left, 8, window.innerWidth - width - 8);
  let top = rect.bottom + 6;
  const estimatedH = multiline ? 150 : 100;
  if (top + estimatedH > window.innerHeight - 8) top = Math.max(8, rect.top - estimatedH);

  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  box.style.width = `${width}px`;

  $('editorLayer').appendChild(box);
  editorNode = box;

  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const value = input.value;
    editorCommit = null;
    closeEditor();
    if (save) opt.onSave(value);
  };
  editorCommit = () => finish(true);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
      return;
    }
    if (e.key !== 'Enter') return;
    if (multiline && !(e.ctrlKey || e.metaKey)) {
      // 多行：Enter 换行，达到上限时改为保存
      if (input.value.split('\n').length >= (opt.maxLines || UNIT_MAX_LINES)) {
        e.preventDefault();
        finish(true);
      }
      return;
    }
    e.preventDefault();
    finish(true);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => finish(true), 80);
  });

  [saveBtn, cancelBtn].forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
  saveBtn.addEventListener('click', () => finish(true));
  cancelBtn.addEventListener('click', () => finish(false));

  document.addEventListener('pointerdown', onEditorOutside, true);

  input.focus();
  input.select();

  return { close: () => finish(false), isOpen: () => !!editorNode };
}

/* ========== PNG 导出 ========== */

function measureText(ctx, text, size, weight, family) {
  ctx.font = `${weight} ${size}px ${family}`;
  return ctx.measureText(text).width;
}

function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 把长文本按宽度折行，用于团名兜底（正常情况下 normalizeLines 已限定 3 行）。 */
function wrapByWidth(ctx, text, maxW, size, weight, family) {
  const lines = [];
  let current = '';
  for (const ch of text) {
    const test = current + ch;
    if (measureText(ctx, test, size, weight, family) > maxW && current) {
      lines.push(current);
      current = ch;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function exportPNG() {
  const rows = S.layout.rows;
  const aisleCols = S.layout.aisles;

  const seatW = GEO.seatW;
  const seatH = GEO.seatH;
  const margin = 44;
  const labelW = 54;

  const rowWidths = rows.map((n) => rowGeometry(n, aisleCols));
  const maxRowWidth = Math.max(...rowWidths.map((g) => g.width), seatW);

  /* 刊头：用实测字盒推线位，标题、副题、分隔线各自留足空隙 */
  const titleSize = 26;
  const subSize = 11;
  const titleBox = measureBox('会务席位图', titleSize, 700, FONTS.display);
  const titleTop = 34;
  const titleBase = titleTop + titleBox.ascent;
  const titleBottom = titleBase + titleBox.descent;
  const subBase = titleBottom + subSize + 12;
  const ruleY = subBase + 14;
  const headerH = ruleY + 22;

  const zoneH = S.zones.length ? 40 : 0;
  const stageH = GEO.stageH;
  const stageGap = 26;
  const rowsH = rows.length * (seatH + 14) - 14;
  const bottom = 44;

  const totalW = margin * 2 + labelW + maxRowWidth;
  const totalH = headerH + zoneH + stageH + stageGap + rowsH + bottom;

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = totalW * scale;
  canvas.height = totalH * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  /* 纸面 */
  ctx.fillStyle = PALETTE.paper;
  ctx.fillRect(0, 0, totalW, totalH);
  ctx.strokeStyle = PALETTE.rule;
  ctx.lineWidth = 1;
  ctx.strokeRect(20.5, 20.5, totalW - 41, totalH - 41);

  /* 刊头 */
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = PALETTE.ink;
  ctx.font = `700 ${titleSize}px ${FONTS.display}`;
  ctx.fillText('会务席位图', margin, titleBase);
  ctx.font = `400 ${subSize}px ${FONTS.mono}`;
  ctx.fillStyle = PALETTE.muted;
  ctx.fillText('SEATING PLAN', margin, subBase);

  ctx.textAlign = 'right';
  ctx.fillStyle = PALETTE.inkSoft;
  ctx.font = `400 13px ${FONTS.display}`;
  /* 未填会议名称不画占位文字：印面只留已填内容。 */
  if (S.meta.meeting) ctx.fillText(S.meta.meeting, totalW - margin, titleBase);
  ctx.font = `400 ${subSize}px ${FONTS.mono}`;
  ctx.fillStyle = PALETTE.muted;
  ctx.fillText(S.meta.date || '', totalW - margin, subBase);

  ctx.beginPath();
  ctx.moveTo(margin, ruleY);
  ctx.lineTo(totalW - margin, ruleY);
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 2;
  ctx.stroke();

  /* 团体图例 */
  let zoneY = headerH;
  if (S.zones.length) {
    let lx = margin;
    ctx.textAlign = 'left';
    ctx.font = `600 11px ${FONTS.body}`;
    S.zones.forEach((z) => {
      const label = `${z.name.replace(/\n/g, ' / ')}  ${zoneRangeText(z)}`;
      const tw = ctx.measureText(label).width;
      const pillW = tw + 20;
      if (lx + pillW > totalW - margin) return;
      ctx.fillStyle = z.color;
      drawRoundRect(ctx, lx, zoneY + 8, pillW, 24, 2);
      ctx.fill();
      ctx.fillStyle = contrastInk(z.color);
      ctx.fillText(label, lx + 10, zoneY + 24);
      lx += pillW + 8;
    });
    zoneY += zoneH;
  }

  /* 主席台：与首排座位跨度对齐 */
  const geom0 = rowWidths[0];
  const firstRowWidth = geom0 ? geom0.seatSpan : seatW;
  const contentLeft = margin + labelW;
  const firstRowStart = contentLeft + (maxRowWidth - (geom0 ? geom0.width : seatW)) / 2;
  const stageX = firstRowStart + (geom0 ? geom0.seatX(0) : 0);
  const stageY = headerH + zoneH;
  ctx.fillStyle = PALETTE.stage;
  drawRoundRect(ctx, stageX, stageY, firstRowWidth, stageH, 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.stageInk;
  ctx.font = `700 17px ${FONTS.display}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(S.meta.stage || '主  席  台', stageX + firstRowWidth / 2, stageY + stageH / 2);

  /* 座位 */
  const rowsTop = stageY + stageH + stageGap;
  let globalOffset = 0;

  rows.forEach((n, r) => {
    const map = computeSeatMap(n);
    const columns = new Array(n).fill(null);
    for (let i = 0; i < n; i++) columns[map[i]] = globalOffset + i;

    const rowWidth = rowWidths[r].width;
    const startX = contentLeft + (maxRowWidth - rowWidth) / 2;
    const y = rowsTop + r * (seatH + 14);

    if (r === 0) {
      ctx.fillStyle = PALETTE.muted;
      ctx.font = `400 10px ${FONTS.mono}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
    }
    ctx.fillStyle = PALETTE.muted;
    ctx.font = `400 10px ${FONTS.mono}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`第 ${r + 1} 排`, contentLeft - 12, y + seatH / 2);

    for (let col = 0; col < n; col++) {
      const idx = columns[col];
      if (idx == null) continue;
      const x = startX + rowWidths[r].seatX(col);

      const m = seatModel(idx, { forExport: true });
      const bg = m.zone ? m.zone.color : PALETTE.paperRaised;
      const edge = m.zone ? darken(m.zone.color, 0.18) : (m.isEmpty ? PALETTE.ruleStrong : PALETTE.ruleStrong);
      const ink = m.zone ? m.ink : PALETTE.ink;

      ctx.fillStyle = bg;
      drawRoundRect(ctx, x, y, seatW, seatH, GEO.radius);
      ctx.fill();
      ctx.strokeStyle = edge;
      ctx.lineWidth = 1;
      if (m.isEmpty && !m.zone) ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      /* 座号 */
      if (m.showNumber) {
        ctx.fillStyle = m.zone ? ink : PALETTE.muted;
        ctx.globalAlpha = m.zone ? 0.6 : 1;
        ctx.font = `400 9px ${FONTS.mono}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(String(m.number), x + 5, y + 5);
        ctx.globalAlpha = 1;
      }

      /* 无论是否画座号，正文一律回到居中基线 */
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (m.zone) {
        /* 底部：姓名 + 单位（空位不画「（空）」，只留团色块） */
        let cursorY = y + seatH - 6;
        if (m.showNameRow) {
          if (m.hasPerson) {
            ctx.font = `600 ${m.nameSize}px ${FONTS.body}`;
            ctx.fillStyle = ink;
            ctx.fillText(m.person, x + seatW / 2, cursorY - m.nameSize / 2, seatW - 10);
          }
          cursorY -= m.nameSize + 2;
        }
        if (m.unitLines.length) {
          const lineH = m.unitSize * 1.1;
          ctx.font = `400 ${m.unitSize}px ${FONTS.body}`;
          ctx.fillStyle = ink;
          m.unitLines.forEach((line, li) => {
            const ly = cursorY - (m.unitLines.length - li - 1) * lineH - lineH / 2;
            ctx.fillText(line, x + seatW / 2, ly, seatW - 10);
          });
          cursorY -= m.unitLines.length * lineH + 2;
        }

        /* 团名：剩余空间居中 */
        const areaTop = y + 8;
        const areaH = Math.max(18, cursorY - areaTop);
        const blockH = m.zoneLines.length * m.zoneSize * TYPE.lh;
        ctx.fillStyle = ink;
        ctx.font = `700 ${m.zoneSize}px ${FONTS.display}`;
        m.zoneLines.forEach((line, li) => {
          const ly = areaTop + (areaH - blockH) / 2 + li * m.zoneSize * TYPE.lh + m.zoneSize * TYPE.lh / 2;
          ctx.fillText(line, x + seatW / 2, ly, seatW - 10);
        });
      } else {
        /* 单位在上、姓名在下，与座位 DOM 顺序一致（单位常比姓名长，放上面不挤名字）。
           空位不画「空位」二字：座位框与座号已足以表达，印面只留已填内容。 */
        const lineH = m.unitSize * 1.1;
        const unitH = m.unitLines.length ? m.unitLines.length * lineH : 0;
        const nameH = m.hasPerson ? m.nameSize : 0;
        const gapH = unitH && nameH ? 2 : 0;
        const blockTop = y + (seatH - (unitH + gapH + nameH)) / 2;

        if (unitH) {
          ctx.fillStyle = PALETTE.muted;
          ctx.font = `400 ${m.unitSize}px ${FONTS.body}`;
          m.unitLines.forEach((line, li) => {
            ctx.fillText(line, x + seatW / 2, blockTop + li * lineH + lineH / 2, seatW - 10);
          });
        }

        if (m.hasPerson) {
          ctx.fillStyle = PALETTE.ink;
          ctx.font = `600 ${m.nameSize}px ${FONTS.body}`;
          ctx.fillText(m.person, x + seatW / 2, blockTop + unitH + gapH + nameH / 2, seatW - 10);
        }
      }
    }

    globalOffset += n;
  });

  /* 中轴线 */
  const n0 = rows[0];
  if (n0 && S.showAxis !== false) {
    const map = computeSeatMap(n0);
    const col1 = map[0];
    const col2 = n0 > 1 ? map[1] : null;
    const colX = (col) => firstRowStart + geom0.seatX(col);
    const axisX = n0 % 2 === 0 && col2 != null
      ? (colX(col2) + seatW + colX(col1)) / 2
      : colX(col1) + seatW / 2;

    ctx.strokeStyle = PALETTE.axis;
    ctx.globalAlpha = 0.7;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisX, stageY + stageH + 6);
    ctx.lineTo(axisX, rowsTop + rowsH + 6);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: '座位图.png' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}
