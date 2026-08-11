/**
 * DocumentScanner.jsx
 * Camera (or file) capture → on-device quality check → /api/extract-document →
 * on-device number validation → onDataExtracted({ ...serverResult, validation }).
 *
 * ── Why this was rewritten ────────────────────────────────────────────────
 * The v1 camera never opened, for two independent reasons:
 *
 *   1. It called enumerateDevices() on mount, BEFORE any permission existed.
 *      In that state a browser returns videoinput entries with deviceId === ''
 *      and label === '' — it will not hand out device identity to a page that
 *      has not been granted the camera. v1 stored that '' as the selected
 *      device and then gated opening on `if (autoOpen && selectedDeviceId)`,
 *      which is falsy for ''. openCamera was therefore never called and the
 *      sheet showed a spinner forever. Opening is now gated on nothing at all:
 *      we ask for the stream FIRST, and enumerate afterwards, because ids and
 *      labels only populate once permission has been granted.
 *
 *   2. The same effect returned `() => stopStream()` while depending on
 *      [autoOpen, selectedDeviceId]. Any dependency change tore down the
 *      stream that had just been created. Teardown now lives in an unmount-only
 *      effect, and in the explicit close/capture paths.
 *
 * ── Rules this screen is built around ─────────────────────────────────────
 *   • The rear camera is the point. facingMode 'environment' is requested
 *     first; a scanner that opens the selfie camera has failed at its one job.
 *   • The file input is ALWAYS on screen, not a consolation prize after an
 *     error. It is the only path that works on a desktop with no webcam, on
 *     http:// over a LAN where getUserMedia does not exist, and in every
 *     locked-down browser. It runs through the identical extract path.
 *   • Every camera failure gets its own words, in both languages, that say
 *     what to DO. 'Camera access denied or unavailable' tells a citizen
 *     nothing.
 *   • The frame is checked on this device before the network is touched. A
 *     dark or blurry photo is sent back for a retake without burning an API
 *     call, and without the wait.
 *   • Privacy: this is frequently a shared phone. The full ID number is never
 *     drawn on screen (maskId) and never logged.
 *
 * The viewfinder stays dark on purpose. It is the one place in the product
 * where a dark field is functional rather than decorative: a card held up to
 * the lens reads best against neutral dark, and the framing guide needs the
 * contrast to be visible at all.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { verifyDocument } from '../utils/documentVerifier.js';
import { ID_LABELS, maskId, validateId } from '../utils/idDocuments.js';

// ── Camera faults ───────────────────────────────────────────────────────────
// One entry per distinguishable failure, each ending in an instruction. The
// DOMException name is the only reliable signal a browser gives us, so it is
// mapped explicitly rather than collapsed into a single message.
const FAULTS = {
  insecure: {
    en: 'The camera needs a secure connection',
    ta: 'கேமராவுக்குப் பாதுகாப்பான இணைப்பு தேவை',
    enBody:
      'Browsers only allow the camera on an https:// address or on localhost. This page is not on one, so there is nothing to allow. Open it over https, or choose a photo below — that works either way.',
    taBody:
      'https:// முகவரியில் மட்டுமே உலாவி கேமராவை அனுமதிக்கும். இந்தப் பக்கம் அப்படி இல்லை. https இல் திறக்கவும், அல்லது கீழே படத்தைத் தேர்ந்தெடுக்கவும்.',
    retry: false,
  },
  denied: {
    en: 'Camera permission was refused',
    ta: 'கேமரா அனுமதி மறுக்கப்பட்டது',
    enBody:
      'Tap the lock or camera icon in the address bar, set the camera to Allow, then try again. On Android you may need Settings → Apps → Browser → Permissions → Camera. Or just choose a photo below.',
    taBody:
      'முகவரிப் பட்டியில் உள்ள பூட்டு அல்லது கேமரா சின்னத்தைத் தட்டி, கேமராவை "அனுமதி" என்று மாற்றி மீண்டும் முயற்சிக்கவும். அல்லது கீழே ஒரு படத்தைத் தேர்ந்தெடுங்கள்.',
    retry: true,
  },
  notfound: {
    en: 'No camera on this device',
    ta: 'இந்தச் சாதனத்தில் கேமரா இல்லை',
    enBody:
      'Nothing was found to take a picture with. Use the photo option below — you can take the picture on a phone and pick the file here.',
    taBody:
      'படம் எடுக்கக் கேமரா எதுவும் கிடைக்கவில்லை. கீழே உள்ள படத் தேர்வைப் பயன்படுத்துங்கள்.',
    retry: true,
  },
  busy: {
    en: 'Another app is using the camera',
    ta: 'வேறொரு செயலி கேமராவைப் பயன்படுத்துகிறது',
    enBody:
      'Close the other app or browser tab that has the camera open — a video call is the usual one — then try again.',
    taBody:
      'கேமராவைப் பயன்படுத்தும் மற்ற செயலியை அல்லது உலாவித் தாவலை மூடிவிட்டு மீண்டும் முயற்சிக்கவும்.',
    retry: true,
  },
  aborted: {
    en: 'The camera stopped before it started',
    ta: 'கேமரா தொடங்கும் முன் நின்றுவிட்டது',
    enBody: 'Something interrupted it. Try again, or choose a photo below.',
    taBody: 'ஏதோ இடையூறு ஏற்பட்டது. மீண்டும் முயற்சிக்கவும், அல்லது கீழே படத்தைத் தேர்ந்தெடுக்கவும்.',
    retry: true,
  },
  unknown: {
    en: 'The camera could not be opened',
    ta: 'கேமராவைத் திறக்க முடியவில்லை',
    enBody: 'Try again. If it keeps failing, choose a photo below instead — that path does not need the camera.',
    taBody: 'மீண்டும் முயற்சிக்கவும். தொடர்ந்து தோல்வியுற்றால், கீழே ஒரு படத்தைத் தேர்ந்தெடுங்கள்.',
    retry: true,
  },
};

function faultFor(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'notfound';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'busy';
    case 'AbortError':
      return 'aborted';
    default:
      return 'unknown';
  }
}

// ── Validation reasons ──────────────────────────────────────────────────────
// validateId() returns a machine reason; a citizen needs a sentence. Anything
// unmapped falls back to a generic line plus the raw code, so a new reason
// degrades to "we could not verify it" rather than to a blank space.
const REASONS = {
  empty:            { en: 'No number was found on the card.', ta: 'அட்டையில் எண் எதுவும் கிடைக்கவில்லை.' },
  missing:          { en: 'No number was found on the card.', ta: 'அட்டையில் எண் எதுவும் கிடைக்கவில்லை.' },
  no_number:        { en: 'No number was found on the card.', ta: 'அட்டையில் எண் எதுவும் கிடைக்கவில்லை.' },
  unreadable:       { en: 'The card could not be read.', ta: 'அட்டையைப் படிக்க முடியவில்லை.' },
  unsupported_type: { en: 'Sevai cannot check this kind of number yet.', ta: 'இந்த வகை எண்ணை சேவை இப்போதைக்குச் சரிபார்க்க முடியாது.' },
  not_supported:    { en: 'Sevai cannot check this kind of number yet.', ta: 'இந்த வகை எண்ணை சேவை இப்போதைக்குச் சரிபார்க்க முடியாது.' },
  unknown_type:     { en: 'Sevai could not tell which document this is.', ta: 'இது எந்த ஆவணம் என்று சேவையால் கண்டறிய முடியவில்லை.' },
  format:           { en: 'The number is not the right shape for this document.', ta: 'இந்த ஆவணத்திற்கான எண் வடிவம் சரியில்லை.' },
  bad_format:       { en: 'The number is not the right shape for this document.', ta: 'இந்த ஆவணத்திற்கான எண் வடிவம் சரியில்லை.' },
  length:           { en: 'The number has the wrong number of characters.', ta: 'எண்ணில் உள்ள எழுத்துகளின் எண்ணிக்கை சரியில்லை.' },
  checksum:         { en: 'The number failed its own check digit — a digit was almost certainly misread.', ta: 'எண்ணின் சரிபார்ப்பு இலக்கம் பொருந்தவில்லை — ஓர் இலக்கம் தவறாகப் படிக்கப்பட்டிருக்கும்.' },
  checksum_failed:  { en: 'The number failed its own check digit — a digit was almost certainly misread.', ta: 'எண்ணின் சரிபார்ப்பு இலக்கம் பொருந்தவில்லை — ஓர் இலக்கம் தவறாகப் படிக்கப்பட்டிருக்கும்.' },
  leading_digit:    { en: 'An Aadhaar number cannot begin with 0 or 1.', ta: 'ஆதார் எண் 0 அல்லது 1 இல் தொடங்காது.' },
  invalid_prefix:   { en: 'An Aadhaar number cannot begin with 0 or 1.', ta: 'ஆதார் எண் 0 அல்லது 1 இல் தொடங்காது.' },
  holder_code:      { en: 'The fourth letter of a PAN is not one of the valid holder codes.', ta: 'பான் எண்ணின் நான்காம் எழுத்து சரியான வகைக் குறியீடு அல்ல.' },
  not_checked:      { en: 'The number was not checked on this device.', ta: 'எண் இந்தச் சாதனத்தில் சரிபார்க்கப்படவில்லை.' },
};

// Reasons that mean "there was nothing to check", not "the check failed".
// They must not be dressed up as an alarm.
const NEUTRAL_REASONS = new Set([
  'empty', 'missing', 'no_number', 'unsupported_type', 'not_supported', 'unknown_type', 'not_checked',
]);

const CONFIDENCE = {
  high:   { en: 'Read clearly',                    ta: 'தெளிவாகப் படிக்கப்பட்டது' },
  medium: { en: 'Read — worth a second look',      ta: 'படிக்கப்பட்டது — ஒருமுறை சரிபாருங்கள்' },
  low:    { en: 'Hard to read — check every line', ta: 'படிக்கக் கடினம் — ஒவ்வொன்றையும் சரிபாருங்கள்' },
};

// Client-side stand-in with every contract key present, used only when the
// extraction itself failed. `error` is what tells the caller not to trust it.
const EMPTY_RESULT = {
  documentType: 'unreadable',
  confidence: 'low',
  name: null,
  dob: null,
  idNumber: null,
  address: null,
  gender: null,
  fatherName: null,
  issueDate: null,
  expiryDate: null,
  vehicleClasses: null,
  source: null,
};

// Re-encode any picked file as a bounded JPEG data URL, so the file path and
// the camera path hand the server the exact same kind of payload.
async function fileToJpegDataUrl(file, maxEdge = 1800) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode_failed'));
      el.src = url;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('decode_failed');
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function DocumentScanner({ onDataExtracted, lang = 'en', autoOpen = false, onClose }) {
  // idle · starting · live · error · checking · extracting · quality · result · failed
  const [phase, setPhase] = useState(autoOpen ? 'starting' : 'idle');
  const [fault, setFault] = useState(null);      // key into FAULTS
  const [quality, setQuality] = useState(null);  // verifyDocument() failure
  const [result, setResult] = useState(null);    // server shape + validation
  const [isCasting, setIsCasting] = useState(false);
  const [playBlocked, setPlayBlocked] = useState(false);
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const readyTimerRef = useRef(null);
  const imageRef = useRef(null);   // base64 frame, kept off state — it is large
  const mountedRef = useRef(true);
  const startingRef = useRef(null);
  const genRef = useRef(0);        // invalidates in-flight getUserMedia calls

  const ta = lang === 'ta';

  // ── stream lifecycle ──────────────────────────────────────────────────────
  // Stable identity (no deps), so the unmount effect below never re-runs and
  // can never tear down a stream that is still wanted. This is the v1 bug.
  const stopStream = useCallback(() => {
    genRef.current += 1;
    startingRef.current = null;
    if (readyTimerRef.current) {
      clearInterval(readyTimerRef.current);
      readyTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) {
      try { video.pause(); } catch { /* already stopped */ }
      video.srcObject = null;
    }
    setIsCasting(false);
    setPlayBlocked(false);
  }, []);

  // A frame can only be captured once the video reports real dimensions.
  // Drawing a 0x0 video produces a blank canvas with no error at all, so the
  // shutter stays disabled until this says otherwise. Driven by the media
  // events AND by a poll, because loadedmetadata is missed often enough on
  // Android WebView that it cannot be the only signal.
  const markReady = useCallback(() => {
    const video = videoRef.current;
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      setIsCasting(true);
      setPlayBlocked(false);
      if (readyTimerRef.current) {
        clearInterval(readyTimerRef.current);
        readyTimerRef.current = null;
      }
      return true;
    }
    return false;
  }, []);

  const watchReady = useCallback(() => {
    if (readyTimerRef.current) clearInterval(readyTimerRef.current);
    if (markReady()) return;
    readyTimerRef.current = setInterval(markReady, 200);
  }, [markReady]);

  // Rear camera first. A document scanner that opens the selfie camera has
  // failed. An explicitly chosen device outranks it; plain video is the floor.
  const requestStream = useCallback(async (deviceId) => {
    const rear = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } } };
    const attempts = deviceId
      ? [{ video: { deviceId: { exact: deviceId }, width: { ideal: 1920 } } }, rear, { video: true }]
      : [rear, { video: true }];

    let lastErr = new Error('no_attempt');
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastErr = err;
        // A refusal is about the page, not the constraints. Retrying only
        // re-prompts and, in some browsers, hardens the block.
        if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') break;
      }
    }
    throw lastErr;
  }, []);

  const startCamera = useCallback(async (deviceId = '') => {
    // StrictMode mounts twice; without this the second pass fights the first.
    if (startingRef.current === deviceId) return;
    stopStream();                    // also clears startingRef and bumps gen
    startingRef.current = deviceId;
    const gen = ++genRef.current;

    setPhase('starting');
    setFault(null);
    setQuality(null);
    setResult(null);

    // getUserMedia simply does not exist on http:// over a LAN — the usual way
    // this app gets demoed on a phone. Say so; a dead spinner teaches nothing.
    if (typeof window !== 'undefined' && (window.isSecureContext === false || !navigator.mediaDevices?.getUserMedia)) {
      startingRef.current = null;
      setFault('insecure');
      setPhase('error');
      return;
    }

    try {
      const stream = await requestStream(deviceId);

      // Superseded or unmounted while the permission prompt was up.
      if (gen !== genRef.current || !mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      setPhase('live');

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        try {
          await video.play();
        } catch (err) {
          // Autoplay refusal is recoverable with one tap; anything else will
          // be caught by the readiness poll leaving the shutter disabled.
          if (err?.name === 'NotAllowedError') setPlayBlocked(true);
        }
      }
      watchReady();

      // Only now. Before permission, every entry comes back with an empty
      // deviceId and an empty label — which is exactly what broke v1.
      try {
        const found = await navigator.mediaDevices.enumerateDevices();
        if (gen !== genRef.current || !mountedRef.current) return;
        const cams = found.filter((d) => d.kind === 'videoinput');
        setDevices(cams);
        const active = stream.getVideoTracks()[0]?.getSettings?.().deviceId || '';
        setSelectedDeviceId(active || cams[0]?.deviceId || '');
      } catch {
        /* the picker is a convenience; the stream is already running */
      }
    } catch (err) {
      if (gen !== genRef.current || !mountedRef.current) return;
      setFault(faultFor(err));       // never log the exception payload
      setPhase('error');
      setIsCasting(false);
    } finally {
      if (startingRef.current === deviceId) startingRef.current = null;
    }
  }, [requestStream, stopStream, watchReady]);

  // Mount guard + the ONLY teardown that is tied to the component's life.
  // Declared first so mountedRef is true before the auto-open effect runs.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopStream();
    };
  }, [stopStream]);

  // Auto-open. Gated on nothing but the prop — waiting for a deviceId here is
  // what left the sheet spinning forever. No cleanup: see the note above.
  useEffect(() => {
    if (autoOpen) startCamera('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  // ── extraction ────────────────────────────────────────────────────────────
  const extract = useCallback(async (base64Image) => {
    imageRef.current = base64Image;
    setPhase('extracting');
    try {
      const res = await fetch('/api/extract-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image }),
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      const data = await res.json();
      if (data?.error) throw new Error('server_error');
      if (!mountedRef.current) return;

      // hasOwnProperty, not a plain lookup: 'constructor' and friends are
      // truthy on any object, and the label is rendered straight into JSX.
      const known = Object.prototype.hasOwnProperty.call(ID_LABELS, data.documentType);
      const type = known ? data.documentType : 'other';

      // Validation is a second opinion on the reading, not a gate on it. If
      // the checker itself throws, the citizen still gets their details.
      let validation = { ok: false, normalised: null, reason: 'not_checked' };
      try {
        validation = validateId(type, data.idNumber) || validation;
      } catch {
        /* keep the not_checked default */
      }

      setResult({ ...data, documentType: type, validation });
      setPhase('result');
    } catch (err) {
      // Message only. The response body carries an ID number and must never
      // reach the console on a shared phone.
      console.error('Document extraction failed:', err?.message || 'unknown');
      if (!mountedRef.current) return;
      setPhase('failed');
    }
  }, []);

  // The on-device check runs before the network. A dark or blurry frame comes
  // straight back for a retake — no API call, no wait, no wrong answer.
  const runQualityGate = useCallback(async (blobOrFile) => {
    setPhase('checking');
    const check = await verifyDocument(blobOrFile);
    if (!mountedRef.current) return false;
    if (!check.valid) {
      setQuality(check);
      setPhase('quality');
      return false;
    }
    return true;
  }, []);

  const captureAndExtract = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

    const base64Image = canvas.toDataURL('image/jpeg', 0.85);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));

    stopStream();                        // the lens is free the moment we are done
    imageRef.current = base64Image;

    if (blob && !(await runQualityGate(blob))) return;
    await extract(base64Image);
  }, [extract, runQualityGate, stopStream]);

  const handleFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';               // so the same file can be picked twice
    if (!file) return;

    stopStream();
    setFault(null);
    setQuality(null);
    setResult(null);

    if (!(await runQualityGate(file))) return;
    try {
      const base64Image = await fileToJpegDataUrl(file);
      await extract(base64Image);
    } catch {
      if (!mountedRef.current) return;
      setQuality({
        issue: 'load_error',
        english_message: 'That photo could not be opened. Please choose another.',
        tamil_message: 'அந்தப் படத்தைத் திறக்க முடியவில்லை. வேறொன்றைத் தேர்ந்தெடுக்கவும்.',
      });
      setPhase('quality');
    }
  }, [extract, runQualityGate, stopStream]);

  // ── user actions ──────────────────────────────────────────────────────────
  const closeScanner = () => {
    stopStream();
    setPhase('idle');
    setFault(null);
    setQuality(null);
    setResult(null);
    onClose?.();
  };

  const retake = () => {
    setQuality(null);
    setResult(null);
    startCamera(selectedDeviceId);
  };

  const acceptResult = () => {
    stopStream();
    onDataExtracted?.(result, imageRef.current);
  };

  const acceptDespiteFailure = () => {
    stopStream();
    onDataExtracted?.(
      { ...EMPTY_RESULT, error: 'extraction_failed', validation: { ok: false, normalised: null, reason: 'extraction_failed' } },
      imageRef.current,
    );
  };

  const switchCamera = (e) => {
    const id = e.target.value;
    setSelectedDeviceId(id);
    startCamera(id);
  };

  // ── shared pieces ─────────────────────────────────────────────────────────
  const fileFallback = (
    <label className="mt-4 block cursor-pointer rounded-[4px] border border-dashed border-rule-22 px-4 py-3.5 transition-colors hover:border-ink">
      <span className="flex items-start gap-3.5">
        <span className="btn-icon flex-none" aria-hidden="true"><ImageGlyph /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-medium tracking-[-.012em]">Choose a photo instead</span>
          <span className="ta mt-0.5 block text-[12.5px] text-ink-45" lang="ta">
            அல்லது ஒரு படத்தைத் தேர்ந்தெடுங்கள்
          </span>
          <span className="mt-1.5 block text-[12px] leading-[1.55] text-ink-30">
            Uses your phone&rsquo;s own camera app, or a picture already on this device. Works with no
            webcam and on any browser.
          </span>
        </span>
      </span>
      <input type="file" accept="image/*" capture="environment" onChange={handleFile} className="hidden" />
    </label>
  );

  const header = (title, taTitle) => (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <span className="mono block text-[9.5px] tracking-[.12em] text-ink-55">{title}</span>
        <span className="ta mt-0.5 block text-[11.5px] text-ink-30" lang="ta">{taTitle}</span>
      </div>
      <button onClick={closeScanner} className="btn-quiet flex-none !px-3.5 !py-1.5 !text-[12.5px]">
        Close <span className="ta font-normal opacity-70" lang="ta">· மூடு</span>
      </button>
    </div>
  );

  const busy = (title, taTitle, body, taBody) => (
    <div className="panel enter p-5">
      <span className="mono block text-[9.5px] tracking-[.12em] text-ink-55">{title}</span>
      <span className="ta mt-0.5 block text-[11.5px] text-ink-30" lang="ta">{taTitle}</span>
      {/* A CSS pulse, not a width tween: a tween that never runs leaves a 0px
          bar, which reads as a frozen app at the exact moment of waiting. */}
      <div className="mt-4 h-[3px] overflow-hidden rounded-full bg-rule-10">
        <div className="h-full w-full bg-ink animate-svPulse" />
      </div>
      <p className="mt-4 mb-0 max-w-[46ch] text-[14px] leading-[1.6] text-ink-60">{body}</p>
      <div className="ta mt-1 max-w-[42ch] text-[12.5px] text-ink-40" lang="ta">{taBody}</div>
    </div>
  );

  // ── closed ────────────────────────────────────────────────────────────────
  if (phase === 'idle') {
    return (
      <div>
        <button onClick={() => startCamera('')} className="option flex items-center gap-3.5">
          <span className="btn-icon flex-none" aria-hidden="true"><CameraGlyph /></span>
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold tracking-[-.012em]">Scan with the camera</span>
            <span className="ta mt-0.5 block text-[12.5px] text-ink-45" lang="ta">கேமராவால் ஸ்கேன் செய்யுங்கள்</span>
          </span>
        </button>
        {fileFallback}
      </div>
    );
  }

  // ── on-device check / server read ─────────────────────────────────────────
  if (phase === 'checking') {
    return busy(
      'Checking the photo',
      'படம் சரிபார்க்கப்படுகிறது',
      'Looking at the light and the focus, here on this phone. No internet is used for this part.',
      'வெளிச்சமும் தெளிவும் இந்தத் தொலைபேசியிலேயே சரிபார்க்கப்படுகிறது. இணையம் தேவையில்லை.',
    );
  }

  if (phase === 'extracting') {
    return busy(
      'Reading the document',
      'ஆவணம் படிக்கப்படுகிறது',
      'Pulling the name and the number off the card so you do not have to type them.',
      'பெயரும் எண்ணும் அட்டையிலிருந்து எடுக்கப்படுகின்றன — நீங்கள் தட்டச்சு செய்ய வேண்டாம்.',
    );
  }

  // ── frame rejected on this device ─────────────────────────────────────────
  if (phase === 'quality') {
    return (
      <div className="enter">
        {header('Take it again', 'மீண்டும் எடுங்கள்')}
        <div className="mt-3 rounded-[4px] border border-dashed border-rule-22 px-4 py-4">
          <p className="m-0 max-w-[52ch] text-[15.5px] leading-[1.55] text-ink">
            {quality?.english_message || 'That photo will not read. Please take it again.'}
          </p>
          <div className="ta mt-1.5 max-w-[46ch] text-[13.5px] text-ink-45" lang="ta">
            {quality?.tamil_message || 'அந்தப் படம் படிக்கப்படாது. மீண்டும் எடுங்கள்.'}
          </div>
          <p className="mt-3 mb-0 text-[12.5px] leading-[1.6] text-ink-30">
            Checked on this phone — nothing was sent anywhere, and nothing was used up.
          </p>
          <div className="ta mt-1 text-[12px] text-ink-30" lang="ta">
            இந்தத் தொலைபேசியிலேயே சரிபார்க்கப்பட்டது — எதுவும் அனுப்பப்படவில்லை.
          </div>
        </div>
        <button onClick={retake} className="btn mt-4 flex w-full items-center justify-center gap-2">
          Take it again <span className="ta font-normal opacity-70" lang="ta">· மீண்டும் எடு</span>
        </button>
        {fileFallback}
      </div>
    );
  }

  // ── extraction failed ─────────────────────────────────────────────────────
  if (phase === 'failed') {
    return (
      <div className="enter">
        {header('Could not read it', 'படிக்க முடியவில்லை')}
        <div className="panel-flat mt-3 px-4 py-4">
          <p className="m-0 max-w-[52ch] text-[15.5px] leading-[1.55] text-ink">
            The photo was taken, but the details could not be read from it. You can keep the photo and
            type the details yourself, or try the picture again.
          </p>
          <div className="ta mt-1.5 max-w-[46ch] text-[13.5px] text-ink-45" lang="ta">
            படம் எடுக்கப்பட்டது, ஆனால் விவரங்களைப் படிக்க முடியவில்லை. படத்தை வைத்துக்கொண்டு நீங்களே
            தட்டச்சு செய்யலாம், அல்லது மீண்டும் எடுக்கலாம்.
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2.5">
          <button onClick={retake} className="btn flex-1 items-center justify-center !px-6 flex">
            Try again <span className="ta ml-1.5 font-normal opacity-70" lang="ta">· மீண்டும்</span>
          </button>
          <button onClick={acceptDespiteFailure} className="btn-quiet flex-none">
            Keep the photo <span className="ta font-normal opacity-70" lang="ta">· படத்தை வைத்துக்கொள்</span>
          </button>
        </div>
        {fileFallback}
      </div>
    );
  }

  // ── what was read ─────────────────────────────────────────────────────────
  if (phase === 'result' && result) {
    const label = ID_LABELS[result.documentType] || ID_LABELS.other;
    // A throw in here would take the whole scan down at the last step. No
    // mask means no number on screen, which is the safe direction anyway.
    let masked = null;
    try { masked = maskId(result.documentType, result.idNumber); } catch { masked = null; }
    const validation = result.validation || { ok: false, normalised: null, reason: null };
    const conf = CONFIDENCE[result.confidence] || CONFIDENCE.low;
    const reason = validation.reason;
    const reasonText = reason ? REASONS[reason] : null;
    const neutral = !reason || NEUTRAL_REASONS.has(reason);

    const rows = [
      ['Name', 'பெயர்', result.name],
      ['Date of birth', 'பிறந்த தேதி', result.dob],
      ['Father / guardian', 'தந்தை / பாதுகாவலர்', result.fatherName],
    ].filter(([, , v]) => v);

    return (
      <div className="enter">
        {header('What we read', 'படித்தது')}

        <div className="panel mt-3 p-5">
          {/* The detected type leads. Everything else on this card is a
              qualification of it. */}
          <div className="title-3 m-0">{label.en}</div>
          <div className="ta mt-1 text-[15px] text-ink-60" lang="ta">{label.ta}</div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="chip">
              <span className="mono text-[9.5px] tracking-[.11em] text-ink-45">{conf.en}</span>
            </span>
            <span className="ta text-[12px] text-ink-30" lang="ta">{conf.ta}</span>
          </div>

          {/* Never the whole number. This is routinely a shared phone and the
              screen is read over a shoulder. */}
          <div className="rule-t mt-4 pt-4">
            <span className="mono block text-[9.5px] tracking-[.12em] text-ink-55">Number on the card</span>
            {masked ? (
              <>
                <div className="mono tabular mt-1.5 text-[18px] tracking-[.08em] text-ink">{masked}</div>
                <p className="mt-1.5 mb-0 max-w-[48ch] text-[12px] leading-[1.55] text-ink-30">
                  Only the last four are shown. Sevai never puts a full ID number on the screen.
                </p>
                <div className="ta mt-1 text-[12px] text-ink-30" lang="ta">
                  கடைசி நான்கு இலக்கங்கள் மட்டுமே காட்டப்படுகின்றன.
                </div>
              </>
            ) : (
              <>
                <div className="mt-1.5 text-[15px] text-ink-45">No number could be read</div>
                <div className="ta mt-0.5 text-[12.5px] text-ink-30" lang="ta">எண் எதுவும் படிக்கப்படவில்லை</div>
              </>
            )}
          </div>

          {rows.length > 0 && (
            <dl className="rule-t mt-4 flex flex-col gap-3 pt-4">
              {rows.map(([en, taLabel, value]) => (
                <div key={en} className="grid grid-cols-[minmax(88px,140px)_minmax(0,1fr)] items-baseline gap-4">
                  <dt className="min-w-0">
                    <span className="block text-[12.5px] text-ink-40">{en}</span>
                    <span className="ta block text-[11px] text-ink-30" lang="ta">{taLabel}</span>
                  </dt>
                  <dd className="m-0 break-words text-[15px] leading-[1.45] text-ink" lang={lang}>{value}</dd>
                </div>
              ))}
            </dl>
          )}

          {/* The check, in words. 'Invalid' on its own is not actionable. */}
          <div className="rule-t mt-4 pt-4">
            {validation.ok ? (
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex-none text-ink" aria-hidden="true"><CheckGlyph /></span>
                <div className="min-w-0">
                  <div className="text-[14px] font-medium text-ink">The number passes its own check</div>
                  <div className="ta mt-0.5 text-[12.5px] text-ink-45" lang="ta">
                    எண் சரிபார்ப்பில் தேர்ச்சி பெற்றது
                  </div>
                </div>
              </div>
            ) : (
              <div className={neutral ? '' : 'rounded-[4px] border border-dashed border-rule-22 px-3.5 py-3'}>
                <span className="mono block text-[9.5px] tracking-[.12em] text-ink-55">
                  {neutral ? 'Not checked' : 'This did not pass the check'}
                </span>
                <p className="mt-1.5 mb-0 max-w-[50ch] text-[14px] leading-[1.55] text-ink-80">
                  {reasonText?.en || 'The number could not be verified on this device.'}
                </p>
                <div className="ta mt-1 max-w-[44ch] text-[12.5px] text-ink-45" lang="ta">
                  {reasonText?.ta || 'எண்ணை இந்தச் சாதனத்தில் சரிபார்க்க முடியவில்லை.'}
                </div>
                {reason && !reasonText && (
                  <span className="mono mt-2 inline-block text-[9.5px] tracking-[.11em] text-ink-30">{reason}</span>
                )}
                {!neutral && (
                  <p className="mt-2 mb-0 text-[12.5px] leading-[1.55] text-ink-30">
                    A retake in better light usually fixes this. Check the card itself before you rely on it.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2.5">
          <button onClick={acceptResult} className="btn flex flex-1 items-center justify-center !px-6">
            Use these details <span className="ta ml-1.5 font-normal opacity-70" lang="ta">· இதைப் பயன்படுத்து</span>
          </button>
          <button onClick={retake} className="btn-quiet flex-none">
            Retake <span className="ta font-normal opacity-70" lang="ta">· மீண்டும்</span>
          </button>
        </div>
      </div>
    );
  }

  // ── live camera (starting · live · error) ─────────────────────────────────
  const showViewfinder = phase === 'starting' || phase === 'live';
  const faultCopy = fault ? FAULTS[fault] : null;

  return (
    <div>
      <canvas ref={canvasRef} className="hidden" />

      {header(
        phase === 'error' ? 'Camera' : 'Live camera',
        phase === 'error' ? 'கேமரா' : 'கேமரா நேரடிக் காட்சி',
      )}

      {/* Dark by function, not by mood: a card reads against neutral dark and
          the framing guide needs the contrast. The element stays mounted in
          every phase so the ref is never null when a stream arrives. */}
      <div
        className={`relative mt-3 min-h-[188px] overflow-hidden rounded-[6px] border border-rule-16 bg-ink ${
          showViewfinder ? 'block' : 'hidden'
        }`}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onLoadedMetadata={markReady}
          onLoadedData={markReady}
          onCanPlay={markReady}
          onPlaying={markReady}
          className="block h-auto max-h-[46vh] w-full object-cover"
        />

        {phase === 'starting' && (
          <div className="absolute inset-0 grid place-items-center px-6 text-center">
            <div>
              <span className="mx-auto block h-5 w-5 rounded-full border-2 border-white/25 border-t-white animate-svSpin" aria-hidden="true" />
              <span className="mono mt-3 block text-[9.5px] tracking-[.12em] text-white/70">Starting the camera</span>
              <span className="ta mt-1 block text-[11.5px] text-white/45" lang="ta">கேமரா தொடங்குகிறது…</span>
            </div>
          </div>
        )}

        {phase === 'live' && !isCasting && !playBlocked && (
          <div className="absolute inset-0 grid place-items-center px-6 text-center">
            <div>
              <span className="mx-auto block h-5 w-5 rounded-full border-2 border-white/25 border-t-white animate-svSpin" aria-hidden="true" />
              <span className="mono mt-3 block text-[9.5px] tracking-[.12em] text-white/70">Focusing</span>
              <span className="ta mt-1 block text-[11.5px] text-white/45" lang="ta">கவனம் செலுத்துகிறது…</span>
            </div>
          </div>
        )}

        {/* Autoplay was refused. One tap fixes it, so offer the tap rather than
            leaving a black rectangle. */}
        {phase === 'live' && playBlocked && (
          <div className="absolute inset-0 grid place-items-center px-6">
            <button
              onClick={() => { videoRef.current?.play().then(markReady).catch(() => {}); }}
              className="rounded-full border border-white/40 px-5 py-2.5 text-[14px] text-white"
            >
              Tap to start the camera <span className="ta font-normal opacity-70" lang="ta">· தட்டுங்கள்</span>
            </button>
          </div>
        )}

        {phase === 'live' && isCasting && (
          <div
            className="pointer-events-none absolute inset-0 m-5 rounded-[6px] border border-white/45 shadow-[0_0_0_999px_rgba(20,20,26,0.45)]"
            aria-hidden="true"
          />
        )}
      </div>

      {phase === 'error' && faultCopy && (
        <div className="enter mt-3 rounded-[4px] border border-dashed border-rule-22 px-4 py-4">
          <div className="text-[16px] font-semibold tracking-[-.02em] text-ink">{faultCopy.en}</div>
          <div className="ta mt-1 text-[13.5px] text-ink-60" lang="ta">{faultCopy.ta}</div>
          <p className="mt-3 mb-0 max-w-[54ch] text-[14px] leading-[1.6] text-ink-60">{faultCopy.enBody}</p>
          <div className="ta mt-1.5 max-w-[46ch] text-[12.5px] leading-[1.6] text-ink-40" lang="ta">{faultCopy.taBody}</div>
          {faultCopy.retry && (
            <button onClick={() => startCamera(selectedDeviceId)} className="btn-quiet mt-3.5">
              Try the camera again <span className="ta font-normal opacity-70" lang="ta">· மீண்டும்</span>
            </button>
          )}
        </div>
      )}

      {phase === 'live' && (
        <>
          <div className="mt-4 flex flex-col items-center gap-2.5">
            <button
              onClick={captureAndExtract}
              disabled={!isCasting}
              className="grid h-16 w-16 place-items-center rounded-full bg-ink text-white shadow-lift
                         transition-transform duration-200 active:scale-[.96]
                         disabled:opacity-35 disabled:shadow-none"
              aria-label={ta ? 'படம் எடு' : 'Capture the document'}
            >
              <CameraGlyph />
            </button>
            <span className="mono text-[9.5px] tracking-[.12em] text-ink-55">Fit the whole card in the frame</span>
            <span className="ta text-[12px] text-ink-30" lang="ta">அட்டை முழுவதும் சட்டத்திற்குள் இருக்கட்டும்</span>
          </div>

          {devices.length > 1 && (
            <div className="mt-4">
              <label className="mono mb-1.5 block text-[9.5px] tracking-[.12em] text-ink-55" htmlFor="sevai-camera-select">
                Camera
              </label>
              <select
                id="sevai-camera-select"
                value={selectedDeviceId}
                onChange={switchCamera}
                className="w-full rounded-[4px] border border-rule-16 bg-white px-3.5 py-2.5 text-[14px]
                           focus:border-ink focus:outline-none"
              >
                {devices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      {/* Always present, in every state — not a consolation prize after a
          failure. On a desktop with no webcam this is the whole flow. */}
      {fileFallback}
    </div>
  );
}

// ── glyphs ──────────────────────────────────────────────────────────────────
function CameraGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8.5h2.6l1.3-2h8.2l1.3 2H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13.5" r="3.4" />
    </svg>
  );
}

function ImageGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <circle cx="8.5" cy="10" r="1.6" />
      <path d="m4 17 4.8-4.4a1.4 1.4 0 0 1 1.9 0L15 17" />
      <path d="m14 15 1.6-1.5a1.4 1.4 0 0 1 1.9 0L20 16" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4.5 12.5 4.6 4.6L19.5 6.7" />
    </svg>
  );
}
