"""Translate newline-delimited observations into actions inside WASI."""

import json
import math
import sys
import types

read = sys.stdin.readline
write = sys.stdout.write
# Ordinary print() calls must not interfere with the protocol.
sys.stdout = sys.stderr
dumps = json.dumps
loads = json.loads
strategy_file = "strategy.py"


def send(message):
    write(dumps(message, allow_nan=False, separators=(",", ":")) + "\n")


def failure(error):
    line = error.lineno if isinstance(error, SyntaxError) else None
    column = error.offset if isinstance(error, SyntaxError) else None
    if line is None:
        frame = error.__traceback__
        while frame:
            if frame.tb_frame.f_code.co_filename == strategy_file:
                line = frame.tb_lineno
            frame = frame.tb_next
    name = type(error).__name__[:80]
    detail = getattr(error, "msg", None) or str(error)
    detail = detail.strip().split("\n", 1)[0].strip()
    if detail.startswith(name + ":"):
        detail = detail[len(name) + 1 :].strip()
    if len(detail) > 240:
        detail = detail[:240].rstrip() + "…"
    message = "Ошибка Python (" + name + "): " + detail if detail else "Ошибка Python (" + name + ")."
    send({"error": message, "line": line, "column": column})


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


_missing = object()


def _scan(options=_missing):
    if options is _missing:
        options = {}
    if not isinstance(options, dict) or any(key not in ("speed", "direction") for key in options):
        raise TypeError("scan expects speed/direction options")
    return {"kind": "scan", "speed": 0.5, "direction": "clockwise", **options}


def _aim_at(target):
    return {"kind": "at", "target": target}


def _hold_aim():
    return {"kind": "hold"}


bot_api = types.ModuleType("botarena")
bot_api.scan = _scan
bot_api.aimAt = _aim_at
bot_api.holdAim = _hold_aim
sys.modules["botarena"] = bot_api


def read_vector(mapping, key):
    vector = mapping.get(key, {"x": 0, "y": 0})
    if not isinstance(vector, dict):
        return None
    x, y = vector.get("x"), vector.get("y")
    return {"x": x, "y": y} if finite(x) and finite(y) else None


def wrap(angle):
    return math.atan2(math.sin(angle), math.cos(angle))


def point_of(value):
    if not isinstance(value, dict):
        return None
    x, y = value.get("x"), value.get("y")
    if not finite(x) or not finite(y):
        return None
    return {"x": x, "y": y}


def position_of(value):
    if not isinstance(value, dict):
        return None
    return point_of(value.get("position", value))


def distance(a, b):
    left, right = position_of(a), position_of(b)
    if left is None or right is None:
        return math.inf
    return math.hypot(right["x"] - left["x"], right["y"] - left["y"])


def reached(self, point, radius=0.55):
    return finite(radius) and distance(self, point) <= radius


def drive_to(self, point):
    target = position_of(point)
    if not isinstance(self, dict) or "position" not in self or target is None:
        return {"leftTrack": 0, "rightTrack": 0}
    dx = target["x"] - self["position"]["x"]
    dy = target["y"] - self["position"]["y"]
    error = wrap(math.atan2(dy, dx) - self["bodyAngle"])
    turn = max(-1, min(1, error * 2))
    drive = 1 if abs(error) < 0.55 else 0
    return {"leftTrack": drive + turn, "rightTrack": drive - turn}


def aim_at(self, point):
    target = position_of(point)
    if not isinstance(self, dict) or "position" not in self or target is None:
        return {"aimDirection": {"x": 0, "y": 0}}
    return {
        "aimDirection": {
            "x": target["x"] - self["position"]["x"],
            "y": target["y"] - self["position"]["y"],
        }
    }


def facing(self, point, tolerance=0.06):
    target = position_of(point)
    if not isinstance(self, dict) or "position" not in self or target is None or not finite(tolerance):
        return False
    heading = math.atan2(target["y"] - self["position"]["y"], target["x"] - self["position"]["x"])
    return abs(wrap(heading - self["turretAngle"])) <= tolerance


