"""Adversarial test bot: Writes a megabyte of logs every turn, and plays normally."""
import json, sys

def send(m):
    print(json.dumps(m), flush=True)

for line in sys.stdin:
    m = json.loads(line)
    if m['type'] == 'hello':
        send({'type': 'ready'})
    elif m['type'] == 'turn':
        sys.stderr.write('log ' * 250000)
        send({'type': 'action', 'turn': m['turn'], 'action': {'orders': []}})
