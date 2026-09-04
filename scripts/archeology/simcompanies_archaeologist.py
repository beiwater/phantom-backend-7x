#!/usr/bin/env python3
"""
Sim Companies Historical Frontend Archaeologist
================================================
A polite, rate-limited, resumable tool to discover, download, and analyze
historical Sim Companies frontend bundles, detect source maps, and extract
unmangled AngularJS / early React source code.

Features:
- Anti-Ban Rate Limiting: Polite delays (2-3s with jitter) + exponential backoff.
- Local Disk Cache: Never re-fetches existing assets. Resumable.
- Raw Asset Retrieval: Uses `id_` prefix on Wayback to avoid wombat wrapper injection.
- Sourcemap Detection: Identifies sourceMappingURL, inline maps, and probes `.map` availability.
- Source Extraction: If `sourcesContent` is found in a `.map`, extracts the original source tree.
- Architecture Classifier: Classifies AngularJS (controllers/services), Django-compressor, CRA, Vite.
"""

import os
import sys
import re
import time
import json
import random
import urllib.request
import urllib.error
from urllib.parse import urljoin, urlparse
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
OUTPUT_DIR = BASE_DIR / "artifacts" / "archeology"
CACHE_DIR = OUTPUT_DIR / "cache"
RESTORED_DIR = OUTPUT_DIR / "restored-sources"

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "SimCompaniesHistoricalResearch/1.0 (+https://github.com/archive-research)",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
]

class PoliteSession:
    def __init__(self, min_delay=2.0, max_delay=3.5, max_retries=3):
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.max_retries = max_retries
        self.last_req_time = 0.0

    def wait(self):
        elapsed = time.time() - self.last_req_time
        target_delay = random.uniform(self.min_delay, self.max_delay)
        if elapsed < target_delay:
            time.sleep(target_delay - elapsed)
        self.last_req_time = time.time()

    def fetch(self, url, as_json=False):
        for attempt in range(self.max_retries):
            self.wait()
            req = urllib.request.Request(url, headers={"User-Agent": random.choice(USER_AGENTS)})
            try:
                with urllib.request.urlopen(req, timeout=25) as resp:
                    data = resp.read()
                    if as_json:
                        return json.loads(data.decode('utf-8'))
                    return data.decode('utf-8', errors='ignore')
            except urllib.error.HTTPError as e:
                if e.code in (429, 503, 504):
                    backoff = (attempt + 1) * 5 + random.uniform(1, 3)
                    print(f"  [Warn] HTTP {e.code} for {url}. Backing off {backoff:.1f}s...")
                    time.sleep(backoff)
                    continue
                elif e.code == 404:
                    return None
                else:
                    print(f"  [HTTP Error {e.code}] {url}")
                    return None
            except urllib.error.URLError as e:
                backoff = (attempt + 1) * 6 + random.uniform(2, 4)
                print(f"  [Conn Error {e}] for {url}. Waiting {backoff:.1f}s...")
                time.sleep(backoff)
                continue
            except Exception as e:
                print(f"  [Unknown Error] {url}: {e}")
                return None
        return None

