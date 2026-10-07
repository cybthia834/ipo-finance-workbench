from datetime import date
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from sqlalchemy import func, select

from .. import models as m, schemas as s
from ..common import DB, DomainError, audit, bump, check_version, command, digest, lock_project, ok, record, require
from ..security import Actor, distinct, evidence_access, evidence_query, issue_access, issue_query, item_access, item_query, membership
from ..services import pack_items, pack_issues
from ..config import settings

router = APIRouter()


def dataset(db, actor, project_id, org_id=None, period_id=None):
    iq = item_query(db, actor, project_id).where(m.Checklist.current.is_(True))
    rq = issue_query(db, actor, project_id)
    if org_id: iq = iq.where(m.Checklist.org_id == org_id); rq = rq.where(m.Issue.org_id == org_id)
    if period_id:
        iq = iq.where(m.Checklist.period_id == period_id)
        related = select(m.IssueGap.issue_id).join(m.Gap, m.Gap.id == m.IssueGap.gap_id).join(m.Checklist, m.Checklist.id == m.Gap.item_id).where(m.Checklist.period_id == period_id)
        rq = rq.where(m.Issue.id.in_(related))
    return pack_items(db, db.scalars(iq.order_by(m.Checklist.topic_code, m.Checklist.id)).all()), pack_issues(db, db.scalars(rq).all())


def counts(items, issues):
    applicable = [x for x in items if x['applicability'] == 'applicable']
    accepted = [x for x in applicable if x['state'] == 'accepted']
    return {'total': len(items), 'applicable': len(applicable), 'accepted': len(accepted),
            'pending': sum(x['applicability'] == 'pending' for x in items),
            'restricted': sum(x['state'] in ('restricted_pending', 'restricted_verified') for x in items),
            'restricted_verified': sum(x['state'] == 'restricted_verified' for x in items),
            'open_issues': sum(x['state'] != 'closed' for x in issues), 'overdue': sum(x['overdue'] for x in issues),
            'completion': round(len(accepted) * 100 / len(applicable), 1) if applicable else None,
            'assignment_exceptions': sum(not x['assignment_valid'] for x in applicable),
            'coverage': round(sum(x['assignment_valid'] for x in applicable) * 100 / len(applicable), 1) if applicable else None}


@router.get('/projects/{project_id}/dashboard')
def dashboard(project_id: str, actor: Actor, db: DB, org_id: str | None = None, period_id: str | None = None):
    items, issues = dataset(db, actor, project_id, org_id, period_id)
    domains = []
    for domain in ('FIN', 'REV', 'AR', 'INV', 'CASH', 'TAX', 'RP', 'IC'):
        group = [x for x in items if x['domain'] == domain]
        domains.append({'domain': domain, 'total': len(group), 'accepted': sum(x['state'] == 'accepted' and x['applicability'] == 'applicable' for x in group),
                        'pending': sum(x['applicability'] == 'pending' for x in group)})
    todo = [x for x in items if (x['owner_id'] == actor.id and x['state'] not in ('accepted', 'submitted', 'restricted_verified')) or
            (x['reviewer_id'] == actor.id and x['state'] in ('submitted', 'needs_review'))]
    audit(db, actor, project_id, 'dashboard_viewed', project_id)
    return ok({'counts': counts(items, issues), 'domains': domains, 'todo': todo[:12],
               'urgent_issues': sorted([x for x in issues if x['state'] != 'closed'], key=lambda x: (x['severity'], x['current_due']))[:8]})


def snapshot_access(db, actor, snap):
    require(snap, 'NOT_FOUND', '快照不存在', 404)
    mem = membership(db, actor, snap.project_id, ['cfo', 'pmo'])
    require(set(snap.manifest['org_ids']) <= set(mem.org_ids), 'SNAPSHOT_SCOPE_REVOKED', '快照范围超过当前权限')
    for entry in snap.manifest['evidence']:
        evidence_access(db, actor, entry['id'])
    return snap


