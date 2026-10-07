"""Adversarial test bot: Answers every turn with a line that is not JSON."""
import json, sys

def send(m):
    print(json.dumps(m), flush=True)

for line in sys.stdin:
    m = json.loads(line)
    if m['type'] == 'hello':
        send({'type': 'ready'})
    elif m['type'] == 'turn':
        print('attack at dawn', flush=True)
