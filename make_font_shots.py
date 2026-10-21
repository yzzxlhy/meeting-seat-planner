"""make_font_shots.py — 四种字体搭配各出一张席位图对比图。"""

from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = Path(__file__).resolve().parent
URL = (BASE / "dist" / "会议辅助.html").as_uri()
SHOTS = BASE / "dist" / "shots"

SETUP = """() => {
    S.people = ['周建国','李慧敏','王振华','赵晓东','钱文博','孙丽娟','吴海涛','郑晓峰',
                '陈立群','刘雅静','黄志强','马晓雯','徐国庆','胡明月','朱建华','高志远',
                '林海燕','何晓东','郭文军','罗秀英'];
    S.seats = S.people.map((_, i) => i);
    S.units = S.units.map((u, i) => ['区委教育工委\\n区教育局','区教育局','第一中学','第二小学','教研室','督导室'][i % 6]);
    S.meta.meeting = '全区教育工作会议';
    S.meta.date = '2026 年 10 月 20 日';
    S.zones = [
        { id: 1, name: '主席团', color: '#9C3B2E', seats: [0,1,2,3,4], showName: true },
        { id: 2, name: '第一代表团', color: '#2F5D7C', seats: [10,11,12,13,14], showName: true },
        { id: 3, name: '第二代表团', color: '#3F6B4F', seats: [15,16,17,18,19], showName: false }
    ];
    App.zoneIdSeq = 3;
    S.layout.aisles = [5];
    render();
}"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1600, "height": 1200}, device_scale_factor=2)
    page.goto(URL)
    page.wait_for_timeout(250)
    page.evaluate(SETUP)
    page.wait_for_timeout(300)

    for preset in ("gongwen", "song", "hei", "kai"):
        page.select_option("#fontPreset", preset)
        page.wait_for_timeout(300)
        page.locator(".hall").screenshot(path=str(SHOTS / f"font-{preset}.png"))
        print("shot", preset)

    page.select_option("#fontPreset", "gongwen")
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "final-desktop.png"))
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "final-mobile.png"), full_page=True)

    browser.close()

print("done ->", SHOTS)
