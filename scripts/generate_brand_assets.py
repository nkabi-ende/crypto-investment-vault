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

# True seven-asset icon artwork is checked into the repository as CC0 SVGs.
# We convert SVG at build time rather than inventing token glyphs or fetching from a CDN.
import io
import cairosvg
assets=("btc","eth","sol","xrp","bnb","ada","doge")
def crypto_icon(symbol,size):
    svg=P/"assets"/"coins"/f"{symbol}.svg"
    assert svg.exists(),f"Missing verified SVG: {svg}"
    png=cairosvg.svg2png(bytestring=svg.read_bytes(),output_width=size*2,output_height=size*2)
    return Image.open(io.BytesIO(png)).convert("RGBA").resize((size,size),Image.Resampling.LANCZOS)
def rounded_text(draw,xy,message,size,fill,bold=False):
    draw.text(xy,message,font=font(size,bold),fill=fill)
def build_og(invitation=False):
    image=Image.new("RGB",(1200,630),(10,17,15))
    d=ImageDraw.Draw(image)
    for radius in range(730,0,-6):
        t=1-radius/730
        c=(int(10+9*t),int(17+20*t),int(15+8*t))
        d.ellipse((1020-radius,310-radius,1020+radius,310+radius),fill=c)
    d.rounded_rectangle((39,38,1161,592),radius=28,outline=(48,77,54),width=2)
    d.ellipse((809,132,1127,450),outline=(63,119,59),width=2)
    d.ellipse((772,92,1164,489),outline=(44,85,56),width=2)
    draw_mark(image,75,73,110)
    rounded_text(d,(200,88),"CRYPTO INVESTMENT",18,(216,227,215),True)
    rounded_text(d,(200,117),"VAULT",17,(181,242,105),True)
    rounded_text(d,(77,201),"THE BIG 7 / CRYPTO INVESTMENT VAULT",15,(181,242,105),True)
    if invitation:
        rounded_text(d,(70,249),"Your invitation.",59,(245,248,244),True)
        rounded_text(d,(70,326),"Seven assets.",59,(181,242,105),True)
        rounded_text(d,(76,418),"Join CIV. Explore the crypto markets.",21,(180,201,181))
    else:
        rounded_text(d,(70,249),"Seven assets.",62,(245,248,244),True)
        rounded_text(d,(70,327),"One perspective.",58,(181,242,105),True)
        rounded_text(d,(76,419),"Explore markets. Understand risk.",22,(180,201,181))
    d.rounded_rectangle((76,496,346,555),radius=18,fill=(181,242,105))
    rounded_text(d,(100,515),"EXPLORE CIV",19,(13,29,18),True)
    cx,cy=970,294
    d.ellipse((cx-63,cy-63,cx+63,cy+63),fill=(21,47,27),outline=(140,213,102),width=3)
    draw_mark(image,cx-35,cy-14,70)
    positions=[(cx-18,cy-183),(cx+122,cy-137),(cx+180,cy+15),(cx+95,cy+158),(cx-67,cy+176),(cx-176,cy+60),(cx-152,cy-108)]
    for symbol,(x,y) in zip(assets,positions):
        radius=41
        d.ellipse((x-radius-6,y-radius-6,x+radius+6,y+radius+6),fill=(9,17,14),outline=(57,86,61),width=2)
        icon=crypto_icon(symbol,76)
        image.paste(icon,(int(x-38),int(y-38)),icon)
    rounded_text(d,(760,550),"BTC · ETH · SOL · XRP · BNB · ADA · DOGE",15,(192,215,185),True)
    return image
build_og(invitation=False).save(P/"og-image.png",optimize=True)
invitation=build_og(invitation=True)
invitation.save(P/"og-invitation-v3.png",optimize=True)
# Keep legacy social image URL available while caches transition.
invitation.save(P/"og-invitation-v2.png",optimize=True)
for size in (32,180,192,512):
    # Supersample the same geometric mark for crisp 32px browser icons.
    large=max(640,size*3)
    icon=Image.new("RGB",(large,large),(11,16,17))
    draw_mark(icon,large*.075,large*.305,large*.85)
    icon=icon.resize((size,size),Image.Resampling.LANCZOS)
    icon.save(P/("favicon-32.png" if size==32 else "apple-touch-icon.png" if size==180 else f"icon-{size}.png"),optimize=True)
print("Generated social image and favicon PNGs")
