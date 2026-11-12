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
    send({"error": "Ошибка Python (" + type(error).__name__[:80] + ").", "line": line, "column": column})


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


def action_from(value):
    if not isinstance(value, dict):
        return None
    left = value.get("leftTrack", 0)
    right = value.get("rightTrack", 0)
    aim = value.get("aimDirection", {"x": 0, "y": 0})
    turn = value.get("turretTurn")
    if "turretTurn" in value and ("aimDirection" in value or not finite(turn)):
        return None
    if "aim" in value and ("aimDirection" in value or "turretTurn" in value or not isinstance(value["aim"], dict)):
        return None
    shoot = value.get("shoot", False)
    if not finite(left) or not finite(right) or not isinstance(aim, dict) or type(shoot) is not bool:
        return None
    x, y = aim.get("x"), aim.get("y")
    if not finite(x) or not finite(y):
        return None
    result = {"leftTrack": min(1, max(-1, left)), "rightTrack": min(1, max(-1, right)),
              "aimDirection": {"x": x, "y": y}, "shoot": shoot,
              "turretTurn": None if turn is None else min(1, max(-1, turn))}
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


scope = {"__name__": "__strategy__"}
try:
    exec(compile(loads(read()), strategy_file, "exec"), scope)
    tick = scope.get("tick")
    if not callable(tick):
        send({"error": "Объявите функцию tick(state)."})
        sys.exit(0)
except Exception as error:
    failure(error)
    sys.exit(0)

send({"ready": True})
while request := read():
    try:
        action = action_from(tick(loads(request)))
        if action is None:
            send({"error": "tick(state) должна вернуть словарь с числовыми командами и логическим shoot. Для башни укажите только aim, aimDirection {x, y} или числовой turretTurn. Для миномёта targetPoint должна содержать числовые x и y."})
        else:
            send({"action": action})
    except Exception as error:
        failure(error)
        break
