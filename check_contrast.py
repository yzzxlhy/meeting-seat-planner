"""check_contrast.py — 对比度体检：直接读产物页面里的真实令牌，而不是抄一份常量。

阈值：正文 4.5:1，大字/图形 3:1（WCAG 2.1 AA）。
"""

from __future__ import annotations

from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = Path(__file__).resolve().parent
URL = (BASE / "dist" / "会议辅助.html").as_uri()


def srgb(c: int) -> float:
    v = c / 255
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def luminance(hex_color: str) -> float:
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)


def ratio(a: str, b: str) -> float:
    la, lb = luminance(a), luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(URL)
        page.wait_for_timeout(150)
        tokens = page.evaluate(
            """() => {
                const cs = getComputedStyle(document.documentElement);
                const v = (n) => cs.getPropertyValue(n).trim();
                return {
                    paper: v('--paper'), raised: v('--paper-raised'), sunken: v('--paper-sunken'),
                    ink: v('--ink'), soft: v('--ink-soft'), muted: v('--muted'),
                    accent: v('--accent'), rule: v('--rule'), ruleStrong: v('--rule-strong'),
                    stage: v('--stage'), stageInk: v('--stage-ink'),
                    zones: PALETTE.zones,
                    zoneInks: PALETTE.zones.map((z) => contrastInk(z))
                };
            }"""
        )
        browser.close()

    cases = [
        ("正文 ink / paper", tokens["ink"], tokens["paper"], 4.5),
        ("正文 ink / raised", tokens["ink"], tokens["raised"], 4.5),
        ("次要 ink-soft / paper", tokens["soft"], tokens["paper"], 4.5),
        ("注脚 muted / paper", tokens["muted"], tokens["paper"], 4.5),
        ("注脚 muted / raised", tokens["muted"], tokens["raised"], 4.5),
        ("表头 muted / sunken", tokens["muted"], tokens["sunken"], 4.5),
        ("强调 accent / paper", tokens["accent"], tokens["paper"], 4.5),
        ("白字 / accent", "#FFFFFF", tokens["accent"], 4.5),
        ("主席台字 / stage", tokens["stageInk"], tokens["stage"], 4.5),
        ("输入框描边 rule-strong / raised（图形）", tokens["ruleStrong"], tokens["raised"], 3.0),
    ]
    for color, ink in zip(tokens["zones"], tokens["zoneInks"]):
        cases.append((f"团名 {ink} / {color}", ink, color, 4.5))

    bad = []
    for label, fg, bg, need in cases:
        value = ratio(fg, bg)
        ok = value >= need
        print(f"{'PASS' if ok else 'FAIL'}  {value:5.2f}:1  ≥{need}  {label}")
        if not ok:
            bad.append(label)

    print()
    if bad:
        print("不足：", ", ".join(bad))
        raise SystemExit(1)
    print("CONTRAST OK")


if __name__ == "__main__":
    main()
