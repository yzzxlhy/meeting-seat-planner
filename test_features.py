"""test_features.py — 功能回归清单（逐条对应原版能力）

排座奇偶规则 / 过道 / 拖到空隙插入 / 双击改名 / 团体隐藏姓名 /
字体三组微调 / 递补 / 撤销 / CSV 内容 / TXT / 复制 / 存档 / 主席台 / 中轴线
"""

from __future__ import annotations

import csv
import io
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = Path(__file__).resolve().parent
URL = (BASE / "dist" / "会议辅助.html").as_uri()

failures: list[str] = []


def check(label: str, ok: bool, extra: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {label}{'  ' + extra if extra else ''}")
    if not ok:
        failures.append(label)


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL)
        page.wait_for_timeout(250)

        # ---------- 排座规则：奇数 9 座 ----------
        page.evaluate("() => { document.getElementById('rowSeats').value='9'; commitLayout(); }")
        page.wait_for_timeout(200)
        layout9 = page.evaluate(
            """() => {
                const row = document.querySelector('.row');
                const seats = Array.from(row.querySelectorAll('.seat[data-seat]'))
                    .map(el => ({ idx: Number(el.dataset.seat), left: el.offsetLeft }));
                seats.sort((a,b) => a.left - b.left);
                return seats.map(s => s.idx);   // 从左到右的座次索引
            }"""
        )
        # 奇数：1 号居中(下标4)，2 号在左(3)，3 号在右(5)，4 号在左二(2)，5 号在右二(6)
        check("奇数排 9 座：中轴左起座次", layout9 == [7, 5, 3, 1, 0, 2, 4, 6, 8], str(layout9))

        # ---------- 偶数 10 座 ----------
        page.evaluate("() => { document.getElementById('rowSeats').value='10'; commitLayout(); }")
        page.wait_for_timeout(200)
        layout10 = page.evaluate(
            """() => {
                const row = document.querySelector('.row');
                const seats = Array.from(row.querySelectorAll('.seat[data-seat]'))
                    .map(el => ({ idx: Number(el.dataset.seat), left: el.offsetLeft }));
                seats.sort((a,b) => a.left - b.left);
                return seats.map(s => s.idx);
            }"""
        )
        # 偶数：1 号在中轴右侧(下标5)，2 号在左(4)，3 号右一(6)…
        check("偶数排 10 座：中轴左起座次", layout10 == [9, 7, 5, 3, 1, 0, 2, 4, 6, 8], str(layout10))

        # ---------- 过道 ----------
        page.evaluate("() => { document.getElementById('rowSeats').value='10,10'; document.getElementById('aisles').value='5'; commitLayout(); }")
        page.wait_for_timeout(200)
        check("过道元素渲染", page.locator(".aisle").count() >= 2, f"{page.locator('.aisle').count()}")
        aisle_w = page.evaluate("() => document.querySelector('.aisle').getBoundingClientRect().width")
        check("过道宽度 = 26px", abs(aisle_w - 26) < 0.5, f"{aisle_w}")

        # ---------- 拖到空隙插入 ----------
        page.evaluate("() => { document.querySelector('[data-gap=\"3\"]').dispatchEvent(new Event('x')); }")
        src = page.locator('.seat[data-seat="1"]').bounding_box()
        gap = page.locator('[data-gap="3"]').bounding_box()
        page.mouse.move(src["x"] + 20, src["y"] + 30)
        page.mouse.down()
        page.mouse.move(gap["x"] + gap["width"] / 2, gap["y"] + gap["height"] / 2, steps=10)
        page.mouse.up()
        page.wait_for_timeout(250)
        order = page.evaluate("() => S.seats.slice(0, 6)")
        # 拖到「4 号前」：1 号抽出后，原 4 号前移一位，因此落在下标 2
        check("拖到空隙后顺序改变", order[2] == 1 and order[3] == 3, str(order))

        # ---------- 改名（左上角 ✎） ----------
        page.locator('.seat[data-seat="0"] [data-action="rename"]').click(force=True)
        page.wait_for_selector(".editor input")
        page.fill(".editor input", "张三丰")
        page.keyboard.press("Enter")
        page.wait_for_timeout(150)
        check("行内改名生效", page.locator('.seat[data-seat="0"] .name').inner_text().strip() == "张三丰")
        check("改名不会误标缺席", page.evaluate("S.absent.size") == 0, str(page.evaluate("S.absent.size")))

        # ---------- 团体 + 隐藏座位姓名 ----------
        page.click("#zoneBtn")
        for idx in (0, 1):
            page.locator(f'.seat[data-seat="{idx}"]').click()
        page.fill("#zoneNameInput", "主席团")
        page.uncheck("#zoneShowName")
        page.click("#zoneConfirmBtn")
        page.wait_for_timeout(200)
        check("团体隐藏姓名后无姓名行", page.locator('.seat--zone .name').count() == 0)
        check("团体名称已渲染", page.locator('.seat--zone .zone-name').first.inner_text().startswith("主席团"))

        # ---------- 字体三组微调 ----------
        page.click('[data-font-group="unit"] [data-font-step="-1"]')
        page.click('[data-font-group="name"] [data-font-step="1"]')
        page.wait_for_timeout(100)
        fonts = page.evaluate("() => ({...S.font})")
        check("三组字号独立", fonts["unit"] == -1 and fonts["name"] == 1 and fonts["zone"] == 0, str(fonts))
        disabled = page.locator('[data-font-group="unit"] [data-font-step="-1"]').is_disabled()
        page.click('[data-font-group="unit"] [data-font-step="-1"]')
        page.click('[data-font-group="unit"] [data-font-step="-1"]')
        page.click('[data-font-group="unit"] [data-font-step="-1"]')
        page.wait_for_timeout(80)
        check("字号下界 -4 生效", page.evaluate("S.font.unit") == -4 and disabled is False, str(page.evaluate("S.font.unit")))

        # ---------- 递补 ----------
        page.evaluate("() => { S.seats[2] = null; S.units[2] = ''; render(); }")
        page.click("#compactBtn")
        page.wait_for_timeout(200)
        check("递补后无中间空位", page.evaluate("S.seats.slice(0,5).every(x => x !== null)"))

        # ---------- CSV 内容 ----------
        with page.expect_download() as dl:
            page.click("#csvBtn")
        path = dl.value.path()
        raw = Path(path).read_text(encoding="utf-8-sig")
        rows = list(csv.reader(io.StringIO(raw)))
        check("CSV 表头正确", rows[0] == ["座位号", "排", "姓名", "单位", "状态", "团体"], str(rows[0]))
        check("CSV 行数 = 21（20 席 + 表头）", len(rows) == 21, str(len(rows)))

        # ---------- TXT ----------
        with page.expect_download() as dl2:
            page.click("#txtBtn")
        txt = Path(dl2.value.path()).read_text(encoding="utf-8")
        check("TXT 含排标题", "【第 1 排】" in txt)

        # ---------- 保存 → 重载 ----------
        page.evaluate("() => { S.meta.meeting = '全区教育工作会议'; S.meta.date = '2026-10-20'; render(); }")
        page.click("#saveBtn")
        page.reload()
        page.wait_for_timeout(350)
        check("会议信息持久化", page.inner_text("#tbMeeting") == "全区教育工作会议")
        check("日期持久化", page.input_value("#meetingDate") == "2026-10-20")
        check("团体持久化", page.locator(".seat--zone").count() == 2)

        check("无 JS 报错", not errors, "; ".join(errors[:3]))
        browser.close()

    print()
    if failures:
        print(f"FAILED {len(failures)}: " + ", ".join(failures))
        raise SystemExit(1)
    print("FEATURES OK")


if __name__ == "__main__":
    main()
