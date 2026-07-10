"""
Cadastral Parcel Crawler - Guland API (Multi-threaded)
-------------------------------------------------------
Crawls parcel information via the `/get-bound-2` endpoint for the configured
GeoJSON boundary files. Each configured ward/commune is saved to its own JSONL:
  - chu_dat            : owner name
  - loai_dat           : land type (code + name)
  - dia_chi            : address
  - dien_tich_m2       : area in m2
  - so_thua            : parcel number
  - so_to              : sheet number
  - toa_do_duong_bao   : boundary polygon coordinates [[lng, lat], ...]

Walks a regular grid over the bounding box (spacing configurable via
GRID_SPACING_METERS), keeping only grid points that fall inside the
boundary polygon. Already-processed parcels (by item_id) are tracked in a
sidecar file so the script can be stopped and resumed without re-querying
the same parcel.

Runs the grid points across multiple worker threads (NUM_WORKERS) for
faster crawling.

Run:
    python crawl.py
"""

import json
import math
import os
import re
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed

import geopandas as gpd
import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from shapely.geometry import Point
from urllib3.util.retry import Retry


# ----------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------

WARDS_CONFIG = [
    {
        "name": "Dong_Hieu",
        "geojson_path": "dong_hieu.geojson",
        "output_path": "dong_hieu.jsonl",
        "seen_ids_path": "dong_hieu_seen_ids.json"
    },
    {
        "name": "Tay_Hieu",
        "geojson_path": "tay_hieu.geojson",
        "output_path": "tay_hieu.jsonl",
        "seen_ids_path": "tay_hieu_seen_ids.json"
    },
    {
        "name": "Thai_Hoa",
        "geojson_path": "thai_hoa.geojson",
        "output_path": "thai_hoa.jsonl",
        "seen_ids_path": "thai_hoa_seen_ids.json"
    }
]

PROVINCE_ID = 40
DISTRICT_ID = 17017

GET_BOUND_URL = "https://guland.vn/get-bound-2"

BASE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
    ),
    "Origin": "https://guland.vn",
    "Referer": "https://guland.vn/soi-quy-hoach/nghe-an/xa-dong-hieu",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
}

# Distance between adjacent grid points, in meters.
# Smaller spacing = more thorough coverage but many more requests.
# ~100m is a reasonable balance for rural/agricultural parcels.
GRID_SPACING_METERS = 50

# Number of parallel worker threads.
# The server reported x-ratelimit-limit: 120 (per minute, presumably).
# With NUM_WORKERS=10 and ~1.5s delay per request per worker, that's
# roughly 10 * (60/1.5) = 400 req/min -> too high. Tune REQUEST_DELAY
# and NUM_WORKERS together to stay under the limit, e.g.
# 10 workers * (60 / 6s) = 100 req/min.
NUM_WORKERS = 10

# Delay between requests *within each worker* (seconds).
# Combined with NUM_WORKERS this controls overall request rate:
#   approx_requests_per_minute = NUM_WORKERS * (60 / REQUEST_DELAY)
REQUEST_DELAY = 6.0

TIMEOUT = 30  # seconds


# Only keep records whose land type code (ma_loai_dat) is one of these
ALLOWED_LAND_TYPES = ["ODT", "ONT"]


# ----------------------------------------------------------------------
# Shared state + locks
# ----------------------------------------------------------------------
results_lock = threading.Lock()
seen_ids_lock = threading.Lock()
print_lock = threading.Lock()

results = []
seen_item_ids = set()

OUTPUT_PATH = ""
SEEN_IDS_PATH = ""

# Track progress counters for logging
progress_counter = 0
progress_lock = threading.Lock()


def safe_print(*args, **kwargs):
    with print_lock:
        print(*args, **kwargs)