def action_from(value, self):
    if not isinstance(value, dict):
        return None
    left = value.get("leftTrack")
    right = value.get("rightTrack")
    drive_target = value.get("driveTo", value.get("drive_to"))
    if drive_target is not None and left is None and right is None:
        steered = drive_to(self, drive_target)
        left = steered["leftTrack"]
        right = steered["rightTrack"]
    if left is None:
        left = 0
    if right is None:
        right = 0

    used_aim_at = False
    aim_target = value.get("aimAt", value.get("aim_at"))
    if aim_target is not None:
        used_aim_at = True
        aimed = aim_at(self, aim_target)["aimDirection"]
        x, y = aimed["x"], aimed["y"]
    else:
        aim = value.get("aimDirection", {"x": 0, "y": 0})
        if not isinstance(aim, dict):
            return None
        x, y = aim.get("x"), aim.get("y")

    turret_turn = value.get("turretTurn")
    high = value.get("aim")
    if "turretTurn" in value and ((not used_aim_at and "aimDirection" in value) or not finite(turret_turn)):
        return None
    if "aim" in value and ((not used_aim_at and "aimDirection" in value) or "turretTurn" in value or not isinstance(high, dict)):
        return None

    body_turn = value.get("turn", 0)
    throttle = value.get("throttle", 0)
    thrust = read_vector(value, "thrust")
    shoot = value.get("shoot", False)
    if (not finite(left) or not finite(right) or not finite(x) or not finite(y) or thrust is None or
            not finite(body_turn) or not finite(throttle) or type(shoot) is not bool):
        return None
    result = {
        "leftTrack": min(1, max(-1, left)),
        "rightTrack": min(1, max(-1, right)),
        "aimDirection": {"x": x, "y": y},
        "thrust": thrust,
        "turn": min(1, max(-1, body_turn)),
        "throttle": min(1, max(-1, throttle)),
        "shoot": shoot,
        "turretTurn": None if turret_turn is None else min(1, max(-1, turret_turn)),
    }
    if "targetPoint" in value:
        target = value["targetPoint"]
        if not isinstance(target, dict):
            return None
        tx, ty = target.get("x"), target.get("y")
        if not finite(tx) or not finite(ty):
            return None
        result["targetPoint"] = {"x": tx, "y": ty}
    if "useItem" in value:
        if type(value["useItem"]) is not str:
            return None
        result["useItem"] = value["useItem"]
    if "aim" in value:
        result["aim"] = value["aim"]
    return result


pending_logs = []


def log(*args):
    if len(pending_logs) >= 20:
        return
    message = " ".join(str(arg) for arg in args)
    pending_logs.append(message[:200])


def take_logs():
    lines = list(pending_logs)
    pending_logs.clear()
    return lines


scope = {
    "__name__": "__strategy__",
    "distance": distance,
    "reached": reached,
    "drive_to": drive_to,
    "driveTo": drive_to,
    "aim_at": aim_at,
    "aimAt": aim_at,
    "facing": facing,
    "log": log,
    "print": log,
}
try:
    exec(compile(loads(read()), strategy_file, "exec"), scope)
    tick = scope.get("tick")
    if not callable(tick):
        send({"error": "Объявите функцию tick(state).", "logs": take_logs()})
        sys.exit(0)
except Exception as error:
    failure(error)
    sys.exit(0)

send({"ready": True, "logs": take_logs()})
while request := read():
    try:
        state = loads(request)
        action = action_from(tick(state), state.get("self"))
        lines = take_logs()
        if action is None:
            send({
                "error": "tick(state) должна вернуть словарь с командами leftTrack/rightTrack или driveTo, throttle/turn/thrust, aimAt или aimDirection, логическим shoot и только одним способом управления башней — aim, aimDirection {x, y} или числовой turretTurn.",
                "logs": lines,
            })
        else:
            send({"action": action, "logs": lines})
    except Exception as error:
        failure(error)
        break
