"""Smoke test for the local BotArena HTTP contract. Start the server first."""

import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = "http://127.0.0.1:5050"


def request(path, payload=None, **headers):
    data = None if payload is None else json.dumps(payload).encode()
    req = Request(BASE + path, data=data, headers={"Content-Type": "application/json", **headers})
    try:
        response = urlopen(req, timeout=10)
    except HTTPError as error:
        response = error
    with response:
        raw = response.read()
        return response.status, json.loads(raw) if response.headers.get_content_type() == "application/json" else raw


def run(code, opponent="aggressive"):
    return request("/api/matches", {"botCode": code, "opponentId": opponent})


def check_replay(replay):
    frames = replay["frames"]
    assert replay["tickRate"] == 20
    assert [frame["tick"] for frame in frames] == list(range(len(frames)))
    assert replay["result"]["durationTicks"] == len(frames) - 1 <= 200
    assert frames[-1]["events"][-1]["type"] == "MatchFinished"
    assert all(len(frame["bots"]) == 2 for frame in frames)
    arena = replay["arena"]
    assert arena["cellSize"] == 1
    assert {"Sand", "Snow", "Ice"} <= {cell["surface"] for cell in arena["cells"]}
    assert any(cell["fog"] and cell["surface"] == "Sand" for cell in arena["cells"])
    assert arena["terrainRules"]["sand"]["speedMultiplier"] == 0.75
    assert arena["terrainRules"]["fogVisibilityRange"] == 4
    assert all(bot["surface"] in {"Ground", "Sand", "Snow", "Ice"} and type(bot["inFog"]) is bool
               for frame in frames for bot in frame["bots"])
    assert type(replay["randomSeed"]) is int
    assert len(frames[0]["items"]) == 3
    assert all(len(frame["items"]) <= 6 and isinstance(frame["smokeClouds"], list) for frame in frames)
    assert all(len(bot["inventory"]) <= 2 and bot["shieldHp"] >= 0 and isinstance(bot["activeEffects"], list)
               for frame in frames for bot in frame["bots"])


def main():
    assert request("/api/opponents", Host="foreign.example")[0] == 400
    status, opponents = request("/api/opponents")
    assert status == 200 and {bot["id"] for bot in opponents} == {"aggressive", "defensive"}

    app = Path(__file__).resolve().parents[1] / "frontend/src/main.tsx"
    example = app.read_text(encoding="utf-8").split("const example = `", 1)[1].split("`;", 1)[0]
    for opponent in opponents:
        status, match = run(example, opponent["id"])
        assert status == 200 and match["error"] is None, match
        replay = match["replay"]
        check_replay(replay)
        events = {event["type"] for frame in replay["frames"] for event in frame["events"]}
        assert {"ShotFired", "BotHit"} <= events, (opponent["id"], events)
        assert any(bot["bodyAngle"] != bot["turretAngle"]
                   for frame in replay["frames"] for bot in frame["bots"])
        print(opponent["id"], replay["result"])

    shot_ticks = []
    for shoot in ("true", "state.self.canShoot"):
        status, match = run("function tick(state) { return { shoot: " + shoot + " }; }")
        assert status == 200 and match["error"] is None, match
        shot_ticks.append([frame["tick"] for frame in match["replay"]["frames"]
                           if any(event["type"] == "ShotFired" and event["sourceBotId"] == "player"
                                  for event in frame["events"])])
    assert shot_ticks[0][:3] == shot_ticks[1][:3] == [1, 13, 25], shot_ticks

    status, match = run('''function tick(state) {
      if (!Array.isArray(state.items) || !Array.isArray(state.smokeClouds) ||
          !Array.isArray(state.self.inventory) || !state.consumableRules.enabled ||
          state.consumableRules.inventoryCapacity !== 2) throw Error("missing consumable state");
      if (state.enemy && state.enemy.inventory.length !== 0) throw Error("enemy stock leaked");
      return {useItem: "Repair"};
    }''')
    assert status == 200 and match["error"] is None, match
    check_replay(match["replay"])

    status, error = run("function tick( {")
    assert status == 422 and error["error"], error
    assert run("const other = 0;")[0] == 422
    assert run("while (true) {}")[0] == 422
    assert run("function tick() {}", "missing")[0] == 400

    for code, failed_tick in [
        ("let count=0; function tick() { if (++count === 4) throw Error('oops'); return {}; }", 3),
        ("function tick() { while(true) {} }", 0),
        ("function tick() { return { get leftTrack() { while(true) {} } }; }", 0),
        ("function tick() { return { aimDirection: { x: Infinity, y: 0 } }; }", 0),
        ("function tick() { return { useItem: 'unknown' }; }", 0),
    ]:
        status, match = run(code)
        assert status == 200 and match["error"]["tick"] == failed_tick, match
        check_replay(match["replay"])
        assert match["replay"]["result"] == {
            "winnerBotId": "opponent", "reason": "BotError", "durationTicks": failed_tick
        }

    status, match = run('function tick() {\n  throw Error("test");\n}')
    assert status == 200 and match["error"]["line"] == 2 and match["error"]["column"] > 0
    status, match = run("function tick() { const {proxy, revoke} = Proxy.revocable({}, {}); revoke(); return proxy; }")
    assert status == 200 and match["error"]["line"] is None and match["error"]["column"] is None
    assert "строка" not in match["error"]["message"]

    print("HTTP smoke checks passed")


if __name__ == "__main__":
    main()
