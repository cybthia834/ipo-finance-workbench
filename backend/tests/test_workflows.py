import io
import json
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

from conftest import PASSWORD, owner_engine
from app import models as m
from app.common import digest
from app.config import settings
from app.db import SessionLocal
from app.worker import process_one, safe_cell


def test_generation_idempotence_and_zero_denominator(world):
    w = world
    assert len(w.items) == 66 and all(x['applicability'] == 'pending' for x in w.items)
    dashboard = w.get('pmo', f'/projects/{w.pid}/dashboard')['counts']
    assert dashboard['pending'] == 66 and dashboard['completion'] is None
    preview = w.post('pmo', f'/projects/{w.pid}/checklist-previews', w.generation)
    assert preview['new'] == 0 and preview['exchange_pending']
    key = m.uid(); path = f'/projects/{w.pid}/checklist-jobs'
    first = w.post('pmo', path, w.generation, key)
    second = w.post('pmo', path, w.generation, key)
    assert first['id'] == second['id']
    assert process_one() and not process_one()
    assert w.get('pmo', f'/projects/{w.pid}/checklists')['total'] == 66


def test_ten_representative_independent_reviews(world):
    w = world
    codes = ['FIN-01', 'FIN-02', 'REV-03', 'REV-04', 'REV-07', 'AR-01', 'INV-02', 'CASH-02', 'TAX-01', 'IC-01']
    for i, code in enumerate(codes):
        source = next(x for x in w.items if x['topic_code'] == code and x['org_id'] == w.orgs[i % 2])
        item, evidence = w.submitted(source)
        assert w.accept(item, evidence)['state'] == 'accepted'
    counts = w.get('cfo', f'/projects/{w.pid}/dashboard')['counts']
    assert counts['accepted'] == 10 and counts['applicable'] == 10 and counts['completion'] == 100


def test_self_review_and_version_replacement(world):
    w = world; item, evidence = w.submitted()
    response = w.request('owner', 'POST', f'/checklists/{item["id"]}/reviews', {
        'expected_version': item['row_version'], 'decision': 'accept', 'checks': [],
        'evidence_version_ids': [evidence['current_version_id']], 'reason': '自审应该被拒绝'})
    assert response.status_code == 403
    w.accept(item, evidence)
    updated = w.post('owner', f'/evidence/{evidence["id"]}/versions', {'expected_version': evidence['row_version'],
        'metadata': w.metadata(), 'reason': '补充新的目录版本'})
    detail = w.get('reviewer', f'/checklists/{item["id"]}')
    assert detail['item']['state'] == 'needs_review' and len(detail['reviews']) == 1
    assert detail['submissions'][0]['version_ids'] == [evidence['current_version_id']]
    assert updated['current_version_id'] != evidence['current_version_id']
    assert w.get('pmo', f'/projects/{w.pid}/dashboard')['counts']['accepted'] == 0


def test_partial_batch_and_self_assignment(world):
    w = world; a, b = w.items[:2]
    rows = [{'item_id': x['id'], 'expected_version': 1, 'owner_id': w.ids['owner'],
             'reviewer_id': w.ids['reviewer'], 'due': '2026-12-31'} for x in (a, b)]
    rows[1]['reviewer_id'] = w.ids['owner']
    rows.append({**rows[0], 'item_id': m.uid()})
    response = w.post('pmo', '/checklists/assignments', {'rows': rows})
    assert [r['success'] for r in response['results']] == [True, False, False]
    assert w.get('pmo', f'/checklists/{b["id"]}')['item']['owner_id'] is None


