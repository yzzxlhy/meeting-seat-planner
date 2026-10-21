/**
 * state.js — 数据模型、纯函数、文本排版引擎
 *
 * 设计原则：
 * 1. 本文件不含任何 DOM 查询与事件绑定，全部是纯函数 / 状态容器。
 * 2. 座位内容排版只在这里实现一次，DOM 与 Canvas 导出共用同一份结果（seatModel），
 *    彻底消除「屏幕和 PNG 不一致」这一类漂移 bug。
 * 3. 所有可变量通过常量集中定义，禁止魔法值。
 */

'use strict';

/* ========== 常量 ========== */

/** 席位图几何（px）。CSS 变量由 applyTheme() 同步注入，保证 CSS / Canvas 同源。 */
const GEO = Object.freeze({
  seatW: 78,
  seatH: 90,
  gap: 8,
  aisle: 26,
  radius: 2,
  padTop: 7,
  padBottom: 5,
  rowH: 90,
  stageH: 46,
  rowLabelW: 54,
  margin: 32
});

/** 字号基准与上限，偏移量在此之上叠加。 */
const TYPE = Object.freeze({
  nameBase: 12,
  nameBaseZone: 10,
  nameMin: 8,
  nameMax: 20,
  unitMax: 10,
  unitMin: 6,
  unitClampMin: 4,
  unitClampMax: 16,
  zoneMax: 20,
  zoneMin: 6,
  zoneClampMin: 5,
  zoneClampMax: 32,
  lh: 1.15
});

const FONT_OFFSET_MIN = -4;
const FONT_OFFSET_MAX = 4;
const UNIT_MAX_LINES = 3;
const ZONE_NAME_MAX_LINES = 3;
const HISTORY_LIMIT = 50;

/* ========== 场景 ========== */

/** 场景 id。theater 为默认，其余为绝对坐标场景。 */
const SCENE_IDS = Object.freeze(['theater', 'longTable', 'round', 'photo']);

const SCENE_LABELS = Object.freeze({
  theater: '剧院式',
  longTable: '长桌',
  round: '圆桌',
  photo: '合影'
});

/** 各场景的默认参数。深拷贝后再放进 state，避免共享引用。 */
function defaultLayouts() {
  return {
    theater: { rows: [10, 10], aisles: [] },
    longTable: { top: 0, bottom: 8, left: 6, right: 6 },
    round: { tables: 2, perTable: 10 },
    photo: { rows: 3, perRow: [6, 7, 7] }
  };
}
const STORAGE_KEY = 'meeting-seat-v30';
const LEGACY_STORAGE_KEYS = ['seating-tool-state-v28'];

/**
 * 纸墨调色板。单一来源：既注入 CSS 变量，也供 Canvas 导出使用。
 * 颜色均为低饱和，确保在纸白底上过对比度（正文 ≥ 4.5:1）。
 */
const PALETTE = Object.freeze({
  paper: '#F4F1EA',
  paperRaised: '#FBF9F4',
  paperSunken: '#EDE8DD',
  ink: '#1A1814',
  inkSoft: '#4B463C',
  muted: '#6E6658',
  rule: '#D9D2C2',
  ruleStrong: '#948A74',
  accent: '#9C3B2E',
  accentSoft: '#F0E2DC',
  axis: '#B4642A',
  stage: '#22201B',
  stageInk: '#F4F1EA',
  zones: ['#9C3B2E', '#8F6118', '#3F6B4F', '#2F5D7C', '#6B4A7A', '#A6553F', '#4A6B5D', '#8C5A2B']
});

const FONTS = {
  display: '"Songti SC","SimSun","Noto Serif SC","Source Han Serif SC",serif',
  body: '"HarmonyOS Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif',
  mono: 'ui-monospace,"Cascadia Mono","Consolas",monospace'
};

