"""Adversarial test bot: Gives only illegal orders."""
import json, sys

def send(m):
    print(json.dumps(m), flush=True)

for line in sys.stdin:
    m = json.loads(line)
    if m['type'] == 'hello':
        send({'type': 'ready'})
    elif m['type'] == 'turn':
        bad = [{'kind': 'buy', 'army': 3 - m['observation']['you'], 'type': 'S'}, {'kind': 'teleport'}, 42]
        send({'type': 'action', 'turn': m['turn'], 'action': {'orders': bad}})
