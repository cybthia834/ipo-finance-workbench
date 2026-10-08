from fastapi import APIRouter, Query, Request
from sqlalchemy import func, select

from .. import models as m, schemas as s
from ..common import DB, DomainError, audit, bump, check_version, command, digest, lock_project, ok, record, require
from ..security import Actor, assigned, distinct, evidence_access, evidence_query, item_access, item_query, membership, scoped_org
from ..services import generation_preview, pack_items, effective_item_state, today

router = APIRouter()


@router.post('/projects/{project_id}/checklist-previews')
def preview(project_id: str, body: s.Generation, actor: Actor, db: DB):
    return ok(generation_preview(db, actor, project_id, body.model_dump()))


@router.post('/projects/{project_id}/checklist-jobs', status_code=202)
def generation_job(project_id: str, body: s.Generation, request: Request, actor: Actor, db: DB):
    lock_project(db, project_id); member = membership(db, actor, project_id, ['cfo', 'pmo'])
    payload = body.model_dump(); generation_preview(db, actor, project_id, payload)
    def run():
        job = m.Job(project_id=project_id, actor_id=actor.id, kind='generate', payload={**payload, 'org_ids': sorted(member.org_ids)})
        db.add(job); db.flush(); audit(db, actor, job.id, 'checklist_job_created', project_id)
        return record(job)
    return ok(command(db, actor, request, payload, run))


@router.get('/jobs/{job_id}')
def get_job(job_id: str, actor: Actor, db: DB):
    job = db.get(m.Job, job_id); require(job, 'NOT_FOUND', '任务不存在', 404)
    mem = membership(db, actor, job.project_id, ['cfo', 'pmo'])
    require(job.actor_id == actor.id, 'JOB_FORBIDDEN', '只能查看本人任务')
    require(set(job.payload.get('org_ids', [])) <= set(mem.org_ids), 'JOB_SCOPE_REVOKED', '任务范围授权已撤销')
    return ok(record(job, ('attempt_token',)))


@router.get('/projects/{project_id}/checklists')
def list_items(project_id: str, actor: Actor, db: DB, q: str = '', org_id: str | None = None,
               period_id: str | None = None, applicability: str | None = None, state: str | None = None,
               domain: str | None = None, mine: bool = False, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)):
    query = item_query(db, actor, project_id).where(m.Checklist.current.is_(True))
    if org_id: query = query.where(m.Checklist.org_id == org_id)
    if period_id: query = query.where(m.Checklist.period_id == period_id)
    if applicability: query = query.where(m.Checklist.applicability == applicability)
    if mine: query = query.where((m.Checklist.owner_id == actor.id) | (m.Checklist.reviewer_id == actor.id))
    query = query.join(m.TemplateItem, m.TemplateItem.id == m.Checklist.template_item_id)
    if domain: query = query.where(m.TemplateItem.domain == domain)
    if q: query = query.where(m.TemplateItem.title.contains(q, autoescape=True) | m.Checklist.topic_code.contains(q, autoescape=True))
    effective = effective_item_state()
    if state == 'overdue': query = query.where(m.Checklist.due < today(), effective.not_in(['accepted', 'restricted_verified']))
    elif state == 'restricted': query = query.where(effective.in_(['restricted_pending', 'restricted_verified']))
    elif state: query = query.where(effective == state)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    packed = pack_items(db, db.scalars(query.order_by(m.Checklist.due.asc().nulls_last(), m.Checklist.topic_code, m.Checklist.id)
                        .offset((page - 1) * page_size).limit(page_size)).all())
    audit(db, actor, project_id, 'checklist_searched', project_id)
    return ok({'items': packed, 'total': total, 'page': page, 'page_size': page_size})


