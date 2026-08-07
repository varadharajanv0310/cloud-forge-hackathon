#!/usr/bin/env python3
"""
fetch_schemes.py — myScheme.gov.in harvester (supersedes scrapeSchemes.js)

Why Python: the Node path needed Playwright (a ~2 GB browser download) purely to
borrow a session cookie. Plain HTTP with a cookie jar does the same job, so this
runs anywhere python3 exists — which on macOS is everywhere.

Two-stage harvest:

  Stage 1 — FACET INVERSION.
    myScheme indexes each scheme against structured facets (gender, caste,
    occupation, age band, BPL, residence, ...) but does not return them on the
    scheme record. So we query once per facet VALUE and record which slugs come
    back. Inverting that mapping gives structured eligibility for every scheme
    without a per-scheme call — and replaces the regex guessing in
    normalizeLocal.js that produced "income under Rs 5 per year".

  Stage 2 — DETAIL FETCH.
    Per-slug call for the prose the facets can't carry: benefits_md (money),
    eligibilityDescription_md (thresholds), applicationProcess (real apply URL
    + mode), documents_required.

Output: raw_schemes.json  — consumed by normalize_schemes.py
Resumable: progress is checkpointed, so an interrupted run picks up where it
stopped instead of re-fetching.

Usage:
    python3 server/scraper/fetch_schemes.py                  # default demo scope
    python3 server/scraper/fetch_schemes.py --scope all      # every state
    python3 server/scraper/fetch_schemes.py --states "Tamil Nadu,Kerala"
"""

import argparse
import json
import os
import re
import sys
import time
import threading
import urllib.parse
import urllib.request
import http.cookiejar
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
RAW_FILE = os.path.join(HERE, "raw_schemes.json")
FACET_FILE = os.path.join(HERE, "facet_index.json")
PROGRESS_FILE = os.path.join(HERE, "fetch_progress.json")

SITE = "https://www.myscheme.gov.in"
SEARCH_API = "https://api.myscheme.gov.in/search/v6/schemes"
DETAIL_API = "https://api.myscheme.gov.in/schemes/v6/public/schemes"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

PAGE_SIZE = 100          # server accepts far more than the JS scraper's 20
DETAIL_WORKERS = 5       # modest concurrency; myScheme is a public gov service
DETAIL_DELAY = 0.12      # per-worker politeness delay between detail calls
SEARCH_DELAY = 0.20

# Facets worth inverting. Everything here becomes structured eligibility.
# Values are discovered at runtime from the facet listing, not hardcoded.
ELIGIBILITY_FACETS = [
    "gender", "caste", "occupation", "residence", "minority", "disability",
    "maritalStatus", "employmentStatus", "isStudent", "isBpl",
    "isEconomicDistress", "isGovEmployee", "benefitTypes", "applicationMode",
    "dbtScheme", "schemeType", "age-general", "disabilityPercentage",
]

# Demo scope: central schemes reach everyone; the states prove that
# central+own-state scoping actually excludes other states' schemes.
DEFAULT_STATES = ["Tamil Nadu", "Kerala", "Karnataka", "Maharashtra", "Andhra Pradesh"]

_print_lock = threading.Lock()


def log(msg):
    with _print_lock:
        print(msg, flush=True)


