"""Explicit, idempotent demo fixture. Refuses production; never seeds on server startup."""
import json
import secrets
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from . import models as m
from .config import ROOT, settings
from .db import SessionLocal
from .main import app
from .security import hasher
from .services import today
from .worker import process_one


def seed():
    if settings.app_env == 'production' or not settings.demo_mode:
        raise RuntimeError('Demo fixtures are disabled in this environment')
    with SessionLocal.begin() as db:
        target = ROOT / '.runtime/phase1/demo-credentials.json'
        existing = db.scalars(select(m.User)).all()
        if existing and (ROOT / '.runtime/phase1/demo-seeded').exists():
            print('已有完整演示数据，保留当前记录。'); return
        if existing and not target.exists():
            raise RuntimeError('Existing accounts without demo credentials; initialization refused')
        credentials = json.loads(target.read_text()) if existing else {}
        ids = {u.username: u.id for u in existing}
        for username, name in [('cfo', '林知远 · 财务负责人'), ('pmo', '许宁 · 财务PMO'),
                               ('owner', '陈悦 · 资料经办'), ('reviewer', '周谨 · 独立复核'), ('it', '系统运维')]:
            if username in ids: continue
            password = secrets.token_urlsafe(18)
            u = m.User(username=username, display_name=name, password_hash=hasher.hash(password),
                        identity_admin=username in ('cfo', 'it'), must_change_password=False)
            db.add(u); db.flush(); ids[username] = u.id; credentials[username] = password
    target = ROOT / '.runtime/phase1/demo-credentials.json'
    target.write_text(json.dumps(credentials, indent=2)); target.chmod(0o600)
    clients = {}
    def call(role, method, path, body=None):
        client = clients[role]
        response = client.request(method, '/api/v1' + path, json=body,
            headers={'Idempotency-Key': m.uid()})
        if response.status_code >= 400:
            raise RuntimeError(f'Demo setup failed: {method} {path} {response.status_code} {response.json().get("error", {}).get("code")}')
        return response.json()['data']
    for username in credentials:
        c = TestClient(app); c.headers['Origin'] = settings.app_origin
        result = c.post('/api/v1/auth/login', json={'username': username, 'password': credentials[username]})
        if result.status_code != 200: raise RuntimeError('Demo login failed')
        c.headers['X-CSRF-Token'] = result.json()['data']['csrf_token']; clients[username] = c
    previous = call('cfo', 'GET', '/me')['projects']
    project = previous[0] if previous else call('cfo', 'POST', '/projects', {'initial_cfo_id': ids['cfo'], 'name': '精工制造 · 上市准备演示', 'exchange': 'unknown',
        'organizations': [{'code': 'DEMO-01', 'name': '演示主体一'}, {'code': 'DEMO-02', 'name': '演示主体二'}],
        'periods': [{'label': '2025年度（演示）', 'start': '2025-01-01', 'end': '2025-12-31'}]})
    pid = project['id']; context = call('cfo', 'GET', f'/projects/{pid}/context')
    orgs = [x['id'] for x in context['organizations']]; period = context['periods'][0]['id']
    for role in ('pmo', 'owner', 'reviewer'):
        call('cfo', 'POST', f'/projects/{pid}/memberships', {'user_id': ids[role], 'roles': [role], 'org_ids': orgs})
    template = context['templates'][0] if context['templates'] else call('pmo', 'POST', f'/templates/{pid}/versions')
    if template.get('state') != 'published':
        call('cfo', 'POST', f'/template-versions/{template["id"]}/publish', {'reason': '仅用于虚构数据流程验证'})
    call('pmo', 'POST', f'/projects/{pid}/checklist-jobs', {'template_version_id': template['id'], 'scope_version': 1})
    process_one()
    policies = {}
    for oid in orgs:
        policy = call('pmo', 'POST', f'/projects/{pid}/admission-policies', {'org_id': oid,
            'reference': 'DEMO-虚构目录字段授权', 'allowed_fields': ['document_type', 'department', 'location_code', 'acquisition', 'note', 'date', 'voucher_code'],
            'expires_at': (m.now() + timedelta(days=365)).isoformat()})
        call('cfo', 'POST', f'/admission-policies/{policy["id"]}/verify', {'reason': '虚构演示，不代表真实资料获准'})
        policies[oid] = policy['id']
    all_items = call('pmo', 'GET', f'/projects/{pid}/checklists?page_size=100')['items']
    codes = ['FIN-01', 'FIN-02', 'REV-03', 'REV-04', 'REV-07', 'AR-01', 'INV-02', 'CASH-02', 'TAX-01', 'IC-01']
    chosen = [next(x for x in all_items if x['topic_code'] == code and x['org_id'] == orgs[i % 2]) for i, code in enumerate(codes)]
    for i, item in enumerate(chosen):
        iid = item['id']
        call('pmo', 'POST', '/checklists/assignments', {'rows': [{'item_id': iid, 'expected_version': item['row_version'],
             'owner_id': ids['owner'], 'reviewer_id': ids['reviewer'], 'due': (today() + timedelta(days=i - 3)).isoformat()}]})
        current = call('pmo', 'GET', f'/checklists/{iid}')['item']
        call('pmo', 'POST', f'/checklists/{iid}/applicability-proposals', {'expected_version': current['row_version'], 'value': 'applicable', 'reason': '虚构主体演示范围适用'})
        if i < 7:
            e = call('owner', 'POST', f'/projects/{pid}/evidence', {'code': f'DEMO-DOC-{i + 1:03d}', 'mode': 'A', 'org_id': item['org_id'],
                'period_id': period, 'policy_id': policies[item['org_id']], 'reason': '首次登记虚构目录',
                'metadata': {'document_type': '财务资料目录', 'department': '财务部（演示）', 'location_code': f'ARCHIVE-{i + 1:02d}', 'acquisition': 'located', 'note': '纯虚构样本，不包含财务原件'}})
            current = call('owner', 'GET', f'/checklists/{iid}')['item']
            current = call('owner', 'POST', f'/checklists/{iid}/evidence-links', {'expected_version': current['row_version'], 'evidence_id': e['id']})
            current = call('owner', 'POST', f'/checklists/{iid}/submissions', {'expected_version': current['row_version']})
            if i < 4:
                detail = call('reviewer', 'GET', f'/checklists/{iid}')
                call('reviewer', 'POST', f'/checklists/{iid}/reviews', {'expected_version': current['row_version'], 'decision': 'accept',
                    'checks': detail['item']['checks'], 'evidence_version_ids': [e['current_version_id']], 'reason': '按演示验收条件独立复核通过'})
        if i >= 7:
            gap = call('pmo', 'POST', f'/projects/{pid}/gaps', {'item_id': iid, 'kind': 'missing', 'facts': '演示目录要素尚待补充，需经办补齐'})
            call('pmo', 'POST', f'/projects/{pid}/issues', {'title': f'{item["title"]} · 目录待补齐', 'facts': gap['facts'],
                'kind': 'missing', 'severity': ['P0', 'P1', 'P2'][i - 7], 'org_id': item['org_id'], 'owner_id': ids['owner'],
                'verifier_id': ids['reviewer'], 'due': (today() + timedelta(days=i - 9)).isoformat(), 'gap_ids': [gap['id']]})
    for client in clients.values(): client.close()
    (ROOT / '.runtime/phase1/demo-seeded').write_text('completed')
    print('演示数据已创建：66项候选清单、10项已分派、7份虚构目录、3项整改。')
    print('本地演示账号凭据保存在 .runtime/phase1/demo-credentials.json，未输出到日志。')


if __name__ == '__main__':
    seed()