# ----------------------------------------------------------------------
# Per-thread session setup
# ----------------------------------------------------------------------
def build_session():
    session = requests.Session()
    retries = Retry(
        total=3,
        backoff_factor=1.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET", "POST"],
    )
    adapter = HTTPAdapter(max_retries=retries, pool_connections=NUM_WORKERS, pool_maxsize=NUM_WORKERS)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def init_session_for_thread():
    """
    Create and initialize a fresh session (with cookies + CSRF token) for
    one worker thread. Each thread gets its own session/cookies so they
    don't clobber each other's CSRF token / XSRF cookie.
    """
    session = build_session()
    headers = BASE_HEADERS.copy()

    try:
        url_soi_quy_hoach = "https://guland.vn/soi-quy-hoach/nghe-an/xa-dong-hieu"

        initial_headers = headers.copy()
        initial_headers.pop("X-Requested-With", None)
        initial_headers.pop("X-CSRF-TOKEN", None)

        res = session.get(url_soi_quy_hoach, headers=initial_headers, timeout=TIMEOUT)
        res.raise_for_status()

        soup = BeautifulSoup(res.text, "html.parser")
        csrf_meta = soup.find("meta", {"name": "csrf-token"})

        if csrf_meta and csrf_meta.get("content"):
            csrf_token = csrf_meta["content"]
            headers["X-CSRF-TOKEN"] = csrf_token
            session.headers.update(headers)

            # Emulate map page load APIs
            geocoding_url = "https://guland.vn/map/geocoding"
            geocoding_data = {
                "lat": "19.2918581",
                "lng": "105.4752614",
                "path": "soi-quy-hoach/nghe-an/xa-dong-hieu",
            }
            session.post(geocoding_url, data=geocoding_data, headers=headers)

            gen_link_url = "https://guland.vn/generate-link"
            gen_link_params = {
                "province_id": "40",
                "district_id": "414",
                "ward_id": "17017",
                "road_id": "",
                "user_map_id": "",
                "prev_url": url_soi_quy_hoach,
                "current_url": url_soi_quy_hoach,
            }
            session.get(gen_link_url, params=gen_link_params, headers=headers)

            get_header_url = "https://guland.vn/get-header-home"
            get_header_params = {
                "province_id": "40",
                "district_id": "414",
                "ward_id": "17017",
                "road_id": "",
                "current_path": "soi-quy-hoach/nghe-an/xa-dong-hieu",
            }
            session.get(get_header_url, params=get_header_params, headers=headers)
        else:
            safe_print("Warning: Could not find CSRF token on main page (one worker).")
    except Exception as e:
        safe_print(f"Error initializing session for worker: {e}")

    return session, headers


# ----------------------------------------------------------------------
# Helper: normalize Vietnamese text (remove diacritics, lowercase)
# ----------------------------------------------------------------------
def normalize_text(text):
    """Lowercase + strip Vietnamese diacritics for robust comparison."""
    if not text:
        return ""

    text = text.lower()
    text = text.replace("đ", "d")
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return text


# ----------------------------------------------------------------------
# Step 1: Load boundary
# ----------------------------------------------------------------------
def load_boundary(geojson_path):
    gdf = gpd.read_file(geojson_path)
    polygon = gdf.union_all()
    minx, miny, maxx, maxy = polygon.bounds  # (lng_min, lat_min, lng_max, lat_max)
    return polygon, (minx, miny, maxx, maxy)


# ----------------------------------------------------------------------
# Step 2: Generate grid points covering the bbox, filtered to polygon
# ----------------------------------------------------------------------
def generate_grid_points(polygon, bbox, spacing_meters):
    """
    Generate a regular grid of (lat, lng) points spaced `spacing_meters`
    apart, keeping only points that fall strictly within `polygon`.
    """
    minx, miny, maxx, maxy = bbox  # lng_min, lat_min, lng_max, lat_max

    # Approximate meters-per-degree at this latitude
    avg_lat = (miny + maxy) / 2
    meters_per_deg_lat = 111320.0
    meters_per_deg_lng = 111320.0 * math.cos(math.radians(avg_lat))

    lat_step = spacing_meters / meters_per_deg_lat
    lng_step = spacing_meters / meters_per_deg_lng

    n_lat = max(1, math.ceil((maxy - miny) / lat_step))
    n_lng = max(1, math.ceil((maxx - minx) / lng_step))

    print(
        f"Grid spacing: {spacing_meters}m -> "
        f"lat_step={lat_step:.6f} deg, lng_step={lng_step:.6f} deg "
        f"=> grid size {n_lng + 1} x {n_lat + 1} "
        f"= {(n_lng + 1) * (n_lat + 1)} raw points"
    )

    points = []
    for i in range(n_lat + 1):
        lat = miny + i * lat_step
        for j in range(n_lng + 1):
            lng = minx + j * lng_step
            pt = Point(lng, lat)
            if pt.within(polygon):
                points.append((lat, lng))

    print(f"Grid points inside polygon: {len(points)}")
    return points


