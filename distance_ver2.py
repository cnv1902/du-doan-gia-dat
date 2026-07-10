# -*- coding: utf-8 -*-
"""Update parcel GeoJSON files with distances to configured POI blocks."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

try:
    import geopandas as gpd
    import networkx as nx
    import osmnx as ox
    import pandas as pd
    from geopy.distance import great_circle
    from shapely.geometry import Point, LineString, Polygon
    from shapely.ops import nearest_points
    from tqdm.auto import tqdm
except ImportError as exc:
    raise SystemExit(
        "Missing package. Install dependencies first:\n"
        "  pip install geopandas shapely osmnx networkx pandas geopy tqdm xlrd\n\n"
        f"Original import error: {exc}"
    ) from exc


BASE_DIR = Path(__file__).resolve().parent
ADDRESS_FILE = BASE_DIR / "list_address.xls"
GRAPH_FILE = BASE_DIR / "nghean_network.graphml"
PLACE_NAME = "Nghệ An, Vietnam"

PARCEL_FILES = ("DONG_HIEU.json", "TAY_HIEU.json", "THAI_HOA.json")

BLOCK_MAPPING: dict[str, list[str]] = {
    "KC_BX": [
        "Bến xe Nghĩa Đàn (cũ)",
    ],
    "KC_CA": [
        "Công an phường Hòa Hiếu",
        "Công an phường Long Sơn",
        "Công an phường Quang Phong",
        "Công an phường Quang Tiến",
        "Công an Phường Tây Hiếu(mới sau sáp nhập)",
        "Công an Phường Thái Hòa (mới sau sáp nhập)",
        "Công an xã Đông Hiếu(mới sau sáp nhập)",
        "Công an xã Nghĩa Mỹ",
        "Công an xã Nghĩa Tiến",
        "Công an xã Nghĩa Thuận",
    ],
    "KC_C": [
        "Chợ Chế Biến",
        "Chợ Đập Tràn",
        "Chợ Hiếu",
        "Chợ Lụi",
        "Chợ Nghĩa Thuận",
        "Chợ Quang Tiến",
    ],
    "KC_BV": [
        "PKĐK Tư nhân Đông Hiếu",
        "Phòng tiêm vắc xin TH Care Thái Hòa",
        "Trung Tâm Giáo Dục nghề nghiệp‑Giáo dục\nthường xuyên thị xã Thái Hòa",
        "BV Đa khoa KV Tây Bắc Nghệ An",
        "Trung tâm Y tế TX Thái Hòa",
    ],
    "KC_TH": [
        "Trường Mầm non Chim Sơn Ca – Thái Hòa",
        "Trường Mầm non Hòa Hiếu",
        "Trường Mầm non Nghĩa Mỹ",
        "Trường Mầm non Nghĩa Tiến",
        "Trường Mầm non Nghĩa Thuận",
        "Trường Mầm non Quang Phong",
        "Trường Mầm non Quang Tiến",
        "Trường Mầm non Sông Hiếu – Thái Hòa",
        "Trường tiều học Đông Hiếu",
        "Trường Tiểu học Hòa Hiếu 1",
        "Trường Tiểu học Hòa Hiếu 2",
        "Trường Tiểu học Long Sơn",
        "Trường tiểu học Nghĩa Hòa",
        "Trường Tiểu học Nghĩa Mỹ",
        "Trường Tiểu học Nghĩa Tiến",
        "Trường tiểu học Nghĩa Thuận A",
        "Trường tiểu học Nghĩa Thuận C",
        "Trường Tiểu học Quang Phong",
        "Trường Tiểu học Quang Tiến",
        "Trường Tiểu học Tây Hiếu",
        "Trường THCS Đông Hiếu",
        "Trường THCS Hòa Hiếu 1",
        "Trường THCS Hòa Hiếu 2",
        "Trường THCS Long Sơn",
        "Trường THCS Nghĩa Mỹ",
        "Trường THCS Nghĩa Thuận",
        "Trường THCS Quang Tiến",
        "Trường THCS Tây Hiếu",
        "Trường THPT Đông Hiếu",
        "Trường THPT Tây Hiếu",
        "Trường THPT Thái Hòa",
    ],
    "KC_UB": [
        "UBND phường Hòa Hiếu",
        "UBND phường Long Sơn",
        "UBND phường Quang Phong",
        "UBND phường Quang Tiến",
        "UBND thị xã thái hòa",
        "UBND xã Đông Hiếu",
        "UBND xã Nghĩa Mỹ",
        "UBND xã Nghĩa Tiến",
        "UBND xã Nghĩa Thuận",
        "UBND xã Tấy Hiếu",
    ],
    "KC_TTTM": [
        "Vincom Plaza Thái Hòa",
        "Vincom Shophouse Thái Hòa",
        "Green Hill",
        "Khu đô thị Golden City Thái Hòa",
        "Khu đô thị TNR Stars Thái Hòa",
    ],
    "KC_CC": [
        "Di chỉ Khảo cổ Làng Vạc",
        "Đền Bàu Sen",
    ],
    "KC_KCN": [
        "Khu công nghiệp Nghĩa Mỹ",
    ],
    "KC_TT": [
        "Trung tâm thị xã Thái hòa",
    ],
    "KC_XB": [
        "Điểm xe bus",
    ],
    "KC_BR": [
        "Điểm vứt rác",
    ],
}

BLOCKS_WITHOUT_ADDRESS = {"KC_XB", "KC_BR"}


def parse_lat_lon(value: Any) -> tuple[float, float]:
    parts = str(value).split(",")
    if len(parts) < 2:
        raise ValueError(f"Invalid coordinate value: {value!r}")
    return float(parts[0].strip()), float(parts[1].strip())


def read_address_file() -> Any:
    if not ADDRESS_FILE.exists():
        raise FileNotFoundError(f"Missing POI file: {ADDRESS_FILE}")

    if ADDRESS_FILE.suffix.lower() == ".csv":
        return pd.read_csv(ADDRESS_FILE)

    workbook = pd.ExcelFile(ADDRESS_FILE)
    for sheet_name in workbook.sheet_names:
        sheet = workbook.parse(sheet_name=sheet_name)
        sheet = sheet.dropna(axis=0, how="all").dropna(axis=1, how="all")
        if not sheet.empty:
            print(f"Reading POIs from sheet: {sheet_name}")
            return sheet

    raise ValueError(f"No data found in {ADDRESS_FILE}")


def load_pois() -> dict[str, list[dict[str, Any]]]:
    table = read_address_file()
    name_column = "Tên địa điểm" if "Tên địa điểm" in table.columns else table.columns[0]
    coord_column = "Tọa độ" if "Tọa độ" in table.columns else table.columns[1]

    block_by_name = {
        poi_name.strip().casefold(): block
        for block, poi_names in BLOCK_MAPPING.items()
        for poi_name in poi_names
    }
    pois_by_block: dict[str, list[dict[str, Any]]] = {block: [] for block in BLOCK_MAPPING}

    for _, row in table.iterrows():
        poi_name = str(row[name_column]).strip()
        block = block_by_name.get(poi_name.casefold())
        if not block:
            print(f"Skipping POI not in BLOCK_MAPPING: {poi_name}")
            continue

        lat, lon = parse_lat_lon(row[coord_column])
        pois_by_block[block].append(
            {
                "name": poi_name,
                "lat": lat,
                "lon": lon,
                "node": None,
            }
        )

    for block, pois in pois_by_block.items():
        print(f"{block}: {len(pois)} POIs")

    return pois_by_block


def load_graph() -> nx.MultiDiGraph:
    ox.settings.use_cache = True
    ox.settings.log_console = True

    if GRAPH_FILE.exists():
        print(f"Loading local network: {GRAPH_FILE.name}")
        return ox.load_graphml(GRAPH_FILE)

    print(f"Downloading bike network for {PLACE_NAME}. This first run may take a while.")
    graph = ox.graph_from_place(PLACE_NAME, network_type="bike")
    ox.save_graphml(graph, filepath=GRAPH_FILE)
    print(f"Saved network cache: {GRAPH_FILE}")
    return graph


def add_poi_nodes(nodes_gdf: gpd.GeoDataFrame, pois_by_block: dict[str, list[dict[str, Any]]]) -> None:
    all_pois = [poi for pois in pois_by_block.values() for poi in pois]
    for poi in tqdm(all_pois, desc="Snapping POIs", unit="poi"):
        try:
            point = Point(poi["lon"], poi["lat"])
            nearest_node_idx = nodes_gdf.sindex.nearest(point)[1][0]
            poi["node"] = nodes_gdf.iloc[nearest_node_idx].name
        except Exception:
            poi["node"] = None


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    return float(great_circle((lat1, lon1), (lat2, lon2)).kilometers)


def calc_distance_to_nearest_road(line_geom: LineString, lat: float, lon: float) -> float:
    """Tính khoảng cách vuông góc từ tọa độ thửa đất tới mặt đường gần nhất (mét)."""
    try:
        point = Point(lon, lat)
        nearest_pt_on_road = nearest_points(line_geom, point)[0]
        dist_km = haversine_km(lat, lon, nearest_pt_on_road.y, nearest_pt_on_road.x)
        return round(dist_km * 1000, 1)
    except Exception:
        return 999.0


def get_road_attributes(edge_data: dict) -> tuple[float, int, int]:
    """
    Trích xuất thuộc tính đường từ OSM và mã hóa (Encode) thành số cho Machine Learning.

    - Đơn vị GT_DRD: Mét (m)
    - GT_KCD (Kết cấu): 3=Nhựa, 2=Bê tông, 1=Đất/Đá/Khác
    - GT_LDTG (Loại đường): 4=Đường chính, 3=Đường liên xã, 2=Đường ngõ xóm, 1=Đường mòn
    """

    hw = edge_data.get("highway", "")
    if isinstance(hw, list):
        hw = hw[0]

    if hw in ["trunk", "primary", "secondary"]:
        ldtg = 4
        default_w, default_surf = 10.0, 3
    elif hw in ["tertiary", "unclassified"]:
        ldtg = 3
        default_w, default_surf = 6.0, 2
    elif hw in ["track", "path", "dirt"]:
        ldtg = 1
        default_w, default_surf = 2.0, 1
    else:
        ldtg = 2
        default_w, default_surf = 4.0, 2

    surf = edge_data.get("surface", "")
    if isinstance(surf, list):
        surf = surf[0]

    if surf in ["asphalt"]:
        kcd = 3
    elif surf in ["concrete", "paved"]:
        kcd = 2
    elif surf in ["dirt", "earth", "unpaved", "gravel", "sand"]:
        kcd = 1
    else:
        kcd = default_surf

    width = edge_data.get("width", None)
    if isinstance(width, list):
        width = width[0]
    try:
        drd = float(width)
    except (ValueError, TypeError):
        drd = default_w

    return round(drd, 1), kcd, ldtg


def count_adjacent_roads(geometry, edges_gdf, search_distance_deg=0.00005) -> int:
    """Đếm số mặt đường tiếp giáp (GT_SDTG) bằng cách dùng buffer 5m."""

    buffer_geom = geometry.buffer(search_distance_deg)
    possible_matches_idx = list(edges_gdf.sindex.intersection(buffer_geom.bounds))
    precise_matches = edges_gdf.iloc[possible_matches_idx][edges_gdf.iloc[possible_matches_idx].intersects(buffer_geom)]

    if precise_matches.empty:
        return 1

    names = [n[0] if isinstance(n, list) else n for n in precise_matches.get("name", []) if pd.notna(n)]
    unique_names = set(names)

    if len(unique_names) > 1:
        return len(unique_names)
    elif len(precise_matches) >= 3:
        return 2
    return 1


def get_parcel_geometry_features(metric_polygon, provided_area: float) -> tuple[int, float, float, float]:
    """
    Phân tích hình học thửa đất từ Polygon hệ mét (UTM).

    Returns: (TD_HD, TD_DT, TD_CS, TD_CR)
    """

    if metric_polygon is None or metric_polygon.is_empty or metric_polygon.geom_type not in ['Polygon', 'MultiPolygon']:
        return 2, provided_area, 0.0, 0.0

    dt = provided_area if provided_area > 0 else metric_polygon.area

    mrr = metric_polygon.minimum_rotated_rectangle
    if mrr.geom_type != 'Polygon':
        return 2, round(dt, 1), 0.0, 0.0

    coords = list(mrr.exterior.coords)
    edge1 = Point(coords[0]).distance(Point(coords[1]))
    edge2 = Point(coords[1]).distance(Point(coords[2]))

    width = min(edge1, edge2)
    depth = max(edge1, edge2)

    compactness = metric_polygon.area / mrr.area if mrr.area > 0 else 0
    ratio = depth / width if width > 0 else 0

    if compactness > 0.75:
        if ratio <= 3:
            hd = 3
        else:
            hd = 2
    else:
        hd = 1

    return hd, round(dt, 1), round(depth, 1), round(width, 1)


def shortest_distance_to_block(
    graph: nx.MultiDiGraph,
    parcel_lat: float,
    parcel_lon: float,
    parcel_node: Any | None,
    pois: list[dict[str, Any]],
    route_cache: dict[tuple[Any, Any], float],
) -> tuple[float | None, str]:
    if not pois:
        return None, ""

    candidates = []
    for poi in pois:
        h_km = haversine_km(parcel_lat, parcel_lon, poi["lat"], poi["lon"])
        candidates.append((h_km, poi))
    candidates = sorted(candidates, key=lambda item: item[0])[:3]

    best_distance = None
    best_poi_name = ""

    for h_km, poi in candidates:
        fallback_km = h_km * 1.3
        poi_node = poi["node"]

        if parcel_node is None or poi_node is None:
            distance_km = fallback_km
        else:
            cache_key = (parcel_node, poi_node)
            if cache_key in route_cache:
                distance_km = route_cache[cache_key]
            else:
                try:
                    distance_m = nx.shortest_path_length(
                        graph,
                        parcel_node,
                        poi_node,
                        weight="length",
                    )
                    distance_km = float(distance_m) / 1000.0
                    route_cache[cache_key] = distance_km
                except (nx.NetworkXNoPath, nx.NodeNotFound):
                    distance_km = fallback_km

        if best_distance is None or distance_km < best_distance:
            best_distance = distance_km
            best_poi_name = poi["name"]

    if best_distance is None:
        return None, ""
    return round(best_distance, 4), best_poi_name


def find_parcel_file(filename: str) -> Path:
    direct_path = BASE_DIR / filename
    if direct_path.exists():
        return direct_path

    matches = [
        path
        for path in BASE_DIR.rglob(filename)
        if path.is_file() and "venv" not in path.parts
    ]
    if not matches:
        raise FileNotFoundError(f"Could not find {filename}")

    matches.sort(key=lambda path: (len(path.parts), str(path)))
    return matches[0]


def prepare_gdf(path: Path) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(path)
    if gdf.crs is None:
        gdf = gdf.set_crs(epsg=4326, allow_override=True)
    elif gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)

    for block in BLOCK_MAPPING:
        gdf[block] = None
        if block not in BLOCKS_WITHOUT_ADDRESS:
            gdf[f"ADR_{block}"] = ""

    gdf["KC_DTG"] = None
    gdf["GT_DRD"] = None
    gdf["GT_KCD"] = None
    gdf["GT_LDTG"] = None
    gdf["GT_SDTG"] = 1
    gdf["TD_HD"] = None
    gdf["TD_DT"] = None
    gdf["TD_CS"] = None
    gdf["TD_CR"] = None
    gdf["QH_CGXD"] = 1
    # Khởi tạo nhóm Yếu tố Vĩ mô, Xã hội & Pháp lý (YT)
    for col in ["YT_DTH", "YT_MDDS", "YT_DC", "YT_YTGD", "YT_VHDC", "YT_PT", 
                "YT_TTKT", "YT_CCTT", "YT_TNTD", "YT_BDG", "YT_CSSD"]:
        gdf[col] = 1

    gdf["YT_LSUAT"] = 0.09
    gdf["YT_PLY"] = None
    gdf["YT_HCQH"] = None
    gdf["YT_MTKD"] = None
    gdf["MT_KK"] = None
    gdf["MT_NUOC"] = None
    gdf["MT_AT"] = None
    gdf["MT_ANXH"] = None

    return gdf


def process_geojson(
    path: Path,
    graph: nx.MultiDiGraph,
    pois_by_block: dict[str, list[dict[str, Any]]],
) -> None:
    print(f"Processing {path}")
    gdf = prepare_gdf(path)
    edges_gdf = ox.graph_to_gdfs(graph, nodes=False)
    route_cache: dict[tuple[Any, Any], float] = {}

    land_use = gdf["KHLOAIDAT"].astype(str).str.upper()
    residential_mask = (
        land_use.str.contains("ODT", regex=False, na=False)
        | land_use.str.contains("ONT", regex=False, na=False)
    )
    residential_gdf = gdf.loc[residential_mask]

    try:
        metric_crs = residential_gdf.estimate_utm_crs()
        residential_gdf_metric = residential_gdf.to_crs(metric_crs)
    except Exception:
        residential_gdf_metric = residential_gdf.copy()

    print(f"Residential parcels: {len(residential_gdf):,} / {len(gdf):,}")

    print("Extracting spatial index for ultra-fast querying...")
    nodes_gdf, edges_gdf = ox.graph_to_gdfs(graph)

    iterator = tqdm(
        residential_gdf.iterrows(),
        total=len(residential_gdf),
        desc=path.name,
        unit="parcel",
    )
    for index, row in iterator:
        geometry = row.geometry
        if geometry is None or geometry.is_empty:
            continue

        centroid = geometry.centroid
        parcel_lat = float(centroid.y)
        parcel_lon = float(centroid.x)

        point = Point(parcel_lon, parcel_lat)

        # 1. Tìm Node gần nhất siêu tốc
        try:
            nearest_node_idx = nodes_gdf.sindex.nearest(point)[1][0]
            parcel_node = nodes_gdf.iloc[nearest_node_idx].name
        except Exception:
            parcel_node = None

        # 2. Tìm Edge gần nhất siêu tốc để trích xuất giao thông
        try:
            nearest_edge_idx = edges_gdf.sindex.nearest(point)[1][0]
            nearest_edge = edges_gdf.iloc[nearest_edge_idx]
            u, v, key = nearest_edge.name
            edge_data = graph.get_edge_data(u, v, key)
            
            # Khôi phục LineString
            if "geometry" in edge_data:
                line_geom = edge_data["geometry"]
            else:
                x1, y1 = graph.nodes[u]["x"], graph.nodes[u]["y"]
                x2, y2 = graph.nodes[v]["x"], graph.nodes[v]["y"]
                line_geom = LineString([(x1, y1), (x2, y2)])
                
            drd, kcd, ldtg = get_road_attributes(edge_data)
        except Exception:
            line_geom = None
            drd, kcd, ldtg = 4.0, 2, 2

        # 3. Gán KC_DTG
        if line_geom:
            gdf.at[index, "KC_DTG"] = calc_distance_to_nearest_road(line_geom, parcel_lat, parcel_lon)
        else:
            gdf.at[index, "KC_DTG"] = 999.0

        sdtg = count_adjacent_roads(geometry, edges_gdf)

        gdf.at[index, "GT_DRD"] = drd
        gdf.at[index, "GT_KCD"] = kcd
        gdf.at[index, "GT_LDTG"] = ldtg
        gdf.at[index, "GT_SDTG"] = sdtg

        provided_area = float(row.get("DIENTICH", 0))
        try:
            metric_geom = residential_gdf_metric.geometry.loc[index]
            td_hd, td_dt, td_cs, td_cr = get_parcel_geometry_features(metric_geom, provided_area)
        except Exception:
            td_hd, td_dt, td_cs, td_cr = 2, provided_area, 0.0, 0.0

        gdf.at[index, "TD_HD"] = td_hd
        gdf.at[index, "TD_DT"] = td_dt
        gdf.at[index, "TD_CS"] = td_cs
        gdf.at[index, "TD_CR"] = td_cr

        # Trích xuất thuộc tính Pháp lý, Quy hoạch, Kinh doanh từ dữ liệu gốc
        ply = int(row.get("Phaply", 1)) if pd.notna(row.get("Phaply")) else 1
        hcqh = int(row.get("Hanche_QH", 1)) if pd.notna(row.get("Hanche_QH")) else 1
        mtkd = int(row.get("MD_kdoanh", 0)) if pd.notna(row.get("MD_kdoanh")) else 0

        gdf.at[index, "YT_PLY"] = ply
        gdf.at[index, "YT_HCQH"] = hcqh
        gdf.at[index, "YT_MTKD"] = mtkd

        for block, pois in pois_by_block.items():
            shortest_distance, best_poi_name = shortest_distance_to_block(
                graph=graph,
                parcel_lat=parcel_lat,
                parcel_lon=parcel_lon,
                parcel_node=parcel_node,
                pois=pois,
                route_cache=route_cache,
            )
            gdf.at[index, block] = shortest_distance
            if block not in BLOCKS_WITHOUT_ADDRESS:
                gdf.at[index, f"ADR_{block}"] = best_poi_name

        kc_kcn = gdf.at[index, "KC_KCN"]
        if pd.notna(kc_kcn) and kc_kcn is not None:
            if kc_kcn < 0.5:
                mt_score = 1
            elif kc_kcn < 1.5:
                mt_score = 2
            else:
                mt_score = 3

            anxh_score = 1 if kc_kcn < 1.0 else 2
        else:
            mt_score = 3
            anxh_score = 3

        gdf.at[index, "MT_KK"] = mt_score
        gdf.at[index, "MT_NUOC"] = mt_score
        gdf.at[index, "MT_AT"] = mt_score
        gdf.at[index, "MT_ANXH"] = anxh_score

    output_path = path.with_name(f"{path.stem}_processed{path.suffix}")
    gdf.to_file(output_path, driver="GeoJSON")
    print(f"Saved {output_path}")


def main() -> int:
    graph = load_graph()
    pois_by_block = load_pois()
    
    print("Extracting nodes for POIs snapping...")
    nodes_gdf, _ = ox.graph_to_gdfs(graph)
    add_poi_nodes(nodes_gdf, pois_by_block)

    for filename in PARCEL_FILES:
        process_geojson(find_parcel_file(filename), graph, pois_by_block)

    return 0


if __name__ == "__main__":
    sys.exit(main())
