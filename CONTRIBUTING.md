# 参与改进

这是一个小工具，欢迎提 Issue / PR。保持简单是底线：**能不加依赖就不加，能少一个文件就少一个文件。**

## 本地开发

```bash
python build.py            # 改完 src/ 必须重新打包
python test_ui.py          # 至少跑这一项
```

依赖只用于测试：

```bash
pip install -r requirements-dev.txt
python -m playwright install chromium
```

## 约定

- **分层不越界**：`state.js` 不碰 DOM，`view.js` 不改 state，`main.js` 只做事件与副作用。
- **单一模型**：任何要同时出现在屏幕和 PNG 里的内容，都从 `seatModel()` 出，禁止各算一套。
- **无外部资源**：不引入 CDN、字体文件、图标库、构建工具；产物必须是单文件。
- **常量集中**：几何、字号上下限、行数上限、存储键都在 `state.js` 顶部，不写魔法值。
- **代码风格**：PEP 8（Python）、2 空格缩进（JS/CSS/HTML）、UTF-8 无 BOM、LF 换行。
- **提交信息**：一句话说清「改了什么 + 为什么」，中英文均可。

## 提交前自检

```bash
python build.py
python test_ui.py && python test_features.py && python test_migration.py && python test_fonts.py
python audit_layout.py && python check_contrast.py && python inspect_png.py
```

如果改动涉及版面或颜色，请附一张 `docs/screenshots/export-png.png` 的前后对比。
