"""Exercise the Python action protocol without requiring the WASI installation."""

import json
from pathlib import Path
import subprocess
import sys
import unittest


BRIDGE = Path(__file__).resolve().parents[1] / "modules/Strategies/PythonBridge.py"


class PythonTurretTests(unittest.TestCase):
    def decide(self, expression, observation=None):
        source = "import botarena as bot\ndef tick(state):\n    return " + expression
        completed = subprocess.run(
            [sys.executable, "-B", str(BRIDGE)],
            input=json.dumps(source) + '\n' + json.dumps(observation or {"tick": 0}) + '\n',
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

    def test_mortar_target_point(self):
        action = self.decide("{'shoot': True, 'targetPoint': {'x': 14, 'y': 5}}")['action']
        self.assertTrue(action['shoot'])
        self.assertEqual({'x': 14, 'y': 5}, action['targetPoint'])
        self.assertNotIn('targetPoint', self.decide('{}')['action'])

    def test_invalid_mortar_target_point(self):
        for value in ["None", "[]", "{}", "{'x': 1}", "{'x': True, 'y': 1}",
                      "{'x': '1', 'y': 1}", "{'x': float('nan'), 'y': 1}",
                      "{'x': 1, 'y': float('inf')}"]:
            with self.subTest(value=value):
                self.assertIn('error', self.decide("{'targetPoint': " + value + "}"))

    def test_gauss_can_read_charge_and_use_existing_shoot_command(self):
        for stage, progress, ready in [('Ready', 1, True), ('Charging', 0.5, False)]:
            with self.subTest(stage=stage):
                action = self.decide(
                    "{'shoot': state['self']['weapon'] == 'Gauss' and "
                    "state['self']['chargeStage'] == 'Ready' and state['self']['chargeProgress'] == 1}",
                    {'tick': 0, 'self': {'weapon': 'Gauss', 'chargeStage': stage, 'chargeProgress': progress}},
                )['action']
                self.assertEqual(ready, action['shoot'])

    def test_python_can_read_grid_and_surface_without_a_visible_enemy(self):
        action = self.decide(
            "{'leftTrack': state['arena']['terrainRules']['sand']['speedMultiplier'] "
            "if state['self']['surface'] == 'Sand' and state['self']['inFog'] "
            "and state['enemy'] is None and state['arena']['cells'][0]['fog'] else 0}",
            {'tick': 0, 'enemy': None, 'self': {'surface': 'Sand', 'inFog': True},
             'arena': {'cells': [{'x': 2, 'y': 5, 'surface': 'Sand', 'fog': True}],
                       'terrainRules': {'sand': {'speedMultiplier': 0.75}}}},
        )['action']
        self.assertEqual(0.75, action['leftTrack'])

    def test_python_can_activate_all_consumables(self):
        for name in ['Repair', 'Shield', 'SpeedBoost', 'Coolant', 'Smoke']:
            with self.subTest(name=name):
                action = self.decide("{'useItem': '" + name + "', 'shoot': True}")['action']
                self.assertEqual(name, action['useItem'])
                self.assertTrue(action['shoot'])
        self.assertNotIn('useItem', self.decide('{}')['action'])

    def test_python_rejects_invalid_consumable_command_types(self):
        for value in ['None', 'True', '0', '[]', '{}']:
            with self.subTest(value=value):
                self.assertIn('error', self.decide("{'useItem': " + value + "}"))

    def test_python_can_choose_an_item_from_its_inventory(self):
        action = self.decide("{'useItem': state['self']['inventory'][0]}",
                             {'tick': 0, 'self': {'inventory': ['Shield']}, 'items': []})['action']
        self.assertEqual('Shield', action['useItem'])


if __name__ == "__main__":
    unittest.main()
