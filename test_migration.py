"""test_migration.py — 旧版存档（seating-tool-state-v28）能否无损迁入。

旧版字段：people / seatSlots / seatUnits / absentSeats / rowSeats / aisles /
          peopleText / namesOnly / zones / zoneIdCounter / *FontOffset
"""

from __future__ import annotations

import json
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = Path(__file__).resolve().parent
URL = (BASE / "dist" / "会议辅助.html").as_uri()

LEGACY = {
    "people": ["张三", "李四", "王五"],
    "seatSlots": [0, 1, None, 2] + [None] * 4,
    "seatUnits": ["区教育局", "", "", "办公室"],
    "absentSeats": [],
    "rowSeats": "8",
    "aisles": "4",
    "peopleText": "张三\n李四\n王五",
    "namesOnly": False,
    "zones": [{"id": 3, "name": "第一代表团", "color": "#9C3B2E", "seats": [0, 1], "showName": True}],
    "zoneIdCounter": 3,
    "zoneNameFontOffset": 2,
    "unitFontOffset": -1,
    "seatNameFontOffset": 1,
}


def main() -> None:
    failures = []

    def check(label: str, ok: bool, extra: str = "") -> None:
        print(f"{'PASS' if ok else 'FAIL'}  {label}{'  ' + extra if extra else ''}")
        if not ok:
            failures.append(label)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        # 先打开一次，拿到同源环境后写入旧键
        page.goto(URL)
        page.evaluate(
            "payload => localStorage.setItem('seating-tool-state-v28', payload)",
            json.dumps(LEGACY, ensure_ascii=False),
        )
        page.reload()
        page.wait_for_timeout(300)

        check("旧版排数迁入", page.evaluate("S.layout.rows.join(',')") == "8")
        check("旧版过道迁入", page.evaluate("S.layout.aisles.join(',')") == "4")
        check("旧版人员迁入", page.evaluate("S.people.length") == 3)
        check("旧版单位迁入", page.evaluate("S.units[0]") == "区教育局")
        check("旧版团体迁入", page.locator(".seat--zone").count() == 2)
        check("旧版字号偏移迁入", page.evaluate("S.font.zone") == 2 and page.evaluate("S.font.unit") == -1)
        check("座位图渲染 8 席", page.locator(".seat[data-seat]").count() == 8)
        check("无 JS 报错", not errors, "; ".join(errors[:2]))

        browser.close()

    print()
    if failures:
        print("FAILED: " + ", ".join(failures))
        raise SystemExit(1)
    print("MIGRATION OK")


if __name__ == "__main__":
    main()
