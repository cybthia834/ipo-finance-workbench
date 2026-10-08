from fastapi import APIRouter, Request
from sqlalchemy import func, select

from .. import models as m, schemas as s
from ..common import DB, audit, command, digest, lock_project, ok, record, require, user_info
from ..config import settings
from ..security import Actor, distinct, membership, scoped_org

router = APIRouter()


def scope_create(db, project, body, actor):
    require(len({o.code for o in body.organizations}) == len(body.organizations), 'DUPLICATE_ORG', '主体代码不能重复', 422)
    require(all(p.start <= p.end for p in body.periods), 'INVALID_PERIOD', '报告期间起止日期无效', 422)
    orgs, periods = [], []
    for obj in body.organizations:
        row = db.scalar(select(m.Organization).where(m.Organization.project_id == project.id, m.Organization.code == obj.code))
        if not row:
            row = m.Organization(project_id=project.id, **obj.model_dump()); db.add(row); db.flush()
        else:
            row.name = obj.name
        orgs.append(row)
    for obj in body.periods:
        row = db.scalar(select(m.Period).where(m.Period.project_id == project.id, m.Period.start == obj.start, m.Period.end == obj.end))
        if not row:
            row = m.Period(project_id=project.id, **obj.model_dump()); db.add(row); db.flush()
        else:
            row.label = obj.label
        periods.append(row)
    for row in db.scalars(select(m.Organization).where(m.Organization.project_id == project.id)):
        row.current = row.id in [o.id for o in orgs]
    for row in db.scalars(select(m.Period).where(m.Period.project_id == project.id)):
        row.current = row.id in [p.id for p in periods]
    for row in db.scalars(select(m.Checklist).where(m.Checklist.project_id == project.id)):
        row.current = row.org_id in [o.id for o in orgs] and row.period_id in [p.id for p in periods]
    db.add(m.ScopeVersion(project_id=project.id, version=project.scope_version, author_id=actor.id,
                           content={'organizations': [record(o) for o in orgs], 'periods': [record(p) for p in periods], 'exchange': body.exchange}))
    return orgs


@router.post('/projects')
def create_project(body: s.ProjectBootstrap, request: Request, actor: Actor, db: DB):
    require(actor.identity_admin or db.scalar(select(m.Membership.id).where(m.Membership.user_id == actor.id,
                m.Membership.active.is_(True), m.Membership.roles.contains(['cfo']))), 'ROLE_FORBIDDEN', '需要项目创建权限')
    principal = db.get(m.User, body.initial_cfo_id)
    require(principal and principal.active, 'INVALID_ASSIGNEE', '请明确项目财务负责人账号', 422)
    require(actor.identity_admin or principal.id == actor.id, 'ROLE_FORBIDDEN', '仅身份管理员可初始化其他财务负责人')
    def run():
        project = m.Project(name=body.name, exchange=body.exchange, demo=settings.demo_mode)
        db.add(project); db.flush()
        orgs = scope_create(db, project, body, actor)
        db.add(m.Membership(project_id=project.id, user_id=principal.id, roles=['cfo', 'pmo'], org_ids=[o.id for o in orgs]))
        audit(db, actor, project.id, 'project_created', project.id)
        return record(project)
    return ok(command(db, actor, request, body.model_dump(mode='json'), run))


@router.get('/projects/{project_id}/context')
def project_context(project_id: str, actor: Actor, db: DB):
    mem = membership(db, actor, project_id)
    project = db.get(m.Project, project_id)
    orgs = db.scalars(select(m.Organization).where(m.Organization.id.in_(mem.org_ids))).all()
    periods = db.scalars(select(m.Period).where(m.Period.project_id == project_id)).all()
    members = db.scalars(select(m.Membership).where(m.Membership.project_id == project_id, m.Membership.active.is_(True),
                                                   m.Membership.org_ids.overlap(mem.org_ids))).all()
    users = []
    for member in members:
        user = db.get(m.User, member.user_id)
        users.append({'id': user.id, 'display_name': user.display_name, 'active': user.active,
                      'roles': member.roles, 'org_ids': list(set(member.org_ids) & set(mem.org_ids))})
    templates = db.scalars(select(m.TemplateVersion).where(m.TemplateVersion.project_id == project_id).order_by(m.TemplateVersion.number.desc())).all()
    policies = db.scalars(select(m.Policy).where(m.Policy.project_id == project_id, m.Policy.org_id.in_(mem.org_ids))).all()
    audit(db, actor, project_id, 'project_viewed', project_id)
    return ok({'project': record(project), 'organizations': [record(o) for o in orgs],
               'periods': [record(p) for p in periods], 'users': users, 'roles': mem.roles,
               'templates': [record(v) for v in templates], 'policies': [record(p) for p in policies]})


@router.post('/projects/{project_id}/scope-versions')
def update_scope(project_id: str, body: s.ProjectCreate, request: Request, actor: Actor, db: DB):
    lock_project(db, project_id); mem = membership(db, actor, project_id, ['cfo'])
    def run():
        p = db.get(m.Project, project_id); p.scope_version += 1; p.exchange = body.exchange; p.name = body.name
        orgs = scope_create(db, p, body, actor)
        mem.org_ids = list(set(mem.org_ids) | {o.id for o in orgs}); p.permission_revision += 1
        audit(db, actor, p.id, 'scope_changed', p.id)
        return record(p)
    return ok(command(db, actor, request, body.model_dump(mode='json'), run))