class Archaeologist:
    def __init__(self):
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        RESTORED_DIR.mkdir(parents=True, exist_ok=True)
        self.session = PoliteSession(min_delay=2.0, max_delay=3.0)
        self.inventory_file = OUTPUT_DIR / "inventory.json"
        self.inventory = self.load_inventory()

    def load_inventory(self):
        if self.inventory_file.exists():
            try:
                with open(self.inventory_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass
        return {"snapshots": {}, "findings": []}

    def save_inventory(self):
        with open(self.inventory_file, 'w', encoding='utf-8') as f:
            json.dump(self.inventory, f, indent=2, ensure_ascii=False)

    def probe_wayback_snapshot(self, target_date):
        """Query Wayback Availability API for a timestamp target (e.g. 20191201)."""
        url = f"https://archive.org/wayback/available?url=https://www.simcompanies.com/&timestamp={target_date}"
        res = self.session.fetch(url, as_json=True)
        if not res:
            return None
        snap = res.get('archived_snapshots', {}).get('closest', {})
        if snap.get('available'):
            return {
                "timestamp": snap.get('timestamp'),
                "url": snap.get('url'),
                "status": snap.get('status')
            }
        return None

    def fetch_snapshot_html(self, timestamp):
        """Fetch raw HTML for a snapshot without Wayback client rewrites (id_)."""
        cache_path = CACHE_DIR / f"{timestamp}_index.html"
        if cache_path.exists():
            with open(cache_path, 'r', encoding='utf-8') as f:
                return f.read()

        raw_url = f"https://web.archive.org/web/{timestamp}id_/https://www.simcompanies.com/"
        print(f"[*] Downloading snapshot HTML: {raw_url}")
        html = self.session.fetch(raw_url)
        if html:
            with open(cache_path, 'w', encoding='utf-8') as f:
                f.write(html)
        return html

    def extract_scripts_from_html(self, html, timestamp):
        """Extract external and inline scripts from HTML."""
        if not html:
            return []
        script_srcs = re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', html)
        cleaned = []
        for src in script_srcs:
            # Strip Wayback URL prefixes
            norm = re.sub(r'^https?://web\.archive\.org/web/\d+(?:js_|id_)?/', '', src)
            # Skip analytics/trackers
            if any(t in norm.lower() for t in ['archive.org', 'amplitude', 'google', 'facebook', 'reddit', 'ruffle', 'html5shiv', 'respond']):
                continue
            cleaned.append(norm)
        return list(dict.fromkeys(cleaned))

    def download_script(self, timestamp, script_url):
        """Download a raw script with local caching."""
        parsed = urlparse(script_url)
        fname = os.path.basename(parsed.path) or "script.js"
        safe_fname = f"{timestamp}_{fname}"
        cache_path = CACHE_DIR / safe_fname

        if cache_path.exists():
            with open(cache_path, 'r', encoding='utf-8') as f:
                return cache_path, f.read()

        # Build raw Wayback URL using id_
        if script_url.startswith("http"):
            target_url = f"https://web.archive.org/web/{timestamp}id_/{script_url}"
        else:
            target_url = f"https://web.archive.org/web/{timestamp}id_/https://www.simcompanies.com{script_url}"

        print(f"    -> Fetching script: {fname} from {target_url}")
        content = self.session.fetch(target_url)
        if content:
            with open(cache_path, 'w', encoding='utf-8') as f:
                f.write(content)
            return cache_path, content
        return None, None

    def probe_sourcemap(self, timestamp, script_url, content):
        """Analyze content for source maps, and probe .map URLs."""
        findings = {
            "sourceMappingURL": None,
            "has_inline_map": False,
            "map_url_discovered": None,
            "map_downloaded": False,
            "has_sources_content": False,
            "source_files_count": 0
        }

        # 1. Check for inline sourcemap
        if "data:application/json;base64," in content:
            findings["has_inline_map"] = True
            print("      [!] INLINE SOURCE MAP DETECTED!")

        # 2. Check sourceMappingURL comment
        sm_match = re.findall(r'sourceMappingURL=([^\s\'"]+)', content)
        if sm_match:
            map_ref = sm_match[0]
            findings["sourceMappingURL"] = map_ref
            print(f"      [!] sourceMappingURL referenced: {map_ref}")

            # Determine absolute map URL
            if map_ref.startswith("http"):
                abs_map_url = map_ref
            else:
                abs_map_url = urljoin(script_url, map_ref)

            findings["map_url_discovered"] = abs_map_url
            # Probe archive.org for the map file!
            map_wb_url = f"https://web.archive.org/web/{timestamp}id_/{abs_map_url}"
            print(f"      -> Probing map archive: {map_wb_url}")
            map_content = self.session.fetch(map_wb_url)
            if map_content:
                findings["map_downloaded"] = True
                print("      [GOLDEN FIND!] Source map downloaded successfully!")
                self.extract_and_save_map(timestamp, abs_map_url, map_content, findings)

        # 3. If no comment, probe script_url + ".map" speculatively
        else:
            speculative_map = script_url + ".map"
            map_wb_url = f"https://web.archive.org/web/{timestamp}id_/{speculative_map}"
            # Only probe if script is substantial
            if len(content) > 5000:
                map_content = self.session.fetch(map_wb_url)
                if map_content and len(map_content) > 200:
                    findings["map_downloaded"] = True
                    print("      [GOLDEN FIND!] Speculative .map succeeded!")
                    self.extract_and_save_map(timestamp, speculative_map, map_content, findings)

        return findings

    def extract_and_save_map(self, timestamp, map_url, map_content, findings):
        """Inspect and unpack sourcemap sourcesContent if present."""
        try:
            map_data = json.loads(map_content)
            sources = map_data.get("sources", [])
            contents = map_data.get("sourcesContent", [])
            findings["source_files_count"] = len(sources)

            if contents and any(bool(c) for c in contents):
                findings["has_sources_content"] = True
                print(f"      [TREASURE CHEST UNLOCKED!] Found {len(contents)} original source files in sourcesContent!")

                # Unpack sources to RESTORED_DIR
                unpack_dir = RESTORED_DIR / timestamp
                unpack_dir.mkdir(parents=True, exist_ok=True)
                for src_path, src_code in zip(sources, contents):
                    if not src_code:
                        continue
                    clean_path = re.sub(r'^(?:webpack:///|\./|src/)+', '', src_path)
                    dest_file = unpack_dir / clean_path
                    dest_file.parent.mkdir(parents=True, exist_ok=True)
                    with open(dest_file, 'w', encoding='utf-8') as f:
                        f.write(src_code)
                print(f"      -> Unpacked {len(contents)} source files to {unpack_dir}")
        except Exception as e:
            print(f"      [Error parsing map JSON]: {e}")

    def classify_architecture(self, content):
        """Identify architecture and extracted features."""
        features = []
        if "angular.module(" in content:
            features.append("AngularJS")
            modules = re.findall(r'angular\.module\(["\']([^"\']+)["\']', content)
            if modules:
                features.append(f"Modules: {list(set(modules))[:3]}")
            controllers = re.findall(r'\.controller\(["\']([^"\']+)["\']', content)
            if controllers:
                features.append(f"Controllers: {len(controllers)}")
            factories = re.findall(r'\.(?:factory|service)\(["\']([^"\']+)["\']', content)
            if factories:
                features.append(f"Services: {len(factories)}")

        if "webpackJsonp" in content or "__webpack_require__" in content:
            features.append("Webpack")
        if "react" in content.lower() and ("createElement" in content or "Component" in content):
            features.append("React")
        if "django" in content.lower() or "this.Urls" in content:
            features.append("Django-Compressor")

        return ", ".join(features) if features else "Standard/Vendor JS"

    def scan_target_years(self, targets):
        """Run archaeological scan across target timestamps."""
        print("=" * 70)
        print("SIM COMPANIES ARCHAEOLOGICAL DIG")
        print(f"Targets: {targets}")
        print("=" * 70)

        for target in targets:
            print(f"\n[+] Processing Target Date: {target}")
            snap = self.probe_wayback_snapshot(target)
            if not snap:
                print(f"  [-] No snapshot found near {target}")
                continue

            ts = snap["timestamp"]
            print(f"  [+] Closest snapshot resolved: {ts} ({snap['url']})")
            if ts not in self.inventory["snapshots"]:
                self.inventory["snapshots"][ts] = {
                    "timestamp": ts,
                    "target": target,
                    "scripts": []
                }

            html = self.fetch_snapshot_html(ts)
            scripts = self.extract_scripts_from_html(html, ts)
            print(f"  [+] Found {len(scripts)} target scripts")

            for s_url in scripts:
                print(f"\n  [*] Inspecting: {s_url}")
                path, content = self.download_script(ts, s_url)
                if not content:
                    continue

                arch = self.classify_architecture(content)
                sm_findings = self.probe_sourcemap(ts, s_url, content)

                record = {
                    "url": s_url,
                    "size": len(content),
                    "architecture": arch,
                    "sourcemap": sm_findings
                }
                self.inventory["snapshots"][ts]["scripts"].append(record)
                self.save_inventory()
                print(f"      Architecture: {arch} | Size: {len(content)}B")

        print("\n" + "=" * 70)
        print("DIG COMPLETE. Reviewing inventory...")
        print(f"Output saved to: {OUTPUT_DIR}")
        print("=" * 70)

if __name__ == "__main__":
    archaeologist = Archaeologist()
    # Target dates representing key eras:
    # 2016 (Initial AngularJS), 2017, 2018, 2019 (Late AngularJS/Django-compressor), 2020 (CRA/React migration)
    test_targets = [
        "20161001",
        "20170801",
        "20180601",
        "20190101",
        "20191201",
        "20200501",
        "20201101",
    ]
    archaeologist.scan_target_years(test_targets)
