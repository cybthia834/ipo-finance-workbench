"""Local fictional cluster cold-backup exercise. Never accepts a custom source directory.

Temporarily stops only this project's embedded PostgreSQL, copies a clean shutdown
cluster, immediately restarts the source, then boots an isolated copy on 55435.
This is not an independent failure-domain backup or a production backup strategy.
"""
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.runtime/phase1'
SOURCE = RUNTIME / 'postgres'
BIN = ROOT / 'node_modules/@embedded-postgres/darwin-arm64/native/bin'
assert SOURCE.resolve() == ROOT / '.runtime/phase1/postgres'
assert (SOURCE / 'PG_VERSION').read_text().strip() == '18'
secret = json.loads((RUNTIME / 'database.json').read_text())
directory = RUNTIME / 'recovery' / time.strftime('%Y%m%d-%H%M%S')
directory.mkdir(parents=True, mode=0o700)
backup = directory / 'clean-backup'
restored = directory / 'restored-cluster'


def pgctl(data, action, port):
    args = [str(BIN / 'pg_ctl'), '-D', str(data), '-w', '-t', '30']
    if action == 'start':
        args += ['-l', str(directory / f'postgres-{port}.log'), '-o', f'-h 127.0.0.1 -p {port} -k {RUNTIME}']
    else: args += ['-m', 'fast']
    subprocess.run(args + [action], check=True, capture_output=True)


def connection(port):
    return psycopg.connect(host='127.0.0.1', port=port, dbname='finance_phase1_dev', user='finance_owner', password=secret['owner'])


def inventory(port):
    with connection(port) as db:
        result = {}
        names = [r[0] for r in db.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")]
        from psycopg import sql
        for table in names:
            result[table] = db.execute(sql.SQL('SELECT count(*) FROM {}').format(sql.Identifier(table))).fetchone()[0]
        result['snapshot_hashes'] = db.execute('SELECT id, manifest_hash FROM snapshot ORDER BY id').fetchall()
        result['migration'] = db.execute('SELECT version_num FROM alembic_version').fetchone()[0]
        result['permission_revoked'] = db.execute('SELECT id FROM membership WHERE NOT active ORDER BY id').fetchall()
        result['policy_revoked'] = db.execute("SELECT id FROM admission_policy WHERE state='revoked' ORDER BY id").fetchall()
        return result


before = inventory(55434)
started = time.perf_counter()
pgctl(SOURCE, 'stop', 55434)
try:
    shutil.copytree(SOURCE, backup)
finally:
    pgctl(SOURCE, 'start', 55434)
shutil.copytree(backup, restored)
pgctl(restored, 'start', 55435)
try:
    after = inventory(55435)
    assert before == after, 'Restored database inventory mismatch'
    with connection(55435) as db:
        revoked = db.execute('UPDATE login_session SET revoked=true WHERE NOT revoked').rowcount
        assert db.execute('SELECT count(*) FROM login_session WHERE NOT revoked').fetchone()[0] == 0
        from hashlib import sha256
        from json import dumps
        for manifest, expected in db.execute('SELECT manifest, manifest_hash FROM snapshot'):
            raw = dumps(manifest, sort_keys=True, ensure_ascii=False, separators=(',', ':'), default=str).encode()
            assert sha256(raw).hexdigest() == expected
        for table, reference, parent in [('evidence', 'current_version_id', 'evidence_version'),
                                          ('review', 'submission_id', 'checklist_submission')]:
            from psycopg import sql
            query = sql.SQL('SELECT count(*) FROM {} c LEFT JOIN {} p ON c.{}=p.id WHERE c.{} IS NOT NULL AND p.id IS NULL').format(
                sql.Identifier(table), sql.Identifier(parent), sql.Identifier(reference), sql.Identifier(reference))
            assert db.execute(query).fetchone()[0] == 0
    report = {'kind': 'local clean-shutdown physical backup', 'elapsed_seconds': round(time.perf_counter() - started, 2),
        'inventory_match': True, 'manifest_verified': True, 'references_verified': True, 'restored_sessions_revoked': revoked,
        'tables': len(before) - 4, 'backup': str(backup.relative_to(ROOT)),
        'limitation': 'Same machine and disk; not production RPO/RTO acceptance or independent disaster recovery.'}
    (RUNTIME / 'recovery-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({k: v for k, v in report.items() if k != 'backup'}, ensure_ascii=False))
finally:
    pgctl(restored, 'stop', 55435)