def test_applicability_and_self_approval(world):
    w = world; item = w.assign(w.items[0])
    path = f'/checklists/{item["id"]}/applicability-proposals'
    invalid = w.request('owner', 'POST', path, {'value': 'not_applicable', 'expected_version': item['row_version'], 'reason': ''})
    assert invalid.status_code == 422
    approval = w.post('owner', path, {'value': 'not_applicable', 'expected_version': item['row_version'], 'reason': '无该项业务的测试依据'})['approval']
    assert w.request('owner', 'POST', f'/approvals/{approval["id"]}/decisions', {'approve': True, 'reason': '自己批准不可以'}).status_code == 403
    w.post('reviewer', f'/approvals/{approval["id"]}/decisions', {'approve': True, 'reason': '独立验证不适用依据'})
    assert w.get('pmo', f'/checklists/{item["id"]}')['item']['applicability'] == 'not_applicable'


@pytest.mark.parametrize('kind', ['missing', 'scope_mismatch', 'approval_missing'])
def test_three_issue_types_independently_close_and_reopen(world, kind):
    w = world; item, evidence = w.submitted(); issue = w.issue(item, kind)
    payload = {'expected_version': issue['row_version'], 'reason': '补正完成申请验证', 'evidence_version_ids': [evidence['current_version_id']]}
    pending = w.post('owner', f'/issues/{issue["id"]}/submit-verification', payload)
    payload['expected_version'] = pending['row_version']
    assert w.request('owner', 'POST', f'/issues/{issue["id"]}/verifications', payload).status_code == 403
    closed = w.post('reviewer', f'/issues/{issue["id"]}/verifications', payload)
    assert closed['state'] == 'closed'
    reopened = w.post('reviewer', f'/issues/{issue["id"]}/reopen', {'expected_version': closed['row_version'], 'reason': '发现新线索再次整改'})
    assert reopened['state'] == 'in_progress'
    assert len(w.get('reviewer', f'/issues/{issue["id"]}')['actions']) == 4


def test_two_extensions_preserve_original_deadline(world):
    w = world; item = w.assign(w.items[0]); issue = w.issue(item)
    for due in ('2026-01-01', '2026-02-01'):
        approval = w.post('owner', f'/issues/{issue["id"]}/extension-requests', {
            'expected_version': issue['row_version'], 'new_due': due, 'reason': '需要更多时间核对依据'})
        assert w.get('owner', f'/issues/{issue["id"]}')['issue']['current_due'] == issue['current_due']
        w.post('cfo', f'/approvals/{approval["id"]}/decisions', {'approve': True, 'reason': '批准延期并保留原日期'})
        issue = w.get('owner', f'/issues/{issue["id"]}')['issue']
    assert issue['original_due'] == '2025-12-01' and issue['current_due'] == '2026-02-01' and issue['extension_count'] == 2


def test_snapshot_export_reproducibility_and_revocation(world):
    w = world; item, evidence = w.submitted(); w.accept(item, evidence)
    snap = w.post('pmo', f'/projects/{w.pid}/snapshots', {'purpose': '测试周会固定快照'})
    assert snap['manifest_hash'] == digest(snap['manifest'])
    hashes = []
    for _ in range(2):
        approval = w.post('pmo', f'/snapshots/{snap["id"]}/export-requests', {'reason': '测试授权目录导出'})
        assert w.request('pmo', 'POST', f'/approvals/{approval["id"]}/decisions', {'approve': True, 'reason': '自己不能批准导出'}).status_code == 403
        w.post('cfo', f'/approvals/{approval["id"]}/decisions', {'approve': True, 'reason': '批准本次目录导出'})
        assert process_one()
        rows = w.get('pmo', f'/projects/{w.pid}/approvals')
        export = next(a['export'] for a in rows if a['id'] == approval['id'])
        response = w.request('pmo', 'GET', f'/exports/{export["id"]}/download')
        assert response.status_code == 200
        hashes.append(digest(response.content))
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            assert json.loads(archive.read('manifest.json')) == snap['manifest']
    assert hashes[0] == hashes[1]
    w.post('owner', f'/evidence/{evidence["id"]}/versions', {'expected_version': evidence['row_version'], 'metadata': w.metadata(), 'reason': '快照后修改目录版本'})
    assert w.get('pmo', f'/snapshots/{snap["id"]}') == snap
    w.post('cfo', f'/memberships/{w.members["pmo"]["id"]}/revoke', {'reason': '撤销下载人员权限'})
    assert w.request('pmo', 'GET', f'/exports/{export["id"]}/download').status_code == 403


