"""build.py — 把 src/ 下的分片源文件内联成单文件 HTML。

用法：
    python build.py

产物：
    dist/会议辅助.html   —— 可直接双击打开，无外部依赖、无网络请求
    docs/index.html      —— 同一份产物，供 GitHub Pages 在线试用（目录存在时自动写入）
"""

from __future__ import annotations

from pathlib import Path

BASE = Path(__file__).resolve().parent
SRC = BASE / "src"
DIST = BASE / "dist"
PAGES = BASE / "docs"

JS_PARTS = ("state.js", "scenes.js", "view.js", "main.js")
CSS_PART = "styles.css"
HTML_PART = "index.html"
OUTPUT_NAME = "会议辅助.html"

CSS_TOKEN = "/*__CSS__*/"
JS_TOKEN = "/*__JS__*/"


def read(name: str) -> str:
    """读取源文件：吞掉可能的 BOM（PowerShell 写入会带 BOM，会破坏 CSS 首条规则），统一为 LF。"""
    text = (SRC / name).read_text(encoding="utf-8-sig")
    return text.replace("\r\n", "\n").lstrip("\ufeff")


def build() -> Path:
    html = read(HTML_PART)
    css = read(CSS_PART)
    js = "\n\n".join(read(name) for name in JS_PARTS)

    if CSS_TOKEN not in html or JS_TOKEN not in html:
        raise SystemExit("模板缺少占位符 /*__CSS__*/ 或 /*__JS__*/")

    # 防御：源码里若出现 </script> 会提前闭合脚本块
    if "</script>" in js:
        raise SystemExit("JS 源码中出现 </script>，请改写后再打包")

    output = html.replace(CSS_TOKEN, css).replace(JS_TOKEN, js)

    DIST.mkdir(exist_ok=True)
    target = DIST / OUTPUT_NAME
    target.write_text(output, encoding="utf-8", newline="\n")

    size_kb = target.stat().st_size / 1024
    print(f"built: {target}  ({size_kb:.1f} KB)")
    print(f"  css {len(css.splitlines())} 行 / js {len(js.splitlines())} 行")

    # GitHub Pages：docs/ 目录存在时同步一份，Pages 源设成 /docs 即可在线试用
    if PAGES.is_dir():
        pages_target = PAGES / "index.html"
        pages_target.write_text(output, encoding="utf-8", newline="\n")
        print(f"pages: {pages_target}")

    return target


if __name__ == "__main__":
    build()
