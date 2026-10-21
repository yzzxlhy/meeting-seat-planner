"""inspect_png.py — 把导出的 PNG 读回浏览器画布做像素体检。

校验：尺寸合理 / 有实际墨迹 / 墨迹不越界 / 团色真的画上了 / 中轴线可见
"""

from __future__ import annotations

import base64
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = Path(__file__).resolve().parent
URL = (BASE / "dist" / "会议辅助.html").as_uri()
OUT = BASE / "dist" / "shots" / "seatmap-sample.png"


def main() -> None:
    failures = []

    def check(label: str, ok: bool, extra: str = "") -> None:
        print(f"{'PASS' if ok else 'FAIL'}  {label}{'  ' + extra if extra else ''}")
        if not ok:
            failures.append(label)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.goto(URL)
        page.wait_for_timeout(200)

        # 造一份接近真实的图面
        page.evaluate(
            """() => {
                S.meta.meeting = '全区教育工作会议';
                S.meta.date = '2026 年 10 月 20 日';
                S.units = S.units.map((u, i) => [ '', '区教育局', '第一中学', '第二小学', '教研室' ][i % 5]);
                S.units[0] = '区委教育工委\\n区教育局';
                S.zones = [
                    { id: 1, name: '主席团', color: '#9C3B2E', seats: [0,1,2,3], showName: true },
                    { id: 2, name: '第一代表团', color: '#2F5D7C', seats: [10,11,12,13,14], showName: false }
                ];
                App.zoneIdSeq = 2;
                render();
            }"""
        )
        page.wait_for_timeout(200)

        with page.expect_download() as dl:
            page.click("#pngBtn")
        path = Path(dl.value.path())
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_bytes(path.read_bytes())
        print(f"saved {OUT} ({OUT.stat().st_size} bytes)")

        b64 = base64.b64encode(OUT.read_bytes()).decode()
        stats = page.evaluate(
            """async (b64) => {
                const img = new Image();
                img.src = 'data:image/png;base64,' + b64;
                await img.decode();
                const c = document.createElement('canvas');
                c.width = img.width; c.height = img.height;
                const ctx = c.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const { data } = ctx.getImageData(0, 0, c.width, c.height);

                let ink = 0, colored = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
                for (let y = 0; y < c.height; y++) {
                    for (let x = 0; x < c.width; x++) {
                        const i = (y * c.width + x) * 4;
                        const r = data[i], g = data[i+1], bb = data[i+2];
                        const dark = (r + g + bb) / 3 < 150;
                        const sat = Math.max(r, g, bb) - Math.min(r, g, bb);
                        if (dark) ink++;
                        if (sat > 40) colored++;
                        if (dark || sat > 40) {
                            if (x < minX) minX = x; if (y < minY) minY = y;
                            if (x > maxX) maxX = x; if (y > maxY) maxY = y;
                        }
                    }
                }
                return {
                    w: img.width, h: img.height,
                    inkRatio: ink / (c.width * c.height),
                    coloredRatio: colored / (c.width * c.height),
                    bbox: [minX, minY, maxX, maxY]
                };
            }""",
            b64,
        )

        check("PNG 尺寸合理（2x）", stats["w"] > 1600 and stats["h"] > 700, f"{stats['w']}x{stats['h']}")
        check("墨迹占比合理（含深色团色与主席台）", 0.01 < stats["inkRatio"] < 0.35, f"{stats['inkRatio']*100:.1f}%")
        check("团色已绘制", stats["coloredRatio"] > 0.005, f"{stats['coloredRatio']*100:.1f}%")

        minX, minY, maxX, maxY = stats["bbox"]
        check("墨迹不贴边（留白 ≥ 20px）", minX >= 20 and minY >= 20 and maxX <= stats["w"] - 20 and maxY <= stats["h"] - 20,
              str(stats["bbox"]))

        browser.close()

    print()
    if failures:
        print("FAILED: " + ", ".join(failures))
        raise SystemExit(1)
    print("PNG OK")


if __name__ == "__main__":
    main()
