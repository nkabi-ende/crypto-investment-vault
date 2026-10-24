"""Generate raster Open Graph and favicon assets for social crawlers and browsers."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
P=Path(__file__).resolve().parents[1]/"public"
def font(size,bold=False):
    path="/usr/share/fonts/truetype/dejavu/DejaVuSans"+("-Bold" if bold else "")+".ttf"
    return ImageFont.truetype(path,size)
im=Image.new("RGB",(1200,630),(9,17,14))
d=ImageDraw.Draw(im)
for x in range(0,1200,100): d.line((x,0,x,630),fill=(25,43,32),width=1)
for y in range(0,630,100): d.line((0,y,1200,y),fill=(25,43,32),width=1)
points=[(650,458),(720,427),(780,444),(850,345),(915,365),(985,240),(1040,262),(1130,120)]
d.line(points,fill=(181,242,105),width=9,joint="curve")
for x,y in points: d.ellipse((x-5,y-5,x+5,y+5),fill=(181,242,105))
d.rounded_rectangle((70,65,140,135),radius=17,fill=(181,242,105))
d.text((88,74),"C",font=font(49,True),fill=(13,29,19))
d.text((161,72),"CIV",font=font(43,True),fill=(246,249,247))
d.text((70,210),"CRYPTO INVESTMENT VAULT",font=font(20,True),fill=(181,242,105))
d.text((68,272),"The Big 7.",font=font(55,True),fill=(244,248,244))
d.text((68,342),"One market perspective.",font=font(45,True),fill=(244,248,244))
d.text((70,426),"BTC  ·  ETH  ·  SOL  ·  XRP  ·  BNB  ·  ADA  ·  DOGE",font=font(21),fill=(175,192,177))
d.text((70,551),"DURBAN  ·  SOUTH AFRICA",font=font(20,True),fill=(181,242,105))
im.save(P/"og-image.png",optimize=True)
for size in (32,180,192,512):
    icon=Image.new("RGB",(size,size),(11,16,17));draw=ImageDraw.Draw(icon)
    draw.rounded_rectangle((1,1,size-2,size-2),radius=max(3,size//5),fill=(11,16,17))
    draw.arc((size*.17,size*.17,size*.78,size*.83),60,300,fill=(181,242,105),width=max(2,size//10))
    for i,h in enumerate((.20,.32,.47)):
        x=size*(.43+i*.14)
        draw.rounded_rectangle((int(x),int(size*(.76-h)),int(x+size*.075),int(size*.76)),radius=max(1,size//60),fill=(245,249,245))
    icon.save(P/("favicon-32.png" if size==32 else "apple-touch-icon.png" if size==180 else f"icon-{size}.png"),optimize=True)
print("Generated social image and favicon PNGs")
