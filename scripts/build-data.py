#!/usr/bin/env python3
"""Valida data/programma-<anno>.json e genera data/programma-<anno>.js.

Uso:
  python3 scripts/build-data.py            # anno 2026
  python3 scripts/build-data.py 2027
  python3 scripts/build-data.py --from data/seed-2026.json   # sviluppo: scrive programma-2026.js dal seed
"""
import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
ACCESS = {"gratuito", "tagliando", "pagamento", "sconosciuto"}
KINDS = {"talk", "libri", "film", "audio", "kids"}
REQUIRED = {"id": str, "day": str, "s": int, "d": int, "v": str, "t": str, "k": str, "access": str}
OPTIONAL_STR = ("c", "x", "speakers", "accessNote", "src")


def validate(doc):
    errors, warnings = [], []
    for key in ("festival", "edition", "days", "venueOrder", "events"):
        if key not in doc:
            errors.append(f"campo di primo livello mancante: {key}")
    if errors:
        return errors, warnings
    days = set()
    for i, d in enumerate(doc["days"]):
        if not isinstance(d, dict) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(d.get("date", ""))) or not d.get("label"):
            errors.append(f"days[{i}]: servono date (YYYY-MM-DD) e label")
        else:
            days.add(d["date"])
    if not isinstance(doc["venueOrder"], list):
        errors.append("venueOrder deve essere una lista")
    ids = Counter()
    for i, e in enumerate(doc["events"]):
        where = f"events[{i}] ({e.get('id', '?')})"
        for f, typ in REQUIRED.items():
            val = e.get(f)
            if val is None:
                errors.append(f"{where}: campo obbligatorio mancante '{f}'")
            elif typ is int and (isinstance(val, bool) or not isinstance(val, int)):
                errors.append(f"{where}: '{f}' deve essere un intero")
            elif typ is str and not isinstance(val, str):
                errors.append(f"{where}: '{f}' deve essere una stringa")
        ids[e.get("id")] += 1
        if e.get("access") is not None and e.get("access") not in ACCESS:
            errors.append(f"{where}: access non valido '{e.get('access')}'")
        if e.get("k") is not None and e.get("k") not in KINDS:
            errors.append(f"{where}: k non valido '{e.get('k')}'")
        if e.get("day") is not None and e.get("day") not in days:
            errors.append(f"{where}: day '{e.get('day')}' non presente in days")
        s, d = e.get("s"), e.get("d")
        if isinstance(s, int) and not (0 <= s < 1440):
            errors.append(f"{where}: s fuori intervallo (0..1439)")
        if isinstance(d, int) and d <= 0:
            errors.append(f"{where}: d deve essere > 0")
        if "est" in e and not isinstance(e["est"], bool):
            errors.append(f"{where}: est deve essere true/false")
        for f in OPTIONAL_STR:
            if e.get(f) is not None and not isinstance(e[f], str):
                errors.append(f"{where}: '{f}' deve essere una stringa")
        if e.get("price") is not None and not isinstance(e["price"], str):
            errors.append(f"{where}: price deve essere stringa o null")
        if isinstance(doc["venueOrder"], list) and e.get("v") and e["v"] not in doc["venueOrder"]:
            warnings.append(f"{where}: luogo '{e['v']}' non in venueOrder (verra' messo in coda)")
    for k, n in ids.items():
        if k is not None and n > 1:
            errors.append(f"id duplicato: {k} ({n} volte)")
    return errors, warnings


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("year", nargs="?", default="2026")
    ap.add_argument("--from", dest="src", help="JSON sorgente alternativo (es. data/seed-2026.json)")
    ap.add_argument("--check", action="store_true", help="solo validazione, non scrive il .js")
    a = ap.parse_args()
    src = Path(a.src) if a.src else DATA / f"programma-{a.year}.json"
    if not src.is_absolute() and not src.exists():
        src = ROOT / src
    out = DATA / f"programma-{a.year}.js"
    try:
        doc = json.loads(src.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print(f"ERRORE: file non trovato: {src}", file=sys.stderr)
        return 2
    except json.JSONDecodeError as ex:
        print(f"ERRORE: JSON non valido in {src}: {ex}", file=sys.stderr)
        return 2
    errors, warnings = validate(doc)
    for w in warnings:
        print("avviso:", w)
    if errors:
        for e in errors:
            print("ERRORE:", e, file=sys.stderr)
        print(f"{len(errors)} errori: {out.name} non scritto.", file=sys.stderr)
        return 1
    ev = doc["events"]
    print(f"{src.name}: {len(ev)} eventi, {len(doc['days'])} giorni, {len(doc['venueOrder'])} luoghi")
    for d in doc["days"]:
        print(f"  {d['label']}: {sum(1 for e in ev if e['day'] == d['date'])} eventi")
    acc = Counter(e["access"] for e in ev)
    print("  accesso: " + ", ".join(f"{k} {acc.get(k, 0)}" for k in ("gratuito", "tagliando", "pagamento", "sconosciuto")))
    kinds = Counter(e["k"] for e in ev)
    print("  tipo: " + ", ".join(f"{k} {kinds.get(k, 0)}" for k in sorted(KINDS)))
    if a.check:
        return 0
    js = "window.PROGRAMMA = " + json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + ";\n"
    out.write_text(js, encoding="utf-8")
    print(f"scritto {out.relative_to(ROOT)} ({len(js)//1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