@router.post('/projects/{project_id}/snapshots')
def snapshot_create(project_id: str, body: s.SnapshotInput, request: Request, actor: Actor, db: DB):
    lock_project(db, project_id); mem = membership(db, actor, project_id, ['cfo', 'pmo'])
    def run():
        items, issues = dataset(db, actor, project_id, body.org_id, body.period_id)
        q = evidence_query(db, actor, project_id)
        if body.org_id: q = q.where(m.Evidence.org_id == body.org_id)
        if body.period_id: q = q.where(m.Evidence.period_id == body.period_id)
        evidence = db.scalars(q.order_by(m.Evidence.id)).all()
        project = db.get(m.Project, project_id); snapshot_id = m.uid()
        manifest = {'snapshot_id': snapshot_id, 'as_of': m.now().isoformat(), 'purpose': body.purpose,
                    'project_id': project_id, 'scope_version': project.scope_version, 'template_version_id': project.template_version_id,
                    'metric_version': 'directory-v1', 'org_ids': sorted({x['org_id'] for x in items + issues} | {e.org_id for e in evidence}),
                    'items': items, 'issues': sorted(issues, key=lambda x: x['id']), 'counts': counts(items, issues),
                    'evidence': [{**record(e), 'version': record(db.get(m.EvidenceVersion, e.current_version_id))} for e in evidence]}
        snap = m.Snapshot(id=snapshot_id, project_id=project_id, author_id=actor.id, manifest=manifest, manifest_hash=digest(manifest))
        db.add(snap); audit(db, actor, snap.id, 'snapshot_frozen', project_id, after=snap.manifest_hash)
        return record(snap)
    return ok(command(db, actor, request, body.model_dump(), run))


@router.get('/projects/{project_id}/snapshots')
def snapshots(project_id: str, actor: Actor, db: DB):
    membership(db, actor, project_id, ['cfo', 'pmo']); result = []
    for snap in db.scalars(select(m.Snapshot).where(m.Snapshot.project_id == project_id).order_by(m.Snapshot.created_at.desc())):
        try: snapshot_access(db, actor, snap)
        except DomainError: continue
        result.append({**record(snap, ('manifest',)), 'as_of': snap.manifest['as_of'], 'counts': snap.manifest['counts']})
    audit(db, actor, project_id, 'snapshots_viewed', project_id)
    return ok(result)


@router.get('/snapshots/{snapshot_id}')
def snapshot_get(snapshot_id: str, actor: Actor, db: DB):
    snap = snapshot_access(db, actor, db.get(m.Snapshot, snapshot_id)); audit(db, actor, snap.id, 'snapshot_viewed', snap.project_id)
    return ok(record(snap))


@router.post('/snapshots/{snapshot_id}/export-requests')
def export_request(snapshot_id: str, body: s.Reason, request: Request, actor: Actor, db: DB):
    snap = db.get(m.Snapshot, snapshot_id); require(snap, 'NOT_FOUND', '快照不存在', 404)
    lock_project(db, snap.project_id); snapshot_access(db, actor, snap)
    def run():
        approval = m.Approval(project_id=snap.project_id, kind='export', snapshot_id=snap.id, author_id=actor.id,
            reason=body.reason, payload={'manifest_hash': snap.manifest_hash, 'format': 'directory-csv-v1'})
        db.add(approval); db.flush(); audit(db, actor, approval.id, 'export_requested', snap.project_id)
        return record(approval)
    return ok(command(db, actor, request, body.model_dump(), run))


def approval_access(db, actor, approval):
    require(approval, 'NOT_FOUND', '审批记录不存在', 404)
    if approval.item_id: item_access(db, actor, approval.item_id)
    elif approval.issue_id: issue_access(db, actor, approval.issue_id)
    else: snapshot_access(db, actor, db.get(m.Snapshot, approval.snapshot_id))


@router.get('/projects/{project_id}/approvals')
def approvals(project_id: str, actor: Actor, db: DB):
    membership(db, actor, project_id); result = []
    for a in db.scalars(select(m.Approval).where(m.Approval.project_id == project_id).order_by(m.Approval.created_at.desc())):
        try: approval_access(db, actor, a)
        except DomainError: continue
        export = db.scalar(select(m.Export).where(m.Export.approval_id == a.id))
        result.append({**record(a), 'export': record(export, ('path',)) if export else None})
    return ok(result)


@router.post('/approvals/{approval_id}/decisions')
def decide(approval_id: str, body: s.Decision, request: Request, actor: Actor, db: DB):
    a = db.get(m.Approval, approval_id); approval_access(db, actor, a)
    lock_project(db, a.project_id); db.refresh(a); distinct(db, actor, [a.author_id])
    membership(db, actor, a.project_id, ['cfo', 'reviewer'] if a.kind == 'applicability' else ['cfo'])
    def run():
        require(a.state == 'pending', 'ALREADY_DECIDED', '申请已经处理', 409)
        if body.approve:
            if a.kind == 'applicability':
                row = db.get(m.Checklist, a.item_id); check_version(row, a.payload['expected_version'])
                require(not db.scalar(select(m.Issue.id).join(m.IssueGap).join(m.Gap).where(m.Gap.item_id == row.id, m.Issue.state != 'closed').limit(1)),
                        'OPEN_ISSUES', '关联整改仍未处理', 409)
                row.applicability = 'not_applicable'; bump(row)
            elif a.kind == 'extension':
                row = db.get(m.Issue, a.issue_id); check_version(row, a.payload['expected_version'])
                require(row.state != 'closed', 'INVALID_STATE', '已关闭事项不能延期', 409)
                row.current_due = date.fromisoformat(a.payload['new_due']); row.extension_count += 1; bump(row)
                db.add(m.IssueAction(issue_id=row.id, actor_id=actor.id, action='extension_approved', reason=body.reason))
            else:
                snap = snapshot_access(db, actor, db.get(m.Snapshot, a.snapshot_id))
                require(snap.manifest_hash == a.payload['manifest_hash'], 'MANIFEST_MISMATCH', '快照摘要不符', 409)
                db.add(m.Job(project_id=a.project_id, actor_id=a.author_id, kind='export', payload={'approval_id': a.id}))
        a.state, a.decider_id, a.decision_reason = ('approved' if body.approve else 'rejected'), actor.id, body.reason
        audit(db, actor, a.id, 'approval_decided', a.project_id)
        return record(a)
    return ok(command(db, actor, request, body.model_dump(), run))


