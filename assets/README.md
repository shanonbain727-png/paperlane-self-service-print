# PDF 中文字体

`NotoSansSC.ttf` 来源于 Google Fonts 官方 Noto Sans SC，可变字体源文件：
https://github.com/google/fonts/blob/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf

使用 fontTools 转为 400 字重静态 TrueType，并移除 GSUB 替换表，避免 PDF 自定义字体映射把比例数字映射到错误 Unicode。字形保持原样；许可证为 SIL Open Font License 1.1，见 `OFL.txt`。应用以完整字体嵌入 PDF，避免特定中文字体子集在不同阅读器中丢失字形。

转换命令（源字体下载至 `.tools/NotoSansSC-variable.ttf` 后）：

```python
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
font = TTFont('.tools/NotoSansSC-variable.ttf')
instantiateVariableFont(font, {'wght': 400}, inplace=True)
if 'GSUB' in font:
    del font['GSUB']
font.save('assets/NotoSansSC.ttf')
```

这个文件只供服务端嵌入 PDF，前端不下载整套字体。