class MySchemeClient:
    """Thin HTTP client that mirrors what the site's own frontend sends.

    The API rejects a bare key (401). It needs the key *plus* a session cookie
    and a matching Origin/Referer, which is exactly the combination the
    Playwright scraper was getting for free by running inside a real page.
    """

    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar)
        )
        self.api_key = None

    # -- session -----------------------------------------------------------
    def establish(self):
        log("Establishing session ...")
        html = self._get(f"{SITE}/search", headers={"User-Agent": UA}, raw=True)
        self.api_key = self._discover_api_key(html)
        if not self.api_key:
            raise SystemExit(
                "Could not locate the public API key in the site bundle.\n"
                "myScheme may have changed its frontend. Inspect a request from\n"
                "the site in devtools and pass the x-api-key value via "
                "MYSCHEME_API_KEY."
            )
        log(f"  session ready, api key {self.api_key[:6]}...{self.api_key[-4:]}")

    def _discover_api_key(self, html):
        env_key = os.environ.get("MYSCHEME_API_KEY")
        if env_key:
            return env_key
        chunks = re.findall(r'/_next/static/[^"\']+\.js', html)
        seen = set()
        for chunk in chunks:
            if chunk in seen:
                continue
            seen.add(chunk)
            try:
                js = self._get(SITE + chunk, headers={"User-Agent": UA}, raw=True)
            except Exception:
                continue
            m = re.search(r'["\']x-api-key["\']\s*:\s*["\']([^"\']+)["\']', js)
            if m:
                return m.group(1)
        return None

    # -- transport ---------------------------------------------------------
    def _get(self, url, headers=None, raw=False, retries=3):
        last = None
        for attempt in range(retries):
            req = urllib.request.Request(url, headers=headers or {})
            try:
                with self.opener.open(req, timeout=30) as r:
                    body = r.read().decode("utf-8", "replace")
                return body if raw else json.loads(body)
            except Exception as e:  # transient network / 5xx
                last = e
                time.sleep(0.6 * (attempt + 1))
        raise last

    def api(self, url):
        return self._get(url, headers={
            "x-api-key": self.api_key,
            "Accept": "application/json",
            "Origin": SITE,
            "Referer": f"{SITE}/",
            "User-Agent": UA,
        })

    # -- queries -----------------------------------------------------------
    def search(self, filters, frm=0, size=PAGE_SIZE):
        q = urllib.parse.quote(json.dumps(filters))
        url = (f"{SEARCH_API}?lang=en&q={q}&keyword=&sort=&from={frm}&size={size}")
        return self.api(url)

    def search_all(self, filters, label="", cap=None):
        """Page through a filtered search, returning every hit."""
        out, frm = [], 0
        first = self.search(filters, 0, PAGE_SIZE)
        total = (first.get("data", {}).get("summary", {}) or {}).get("total", 0)
        if cap:
            total = min(total, cap)
        out.extend(self._items(first))
        frm = PAGE_SIZE
        while frm < total:
            time.sleep(SEARCH_DELAY)
            out.extend(self._items(self.search(filters, frm, PAGE_SIZE)))
            frm += PAGE_SIZE
        if label:
            log(f"    {label:<52} {len(out):>5}")
        return out

    @staticmethod
    def _items(resp):
        hits = resp.get("data", {}).get("hits", {}) or {}
        return hits.get("items") or []

    def facets(self):
        resp = self.search([], 0, 1)
        return resp.get("data", {}).get("facets", []) or []

    def detail(self, slug):
        return self.api(f"{DETAIL_API}?slug={urllib.parse.quote(slug)}&lang=en")


# --------------------------------------------------------------------------
# Stage 1 — facet inversion
# --------------------------------------------------------------------------
# Facet values that mean "no restriction". A scheme carrying these is not
# narrowed by that facet, so recording them buys nothing — and they are by far
# the most expensive queries (gender=All matches ~4000 schemes). Their absence
# in the index is read as "unrestricted" by the normalizer.
DEFAULT_FACET_VALUES = {"All", "No", "Both", "all", "no", "both"}


