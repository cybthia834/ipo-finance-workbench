"""Measured local capacity check; not a production SLA or business sign-off."""
import json
import platform
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from sqlalchemy import insert
from app import models as m
from app.common import digest
from app.db import SessionLocal
from app.security import hasher
from app.worker import process_one


def test_five_users_with_2112_checklists_and_10000_metadata_records(world):
    w = world
    context = w.get('cfo', f'/projects/{w.pid}/context')
    w.post('cfo', f'/projects/{w.pid}/scope-versions', {'name': '容量测试虚构项目',
        'organizations': [{'code': x['code'], 'name': x['name']} for x in context['organizations']] + [
            {'code': 'C', 'name': '容量主体三'}, {'code': 'D', 'name': '容量主体四'}],
        'periods': [{'label': f'{year}测试期', 'start': f'{year}-01-01', 'end': f'{year}-12-31'} for year in range(2010, 2026)]})
    context = w.get('cfo', f'/projects/{w.pid}/context'); orgs = [x['id'] for x in context['organizations']]
    for role in w.ids:
        roles = [role] if role in ('cfo', 'pmo', 'owner', 'reviewer') else []
        w.post('cfo', f'/projects/{w.pid}/memberships', {'user_id': w.ids[role], 'roles': list(set(roles + ['pmo'])), 'org_ids': orgs})
    w.post('pmo', f'/projects/{w.pid}/checklist-jobs', {**w.generation, 'scope_version': 2}); process_one()
    with SessionLocal.begin() as db:
        encoded = hasher.hash('Fictional-unused-capacity-account')
        for i in range(5): db.add(m.User(username=f'capacity-{i}', display_name=f'虚构容量账号{i}', password_hash=encoded))
        evidence, versions = [], []
        content = w.metadata(); sha = digest(content)
        for i in range(10000):
            eid, vid = m.uid(), m.uid()
            evidence.append({'id': eid, 'project_id': w.pid, 'org_id': w.orgs[0], 'period_id': w.period,
                'policy_id': w.policies[w.orgs[0]], 'owner_id': w.ids['owner'], 'code': f'CAP-{i:05d}'})
            versions.append({'id': vid, 'evidence_id': eid, 'number': 1, 'content': content, 'metadata_hash': sha,
                'reason': '虚构容量样本', 'submitted_by': w.ids['owner']})
        db.execute(insert(m.Evidence), evidence); db.execute(insert(m.EvidenceVersion), versions)
        from sqlalchemy import text
        db.execute(text('UPDATE evidence SET current_version_id=v.id FROM evidence_version v WHERE v.evidence_id=evidence.id'))
    times = []
    def exercise(role):
        duration = []
        paths = [f'/projects/{w.pid}/checklists?q=FIN&page_size=20', f'/checklists/{w.items[0]["id"]}',
                 f'/projects/{w.pid}/issues', f'/projects/{w.pid}/dashboard', f'/projects/{w.pid}/evidence?q=CAP&page_size=20']
        for i in range(20):
            started = time.perf_counter(); w.get(role, paths[i % len(paths)])
            duration.append((time.perf_counter() - started) * 1000)
        return duration
    with ThreadPoolExecutor(max_workers=5) as pool:
        for result in pool.map(exercise, w.ids): times.extend(result)
    p95 = sorted(times)[94]
    result = {'environment': platform.platform(), 'python': platform.python_version(), 'database': 'PostgreSQL 18.4',
        'accounts': 10, 'concurrent_users': 5, 'checklists': 2112, 'metadata_records': 10000,
        'requests': len(times), 'p95_ms': round(p95, 2), 'max_ms': round(max(times), 2),
        'scope': 'TestClient HTTP+real PostgreSQL; excludes network/TLS and browser render latency'}
    Path('.runtime/capacity-results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
    assert w.get('pmo', f'/projects/{w.pid}/checklists')['total'] == 2112
    first = w.get('pmo', f'/projects/{w.pid}/evidence?page_size=100')
    second = w.get('pmo', f'/projects/{w.pid}/evidence?page_size=100&page=2')
    assert first['total'] == second['total'] == 10000
    assert len(first['items']) == len(second['items']) == 100
    assert not {e['id'] for e in first['items']} & {e['id'] for e in second['items']}
    assert p95 < 3000
