"""audit_layout.py — 不靠肉眼：用几何与像素指标校验排版是否真的站得住。

检查：座位内容溢出 / 团名超宽 / 中轴线对位 / 主席台对位 / 令牌生效 /
      字号层级 / 极端内容（3 行团名 + 3 行单位 + 长姓名）/ 视口溢出
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


def js(page, expr):
    return page.evaluate(expr)


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.goto(URL)
        page.wait_for_timeout(300)

        # ---------- 令牌与字层级 ----------
        tokens = js(page, """() => {
            const cs = getComputedStyle(document.documentElement);
            const body = getComputedStyle(document.body);
            const h1 = getComputedStyle(document.querySelector('.masthead h1'));
            return {
                paper: cs.getPropertyValue('--paper').trim(),
                ink: cs.getPropertyValue('--ink').trim(),
                accent: cs.getPropertyValue('--accent').trim(),
                bodyFont: body.fontFamily,
                bodyBg: body.backgroundColor,
                h1Font: h1.fontFamily,
                h1Size: parseFloat(h1.fontSize),
                seatVar: cs.getPropertyValue('--seat-w').trim()
            };
        }""")
        check("令牌注入 --paper", tokens["paper"] == "#F4F1EA", tokens["paper"])
        check("纸面底色生效", tokens["bodyBg"] == "rgb(244, 241, 234)", tokens["bodyBg"])
        check("标题使用宋体族", "Songti" in tokens["h1Font"] or "SimSun" in tokens["h1Font"], tokens["h1Font"][:48])
        check("座位宽度变量同步", tokens["seatVar"] == "78px", tokens["seatVar"])

        # ---------- 座位内容不溢出 ----------
        overflow = js(page, """() => {
            return Array.from(document.querySelectorAll('.seat')).map(el => ({
                i: el.dataset.seat,
                sh: el.scrollHeight, ch: el.clientHeight,
                sw: el.scrollWidth, cw: el.clientWidth
            })).filter(r => r.sh > r.ch + 1 || r.sw > r.cw + 1);
        }""")
        check("常规内容无溢出", len(overflow) == 0, str(overflow[:4]))

        # ---------- 中轴线对位（奇数排 / 偶数排） ----------
        axis_math = js(page, """() => {
            const rows = Array.from(document.querySelectorAll('.row'));
            const out = [];
            for (const row of rows) {
                const seats = Array.from(row.querySelectorAll('.seat[data-seat]'));
                const rowIdx = Number(row.dataset.row);
                const first = seats[0], last = seats[seats.length - 1];
                const centerOfRow = (first.offsetLeft + last.offsetLeft + last.offsetWidth) / 2;
                out.push({
                    rowIdx,
                    center: centerOfRow,
                    seat1: seats[0].offsetLeft + seats[0].offsetWidth / 2
                });
            }
            const axis = parseFloat(document.getElementById('axis').style.left);
            const stage = document.getElementById('stage');
            const seats0 = Array.from(rows[0].querySelectorAll('.seat[data-seat]'));
            const span = seats0[seats0.length - 1].offsetLeft + seats0[seats0.length - 1].offsetWidth - seats0[0].offsetLeft;
            return {
                axis,
                rowCenters: out,
                stageLeft: parseFloat(stage.style.marginLeft),
                stageWidth: parseFloat(stage.style.width),
                firstRowSpan: span
            };
        }""")
        # 偶数排：中轴在 1、2 号之间 = 该排的几何中心
        check(
            "偶数排中轴落在排中心",
            abs(axis_math["axis"] - axis_math["rowCenters"][0]["center"]) <= 1.5,
            f"axis={axis_math['axis']:.1f} center={axis_math['rowCenters'][0]['center']:.1f}",
        )
        check(
            "主席台与首排跨度一致",
            abs(axis_math["stageWidth"] - axis_math["firstRowSpan"]) <= 1.5,
            f"{axis_math['stageWidth']:.0f} vs {axis_math['firstRowSpan']:.0f}",
        )

        # ---------- 极端内容压力测试 ----------
        js(page, """() => {
            S.font.zone = 4; S.font.unit = 4; S.font.name = 4;
            S.units[0] = '某某省某某市某某区\\n教育局基础教育科\\n第三办公室';
            S.people[0] = '欧阳司徒长风';
            S.zones = [{ id: 1, name: '第一代表团\\n教育系统\\n正式代表', color: '#9C3B2E', seats: [2, 3, 4], showName: true }];
            S.units[2] = '区教育局\\n办公室';
            render();
        }""")
        page.wait_for_timeout(200)

        stress = js(page, """() => {
            const bad = [];
            document.querySelectorAll('.seat').forEach(el => {
                if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) {
                    bad.push({ i: el.dataset.seat, sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth });
                }
            });
            const zoneSpans = Array.from(document.querySelectorAll('.seat--zone .zone-name span')).map(s => ({
                w: s.scrollWidth, cw: s.clientWidth + 2
            }));
            return { bad, zoneSpans };
        }""")
        check("正文字号 +4 后仍不溢出", len(stress["bad"]) == 0, str(stress["bad"][:3]))
        clipped = js(page, """() => Array.from(document.querySelectorAll('.zone-name > span'))
            .map(s => getComputedStyle(s).overflowX)
            .every(v => v === 'hidden' || v === 'clip')""")
        check("团名超宽时优雅截断（overflow:hidden）", clipped, "")

        # ---------- 奇数排：加一排 9 座 ----------
        js(page, """() => {
            document.getElementById('rowSeats').value = '9,8';
            commitLayout();
        }""")
        page.wait_for_timeout(250)
        odd = js(page, """() => {
            const rows = Array.from(document.querySelectorAll('.row'));
            const axis = parseFloat(document.getElementById('axis').style.left);
            // 奇数排：1 号（data-seat="0"）居中，中轴 = 它的中心
            const s1 = rows[0].querySelector('.seat[data-seat="0"]');
            const center = s1.offsetLeft + s1.offsetWidth / 2;
            return { axis, center, diff: Math.abs(axis - center) };
        }""")
        check("奇数排中轴对准 1 号座位", odd["diff"] <= 1.5, f"axis={odd['axis']:.1f} center={odd['center']:.1f}")

        # ---------- 移动端：只有图面内部横向滚动 ----------
        page.set_viewport_size({"width": 375, "height": 900})
        page.wait_for_timeout(250)
        mobile = js(page, """() => {
            const doc = document.documentElement;
            const hall = document.querySelector('.hall');
            return {
                docOverflow: doc.scrollWidth - doc.clientWidth,
                hallScrollable: hall.scrollWidth > hall.clientWidth,
                htmlOverflowX: getComputedStyle(doc).overflowX,
                seatW: document.querySelector('.seat').getBoundingClientRect().width,
                stageFont: parseFloat(getComputedStyle(document.getElementById('stage')).fontSize)
            };
        }""")
        check("移动端整页无横向溢出", mobile["docOverflow"] <= 1, f"{mobile['docOverflow']}")
        check("图面容器内部可滚动", mobile["hallScrollable"], str(mobile["hallScrollable"]))
        check("根节点 overflow-x: clip", mobile["htmlOverflowX"] in ("clip", "hidden"), mobile["htmlOverflowX"])
        check("座位尺寸未被压缩（导出可预期）", abs(mobile["seatW"] - 78) < 0.5, f"{mobile['seatW']:.1f}px")

        browser.close()

    print()
    if failures:
        print(f"FAILED {len(failures)}: " + ", ".join(failures))
        raise SystemExit(1)
    print("LAYOUT OK")


if __name__ == "__main__":
    main()