@router.post('/projects/{project_id}/memberships')
def set_membership(project_id: str, body: s.MemberInput, request: Request, actor: Actor, db: DB):
    lock_project(db, project_id); mem = membership(db, actor, project_id, ['cfo', 'pmo'])
    require(set(body.org_ids) <= set(mem.org_ids), 'SCOPE_FORBIDDEN', '不能授予自身范围外的权限')
    require('cfo' in mem.roles or set(body.roles) <= {'owner', 'reviewer'}, 'ROLE_FORBIDDEN', 'PMO仅能授予经办与复核角色')
    require(db.get(m.User, body.user_id), 'NOT_FOUND', '账号不存在', 404)
    def run():
        row = db.scalar(select(m.Membership).where(m.Membership.project_id == project_id, m.Membership.user_id == body.user_id))
        if row:
            require('cfo' in mem.roles or not set(row.roles) & {'cfo', 'pmo'},
                    'ROLE_FORBIDDEN', 'PMO不能修改管理人员的授权')
            require(row.user_id != actor.id or 'cfo' not in row.roles or 'cfo' in body.roles,
                    'SELF_DEMOTION', '不能移除自己的CFO权限')
        if not row:
            row = m.Membership(project_id=project_id, user_id=body.user_id); db.add(row)
        row.roles, row.org_ids, row.active = body.roles, body.org_ids, True
        db.get(m.Project, project_id).permission_revision += 1
        audit(db, actor, body.user_id, 'membership_changed', project_id)
        return record(row)
    return ok(command(db, actor, request, body.model_dump(), run))


@router.get('/projects/{project_id}/member-candidates')
def member_candidates(project_id: str, actor: Actor, db: DB):
    membership(db, actor, project_id, ['cfo', 'pmo'])
    return ok([{'id': u.id, 'display_name': u.display_name} for u in
               db.scalars(select(m.User).where(m.User.active.is_(True)).order_by(m.User.display_name))])


@router.post('/memberships/{member_id}/revoke')
def revoke_membership(member_id: str, body: s.Reason, actor: Actor, db: DB):
    row = db.get(m.Membership, member_id); require(row, 'NOT_FOUND', '记录不存在', 404)
    lock_project(db, row.project_id); membership(db, actor, row.project_id, ['cfo'])
    require(row.user_id != actor.id, 'SELF_REVOKE', '不能撤销自己的项目权限')
    row.active = False; db.get(m.Project, row.project_id).permission_revision += 1
    audit(db, actor, member_id, 'membership_revoked', row.project_id)
    return ok({'revoked': True})


@router.get('/template-versions/{version_id}')
def template_detail(version_id: str, actor: Actor, db: DB):
    v = db.get(m.TemplateVersion, version_id); require(v, 'NOT_FOUND', '模板不存在', 404)
    membership(db, actor, v.project_id)
    items = db.scalars(select(m.TemplateItem).where(m.TemplateItem.version_id == v.id).order_by(m.TemplateItem.code)).all()
    previous = db.scalar(select(m.TemplateVersion).where(m.TemplateVersion.project_id == v.project_id,
        m.TemplateVersion.state == 'published', m.TemplateVersion.number < v.number).order_by(m.TemplateVersion.number.desc()).limit(1))
    before = {i.code: i for i in db.scalars(select(m.TemplateItem).where(m.TemplateItem.version_id == previous.id))} if previous else {}
    def content(i):
        return {key: getattr(i, key) for key in ('code', 'title', 'domain', 'source', 'standard', 'checks', 'condition')}
    changes = [{'code': i.code, 'kind': 'added' if i.code not in before else 'changed',
        'before': content(before[i.code]) if i.code in before else None, 'after': content(i)}
        for i in items if i.code not in before or content(i) != content(before[i.code])]
    return ok({'version': record(v), 'items': [{**record(i), 'edit_hash': digest(record(i))} for i in items], 'changes': changes})


@router.post('/templates/{project_id}/versions')
def template_new(project_id: str, request: Request, actor: Actor, db: DB):
    lock_project(db, project_id); membership(db, actor, project_id, ['pmo', 'cfo'])
    def run():
        from ..seed_data import TEMPLATE_ITEMS
        number = (db.scalar(select(func.max(m.TemplateVersion.number)).where(m.TemplateVersion.project_id == project_id)) or 0) + 1
        v = m.TemplateVersion(project_id=project_id, number=number, author_id=actor.id)
        db.add(v); db.flush()
        previous = db.get(m.Project, project_id).template_version_id
        entries = [{k: getattr(i, k) for k in ('code', 'title', 'domain', 'source', 'standard', 'checks', 'condition')}
                   for i in db.scalars(select(m.TemplateItem).where(m.TemplateItem.version_id == previous))] if previous else TEMPLATE_ITEMS
        for item in entries:
            db.add(m.TemplateItem(version_id=v.id, **item))
        audit(db, actor, v.id, 'template_draft_created', project_id)
        return record(v)
    return ok(command(db, actor, request, {}, run))


