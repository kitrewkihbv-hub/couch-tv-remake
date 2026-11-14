"""A TV-selected location is proxied through the bridge weather endpoint."""
import asyncio
import json
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
import server  # noqa: E402


class WeatherLocationTests(unittest.TestCase):
    def test_custom_location_is_validated_and_passed_to_fetcher(self):
        async def run():
            fake_weather = {"place": "Seattle", "temp": 13, "code": 2, "text": "Partly cloudy"}
            with patch.object(server, "get_weather_for", new=AsyncMock(return_value=fake_weather)) as fetch:
                response = await server.h_weather(SimpleNamespace(query={
                    "lat": "47.61", "lon": "-122.33", "place": "  Seattle  ", "timezone": "America/Los_Angeles",
                }))
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.text)["temp"], 13)
            fetch.assert_awaited_once_with(47.61, -122.33, "Seattle", "America/Los_Angeles")

        asyncio.run(run())

    def test_invalid_custom_coordinates_are_rejected(self):
        async def run():
            with self.assertRaises(server.ApiError):
                await server.h_weather(SimpleNamespace(query={"lat": "100", "lon": "0"}))

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
