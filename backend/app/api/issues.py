from fastapi import APIRouter, Query, Request
from sqlalchemy import func, select

from .. import models as m, schemas as s
from ..common import DB, audit, bump, check_version, command, lock_project, ok, record, require
from ..security import Actor, assigned, distinct, evidence_access, issue_access, issue_query, item_access, membership, scoped_org
from ..services import pack_issues, today

router = APIRouter()


@router.post('/projects/{project_id}/gaps')
def new_gap(project_id: str, body: s.GapInput, request: Request, actor: Actor, db: DB):
    row = item_access(db, actor, body.item_id); require(row.project_id == project_id)
    lock_project(db, project_id); membership(db, actor, project_id, ['cfo', 'pmo', 'reviewer'])
    def run():
        submission = db.scalar(select(m.Submission).where(m.Submission.item_id == row.id).order_by(m.Submission.created_at.desc()).limit(1))
        provenance = {'template_item_id': row.template_item_id, 'item_version': row.row_version,
            'submission_id': submission.id if submission else None,
            'evidence_version_ids': list(db.scalars(select(m.SubmissionRef.version_id).where(m.SubmissionRef.submission_id == submission.id))) if submission else []}
        gap = m.Gap(**body.model_dump(), author_id=actor.id, provenance=provenance); db.add(gap); db.flush()
        audit(db, actor, gap.id, 'gap_created', project_id)
        return record(gap)
    return ok(command(db, actor, request, body.model_dump(), run))


@router.post('/projects/{project_id}/issues')
def new_issue(project_id: str, body: s.IssueCreate, request: Request, actor: Actor, db: DB):
    lock_project(db, project_id); mem = membership(db, actor, project_id, ['cfo', 'pmo', 'reviewer']); scoped_org(mem, body.org_id)
    owner = assigned(db, project_id, body.org_id, body.owner_id, ['owner', 'pmo', 'cfo'])
    assigned(db, project_id, body.org_id, body.verifier_id, ['reviewer', 'cfo']); distinct(db, owner, [body.verifier_id])
    for gap_id in body.gap_ids:
        gap = db.get(m.Gap, gap_id); require(gap, 'NOT_FOUND', '缺口不存在', 404)
        item = item_access(db, actor, gap.item_id)
        require(item.project_id == project_id and item.org_id == body.org_id, 'GAP_SCOPE_MISMATCH', '缺口范围不符', 422)
    def run():
        row = m.Issue(project_id=project_id, original_due=body.due, current_due=body.due,
            **body.model_dump(exclude={'due', 'gap_ids'}))
        db.add(row); db.flush()
        for gap_id in body.gap_ids: db.add(m.IssueGap(issue_id=row.id, gap_id=gap_id))
        db.add(m.IssueAction(issue_id=row.id, actor_id=actor.id, action='created', reason=body.facts))
        audit(db, actor, row.id, 'issue_created', project_id)
        return record(row)
    return ok(command(db, actor, request, body.model_dump(mode='json'), run))


@router.get('/projects/{project_id}/issues')
def issues(project_id: str, actor: Actor, db: DB, state: str | None = None, severity: str | None = None,
           org_id: str | None = None, overdue: bool = False, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)):
    query = issue_query(db, actor, project_id)
    if state == 'open': query = query.where(m.Issue.state != 'closed')
    elif state: query = query.where(m.Issue.state == state)
    if severity: query = query.where(m.Issue.severity == severity)
    if org_id: query = query.where(m.Issue.org_id == org_id)
    if overdue: query = query.where(m.Issue.current_due < today(), m.Issue.state != 'closed')
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = pack_issues(db, db.scalars(query.order_by(m.Issue.severity, m.Issue.current_due, m.Issue.id)
                       .offset((page - 1) * page_size).limit(page_size)).all())
    audit(db, actor, project_id, 'issues_searched', project_id)
    return ok({'items': rows, 'total': total, 'page': page, 'page_size': page_size})


@router.get('/issues/{issue_id}')
def issue_detail(issue_id: str, actor: Actor, db: DB):
    row = issue_access(db, actor, issue_id)
    actions = db.scalars(select(m.IssueAction).where(m.IssueAction.issue_id == issue_id).order_by(m.IssueAction.created_at.desc())).all()
    approvals = db.scalars(select(m.Approval).where(m.Approval.issue_id == issue_id)).all()
    refs = db.scalars(select(m.IssueEvidence).where(m.IssueEvidence.issue_id == issue_id)).all()
    gaps = db.scalars(select(m.Gap).join(m.IssueGap, m.IssueGap.gap_id == m.Gap.id).where(m.IssueGap.issue_id == issue_id)).all()
    audit(db, actor, issue_id, 'issue_viewed', row.project_id)
    return ok({'issue': pack_issues(db, [row])[0], 'actions': [record(x) for x in actions],
               'approvals': [record(x) for x in approvals], 'version_ids': [r.version_id for r in refs], 'gaps': [record(g) for g in gaps]})


