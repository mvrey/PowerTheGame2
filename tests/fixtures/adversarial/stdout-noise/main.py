"""Adversarial test bot: Prints a debug line to stdout before each (valid) answer."""
import json, sys

def send(m):
    print(json.dumps(m), flush=True)

for line in sys.stdin:
    m = json.loads(line)
    if m['type'] == 'hello':
        send({'type': 'ready'})
    elif m['type'] == 'turn':
        print('thinking...', flush=True)
        send({'type': 'action', 'turn': m['turn'], 'action': {'orders': []}})
