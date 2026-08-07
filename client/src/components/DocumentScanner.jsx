/**
 * DocumentScanner.jsx
 * Live camera capture → /api/extract-document → auto-fills vault fields.
 * Ported from mridah-shivakumar/Sevai-TN_with_camera_integration.
 *
 * The camera pipeline below (enumeration, getUserMedia fallback, canvas
 * capture, the /api/extract-document POST) is untouched. Only the surface has
 * changed: the brand-green gradient trigger and the black chrome are gone.
 *
 * The video panel itself stays dark on purpose — it is the one place in the
 * product where a dark field is functional rather than decorative. A card held
 * up to the lens reads best against a neutral dark surround, and the light UI
 * would otherwise bleed into the framing guide. It sits inside a normal light
 * card so it reads as a viewfinder set into the page, not a mode switch.
 */
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

export default function DocumentScanner({ onDataExtracted, lang = 'en', autoOpen = false, onClose }) {
  const [isOpen, setIsOpen] = useState(autoOpen);
  const [isCasting, setIsCasting] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);

  const ta = lang === 'ta';

  // Enumerate cameras on mount
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then((devs) => {
      const v = devs.filter((d) => d.kind === 'videoinput');
      setDevices(v);
      if (v.length > 0) setSelectedDeviceId(v[0].deviceId);
    });
  }, []);

  // Auto-open when prop changes
  useEffect(() => {
    if (autoOpen && selectedDeviceId) openCamera(selectedDeviceId);
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen, selectedDeviceId]);

  const openCamera = async (deviceId) => {
    setIsOpen(true);
    setErrorMsg(null);
    setIsCasting(false);
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(
          deviceId ? { video: { deviceId: { exact: deviceId } } } : { video: true },
        );
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try { await videoRef.current.play(); } catch { /* interrupted */ }
      }
    } catch (err) {
      console.error('Camera error:', err);
      setErrorMsg(
        lang === 'ta' ? 'கேமரா அணுகல் மறுக்கப்பட்டது.' : 'Camera access denied or unavailable.',
      );
      setIsCasting(false);
    }
  };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setIsCasting(false);
  };

  const cancelScanner = () => {
    stopStream();
    setIsOpen(false);
    setErrorMsg(null);
    onClose?.();
  };

  const handleSwitchCamera = (e) => {
    stopStream();
    setSelectedDeviceId(e.target.value);
    openCamera(e.target.value);
  };

  const captureAndExtract = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64Image = canvas.toDataURL('image/jpeg', 0.8);

    stopStream();
    setIsExtracting(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/extract-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image }),
      });
      if (!res.ok) throw new Error('extraction_failed');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setIsExtracting(false);
      setIsOpen(false);
      onDataExtracted?.(data, base64Image);
    } catch (err) {
      console.error('Extraction error:', err);
      setIsExtracting(false);
      setIsOpen(false);
      onDataExtracted?.({}, base64Image); // still mark doc done even if extraction fails
    }
  };

  // ── Closed state: show trigger button ────────────────────────────────────
  if (!isOpen) {
    return (
      <button
        onClick={() => openCamera(selectedDeviceId)}
        className="option flex items-center gap-3.5"
        lang={lang}
      >
        <span className="w-10 h-10 rounded-full bg-surface-sub grid place-items-center shrink-0 text-ink">
          <CameraGlyph />
        </span>
        <span className="min-w-0">
          <span className="block font-semibold text-[15px] text-ink">
            {ta ? 'ஸ்மார்ட் ஸ்கேன்' : 'Smart Scan'}
          </span>
          <span className="block text-[13px] text-muted leading-snug">
            {ta ? 'கேமரா மூலம் தானாக நிரப்பு' : 'Auto-fill using your camera'}
          </span>
        </span>
      </button>
    );
  }

  // ── Extracting state ─────────────────────────────────────────────────────
  if (isExtracting) {
    return (
      <div className="card flex flex-col items-center justify-center text-center gap-3 min-h-[208px]">
        <span className="w-11 h-11 rounded-full bg-surface-sub grid place-items-center text-ink">
          <DocumentGlyph />
        </span>
        <div className="text-[16px] font-semibold text-ink" lang={lang}>
          {ta ? 'தரவை பிரித்தெடுக்கிறது…' : 'Reading your document…'}
        </div>
        <div className="text-[13px] text-muted max-w-[240px] leading-snug" lang={lang}>
          {ta ? 'ஆவணத்திலிருந்து விவரங்கள் எடுக்கப்படுகின்றன' : 'Pulling the details off the card'}
        </div>
        <div
          className="mt-1 h-[3px] w-40 rounded-full bg-surface-sub overflow-hidden"
          style={{ boxShadow: 'inset 0 0 0 1px var(--hairline)' }}
        >
          <motion.div
            initial={{ width: '10%' }}
            animate={{ width: '92%' }}
            transition={{ duration: 2.4, ease: [0.22, 1, 0.36, 1] }}
            className="h-full rounded-full bg-ink"
          />
        </div>
      </div>
    );
  }

  // ── Live camera view ─────────────────────────────────────────────────────
  return (
    <div className="card !p-4">
      <canvas ref={canvasRef} className="hidden" />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full bg-ink animate-pulse-slow shrink-0" aria-hidden="true" />
          <span className="u-meta" lang={lang}>
            {ta ? 'கேமரா நேரடி காட்சி' : 'Live camera'}
          </span>
        </div>
        <button
          onClick={cancelScanner}
          className="btn-ghost compact !px-3 !py-1.5 text-[13px] shrink-0"
          aria-label={ta ? 'மூடு' : 'Close'}
          lang={lang}
        >
          {ta ? 'மூடு' : 'Close'}
        </button>
      </div>

      {/* Viewfinder. Dark by function — a document reads best against neutral
          dark, and the framing guide needs contrast to be visible at all. */}
      <div className="relative rounded-well overflow-hidden bg-[#14131A]">
        {!isCasting && !errorMsg && (
          <div className="absolute inset-0 flex items-center justify-center h-40 z-10">
            <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onPlay={() => setIsCasting(true)}
          className={`w-full h-auto max-h-[45vh] object-cover ${errorMsg ? 'hidden' : 'block'}`}
        />
        {/* Document guide overlay */}
        {isCasting && !errorMsg && (
          <div className="absolute inset-0 border border-white/45 m-5 rounded-[10px] shadow-[0_0_0_999px_rgba(20,19,26,0.5)] pointer-events-none" />
        )}
        {errorMsg && (
          <div className="p-8 h-40 flex items-center justify-center text-center text-[14px] text-white/80" lang={lang}>
            {errorMsg}
          </div>
        )}
      </div>

      {/* Camera selector (multi-camera devices) */}
      {devices.length > 1 && (
        <div className="mt-3">
          <label className="u-meta block mb-1.5" htmlFor="sevai-camera-select" lang={lang}>
            {ta ? 'கேமரா தேர்வு' : 'Select camera'}
          </label>
          <select
            id="sevai-camera-select"
            value={selectedDeviceId}
            onChange={handleSwitchCamera}
            className="w-full rounded-well bg-surface text-ink text-[14px] px-4 py-2.5
                       focus:outline-none focus:ring-2 focus:ring-ink/15"
            style={{ boxShadow: 'inset 0 0 0 1px var(--hairline)' }}
          >
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Capture */}
      <div className="mt-4 flex flex-col items-center gap-2">
        {errorMsg ? (
          <button onClick={() => openCamera(selectedDeviceId)} className="btn-secondary compact !py-3" lang={lang}>
            {ta ? 'மீண்டும் முயற்சிக்கவும்' : 'Try again'}
          </button>
        ) : (
          <>
            <button
              onClick={captureAndExtract}
              disabled={!isCasting}
              className="w-16 h-16 rounded-full bg-ink text-white grid place-items-center
                         shadow-e2 transition-all duration-240 ease-composed
                         active:scale-[0.96] disabled:opacity-35 disabled:shadow-none"
              aria-label={ta ? 'படம் எடு' : 'Capture'}
            >
              <CameraGlyph />
            </button>
            <span className="u-meta" lang={lang}>
              {ta ? 'ஆவணத்தை சட்டத்திற்குள் வையுங்கள்' : 'Fit the document in the frame'}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function CameraGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 8.5h2.6l1.3-2h8.2l1.3 2H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13.5" r="3.4" />
    </svg>
  );
}

function DocumentGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4Z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 16h4" />
    </svg>
  );
}
