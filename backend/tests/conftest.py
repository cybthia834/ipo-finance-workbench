"""Integration fixtures use the separately named real PostgreSQL test database only."""
import os
import sys
from datetime import timedelta
from pathlib import Path

import pytest
from dotenv import dotenv_values
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
env = dotenv_values(ROOT / '.runtime/app.env')
test_url = os.environ.get('TEST_DATABASE_URL') or env['TEST_DATABASE_URL']
owner_url = os.environ.get('TEST_MIGRATION_DATABASE_URL') or env['TEST_MIGRATION_DATABASE_URL']
assert make_url(test_url).database == make_url(owner_url).database == 'finance_test', 'Refusing non-test database'
os.environ.update(DATABASE_URL=test_url, MIGRATION_DATABASE_URL=owner_url, APP_ENV='test', DEMO_MODE='true',
                  EXPORT_STORAGE_ROOT=str(ROOT / '.runtime/test-exports'))

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from app import models as m
from app.config import settings
from app.db import SessionLocal
from app.main import app
from app.security import hasher
from app.worker import process_one

PASSWORD = 'Fictional-test-password-2026'
PASSWORD_HASH = hasher.hash(PASSWORD)
owner_engine = create_engine(owner_url)


@pytest.fixture(scope='session', autouse=True)
def schema():
    config = Config(str(ROOT / 'backend/alembic.ini'))
    config.set_main_option('script_location', str(ROOT / 'backend/migrations'))
    command.upgrade(config, 'head')
    yield
    owner_engine.dispose()


class World:
    def __init__(self):
        self.clients = {}
        self.ids = {}
        with SessionLocal.begin() as db:
            for role in ('cfo', 'pmo', 'owner', 'reviewer', 'it'):
                user = m.User(username=role, display_name=f'虚构{role}', password_hash=PASSWORD_HASH,
                              must_change_password=False, identity_admin=role in ('cfo', 'it'))
                db.add(user); db.flush(); self.ids[role] = user.id
        for role in self.ids:
            client = TestClient(app, raise_server_exceptions=False)
            client.headers['Origin'] = settings.app_origin
            response = client.post('/api/v1/auth/login', json={'username': role, 'password': PASSWORD})
            assert response.status_code == 200
            client.headers['X-CSRF-Token'] = response.json()['data']['csrf_token']
            self.clients[role] = client
        project = self.post('cfo', '/projects', {'name': '测试专用虚构项目', 'organizations': [
            {'code': 'A', 'name': '测试主体一'}, {'code': 'B', 'name': '测试主体二'}],
            'periods': [{'label': '2025年度', 'start': '2025-01-01', 'end': '2025-12-31'}]})
        self.pid = project['id']
        context = self.get('cfo', f'/projects/{self.pid}/context')
        self.orgs = [x['id'] for x in context['organizations']]
        self.period = context['periods'][0]['id']
        self.members = {}
        for role in ('pmo', 'owner', 'reviewer'):
            self.members[role] = self.post('cfo', f'/projects/{self.pid}/memberships', {
                'user_id': self.ids[role], 'roles': [role], 'org_ids': self.orgs})
        self.template = self.post('pmo', f'/templates/{self.pid}/versions')
        self.post('cfo', f'/template-versions/{self.template["id"]}/publish', {'reason': '测试专用模板发布'})
        self.generation = {'template_version_id': self.template['id'], 'scope_version': 1}
        self.post('pmo', f'/projects/{self.pid}/checklist-jobs', self.generation)
        assert process_one()
        self.items = self.get('pmo', f'/projects/{self.pid}/checklists?page_size=100')['items']
        self.policies = {}
        for org in self.orgs:
            p = self.post('pmo', f'/projects/{self.pid}/admission-policies', {'org_id': org,
                'reference': '虚构测试字段批准', 'allowed_fields': ['document_type', 'department', 'location_code', 'acquisition', 'note'],
                'expires_at': (m.now() + timedelta(days=10)).isoformat()})
            self.post('cfo', f'/admission-policies/{p["id"]}/verify', {'reason': '测试独立核验'})
            self.policies[org] = p['id']

    def request(self, role, method, path, body=None, key=None):
        return self.clients[role].request(method, '/api/v1' + path, json=body,
                                        headers={'Idempotency-Key': key or m.uid()})

    def post(self, role, path, body=None, key=None):
        response = self.request(role, 'POST', path, body, key)
        assert response.status_code < 300, (path, response.status_code, response.text)
        return response.json()['data']

    def get(self, role, path):
        response = self.request(role, 'GET', path)
        assert response.status_code == 200, (path, response.status_code, response.text)
        return response.json()['data']

    def assign(self, item):
        result = self.post('pmo', '/checklists/assignments', {'rows': [{'item_id': item['id'],
            'expected_version': item['row_version'], 'owner_id': self.ids['owner'], 'reviewer_id': self.ids['reviewer'], 'due': '2025-12-01'}]})
        assert result['results'][0]['success']
        item = self.get('pmo', f'/checklists/{item["id"]}')['item']
        return self.post('pmo', f'/checklists/{item["id"]}/applicability-proposals', {
            'expected_version': item['row_version'], 'value': 'applicable', 'reason': '测试确认适用'})

    def evidence(self, item, acquisition='located'):
        return self.post('owner', f'/projects/{self.pid}/evidence', {'code': 'TEST-' + m.uid(),
            'org_id': item['org_id'], 'period_id': item['period_id'], 'policy_id': self.policies[item['org_id']],
            'reason': '虚构目录登记', 'metadata': self.metadata(acquisition)})

    @staticmethod
    def metadata(acquisition='located'):
        return {'document_type': '测试目录', 'department': '测试财务', 'location_code': 'TEST-001', 'acquisition': acquisition, 'note': '虚构测试信息'}

    def submitted(self, source=None, acquisition='located'):
        item = self.assign(source or self.items[0]); evidence = self.evidence(item, acquisition)
        item = self.post('owner', f'/checklists/{item["id"]}/evidence-links', {'expected_version': item['row_version'], 'evidence_id': evidence['id']})
        item = self.post('owner', f'/checklists/{item["id"]}/submissions', {'expected_version': item['row_version']})
        return item, evidence

    def accept(self, item, evidence, decision='accept'):
        detail = self.get('reviewer', f'/checklists/{item["id"]}')
        return self.post('reviewer', f'/checklists/{item["id"]}/reviews', {'expected_version': item['row_version'],
            'decision': decision, 'checks': detail['item']['checks'], 'evidence_version_ids': [evidence['current_version_id']],
            'reason': '独立检查完成', 'verification_method': '批准的纸档线下核查' if decision == 'restricted_verified' else None})

    def issue(self, item, kind='missing'):
        gap = self.post('pmo', f'/projects/{self.pid}/gaps', {'item_id': item['id'], 'kind': kind, 'facts': '虚构资料缺口事实'})
        return self.post('pmo', f'/projects/{self.pid}/issues', {'title': '测试整改事项', 'facts': '虚构资料缺口事实',
            'kind': kind, 'severity': 'P1', 'org_id': item['org_id'], 'owner_id': self.ids['owner'],
            'verifier_id': self.ids['reviewer'], 'due': '2025-12-01', 'gap_ids': [gap['id']]})

    def close(self):
        for c in self.clients.values(): c.close()


@pytest.fixture
def world(schema):
    with owner_engine.begin() as connection:
        tables = ', '.join('"' + name + '"' for name in m.Base.metadata.tables)
        connection.execute(text(f'TRUNCATE {tables} CASCADE'))
    instance = World()
    yield instance
    instance.close()
