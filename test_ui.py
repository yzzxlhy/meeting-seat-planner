"""test_ui.py — 用 Playwright 跑一遍真实交互，验证重构后功能不丢、布局不炸。

覆盖：首屏渲染 / 填名 / 标记缺席 / 恢复 / 改单位 / 团标注 / 字号微调 /
      拖拽交换 / 撤销 / 存档重载 / PNG 导出 / 三档视口截图
"""

from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = Path(__file__).resolve().parent
URL = (BASE / "dist" / "会议辅助.html").as_uri()
SHOTS = BASE / "dist" / "shots"

failures: list[str] = []


def check(label: str, ok: bool, extra: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {label}{'  ' + extra if extra else ''}")
    if not ok:
        failures.append(label)


def run() -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)

        page.goto(URL)
        page.wait_for_timeout(300)

        # --- 首屏 ---
        seats = page.locator(".seat[data-seat]")
        check("座位数 = 20", seats.count() == 20, f"got {seats.count()}")

        axis = page.evaluate("() => { const a=document.getElementById('axis'); return {left:parseFloat(a.style.left), h:parseFloat(a.style.height)}; }")
        check("中轴线已定位", axis["left"] > 0 and axis["h"] > 0, str(axis))

        stage = page.evaluate("() => document.getElementById('stage').getBoundingClientRect().width")
        check("主席台有宽度", stage > 100, f"{stage:.0f}px")

        status = page.inner_text("#titleBlock")
        check("标题栏显示席位构成", "10 + 10" in status, status.replace("\n", " "))
        check("统计条已移除", page.locator("#statusLine").count() == 0)

        page.screenshot(path=str(SHOTS / "01-desktop.png"), full_page=True)

        # --- 空位填名 ---
        page.locator('.seat[data-seat="6"]').click()
        page.wait_for_selector(".editor input")
        page.fill(".editor input", "周九")
        page.keyboard.press("Enter")
        page.wait_for_timeout(150)
        check("空位填名生效", page.locator('.seat[data-seat="6"] .name').inner_text().strip() == "周九")

        # --- 单位多行 ---
        page.locator('.seat[data-seat="6"] [data-action="unit"]').click(force=True)
        page.wait_for_selector(".editor textarea")
        page.fill(".editor textarea", "区教育局\n办公室")
        page.keyboard.press("Control+Enter")
        page.wait_for_timeout(150)
        unit_lines = page.locator('.seat[data-seat="6"] .unit span').count()
        check("单位两行渲染", unit_lines == 2, f"lines={unit_lines}")
        unit_above = page.evaluate(
            """() => {
                const seat = document.querySelector('.seat[data-seat=\"6\"]');
                const u = seat.querySelector('.unit').getBoundingClientRect();
                const n = seat.querySelector('.name').getBoundingClientRect();
                return u.top < n.top && u.bottom <= n.top + 1;
            }"""
        )
        check("单位排在姓名之上", unit_above, "")

        # --- 标记缺席 ---
        page.locator('.seat[data-seat="0"]').click()
        page.wait_for_timeout(120)
        check("未被标记为缺席", page.locator(".absent-tag").count() == 1)
        check("座位已空出", page.locator('.seat[data-seat="0"]').evaluate("el => el.classList.contains('seat--empty')"))

        # --- 恢复 ---
        page.locator(".absent-tag").first.click()
        page.wait_for_timeout(120)
        check("缺席恢复回原位", page.locator('.seat[data-seat="0"] .name').inner_text().strip() == "张三")

        # --- 团体标注 ---
        page.click("#zoneBtn")
        for idx in (8, 9, 10):
            page.locator(f'.seat[data-seat="{idx}"]').click()
        page.fill("#zoneNameInput", "第一代表团")
        page.click("#zoneConfirmBtn")
        page.wait_for_timeout(200)
        check("团体座位成型", page.locator(".seat--zone").count() == 3, f"{page.locator('.seat--zone').count()}")

        axis_after = page.evaluate("() => parseFloat(document.getElementById('axis').style.left)")
        check("团体不破坏中轴线", abs(axis_after - axis["left"]) < 1, f"{axis['left']} -> {axis_after}")

        page.screenshot(path=str(SHOTS / "02-zone.png"), full_page=True)

        # --- 字号微调 ---
        page.locator('[data-font-group="zone"] [data-font-step="1"]').click()
        page.wait_for_timeout(100)
        val = page.inner_text('[data-font-value="zone"]')
        check("团名字号 +1", val == "+1", val)

        # --- 拖拽交换（指针事件）---
        src = page.locator('.seat[data-seat="1"]').bounding_box()
        dst = page.locator('.seat[data-seat="2"]').bounding_box()
        page.mouse.move(src["x"] + src["width"] / 2, src["y"] + src["height"] / 2)
        page.mouse.down()
        page.mouse.move(dst["x"] + dst["width"] / 2, dst["y"] + dst["height"] / 2, steps=12)
        page.mouse.up()
        page.wait_for_timeout(200)
        name1 = page.locator('.seat[data-seat="1"] .name').inner_text().strip()
        check("拖拽交换生效", name1 == "王五", f"seat2 -> {name1}")

        # --- 撤销 ---
        page.click("#undoBtn")
        page.wait_for_timeout(150)
        name1b = page.locator('.seat[data-seat="1"] .name').inner_text().strip()
        check("撤销回到交换前", name1b == "李四", name1b)

        # --- 存档重载 ---
        page.click("#saveBtn")
        page.reload()
        page.wait_for_timeout(400)
        check("重载后座位保留", page.locator('.seat[data-seat="6"] .name').inner_text().strip() == "周九")
        check("重载后团体保留", page.locator(".seat--zone").count() == 3)

        # --- PNG 导出 ---
        page.evaluate(
            """() => {
                window.__drawn = [];
                const proto = CanvasRenderingContext2D.prototype;
                if (proto.__spy) return;
                const orig = proto.fillText;
                proto.fillText = function (text, ...rest) {
                    window.__drawn.push(String(text));
                    return orig.call(this, text, ...rest);
                };
                proto.__spy = true;
            }"""
        )
        try:
            with page.expect_download(timeout=8000) as dl:
                page.click("#pngBtn")
            path = dl.value.path()
            check("PNG 已生成", Path(path).stat().st_size > 5000, f"{Path(path).stat().st_size} bytes")
        except Exception as exc:  # noqa: BLE001
            check("PNG 已生成", False, str(exc))
        drawn = page.evaluate("() => window.__drawn")
        placeholder_hits = [t for t in drawn if any(k in t for k in ("空位", "（空）", "（未填写"))]
        check("PNG 不含未填占位", not placeholder_hits, str(placeholder_hits))

        # --- 打印样式 ---
        page.emulate_media(media="print")
        print_state = page.evaluate(
            """() => ({
                toolbar: getComputedStyle(document.querySelector('.main .btn-row.no-print')).display,
                rail: getComputedStyle(document.querySelector('.rail')).display,
                hall: getComputedStyle(document.querySelector('.hall')).overflow
            })"""
        )
        check(
            "打印隐藏工具栏与左栏",
            print_state["toolbar"] == "none" and print_state["rail"] == "none" and print_state["hall"] == "visible",
            str(print_state),
        )
        print_placeholders = page.evaluate(
            """() => Array.from(document.querySelectorAll(
                '.fill-hint, .unit--empty, .name--fill, .order-table .name--empty, ' +
                '.order-table .unit-cell.is-empty, .order-table .actions, .legend, ' +
                '.title-block .v[data-empty="true"]'
            )).filter((n) => {
                const s = getComputedStyle(n);
                const r = n.getBoundingClientRect();
                return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0 && r.width > 0;
            }).length"""
        )
        check("打印面不含未填占位", print_placeholders == 0, f"可见 {print_placeholders} 处")
        page.emulate_media(media="screen")

        # --- 座号开关 ---
        page.click("#numsBtn")
        page.wait_for_timeout(120)
        check("隐藏座号：座位不再渲染座号", page.locator(".seat .num").count() == 0)
        check("隐藏座号：按钮文案翻转", "显示座号" in page.inner_text("#numsBtn"))
        page.evaluate("() => { window.__drawn = []; }")
        with page.expect_download(timeout=8000) as dl_hidden:
            page.click("#pngBtn")
        drawn_hidden = page.evaluate("() => window.__drawn")
        digit_hits = [t for t in drawn_hidden if str(t).strip().isdigit()]
        check("隐藏座号：PNG 不画座号", not digit_hits, str(digit_hits))

        page.click("#saveBtn")
        page.reload()
        page.wait_for_timeout(400)
        check("隐藏座号：重载后仍隐藏", page.locator(".seat .num").count() == 0)
        page.click("#numsBtn")
        page.wait_for_timeout(120)
        check("恢复座号", page.locator(".seat .num").count() > 0)

        # --- 中轴线开关 ---
        page.evaluate(
            """() => {
                window.__dashes = [];
                const proto = CanvasRenderingContext2D.prototype;
                if (proto.__dashSpy) return;
                const orig = proto.setLineDash;
                proto.setLineDash = function (arr) {
                    window.__dashes.push(Array.from(arr).join(','));
                    return orig.call(this, arr);
                };
                proto.__dashSpy = true;
            }"""
        )
        with page.expect_download(timeout=8000) as dl_axis_on:
            page.click("#pngBtn")
        on_dashes = page.evaluate("() => window.__dashes")
        check("PNG 含中轴线虚线", "5,4" in on_dashes, str(sorted(set(on_dashes))))

        page.click("#axisBtn")
        page.wait_for_timeout(150)
        axis_display = page.evaluate("() => getComputedStyle(document.getElementById('axis')).display")
        check("隐藏中轴线：DOM 不可见", axis_display == "none", axis_display)
        page.evaluate("() => { window.__dashes = []; }")
        with page.expect_download(timeout=8000) as dl_axis_off:
            page.click("#pngBtn")
        off_dashes = page.evaluate("() => window.__dashes")
        check("隐藏中轴线：PNG 不画虚线", "5,4" not in off_dashes, str(sorted(set(off_dashes))))

        page.click("#axisBtn")
        page.wait_for_timeout(120)
        axis_display = page.evaluate("() => getComputedStyle(document.getElementById('axis')).display")
        check("恢复中轴线", axis_display != "none", axis_display)

        # --- 视口 ---
        for name, w, h in (("03-tablet", 900, 1100), ("04-mobile", 375, 900)):
            page.set_viewport_size({"width": w, "height": h})
            page.wait_for_timeout(250)
            overflow = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            check(f"{name} 无整页横向溢出", overflow <= 1, f"overflow={overflow}")
            page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=True)

        check("无 JS 报错", not errors, "; ".join(errors[:3]))

        browser.close()


if __name__ == "__main__":
    run()
    print()
    if failures:
        print(f"FAILED {len(failures)}: " + ", ".join(failures))
        sys.exit(1)
    print("ALL PASS")
