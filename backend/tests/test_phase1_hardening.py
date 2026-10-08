"""Regression tests for the V0.2 development changes, using isolated PostgreSQL."""
import io
import json
import threading
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from openpyxl import load_workbook
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from conftest import PASSWORD, owner_engine
from app import models as m
from app.common import DomainError, digest, lock_identity
from app.config import settings
from app.db import SessionLocal
from app.worker import claim_one, execute, process_one, renew, cleanup_exports


def test_identity_admin_has_accounts_but_no_implicit_finance_access(world):
    w = world
    assert len(w.get('it', '/users')) == 5
    assert w.request('owner', 'GET', '/users').status_code == 403
    p = w.post('it', '/projects', {'initial_cfo_id': w.ids['cfo'], 'name': '运维初始化财务项目',
        'organizations': [{'code': 'BOOT', 'name': '虚构初始化主体'}],
        'periods': [{'label': '测试期', 'start': '2026-01-01', 'end': '2026-12-31'}]})
    assert w.request('it', 'GET', f'/projects/{p["id"]}/context').status_code == 403
    assert w.get('cfo', f'/projects/{p["id"]}/context')['roles'] == ['cfo', 'pmo']


def test_account_creation_idempotency_disable_and_reset_revoke_sessions(world):
    w = world; path = '/users'; key = m.uid()
    body = {'username': 'new-owner', 'display_name': '虚构新增经办', 'person_id': 'PERSON-NEW', 'password': PASSWORD}
    u = w.post('it', path, body, key)
    assert w.post('it', path, body, key)['id'] == u['id']
    assert u['must_change_password']
    assert any(x['id'] == u['id'] for x in w.get('cfo', f'/projects/{w.pid}/member-candidates'))
    owner = next(u for u in w.get('it', '/users') if u['id'] == w.ids['owner'])
    disabled = w.post('it', f'/users/{owner["id"]}/status', {'active': False, 'expected_version': owner['row_version'], 'reason': '测试停用会话'})
    assert w.request('owner', 'GET', '/me').status_code == 401
    w.post('it', f'/users/{owner["id"]}/status', {'active': True, 'expected_version': disabled['row_version'], 'reason': '测试重新启用'})
    assert w.request('owner', 'GET', '/me').status_code == 401
    reviewer = next(u for u in w.get('it', '/users') if u['id'] == w.ids['reviewer'])
    w.post('it', f'/users/{reviewer["id"]}/password-reset', {'expected_version': reviewer['row_version'],
        'new_password': 'Replacement-fictional-password', 'reason': '独立重置测试密码'})
    assert w.request('reviewer', 'GET', '/me').status_code == 401
    with SessionLocal() as db:
        records = db.scalars(select(m.Idempotency)).all()
        assert all(PASSWORD not in json.dumps(r.result) for r in records)


def test_identity_disable_waits_for_in_flight_authorized_transaction(world):
    w = world; started = threading.Event()
    u = next(u for u in w.get('it', '/users') if u['id'] == w.ids['owner'])
    def disable():
        started.set()
        return w.request('it', 'POST', f'/users/{u["id"]}/status',
            {'active': False, 'expected_version': u['row_version'], 'reason': '并发停用测试'})
    with ThreadPoolExecutor(max_workers=1) as pool:
        with SessionLocal.begin() as db:
            lock_identity(db)
            future = pool.submit(disable)
            assert started.wait(2)
            # Inspect the actual lock wait, rather than relying only on timing.
            for _ in range(100):
                waiting = db.scalar(text("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND NOT granted"))
                if waiting: break
                threading.Event().wait(.01)
            assert waiting and not future.done()
        assert future.result(timeout=5).status_code == 200
    assert w.request('owner', 'GET', '/me').status_code == 401


def test_expired_lease_fences_old_worker_and_recovery_is_unique(world):
    w = world; job = w.post('pmo', f'/projects/{w.pid}/checklist-jobs', w.generation)
    old_id, old_token = claim_one()
    with SessionLocal.begin() as db: db.get(m.Job, old_id).lease_until = m.now() - timedelta(seconds=1)
    assert not renew(old_id, old_token)
    new_id, new_token = claim_one()
    assert new_id == old_id == job['id'] and new_token != old_token
    with pytest.raises(DomainError, match='任务租约'): execute(old_id, old_token)
    execute(new_id, new_token)
    result = w.get('pmo', f'/jobs/{job["id"]}')
    assert result['state'] == 'succeeded' and result['attempts'] == 2 and 'attempt_token' not in result
    assert w.get('pmo', f'/projects/{w.pid}/checklists')['total'] == 66


def test_persistent_worker_error_retries_at_most_three_times(world, monkeypatch):
    import app.worker as worker
    w = world; job = w.post('pmo', f'/projects/{w.pid}/checklist-jobs', w.generation)
    def error(*args): raise RuntimeError('fictional fault')
    monkeypatch.setattr(worker, 'generate', error)
    for i in range(3):
        assert process_one()
        with SessionLocal.begin() as db:
            row = db.get(m.Job, job['id'])
            assert row.attempts == i + 1
            assert row.state == ('failed' if i == 2 else 'retry_wait')
            row.next_run_at = m.now() - timedelta(seconds=1)
    assert not process_one()
    assert w.get('pmo', f'/projects/{w.pid}/checklists')['total'] == 66


