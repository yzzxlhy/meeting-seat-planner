"""test_fonts.py — 字体方案与刊头验收：四种搭配 / 切换持久化 / 楷体不溢出 / PNG 刊头不压线。"""

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


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL)
        page.wait_for_timeout(250)

        # ---------- 1. 统计条已移除 ----------
        check("统计条已删除", page.locator("#statusLine").count() == 0)
        check("标题栏不再有出席/缺席", page.locator("#tbSeated, #tbAbsent").count() == 0)
        check("标题栏保留会议/日期/席位构成", page.locator("#tbMeeting, #tbDate, #tbLayout").count() == 3)

        # ---------- 2. 字体可选 ----------
        options = page.eval_on_selector_all("#fontPreset option", "els => els.map(e => e.value)")
        check("四个字体方案可选", options == ["gongwen", "song", "hei", "kai"], str(options))

        def css_fonts() -> tuple[str, str]:
            return page.evaluate(
                """() => [
                    getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim(),
                    getComputedStyle(document.documentElement).getPropertyValue('--font-body').trim()
                ]"""
            )

        seen = {}
        for value in options:
            page.select_option("#fontPreset", value)
            page.wait_for_timeout(150)
            seen[value] = css_fonts()
            check(f"方案 {value} 已生效", seen[value][0] != "" and seen[value][1] != "", str(seen[value]))

        check("公文=宋体标题+雅黑正文", "SimSun" in seen["gongwen"][0] or "Songti" in seen["gongwen"][0])
        check("黑体方案标题为大黑", "YaHei" in seen["hei"][0], seen["hei"][0][:40])
        check("楷体方案标题为楷体", "KaiTi" in seen["kai"][0] or "Kaiti" in seen["kai"][0], seen["kai"][0][:40])
        check("四方案互不相同", len({tuple(v) for v in seen.values()}) == 4)

        # 字体切换后座位内容仍不溢出
        page.select_option("#fontPreset", "kai")
        page.wait_for_timeout(200)
        overflow = page.evaluate(
            """() => Array.from(document.querySelectorAll('.seat'))
                .filter(el => el.scrollHeight > el.clientHeight + 1).length"""
        )
        check("楷体下座位不溢出", overflow == 0, str(overflow))

        # 字体持久化
        page.select_option("#fontPreset", "hei")
        page.click("#saveBtn")
        page.reload()
        page.wait_for_timeout(300)
        check("字体选择持久化", page.input_value("#fontPreset") == "hei")
        check("重载后字体真正应用", "YaHei" in page.evaluate(
            "getComputedStyle(document.documentElement).getPropertyValue('--font-display')"
        ))

        # ---------- 3. PNG 标题不压线 ----------
        page.evaluate(
            """() => { S.meta.meeting = '全区教育工作会议'; S.meta.date = '2026 年 10 月 20 日'; render(); }"""
        )
        with page.expect_download() as dl:
            page.click("#pngBtn")
        png = Path(BASE / "dist" / "shots" / "v3-header.png")
        png.parent.mkdir(parents=True, exist_ok=True)
        png.write_bytes(Path(dl.value.path()).read_bytes())

        import base64

        b64 = base64.b64encode(png.read_bytes()).decode()
        geo = page.evaluate(
            """async (b64) => {
                const img = new Image();
                img.src = 'data:image/png;base64,' + b64;
                await img.decode();
                const c = document.createElement('canvas');
                c.width = img.width; c.height = img.height;
                const ctx = c.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);

                const dark = (x, y) => {
                    const i = (y * width + x) * 4;
                    return (data[i] + data[i+1] + data[i+2]) / 3 < 120;
                };

                // 找刊头分隔线：前 25% 高度里最长的一条暗行
                let ruleY = -1, ruleLen = 0;
                for (let y = 0; y < height * 0.25; y++) {
                    let run = 0;
                    for (let x = 0; x < width; x++) if (dark(x, y)) run++;
                    if (run > ruleLen) { ruleLen = run; ruleY = y; }
                }

                // 标题字（左侧 44~640 逻辑像素 → 2 倍图）底部
                let titleBottom = -1;
                for (let y = 0; y < ruleY; y++) {
                    for (let x = 88; x < 700; x++) {
                        if (dark(x, y)) { if (y > titleBottom) titleBottom = y; }
                    }
                }

                // 副标题同样在左侧，仅用于确认文字没被裁
                return { ruleY, titleBottom, gapPx: ruleY - titleBottom, w: width, h: height, ruleLen };
            }""",
            b64,
        )
        check("PNG 刊头分隔线存在", geo["ruleY"] > 0 and geo["ruleLen"] > geo["w"] * 0.5, str(geo))
        check("标题与下划线留有间距（≥8 逻辑像素）", geo["gapPx"] >= 16, f"gap={geo['gapPx']}px @2x")
        check("PNG 无页脚统计行", geo["h"] < 1150, f"h={geo['h']}")

        check("无 JS 报错", not errors, "; ".join(errors[:3]))
        browser.close()

    print()
    if failures:
        print("FAILED: " + ", ".join(failures))
        raise SystemExit(1)
    print("FONTS OK")


if __name__ == "__main__":
    main()
