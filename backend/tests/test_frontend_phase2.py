from app import models as m
from app.db import SessionLocal
from app.worker import process_one


def test_dashboard_issue_drilldown_matches_period(world):
    item, _ = world.submitted()
    world.issue(item)
    # A standalone issue has no period link and must not leak into this slice.
    world.post('pmo', f'/projects/{world.pid}/issues', {
        'title': '其他范围虚构整改', 'facts': '未关联期间的虚构事项', 'kind': 'missing',
        'severity': 'P2', 'org_id': item['org_id'], 'owner_id': world.ids['owner'],
        'verifier_id': world.ids['reviewer'], 'due': '2025-12-01', 'gap_ids': [],
    })
    query = f'org_id={item["org_id"]}&period_id={world.period}'
    counts = world.get('pmo', f'/projects/{world.pid}/dashboard?{query}')['counts']
    rows = world.get('pmo', f'/projects/{world.pid}/issues?state=open&{query}')
    assert counts['open_issues'] == rows['total'] == 1
    assert world.get('pmo', f'/projects/{world.pid}/issues?period_id=missing')['total'] == 0


def test_personal_view_and_metric_retries_are_idempotent(world):
    view = {'project_id': world.pid, 'name': '本人收入资料', 'filters': {'domain': 'REV'}}
    first = world.post('pmo', '/me/views', view, key='same-view')
    assert world.post('pmo', '/me/views', view, key='same-view')['id'] == first['id']
    assert len(world.get('pmo', '/me/views')) == 1
    assert world.get('owner', '/me/views') == []
    conflict = world.request('pmo', 'POST', '/me/views', {**view, 'name': 'changed'}, key='same-view')
    assert conflict.status_code == 409
    payload = {'task_type': '虚构定位', 'group': 'baseline', 'minutes': 10, 'count': 1}
    original = world.post('pmo', f'/projects/{world.pid}/metric-samples', payload, key='same-metric')
    assert world.post('pmo', f'/projects/{world.pid}/metric-samples', payload, key='same-metric')['id'] == original['id']
    assert world.get('pmo', f'/projects/{world.pid}/metrics')[0]['baseline_count'] == 1


def test_export_job_summary_is_authorized_and_contains_no_worker_secrets(world):
    item, evidence = world.submitted()
    world.accept(item, evidence)
    snap = world.post('pmo', f'/projects/{world.pid}/snapshots', {'purpose': '前端测试虚构快照'})
    approval = world.post('pmo', f'/snapshots/{snap["id"]}/export-requests', {'reason': '前端测试导出用途'})
    world.post('cfo', f'/approvals/{approval["id"]}/decisions', {'approve': True, 'reason': '独立确认虚构导出'})
    rows = world.get('cfo', f'/projects/{world.pid}/approvals')
    row = next(x for x in rows if x['id'] == approval['id'])
    assert row['job']['state'] == 'queued'
    assert set(row['job']) == {'id', 'state', 'attempts', 'error_code', 'next_run_at'}
    assert world.request('cfo', 'GET', f'/jobs/{row["job"]["id"]}').status_code == 403
    assert not any(x['id'] == approval['id'] for x in world.get('owner', f'/projects/{world.pid}/approvals'))
    assert process_one()
    ready = next(x for x in world.get('pmo', f'/projects/{world.pid}/approvals') if x['id'] == approval['id'])
    assert ready['job']['state'] == 'succeeded' and ready['export']['id']
    assert 'path' not in ready['export']
    with SessionLocal.begin() as db:
        member = db.get(m.Membership, world.members['pmo']['id'])
        member.active = False
    assert world.request('pmo', 'GET', f'/projects/{world.pid}/approvals').status_code == 403
