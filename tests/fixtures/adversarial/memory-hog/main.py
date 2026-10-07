"""Adversarial test bot: [sandbox] Tries to allocate 4 GiB."""
import json, sys

def send(m):
    print(json.dumps(m), flush=True)

for line in sys.stdin:
    m = json.loads(line)
    if m['type'] == 'hello':
        send({'type': 'ready'})
    elif m['type'] == 'turn':
        hog = [bytearray(1 << 20) for _ in range(4096)]
        send({'type': 'action', 'turn': m['turn'], 'action': {'orders': []}})
