"""Run Python matches through the local API with the WASI runtime enabled."""

from smoke import check_replay, request

SANDBOX_PROBE = """
import os

def tick(state):
    for path, mode in [("/etc/passwd", "r"), ("/runtime/probe", "w")]:
        try:
            with open(path, mode):
                pass
        except OSError:
            pass
        else:
            raise AssertionError("unexpected filesystem access")

    try:
        import socket
        with socket.socket() as connection:
            connection.connect(("127.0.0.1", 5050))
    except (OSError, ImportError, AttributeError):
        pass
    else:
        raise AssertionError("unexpected socket access")

    assert not any(key.startswith("BOTARENA_") for key in os.environ)
    return {}
"""


def run(code, language="python"):
    return request("/api/matches", {
        "botCode": code, "opponentId": "defensive", "language": language,
    })


if __name__ == "__main__":
    assert request("/api/strategy-languages") == (200, ["javascript", "python"])
    assert run("def tick(state): return {}", "unknown")[0] == 400

    code = """
count = 0
def tick(state):
    global count
    assert state["tick"] == count
    count += 1
    return {"leftTrack": 1, "rightTrack": 1}
"""
    status, match = request("/api/matches", {
        "language": "python",
        "customMatch": {
            "maxTicks": 200, "arena": {"width": 16, "height": 10, "walls": []},
            "spawns": [{"id": "player", "teamId": "player", "x": 2, "y": 5},
                       {"id": "opponent", "teamId": "opponent", "x": 14, "y": 5}],
            "loadouts": [{"botId": "player", "source": "code", "code": code},
                         {"botId": "opponent", "source": "code", "code": "def tick(state): return {}"}],
        },
    })
    assert status == 200 and match["error"] is None, (status, match.get("error"))
    check_replay(match["replay"])
    result = match["replay"]["result"]
    assert result["winnerBotId"] is None and result["reason"] == "TimeLimit" and result["durationTicks"] == 200
    assert match["replay"]["frames"][5]["bots"][0]["position"]["x"] > 2

    status, match = run(SANDBOX_PROBE)
    assert status == 200 and match["error"] is None, (status, match.get("error"))

    assert run("def tick(state):\n    return +")[0] == 422
    status, match = run("def tick(state):\n    raise ValueError()")
    assert status == 200 and match["error"]["tick"] == 0 and match["error"]["line"] == 2
    status, match = run("def tick(state):\n    return {'leftTrack': 'full'}")
    assert status == 200 and match["error"]["tick"] == 0 and "словарь" in match["error"]["message"]
    status, match = run("def tick(state):\n    while True: pass")
    assert status == 200 and match["error"]["tick"] == 0, (status, match.get("error"))
    assert run("def tick(state): return {}")[0] == 200
    print("Python replay, persistent state, diagnostics, WASI boundary, and loop limit passed")
