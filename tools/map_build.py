# -*- coding: utf-8 -*-
"""map_build.py — делает контуры стран для карты Реворкии.

Скачивает Natural Earth (110m), отбирает нужный регион, переводит
координаты в проекцию Меркатора, упрощает линии и пишет JS-файл
со SVG-путями.
"""

from __future__ import annotations

import json
import math
import os
import sys
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_JS = os.path.join(ROOT, "_map_data.js")

SOURCES = [
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson",
    "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson",
    "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson",
]

# рамка карты: запад, восток, юг, север
LON0, LON1 = -13.0, 42.0
LAT0, LAT1 = 34.5, 71.5

TARGET_H = 1000.0        # высота карты в единицах viewBox
TOLERANCE = 0.55         # упрощение линий

# какие страны нужны (английские имена Natural Earth)
WANTED = {
    "Lithuania", "Latvia", "Estonia", "Poland", "Germany", "France", "Italy", "Spain",
    "United Kingdom", "Norway", "Sweden", "Denmark", "Finland",
    "Russia", "Belarus", "Ukraine", "Czechia", "Czech Republic", "Austria", "Switzerland",
    "Slovenia", "Croatia", "Hungary", "Romania", "Slovakia", "Serbia", "Bosnia and Herz.",
    "Montenegro", "Kosovo", "Albania", "North Macedonia", "Greece", "Bulgaria", "Moldova",
    "Turkey", "Morocco", "Algeria", "Tunisia", "Libya", "Portugal", "Ireland",
    "Netherlands", "Belgium", "Luxembourg", "Iceland", "Malta", "Cyprus",
}


def merc(lat: float) -> float:
    lat = max(-85.0, min(85.0, lat))
    return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


MX0, MX1 = math.radians(LON0), math.radians(LON1)
MY_TOP, MY_BOT = merc(LAT1), merc(LAT0)    # север и юг; y растёт вниз
SPAN_X = MX1 - MX0
SPAN_Y = MY_TOP - MY_BOT
W = TARGET_H * (SPAN_X / SPAN_Y)
H = TARGET_H

print(f"проекция: рамка {LON0}..{LON1} по долготе, {LAT0}..{LAT1} по широте")
print(f"viewBox: 0 0 {W:.1f} {H:.1f}")


def project(lon: float, lat: float):
    x = (math.radians(lon) - MX0) / SPAN_X * W
    y = (MY_TOP - merc(lat)) / SPAN_Y * H
    return x, y


def rdp(pts, eps):
    """Упрощение линии (Дуглас-Пекер)."""
    if len(pts) < 3:
        return pts
    x1, y1 = pts[0]
    x2, y2 = pts[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = math.hypot(dx, dy)
    idx, best = -1, -1.0
    for i in range(1, len(pts) - 1):
        px, py = pts[i]
        if norm == 0:
            d = math.hypot(px - x1, py - y1)
        else:
            d = abs(dy * px - dx * py + x2 * y1 - y2 * x1) / norm
        if d > best:
            best, idx = d, i
    if best > eps:
        left = rdp(pts[: idx + 1], eps)
        right = rdp(pts[idx:], eps)
        return left[:-1] + right
    return [pts[0], pts[-1]]


def rings_of(geom):
    t = geom.get("type")
    c = geom.get("coordinates")
    if t == "Polygon":
        return [c]
    if t == "MultiPolygon":
        return c
    return []


def in_box(lon, lat, pad=2.0):
    return (LON0 - pad) <= lon <= (LON1 + pad) and (LAT0 - pad) <= lat <= (LAT1 + pad)


def main() -> int:
    data = None
    for url in SOURCES:
        try:
            print("качаю:", url)
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=90) as r:
                data = json.loads(r.read().decode("utf-8", "replace"))
            print("  получено объектов:", len(data.get("features", [])))
            break
        except Exception as e:
            print("  не вышло:", e)
    if not data:
        print("НЕ СМОГ СКАЧАТЬ ДАННЫЕ")
        return 2

    result = {}
    for feat in data["features"]:
        props = feat.get("properties") or {}
        name = props.get("ADMIN") or props.get("name") or props.get("NAME") or ""
        if name not in WANTED:
            continue
        polys = rings_of(feat.get("geometry") or {})
        paths = []
        for poly in polys:
            if not poly:
                continue
            outer = poly[0]
            if not any(in_box(p[0], p[1]) for p in outer):
                continue
            pts = [project(p[0], p[1]) for p in outer]
            pts = rdp(pts, TOLERANCE)
            if len(pts) < 4:
                continue
            d = "M" + " ".join(f"{x:.1f},{y:.1f}" for x, y in pts) + "Z"
            paths.append(d)
        if paths:
            result[name] = "".join(paths)

    total = sum(len(v) for v in result.values())
    print(f"\nстран в наборе: {len(result)}")
    print(f"суммарная длина путей: {total} символов ({total/1024:.0f} КБ)")

    js = ("/* Контуры стран для карты Реворкии.\n"
          "   Источник: Natural Earth 110m. Проекция Меркатора.\n"
          "   Сгенерировано map_build.py — вручную не править. */\n"
          f"var MAP_W = {W:.1f}, MAP_H = {H:.1f};\n"
          "var MAP_PATHS = " + json.dumps(result, ensure_ascii=False, separators=(",", ":")) + ";\n")
    with open(OUT_JS, "w", encoding="utf-8") as f:
        f.write(js)
    print("записано:", OUT_JS, f"{len(js)/1024:.0f} КБ")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
