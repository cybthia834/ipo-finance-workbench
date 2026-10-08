from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select, case, exists, or_, and_

from . import models as m
from .common import record, require
from .security import membership, scoped_org


def today():
    return datetime.now(ZoneInfo('Asia/Shanghai')).date()


def generation_context(db, actor, project_id, payload):
    mem = membership(db, actor, project_id, ['cfo', 'pmo'])
    project = db.get(m.Project, project_id)
    require(project.scope_version == payload['scope_version'], 'SCOPE_CHANGED', '项目范围已变化，请重新预检', 409)
    version = db.get(m.TemplateVersion, payload['template_version_id'])
    require(version and version.project_id == project_id and version.state == 'published',
            'TEMPLATE_UNPUBLISHED', '请先独立审核并发布模板', 409)
    orgs = db.scalars(select(m.Organization).where(m.Organization.project_id == project_id,
                      m.Organization.current.is_(True), m.Organization.id.in_(set(mem.org_ids) & set(payload.get('org_ids', mem.org_ids))))).all()
    periods = db.scalars(select(m.Period).where(m.Period.project_id == project_id, m.Period.current.is_(True))).all()
    templates = db.scalars(select(m.TemplateItem).where(m.TemplateItem.version_id == version.id)).all()
    return project, orgs, periods, templates


def generation_preview(db, actor, project_id, payload):
    project, orgs, periods, templates = generation_context(db, actor, project_id, payload)
    current = {(x.topic_code, x.org_id, x.period_id): x for x in db.scalars(select(m.Checklist).where(m.Checklist.project_id == project_id))}
    combinations = [(t, o, p) for t in templates for o in orgs for p in periods]
    existing = sum((t.code, o.id, p.id) in current for t, o, p in combinations)
    return {'total': len(combinations), 'new': len(combinations) - existing, 'existing': existing,
            'pending': len(combinations) - existing, 'exchange_pending': project.exchange == 'unknown'}


def generate(db, actor, project_id, payload):
    project, orgs, periods, templates = generation_context(db, actor, project_id, payload)
    result = generation_preview(db, actor, project_id, payload)
    existing = {(x.topic_code, x.org_id, x.period_id) for x in db.scalars(select(m.Checklist).where(m.Checklist.project_id == project_id))}
    for t in templates:
        for o in orgs:
            for p in periods:
                if (t.code, o.id, p.id) not in existing:
                    db.add(m.Checklist(project_id=project_id, org_id=o.id, period_id=p.id,
                                       template_item_id=t.id, topic_code=t.code))
    db.flush()
    return result


def pack_items(db, rows):
    if not rows:
        return []
    templates = {x.id: x for x in db.scalars(select(m.TemplateItem).where(m.TemplateItem.id.in_({r.template_item_id for r in rows})))}
    orgs = {x.id: x.name for x in db.scalars(select(m.Organization).where(m.Organization.id.in_({r.org_id for r in rows})))}
    periods = {x.id: x.label for x in db.scalars(select(m.Period).where(m.Period.id.in_({r.period_id for r in rows})))}
    users = {x.id: x for x in db.scalars(select(m.User))}
    people = {key: user.display_name for key, user in users.items()}
    grants = {(x.project_id, x.user_id): x for x in db.scalars(select(m.Membership).where(
        m.Membership.project_id.in_({r.project_id for r in rows}), m.Membership.active.is_(True)))}
    def valid_assignee(row, user_id, roles):
        user, grant = users.get(user_id), grants.get((row.project_id, user_id))
        return bool(user and user.active and grant and row.org_id in grant.org_ids and set(grant.roles) & set(roles))
    links = db.execute(select(m.EvidenceLink.item_id, m.Policy.state, m.Policy.expires_at, m.EvidenceVersion.content).join(
        m.Evidence, m.Evidence.id == m.EvidenceLink.evidence_id).join(m.Policy, m.Policy.id == m.Evidence.policy_id).where(
        m.EvidenceLink.item_id.in_([r.id for r in rows])).join(m.EvidenceVersion, m.EvidenceVersion.id == m.Evidence.current_version_id)).all()
    invalid = {r.item_id for r in links if r.state != 'active' or r.expires_at <= m.now()}
    restricted = {r.item_id for r in links if r.content['acquisition'] == 'restricted'}
    output = []
    for row in rows:
        t = templates[row.template_item_id]
        state = 'needs_review' if row.id in invalid and row.state in ('accepted', 'restricted_verified', 'submitted', 'reviewing') else row.state
        if row.id in restricted and state in ('collecting', 'submitted', 'reviewing'): state = 'restricted_pending'
        assignment_valid = bool(row.due and valid_assignee(row, row.owner_id, ['owner', 'pmo', 'cfo']) and
                                valid_assignee(row, row.reviewer_id, ['reviewer', 'cfo']) and row.owner_id != row.reviewer_id)
        output.append({**record(row), 'state': state, 'workflow_state': row.state, 'assignment_valid': assignment_valid,
                       'title': t.title, 'domain': t.domain,
                       'standard': t.standard, 'checks': t.checks, 'org_name': orgs[row.org_id],
                       'period_label': periods[row.period_id], 'owner_name': people.get(row.owner_id),
                       'reviewer_name': people.get(row.reviewer_id), 'overdue': bool(row.due and row.due < today() and state not in ('accepted', 'restricted_verified'))})
    return output


def pack_issues(db, rows):
    people = {x.id: x.display_name for x in db.scalars(select(m.User))}
    return [{**record(r), 'owner_name': people.get(r.owner_id), 'verifier_name': people.get(r.verifier_id),
             'overdue': r.current_due < today() and r.state != 'closed'} for r in rows]


def effective_item_state():
    """Same derived state as pack_items, evaluated in SQL before LIMIT/COUNT."""
    linked = select(m.EvidenceLink.id).join(m.Evidence, m.Evidence.id == m.EvidenceLink.evidence_id).join(
        m.Policy, m.Policy.id == m.Evidence.policy_id).join(
        m.EvidenceVersion, m.EvidenceVersion.id == m.Evidence.current_version_id).where(m.EvidenceLink.item_id == m.Checklist.id)
    invalid = exists(linked.where(or_(m.Policy.state != 'active', m.Policy.expires_at <= m.now())))
    restricted = exists(linked.where(m.EvidenceVersion.content['acquisition'].astext == 'restricted'))
    return case((and_(invalid, m.Checklist.state.in_(['accepted', 'restricted_verified', 'submitted', 'reviewing'])), 'needs_review'),
                (and_(restricted, m.Checklist.state.in_(['collecting', 'submitted', 'reviewing'])), 'restricted_pending'),
                else_=m.Checklist.state)