@router.get('/exports/{export_id}/download')
def download(export_id: str, actor: Actor, db: DB):
    export = db.get(m.Export, export_id); require(export, 'NOT_FOUND', '导出不存在', 404)
    snap = snapshot_access(db, actor, db.get(m.Snapshot, export.snapshot_id))
    approval = db.get(m.Approval, export.approval_id)
    require(approval.state == 'approved' and export.expires_at > m.now(), 'EXPORT_EXPIRED', '导出许可已失效')
    path = Path(export.path).resolve(); root = settings.export_storage_root.resolve()
    require(path.is_relative_to(root) and path.is_file(), 'EXPORT_MISSING', '导出文件需要重新生成', 409)
    require(digest(path.read_bytes()) == export.artifact_hash, 'EXPORT_CORRUPTED', '导出校验失败', 503)
    audit(db, actor, export_id, 'export_downloaded', snap.project_id)
    return FileResponse(path, media_type='application/zip', filename=f'目录快照-{snap.id[:8]}.zip', headers={'Cache-Control': 'no-store'})


@router.get('/projects/{project_id}/audit')
def audits(project_id: str, actor: Actor, db: DB):
    membership(db, actor, project_id, ['cfo', 'pmo'])
    # Audit endpoint contains IDs only and must be limited to full-project administrators.
    mem = membership(db, actor, project_id)
    all_orgs = set(db.scalars(select(m.Organization.id).where(m.Organization.project_id == project_id)))
    require(all_orgs <= set(mem.org_ids), 'AUDIT_SCOPE', '审计查询需完整项目授权')
    rows = db.scalars(select(m.AuditEvent).where(m.AuditEvent.project_id == project_id).order_by(m.AuditEvent.created_at.desc()).limit(100)).all()
    return ok([record(x) for x in rows])


@router.post('/projects/{project_id}/metric-samples')
def metric(project_id: str, body: s.MetricInput, actor: Actor, db: DB):
    membership(db, actor, project_id, ['cfo', 'pmo'])
    row = m.MetricSample(project_id=project_id, actor_id=actor.id, **body.model_dump()); db.add(row); db.flush()
    audit(db, actor, row.id, 'metric_recorded', project_id)
    return ok(record(row))


@router.get('/projects/{project_id}/metrics')
def metrics(project_id: str, actor: Actor, db: DB):
    membership(db, actor, project_id, ['cfo', 'pmo'])
    rows = db.scalars(select(m.MetricSample).where(m.MetricSample.project_id == project_id)).all(); result = []
    for kind in sorted({r.task_type for r in rows}):
        group = [r for r in rows if r.task_type == kind]
        baseline = [r for r in group if r.group == 'baseline']; actual = [r for r in group if r.group == 'actual']
        n, k = sum(r.count for r in baseline), sum(r.count for r in actual)
        saving = (sum(r.minutes for r in baseline) / n * k - sum(r.minutes for r in actual)
                   - sum(r.minutes for r in group if r.group == 'maintenance')) if n and k else None
        result.append({'task_type': kind, 'baseline_count': n, 'actual_count': k, 'net_minutes': saving})
    return ok(result)


@router.get('/me/views')
def views(actor: Actor, db: DB):
    return ok([record(v) for v in db.scalars(select(m.PersonalView).where(m.PersonalView.user_id == actor.id))])


@router.post('/me/views')
def save_view(body: s.ViewInput, actor: Actor, db: DB):
    membership(db, actor, body.project_id)
    require(set(body.filters) <= {'q', 'org_id', 'period_id', 'applicability', 'state', 'domain', 'mine'}, 'INVALID_FILTER', '筛选条件无效', 422)
    row = m.PersonalView(user_id=actor.id, **body.model_dump()); db.add(row); db.flush()
    return ok(record(row))
