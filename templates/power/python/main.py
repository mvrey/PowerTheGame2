"""A starter Power bot: it brings its Reserve to the board and marches on the nearest enemy HQ.

Run it locally against a built-in bot:
    npm run jam -- match --bot <this folder> --bot builtin:rookie

Ideas to make it yours: buy pieces with your Power, trade three small pieces up, keep a guard at
home, avoid walking into stronger stacks (observation["state"]["pieces"] shows everything), and
watch what your opponent did last round (observation["previous"]).
"""

import random

import jam
from power import RESERVE, Board, move, my_pieces


class Starter:
    def on_hello(self, hello):
        self.board = Board(hello["info"])
        # The seed differs per match: use it, not the clock, so your games can be replayed.
        self.rng = random.Random(hello["match"]["seed"])

    def on_turn(self, observation, turn):
        state = observation["state"]
        orders = []
        per_army = {}

        def add(order):
            # Each army takes at most 5 orders, and you at most maxOrders in all: more are refused.
            if len(orders) < observation["maxOrders"] and per_army.get(order["army"], 0) < observation["ordersPerArmy"]:
                orders.append(order)
                per_army[order["army"]] = per_army.get(order["army"], 0) + 1

        # Everything waiting in the Reserve goes to its headquarters.
        for order in observation["legal"]:
            if order["kind"] == "move" and order["from"] == RESERVE:
                add(order)

        # Every piece on the board takes the step that brings it closest to an enemy HQ.
        targets = [
            self.board.hq[army["id"]]
            for army in state["armies"]
            if army["alive"] and army["controller"] not in (observation["you"], -1)
        ]
        pieces = [p for p in my_pieces(observation) if p["loc"] != RESERVE and self.board.move_class(p["type"])]
        self.rng.shuffle(pieces)
        for piece in pieces:
            steps = self.board.reach(piece["type"], piece["loc"])
            if steps and targets:
                best = min(steps, key=lambda node: self.distance(piece["type"], node, targets))
                add(move(piece["army"], piece["type"], piece["loc"], best))

        return {"orders": orders}

    def distance(self, piece_type, node, targets):
        moves = [self.board.moves_needed(piece_type, node, hq) for hq in targets]
        return min((m for m in moves if m is not None), default=99)


if __name__ == "__main__":
    jam.run(Starter())
