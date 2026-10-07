"""Adversarial test bot: [sandbox] Tries to start thousands of processes."""
import subprocess, sys
procs = []
for _ in range(5000):
    try:
        procs.append(subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)']))
    except Exception as e:
        print('blocked after', len(procs), e, file=sys.stderr)
        break
import json, sys

def send(m):
    print(json.dumps(m), flush=True)

for line in sys.stdin:
    m = json.loads(line)
    if m['type'] == 'hello':
        send({'type': 'ready'})
    elif m['type'] == 'turn':
        send({'type': 'action', 'turn': m['turn'], 'action': {'orders': []}})
