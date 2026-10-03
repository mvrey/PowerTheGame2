"""A Power bot in Python that plays over the HTTP API, using only the standard library.

Start the server (npm run server), then either let this script create a match against
server bots:

    python examples/http_bot.py --server http://localhost:8787 --vs kruger:1,vega:1,rookie

or join a seat of an existing match:

    python examples/http_bot.py --match ab12cd34 --player 0 --token <seat token>

Strategy: up to five random legal orders a round (no missile launches), asking the server
which orders are legal given the ones already chosen. Replace choose_orders() with your own.
"""

import argparse
import json
import random
import urllib.request


def call(server, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(server + path, data=data, method="POST" if data else "GET")
    request.add_header("content-type", "application/json")
    if token:
        request.add_header("authorization", "Bearer " + token)
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read())


def choose_orders(server, view):
    """Picks this round's orders. `view` is the PlayerView: view['state'] holds the whole game."""
    orders = []
    while len(orders) < view["maxOrders"]:
        legal = call(server, "/api/legal", {"state": view["state"], "player": view["me"], "orders": orders})["orders"]
        legal = [o for o in legal if o["k"] != "launch"]
        if not legal:
            break
        orders.append(random.choice(legal))
    return orders


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--server", default="http://localhost:8787")
    parser.add_argument("--match")
    parser.add_argument("--player", type=int, default=0)
    parser.add_argument("--token", default="")
    parser.add_argument("--vs", default="kruger:1,vega:1,rookie", help="server bots for a new match")
    parser.add_argument("--rounds", type=int, default=100)
    args = parser.parse_args()

    match, player, token = args.match, args.player, args.token
    if not match:
        rivals = [dict(zip(("bot", "level"), (s.split(":")[0], int(s.split(":")[1]) if ":" in s else 2))) for s in args.vs.split(",")]
        created = call(args.server, "/api/matches", {"seats": [{"name": "Python"}] + rivals, "maxRounds": args.rounds})
        match, player, token = created["id"], 0, created["seats"][0]["token"]
        print("Created match", match, "against", ", ".join(s["name"] for s in created["seats"][1:]))

    status = call(args.server, f"/api/matches/{match}")
    while not status["over"] and status["players"][player]["alive"]:
        if player in status["waitingFor"]:
            view = call(args.server, f"/api/matches/{match}/view?player={player}")
            result = call(args.server, f"/api/matches/{match}/orders", {"player": player, "orders": choose_orders(args.server, view)}, token)
            if not result["accepted"]:
                print("Orders refused:", result)
        # Waits (long poll) until the round has been played.
        status = call(args.server, f"/api/matches/{match}?after={status['round']}")

    outcome = "won" if player in status["winners"] else ("eliminated" if not status["players"][player]["alive"] else "lost")
    print(f"Match {match}: {outcome} after round {status['round']}")


if __name__ == "__main__":
    main()
