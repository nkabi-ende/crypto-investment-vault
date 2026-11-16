"""Generate raster Open Graph and favicon assets for social crawlers and browsers."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
P=Path(__file__).resolve().parents[1]/"public"
def font(size,bold=False):
    path="/usr/share/fonts/truetype/dejavu/DejaVuSans"+("-Bold" if bold else "")+".ttf"
    return ImageFont.truetype(path,size)
def draw_mark(image, x, y, width, color=(241,246,241), accent=(181,242,105)):
    scale=width/150
    pen=ImageDraw.Draw(image)
    def pt(p):return (x+p[0]*scale,y+p[1]*scale)
    stroke=max(1,round(7*scale))
    def line(points):
        # Fill a continuous stroke outline; overlapping raster segments can leave seams.
        pixel=[pt(p) for p in points];left=[];right=[];r=3.5*scale
        for i,(a,b) in enumerate(pixel):
            before=pixel[max(0,i-1)];after=pixel[min(len(pixel)-1,i+1)]
            dx,dy=after[0]-before[0],after[1]-before[1];length=max(.00001,(dx*dx+dy*dy)**.5)
            nx,ny=-dy/length*r,dx/length*r
            left.append((a+nx,b+ny));right.append((a-nx,b-ny))
        pen.polygon(left+right[::-1],fill=color)
        r=3.5*scale
        for p in (points[0],points[-1]):
            a,b=pt(p);pen.ellipse((a-r,b-r,a+r,b+r),fill=color)
    segments=[((45,18),(40,12),(34,10),(26,10)),((26,10),(12,10),(5,20),(5,33)),((5,33),(5,46),(12,56),(26,56)),((26,56),(34,56),(40,53),(45,47))]
    curve=[]
    for a,b,c,d in segments:
        for i in range(31):
            t=i/30;u=1-t
            curve.append((u**3*a[0]+3*u*u*t*b[0]+3*u*t*t*c[0]+t**3*d[0],u**3*a[1]+3*u*u*t*b[1]+3*u*t*t*c[1]+t**3*d[1]))
    line(curve);line([(69,28),(69,55)]);line([(91,13),(114,55),(140,13)])
    a,b=pt((114,55));r=3.5*scale;pen.ellipse((a-r,b-r,a+r,b+r),fill=color)
    a,b=pt((69,12));r=5.5*scale;pen.ellipse((a-r,b-r,a+r,b+r),fill=accent)

# Exact brand typography and geometry; versioned URL avoids stale social previews.
import math
im=Image.new("RGB",(1200,630),(10,17,15))
d=ImageDraw.Draw(im)
for r in range(700,0,-4):
    t=1-r/700
    col=(int(10+9*t),int(17+20*t),int(15+5*t))
    d.ellipse((1050-r,280-r,1050+r,280+r),fill=col)
d.rounded_rectangle((48,44,1152,586),radius=25,outline=(49,66,53),width=1)
draw_mark(im,82,68,98)
d.text((205,83),"CRYPTO INVESTMENT VAULT",font=font(15,True),fill=(194,210,198))
d.text((83,192),"THE BIG 7 / YOUR INVITATION",font=font(15,True),fill=(181,242,105))
d.text((77,239),"Seven assets.",font=font(65,True),fill=(242,247,243))
d.text((77,313),"Your own vault.",font=font(65,True),fill=(181,242,105))
d.text((83,410),"A clearer view of crypto starts here.",font=font(22),fill=(172,192,178))
d.rounded_rectangle((82,484,398,539),radius=13,fill=(181,242,105))
d.text((105,501),"CREATE YOUR ACCOUNT  →",font=font(16,True),fill=(12,26,16))
# An asset orbit, not a chart or a claim about performance.
cx,cy=942,304
for r in (93,151): d.ellipse((cx-r,cy-r,cx+r,cy+r),outline=(59,82,57),width=1)
d.rounded_rectangle((cx-54,cy-37,cx+54,cy+37),radius=18,fill=(15,28,20),outline=(82,116,70),width=1)
draw_mark(im,cx-35,cy-15,70)
for i,label in enumerate(("BTC","ETH","SOL","XRP","BNB","ADA","DOGE")):
    angle=-math.pi/2+i*2*math.pi/7
    x,y=cx+151*math.cos(angle),cy+151*math.sin(angle)
    d.ellipse((x-31,y-31,x+31,y+31),fill=(19,31,23),outline=(83,110,73),width=1)
    f=font(13,True);box=d.textbbox((0,0),label,font=f)
    d.text((x-(box[2]-box[0])/2,y-8),label,font=f,fill=(207,227,198))
d.text((710,529),"YOUR ACCOUNT. YOUR PERSPECTIVE.",font=font(13,True),fill=(157,180,159))
im.save(P/"og-invitation-v1.png",optimize=True)
im.save(P/"og-invitation-v2.png",optimize=True)
im.save(P/"og-image.png",optimize=True)
for size in (32,180,192,512):
    # Supersample the same geometric mark for crisp 32px browser icons.
    large=max(640,size*3)
    icon=Image.new("RGB",(large,large),(11,16,17))
    draw_mark(icon,large*.075,large*.305,large*.85)
    icon=icon.resize((size,size),Image.Resampling.LANCZOS)
    icon.save(P/("favicon-32.png" if size==32 else "apple-touch-icon.png" if size==180 else f"icon-{size}.png"),optimize=True)
print("Generated social image and favicon PNGs")
