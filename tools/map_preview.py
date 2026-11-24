# -*- coding: utf-8 -*-
"""Проверка карты: рисует пути из _map_data.js в PNG через Pillow."""

from __future__ import annotations

import json
import os
import re
import sys

from PIL import Image, ImageDraw

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(ROOT, "_map_data.js"), encoding="utf-8").read()
W = float(re.search(r"MAP_W = ([\d.]+)", src).group(1))
H = float(re.search(r"MAP_H = ([\d.]+)", src).group(1))
paths = json.loads(re.search(r"var MAP_PATHS = (\{.*\});", src, re.S).group(1))

REVORKIA = {"Lithuania", "Latvia", "Estonia", "Poland", "Germany", "France", "Italy",
            "Spain", "United Kingdom", "Norway", "Sweden", "Denmark", "Finland"}
ALLY = {"Russia", "Belarus"}

SCALE = 0.75
img = Image.new("RGB", (int(W * SCALE), int(H * SCALE)), (16, 22, 34))
d = ImageDraw.Draw(img)


def parse(path):
    polys, cur = [], []
    for tok in path.replace("M", " M ").replace("Z", " Z ").split():
        if tok == "M":
            cur = []
        elif tok == "Z":
            if len(cur) > 2:
                polys.append(cur)
            cur = []
        else:
            x, y = tok.split(",")
            cur.append((float(x) * SCALE, float(y) * SCALE))
    if len(cur) > 2:
        polys.append(cur)
    return polys


for name, p in paths.items():
    if name in REVORKIA:
        fill, line = (196, 108, 26), (255, 200, 120)
    elif name in ALLY:
        fill, line = (54, 96, 70), (120, 200, 150)
    else:
        fill, line = (44, 50, 64), (96, 104, 120)
    for poly in parse(p):
        d.polygon(poly, fill=fill, outline=line)

# подписи столиц/ключевых точек (проверка координат)
MARKERS = {
    "Knot City (Вильнюс)": (25.28, 54.69),
    "Москва": (37.62, 55.75),
    "Берлин": (13.40, 52.52),
    "Париж": (2.35, 48.86),
    "Рим": (12.50, 41.90),
    "Мадрид": (-3.70, 40.42),
    "Лондон": (-0.13, 51.51),
    "Стокгольм": (18.07, 59.33),
    "Хельсинки": (24.94, 60.17),
}
LON0, LON1, LAT0, LAT1 = -13.0, 42.0, 34.5, 71.5
import math
MX0, MX1 = math.radians(LON0), math.radians(LON1)
MY_TOP, MY_BOT = math.log(math.tan(math.pi / 4 + math.radians(LAT1) / 2)), math.log(math.tan(math.pi / 4 + math.radians(LAT0) / 2))
SX, SY = MX1 - MX0, MY_TOP - MY_BOT
for label, (lon, lat) in MARKERS.items():
    x = (math.radians(lon) - MX0) / SX * W * SCALE
    y = (MY_TOP - math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))) / SY * H * SCALE
    d.ellipse([x - 4, y - 4, x + 4, y + 4], fill=(255, 220, 120), outline=(255, 255, 255))
    d.text((x + 7, y - 6), label, fill=(255, 245, 225))

img.save(os.path.join(ROOT, "map_preview.png"))
print("стран:", len(paths))
print("превью:", os.path.join(ROOT, "map_preview.png"), img.size)
