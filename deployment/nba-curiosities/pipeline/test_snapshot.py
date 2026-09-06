import datetime as dt
import unittest
from build_snapshot import age_on, number, participation, season_type

class SnapshotRules(unittest.TestCase):
    def test_birthday(self):
        birth = dt.date(1984, 12, 30)
        self.assertEqual(age_on(birth, dt.date(2024, 12, 29)), 39)
        self.assertEqual(age_on(birth, dt.date(2024, 12, 30)), 40)

    def test_delayed_playoffs_use_game_id(self):
        self.assertEqual(season_type('41900101'), (2020, 1))
        self.assertEqual(season_type('22400001'), (2025, 0))
        self.assertIsNone(season_type('62400001'))  # NBA Cup final
        self.assertIsNone(season_type('52400001'))  # play-in

    def test_participation(self):
        self.assertTrue(participation({'numMinutes': '0:01', 'points': '0'}))
        self.assertTrue(participation({'numMinutes': '', 'points': '0'}))
        self.assertTrue(participation({'numMinutes': '0', 'points': '1'}))
        self.assertFalse(participation({'numMinutes': '0', 'points': '0', 'comment': 'DNP - Coach decision'}))
        self.assertFalse(participation({'numMinutes': '0', 'points': '0'}))

    def test_unknown_is_not_zero(self):
        self.assertIsNone(number(''))
        self.assertIsNone(number('NaN'))
        self.assertEqual(number('0'), 0)

if __name__ == '__main__':
    unittest.main()
