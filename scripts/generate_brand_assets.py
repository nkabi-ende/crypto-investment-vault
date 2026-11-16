"""Generate raster Open Graph and favicon assets for social crawlers and browsers."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
P=Path(__file__).resolve().parents[1]/"public"
def font(size,bold=False):
    path="/usr/share/fonts/truetype/dejavu/DejaVuSans"+("-Bold" if bold else "")+".ttf"
    return ImageFont.truetype(path,size)
# Exact brand typography and geometry; versioned URL avoids stale social previews.
import math
im=Image.new("RGB",(1200,630),(10,17,15))
d=ImageDraw.Draw(im)
for r in range(700,0,-4):
    t=1-r/700
    col=(int(10+9*t),int(17+20*t),int(15+5*t))
    d.ellipse((1050-r,280-r,1050+r,280+r),fill=col)
d.rounded_rectangle((48,44,1152,586),radius=25,outline=(49,66,53),width=1)
d.text((82,69),"CIV",font=font(38,True),fill=(181,242,105))
d.text((184,83),"CRYPTO INVESTMENT VAULT",font=font(15,True),fill=(194,210,198))
d.text((83,192),"THE BIG 7 / YOUR INVITATION",font=font(15,True),fill=(181,242,105))
d.text((77,239),"Seven assets.",font=font(65,True),fill=(242,247,243))
d.text((77,313),"Your own vault.",font=font(65,True),fill=(181,242,105))
d.text((83,410),"A clearer view of crypto starts here.",font=font(22),fill=(172,192,178))
d.rounded_rectangle((82,484,398,539),radius=13,fill=(181,242,105))
d.text((105,501),"CREATE YOUR ACCOUNT  →",font=font(16,True),fill=(12,26,16))
# An asset orbit, not a chart or a claim about performance.
cx,cy=942,304
for r in (93,151): d.ellipse((cx-r,cy-r,cx+r,cy+r),outline=(59,82,57),width=1)
d.ellipse((cx-49,cy-49,cx+49,cy+49),fill=(181,242,105))
d.text((cx-31,cy-15),"CIV",font=font(25,True),fill=(14,29,17))
for i,label in enumerate(("BTC","ETH","SOL","XRP","BNB","ADA","DOGE")):
    angle=-math.pi/2+i*2*math.pi/7
    x,y=cx+151*math.cos(angle),cy+151*math.sin(angle)
    d.ellipse((x-31,y-31,x+31,y+31),fill=(19,31,23),outline=(83,110,73),width=1)
    f=font(13,True);box=d.textbbox((0,0),label,font=f)
    d.text((x-(box[2]-box[0])/2,y-8),label,font=f,fill=(207,227,198))
d.text((780,529),"BUILT IN SOUTH AFRICA",font=font(13,True),fill=(157,180,159))
im.save(P/"og-invitation-v1.png",optimize=True)
im.save(P/"og-image.png",optimize=True)
for size in (32,180,192,512):
    icon=Image.new("RGB",(size,size),(11,16,17));draw=ImageDraw.Draw(icon)
    draw.rounded_rectangle((1,1,size-2,size-2),radius=max(3,size//5),fill=(11,16,17))
    # Match the browser SVG favicon: prominent CIV letters in lime on charcoal.
    text_font=font(max(12,int(size*.37)),True)
    label="CIV"
    bb=draw.textbbox((0,0),label,font=text_font,stroke_width=0)
    tw=bb[2]-bb[0];th=bb[3]-bb[1]
    draw.text(((size-tw)/2-bb[0],(size-th)/2-bb[1]-size*.025),label,font=text_font,fill=(181,242,105))
    draw.rounded_rectangle((int(size*.20),int(size*.76),int(size*.80),int(size*.80)),radius=max(1,size//80),fill=(181,242,105))
    icon.save(P/("favicon-32.png" if size==32 else "apple-touch-icon.png" if size==180 else f"icon-{size}.png"),optimize=True)
print("Generated social image and favicon PNGs")