/** 可选字体搭配。均为系统自带字族，不联网加载字体。 */
const FONT_PRESETS = Object.freeze({
  gongwen: {
    label: '公文 · 宋体标题 / 雅黑正文',
    display: '"Songti SC","SimSun","Noto Serif SC",serif',
    body: '"Microsoft YaHei","PingFang SC","HarmonyOS Sans SC",system-ui,sans-serif'
  },
  song: {
    label: '全宋 · 文书样式',
    display: '"Songti SC","SimSun","Noto Serif SC",serif',
    body: '"Songti SC","SimSun","Noto Serif SC",serif'
  },
  hei: {
    label: '黑体 · 现代会议',
    display: '"Microsoft YaHei","PingFang SC","HarmonyOS Sans SC",sans-serif',
    body: '"Microsoft YaHei","PingFang SC","HarmonyOS Sans SC",sans-serif'
  },
  kai: {
    label: '楷体 · 题签风格',
    display: '"KaiTi","STKaiti","Kaiti SC",serif',
    body: '"Songti SC","SimSun",serif'
  }
});

/** 应用字体搭配（由 applyTheme 调用，CSS 变量与 Canvas 同步）。 */
function applyFontPreset(id) {
  const preset = FONT_PRESETS[id] || FONT_PRESETS.gongwen;
  FONTS.display = preset.display;
  FONTS.body = preset.body;
  return preset;
}

/* ========== 工具函数 ========== */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** 按 UTF-8 字节长度做规范化换行，保留最多 maxLines 行，剔除空行。 */
function normalizeLines(text, maxLines) {
  return String(text == null ? '' : text)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .slice(0, maxLines);
}

/** 归一化后的多行文本（写回状态用）。 */
function joinLines(text, maxLines) {
  return normalizeLines(text, maxLines).join('\n');
}

/** 相对亮度（WCAG 2.1：先线性化 sRGB）。 */
function relativeLuminance(hex) {
  const h = String(hex).replace('#', '');
  const channel = (i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** 对比度（1~21）。 */
function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 色块上的墨色：取白与黑中对比度更高者，而不是拍脑袋的亮度阈值。 */
function contrastInk(hex) {
  return contrastRatio('#FFFFFF', hex) >= contrastRatio(PALETTE.ink, hex) ? '#FFFFFF' : PALETTE.ink;
}

/** 把十六进制色加深一档，用于团体座位描边。 */
function darken(hex, amount) {
  const h = String(hex).replace('#', '');
  const ch = [0, 2, 4].map((i) => {
    const v = Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - amount));
    return clamp(v, 0, 255).toString(16).padStart(2, '0');
  });
  return `#${ch.join('')}`;
}

/* ========== 文本排版引擎（DOM / Canvas 共用） ========== */

const _measureCtx = document.createElement('canvas').getContext('2d');

/** 实测文本宽度（px）。DOM 与 Canvas 使用同一字体串，结果一致。 */
function measureWidth(text, size, weight, family) {
  _measureCtx.font = `${weight} ${size}px ${family}`;
  return _measureCtx.measureText(text).width;
}

/** 实测文字盒（供 PNG 头部排版用，避免文字与下划线相撞）。 */
function measureBox(text, size, weight, family) {
  _measureCtx.font = `${weight} ${size}px ${family}`;
  const m = _measureCtx.measureText(text);
  return {
    width: m.width,
    ascent: m.actualBoundingBoxAscent || size * 0.8,
    descent: m.actualBoundingBoxDescent || size * 0.2
  };
}

/**
 * 在给定盒子里找到能容纳所有行的最大字号。
 * @param {string[]} lines 已归一化的行
 * @param {number} maxW 可用宽度（px）
 * @param {number} maxH 可用高度（px）
 * @param {{weight:number|string, family:string, max:number, min:number, lh:number, offset:number, clampMin:number, clampMax:number}} opt
 * @returns {number} 最终字号
 */
function fitFontSize(lines, maxW, maxH, opt) {
  const { weight, family, max, min, lh, offset = 0, clampMin, clampMax } = opt;
  if (!lines.length) return min;
  let size = max;
  for (; size > min; size--) {
    const widthOk = lines.every((line) => measureWidth(line, size, weight, family) <= maxW);
    const heightOk = lines.length * size * lh <= maxH;
    if (widthOk && heightOk) break;
  }
  return clamp(size + offset, clampMin != null ? clampMin : min, clampMax != null ? clampMax : max);
}

