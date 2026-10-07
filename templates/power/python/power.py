"""Helpers for Power bots in Python. Standard library only; copy this file next to your bot.

Everything here is a convenience over the JSON described in Docs/Games/Power.md: the board and the
rules come in `hello["info"]`, the game state in every turn's observation.
"""

RESERVE = -1          # `loc` of a piece in a Reserve; `from`/`target` of orders about a Reserve
GROUP1 = ["S", "T", "F", "D"]   # the pieces you can buy: Soldier, Tank, Fighter, Destroyer


class Board:
    """The map of a match, from hello["info"]["board"]."""

    def __init__(self, info):
        board = info["board"]
        self.nodes = board["nodes"]          # [{idx, id, kind, army, num, coastal}]
        self.hq = board["hq"]                # hq[army] = node of that army's headquarters
        self.territory = board["territory"]  # territory[army] = its sector nodes
        self.adj = board["adj"]              # adj[node] = neighbouring nodes
        self._reach = board["reach"]         # reach[cls][node] = nodes one move away
        self._rounds = board["rounds"]       # rounds[cls][a][b] = moves needed (None: never)
        self.pieces = info["pieces"]         # pieces[type] = {power, cls, group, up?, base?}

    def move_class(self, piece_type):
        """'inf', 'tank', 'air' or 'naval'; None for the Megamissile, which cannot move."""
        return self.pieces[piece_type]["cls"]

    def reach(self, piece_type, node):
        """Nodes a piece of this type can reach from `node` in one move."""
        cls = self.move_class(piece_type)
        return self._reach[cls][node] if cls else []

    def moves_needed(self, piece_type, frm, to):
        """Rounds of movement from one node to another (None if it can never get there)."""
        cls = self.move_class(piece_type)
        return self._rounds[cls][frm][to] if cls else None

    def power_of(self, piece_type):
        return self.pieces[piece_type]["power"]


def my_pieces(observation):
    """Your pieces (in your living armies), on the board and in your Reserves."""
    mine = set(observation["armies"])
    return [p for p in observation["state"]["pieces"] if p["army"] in mine]


def pieces_at(state, node):
    return [p for p in state["pieces"] if p["loc"] == node]


def team_of(state, army):
    """The player controlling an army (-1 for the mercenaries)."""
    return state["armies"][army]["controller"]


# Orders. Pass them in a list: {"orders": [move(...), buy(...), ...]}


def move(army, piece_type, frm, to):
    """Move one piece. frm=RESERVE deploys it to its army's HQ (then `to` is that HQ)."""
    return {"kind": "move", "army": army, "type": piece_type, "from": frm, "to": to}


def buy(army, piece_type):
    """Buy a Soldier, Tank, Fighter or Destroyer with Power; it appears in the Reserve."""
    return {"kind": "buy", "army": army, "type": piece_type}


def trade_up(army, piece_type, at):
    """Trade three pieces of a small type at `at` (a node or RESERVE) for the big one."""
    return {"kind": "tradeUp", "army": army, "type": piece_type, "at": at}


def make_missile(army, at, spend, power=0):
    """Build a Megamissile at `at` from pieces worth 100+ ({"S": 2, "R": 1, ...}), plus Power in the Reserve."""
    return {"kind": "makeMissile", "army": army, "at": at, "spend": spend, "power": power}


def launch(army, frm, target, target_army=-1):
    """Launch a Megamissile at a node, or at an army's Reserve (target=RESERVE, target_army=that army)."""
    return {"kind": "launch", "army": army, "from": frm, "target": target, "targetArmy": target_army}
