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


def check_replay(replay, bot_count=2):
    frames = replay["frames"]
    behavior_samples = replay["behaviorSamples"]
    assert replay["tickRate"] == 20
    assert [frame["tick"] for frame in frames] == list(range(len(frames)))
    assert replay["result"]["durationTicks"] == len(frames) - 1 <= 200
    assert frames[-1]["events"][-1]["type"] == "MatchFinished"
    assert all(len(frame["bots"]) == bot_count for frame in frames)
    assert len(behavior_samples) <= replay["result"]["durationTicks"] * bot_count
    assert all(sample["tick"] < replay["result"]["durationTicks"] for sample in behavior_samples)
    assert {sample["botId"] for sample in behavior_samples} <= {
        bot["id"] for bot in frames[0]["bots"]
    }
    assert all("enemyVisible" in sample and "turretAngle" in sample for sample in behavior_samples)


def main():
    assert request("/api/opponents", Host="foreign.example")[0] == 400
    status, opponents = request("/api/opponents")
    assert status == 200 and {bot["id"] for bot in opponents} == {"aggressive", "defensive"}

    status, campaign = request("/api/campaign")
    assert status == 200 and [track["id"] for track in campaign] == [
        "controls-beginner", "controls-advanced", "modes"
    ]
    assert [level["id"] for level in campaign[0]["levels"]] == [
        "move", "steer-short", "steer-long", "shoot-simple", "shoot-cover", "track", "duel"
    ]
    assert [level["id"] for level in campaign[1]["levels"]] == [
        "adv-move", "adv-steer-short", "adv-steer-long", "adv-shoot-simple", "adv-shoot-cover", "adv-track", "adv-duel"
    ]
    assert campaign[2]["levels"] == []
    status, move = request("/api/matches", {
        "botCode": "function tick() { return { driveTo: { x: 10, y: 5 } }; }",
        "campaignLevelId": "move",
    })
    assert status == 200 and move["replay"]["result"]["winnerBotId"] == "player"
    assert move["replay"]["result"]["reason"] == "ObjectiveComplete"
    assert move["replay"]["marker"]["x"] == 10

    app = Path(__file__).resolve().parents[1] / "frontend/src/main.tsx"
    example = app.read_text(encoding="utf-8").split("javascript: `", 1)[1].split("`,", 1)[0]
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

    payload = {
        "botCode": "function tick() { return { thrust: { x: 0, y: -1 } }; }",
        "opponentId": "defensive",
        "movement": "hover",
    }
    status, match = request("/api/matches", payload)
    assert status == 200 and match["error"] is None
    frames = match["replay"]["frames"]
    player, opponent = frames[1]["bots"]
    assert player["movement"] == "hover" and player["velocity"]["y"] < 0
    assert opponent["movement"] == "tracked"
    assert request("/api/matches", {**payload, "movement": "unknown"})[0] == 400

    mixed = {
        "botCode": "function tick() { return { throttle: 1, turn: -0.5 }; }",
        "movement": "wheeled",
        "opponents": [
            {"id": "aggressive", "movement": "hover"},
            {"id": "defensive", "movement": "omni"},
            {"id": "defensive", "movement": "tracked"},
        ],
    }
    status, match = request("/api/matches", mixed)
    assert status == 200 and match["error"] is None
    replay = match["replay"]
    check_replay(replay, bot_count=4)
    assert [bot["movement"] for bot in replay["frames"][0]["bots"]] == ["wheeled", "hover", "omni", "tracked"]
    for index in range(4):
        assert any(frame["bots"][index]["speed"] > 0 for frame in replay["frames"][1:])
    assert request("/api/matches", {**mixed, "opponents": []})[0] == 400
    assert request("/api/matches", {**mixed, "opponents": [None]})[0] == 400
    assert request("/api/matches", {**mixed, "opponents": mixed["opponents"] * 2})[0] == 400

    print("HTTP smoke checks passed")


if __name__ == "__main__":
    main()