def test_policy_revoke_hides_evidence_and_invalidates_accepted(world):
    w = world; item, evidence = w.submitted(); w.accept(item, evidence)
    snap = w.post('pmo', f'/projects/{w.pid}/snapshots', {'purpose': '测试撤销准入快照'})
    w.post('cfo', f'/admission-policies/{evidence["policy_id"]}/revoke', {'reason': '撤销目录准入依据'})
    assert w.request('owner', 'GET', f'/evidence/{evidence["id"]}').status_code == 403
    assert w.request('pmo', 'GET', f'/snapshots/{snap["id"]}').status_code == 403
    assert w.get('pmo', f'/projects/{w.pid}/dashboard')['counts']['accepted'] == 0


def test_scope_and_management_permissions(world):
    w = world
    assert w.request('it', 'GET', f'/projects/{w.pid}/dashboard').status_code == 403
    assert w.request('owner', 'GET', f'/checklists/{w.items[0]["id"]}').status_code == 403
    assert w.get('owner', f'/projects/{w.pid}/dashboard')['counts']['total'] == 0
    response = w.request('pmo', 'POST', f'/projects/{w.pid}/memberships', {
        'user_id': w.ids['cfo'], 'roles': ['owner'], 'org_ids': w.orgs})
    assert response.status_code == 403


def test_audit_failure_rolls_back_business_write(world):
    w = world; item = w.items[0]
    with owner_engine.begin() as db: db.execute(text('REVOKE INSERT ON audit_event FROM finance_app'))
    try:
        response = w.request('pmo', 'POST', f'/checklists/{item["id"]}/applicability-proposals', {
            'expected_version': item['row_version'], 'value': 'applicable', 'reason': '审计失败必须全部回滚'})
        assert response.status_code == 503
    finally:
        with owner_engine.begin() as db: db.execute(text('GRANT INSERT ON audit_event TO finance_app'))
    assert w.get('pmo', f'/checklists/{item["id"]}')['item']['applicability'] == 'pending'


def test_immutable_history_enforced_in_database(world):
    w = world; item, evidence = w.submitted(); w.accept(item, evidence)
    for table in ('evidence_version', 'review', 'audit_event'):
        with pytest.raises(DBAPIError):
            with SessionLocal.begin() as db: db.execute(text(f'UPDATE {table} SET id=id'))
        with pytest.raises(DBAPIError):
            with owner_engine.begin() as db: db.execute(text(f'UPDATE {table} SET id=id'))


def test_version_race_never_preserves_stale_acceptance(world):
    w = world; item, evidence = w.submitted()
    detail = w.get('reviewer', f'/checklists/{item["id"]}')
    def accept():
        return w.request('reviewer', 'POST', f'/checklists/{item["id"]}/reviews', {
            'expected_version': item['row_version'], 'decision': 'accept', 'checks': detail['item']['checks'],
            'evidence_version_ids': [evidence['current_version_id']], 'reason': '并发版本接受测试'})
    def replace():
        return w.request('owner', 'POST', f'/evidence/{evidence["id"]}/versions', {
            'expected_version': evidence['row_version'], 'metadata': w.metadata(), 'reason': '并发新版替换测试'})
    with ThreadPoolExecutor(max_workers=2) as pool:
        a, b = pool.submit(accept), pool.submit(replace)
        assert a.result().status_code in (200, 409) and b.result().status_code == 200
    assert w.get('pmo', f'/checklists/{item["id"]}')['item']['state'] == 'needs_review'