def test_generated_job_rechecks_scope_before_execution(world):
    w = world; job = w.post('pmo', f'/projects/{w.pid}/checklist-jobs', w.generation)
    w.post('cfo', f'/projects/{w.pid}/memberships', {'user_id': w.ids['pmo'], 'roles': ['pmo'], 'org_ids': w.orgs[:1]})
    assert process_one()
    assert w.request('pmo', 'GET', f'/jobs/{job["id"]}').status_code == 403
    with SessionLocal() as db: assert db.get(m.Job, job['id']).error_code == 'JOB_SCOPE_REVOKED'


def test_xlsx_strings_hashes_and_retention(world):
    w = world; item = w.assign(w.items[0])
    e = w.post('owner', f'/projects/{w.pid}/evidence', {'code': '=HYPERLINK("https://invalid.example")',
        'org_id': item['org_id'], 'period_id': item['period_id'], 'policy_id': w.policies[item['org_id']],
        'metadata': w.metadata(), 'reason': '公式样式代号的虚构测试'})
    snap = w.post('pmo', f'/projects/{w.pid}/snapshots', {'purpose': '检查导出文字安全与保留'})
    a = w.post('pmo', f'/snapshots/{snap["id"]}/export-requests', {'reason': '测试导出文件许可'})
    w.post('cfo', f'/approvals/{a["id"]}/decisions', {'approve': True, 'reason': '测试独立批准'})
    assert process_one()
    artifact = next(x['export'] for x in w.get('pmo', f'/projects/{w.pid}/approvals') if x['id'] == a['id'])
    response = w.request('pmo', 'GET', f'/exports/{artifact["id"]}/download')
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as z:
        workbook = z.read('directory.xlsx'); checks = json.loads(z.read('checksums.json'))
        assert checks['manifest_sha256'] == snap['manifest_hash']
        assert checks['directory.xlsx'] == digest(workbook)
        book = load_workbook(io.BytesIO(workbook), data_only=False)
        assert book['目录版本']['A2'].value == e['code']
        assert all(cell.data_type != 'f' and cell.hyperlink is None for ws in book for row in ws for cell in row)
        with zipfile.ZipFile(io.BytesIO(workbook)) as xlsx: assert not any('externalLinks/' in n for n in xlsx.namelist())
    with SessionLocal.begin() as db:
        row = db.get(m.Export, artifact['id']); path = row.path; row.expires_at = m.now() - timedelta(seconds=1)
    cleanup_exports(); cleanup_exports()
    from pathlib import Path
    assert not Path(path).exists()
    assert w.request('pmo', 'GET', f'/exports/{artifact["id"]}/download').status_code == 403


def test_template_adoption_reopens_review_without_mutating_history(world):
    w = world; item, e = w.submitted(); accepted = w.accept(item, e)
    version = w.post('pmo', f'/templates/{w.pid}/versions')
    w.post('cfo', f'/template-versions/{version["id"]}/publish', {'reason': '测试独立发布新版'})
    detail = w.get('pmo', f'/checklists/{item["id"]}'); target = detail['template_upgrade']
    retained = w.post('pmo', f'/checklists/{item["id"]}/template-decisions', {'expected_version': accepted['row_version'],
        'new_template_item_id': target['id'], 'decision': 'retain', 'reason': '测试保留原标准'})
    assert retained['state'] == 'accepted'
    adopted = w.post('pmo', f'/checklists/{item["id"]}/template-decisions', {'expected_version': retained['row_version'],
        'new_template_item_id': target['id'], 'decision': 'adopt', 'reason': '测试采用新标准'})
    assert adopted['state'] == 'needs_review' and adopted['template_item_id'] == target['id']
    detail = w.get('pmo', f'/checklists/{item["id"]}')
    assert len(detail['reviews']) == 1 and len(detail['template_decisions']) == 2
    assert detail['submissions'][0]['template_item_id'] == item['template_item_id']
    with pytest.raises(DBAPIError):
        with owner_engine.begin() as db: db.execute(text('UPDATE template_upgrade_decision SET reason=reason'))


def test_sql_pagination_and_derived_state_agree_after_revocation(world):
    w = world; item, e = w.submitted(); w.accept(item, e)
    pages = [w.get('pmo', f'/projects/{w.pid}/checklists?page={p}&page_size=10') for p in range(1, 8)]
    ids = [i['id'] for page in pages for i in page['items']]
    assert len(ids) == len(set(ids)) == 66 and all(p['total'] == 66 for p in pages)
    w.post('cfo', f'/admission-policies/{e["policy_id"]}/revoke', {'reason': '测试分页派生状态'})
    assert w.get('pmo', f'/projects/{w.pid}/checklists?state=accepted')['total'] == 0
    result = w.get('pmo', f'/projects/{w.pid}/checklists?state=needs_review')
    assert result['total'] == 1 and result['items'][0]['id'] == item['id']
