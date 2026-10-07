"""Adversarial test bot: Plays one turn, then crashes."""
import json, sys

def send(m):
    print(json.dumps(m), flush=True)

for line in sys.stdin:
    m = json.loads(line)
    if m['type'] == 'hello':
        send({'type': 'ready'})
    elif m['type'] == 'turn':
        if m['turn'] == 2:
            raise RuntimeError('crash in turn 2')
        send({'type': 'action', 'turn': m['turn'], 'action': {'orders': []}})