def test_csrf_session_logout_and_lockout(world):
    w = world; c = w.clients['owner']
    response = c.post('/api/v1/auth/logout', headers={'X-CSRF-Token': 'invalid'})
    assert response.status_code == 403
    cookie = c.cookies.get('finance_session')
    w.post('owner', '/auth/logout')
    c.cookies.set('finance_session', cookie)
    assert w.request('owner', 'GET', '/me').status_code == 401
    for _ in range(5):
        assert c.post('/api/v1/auth/login', json={'username': 'owner', 'password': 'wrong'}).status_code == 401
    assert c.post('/api/v1/auth/login', json={'username': 'owner', 'password': PASSWORD}).status_code == 401


def test_forbidden_payloads_and_features(world):
    w = world; item = w.assign(w.items[0])
    body = {'code': 'ATTEMPT', 'org_id': item['org_id'], 'period_id': item['period_id'],
            'policy_id': w.policies[item['org_id']], 'metadata': w.metadata(), 'reason': '测试拒绝非法字段'}
    for extra in ({'mode': 'B'}, {'state': 'accepted'}, {'file': 'fake-original'}):
        assert w.request('owner', 'POST', f'/projects/{w.pid}/evidence', {**body, **extra}).status_code == 422
    body['metadata']['voucher_code'] = 'UNAPPROVED'
    assert w.request('owner', 'POST', f'/projects/{w.pid}/evidence', body).status_code == 422
    for path in ('/ai/analyze', '/evidence/uploads', '/files/unknown'):
        assert w.request('owner', 'POST', path, {'content': 'x'}).status_code == 403
    response = w.clients['owner'].post('/api/v1/projects', content=iter([b'x' * 100000, b'x' * 100000]))
    assert response.status_code == 413


def test_restricted_verification_and_negative_saving(world):
    w = world; item, evidence = w.submitted(acquisition='restricted')
    assert w.accept(item, evidence, 'restricted_verified')['state'] == 'restricted_verified'
    counts = w.get('pmo', f'/projects/{w.pid}/dashboard')['counts']
    assert counts['accepted'] == 0 and counts['restricted_verified'] == 1
    for group, minutes in [('baseline', 20), ('actual', 30), ('maintenance', 10)]:
        w.post('pmo', f'/projects/{w.pid}/metric-samples', {'task_type': '目录整理', 'group': group, 'minutes': minutes})
    assert w.get('pmo', f'/projects/{w.pid}/metrics')[0]['net_minutes'] == -20
    assert safe_cell('=1+1') == "'=1+1" and safe_cell('ordinary') == 'ordinary'


def test_same_person_and_idempotency_payload_conflict(world):
    w = world
    with SessionLocal() as db: person = db.get(m.User, w.ids['owner']).person_id
    response = w.request('it', 'POST', '/users', {'username': 'second-owner', 'display_name': '第二账号', 'person_id': person, 'password': PASSWORD})
    assert response.status_code == 409
    path = f'/projects/{w.pid}/snapshots'; key = m.uid()
    first = w.post('pmo', path, {'purpose': '幂等快照测试'}, key)
    assert w.post('pmo', path, {'purpose': '幂等快照测试'}, key)['id'] == first['id']
    assert w.request('pmo', 'POST', path, {'purpose': '不同内容快照'}, key).status_code == 409


@pytest.mark.parametrize('change', [{'upload_enabled': True}, {'ai_enabled': True}, {'audit_required': False}, {'directory_only': False}])
def test_runtime_feature_flags_fail_closed(change):
    from app.config import Settings
    from pydantic import ValidationError
    with pytest.raises(ValidationError): Settings(**{**settings.model_dump(), **change})


