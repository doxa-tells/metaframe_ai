#!/usr/bin/env python3
"""MF Sans — шрифт MetaFrame Studio: латиница Plus Jakarta Sans + кириллица (русский, казахский, украинский).

В Plus Jakarta Sans кириллицы нет. Кириллические буквы взяты из Manrope — самого близкого по пропорциям
шрифта (та же высота строчных), казахские, которых в Manrope нет, — из Onest. Все подогнаны: вес подобран по толщине штриха, прописные подтянуты
до высоты прописных Jakarta. Оба шрифта под SIL OFL 1.1 (см. app/fonts/MFSans-OFL.txt).

Запуск:  python scripts/build-mf-sans.py <PlusJakartaSans[wght].ttf> <Manrope[wght].ttf>,<Onest[wght].ttf> [папка для TTF]
Нужны fonttools и brotli. Результат: app/fonts/MFSans-<вес>.woff2
"""
import sys
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

BASE = sys.argv[1]
DONORS = sys.argv[2].split(",")  # по порядку: чего нет в первом, берётся из следующего
OUT = Path(__file__).resolve().parent.parent / "app" / "fonts"
WEIGHTS = [300, 400, 500, 600, 700, 800]
# кириллица целиком (русский, казахский, украинский, белорусский и др.)
CYR = [c for c in range(0x0400, 0x0530)]


def stem(font):
    """толщина вертикального штриха буквы l, в долях кегля"""
    gs, cm = font.getGlyphSet(), font.getBestCmap()
    p = BoundsPen(gs)
    gs[cm[ord("l")]].draw(p)
    return (p.bounds[2] - p.bounds[0]) / font["head"].unitsPerEm


def height(font, ch):
    gs, cm = font.getGlyphSet(), font.getBestCmap()
    p = BoundsPen(gs)
    gs[cm[ord(ch)]].draw(p)
    return p.bounds[3] / font["head"].unitsPerEm


def inst(path, w):
    f = TTFont(path)
    lo, hi = next((a.minValue, a.maxValue) for a in f["fvar"].axes if a.axisTag == "wght")
    return instantiateVariableFont(f, {"wght": max(lo, min(hi, w))})


def donor_for(path, target_stem):
    """вес донора с той же толщиной штриха (двоичный поиск по оси)"""
    f = TTFont(path)
    lo, hi = next((a.minValue, a.maxValue) for a in f["fvar"].axes if a.axisTag == "wght")
    for _ in range(12):
        mid = (lo + hi) / 2
        if stem(inst(path, mid)) < target_stem:
            lo = mid
        else:
            hi = mid
    return round((lo + hi) / 2)


for w in WEIGHTS:
    base = inst(BASE, w)
    glyf, hmtx = base["glyf"], base["hmtx"]
    report = []
    for path in DONORS:
        dw = donor_for(path, stem(base))
        donor = inst(path, dw)
        k = base["head"].unitsPerEm / donor["head"].unitsPerEm
        lowscale = k * height(base, "x") / (height(donor, "x") * k) * k
        upscale = k * height(base, "H") / (height(donor, "H") * k) * k
        dgs, dcm = donor.getGlyphSet(), donor.getBestCmap()
        bcm = base.getBestCmap()
        tag = Path(path).stem.split("[")[0].lower()
        added = {}
        for cp in CYR:
            if cp in bcm or cp not in dcm:
                continue
            gname = dcm[cp]
            new = "cyr." + tag + "." + gname
            if new not in added:
                s = upscale if chr(cp).isupper() else lowscale
                pen = TTGlyphPen(None)
                rec = DecomposingRecordingPen(dgs)  # составные глифы (Й, Ё) разворачиваются в контуры
                dgs[gname].draw(rec)
                rec.replay(TransformPen(pen, (s, 0, 0, s, 0, 0)))
                glyf[new] = pen.glyph()
                adv, lsb = donor["hmtx"][gname]
                hmtx[new] = (round(adv * s), round(lsb * s))
                added[new] = True
            for t in base["cmap"].tables:
                if t.isUnicode():
                    t.cmap[cp] = new
        for g in added:
            glyf[g].recalcBounds(glyf)
        report.append(f"{tag} {dw}: {len(added)}")
    base.setGlyphOrder(list(glyf.glyphOrder))  # glyf сам дописывает новые имена в свой порядок
    base["maxp"].numGlyphs = len(glyf.glyphOrder)
    os2 = base["OS/2"]
    os2.ulUnicodeRange1 |= 1 << 9  # Cyrillic
    os2.ulCodePageRange1 |= 1 << 2  # cp1251
    os2.usWeightClass = w
    sub = {300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold"}[w]
    for rec in list(base["name"].names):
        if rec.nameID in (1, 16):
            rec.string = "MF Sans"
        elif rec.nameID in (2, 17):
            rec.string = sub
        elif rec.nameID == 4:
            rec.string = "MF Sans " + sub
        elif rec.nameID == 6:
            rec.string = "MFSans-" + sub
        elif rec.nameID == 3:
            rec.string = "MFSans-" + sub + ";MetaFrame"
    for tag in ("STAT", "fvar", "avar", "gvar", "HVAR", "MVAR"):
        if tag in base:
            del base[tag]
    base.flavor = "woff2"
    out = OUT / f"MFSans-{w}.woff2"
    base.save(out)
    base.flavor = None
    if len(sys.argv) > 3:  # необязательная папка для TTF (поставить шрифт в систему, Figma и т.п.)
        base.save(Path(sys.argv[3]) / f"MFSans-{sub}.ttf")
    print(f"{w}: " + ", ".join(report) + f" глифов → {out.name} ({out.stat().st_size // 1024} КБ)")
