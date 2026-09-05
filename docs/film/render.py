"""
Renders the UI shots as camera moves over the 4K stills.

Why not image-to-video: the Seedance test showed the layout survives but small
body copy drifts — "together" became "togeiher", "government" became
"governmant" — and it worsens across the clip. Cropping a moving window out of
a 3840x2160 plate and scaling to 1080p keeps every glyph exactly as rendered,
costs nothing, and can be re-run until the timing is right.

Generated video is reserved for shots with no UI in them.
"""
import subprocess, sys, os, json

SRC = "D:/CloudForge - SEVAI/docs/video-frames"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")
os.makedirs(OUT, exist_ok=True)

W, H, FPS = 1920, 1080, 30
CW, CH = 3840, 2160  # canvas

# zoom = fraction of canvas width the window spans. 0.5 => 1920px window (1:1 pixels).
# cx, cy = window centre in canvas coords.
# Each shot: (id, source, seconds, start(zoom,cx,cy), end(zoom,cx,cy))
SHOTS = [
    # ── ACT 1 · PROMO ────────────────────────────────────────────────────────
    ("S05", "01-landing",           7.0, (0.62, 1500, 780),  (0.52, 1350, 700)),
    ("S06", "02-landing-figures",   6.0, (0.80, 1920, 1000), (0.58, 1500, 560)),
    ("S07", "04-onboarding-state",  6.0, (0.78, 1920, 900),  (0.66, 1900, 780)),
    ("S08", "07-result",            6.0, (0.78, 1800, 900),  (0.42, 1500, 300)),
    ("S09", "08-result-full",      11.0, (0.62, 1900, 500),  (0.62, 1900, 1750)),
    ("S10", "09-result-money",      7.0, (0.66, 1900, 1000), (0.60, 1900, 1000)),
    ("S11", "21-sahayak-session",   5.0, (0.80, 1920, 1080), (0.68, 1920, 1000)),
    ("S12", "01-landing",           5.0, (0.52, 1350, 700),  (0.92, 1920, 1080)),
    # ── ACT 2 · DEMO ─────────────────────────────────────────────────────────
    ("S13", "01-landing",           6.0, (0.72, 1600, 800),  (0.66, 1500, 760)),
    ("S14a", "04-onboarding-state", 2.7, (0.72, 1900, 820),  (0.68, 1900, 800)),
    ("S14b", "05-onboarding-age",   2.7, (0.72, 1900, 820),  (0.68, 1900, 800)),
    ("S14c", "06-onboarding-work",  2.7, (0.72, 1900, 820),  (0.68, 1900, 800)),
    ("S15", "06-onboarding-work",   6.0, (0.70, 1900, 800),  (0.62, 1900, 760)),
    ("S16", "07-result",            6.0, (0.70, 1700, 700),  (0.46, 1520, 320)),
    ("S17", "09-result-money",      8.0, (0.62, 1900, 700),  (0.62, 1900, 1500)),
    ("S18", "11-feed-list",         6.0, (0.62, 1900, 600),  (0.62, 1900, 1600)),
    ("S19", "13-scheme-detail",     8.0, (0.60, 1750, 1050), (0.54, 1720, 1030)),
    ("S20", "14-scheme-detail-full",6.0, (0.58, 1700, 700),  (0.58, 1700, 1300)),
    ("S21", "15-apply",             6.0, (0.72, 1900, 900),  (0.64, 1900, 850)),
    ("S22", "16-success-chaining",  8.0, (0.78, 1920, 1200), (0.60, 1880, 1150)),
    ("S23", "18-applications-full", 6.0, (0.62, 1900, 700),  (0.62, 1900, 1500)),
    ("S24", "03-landing-howitworks",5.0, (0.62, 1900, 1700), (0.72, 1920, 1500)),
]


def clampf(zoom, cx, cy):
    """Keep the crop window inside the canvas."""
    w = zoom * CW
    h = w * H / W
    w, h = min(w, CW), min(h, CH)
    cx = max(w / 2, min(CW - w / 2, cx))
    cy = max(h / 2, min(CH - h / 2, cy))
    return w, h, cx, cy


def build(shot):
    sid, src, dur, a, b = shot
    w0, h0, cx0, cy0 = clampf(*a)
    w1, h1, cx1, cy1 = clampf(*b)
    # p is eased (smoothstep) so moves start and stop softly instead of snapping.
    p = f"(3*pow(min(t/{dur},1),2)-2*pow(min(t/{dur},1),3))"
    wexp = f"({w0}+({w1}-{w0})*{p})"
    hexp = f"({h0}+({h1}-{h0})*{p})"
    xexp = f"(({cx0}+({cx1}-{cx0})*{p})-{wexp}/2)"
    yexp = f"(({cy0}+({cy1}-{cy0})*{p})-{hexp}/2)"
    vf = (
        f"crop=w='{wexp}':h='{hexp}':x='{xexp}':y='{yexp}',"
        f"scale={W}:{H}:flags=lanczos,setsar=1,format=yuv420p"
    )
    out = os.path.join(OUT, f"{sid}.mp4")
    cmd = [
        "ffmpeg", "-v", "error", "-y",
        "-loop", "1", "-framerate", str(FPS), "-t", str(dur),
        "-i", os.path.join(SRC, src + ".png"),
        "-vf", vf, "-c:v", "libx264", "-preset", "slow", "-crf", "16",
        "-pix_fmt", "yuv420p", "-r", str(FPS), out,
    ]
    return sid, out, cmd


if __name__ == "__main__":
    only = sys.argv[1:] or None
    total = 0.0
    for shot in SHOTS:
        if only and shot[0] not in only:
            continue
        sid, out, cmd = build(shot)
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"  {sid} FAILED: {r.stderr.strip()[:200]}")
        else:
            total += shot[2]
            print(f"  {sid:<5} {shot[1]:<26} {shot[2]:>5.1f}s  {os.path.getsize(out)//1024:>6} KB")
    print(f"  total {total:.1f}s across UI shots")
