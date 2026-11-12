"""Exercise the copyable strategy fixtures through the running local API."""

from math import atan2, cos, hypot, isclose, sin
from pathlib import Path
from time import monotonic

from smoke import check_replay, run

STRATEGIES = Path(__file__).with_name("strategies")
EPS = 1e-9


def play(name):
    return run((STRATEGIES / f"{name}.js").read_text(encoding="utf-8"), "defensive")


def replay_for(name):
    status, match = play(name)
    assert status == 200 and match["error"] is None, (name, status, match.get("error"))
    replay = match["replay"]
    check_replay(replay)
    return replay


def player_states(replay):
    return [next(bot for bot in frame["bots"] if bot["id"] == "player")
            for frame in replay["frames"]]


def check_displacements(states, hz):
    for previous, current in zip(states, states[1:]):
        dx = current["position"]["x"] - previous["position"]["x"]
        dy = current["position"]["y"] - previous["position"]["y"]
        angle = current["bodyAngle"]
        speed = current["speed"]
        assert -2.0 - EPS <= speed <= 3.6 + EPS, current
        assert hypot(dx, dy) <= 3.6 / hz + EPS, (previous, current)
        assert isclose(dx, cos(angle) * speed / hz, abs_tol=EPS), (previous, current)
        assert isclose(dy, sin(angle) * speed / hz, abs_tol=EPS), (previous, current)


def check_walls():
    replay = replay_for("wall")
    states = player_states(replay)
    start = states[0]["position"]
    wall = min((wall for wall in replay["arena"]["walls"]
                if wall["x"] > start["x"] and wall["y"] <= start["y"] <= wall["y"] + wall["height"]),
               key=lambda wall: wall["x"])
    contact_x = wall["x"] - 0.68 / 2
    assert len(states) > 50
    assert all(bot["position"]["x"] <= contact_x + EPS for bot in states)
    assert all(isclose(bot["position"]["y"], start["y"], abs_tol=EPS) for bot in states)
    stopped = states[36:41]
    assert all(bot["speed"] == 0 and bot["position"] == stopped[0]["position"] for bot in stopped)
    assert 0 <= contact_x - stopped[0]["position"]["x"] <= 3.6 / replay["tickRate"]
    assert states[50]["position"]["x"] < stopped[0]["position"]["x"] - 0.5
    check_displacements(states, replay["tickRate"])

    clamped = player_states(replay_for("clamped-tracks"))
    assert len(clamped) > 40
    # Independent matches can pick up different random items; compare the movement under test.
    movement = ("position", "bodyAngle", "turretAngle", "speed")
    assert all({key: actual[key] for key in movement} == {key: expected[key] for key in movement}
               for actual, expected in zip(clamped[:41], states[:41]))

    edge = replay_for("arena-edge")
    edge_states = player_states(edge)
    assert len(edge_states) > 40
    assert all(bot["position"]["x"] >= 0.68 / 2 - EPS for bot in edge_states)
    assert all(bot["speed"] == 0 and 0.34 <= bot["position"]["x"] < 0.45 for bot in edge_states[38:41])
    check_displacements(edge_states, edge["tickRate"])


def check_movement():
    replay = replay_for("reverse")
    states = player_states(replay)[:24]
    hz = replay["tickRate"]
    assert len(states) == 24
    assert isclose(states[12]["speed"], 3.6, abs_tol=EPS)
    assert 0 < states[13]["speed"] < states[12]["speed"]
    assert any(abs(bot["speed"]) < EPS for bot in states[13:23])
    assert isclose(states[23]["speed"], -2.0, abs_tol=EPS)
    for tick, (before, after) in enumerate(zip(states, states[1:])):
        limit = 8.0 if tick < 12 else 12.0
        assert abs(after["speed"] - before["speed"]) <= limit / hz + EPS, (tick, before, after)
    check_displacements(states, hz)

    replay = replay_for("steering")
    states = player_states(replay)[:33]
    hz = replay["tickRate"]
    assert len(states) == 33
    assert states[1]["turretAngle"] < states[0]["turretAngle"] < states[1]["bodyAngle"]
    assert all(bot["position"] == states[0]["position"] and bot["speed"] == 0 for bot in states)
    for tick, (before, after) in enumerate(zip(states, states[1:])):
        turn = after["bodyAngle"] - before["bodyAngle"]
        turn = atan2(sin(turn), cos(turn))
        assert abs(turn) <= 3.0 / hz + EPS, (tick, turn)
        turret = after["turretAngle"] - before["turretAngle"]
        assert abs(atan2(sin(turret), cos(turret))) <= 6.0 / hz + EPS, (tick, turret)
    # The hull keeps turning briefly when the command reverses.
    assert states[13]["bodyAngle"] > states[12]["bodyAngle"]
    assert states[24]["bodyAngle"] < states[20]["bodyAngle"]


def check_failure(name, message, expected_tick=None):
    status, match = play(name)
    assert status == 200 and match["error"] is not None, (name, status, match.get("error"))
    error = match["error"]
    assert error["botId"] == "player" and message in error["message"], error
    if expected_tick is not None:
        assert error["tick"] == expected_tick, error
    replay = match["replay"]
    check_replay(replay)
    assert replay["result"] == {
        "reason": "BotError", "winnerBotId": "opponent", "durationTicks": error["tick"]
    }, replay["result"]


def check_isolation_and_limits():
    replay_for("sandbox")
    check_failure("invalid-action", "leftTrack", expected_tick=8)
    check_failure("instruction-limit", "лимит исполнения", expected_tick=0)

    # Jint checks time at execution checkpoints, including after a native wait.
    # This fixture must hit the strategy limit before the worker's 5-second deadline.
    check_failure("tick-timeout", "лимит исполнения")
    start = monotonic()
    status, error = play("worker-timeout")
    elapsed = monotonic() - start
    assert status == 422 and "лимит в 5 секунд" in error["error"], (status, error)
    assert elapsed >= 4.5, elapsed
    replay_for("sandbox")  # The timed-out worker releases the slot and leaves the API usable.


if __name__ == "__main__":
    check_walls()
    print("Wall, arena edge and track clamping passed")
    check_movement()
    print("Acceleration, reverse and turn limits passed")
    check_isolation_and_limits()
    print("Invalid actions, sandbox probes and deadlines passed")
