/**
 * schemesStore.js — sharded scheme loading.
 *
 * v1 did `import { SCHEMES } from '../data/schemes.js'` — a 421 KB JS module for
 * 233 Tamil Nadu schemes, bundled into the app. At India scale that module is
 * ~6 MB, which breaks the low-bandwidth premise the whole product rests on.
 *
 * v2 fetches JSON shards from /public/data at runtime instead:
 *
 *   central.json            reaches every citizen
 *   state-tamil-nadu.json   only Tamil Nadu residents
 *
 * A citizen downloads central + their own state and nothing else, so the
 * "central + own state" scoping rule is also the sharding key — Kerala's
 * schemes are never shipped to a Tamil Nadu phone in the first place.
 *
 * The shards live in client/public/, so the existing service worker
 * (cache-first for non-/api GETs) makes them available offline after one visit.
 */
import { useEffect, useState } from 'react';

const DATA_BASE = '/data';
const DEFAULT_STATE = 'Tamil Nadu';

// Module-level cache: survives route changes, one fetch per shard per session.
let _manifest = null;
let _manifestPromise = null;
const _shardCache = new Map();   // file -> Promise<Scheme[]>
let _byId = new Map();           // id -> scheme, union of everything loaded
let _lastLoaded = [];

const stateSlug = (name) =>
  String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function fetchJson(path) {
  const res = await fetch(`${DATA_BASE}/${path}`, { cache: 'default' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

/** Manifest of available shards. Fetched once. */
export function loadManifest() {
  if (_manifest) return Promise.resolve(_manifest);
  if (!_manifestPromise) {
    _manifestPromise = fetchJson('index.json')
      .then((m) => { _manifest = m; return m; })
      .catch((e) => { _manifestPromise = null; throw e; });
  }
  return _manifestPromise;
}

function loadShard(file) {
  if (!_shardCache.has(file)) {
    _shardCache.set(
      file,
      fetchJson(file).catch((e) => { _shardCache.delete(file); throw e; }),
    );
  }
  return _shardCache.get(file);
}

/**
 * Schemes visible to a citizen of `stateName`: central + that one state.
 * Never returns another state's schemes.
 */
export async function loadSchemes(stateName = DEFAULT_STATE) {
  const manifest = await loadManifest().catch(() => null);

  const wanted = ['central.json'];
  const slug = stateSlug(stateName);
  if (slug) {
    const entry = manifest?.states?.find((s) => s.slug === slug);
    wanted.push(entry?.file || `state-${slug}.json`);
  }

  const parts = await Promise.all(
    // A missing state shard is not fatal — central schemes still apply.
    wanted.map((f) => loadShard(f).catch(() => [])),
  );

  const merged = [];
  const seen = new Set();
  for (const part of parts) {
    for (const s of part) {
      if (s && s.id && !seen.has(s.id)) {
        seen.add(s.id);
        merged.push(s);
      }
    }
  }

  _byId = new Map(merged.map((s) => [s.id, s]));
  _lastLoaded = merged;
  return merged;
}

/** Synchronous lookup. Valid only after a load has resolved. */
export function getSchemeById(id) {
  return _byId.get(id);
}

/** Everything currently loaded (empty before the first load resolves). */
export function getLoadedSchemes() {
  return _lastLoaded;
}

/**
 * React binding.
 *
 * @param {string} [stateName] citizen's state; defaults to Tamil Nadu.
 * @returns {{schemes, byId, loading, error, manifest}}
 */
export function useSchemes(stateName = DEFAULT_STATE) {
  const [state, setState] = useState(() => ({
    schemes: _lastLoaded,
    byId: _byId,
    loading: _lastLoaded.length === 0,
    error: null,
    manifest: _manifest,
  }));

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));

    Promise.all([loadSchemes(stateName), loadManifest().catch(() => null)])
      .then(([schemes, manifest]) => {
        if (!alive) return;
        setState({ schemes, byId: _byId, loading: false, error: null, manifest });
      })
      .catch((error) => {
        if (!alive) return;
        setState((s) => ({ ...s, loading: false, error }));
      });

    return () => { alive = false; };
  }, [stateName]);

  return state;
}
