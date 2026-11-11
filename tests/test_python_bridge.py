"""Exercise the Python action protocol without requiring the WASI installation."""

import json
from pathlib import Path
import subprocess
import sys
import unittest


BRIDGE = Path(__file__).resolve().parents[1] / "modules/Strategies/PythonBridge.py"


class PythonTurretTests(unittest.TestCase):
    def decide(self, expression):
        source = "import botarena as bot\ndef tick(state):\n    return " + expression
        completed = subprocess.run(
            [sys.executable, "-B", str(BRIDGE)],
            input=json.dumps(source) + '\n{"tick": 0}\n',
            text=True, capture_output=True, timeout=5, check=True,
        )
        ready, reply = map(json.loads, completed.stdout.splitlines())
        self.assertEqual({"ready": True}, ready)
        return reply

    def test_rotation_and_clamping(self):
        for requested, expected in [(0, 0), (0.5, 0.5), (10, 1), (-10, -1)]:
            with self.subTest(requested=requested):
                reply = self.decide("{'turretTurn': " + str(requested) + "}")
                self.assertEqual(expected, reply["action"]["turretTurn"])
                self.assertEqual({"x": 0, "y": 0}, reply["action"]["aimDirection"])

    def test_invalid_rotation(self):
        for value in ["None", "True", "'1'", "float('nan')", "float('inf')", "[]"]:
            with self.subTest(value=value):
                self.assertIn("error", self.decide("{'turretTurn': " + value + "}"))

    def test_conflict_even_when_both_commands_are_zero(self):
        self.assertIn("error", self.decide(
            "{'turretTurn': 0, 'aimDirection': {'x': 0, 'y': 0}}"))

    def test_existing_commands_remain_supported(self):
        self.assertIsNone(self.decide("{}")["action"]["turretTurn"])
        action = self.decide("{'aimDirection': {'x': 1, 'y': -1}, 'shoot': True}")["action"]
        self.assertEqual({"x": 1, "y": -1}, action["aimDirection"])
        self.assertTrue(action["shoot"])

    def test_high_level_helpers_and_defaults(self):
        for expression, expected in [
            ("bot.scan()", {"kind": "scan", "speed": 0.5, "direction": "clockwise"}),
            ("bot.scan({'speed': 0.25, 'direction': 'counterclockwise'})",
             {"kind": "scan", "speed": 0.25, "direction": "counterclockwise"}),
            ("bot.aimAt({'x': 10, 'y': 3})", {"kind": "at", "target": {"x": 10, "y": 3}}),
            ("bot.holdAim()", {"kind": "hold"}),
        ]:
            with self.subTest(expression=expression):
                self.assertEqual(expected, self.decide("{'aim': " + expression + "}")["action"]["aim"])

    def test_high_level_conflicts(self):
        for extra in ["'turretTurn': 0", "'aimDirection': {'x': 0, 'y': 0}"]:
            with self.subTest(extra=extra):
                self.assertIn("error", self.decide("{'aim': bot.holdAim(), " + extra + "}"))

    def test_invalid_helper_options(self):
        for expression in ["bot.scan(None)", "bot.scan([])", "bot.scan({'unknown': 1})"]:
            with self.subTest(expression=expression):
                self.assertIn("error", self.decide("{'aim': " + expression + "}"))


    def test_chassis_and_turret_commands_are_independent(self):
        for turret in ["'aim': bot.scan()", "'aim': bot.aimAt({'x': 10, 'y': 2})",
                       "'aim': bot.holdAim()", "'turretTurn': -0.25"]:
            with self.subTest(turret=turret):
                action = self.decide("{'thrust': {'x': 0, 'y': 1}, 'turn': 0.6, 'throttle': 0.7, " + turret + "}")["action"]
                self.assertEqual({"x": 0, "y": 1}, action["thrust"])
                self.assertEqual(0.6, action["turn"])
                self.assertEqual(0.7, action["throttle"])
                if "turretTurn" in turret:
                    self.assertEqual(-0.25, action["turretTurn"])
                else:
                    self.assertIn("aim", action)

    def test_chassis_validation_and_clamping(self):
        action = self.decide("{'turn': -2, 'throttle': 8, 'turretTurn': 0.5}")["action"]
        self.assertEqual(-1, action["turn"])
        self.assertEqual(1, action["throttle"])
        self.assertEqual(0.5, action["turretTurn"])
        for command in ["{'turn': True}", "{'throttle': '1'}", "{'thrust': {'x': 0, 'y': None}}"]:
            with self.subTest(command=command):
                self.assertIn("error", self.decide(command))


if __name__ == "__main__":
    unittest.main()
