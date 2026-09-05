"""
Assembles the film: title overlays per shot, hard cuts between them, one music
bed underneath.

Hard cuts rather than crossfades throughout — the product's design language is
editorial and restrained, and dissolving every join would fight it. The one
exception is the bloom resolving into the landing, which is the hook.
"""
import subprocess, os, sys, json

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "shots")
GEN = os.path.join(HERE, "gen")       # generated abstract clips, normalised
TITLES = os.path.join(HERE, "titles")
BUILD = os.path.join(HERE, "build")
os.makedirs(BUILD, exist_ok=True)
os.makedirs(GEN, exist_ok=True)

W, H, FPS = 1920, 1080, 30

# (clip file, source dir, title id or None, title in, title out)
TIMELINE = [
    # ── ACT 1 ────────────────────────────────────────────────────────────────
    ("A01.mp4", GEN,   "T01", 0.6, 4.4),
    ("A02.mp4", GEN,   "T02", 0.4, 4.2),
    ("A03.mp4", GEN,   None,  0,   0),  # bloom into the landing
    ("S05.mp4", SHOTS, None,  0,   0),
    ("S06.mp4", SHOTS, None,  0,   0),
    ("S07.mp4", SHOTS, None,  0,   0),
    ("S08.mp4", SHOTS, None,  0,   0),
    ("S09.mp4", SHOTS, None,  0,   0),
    ("S10.mp4", SHOTS, "T10", 0.6, 6.4),
    ("S11.mp4", SHOTS, "T11", 0.4, 4.6),
    ("S12.mp4", SHOTS, "T12", 1.2, 5.0),
    # ── ACT 2 ────────────────────────────────────────────────────────────────
    ("S13.mp4",  SHOTS, "T13", 0.5, 5.4),
    ("S14a.mp4", SHOTS, None,  0,   0),
    ("S14b.mp4", SHOTS, None,  0,   0),
    ("S14c.mp4", SHOTS, None,  0,   0),
    ("S15.mp4",  SHOTS, None,  0,   0),
    ("S16.mp4",  SHOTS, None,  0,   0),
    ("S17.mp4",  SHOTS, None,  0,   0),
    ("S18.mp4",  SHOTS, None,  0,   0),
    ("S19.mp4",  SHOTS, "T19", 0.6, 7.2),
    ("S20.mp4",  SHOTS, None,  0,   0),
    ("S21.mp4",  SHOTS, None,  0,   0),
    ("S22.mp4",  SHOTS, "T22", 0.8, 7.2),
    ("S23.mp4",  SHOTS, None,  0,   0),
    ("S24.mp4",  SHOTS, "T24", 0.8, 4.8),
]

FADE = 0.55  # title fade in/out, seconds


def dur(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", path],
        capture_output=True, text=True)
    return float(r.stdout.strip())


def normalise(src, dst, seconds=None):
    """Force every clip to the same codec, size, fps and pixel format so the
    concat demuxer can join them without re-encoding surprises."""
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", src]
    if seconds:
        cmd += ["-t", str(seconds)]
    cmd += [
        "-vf", f"scale={W}:{H}:force_original_aspect_ratio=increase,"
               f"crop={W}:{H},fps={FPS},setsar=1,format=yuv420p",
        "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "16", dst,
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def with_title(clip, title_png, tin, tout, dst):
    """Fade the card in and out on its own alpha channel.

    colorchannelmixer's aa takes a constant, not a per-frame expression, so the
    timing has to come from the fade filter with alpha=1 instead. The card is
    looped as a video input for the length of the clip so fade has a timeline
    to act on.
    """
    d = dur(clip)
    tout = min(tout, d - 0.05)
    fc = (f"[1:v]format=rgba,"
          f"fade=t=in:st={tin}:d={FADE}:alpha=1,"
          f"fade=t=out:st={max(tout - FADE, tin)}:d={FADE}:alpha=1[t];"
          f"[0:v][t]overlay=0:0:format=auto,format=yuv420p[v]")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y",
         "-i", clip,
         "-loop", "1", "-framerate", str(FPS), "-t", str(d), "-i", title_png,
         "-filter_complex", fc, "-map", "[v]", "-c:v", "libx264",
         "-preset", "slow", "-crf", "16", "-r", str(FPS), dst],
        check=True, capture_output=True)


def main():
    parts, total = [], 0.0
    print("  building shots")
    for i, (name, srcdir, tid, tin, tout) in enumerate(TIMELINE):
        src = os.path.join(srcdir, name)
        if not os.path.exists(src):
            print(f"    MISSING {name} — skipped")
            continue
        stage = os.path.join(BUILD, f"{i:02d}_{name}")
        if tid:
            with_title(src, os.path.join(TITLES, f"{tid}.png"), tin, tout, stage)
        else:
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-c", "copy", stage],
                           check=True, capture_output=True)
        d = dur(stage)
        total += d
        parts.append(stage)
        print(f"    {name:<10} {d:>5.1f}s{'  +' + tid if tid else ''}")

    lst = os.path.join(BUILD, "concat.txt")
    with open(lst, "w") as f:
        for p in parts:
            f.write(f"file '{p.replace(os.sep, '/')}'\n")

    silent = os.path.join(BUILD, "silent.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0",
                    "-i", lst, "-c", "copy", silent], check=True, capture_output=True)

    music = os.path.join(HERE, "clips", "music.m4a")
    out = os.path.join(HERE, "sevai-film.mp4")
    if os.path.exists(music):
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", silent, "-i", music,
             "-filter_complex",
             f"[1:a]atrim=0:{total},afade=t=in:st=0:d=2,"
             f"afade=t=out:st={max(total - 4, 0)}:d=4,volume=0.85[a]",
             "-map", "0:v", "-map", "[a]", "-c:v", "copy",
             "-c:a", "aac", "-b:a", "192k", "-shortest", out],
            check=True, capture_output=True)
    else:
        print("    no music bed found — video only")
        os.replace(silent, out)

    print(f"\n  {out}")
    print(f"  {total:.1f}s  ({int(total // 60)}:{int(total % 60):02d})  "
          f"{os.path.getsize(out) // 1048576} MB")


if __name__ == "__main__":
    main()