/* ========== 排座规则 ========== */

/**
 * 座次映射：第 i 个人（0 基）落在第几列（0 基）。
 * 奇数座位：1 号居中，2 号在左，3 号在右……
 * 偶数座位：中轴在 1、2 号之间，1 号在中轴右侧，2 号在 1 号左侧……
 */
function computeSeatMap(n) {
  const map = new Array(n);
  if (n <= 0) return map;
  if (n % 2 === 1) {
    const center = Math.floor(n / 2);
    map[0] = center;
    let left = center - 1;
    let right = center + 1;
    for (let i = 1; i < n; i++) {
      map[i] = i % 2 === 1 ? left-- : right++;
    }
  } else {
    const cLeft = n / 2 - 1;
    const cRight = n / 2;
    map[0] = cRight;
    map[1] = cLeft;
    let right = cRight + 1;
    let left = cLeft - 1;
    for (let i = 2; i < n; i++) {
      map[i] = i % 2 === 0 ? right++ : left--;
    }
  }
  return map;
}

/** 解析 "10,10" / "5" 这类输入。 */
function parsePositiveInts(text) {
  return String(text || '')
    .split(/[,，\s]+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function parsePeople(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/* ========== 状态 ========== */

const App = {
  /** @type {{people:string[], seats:(number|null)[], units:string[], absent:Map<number,number>, zones:any[], layout:{rows:number[],aisles:number[]}, font:{zone:number,unit:number,name:number}, namesOnly:boolean, showNumbers:boolean, showAxis:boolean, meta:{stage:string,meeting:string,date:string}}} */
  state: {
    people: [],
    seats: [],
    units: [],
    absent: new Map(),
    zones: [],
    scene: 'theater',
    layout: { rows: [10, 10], aisles: [] },
    layouts: defaultLayouts(),
    font: { zone: 0, unit: 0, name: 0 },
    namesOnly: false,
    /** 座位左上角座号是否显示（影响屏幕 / 打印 / PNG 三个出口） */
    showNumbers: true,
    /** 中轴线是否显示（同样影响屏幕 / 打印 / PNG） */
    showAxis: true,
    meta: { stage: '主  席  台', meeting: '', date: '', fontPreset: 'gongwen' }
  },
  history: [],
  zoneMode: false,
  zoneSelection: new Set(),
  zoneColor: PALETTE.zones[3],
  zoneIdSeq: 0,
  booted: false
};

const S = App.state;
/* S.layout 保留为剧院式的快捷引用：旧代码与旧存档都按这个结构读写。 */
S.layout = S.layouts.theater;

/* ========== 场景辅助 ========== */

function sceneId() {
  return SCENE_IDS.includes(S.scene) ? S.scene : 'theater';
}

function sceneCfg(id) {
  return S.layouts[id || sceneId()] || {};
}

/** 场景座位总数（与座位数组长度对齐）。 */
function sceneSeatCount(id, cfg) {
  const key = id || sceneId();
  const c = cfg || sceneCfg(key);
  if (key === 'theater') return (c.rows || []).reduce((a, b) => a + b, 0);
  if (key === 'longTable') return (c.top || 0) + (c.bottom || 0) + (c.left || 0) + (c.right || 0);
  if (key === 'round') return (c.tables || 0) * (c.perTable || 0);
  if (key === 'photo') return (c.perRow || []).reduce((a, b) => a + b, 0);
  return 0;
}

/**
 * 场景分组：座次表 / CSV / 文本导出按分组列小标题。
 * 顺序必须与 scenes.js 中座位索引顺序一致。
 */
function sceneGroups() {
  const id = sceneId();
  const c = sceneCfg(id);
  const out = [];
  let start = 0;
  const push = (label, count) => {
    if (!count) return;
    out.push({ label, start, count });
    start += count;
  };

  if (id === 'theater') {
    (c.rows || []).forEach((n, i) => push(`第 ${i + 1} 排`, n));
  } else if (id === 'longTable') {
    push('下边', c.bottom);
    push('右边', c.right);
    push('上边', c.top);
    push('左边', c.left);
  } else if (id === 'round') {
    for (let i = 0; i < (c.tables || 0); i++) push(`第 ${i + 1} 桌`, c.perTable || 0);
  } else if (id === 'photo') {
    (c.perRow || []).forEach((n, i) => push(`第 ${i + 1} 排`, n));
  }
  return out;
}

/** 标题栏「席位构成」的一行描述。 */
function sceneSummary() {
  const id = sceneId();
  const c = sceneCfg(id);
  if (id === 'theater') return (c.rows || []).join(' + ');
  if (id === 'longTable') {
    return [
      ['下', c.bottom],
      ['右', c.right],
      ['上', c.top],
      ['左', c.left]
    ]
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k} ${n}`)
      .join(' · ');
  }
  if (id === 'round') return `${c.tables} 桌 × ${c.perTable} 人`;
  if (id === 'photo') return `${(c.perRow || []).length} 排（${(c.perRow || []).join(' / ')}）`;
  return '';
}

function seatCount() {
  return S.seats.length;
}

function isEmptySeat(idx) {
  return S.seats[idx] == null;
}

function personAt(idx) {
  const p = S.seats[idx];
  return p == null ? null : S.people[p];
}

function unitAt(idx) {
  return (S.units[idx] || '').trim();
}

function zoneAt(idx) {
  return S.zones.find((z) => z.seats.includes(idx)) || null;
}

/** 座次号（1 基）。 */
function seatNumber(idx) {
  return idx + 1;
}

/** 某排的首个座位下标。 */
function rowStart(rowIndex) {
  let offset = 0;
  for (let i = 0; i < rowIndex; i++) offset += S.layout.rows[i];
  return offset;
}

/* ========== 快照 / 撤销 ========== */

function snapshot() {
  return JSON.stringify({
    people: S.people,
    seats: S.seats,
    units: S.units,
    absent: Array.from(S.absent.entries()),
    zones: S.zones,
    layout: S.layout,
    scene: sceneId(),
    layouts: S.layouts,
    font: S.font,
    namesOnly: S.namesOnly,
    showNumbers: S.showNumbers,
    showAxis: S.showAxis,
    meta: S.meta
  });
}

function pushHistory() {
  App.history.push(snapshot());
  if (App.history.length > HISTORY_LIMIT) App.history.shift();
}

function restoreSnapshot(raw) {
  const d = JSON.parse(raw);
  S.people = d.people || [];
  S.seats = d.seats || [];
  S.units = d.units || [];
  S.absent = new Map(d.absent || []);
  S.zones = d.zones || [];
  S.layout = d.layout || { rows: [10, 10], aisles: [] };
  S.scene = SCENE_IDS.includes(d.scene) ? d.scene : 'theater';
  S.layouts = d.layouts || { ...defaultLayouts(), theater: S.layout };
  S.layouts.theater = S.layout;
  S.font = d.font || { zone: 0, unit: 0, name: 0 };
  S.namesOnly = !!d.namesOnly;
  /* 旧快照没有该字段：缺省视为显示座号 */
  S.showNumbers = d.showNumbers !== false;
  S.showAxis = d.showAxis !== false;
  S.meta = d.meta || { stage: '主  席  台', meeting: '', date: '' };
}

function undo() {
  if (!App.history.length) return false;
  restoreSnapshot(App.history.pop());
  return true;
}

/* ========== 布局同步 ========== */

/**
 * 座位总数与行配置对齐：扩容补空位、缩容截断，并清理越界的团体选区与缺席记录。
 * 返回是否发生了结构性变化。
 */
function syncSeatArrays() {
  const total = sceneSeatCount();
  if (total === S.seats.length) return false;

  const seats = new Array(total).fill(null);
  const units = new Array(total).fill('');
  const keep = Math.min(total, S.seats.length);
  for (let i = 0; i < keep; i++) {
    seats[i] = S.seats[i];
    units[i] = S.units[i] || '';
  }
  S.seats = seats;
  S.units = units;

  S.zones = S.zones
    .map((z) => ({ ...z, seats: z.seats.filter((i) => i < total) }))
    .filter((z) => z.seats.length > 0);

  for (const [person, seat] of Array.from(S.absent.entries())) {
    if (seat >= total) S.absent.delete(person);
  }
  return true;
}

/* ========== 座位内容模型 ========== */

/**
 * 一个座位的完整渲染模型：DOM 与 Canvas 都只消费它，不再各自计算。
 * @param {number} idx 座位下标
 * @param {{forExport?:boolean}} [opt]
 */
function seatModel(idx, opt) {
  const person = personAt(idx);
  const unitText = unitAt(idx);
  const unitLines = normalizeLines(unitText, UNIT_MAX_LINES);
  const zone = zoneAt(idx);
  const hasPerson = person != null;
  const fontSizeOffset = S.font.name;

  const innerW = GEO.seatW - 12;
  const padTop = GEO.padTop;
  const padBottom = GEO.padBottom;

  /* --- 单位块（宽度优先，最多 3 行） --- */
  let unitSize = 0;
  if (unitLines.length) {
    let base = TYPE.unitMax;
    while (base > TYPE.unitMin && !unitLines.every((line) => measureWidth(line, base, 400, FONTS.body) <= innerW)) base--;
    unitSize = clamp(base + S.font.unit, TYPE.unitClampMin, TYPE.unitClampMax);
  }
  const unitH = unitLines.length ? unitLines.length * unitSize * 1.1 + 2 : 0;

  /* --- 姓名行 --- */
  const showZoneName = zone ? zone.showName : true;
  const nameSize = clamp((zone ? TYPE.nameBaseZone : TYPE.nameBase) + fontSizeOffset, TYPE.nameMin, TYPE.nameMax);
  const nameH = (zone ? showZoneName : true) ? nameSize * 1.25 + 2 : (hasPerson ? nameSize * 1.25 : 0);

  /* --- 团名块（占剩余高度） --- */
  let zoneSize = 0;
  let zoneLines = [];
  if (zone) {
    zoneLines = normalizeLines(zone.name, ZONE_NAME_MAX_LINES);
    const maxH = Math.max(18, GEO.seatH - padTop - padBottom - unitH - nameH - 4);
    zoneSize = fitFontSize(zoneLines, innerW, maxH, {
      weight: 700,
      family: FONTS.display,
      max: TYPE.zoneMax,
      min: TYPE.zoneMin,
      lh: TYPE.lh,
      offset: S.font.zone,
      clampMin: TYPE.zoneClampMin,
      clampMax: TYPE.zoneClampMax
    });
  }

  return {
    idx,
    number: seatNumber(idx),
    person,
    hasPerson,
    isEmpty: !hasPerson,
    unitText,
    unitLines,
    unitSize,
    nameSize,
    zone,
    zoneLines,
    zoneSize,
    ink: zone ? contrastInk(zone.color) : PALETTE.ink,
    /** 左上角座号：屏幕与 PNG 同源开关 */
    showNumber: S.showNumbers !== false,
    /** 团体座位是否显示姓名行 */
    showNameRow: zone ? zone.showName : true,
    emptyLabel: zone && zone.showName ? '（空）+' : ''
  };
}

/** 团体区域的席位范围描述。 */
function zoneRangeText(zone) {
  const sorted = [...zone.seats].sort((a, b) => a - b);
  if (!sorted.length) return '—';
  if (sorted.length === 1) return `${sorted[0] + 1} 号`;
  if (sorted.length <= 4) return sorted.map((i) => i + 1).join('、') + ' 号';
  return `${sorted[0] + 1}–${sorted[sorted.length - 1] + 1} 号（${sorted.length} 座）`;
}

/** 某座位所属团体的名称（单行化），供文本导出。 */
function zoneNamesAt(idx) {
  return App.state.zones.filter((z) => z.seats.includes(idx)).map((z) => z.name.replace(/\n/g, ' / '));
}

/** 统计摘要。 */
function stats() {
  const total = seatCount();
  const occupied = S.seats.filter((x) => x != null).length;
  const absent = S.absent.size;
  const unseated = Math.max(0, S.people.length - occupied - absent);
  return { total, occupied, empty: total - occupied, absent, unseated };
}

/* ========== 座位/人员操作 ========== */

function resetSeating(peopleText, opt) {
  const people = parsePeople(peopleText);
  const total = sceneSeatCount();
  S.people = people;
  S.seats = new Array(total).fill(null);
  S.units = new Array(total).fill('');
  S.absent = new Map();
  if (opt && opt.clearZones) S.zones = [];
  for (let i = 0; i < Math.min(people.length, total); i++) S.seats[i] = i;
  App.history = [];
}

/**
 * 切场景时重排座位：人员顺序不变，单位跟着人走，缺席与团体按人重映射。
 * 新场景座位不够时，多出的人留作未排座（仍在名单里）。
 */
function remapSeatsForScene(nextScene) {
  const nameAt = (i) => (S.seats[i] == null ? null : S.people[S.seats[i]]);
  const absentAt = new Map();
  for (const [person, seat] of S.absent) absentAt.set(seat, person);

  const entries = [];
  const seen = new Set();
  for (let i = 0; i < S.seats.length; i++) {
    const name = nameAt(i);
    if (name != null && !seen.has(name)) {
      entries.push({ name, unit: S.units[i] || '', absent: false });
      seen.add(name);
    } else if (absentAt.has(i)) {
      const abs = absentAt.get(i);
      if (!seen.has(abs)) {
        entries.push({ name: abs, unit: '', absent: true });
        seen.add(abs);
      }
    }
  }
  S.people.forEach((name) => {
    if (!seen.has(name)) {
      entries.push({ name, unit: '', absent: false });
      seen.add(name);
    }
  });

  const total = sceneSeatCount(nextScene, S.layouts[nextScene]);
  const people = entries.map((e) => e.name);
  const indexOf = new Map(people.map((name, i) => [name, i]));
  const seats = new Array(total).fill(null);
  const units = new Array(total).fill('');
  const absent = new Map();
  const seatOf = new Map();

  let cursor = 0;
  entries.forEach((e) => {
    if (cursor >= total) return;
    seatOf.set(e.name, cursor);
    if (e.absent) absent.set(e.name, cursor);
    else seats[cursor] = indexOf.get(e.name);
    if (e.unit) units[cursor] = e.unit;
    cursor++;
  });

  const zones = S.zones
    .map((z) => ({
      ...z,
      seats: z.seats
        .map((i) => nameAt(i))
        .filter((name) => name != null)
        .map((name) => seatOf.get(name))
        .filter((i) => i != null)
    }))
    .filter((z) => z.seats.length > 0);

  S.people = people;
  S.seats = seats;
  S.units = units;
  S.absent = absent;
  S.zones = zones;
  return { unseated: Math.max(0, people.length - total) };
}

/**
 * 一排的几何尺寸（与 DOM 的 flex 排列严格对应：每个座位前有一个间隙或过道）。
 * PNG 导出与中轴线计算共用，避免两套宽度公式。
 * @returns {{width:number, seatSpan:number, seatX:(col:number)=>number}}
 */
function rowGeometry(n, aisles) {
  const spacers = [];
  for (let c = 0; c < n; c++) spacers.push(aisles.includes(c) ? GEO.aisle : GEO.gap);
  const total = spacers.reduce((a, b) => a + b, 0);
  const seatX = (col) => {
    let x = 0;
    for (let c = 0; c <= col; c++) x += spacers[c];
    return x + col * GEO.seatW;
  };
  return {
    width: n * GEO.seatW + total,
    seatSpan: seatX(n - 1) + GEO.seatW - seatX(0),
    seatX
  };
}

/** 交换两个座位（人员 + 单位一起走）。 */
function swapSeats(a, b) {
  if (a === b) return false;
  [S.seats[a], S.seats[b]] = [S.seats[b], S.seats[a]];
  [S.units[a], S.units[b]] = [S.units[b], S.units[a]];
  return true;
}

/** 把 src 座位插到 beforeIdx 之前，其后顺位后移。 */
function moveSeatBefore(src, beforeIdx) {
  const seats = S.seats.slice();
  const units = S.units.slice();
  const person = seats.splice(src, 1)[0];
  const unit = units.splice(src, 1)[0];
  const insertAt = src < beforeIdx ? beforeIdx - 1 : beforeIdx;
  seats.splice(insertAt, 0, person);
  units.splice(insertAt, 0, unit);
  const changed = seats.some((v, i) => v !== S.seats[i]);
  if (changed) {
    S.seats = seats;
    S.units = units;
  }
  return changed;
}

/** 递补：消除所有空位，人员按现有顺序前移。 */
function compactSeats() {
  const keep = [];
  S.seats.forEach((p, i) => {
    if (p != null) keep.push({ p, unit: S.units[i] || '' });
  });
  const seats = new Array(S.seats.length).fill(null);
  const units = new Array(S.seats.length).fill('');
  keep.forEach((item, i) => {
    seats[i] = item.p;
    units[i] = item.unit;
  });
  const changed = seats.some((v, i) => v !== S.seats[i]);
  if (changed) {
    S.seats = seats;
    S.units = units;
  }
  return changed;
}

/** 标记缺席。 */
function markAbsent(idx) {
  const person = S.seats[idx];
  if (person == null) return false;
  S.seats[idx] = null;
  S.absent.set(person, idx);
  return true;
}

/** 恢复缺席：原座位空着就回原位，否则整体后移一位插入。 */
function restoreAbsent(person) {
  const orig = S.absent.get(person);
  if (orig == null) return { ok: false, reason: 'missing' };
  if (orig >= S.seats.length) return { ok: false, reason: 'range' };

  if (S.seats[orig] == null) {
    S.seats[orig] = person;
  } else {
    let emptyIdx = -1;
    for (let i = orig + 1; i < S.seats.length; i++) {
      if (S.seats[i] == null) { emptyIdx = i; break; }
    }
    if (emptyIdx === -1) return { ok: false, reason: 'full' };
    for (let i = emptyIdx; i > orig; i--) {
      S.seats[i] = S.seats[i - 1];
      S.units[i] = S.units[i - 1];
    }
    S.seats[orig] = person;
  }
  S.absent.delete(person);
  return { ok: true };
}

/** 清空座位（姓名 + 单位）。若人仍挂在 people 里，一并移除，避免出现「未排座」幽灵。 */
function clearSeat(idx) {
  const person = S.seats[idx];
  const hasUnit = unitAt(idx) !== '';
  if (person == null && !hasUnit) return false;
  if (person != null) {
    S.absent.delete(person);
    // people 中删除该人，并把所有大于该索引的座次引用前移
    S.people.splice(person, 1);
    for (let i = 0; i < S.seats.length; i++) {
      if (S.seats[i] != null && S.seats[i] > person) S.seats[i] -= 1;
    }
    for (const [p, seat] of Array.from(S.absent.entries())) {
      if (p > person) {
        S.absent.delete(p);
        S.absent.set(p - 1, seat);
      }
    }
  }
  S.seats[idx] = null;
  S.units[idx] = '';
  return true;
}

/** 在空位填入新姓名。 */
function fillSeat(idx, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed || S.seats[idx] != null) return false;
  S.people.push(trimmed);
  S.seats[idx] = S.people.length - 1;
  return true;
}

/** 在某位置前插入新姓名，整体后移。 */
function insertSeatBefore(beforeIdx, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed || S.seats[S.seats.length - 1] != null) return false;
  S.people.push(trimmed);
  const newIdx = S.people.length - 1;
  for (let i = S.seats.length - 1; i > beforeIdx; i--) {
    S.seats[i] = S.seats[i - 1];
    S.units[i] = S.units[i - 1];
  }
  S.seats[beforeIdx] = newIdx;
  S.units[beforeIdx] = '';
  return true;
}

/** 改名。 */
function renamePerson(personIdx, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed || S.people[personIdx] === trimmed) return false;
  S.people[personIdx] = trimmed;
  return true;
}
