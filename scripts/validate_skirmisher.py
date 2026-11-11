"""Run the copyable tracked-tank strategy against real server physics.

python3 -B scripts/validate_skirmisher.py [--baseline /path/to/previous.js]
"""
import argparse
import json
from math import hypot, pi
from pathlib import Path
from time import monotonic
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CODE = (ROOT / "scripts/strategies/cover-skirmisher.js").read_text()


def run(payload):
    started = monotonic()
    request = Request("http://127.0.0.1:5050/api/matches", data=json.dumps(payload).encode(),
                      headers={"Content-Type": "application/json"})
    try:
        response = urlopen(request, timeout=15)
    except HTTPError as error:
        raise AssertionError(error.read().decode()) from error
    with response:
        match = json.load(response)
    assert match["error"] is None, match["error"]
    replay = match["replay"]
    states = [next(bot for bot in frame["bots"] if bot["id"] == "player") for frame in replay["frames"]]
    path = 0
    stopped = worst_stop = 0
    for a, b in zip(states, states[1:]):
        step = hypot(a["position"]["x"] - b["position"]["x"], a["position"]["y"] - b["position"]["y"])
        path += step
        stopped = stopped + 1 if step < 0.003 else 0
        worst_stop = max(worst_stop, stopped)
    hits = sum(event["type"] == "BotHit" and event["targetBotId"] == "player"
               for frame in replay["frames"] for event in frame["events"])
    shots = sum(event["type"] == "ShotFired" and event["sourceBotId"] == "player"
                for frame in replay["frames"] for event in frame["events"])
    return {"winner": replay["result"]["winnerBotId"], "hp": states[-1]["hp"],
            "ticks": replay["result"]["durationTicks"], "travel": round(path, 2),
            "worst_stop": worst_stop, "hits_taken": hits, "shots": shots,
            "runtime": round(monotonic() - started, 2)}, replay


def custom(code, walls, player, opponent, heading=0):
    return {"language": "javascript", "customMatch": {
        "arena": {"width": 16, "height": 10, "walls": walls}, "maxTicks": 280,
        "spawns": [
            {"id": "player", "teamId": "player", "x": player[0], "y": player[1],
             "bodyAngle": heading, "turretAngle": 0, "hp": 100},
            {"id": "opponent", "teamId": "enemy", "x": opponent[0], "y": opponent[1],
             "bodyAngle": pi, "turretAngle": pi, "hp": 500}],
        "loadouts": [{"botId": "player", "source": "code", "code": code},
                     {"botId": "opponent", "source": "code",
                      "code": "function tick(s) { return {aimDirection: {x:-1,y:0}, shoot:true}; }"}],
    }}


def cases(code):
    return [
        ("aggressive", {"botCode": code, "opponentId": "aggressive"}),
        ("defensive", {"botCode": code, "opponentId": "defensive"}),
        ("firing-lane", custom(code, [], (4, 5), (13, 5))),
        ("wall-corner", custom(code, [{"x": 7.5, "y": 3, "width": 1.5, "height": 4}],
                               (7, 5), (13, 5))),
        ("u-trap", custom(code, [{"x": 4, "y": 2, "width": 1, "height": 5},
                                {"x": 4, "y": 2, "width": 5, "height": 1},
                                {"x": 8, "y": 2, "width": 1, "height": 5}],
                          (6.5, 4.5), (13, 5), -pi / 2)),
    ]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", type=Path)
    args = parser.parse_args()
    assert len(CODE) < 16384
    for label, code in [("new", CODE)] + ([("baseline", args.baseline.read_text())] if args.baseline else []):
        for name, payload in cases(code):
            metrics, replay = run(payload)
            print(label, name, json.dumps(metrics), flush=True)
            if label == "new":
                assert metrics["travel"] > 2, (name, metrics)
                assert metrics["worst_stop"] < 40, (name, metrics)
                if name in ("aggressive", "defensive"):
                    assert metrics["winner"] == "player", (name, metrics)
                if name == "firing-lane":
                    assert metrics["hp"] >= 60 and metrics["hits_taken"] <= 2, (name, metrics)
                if name in ("u-trap", "wall-corner"):
                    assert metrics["shots"] > 0, (name, "Never found a firing position", metrics)

    # Keep combat running even if an accurate bot would normally kill the target early.
    stress_code = CODE + "\nconst originalTick=tick; tick=function(s){const a=originalTick(s);a.shoot=false;return a;};"
    stress = dict(cases(stress_code))["u-trap"]
    stress["customMatch"]["maxTicks"] = 500
    metrics, replay = run(stress)
    print("new long-match", json.dumps(metrics), flush=True)
    assert metrics["ticks"] == 500 and metrics["travel"] > 15, metrics