def valid_versions(db, actor, row, ids):
    require(ids, 'EVIDENCE_REQUIRED', '关闭整改前需要目录版本证据', 422)
    for version_id in ids:
        v = db.get(m.EvidenceVersion, version_id); require(v, 'NOT_FOUND', '资料版本不存在', 404)
        e = evidence_access(db, actor, v.evidence_id)
        require(e.project_id == row.project_id and e.org_id == row.org_id and e.current_version_id == v.id,
                'EVIDENCE_INVALID', '证据范围或版本已经失效', 409)
        require(v.content['acquisition'] == 'located', 'OFFLINE_VERIFICATION_REQUIRED', '整改证据需已定位；受限资料先完成独立离线核查', 422)


@router.post('/issues/{issue_id}/{action}')
def issue_action(issue_id: str, action: str, body: s.IssueActionInput, request: Request, actor: Actor, db: DB):
    row = issue_access(db, actor, issue_id); lock_project(db, row.project_id); db.refresh(row)
    require(action in ('actions', 'submit-verification', 'verifications', 'return', 'reopen', 'risk', 'resume'), 'NOT_FOUND', '操作不存在', 404)
    if action in ('actions', 'submit-verification', 'risk'):
        require(row.owner_id == actor.id, 'OWNER_REQUIRED', '仅整改Owner可执行')
    elif action in ('verifications', 'return'):
        require(row.verifier_id == actor.id, 'VERIFIER_REQUIRED', '仅独立验证人可操作')
        historical_actors = list(db.scalars(select(m.IssueAction.actor_id).where(m.IssueAction.issue_id == row.id, m.IssueAction.action.in_(['actions', 'submit-verification']))))
        distinct(db, actor, [row.owner_id, row.submitted_by] + historical_actors)
    else:
        mem = membership(db, actor, row.project_id)
        require(row.verifier_id == actor.id or 'cfo' in mem.roles, 'ROLE_FORBIDDEN', '需要验证人或CFO权限')
    def run():
        check_version(row, body.expected_version)
        if action == 'actions':
            require(row.state in ('in_progress', 'risk'), 'INVALID_STATE', '当前状态不可新增行动', 409)
        elif action == 'submit-verification':
            require(row.state == 'in_progress', 'INVALID_STATE', '请先恢复整改中状态', 409)
            valid_versions(db, actor, row, body.evidence_version_ids)
            for version_id in body.evidence_version_ids:
                if not db.scalar(select(m.IssueEvidence).where(m.IssueEvidence.issue_id == row.id, m.IssueEvidence.version_id == version_id)):
                    db.add(m.IssueEvidence(issue_id=row.id, version_id=version_id))
            row.state, row.submitted_by = 'pending_verification', actor.id
        elif action in ('verifications', 'return'):
            require(row.state == 'pending_verification', 'INVALID_STATE', '当前事项尚未提交验证', 409)
            if action == 'verifications':
                # Explicit current evidence selection preserves older submissions without allowing stale closure.
                valid_versions(db, actor, row, body.evidence_version_ids)
                refs = set(db.scalars(select(m.IssueEvidence.version_id).where(m.IssueEvidence.issue_id == row.id)))
                require(set(body.evidence_version_ids) <= refs, 'UNSUBMITTED_EVIDENCE', '请仅验证Owner已提交的证据', 422)
            row.state = 'closed' if action == 'verifications' else 'in_progress'; row.reassessment_required = False
        elif action == 'reopen':
            require(row.state == 'closed', 'INVALID_STATE', '仅已关闭事项可重开', 409)
            row.state = 'in_progress'; row.reassessment_required = False
        elif action == 'risk':
            require(row.state == 'in_progress', 'INVALID_STATE', '仅整改中事项可转风险待决策', 409); row.state = 'risk'
        elif action == 'resume':
            require(row.state == 'risk', 'INVALID_STATE', '仅风险待决策事项可恢复', 409); row.state = 'in_progress'
        db.add(m.IssueAction(issue_id=row.id, actor_id=actor.id, action=action, reason=body.reason))
        bump(row); audit(db, actor, row.id, f'issue_{action}', row.project_id)
        return record(row)
    return ok(command(db, actor, request, body.model_dump(), run))


@router.post('/issues/{issue_id}/extension-requests')
def extension(issue_id: str, body: s.Extension, request: Request, actor: Actor, db: DB):
    row = issue_access(db, actor, issue_id); lock_project(db, row.project_id); db.refresh(row)
    require(row.owner_id == actor.id, 'OWNER_REQUIRED', '仅Owner可申请延期')
    def run():
        check_version(row, body.expected_version)
        require(row.state != 'closed' and body.new_due > row.current_due, 'INVALID_DATE', '新截止日必须晚于当前批准截止日', 422)
        approval = m.Approval(project_id=row.project_id, kind='extension', issue_id=row.id, author_id=actor.id,
            reason=body.reason, payload={'new_due': body.new_due.isoformat(), 'expected_version': row.row_version})
        db.add(approval); db.flush(); audit(db, actor, row.id, 'extension_requested', row.project_id)
        return record(approval)
    return ok(command(db, actor, request, body.model_dump(mode='json'), run))


# Prefer the concrete extension endpoint to the action endpoint.
router.routes.sort(key=lambda route: '{action}' in route.path)
