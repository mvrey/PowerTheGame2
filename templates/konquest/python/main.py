"""A starter Konquest bot: each planet keeps a guard and sends just enough ships at the planet
that is cheapest to take per turn of flight.

Run it locally against a built-in bot:
    npm run jam -- match --game konquest --bot <this folder> --bot builtin:kde:2

Ideas to make it yours: count the enemy fleets heading for your planets (observation["state"]
["fleets"]) and defend, prefer productive planets, gather ships before a big attack, and use the
kill percentages: a planet that kills better is a better base to attack from.
"""

import random

import jam
from konquest import fleets_to, growth, my_planets, other_planets, send, travel_time


class Starter:
    def on_hello(self, hello):
        self.info = hello["info"]
        # The seed differs per match: use it, not the clock, so your games can be replayed.
        self.rng = random.Random(hello["match"]["seed"])

    def on_turn(self, observation, turn):
        me = observation["you"]
        orders = []
        targeted = set()
        for home in my_planets(observation):
            spare = home["ships"] - home["production"]  # keep a turn of production at home
            best = None
            for target in other_planets(observation):
                if target["id"] in targeted:
                    continue
                turns = travel_time(home, target)
                mine_on_the_way = sum(f["ships"] for f in fleets_to(observation, target["id"]) if f["owner"] == me)
                # What it will have when we land, with a margin for the dice and its kill rate.
                needed = int((target["ships"] + growth(observation, target) * turns) * target["kill"] / home["kill"] * 1.3) + 1
                needed -= mine_on_the_way
                if 0 < needed <= spare:
                    cost = needed * turns
                    if best is None or cost < best[0]:
                        best = (cost, target, needed)
            if best:
                _, target, needed = best
                targeted.add(target["id"])
                orders.append(send(home["id"], target["id"], needed))
        return {"orders": orders}


if __name__ == "__main__":
    jam.run(Starter())
