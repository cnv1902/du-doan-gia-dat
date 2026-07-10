from __future__ import annotations

import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent

PAIRS = [
    ("TAY_HIEU.json", "TAY_HIEU_POINT.json"),
    ("DONG_HIEU.json", "DONG_HIEU_POINT.json"),
    ("THAI_HOA.json", "THAI_HOA_POINT.json"),
]


def find_file(file_name: str) -> Path:
    matches = sorted(ROOT.rglob(file_name))

    if not matches:
        raise FileNotFoundError(
            f"Không tìm thấy file: {file_name}"
        )

    if len(matches) > 1:
        print(f"Cảnh báo: tìm thấy nhiều file {file_name}")
        for path in matches:
            print(f"  {path}")

    return matches[0]


def get_features(data: dict, path: Path) -> list[dict]:
    features = data.get("features")

    if not isinstance(features, list):
        raise ValueError(
            f"GeoJSON không hợp lệ: {path}"
        )

    return features


def get_properties(feature: dict) -> dict:
    props = feature.get("properties")

    if not isinstance(props, dict):
        props = {}
        feature["properties"] = props

    return props


def build_point_lookup(point_file: Path):
    with point_file.open(
        "r",
        encoding="utf-8",
    ) as f:
        point_data = json.load(f)

    lookup = {}

    duplicated = 0
    skipped = 0

    for feature in get_features(
        point_data,
        point_file,
    ):
        props = get_properties(feature)

        orig_fid = props.get("ORIG_FID")

        geometry = feature.get("geometry", {})
        coords = geometry.get("coordinates")

        if (
            orig_fid is None
            or not isinstance(coords, list)
            or len(coords) < 2
        ):
            skipped += 1
            continue

        lon = float(coords[0])
        lat = float(coords[1])

        if orig_fid in lookup:
            duplicated += 1
            print(
                f"Cảnh báo ORIG_FID bị trùng: {orig_fid}"
            )
            continue

        lookup[orig_fid] = (lon, lat)

    print(f"  Điểm hợp lệ : {len(lookup)}")
    print(f"  Điểm bỏ qua : {skipped}")
    print(f"  Điểm trùng  : {duplicated}")

    return lookup


def update_polygon_file(
    polygon_file: Path,
    point_file: Path,
):
    print("\n--------------------------------")
    print(f"Polygon : {polygon_file.name}")
    print(f"Point   : {point_file.name}")

    point_lookup = build_point_lookup(
        point_file
    )

    with polygon_file.open(
        "r",
        encoding="utf-8",
    ) as f:
        polygon_data = json.load(f)

    updated = 0
    missing = 0

    for feature in get_features(
        polygon_data,
        polygon_file,
    ):
        props = get_properties(feature)

        fid = props.get("FID")

        if fid is None:
            missing += 1
            continue

        point = point_lookup.get(fid)

        if point is None:
            missing += 1
            continue

        lon, lat = point

        props["long"] = round(lon, 10)
        props["lat"] = round(lat, 10)

        updated += 1

    backup_file = polygon_file.with_suffix(
        polygon_file.suffix + ".bak"
    )

    if not backup_file.exists():
        shutil.copy2(
            polygon_file,
            backup_file,
        )

    with polygon_file.open(
        "w",
        encoding="utf-8",
    ) as f:
        json.dump(
            polygon_data,
            f,
            ensure_ascii=False,
            indent=2,
        )

    print(f"  Đã cập nhật : {updated}")
    print(f"  Không ghép  : {missing}")
    print(f"  Backup      : {backup_file.name}")


def main():
    for polygon_name, point_name in PAIRS:
        polygon_file = find_file(
            polygon_name
        )

        point_file = find_file(
            point_name
        )

        update_polygon_file(
            polygon_file,
            point_file,
        )

    print("\nHoàn thành.")


if __name__ == "__main__":
    main()