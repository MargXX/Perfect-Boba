"""Pull ratings from Firestore, fit a recipe that maximizes expected rating,
push updated defaults back to /calibration/current.

Run locally on your laptop after an event:
    pip install firebase-admin
    python tools/optimize.py --key serviceAccount.json
"""
import argparse, json
from collections import defaultdict

import firebase_admin
from firebase_admin import credentials, firestore

KNOBS = ["tea", "sweet", "milk"]

def fetch_ratings(db):
    rows = []
    for snap in db.collection("orders").where("status", "==", "rated").stream():
        d = snap.to_dict()
        if d.get("rating") is None: continue
        r = d.get("recipe", {})
        rows.append({
            "rating": int(d["rating"]),
            "tea":    int(r.get("tea", 50)),
            "sweet":  int(r.get("sweet", 50)),
            "milk":   int(r.get("milk", 40)),
            "tapioca": bool(r.get("tapioca", True)),
        })
    return rows

def fit(rows):
    """Tiny quadratic fit per knob: rating ~= a*(x - x*)^2 + b, find x*.
    Falls back to weighted mean if not enough data."""
    if len(rows) < 5:
        return {"tea": 50, "sweet": 50, "milk": 40}
    import numpy as np
    defaults = {}
    for knob in KNOBS:
        xs = np.array([r[knob] for r in rows], dtype=float)
        ys = np.array([r["rating"] for r in rows], dtype=float)
        coeffs = np.polyfit(xs, ys, 2)
        a, b, _ = coeffs
        if a < 0:
            xstar = -b / (2 * a)
            xstar = float(max(0, min(100, xstar)))
        else:
            xstar = float(np.average(xs, weights=ys))
        defaults[knob] = round(xstar)
    return defaults

def push(db, defaults):
    db.collection("calibration").document("current").set(
        {"defaults": defaults}, merge=True)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", required=True, help="service account JSON")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    cred = credentials.Certificate(args.key)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    rows = fetch_ratings(db)
    print(f"fetched {len(rows)} rated orders")
    defaults = fit(rows)
    print("new defaults:", json.dumps(defaults, indent=2))
    if args.dry:
        print("(dry run, not pushing)")
    else:
        push(db, defaults)
        print("pushed to /calibration/current")

if __name__ == "__main__":
    main()
