"""Helpers for Konquest bots in Python. Standard library only; copy this file next to your bot.

Everything here is a convenience over the JSON described in Docs/Games/Konquest.md: the galaxy's
size and rules come in `hello["info"]`, the planets and fleets in every turn's observation.
"""

import math

NEUTRAL = -1  # `owner` of a planet nobody holds


def distance(a, b):
    """KDE's distance between two planets: half the straight line between their sectors."""
    return math.hypot(a["x"] - b["x"], a["y"] - b["y"]) / 2


def travel_time(a, b):
    """Turns a fleet takes from planet a to planet b: it lands at the end of its last turn."""
    return max(1, math.ceil(distance(a, b)))


def my_planets(observation):
    me = observation["you"]
    return [p for p in observation["state"]["planets"] if p["owner"] == me]


def other_planets(observation):
    """Every planet that is not yours: enemy and neutral."""
    me = observation["you"]
    return [p for p in observation["state"]["planets"] if p["owner"] != me]


def enemy_planets(observation):
    me = observation["you"]
    return [p for p in observation["state"]["planets"] if p["owner"] not in (me, NEUTRAL)]


def fleets_to(observation, planet_id):
    """Fleets (anyone's) on their way to a planet."""
    return [f for f in observation["state"]["fleets"] if f["to"] == planet_id]


def growth(observation, planet):
    """Ships a planet adds each turn: its production if someone holds it, the neutral rate if not."""
    if planet["owner"] == NEUTRAL:
        return observation["state"]["rules"]["neutralProduction"]
    return planet["production"]


def send(frm, to, ships):
    """An order: `ships` ships from your planet `frm` to planet `to` (ids). Pass a list of them:
    {"orders": [send(...), send(...)]}. Each order may only use what its planet has left."""
    return {"from": frm, "to": to, "ships": ships}