@router.get('/checklists/{item_id}')
def item_detail(item_id: str, actor: Actor, db: DB):
    row = item_access(db, actor, item_id)
    evidence = db.scalars(evidence_query(db, actor, row.project_id).join(m.EvidenceLink, m.EvidenceLink.evidence_id == m.Evidence.id).where(m.EvidenceLink.item_id == item_id)).all()
    evidence_rows = [{**record(e), 'version': record(db.get(m.EvidenceVersion, e.current_version_id))} for e in evidence]
    reviews = db.scalars(select(m.Review).where(m.Review.item_id == item_id).order_by(m.Review.created_at.desc())).all()
    submissions = db.scalars(select(m.Submission).where(m.Submission.item_id == item_id).order_by(m.Submission.created_at.desc())).all()
    gaps = db.scalars(select(m.Gap).where(m.Gap.item_id == item_id)).all()
    approvals = db.scalars(select(m.Approval).where(m.Approval.item_id == item_id)).all()
    audit(db, actor, item_id, 'checklist_viewed', row.project_id)
    latest_id = db.get(m.Project, row.project_id).template_version_id
    latest = db.scalar(select(m.TemplateItem).where(m.TemplateItem.version_id == latest_id, m.TemplateItem.code == row.topic_code))
    decisions = db.scalars(select(m.TemplateDecision).where(m.TemplateDecision.item_id == row.id).order_by(m.TemplateDecision.created_at.desc())).all()
    return ok({'template_upgrade': record(latest) if latest and latest.id != row.template_item_id else None,
               'template_decisions': [record(d) for d in decisions], 'item': pack_items(db, [row])[0], 'evidence': evidence_rows, 'reviews': [record(x) for x in reviews],
               'submissions': [{**record(x), 'version_ids': list(db.scalars(select(m.SubmissionRef.version_id).where(m.SubmissionRef.submission_id == x.id)))} for x in submissions],
               'gaps': [record(x) for x in gaps], 'approvals': [record(x) for x in approvals]})


@router.post('/checklists/assignments')
def assignments(body: s.AssignBatch, request: Request, actor: Actor, db: DB):
    # Sorted project locks avoid cross-project batch deadlocks.
    rows = db.scalars(select(m.Checklist).where(m.Checklist.id.in_([r.item_id for r in body.rows]))).all()
    for project_id in sorted({r.project_id for r in rows}):
        lock_project(db, project_id)
    def run():
        results = []
        for value in body.rows:
            try:
                with db.begin_nested():
                    row = item_access(db, actor, value.item_id); db.refresh(row); check_version(row, value.expected_version)
                    membership(db, actor, row.project_id, ['cfo', 'pmo'])
                    owner = assigned(db, row.project_id, row.org_id, value.owner_id, ['owner', 'pmo', 'cfo'])
                    assigned(db, row.project_id, row.org_id, value.reviewer_id, ['reviewer', 'cfo'])
                    distinct(db, owner, [value.reviewer_id])
                    row.owner_id, row.reviewer_id, row.due = value.owner_id, value.reviewer_id, value.due
                    bump(row); audit(db, actor, row.id, 'checklist_assigned', row.project_id)
                    results.append({'id': row.id, 'success': True, 'row_version': row.row_version})
            except DomainError as exc:
                results.append({'id': value.item_id, 'success': False, 'code': exc.code, 'message': exc.message})
        return {'results': results}
    result = command(db, actor, request, body.model_dump(mode='json'), run)
    # A cached successful batch must not reveal rows after authorization revocation.
    for entry in result['results']:
        if entry['success']:
            try:
                row = item_access(db, actor, entry['id'])
                membership(db, actor, row.project_id, ['cfo', 'pmo'])
            except DomainError as exc:
                entry.clear(); entry.update(success=False, code=exc.code, message=exc.message)
    return ok(result)


@router.post('/checklists/{item_id}/applicability-proposals')
def applicability(item_id: str, body: s.Applicability, request: Request, actor: Actor, db: DB):
    row = item_access(db, actor, item_id); lock_project(db, row.project_id); db.refresh(row)
    def run():
        check_version(row, body.expected_version)
        if body.value == 'not_applicable':
            open_issues = db.scalar(select(func.count()).select_from(m.Issue).join(m.IssueGap).join(m.Gap).where(m.Gap.item_id == row.id, m.Issue.state != 'closed'))
            require(not open_issues, 'OPEN_ISSUES', '请先处理关联的未决整改', 409)
            approval = m.Approval(project_id=row.project_id, kind='applicability', item_id=row.id,
                author_id=actor.id, reason=body.reason, payload={'expected_version': row.row_version})
            db.add(approval); db.flush(); result = {'approval': record(approval)}
        else:
            membership(db, actor, row.project_id, ['cfo', 'pmo', 'reviewer'])
            row.applicability = body.value
            if row.state == 'not_started' and body.value == 'applicable': row.state = 'collecting'
            bump(row); result = record(row)
        audit(db, actor, row.id, 'applicability_proposed', row.project_id)
        return result
    return ok(command(db, actor, request, body.model_dump(), run))


