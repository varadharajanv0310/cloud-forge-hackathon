import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { detectQrFromBitmap, QR_SUPPORT } from '../utils/documentQr.js';

/**
 * SahayakHandover — the two halves of handing your phone to someone who is
 * helping you, and the QR that passes between them.
 *
 * WHY A QR AND NOT A CODE
 * The old flow was a six-digit code and a PIN, both spoken aloud at a counter
 * with a queue behind you. Everything wrong with that is social rather than
 * cryptographic: you cannot say a PIN quietly in a government office, and the
 * person behind you hears it. A QR is shown, not spoken. It is on the citizen's
 * own screen, it lasts two minutes, and it dies the moment it is used.
 *
 * WHAT EACH SIDE SEES
 *   <Grant>  runs on the CITIZEN's phone. It asks the server for a signed token
 *            and draws it, with a countdown so nobody wonders whether it is
 *            still good, and the short code underneath for when the camera will
 *            not focus in bad light — which in a government office it often
 *            will not.
 *   <Redeem> runs on the HELPER's phone. It reads the QR with the same
 *            BarcodeDetector the document scanner uses, and exchanges it for a
 *            scoped session on their own device.
 *
 * The QR never leaves the citizen's screen: it is not sent, stored or printed.
 * A photograph of it is worthless once it expires or is redeemed, whichever
 * comes first — and both of those are enforced on the server, not here.
 */

/* ── the citizen's side ──────────────────────────────────────────────────── */

export function SahayakGrant({ vault, lang = 'en', onDone }) {
  const ta = lang === 'ta';
  const [state, setState] = useState({ status: 'idle', svg: null, shortCode: null, expiresAt: 0 });
  const [remaining, setRemaining] = useState(0);

  const issue = useCallback(async () => {
    setState((s) => ({ ...s, status: 'issuing' }));
    try {
      const res = await fetch('/api/sahayak/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beneficiary: vault }),
      });
      const data = await res.json();
      if (!data?.token) throw new Error('no token');

      // Drawn as an SVG string rather than a canvas: it scales to any screen
      // without going soft, and a soft QR is a QR that will not scan across a
      // desk in poor light.
      const svg = await QRCode.toString(data.token, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 1,
        color: { dark: '#14141A', light: '#FFFFFF' },
      });
      setState({ status: 'ready', svg, shortCode: data.shortCode, expiresAt: data.expiresAt });
    } catch {
      setState({ status: 'error', svg: null, shortCode: null, expiresAt: 0 });
    }
  }, [vault]);

  // The countdown is the point, so it runs on an interval rather than a rAF —
  // rAF is suspended when the screen dims, and a phone lying on a desk while
  // someone fetches their reading glasses is exactly when this must keep time.
  useEffect(() => {
    if (state.status !== 'ready') return undefined;
    const tick = () => setRemaining(Math.max(0, state.expiresAt - Date.now()));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [state.status, state.expiresAt]);

  const dead = state.status === 'ready' && remaining <= 0;
  const secs = Math.ceil(remaining / 1000);

  return (
    <div className="panel px-5 py-5">
      <div className="mono text-[10px] tracking-[.12em] text-ink-55">Hand this phone to a helper</div>

      {state.status === 'idle' && (
        <>
          <p className="mt-3 mb-0 text-[14px] leading-[1.6] text-ink-90 max-w-[46ch]">
            Show a code on this screen for them to scan. It lasts two minutes, works once, and
            never shows your community, disability or marital status — they are not sent at all.
          </p>
          <button onClick={issue} className="btn mt-4">Show the code</button>
        </>
      )}

      {state.status === 'issuing' && (
        <div className="mt-4 text-[14px] text-ink-45 animate-svPulse">Making a code…</div>
      )}

      {state.status === 'error' && (
        <>
          <p className="mt-3 mb-0 text-[14px] leading-[1.6] text-ink-90">
            Could not make a code. The Sevai API may not be running.
          </p>
          <button onClick={issue} className="btn-quiet mt-3">Try again</button>
        </>
      )}

      {state.status === 'ready' && (
        <>
          <div className="mt-4 flex flex-col items-center">
            <div
              className={`w-[218px] h-[218px] bg-white border border-rule-14 rounded-[6px] p-2 ${dead ? 'opacity-25' : ''}`}
              /* The SVG comes from the qrcode library operating on a token this
                 app just minted — not from anything a user or a network typed. */
              dangerouslySetInnerHTML={{ __html: state.svg }}
              aria-label="Handover code"
            />

            {dead ? (
              <>
                <div className="mono text-[10px] tracking-[.11em] text-ink-45 mt-3">This code has expired</div>
                <button onClick={issue} className="btn-quiet mt-3">Show a new one</button>
              </>
            ) : (
              <>
                <div className="mono tabular text-[11px] tracking-[.11em] text-ink-55 mt-3">
                  Expires in {secs}s
                </div>
                {/* Spoken only as a last resort, and short enough to say once. */}
                <div className="mt-3 text-center">
                  <div className="mono text-[9.5px] tracking-[.12em] text-ink-30">
                    If the camera will not read it
                  </div>
                  <div className="mono tabular text-[19px] tracking-[.14em] mt-1">{state.shortCode}</div>
                </div>
              </>
            )}
          </div>

          <p className="mt-4 mb-0 text-[12.5px] leading-[1.6] text-ink-40 max-w-[46ch]">
            The code stays on this screen. It is not sent anywhere, and it stops working the moment
            they scan it — so a photograph of it is worth nothing afterwards.
          </p>
          {onDone && (
            <button onClick={onDone} className="btn-quiet mt-3">Done</button>
          )}
        </>
      )}
    </div>
  );
}

