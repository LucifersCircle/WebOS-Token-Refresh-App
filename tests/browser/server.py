"""Serve test copies of the real app/server with fake token data, bound to loopback."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path

from cryptography.fernet import Fernet
from flask import Response, request, send_from_directory

parser = argparse.ArgumentParser()
parser.add_argument('--server-source', type=Path, required=True)
parser.add_argument('--data-dir', type=Path, default=Path('artifacts/browser-smoke'))
parser.add_argument('--port', type=int, default=18473)
args = parser.parse_args()
args.data_dir.mkdir(parents=True, exist_ok=True)
os.environ['ENCRYPTION_KEY'] = Fernet.generate_key().decode()
spec = importlib.util.spec_from_file_location('token_server', args.server_source)
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
server.DB_FILE = str((args.data_dir / 'test-keys.db').resolve())
server.initialize_db()
app_dir = Path(__file__).resolve().parents[2] / 'src/app'
test_dir = Path(__file__).resolve().parent
token = 'ab' * 32


@server.app.route('/app/<path:filename>')
def app_source(filename):
    if filename == 'index.html':
        html = (app_dir / filename).read_text()
        html = html.replace('<script src="http.js">', '<script src="/fixture-bridge.js"></script><script src="http.js">')
        html = html.replace('</body>', '<script src="/fixture-runner.js"></script></body>')
        return Response(html, mimetype='text/html')
    if filename == 'app.js':
        source = (app_dir / filename).read_text().replace('https://lg.pirate.vodka', request.host_url.rstrip('/'))
        return Response(source, mimetype='text/javascript')
    return send_from_directory(app_dir, filename)


@server.app.route('/fixture-bridge.js')
def bridge():
    response = {'returnValue': True, 'content': token, 'keyHash': hashlib.sha256(token.encode()).hexdigest()}
    script = 'window.compatibilityTokenResponse = ' + json.dumps(response) + ';\n'
    return Response(script + (test_dir / 'bridge.js').read_text(), mimetype='text/javascript')


@server.app.route('/fixture-runner.js')
def runner():
    return send_from_directory(test_dir, 'runner.js')


@server.app.after_request
def record(response):
    if request.method == 'POST':
        with (args.data_dir / 'http-results.jsonl').open('a') as log:
            json.dump({'path': request.path, 'fields': sorted(request.form.keys()),
                       'status': response.status_code, 'response': response.get_json()}, log)
            log.write('\n')
    return response


server.app.run(host='127.0.0.1', port=args.port, use_reloader=False)