def metadata_validate(policy, metadata):
    require(policy and policy.state == 'active' and policy.expires_at > m.now(), 'ADMISSION_INVALID', '目录准入依据不可用')
    content = metadata.model_dump(mode='json', exclude_none=True)
    require(set(content) <= set(policy.allowed_fields), 'FIELD_NOT_APPROVED', '部分目录字段尚未获准登记', 422)
    require(content['acquisition'] not in ('unavailable', 'nonexistent') or len(content.get('note', '')) >= 3,
            'REASON_REQUIRED', '无法取得或经核实不存在需说明原因', 422)
    return content


@router.post('/projects/{project_id}/evidence')
def create_evidence(project_id: str, body: s.EvidenceCreate, request: Request, actor: Actor, db: DB):
    lock_project(db, project_id); mem = membership(db, actor, project_id, ['owner', 'pmo', 'cfo']); scoped_org(mem, body.org_id)
    policy = db.get(m.Policy, body.policy_id)
    require(policy and policy.project_id == project_id and policy.org_id == body.org_id, 'ADMISSION_SCOPE', '准入范围与资料主体不符')
    period = db.get(m.Period, body.period_id)
    require(period and period.project_id == project_id, 'PERIOD_MISMATCH', '报告期间不属于本项目', 422)
    content = metadata_validate(policy, body.metadata)
    def run():
        e = m.Evidence(project_id=project_id, org_id=body.org_id, period_id=body.period_id,
                       policy_id=body.policy_id, owner_id=actor.id, code=body.code)
        db.add(e); db.flush()
        v = m.EvidenceVersion(evidence_id=e.id, number=1, content=content, metadata_hash=digest(content), reason=body.reason, submitted_by=actor.id)
        db.add(v); db.flush(); e.current_version_id = v.id
        audit(db, actor, e.id, 'evidence_registered', project_id, after=v.metadata_hash)
        return record(e)
    return ok(command(db, actor, request, body.model_dump(mode='json'), run))


@router.get('/projects/{project_id}/evidence')
def list_evidence(project_id: str, actor: Actor, db: DB, q: str = '', org_id: str | None = None,
                  period_id: str | None = None, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)):
    query = evidence_query(db, actor, project_id)
    if q: query = query.where(m.Evidence.code.contains(q, autoescape=True))
    if org_id: query = query.where(m.Evidence.org_id == org_id)
    if period_id: query = query.where(m.Evidence.period_id == period_id)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(query.order_by(m.Evidence.created_at.desc(), m.Evidence.id).offset((page - 1) * page_size).limit(page_size)).all()
    versions = {v.id: record(v) for v in db.scalars(select(m.EvidenceVersion).where(m.EvidenceVersion.id.in_([e.current_version_id for e in rows])))}
    audit(db, actor, project_id, 'evidence_searched', project_id)
    return ok({'items': [{**record(e), 'version': versions[e.current_version_id]} for e in rows],
               'total': total, 'page': page, 'page_size': page_size})


@router.get('/evidence/{evidence_id}')
def evidence_detail(evidence_id: str, actor: Actor, db: DB):
    e = evidence_access(db, actor, evidence_id)
    versions = db.scalars(select(m.EvidenceVersion).where(m.EvidenceVersion.evidence_id == e.id).order_by(m.EvidenceVersion.number.desc())).all()
    audit(db, actor, e.id, 'evidence_viewed', e.project_id)
    return ok({'evidence': record(e), 'versions': [record(v) for v in versions]})


