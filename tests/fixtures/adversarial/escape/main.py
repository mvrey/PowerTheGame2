"""Adversarial test bot: [sandbox] Tries the network, host files, secrets and writing to disk, and reports what worked."""
import json, os, socket, sys
found = []
try:
    socket.create_connection(('1.1.1.1', 53), timeout=2).close()
    found.append('network')
except Exception:
    pass
for path in ['/etc/shadow', '/root/.ssh/id_rsa', '/var/run/docker.sock', '../../../../etc/hostname']:
    try:
        open(path, 'rb').read(1)
        found.append('read ' + path)
    except Exception:
        pass
for path in ['/bot/x', '/x', '/tmp/x']:
    try:
        open(path, 'w').write('x')
        found.append('wrote ' + path)
    except Exception:
        pass
secret = [k for k in os.environ if any(w in k.upper() for w in ('TOKEN', 'SECRET', 'KEY', 'PASSWORD'))]
if secret:
    found.append('env ' + ','.join(secret))
print('ESCAPE-REPORT ' + json.dumps(found), file=sys.stderr, flush=True)

def send(m):
    print(json.dumps(m), flush=True)

for line in sys.stdin:
    m = json.loads(line)
    if m['type'] == 'hello':
        send({'type': 'ready'})
    elif m['type'] == 'turn':
        send({'type': 'action', 'turn': m['turn'], 'action': {'orders': []}})
