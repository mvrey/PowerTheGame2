"""Adversarial test bot: Writes a 2 MiB line."""
import json, sys

def send(m):
    print(json.dumps(m), flush=True)

for line in sys.stdin:
    m = json.loads(line)
    if m['type'] == 'hello':
        send({'type': 'ready'})
    elif m['type'] == 'turn':
        sys.stdout.write('x' * (2 << 20))
        sys.stdout.flush()