@router.post('/evidence/{evidence_id}/versions')
def new_version(evidence_id: str, body: s.EvidenceUpdate, request: Request, actor: Actor, db: DB):
    e = evidence_access(db, actor, evidence_id); lock_project(db, e.project_id); db.refresh(e)
    require(e.owner_id == actor.id, 'OWNER_REQUIRED', '仅资料经办可提交新版本')
    content = metadata_validate(db.get(m.Policy, e.policy_id), body.metadata)
    def run():
        check_version(e, body.expected_version)
        old = db.get(m.EvidenceVersion, e.current_version_id)
        v = m.EvidenceVersion(evidence_id=e.id, number=old.number + 1, content=content,
                              metadata_hash=digest(content), reason=body.reason, submitted_by=actor.id)
        db.add(v); db.flush(); e.current_version_id = v.id; bump(e)
        links = db.scalars(select(m.EvidenceLink).where(m.EvidenceLink.evidence_id == e.id)).all()
        for link in links:
            item = db.get(m.Checklist, link.item_id)
            if item.state in ('accepted', 'restricted_verified', 'submitted', 'reviewing'): item.state = 'needs_review'
            bump(item)
        for issue in db.scalars(select(m.Issue).join(m.IssueEvidence).where(m.IssueEvidence.version_id == old.id)):
            issue.reassessment_required = True; bump(issue)
        audit(db, actor, e.id, 'evidence_version_created', e.project_id, before=old.metadata_hash, after=v.metadata_hash)
        return record(e)
    return ok(command(db, actor, request, body.model_dump(mode='json'), run))


@router.post('/checklists/{item_id}/evidence-links')
def link_evidence(item_id: str, body: s.EvidenceLinkInput, request: Request, actor: Actor, db: DB):
    row = item_access(db, actor, item_id); lock_project(db, row.project_id); db.refresh(row)
    e = evidence_access(db, actor, body.evidence_id)
    require(row.owner_id == actor.id, 'OWNER_REQUIRED', '仅经办可关联目录')
    require(e.project_id == row.project_id and e.org_id == row.org_id and e.period_id == row.period_id,
            'EVIDENCE_SCOPE_MISMATCH', '目录主体或期间与资料需求不同，请拆分实例', 422)
    def run():
        check_version(row, body.expected_version)
        exists = db.scalar(select(m.EvidenceLink).where(m.EvidenceLink.item_id == row.id, m.EvidenceLink.evidence_id == e.id))
        if not exists:
            db.add(m.EvidenceLink(item_id=row.id, evidence_id=e.id))
            if row.state in ('accepted', 'restricted_verified', 'submitted', 'reviewing'): row.state = 'needs_review'
            bump(row)
        audit(db, actor, row.id, 'evidence_linked', row.project_id)
        return record(row)
    return ok(command(db, actor, request, body.model_dump(), run))


def linked_versions(db, actor, item):
    links = db.scalars(select(m.EvidenceLink).where(m.EvidenceLink.item_id == item.id)).all()
    require(links, 'EVIDENCE_REQUIRED', '请先关联有效目录', 422)
    return [db.get(m.EvidenceVersion, evidence_access(db, actor, link.evidence_id).current_version_id) for link in links]


@router.post('/checklists/{item_id}/submissions')
def submit(item_id: str, body: s.Versioned, request: Request, actor: Actor, db: DB):
    row = item_access(db, actor, item_id); lock_project(db, row.project_id); db.refresh(row)
    require(row.owner_id == actor.id, 'OWNER_REQUIRED', '仅当前经办可提交复核')
    def run():
        check_version(row, body.expected_version)
        require(row.applicability == 'applicable' and row.current and row.due and row.reviewer_id,
                'SUBMISSION_INCOMPLETE', '适用性、责任、截止日尚未齐全', 422)
        assigned(db, row.project_id, row.org_id, row.reviewer_id, ['reviewer', 'cfo'])
        require(row.state not in ('accepted', 'restricted_verified', 'submitted', 'reviewing'), 'INVALID_STATE', '当前状态无需重复提交', 409)
        versions = linked_versions(db, actor, row)
        submission = m.Submission(item_id=row.id, submitted_by=actor.id, template_item_id=row.template_item_id, item_version=row.row_version + 1)
        db.add(submission); db.flush()
        for v in versions: db.add(m.SubmissionRef(submission_id=submission.id, version_id=v.id))
        row.state = 'submitted'; bump(row)
        audit(db, actor, row.id, 'review_submitted', row.project_id)
        return record(row)
    return ok(command(db, actor, request, body.model_dump(), run))


