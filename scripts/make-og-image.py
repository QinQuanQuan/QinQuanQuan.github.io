"""生成站点的社交分享图 public/og-image.png (1200x630)。"""

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BG = (248, 245, 240)
FG = (28, 27, 26)
MUTED = (110, 106, 100)
ACCENT = (62, 110, 92)

FONT = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# 顶部强调色块
d.rectangle([0, 0, W, 10], fill=ACCENT)

f_title = ImageFont.truetype(FONT, 76)
f_sub = ImageFont.truetype(FONT, 34)
f_url = ImageFont.truetype(FONT, 30)

d.text((90, 180), "QinQuanQuan 的数字花园", font=f_title, fill=FG)
d.text((90, 300), "个人数字花园 · 笔记、项目与随想", font=f_sub, fill=MUTED)

# 分隔线
d.line([(90, 390), (1110, 390)], fill=(210, 203, 194), width=2)

d.text((90, 430), "https://qinquanquan.com", font=f_url, fill=ACCENT)

img.save("public/og-image.png", "PNG", optimize=True)
print("saved public/og-image.png")