def build_facet_index(client, _scope_filters=None):
    """slug -> {facet_identifier: [values]} for the whole corpus.

    Queried globally rather than per scope: a facet value's slug set is the same
    regardless of which states we care about, so scoping the query would just
    re-fetch the same rows once per scope. We intersect with the listing later.

    Only *restrictive* values are recorded (see DEFAULT_FACET_VALUES), which
    cuts the query count by roughly an order of magnitude and makes the
    resulting index mean exactly what the matcher needs: "this scheme is
    limited to X".
    """
    log("\nStage 1 - facet inversion (structured eligibility)")
    facets = client.facets()
    wanted = [f for f in facets if f.get("identifier") in ELIGIBILITY_FACETS]

    plan = []
    for facet in wanted:
        ident = facet.get("identifier")
        for entry in (facet.get("entries") or facet.get("values") or []):
            # The search index returns facet options under "label"; the filter
            # API takes that same string as its "value". Older/other endpoints
            # use "value", so accept either.
            value = entry.get("value") or entry.get("label")
            count = entry.get("count") or 0
            if value is None or count == 0:
                continue
            if str(value) in DEFAULT_FACET_VALUES:
                continue
            plan.append((ident, value, count))

    pages = sum(-(-c // PAGE_SIZE) for _, _, c in plan)
    log(f"  {len(wanted)} facets -> {len(plan)} restrictive values, ~{pages} pages")

    index = {}

    def record(slug, ident, value):
        bucket = index.setdefault(slug, {}).setdefault(ident, [])
        if value not in bucket:
            bucket.append(value)

    for i, (ident, value, count) in enumerate(plan, 1):
        try:
            hits = client.search_all([{"identifier": ident, "value": value}])
        except Exception as e:
            log(f"    ! {ident}={value}: {e}")
            continue
        for h in hits:
            slug = (h.get("fields") or {}).get("slug")
            if slug:
                record(slug, ident, value)
        if i % 10 == 0 or i == len(plan):
            log(f"    [{i}/{len(plan)}] {ident}={value} "
                f"({count} schemes) | index={len(index)}")
        time.sleep(SEARCH_DELAY)

    with open(FACET_FILE, "w") as f:
        json.dump(index, f)
    log(f"  facet index: {len(index)} schemes -> {FACET_FILE}")
    return index


# --------------------------------------------------------------------------
# Stage 2 — listing + detail
# --------------------------------------------------------------------------
def collect_listing(client, scope_filters, scope_labels):
    """Basic record per scheme from the search index (cheap, no detail call)."""
    log("\nStage 2a - scheme listing")
    listing = {}
    for filters, label in zip(scope_filters, scope_labels):
        hits = client.search_all(filters, label=label)
        for h in hits:
            fields = h.get("fields") or {}
            slug = fields.get("slug")
            if not slug:
                continue
            if slug in listing:
                # Scheme appears under several scopes (e.g. central + state
                # listing). Keep the first, but union the state list so the
                # normalizer can see full reach.
                prev = listing[slug].setdefault("beneficiaryState", [])
                for s in fields.get("beneficiaryState") or []:
                    if s not in prev:
                        prev.append(s)
                continue
            listing[slug] = {
                "slug": slug,
                "schemeName": fields.get("schemeName"),
                "schemeShortTitle": fields.get("schemeShortTitle"),
                "level": fields.get("level"),
                "beneficiaryState": list(fields.get("beneficiaryState") or []),
                "schemeCategory": list(fields.get("schemeCategory") or []),
                "schemeCloseDate": fields.get("schemeCloseDate"),
                "briefDescription": fields.get("briefDescription"),
                "tags": list(fields.get("tags") or []),
                "schemeFor": fields.get("schemeFor"),
            }
    log(f"  unique schemes in scope: {len(listing)}")
    return listing


def flatten_process(process):
    """applicationProcess[].process is a slate-style rich-text tree."""
    out = []

    def walk(node):
        if isinstance(node, dict):
            if isinstance(node.get("text"), str):
                out.append(node["text"])
            for child in node.get("children") or []:
                walk(child)
        elif isinstance(node, list):
            for n in node:
                walk(n)

    walk(process)
    return " ".join(t.strip() for t in out if t and t.strip())


def fetch_details(client, slugs, done_map):
    """Per-slug detail fetch, threaded, resumable."""
    log(f"\nStage 2b - detail fetch ({len(slugs)} pending, "
        f"{len(done_map)} already cached)")
    results = dict(done_map)
    counter = {"n": 0, "err": 0}
    total = len(slugs)

    def work(slug):
        time.sleep(DETAIL_DELAY)
        try:
            d = client.detail(slug)
        except Exception as e:
            counter["err"] += 1
            return slug, {"_error": str(e)}
        en = (d.get("data") or {}).get("en") or {}
        basic = en.get("basicDetails") or {}
        content = en.get("schemeContent") or {}
        elig = en.get("eligibilityCriteria") or {}
        procs = en.get("applicationProcess") or []

        def label(v):
            if isinstance(v, dict):
                return v.get("label") or v.get("value")
            return v

        modes, urls = [], []
        for p in procs:
            if not isinstance(p, dict):
                continue
            if p.get("mode"):
                modes.append(p["mode"])
            u = (p.get("url") or "").strip()
            if u:
                urls.append(u)

        return slug, {
            "state": label(basic.get("state")),
            "level": label(basic.get("level")),
            "nodalMinistryName": label(basic.get("nodalMinistryName")),
            "nodalDepartmentName": label(basic.get("nodalDepartmentName")),
            "schemeSubCategory": [label(c) for c in (basic.get("schemeSubCategory") or [])],
            "targetBeneficiaries": [label(c) for c in (basic.get("targetBeneficiaries") or [])],
            "schemeOpenDate": basic.get("schemeOpenDate"),
            "dbtScheme": basic.get("dbtScheme"),
            "benefits_md": content.get("benefits_md") or "",
            "benefitTypes": label(content.get("benefitTypes")),
            "detailedDescription_md": content.get("detailedDescription_md") or "",
            "exclusions_md": content.get("exclusions_md") or "",
            "eligibilityDescription_md": elig.get("eligibilityDescription_md") or "",
            "documents_required": en.get("documents_required"),
            "application_modes": modes,
            "application_urls": urls,
            "application_process_text": flatten_process(procs)[:1500],
            "references": content.get("references") or [],
        }

    with ThreadPoolExecutor(max_workers=DETAIL_WORKERS) as pool:
        futures = {pool.submit(work, s): s for s in slugs}
        for fut in as_completed(futures):
            slug, payload = fut.result()
            results[slug] = payload
            counter["n"] += 1
            n = counter["n"]
            if n % 50 == 0 or n == total:
                log(f"    [{n}/{total}] fetched  ({counter['err']} errors)")
                with open(PROGRESS_FILE, "w") as f:
                    json.dump(results, f)

    with open(PROGRESS_FILE, "w") as f:
        json.dump(results, f)
    log(f"  detail fetch complete ({counter['err']} errors)")
    return results


# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scope", choices=["demo", "all"], default="demo",
                    help="demo = central + a handful of states; all = every state")
    ap.add_argument("--states", default="",
                    help="comma-separated state list (overrides --scope)")
    ap.add_argument("--skip-facets", action="store_true",
                    help="reuse an existing facet_index.json")
    ap.add_argument("--limit", type=int, default=0,
                    help="cap detail fetches (smoke test)")
    args = ap.parse_args()

    client = MySchemeClient()
    client.establish()

    # Discover the real state list rather than trusting a hardcoded one.
    all_facets = client.facets()
    state_facet = next((f for f in all_facets
                        if f.get("identifier") == "beneficiaryState"), {})
    available = [(e.get("value") or e.get("label"))
                 for e in (state_facet.get("entries") or [])
                 if (e.get("value") or e.get("label"))]
    log(f"\nCorpus: {len(available)} state buckets available")

    if args.states:
        states = [s.strip() for s in args.states.split(",") if s.strip()]
    elif args.scope == "all":
        states = [s for s in available if s != "All"]
    else:
        states = [s for s in DEFAULT_STATES if s in available]

    # Central schemes and "All"-state schemes reach every citizen; state
    # buckets are scoped. Both go in the corpus, tagged, and the client filters.
    scopes, labels = [], []
    scopes.append([{"identifier": "level", "value": "Central"}])
    labels.append("level=Central")
    if "All" in available:
        scopes.append([{"identifier": "beneficiaryState", "value": "All"}])
        labels.append("beneficiaryState=All")
    for s in states:
        scopes.append([{"identifier": "beneficiaryState", "value": s}])
        labels.append(f"beneficiaryState={s}")

    log(f"Scope: Central + All + {len(states)} states -> {', '.join(states)}")

    listing = collect_listing(client, scopes, labels)

    if args.skip_facets and os.path.exists(FACET_FILE):
        facet_index = json.load(open(FACET_FILE))
        log(f"\nStage 1 skipped, reusing {len(facet_index)} facet records")
    else:
        facet_index = build_facet_index(client, scopes)

    done = {}
    if os.path.exists(PROGRESS_FILE):
        try:
            done = json.load(open(PROGRESS_FILE))
            done = {k: v for k, v in done.items() if "_error" not in v}
        except Exception:
            done = {}

    slugs = [s for s in listing if s not in done]
    if args.limit:
        slugs = slugs[:args.limit]
    details = fetch_details(client, slugs, done)

    raw = []
    for slug, base in listing.items():
        rec = dict(base)
        rec["facets"] = facet_index.get(slug, {})
        rec["detail"] = details.get(slug, {})
        rec["myscheme_url"] = f"{SITE}/schemes/{slug}"
        raw.append(rec)

    with open(RAW_FILE, "w") as f:
        json.dump(raw, f, indent=1)

    with_detail = sum(1 for r in raw if r["detail"] and "_error" not in r["detail"])
    with_facets = sum(1 for r in raw if r["facets"])
    log(f"\nWrote {len(raw)} schemes -> {RAW_FILE}")
    log(f"   with detail: {with_detail}   with facets: {with_facets}")
    log("\nNext: python3 server/scraper/normalize_schemes.py")


if __name__ == "__main__":
    main()