# ----------------------------------------------------------------------
# Seen item_ids persistence (for resume / dedup across runs)
# ----------------------------------------------------------------------
def load_seen_item_ids(path):
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                ids = json.load(f)
                return set(ids)
        except Exception:
            return set()
    return set()


def save_seen_item_ids_locked(path):
    """Caller must hold seen_ids_lock."""
    with open(path, "w", encoding="utf-8") as f:
        json.dump(sorted(seen_item_ids), f, ensure_ascii=False, indent=2)


# ----------------------------------------------------------------------
# Step 4: Call get-bound-2 (parcel info + boundary in one call)
# ----------------------------------------------------------------------
def fetch_parcel_data(session, headers, marker_lat, marker_lng):
    """Call /get-bound-2 with a clicked point and return the raw JSON dict."""
    data_payload = {
        "marker_lat": marker_lat,
        "marker_lng": marker_lng,
        "area": "",
        "shape": "",
        "force_remap_id": "",
        "province_id": PROVINCE_ID,
    }

    response = session.post(GET_BOUND_URL, data=data_payload, headers=headers, timeout=TIMEOUT)
    response.raise_for_status()
    data = response.json()

    if data.get("status") != 1:
        return None, data

    return data, None


# ----------------------------------------------------------------------
# Step 5: Parse HTML - extract required fields
# ----------------------------------------------------------------------
def parse_parcel_html(html_payload):
    soup = BeautifulSoup(html_payload, "html.parser")

    result = {
        "so_thua": None,
        "so_to": None,
        "dien_tich_m2": None,
        "ma_loai_dat": None,
        "ten_loai_dat": None,
        "ten_chu": None,
        "dia_chi": None,
    }

    # --- Parcel info: thua, to, dien tich ---
    pin_inf = soup.find("div", class_="sqh-pin-inf__tle")
    if pin_inf:
        text = pin_inf.get_text(separator=" ", strip=True)

        so_thua_match = re.search(r"Th[ửu]a\s*([\w\d]+)", text, re.IGNORECASE)
        so_to_match = re.search(r"T[ờo]\s*([\w\d]+)", text, re.IGNORECASE)
        dien_tich_match = re.search(r"Di[eệ]n\s*t[íi]ch[:\s]*([\d.,]+)\s*m", text, re.IGNORECASE)

        if so_thua_match:
            result["so_thua"] = so_thua_match.group(1)
        if so_to_match:
            result["so_to"] = so_to_match.group(1)
        if dien_tich_match:
            result["dien_tich_m2"] = dien_tich_match.group(1)

    # --- Land type code ---
    type_info_id = soup.find("div", class_="type-info__id")
    if type_info_id:
        result["ma_loai_dat"] = type_info_id.get_text(strip=True)

    # --- Land type name ---
    type_info_txt = soup.find("span", class_="type-info__txt")
    if type_info_txt:
        result["ten_loai_dat"] = type_info_txt.get_text(strip=True)

    # --- Owner name & Address (text-col__lbl / text-col__txt pattern) ---
    for label_div in soup.find_all("div", class_="text-col__lbl"):
        label_text = label_div.get_text(strip=True)
        value_div = label_div.find_next_sibling("div", class_="text-col__txt")

        if not value_div:
            continue

        value_text = value_div.get_text(strip=True)

        if "Tên chủ:" in label_text:
            result["ten_chu"] = value_text
        elif "Địa chỉ" in label_text:
            result["dia_chi"] = value_text

    # --- Fallback address: breadcrumb in sqh-pin-inf__adr blocks ---
    # There are usually two such blocks: a short one (commune only) and a
    # more detailed one (commune, district, province). Prefer the longer one.
    if not result["dia_chi"]:
        adr_blocks = soup.find_all("div", class_="sqh-pin-inf__adr")
        candidates = []
        for adr in adr_blocks:
            links = adr.find_all("a")
            parts = [a.get_text(strip=True) for a in links if a.get_text(strip=True)]
            if parts:
                candidates.append(", ".join(parts))

        if candidates:
            # Pick the most detailed (longest) breadcrumb
            result["dia_chi"] = max(candidates, key=len)

    return result


