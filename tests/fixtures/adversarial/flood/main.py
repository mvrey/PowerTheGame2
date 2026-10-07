"""Adversarial test bot: Answers each turn with ten thousand messages."""
import json, sys

def send(m):
    print(json.dumps(m), flush=True)

for line in sys.stdin:
    m = json.loads(line)
    if m['type'] == 'hello':
        send({'type': 'ready'})
    elif m['type'] == 'turn':
        for _ in range(10000):
            send({'type': 'action', 'turn': m['turn'], 'action': {'orders': []}})
