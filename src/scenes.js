/**
 * scenes.js — 场景几何
 *
 * 剧院式沿用行式 DOM（.row / 空隙 / 过道）；其余场景由本文件算出绝对坐标，
 * DOM 与 Canvas 共用同一份坐标，避免屏幕与导出漂移。
 *
 * 约定：每个场景返回
 *   { w, h, seats:[{idx,x,y}], decor:[{type,x,y,w,h,r}] }
 * 其中 seats 的顺序必须与 state.js 的 sceneGroups() 完全一致。
 */

'use strict';

/** 长桌围合的桌板厚度与座位留缝（px）。 */
const TABLE_T = 56;
const TABLE_GAP = 10;
const SCENE_PAD = 20;

/**
 * 长桌：四条边各自可坐人，0 表示该边不坐人。
 * 空出的边不画桌板，因此「下 + 左 + 右」自然形成 U 形。
 */
function longTableGeometry(cfg) {
  const b = cfg.bottom;
  const r = cfg.right;
  const t = cfg.top;
  const l = cfg.left;

  const seatW = GEO.seatW;
  const seatH = GEO.seatH;

  const tableW = Math.max(3, b, t) * (seatW + 8);
  const tableH = Math.max(2, l, r) * (seatH + 8);

  const w = tableW + 2 * (seatW + TABLE_GAP) + 2 * SCENE_PAD;
  const h = tableH + 2 * (seatH + TABLE_GAP) + 2 * SCENE_PAD;

  const tx = SCENE_PAD + seatW + TABLE_GAP;
  const ty = SCENE_PAD + seatH + TABLE_GAP;

  const seats = [];
  let idx = 0;

  /* 下边：从左到右 */
  for (let i = 0; i < b; i++) {
    const cx = tx + ((i + 0.5) * tableW) / b;
    seats.push({ idx: idx++, x: cx - seatW / 2, y: ty + tableH + TABLE_GAP });
  }
  /* 右边：从下到上 */
  for (let i = 0; i < r; i++) {
    const cy = ty + tableH - ((i + 0.5) * tableH) / r;
    seats.push({ idx: idx++, x: tx + tableW + TABLE_GAP, y: cy - seatH / 2 });
  }
  /* 上边：从右到左 */
  for (let i = 0; i < t; i++) {
    const cx = tx + tableW - ((i + 0.5) * tableW) / t;
    seats.push({ idx: idx++, x: cx - seatW / 2, y: ty - TABLE_GAP - seatH });
  }
  /* 左边：从上到下 */
  for (let i = 0; i < l; i++) {
    const cy = ty + ((i + 0.5) * tableH) / l;
    seats.push({ idx: idx++, x: tx - TABLE_GAP - seatW, y: cy - seatH / 2 });
  }

  const decor = [];
  const onlySides = t === 0 && b === 0 && l > 0 && r > 0;
  const onlyTopBottom = l === 0 && r === 0 && t > 0 && b > 0;

  if (onlySides || onlyTopBottom) {
    /* 对坐：一张完整长桌，两边坐人 */
    decor.push({ type: 'table', x: tx, y: ty, w: tableW, h: tableH, r: 10 });
  } else {
    if (b > 0) decor.push({ type: 'table', x: tx, y: ty + tableH - TABLE_T, w: tableW, h: TABLE_T, r: 8 });
    if (t > 0) decor.push({ type: 'table', x: tx, y: ty, w: tableW, h: TABLE_T, r: 8 });
    if (l > 0) decor.push({ type: 'table', x: tx, y: ty, w: TABLE_T, h: tableH, r: 8 });
    if (r > 0) decor.push({ type: 'table', x: tx + tableW - TABLE_T, y: ty, w: TABLE_T, h: tableH, r: 8 });
  }

  return { w, h, seats, decor, table: { x: tx, y: ty, w: tableW, h: tableH } };
}

function sceneGeometry() {
  const id = sceneId();
  if (id === 'longTable') return longTableGeometry(sceneCfg(id));
  return null;
}
