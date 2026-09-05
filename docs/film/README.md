# The demo film

A 2:22 film for the CloudForge submission. Every frame of interface in it is the
real application, captured from the running build — nothing is a mockup and
nothing is a generated impression of a screen.

## Why it is built this way

The obvious approach was image-to-video: hand each screenshot to a generative
model and let it add camera motion. The first test showed why that fails here.
The layout survived and the large type held, but small body copy drifted as the
clip ran — by the last frame *"together"* had become *"togeiher"*, *"not"* had
become *"nof"*, and *"government"* had become *"governmant"*. Frame one was
clean, so the corruption accumulated with time rather than arriving at once.

That is disqualifying for this particular product. Sevai's argument rests on
sentences like *"They are not added together"* and on a rupee figure being
exactly right. A film that garbles them while claiming the product is careful
about numbers would undercut itself.

So the interface shots are camera moves cropped out of 3840x2160 stills. A
1920x1080 window inside a 4K plate is a real move at native sharpness, every
glyph stays exactly as the browser rendered it, it costs nothing, and it can be
re-run until the timing is right.

Generated video is used only where there is no interface to corrupt: the opening
in the void, and the transition into the landing page. Music is generated too.

## Pipeline

| Stage | File | What it does |
|---|---|---|
| 1 | `capture-web.mjs` | Drives the running app with Playwright and writes 21 plates to `docs/video-frames/` at 1920x1080, deviceScaleFactor 2 |
| 2 | `render.py` | Crops an eased, moving window out of each plate into a shot |
| 3 | `titles.mjs` | Renders title cards as transparent PNGs in the product's own typefaces |
| 4 | `assemble.py` | Composites titles, joins the shots, lays the music bed underneath |

```bash
npm run dev                 # the app must be running
node docs/film/capture-web.mjs
python docs/film/render.py
node docs/film/titles.mjs
python docs/film/assemble.py
```

Steps 2 and 4 need `ffmpeg` 9 or later on the path. Step 1 needs Playwright's
chromium (`npx playwright install chromium`).

## Notes

- **The walkthrough is one continuous session.** All plates follow the same
  citizen — a smallholder farmer, SC, priority ration card, under an acre — so
  the numbers agree from shot to shot. Change `ANSWERS` in `capture-web.mjs` to
  film a different person.
- **Titles are set in Archivo and IBM Plex Mono**, the faces the product uses,
  and left-hand cards are drawn as plates in the same style as the app's own
  panels. `drawtext` would have put an unrelated typeface on top of a film about
  a typographic interface.
- **Cards are used sparingly.** The interface is well written, and captioning
  what it already says on screen is noise. A card earns its place only where the
  film needs to say something the UI does not.
- **The aggregate cash figure on the result screen is the corpus artifact**
  described under Limitations in the root README — some schemes publish a
  departmental outlay rather than a per-beneficiary amount. The film anchors its
  money claim on PM-KISAN's ₹6,000 a year instead, which is a real published
  per-beneficiary figure.