/* ── the helper's side ───────────────────────────────────────────────────── */

export function SahayakRedeem({ lang = 'en', onSession }) {
  const ta = lang === 'ta';
  const [phase, setPhase] = useState('idle');   // idle | scanning | working | error
  const [message, setMessage] = useState(null);
  const [manual, setManual] = useState('');
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const busyRef = useRef(false);

  const stop = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    busyRef.current = false;
  }, []);

  // Teardown belongs to unmount alone. Hanging it off the scanning state was
  // the bug that kept the document scanner from ever opening.
  useEffect(() => () => stop(), [stop]);

  const redeem = useCallback(async (token) => {
    setPhase('working');
    stop();
    try {
      const res = await fetch('/api/sahayak/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!data?.ok) {
        // The server's refusals are already written for a person to read, so
        // they are shown as-is rather than flattened to "invalid code".
        setMessage(data?.message || 'That code could not be used.');
        setPhase('error');
        return;
      }
      onSession?.(data);
    } catch {
      setMessage('Could not reach Sevai. Check the connection and try again.');
      setPhase('error');
    }
  }, [onSession, stop]);

  const startScan = useCallback(async () => {
    setMessage(null);
    if (!QR_SUPPORT.detector) {
      setMessage('This browser cannot read QR codes. Type the short code instead.');
      setPhase('error');
      return;
    }
    setPhase('scanning');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      timerRef.current = setInterval(async () => {
        if (busyRef.current || !videoRef.current?.videoWidth) return;
        busyRef.current = true;
        try {
          const payloads = await detectQrFromBitmap(videoRef.current);
          const hit = (payloads || []).find((p) => typeof p === 'string' && p.includes('.'));
          if (hit) await redeem(hit);
        } finally {
          busyRef.current = false;
        }
      }, 300);
    } catch {
      setMessage('Camera unavailable. Type the short code instead.');
      setPhase('error');
    }
  }, [redeem]);

  return (
    <div className="panel px-5 py-5">
      <div className="mono text-[10px] tracking-[.12em] text-ink-55">Scan their code</div>
      <p className="mt-3 mb-0 text-[14px] leading-[1.6] text-ink-90 max-w-[46ch]">
        Ask them to show the handover code on their own phone, then point this camera at it.
        Everything you do afterwards is written to their record.
      </p>

      {phase === 'scanning' && (
        <div className="mt-4 rounded-[6px] overflow-hidden bg-[#14131A] relative">
          <video ref={videoRef} autoPlay playsInline muted className="w-full max-h-[46vh] object-cover" />
          <div className="absolute inset-0 m-8 border border-white/45 rounded-[8px] pointer-events-none" />
        </div>
      )}

      {message && (
        <div className="mt-3 text-[13.5px] leading-[1.55] text-ink-90">{message}</div>
      )}

      {phase !== 'scanning' && (
        <button onClick={startScan} className="btn mt-4">
          {phase === 'error' ? 'Try the camera again' : 'Open the camera'}
        </button>
      )}

      {/* The short code is a CONFIRMATION, not a way in.
          It was tempting to let a helper type it when the camera fails, and
          that is exactly the six-digit code this design replaced: six
          characters are guessable, and accepting them would hand back the
          weakness the signature removed. So it only lets the two of them agree
          they are looking at the same handover. If the camera cannot read the
          code, the answer is a new code in better light, not a weaker door. */}
      <div className="mt-4 rule-t pt-3.5">
        <label className="mono text-[9.5px] tracking-[.12em] text-ink-45 block" htmlFor="sahayak-confirm">
          Check you are both on the same code
        </label>
        <div className="flex gap-2 mt-2 items-center">
          <input
            id="sahayak-confirm"
            value={manual}
            onChange={(e) => setManual(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
            className="w-[130px] border border-rule-16 rounded-[4px] px-3 h-11 text-[15px] mono tracking-[.14em] bg-white"
          />
          <span className="text-[13px] text-ink-45">
            the six characters under their QR
          </span>
        </div>
        <div className="text-[12px] leading-[1.55] text-ink-30 mt-2">
          Typing it does not open a session — only scanning the code does. It is here so you can be
          sure you are helping the person in front of you.
        </div>
      </div>
    </div>
  );
}

export default SahayakGrant;