@router.post('/template-versions/{version_id}/items')
def template_add(version_id: str, body: s.TemplateEntry, request: Request, actor: Actor, db: DB):
    v = db.get(m.TemplateVersion, version_id); require(v, 'NOT_FOUND', '模板不存在', 404)
    lock_project(db, v.project_id); db.refresh(v)
    membership(db, actor, v.project_id, ['pmo', 'cfo'])
    require(v.state == 'draft' and v.author_id == actor.id, 'DRAFT_AUTHOR_REQUIRED', '仅草稿编制人可修改未发布模板')
    def run():
        row = m.TemplateItem(version_id=v.id, **body.model_dump()); db.add(row); db.flush()
        audit(db, actor, row.id, 'template_item_added', v.project_id)
        return record(row)
    return ok(command(db, actor, request, body.model_dump(), run))


@router.patch('/template-items/{item_id}')
def template_edit(item_id: str, body: s.TemplateEdit, request: Request, actor: Actor, db: DB):
    row = db.get(m.TemplateItem, item_id); require(row, 'NOT_FOUND', '模板条目不存在', 404)
    v = db.get(m.TemplateVersion, row.version_id); lock_project(db, v.project_id); db.refresh(row); db.refresh(v)
    membership(db, actor, v.project_id, ['pmo', 'cfo'])
    require(v.state == 'draft' and v.author_id == actor.id, 'DRAFT_AUTHOR_REQUIRED', '仅草稿编制人可修改未发布模板')
    def run():
        require(digest(record(row)) == body.expected_hash, 'VERSION_CONFLICT', '草稿已更新，请刷新后再编辑', 409)
        require(row.code == body.code, 'STABLE_CODE_REQUIRED', '已有主题编号不可改写，请新增条目', 422)
        for key, value in body.model_dump(exclude={'expected_hash'}).items(): setattr(row, key, value)
        audit(db, actor, row.id, 'template_item_updated', v.project_id)
        return record(row)
    return ok(command(db, actor, request, body.model_dump(), run))


@router.post('/template-versions/{version_id}/publish')
def template_publish(version_id: str, body: s.Reason, request: Request, actor: Actor, db: DB):
    v = db.get(m.TemplateVersion, version_id); require(v, 'NOT_FOUND', '模板不存在', 404)
    lock_project(db, v.project_id); db.refresh(v)
    membership(db, actor, v.project_id, ['cfo', 'reviewer']); distinct(db, actor, [v.author_id])
    def run():
        require(v.state == 'draft', 'INVALID_STATE', '模板不是待发布草稿', 409)
        items = db.scalars(select(m.TemplateItem).where(m.TemplateItem.version_id == v.id)).all()
        require(items and all(i.standard and i.checks for i in items), 'MISSING_STANDARD', '请补充可执行验收标准', 422)
        v.state, v.publisher_id = 'published', actor.id
        db.get(m.Project, v.project_id).template_version_id = v.id
        audit(db, actor, v.id, 'template_published', v.project_id)
        return record(v)
    return ok(command(db, actor, request, body.model_dump(), run))


@router.post('/projects/{project_id}/admission-policies')
def policy_create(project_id: str, body: s.PolicyInput, request: Request, actor: Actor, db: DB):
    lock_project(db, project_id); mem = membership(db, actor, project_id, ['cfo', 'pmo']); scoped_org(mem, body.org_id)
    require(body.expires_at.tzinfo and body.expires_at > m.now(), 'INVALID_EXPIRY', '准入有效期须为未来日期', 422)
    def run():
        row = m.Policy(project_id=project_id, author_id=actor.id, **body.model_dump())
        db.add(row); db.flush(); audit(db, actor, row.id, 'admission_registered', project_id)
        return record(row)
    return ok(command(db, actor, request, body.model_dump(mode='json'), run))


@router.post('/admission-policies/{policy_id}/{action}')
def policy_action(policy_id: str, action: str, body: s.Reason, request: Request, actor: Actor, db: DB):
    row = db.get(m.Policy, policy_id); require(row, 'NOT_FOUND', '记录不存在', 404)
    lock_project(db, row.project_id); db.refresh(row)
    mem = membership(db, actor, row.project_id, ['cfo', 'reviewer']); scoped_org(mem, row.org_id)
    require(action in ('verify', 'revoke'), 'NOT_FOUND', '操作不存在', 404)
    if action == 'verify': distinct(db, actor, [row.author_id])
    def run():
        require(action == 'revoke' or row.state == 'pending', 'INVALID_STATE', '当前状态不允许核验', 409)
        row.state = 'active' if action == 'verify' else 'revoked'; row.verifier_id = actor.id
        db.get(m.Project, row.project_id).permission_revision += 1
        audit(db, actor, row.id, f'admission_{action}', row.project_id)
        return record(row)
    return ok(command(db, actor, request, body.model_dump(), run))
