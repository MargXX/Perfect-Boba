import json
import os

# The website's data, kept on the ESP32's flash instead of in Firebase
# (see apps/boba_server.py).
#
# Orders are numbered 1, 2, 3... and stored CHUNK to a file:
# /data/orders/<n // CHUNK>.json holds {"<n>": order, ...}. One file per order
# would waste a whole 4 KB flash block on each, and one file for everything
# gets too big to load into the ESP32's memory after a few hundred orders.
# Each file has a version number that goes up when it changes, so phones only
# re-download the files that changed.
#
# /data/people.json  leaderboard edits from /dev, {drinker_id: {...}}
# /data/meta.json    the next order number, and whether the queue is paused

DATA = "/data"
CHUNK = 16
ACTIVE = ("queued", "awaiting_cup", "dispensing")
KEEP_OPEN = 2  # chunks held in memory at once during a batch of writes


def _exists(path):
    try:
        os.stat(path)
        return True
    except OSError:
        return False


def _read_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _write_json(path, value):
    # Write a new file and swap it in, so a power cut mid-write can't leave
    # half a file behind.
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(value, f)
    os.rename(tmp, path)


def created_ms(order):
    t = order.get("created_at")
    return t.get("__ts", 0) if isinstance(t, dict) else 0


class Store:
    def __init__(self, data_dir=DATA):
        self.dir = data_dir
        for d in (data_dir, data_dir + "/orders"):
            if not _exists(d):
                os.mkdir(d)
        self.meta = _read_json(data_dir + "/meta.json", {})
        self.people = _read_json(data_dir + "/people.json", {})
        self.people_version = 1
        self.versions = []  # per chunk file
        self.count = 0      # orders stored
        # Orders still in progress: id -> [created_ms, status, drinker_id, phone ip, cup_ready].
        # Kept in memory so the machine and the one-order-per-phone check
        # don't have to read files.
        self.active = {}
        self._open = {}     # chunk number -> {id: order}
        self._dirty = set()

        next_id = self.meta.get("next_id", 1)
        for name in os.listdir(data_dir + "/orders"):
            if name.endswith(".json"):
                next_id = max(next_id, (int(name[:-5]) + 1) * CHUNK)
        # Read every file once to count orders and find the ones in progress.
        last = 0
        for k in range(next_id // CHUNK + 1):
            for oid, order in self._chunk(k).items():
                self.count += 1
                last = max(last, int(oid))
                self._index(oid, order)
            self._close()
        self.meta["next_id"] = max(self.meta.get("next_id", 1), last + 1)
        self.versions = [1] * (self.meta["next_id"] // CHUNK + 1)

    # --- chunk files ---------------------------------------------------------

    def _path(self, k):
        return "%s/orders/%d.json" % (self.dir, k)

    def _chunk(self, k):
        if k not in self._open:
            if len(self._open) >= KEEP_OPEN:
                self.flush()
                self._close()
            self._open[k] = _read_json(self._path(k), {})
        return self._open[k]

    def _changed(self, k):
        self._dirty.add(k)
        while len(self.versions) <= k:
            self.versions.append(1)
        self.versions[k] += 1

    def _close(self):
        self._open = {k: v for k, v in self._open.items() if k in self._dirty}

    def flush(self):
        """Save changed files. Call after each request and each machine step."""
        for k in self._dirty:
            if self._open[k]:
                _write_json(self._path(k), self._open[k])
            elif _exists(self._path(k)):
                os.remove(self._path(k))
        self._dirty = set()
        self._close()

    def chunk_text(self, k):
        """One chunk file as JSON text, for a phone to download."""
        if k in self._open:
            return json.dumps(self._open[k])
        try:
            with open(self._path(k)) as f:
                return f.read()
        except OSError:
            return "{}"

    # --- orders --------------------------------------------------------------

    def _index(self, oid, order, ip=None):
        if order and order.get("status") in ACTIVE:
            old = self.active.get(oid)
            self.active[oid] = [created_ms(order), order["status"], order.get("drinker_id"),
                                ip or (old[3] if old else None), bool(order.get("cup_ready"))]
        else:
            self.active.pop(oid, None)

    def get(self, oid):
        try:
            return self._chunk(int(oid) // CHUNK).get(oid)
        except ValueError:
            return None

    def add(self, order, ip=None):
        oid = str(self.meta["next_id"])
        self.meta["next_id"] += 1
        _write_json(self.dir + "/meta.json", self.meta)
        k = int(oid) // CHUNK
        self._chunk(k)[oid] = order
        self._changed(k)
        self.count += 1
        self._index(oid, order, ip)
        return oid

    def put(self, oid, order):
        """Replace (or create, for dev) a whole order."""
        k = int(oid) // CHUNK
        chunk = self._chunk(k)
        if oid not in chunk:
            self.count += 1
        chunk[oid] = order
        self._changed(k)
        self._index(oid, order)

    def update(self, oid, fields):
        order = self.get(oid)
        if order is None:
            return None
        order.update(fields)
        self._changed(int(oid) // CHUNK)
        self._index(oid, order)
        return order

    def delete(self, oid):
        k = int(oid) // CHUNK
        if self._chunk(k).pop(oid, None) is not None:
            self.count -= 1
            self._changed(k)
        self.active.pop(oid, None)

    def oldest(self, status):
        """Id of the oldest order in progress with this status, or None."""
        best = None
        for oid, entry in self.active.items():
            if entry[1] == status and (best is None or entry[0] < self.active[best][0]):
                best = oid
        return best

    # --- leaderboard edits and settings --------------------------------------

    def set_person(self, pid, fields, merge):
        if merge:
            self.people.setdefault(pid, {}).update(fields)
        else:
            self.people[pid] = fields
        self._save_people()

    def delete_person(self, pid):
        self.people.pop(pid, None)
        self._save_people()

    def _save_people(self):
        _write_json(self.dir + "/people.json", self.people)
        self.people_version += 1

    def setting(self, key, default=None):
        return self.meta.get(key, default)

    def set_setting(self, key, value):
        self.meta[key] = value
        _write_json(self.dir + "/meta.json", self.meta)
