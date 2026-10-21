"""test_scenes.py — 场景框架与长桌（U 型 / 对坐 / 回字）回归。

覆盖：场景切换、人数与分组、坐标不重叠、单位跟人走、预设、PNG 导出、切回剧院式。
"""

from __future__ import annotations

from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = Path(__file__).resolve().parent
URL = (BASE / "dist" / "会议辅助.html").as_uri()

failures: list[str] = []


def check(label: str, ok: bool, extra: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {label}{'  ' + extra if extra else ''}")
    if not ok:
        failures.append(label)


def seat_stats(page) -> dict:
    return page.evaluate(
        """() => {
            const seats = Array.from(document.querySelectorAll('.seat[data-seat]'));
            const rects = seats.map((s) => {
                const r = s.getBoundingClientRect();
                return { x: r.x, y: r.y, w: r.width, h: r.height };
            });
            let overlap = 0;
            for (let i = 0; i < rects.length; i++) {
                for (let j = i + 1; j < rects.length; j++) {
                    const a = rects[i], b = rects[j];
                    if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) overlap++;
                }
            }
            return {
                seats: rects.length,
                overlap,
                decor: document.querySelectorAll('.table-shape').length,
                groups: Array.from(document.querySelectorAll('#orderBody .is-row-head td')).map((td) => td.textContent),
                summary: document.getElementById('tbLayout').textContent,
                first: document.querySelector('.seat[data-seat="0"] .name')?.textContent || null,
                unit: document.querySelector('.seat[data-seat="0"] .unit')?.textContent || null,
            };
        }"""
    )


def run() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL)
        page.wait_for_timeout(300)

        page.fill("#people", "\n".join(f"测试{i:02d}" for i in range(1, 21)))
        page.click("#applyBtn")
        page.wait_for_timeout(150)
        page.evaluate("() => { S.units[0] = '区委办公室\\n主任'; render(); }")

        # --- 切到长桌（默认 U 型：下 8 / 左 6 / 右 6） ---
        page.click('[data-scene="longTable"]')
        page.wait_for_timeout(250)
        u = seat_stats(page)
        check("长桌座位数 = 20", u["seats"] == 20, str(u["seats"]))
        check("U 型三块桌板", u["decor"] == 3, str(u["decor"]))
        check("座位不重叠", u["overlap"] == 0, str(u["overlap"]))
        check("分组 = 下/右/左", u["groups"] == ["下边", "右边", "左边"], str(u["groups"]))
        check("标题栏席位构成", u["summary"] == "下 8 · 右 6 · 左 6", u["summary"])
        check("人员按顺序落座", u["first"] == "测试01", str(u["first"]))
        check("单位跟着人走", "主任" in (u["unit"] or ""), str(u["unit"]))

        # --- 预设：对坐 ---
        page.click('[data-lt-preset="face"]')
        page.wait_for_timeout(250)
        face = seat_stats(page)
        check("对坐座位数 = 16", face["seats"] == 16, str(face["seats"]))
        check("对坐是一整张桌", face["decor"] == 1, str(face["decor"]))
        check("对坐分组 = 右/左", face["groups"] == ["右边", "左边"], str(face["groups"]))
        check("对坐不重叠", face["overlap"] == 0, str(face["overlap"]))

        # --- 预设：回字 ---
        page.click('[data-lt-preset="ring"]')
        page.wait_for_timeout(250)
        ring = seat_stats(page)
        check("回字座位数 = 24", ring["seats"] == 24, str(ring["seats"]))
        check("回字四块桌板", ring["decor"] == 4, str(ring["decor"]))
        check("回字四组", ring["groups"] == ["下边", "右边", "上边", "左边"], str(ring["groups"]))

        # --- 单边改人数（回字基础上上边 6 → 10） ---
        page.evaluate(
            """() => {
                const input = document.getElementById('ltTop');
                input.value = '10';
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }"""
        )
        page.wait_for_timeout(250)
        edited = seat_stats(page)
        check("上边改 10 后总数 = 28", edited["seats"] == 28, str(edited["seats"]))

        # --- 导出 PNG ---
        try:
            with page.expect_download(timeout=8000) as dl:
                page.click("#pngBtn")
            size = Path(dl.value.path()).stat().st_size
            check("长桌 PNG 已生成", size > 8000, f"{size} bytes")
            check("长桌 PNG 文件名", "长桌" in dl.value.suggested_filename, dl.value.suggested_filename)
        except Exception as exc:  # noqa: BLE001
            check("长桌 PNG 已生成", False, str(exc))

        # --- 存档 / 重载 ---
        page.click("#saveBtn")
        page.reload()
        page.wait_for_timeout(400)
        reloaded = page.evaluate("() => ({ scene: S.scene, seats: document.querySelectorAll('.seat[data-seat]').length })")
        check("重载后仍是长桌", reloaded["scene"] == "longTable", str(reloaded))
        check("重载后座位数保持 28", reloaded["seats"] == 28, str(reloaded["seats"]))

        # --- 切回剧院式 ---
        page.click('[data-scene="theater"]')
        page.wait_for_timeout(300)
        back = page.evaluate(
            """() => ({
                rows: document.querySelectorAll('.row').length,
                seats: document.querySelectorAll('.seat[data-seat]').length,
                axis: getComputedStyle(document.getElementById('axis')).display,
                stage: getComputedStyle(document.getElementById('stage')).display,
            })"""
        )
        check("切回剧院式有 2 排", back["rows"] == 2, str(back))
        check("切回剧院式中轴线恢复", back["axis"] != "none", back["axis"])
        check("切回剧院式主席台恢复", back["stage"] != "none", back["stage"])

        check("无 JS 报错", not errors, "; ".join(errors[:3]))
        browser.close()


if __name__ == "__main__":
    run()
    print()
    if failures:
        print(f"FAILED {len(failures)}: " + ", ".join(failures))
        raise SystemExit(1)
    print("SCENES OK")