def test_template_change_does_not_overwrite_reviewed_checklist(world):
    w = world; item, evidence = w.submitted(); w.accept(item, evidence)
    draft = w.post('pmo', f'/templates/{w.pid}/versions')
    content = w.get('pmo', f'/template-versions/{draft["id"]}')
    assert content['changes'] == []
    entry = content['items'][0]
    body = {key: entry[key] for key in ('code', 'title', 'domain', 'source', 'standard', 'checks')}
    body.update(standard='更新后的虚构验收标准', expected_hash=entry['edit_hash'])
    response = w.request('pmo', 'PATCH', f'/template-items/{entry["id"]}', body)
    assert response.status_code == 200
    assert len(w.get('pmo', f'/template-versions/{draft["id"]}')['changes']) == 1
    assert w.request('pmo', 'PATCH', f'/template-items/{entry["id"]}', body).status_code == 409
    assert w.request('pmo', 'POST', f'/template-versions/{draft["id"]}/publish', {'reason': '不允许自行发布'}).status_code == 403
    w.post('cfo', f'/template-versions/{draft["id"]}/publish', {'reason': '独立审核新版本差异'})
    assert w.request('pmo', 'PATCH', f'/template-items/{entry["id"]}', body).status_code == 403
    with pytest.raises(DBAPIError):
        with owner_engine.begin() as db: db.execute(text('UPDATE template_item_version SET title=title WHERE id=:id'), {'id': entry['id']})
    w.post('pmo', f'/projects/{w.pid}/checklist-jobs', {'template_version_id': draft['id'], 'scope_version': 1})
    process_one()
    assert w.get('pmo', f'/projects/{w.pid}/checklists')['total'] == 66
    detail = w.get('pmo', f'/checklists/{item["id"]}')
    assert detail['item']['state'] == 'accepted' and detail['item']['template_item_id'] == item['template_item_id']


def test_worker_transaction_interruption_recovers_without_duplicates(world, monkeypatch):
    import app.worker as worker
    w = world; job = w.post('pmo', f'/projects/{w.pid}/checklist-jobs', w.generation)
    real_generate = worker.generate
    def interrupted(*args):
        real_generate(*args)
        raise RuntimeError('simulated process interruption before commit')
    with monkeypatch.context() as patch:
        patch.setattr(worker, 'generate', interrupted)
        assert worker.process_one()
    assert w.get('pmo', f'/jobs/{job["id"]}')['state'] == 'retry_wait'
    with SessionLocal.begin() as db:
        db.get(m.Job, job['id']).next_run_at = m.now() - timedelta(seconds=1)
    assert worker.process_one() and not worker.process_one()
    assert w.get('pmo', f'/projects/{w.pid}/checklists')['total'] == 66


def test_standalone_issue_verifier_can_read_submitted_evidence(world):
    w = world; evidence = w.evidence(w.items[0])
    issue = w.post('pmo', f'/projects/{w.pid}/issues', {'title': '手工整改资料核查', 'facts': '虚构资料验证事实',
        'kind': 'other', 'severity': 'P2', 'org_id': evidence['org_id'], 'owner_id': w.ids['owner'],
        'verifier_id': w.ids['reviewer'], 'due': '2026-12-01'})
    assert w.request('reviewer', 'GET', f'/evidence/{evidence["id"]}').status_code == 403
    issue = w.post('owner', f'/issues/{issue["id"]}/submit-verification', {'expected_version': issue['row_version'],
        'reason': '提交独立核查所需资料', 'evidence_version_ids': [evidence['current_version_id']]})
    assert w.get('reviewer', f'/evidence/{evidence["id"]}')['evidence']['id'] == evidence['id']


def test_restricted_evidence_cannot_receive_ordinary_acceptance(world):
    w = world; item, evidence = w.submitted(acquisition='restricted')
    detail = w.get('reviewer', f'/checklists/{item["id"]}')
    response = w.request('reviewer', 'POST', f'/checklists/{item["id"]}/reviews', {'expected_version': item['row_version'],
        'decision': 'accept', 'checks': detail['item']['checks'], 'evidence_version_ids': [evidence['current_version_id']], 'reason': '不能将受限资料普通接受'})
    assert response.status_code == 422