@router.post('/checklists/{item_id}/reviews')
def review(item_id: str, body: s.ReviewInput, request: Request, actor: Actor, db: DB):
    row = item_access(db, actor, item_id); lock_project(db, row.project_id); db.refresh(row)
    require(row.reviewer_id == actor.id, 'REVIEWER_REQUIRED', '需由指定独立复核人操作')
    membership(db, actor, row.project_id, ['reviewer', 'cfo'])
    def run():
        check_version(row, body.expected_version)
        require(row.state in ('submitted', 'reviewing'), 'INVALID_STATE', '请先由经办提交当前版本', 409)
        submission = db.scalar(select(m.Submission).where(m.Submission.item_id == row.id).order_by(m.Submission.created_at.desc()).limit(1))
        refs = set(db.scalars(select(m.SubmissionRef.version_id).where(m.SubmissionRef.submission_id == submission.id)))
        versions = linked_versions(db, actor, row)
        require(refs == {v.id for v in versions} == set(body.evidence_version_ids), 'EVIDENCE_VERSION_CHANGED', '资料版本已变化，请重新提交', 409)
        distinct(db, actor, [submission.submitted_by] + [v.submitted_by for v in versions])
        template = db.get(m.TemplateItem, submission.template_item_id)
        if body.decision != 'return':
            require(set(body.checks) == set(template.checks), 'CHECKS_INCOMPLETE', '请逐项完成全部验收检查', 422)
            require(all(v.content['acquisition'] in ('located', 'restricted') for v in versions),
                    'ACQUISITION_INCOMPLETE', '待取得、无法取得或不存在的目录不能作为接受依据', 422)
        if body.decision == 'accept':
            require(all(v.content['acquisition'] == 'located' for v in versions),
                    'RESTRICTED_REVIEW_REQUIRED', '受限目录需记录独立离线核查结果', 422)
        if body.decision == 'restricted_verified':
            require(any(v.content['acquisition'] == 'restricted' for v in versions), 'RESTRICTED_EVIDENCE_REQUIRED', '受限核查必须包含受限目录', 422)
            require(body.verified_at is None or (body.verified_at.tzinfo and body.verified_at <= m.now()), 'INVALID_VERIFICATION_TIME', '核查时间不可晚于当前时间', 422)
            require(body.verification_method and len(body.verification_method) >= 3, 'METHOD_REQUIRED', '请记录获准的离线核查方式', 422)
        review = m.Review(item_id=row.id, submission_id=submission.id, reviewer_id=actor.id, decision=body.decision,
                          checks=body.checks, reason=body.reason, verification_method=body.verification_method,
                          verified_at=(body.verified_at or m.now()) if body.decision == 'restricted_verified' else None)
        db.add(review); row.state = {'accept': 'accepted', 'return': 'returned', 'restricted_verified': 'restricted_verified'}[body.decision]; bump(row)
        audit(db, actor, row.id, 'review_completed', row.project_id)
        return record(row)
    return ok(command(db, actor, request, body.model_dump(), run))


@router.post('/checklists/{item_id}/template-decisions')
def template_decision(item_id: str, body: s.TemplateUpgrade, request: Request, actor: Actor, db: DB):
    row = item_access(db, actor, item_id)
    membership(db, actor, row.project_id, ['cfo', 'pmo'])
    new = db.get(m.TemplateItem, body.new_template_item_id)
    version = db.get(m.TemplateVersion, new.version_id) if new else None
    require(new and version.project_id == row.project_id and version.state == 'published' and new.code == row.topic_code,
            'TEMPLATE_SCOPE_MISMATCH', '新标准须来自本项目同一主题的已发布模板', 422)
    def run():
        check_version(row, body.expected_version)
        old = db.get(m.TemplateItem, row.template_item_id)
        old_version = db.get(m.TemplateVersion, old.version_id)
        require(version.number > old_version.number, 'TEMPLATE_NOT_NEWER', '只能评估更新版本', 409)
        decision = m.TemplateDecision(item_id=row.id, old_template_item_id=row.template_item_id,
            new_template_item_id=new.id, actor_id=actor.id, decision=body.decision, reason=body.reason)
        db.add(decision)
        if body.decision == 'adopt':
            row.template_item_id = new.id
            if row.state in ('accepted', 'restricted_verified', 'submitted', 'reviewing'):
                row.state = 'needs_review'
        bump(row); audit(db, actor, row.id, 'template_' + body.decision, row.project_id)
        return record(row)
    return ok(command(db, actor, request, body.model_dump(), run))