# ----------------------------------------------------------------------
# Step 6: Extract boundary polygon from "points"
# ----------------------------------------------------------------------
def extract_polygon_from_points(data):
    points = data.get("points")
    if not points or not isinstance(points, list):
        return None

    coordinates_ring = []
    for pt in points:
        try:
            lng = float(pt["lng"])
            lat = float(pt["lat"])
            coordinates_ring.append([lng, lat])
        except (KeyError, TypeError, ValueError):
            continue

    return coordinates_ring or None


# ----------------------------------------------------------------------
# Output persistence
# ----------------------------------------------------------------------
def load_existing_results(path):
    loaded = []
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        loaded.append(json.loads(line))
            return loaded
        except Exception:
            pass
    return []


def save_results_locked(path):
    """Caller must hold results_lock."""
    with open(path, "w", encoding="utf-8") as f:
        for r in results:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


# ----------------------------------------------------------------------
# Worker: process a single grid point
# ----------------------------------------------------------------------
def process_point(args):
    global progress_counter

    idx, total_points, lat, lng, session, headers = args

    with progress_lock:
        progress_counter += 1
        current = progress_counter

    prefix = f"[{current}/{total_points}]"

    try:
        # Step 4: Call get-bound-2
        try:
            data, raw_debug = fetch_parcel_data(session, headers, lat, lng)
        except requests.RequestException as e:
            safe_print(f"{prefix} [ERROR] Request failed: {e}")
            return
        except (ValueError, json.JSONDecodeError) as e:
            safe_print(f"{prefix} [ERROR] Invalid JSON response: {e}")
            return

        if not data:
            safe_print(f"{prefix} [SKIP] status != 1. lat={lat:.6f}, lng={lng:.6f}. raw={raw_debug}")
            return

        html_payload = data.get("html")
        if not html_payload or not isinstance(html_payload, str):
            safe_print(f"{prefix} [SKIP] No HTML payload. lat={lat:.6f}, lng={lng:.6f}")
            return

        # Dedup by item_id
        item_id = data.get("id")
        if item_id is not None:
            with seen_ids_lock:
                if item_id in seen_item_ids:
                    safe_print(f"{prefix} [SKIP] item_id {item_id} already processed.")
                    return

        # Step 5: Parse HTML
        try:
            parsed_data = parse_parcel_html(html_payload)
        except Exception as e:
            safe_print(f"{prefix} [PARSE ERROR] {e}")
            return

        # Skip if no useful land info at all
        if not any([parsed_data.get("so_thua"), parsed_data.get("ten_chu"),
                    parsed_data.get("ma_loai_dat")]):
            safe_print(f"{prefix} [PARSE] No relevant parcel data found, skipping.")
            return

        # Mark item_id as seen now that we know it's a real parcel
        if item_id is not None:
            with seen_ids_lock:
                seen_item_ids.add(item_id)
                save_seen_item_ids_locked(SEEN_IDS_PATH)

        # Log parsed info for every parcel, regardless of land type filter
        safe_print(
            f"{prefix} [INFO] "
            f"so_thua={parsed_data.get('so_thua')}, "
            f"so_to={parsed_data.get('so_to')}, "
            f"dien_tich_m2={parsed_data.get('dien_tich_m2')}, "
            f"loai_dat={parsed_data.get('ma_loai_dat')} "
            f"({parsed_data.get('ten_loai_dat')}), "
            f"ten_chu={parsed_data.get('ten_chu')}, "
            f"dia_chi={parsed_data.get('dia_chi')}"
        )

        # Filter by land type (only keep ODT or ONT)
        ma_loai_dat = parsed_data.get("ma_loai_dat", "")
        if not ma_loai_dat or not any(lt in ma_loai_dat.upper() for lt in ALLOWED_LAND_TYPES):
            safe_print(f"{prefix} [FILTER] Land type '{ma_loai_dat}' is not ODT/ONT, skipping.")
            return

        dia_chi = parsed_data.get("dia_chi")

        # Step 6: Boundary polygon
        parcel_coordinates = extract_polygon_from_points(data)

        # Step 7: Build final record - only requested fields
        record = {
            "chu_dat": parsed_data.get("ten_chu"),
            "loai_dat": {
                "ma_loai_dat": parsed_data.get("ma_loai_dat"),
                "ten_loai_dat": parsed_data.get("ten_loai_dat"),
            },
            "dia_chi": dia_chi,
            "dien_tich_m2": parsed_data.get("dien_tich_m2"),
            "so_thua": parsed_data.get("so_thua"),
            "so_to": parsed_data.get("so_to"),
            "toa_do_duong_bao": parcel_coordinates,
        }

        with results_lock:
            results.append(record)
            save_results_locked(OUTPUT_PATH)
            total = len(results)

        safe_print(f"{prefix} [SUCCESS] Record added and saved. Total records: {total}")

    except Exception as e:
        safe_print(f"{prefix} [UNEXPECTED ERROR] {e}")

    finally:
        time.sleep(REQUEST_DELAY)


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------
def main():
    global results, seen_item_ids, progress_counter, OUTPUT_PATH, SEEN_IDS_PATH

    for ward_config in WARDS_CONFIG:
        ward_name = ward_config["name"]
        geojson_path = ward_config["geojson_path"]
        OUTPUT_PATH = ward_config["output_path"]
        SEEN_IDS_PATH = ward_config["seen_ids_path"]
        progress_counter = 0

        print(f"\n=== Crawling {ward_name} ===")
        print(f"Loading boundary from {geojson_path} ...")
        polygon, bbox = load_boundary(geojson_path)
        print(f"Bounding box: {bbox}")

        grid_points = generate_grid_points(polygon, bbox, GRID_SPACING_METERS)
        total_points = len(grid_points)

        results = load_existing_results(OUTPUT_PATH)
        seen_item_ids = load_seen_item_ids(SEEN_IDS_PATH)

        print(f"Resuming with {len(results)} existing records, "
              f"{len(seen_item_ids)} already-seen item_ids.")

        print(f"Initializing {NUM_WORKERS} worker sessions...")
        worker_sessions = []
        for i in range(NUM_WORKERS):
            session, headers = init_session_for_thread()
            worker_sessions.append((session, headers))
            print(f"  Worker {i + 1}/{NUM_WORKERS} session ready.")

        # Build task list: round-robin assign a worker session to each point
        tasks = []
        for idx, (lat, lng) in enumerate(grid_points):
            session, headers = worker_sessions[idx % NUM_WORKERS]
            tasks.append((idx + 1, total_points, lat, lng, session, headers))

        print(f"\nStarting crawl with {NUM_WORKERS} threads, "
              f"{total_points} points, delay={REQUEST_DELAY}s per request per thread "
              f"(~{NUM_WORKERS * (60 / REQUEST_DELAY):.0f} req/min total).\n")

        with ThreadPoolExecutor(max_workers=NUM_WORKERS) as executor:
            futures = [executor.submit(process_point, t) for t in tasks]
            for f in as_completed(futures):
                # process_point already handles its own errors/logging
                f.result()

        print(f"\nDone with {ward_name}. {len(results)} records saved to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()