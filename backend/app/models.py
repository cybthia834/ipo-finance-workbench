"""Relational roots; JSON is restricted to versioned metadata and frozen records."""
from datetime import date, datetime, timezone
from uuid import uuid4

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def now():
    return datetime.now(timezone.utc)


def uid():
    return str(uuid4())


class Entity:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class User(Entity, Base):
    __tablename__ = 'user_account'
    username: Mapped[str] = mapped_column(String(80), unique=True)
    display_name: Mapped[str] = mapped_column(String(80))
    person_id: Mapped[str] = mapped_column(String(36), unique=True, default=uid)
    password_hash: Mapped[str] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    identity_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    row_version: Mapped[int] = mapped_column(Integer, default=1)


class Session(Entity, Base):
    __tablename__ = 'login_session'
    user_id: Mapped[str] = mapped_column(ForeignKey('user_account.id'), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    csrf_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class Project(Entity, Base):
    __tablename__ = 'project'
    name: Mapped[str] = mapped_column(String(120))
    exchange: Mapped[str] = mapped_column(String(20), default='unknown')
    scope_version: Mapped[int] = mapped_column(Integer, default=1)
    permission_revision: Mapped[int] = mapped_column(Integer, default=1)
    template_version_id: Mapped[str | None] = mapped_column(ForeignKey('template_version.id', use_alter=True))
    demo: Mapped[bool] = mapped_column(Boolean, default=True)


class Organization(Entity, Base):
    __tablename__ = 'organization'
    project_id: Mapped[str] = mapped_column(ForeignKey('project.id'), index=True)
    code: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(100))
    current: Mapped[bool] = mapped_column(Boolean, default=True)
    __table_args__ = (UniqueConstraint('project_id', 'code'),)


class Period(Entity, Base):
    __tablename__ = 'period'
    project_id: Mapped[str] = mapped_column(ForeignKey('project.id'))
    label: Mapped[str] = mapped_column(String(60))
    start: Mapped[date] = mapped_column(Date)
    end: Mapped[date] = mapped_column(Date)
    current: Mapped[bool] = mapped_column(Boolean, default=True)
    __table_args__ = (UniqueConstraint('project_id', 'start', 'end'), CheckConstraint('"start" <= "end"'))


class ScopeVersion(Entity, Base):
    __tablename__ = 'project_scope_version'
    project_id: Mapped[str] = mapped_column(ForeignKey('project.id'))
    version: Mapped[int] = mapped_column(Integer)
    content: Mapped[dict] = mapped_column(JSONB)
    author_id: Mapped[str] = mapped_column(ForeignKey('user_account.id'))
    __table_args__ = (UniqueConstraint('project_id', 'version'),)


class Membership(Entity, Base):
    __tablename__ = 'membership'
    project_id: Mapped[str] = mapped_column(ForeignKey('project.id'))
    user_id: Mapped[str] = mapped_column(ForeignKey('user_account.id'))
    roles: Mapped[list[str]] = mapped_column(ARRAY(String(20)))
    org_ids: Mapped[list[str]] = mapped_column(ARRAY(String(36)))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    __table_args__ = (UniqueConstraint('project_id', 'user_id'),)


class TemplateVersion(Entity, Base):
    __tablename__ = 'template_version'
    project_id: Mapped[str] = mapped_column(ForeignKey('project.id'))
    number: Mapped[int] = mapped_column(Integer)
    author_id: Mapped[str] = mapped_column(ForeignKey('user_account.id'))
    publisher_id: Mapped[str | None] = mapped_column(ForeignKey('user_account.id'))
    state: Mapped[str] = mapped_column(String(20), default='draft')
    __table_args__ = (UniqueConstraint('project_id', 'number'),)


class TemplateItem(Entity, Base):
    __tablename__ = 'template_item_version'
    version_id: Mapped[str] = mapped_column(ForeignKey('template_version.id'))
    code: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(160))
    domain: Mapped[str] = mapped_column(String(20))
    source: Mapped[str] = mapped_column(Text)
    standard: Mapped[str] = mapped_column(Text)
    checks: Mapped[list[str]] = mapped_column(JSONB)
    condition: Mapped[str] = mapped_column(String(40), default='common')
    __table_args__ = (UniqueConstraint('version_id', 'code'),)


class Checklist(Entity, Base):
    __tablename__ = 'checklist_item'
    project_id: Mapped[str] = mapped_column(ForeignKey('project.id'), index=True)
    org_id: Mapped[str] = mapped_column(ForeignKey('organization.id'), index=True)
    period_id: Mapped[str] = mapped_column(ForeignKey('period.id'))
    template_item_id: Mapped[str] = mapped_column(ForeignKey('template_item_version.id'))
    topic_code: Mapped[str] = mapped_column(String(40))
    basis: Mapped[str] = mapped_column(String(40), default='standard')
    applicability: Mapped[str] = mapped_column(String(24), default='pending')
    state: Mapped[str] = mapped_column(String(24), default='not_started', index=True)
    owner_id: Mapped[str | None] = mapped_column(ForeignKey('user_account.id'))
    reviewer_id: Mapped[str | None] = mapped_column(ForeignKey('user_account.id'))
    due: Mapped[date | None] = mapped_column(Date)
    current: Mapped[bool] = mapped_column(Boolean, default=True)
    row_version: Mapped[int] = mapped_column(Integer, default=1)
    __table_args__ = (
        UniqueConstraint('project_id', 'topic_code', 'org_id', 'period_id', 'basis'),
        CheckConstraint('owner_id IS NULL OR reviewer_id IS NULL OR owner_id <> reviewer_id'),
        CheckConstraint("applicability IN ('pending','applicable','not_applicable')"),
    )


class Policy(Entity, Base):
    __tablename__ = 'admission_policy'
    project_id: Mapped[str] = mapped_column(ForeignKey('project.id'), index=True)
    org_id: Mapped[str] = mapped_column(ForeignKey('organization.id'))
    reference: Mapped[str] = mapped_column(String(100))
    allowed_fields: Mapped[list[str]] = mapped_column(ARRAY(String(40)))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    state: Mapped[str] = mapped_column(String(20), default='pending')
    author_id: Mapped[str] = mapped_column(ForeignKey('user_account.id'))
    verifier_id: Mapped[str | None] = mapped_column(ForeignKey('user_account.id'))


class Evidence(Entity, Base):
    __tablename__ = 'evidence'
    project_id: Mapped[str] = mapped_column(ForeignKey('project.id'), index=True)
    org_id: Mapped[str] = mapped_column(ForeignKey('organization.id'))
    period_id: Mapped[str] = mapped_column(ForeignKey('period.id'))
    policy_id: Mapped[str] = mapped_column(ForeignKey('admission_policy.id'))
    owner_id: Mapped[str] = mapped_column(ForeignKey('user_account.id'))
    code: Mapped[str] = mapped_column(String(80))
    mode: Mapped[str] = mapped_column(String(1), default='A')
    current_version_id: Mapped[str | None] = mapped_column(ForeignKey('evidence_version.id', use_alter=True))
    row_version: Mapped[int] = mapped_column(Integer, default=1)
    __table_args__ = (CheckConstraint("mode = 'A'"), UniqueConstraint('project_id', 'code'))


class EvidenceVersion(Entity, Base):
    __tablename__ = 'evidence_version'
    evidence_id: Mapped[str] = mapped_column(ForeignKey('evidence.id'))
    number: Mapped[int] = mapped_column(Integer)
    content: Mapped[dict] = mapped_column(JSONB)
    metadata_hash: Mapped[str] = mapped_column(String(64))
    reason: Mapped[str] = mapped_column(String(300))
    submitted_by: Mapped[str] = mapped_column(ForeignKey('user_account.id'))
    __table_args__ = (UniqueConstraint('evidence_id', 'number'),)


class EvidenceLink(Entity, Base):
    __tablename__ = 'checklist_evidence_link'
    item_id: Mapped[str] = mapped_column(ForeignKey('checklist_item.id'), index=True)
    evidence_id: Mapped[str] = mapped_column(ForeignKey('evidence.id'))
    __table_args__ = (UniqueConstraint('item_id', 'evidence_id'),)


class Submission(Entity, Base):
    __tablename__ = 'checklist_submission'
    item_id: Mapped[str] = mapped_column(ForeignKey('checklist_item.id'), index=True)
    submitted_by: Mapped[str] = mapped_column(ForeignKey('user_account.id'))
    template_item_id: Mapped[str] = mapped_column(ForeignKey('template_item_version.id'))
    item_version: Mapped[int] = mapped_column(Integer)


class SubmissionRef(Entity, Base):
    __tablename__ = 'submission_evidence_ref'
    submission_id: Mapped[str] = mapped_column(ForeignKey('checklist_submission.id'))
    version_id: Mapped[str] = mapped_column(ForeignKey('evidence_version.id'))
    __table_args__ = (UniqueConstraint('submission_id', 'version_id'),)


class Review(Entity, Base):
    __tablename__ = 'review'
    item_id: Mapped[str] = mapped_column(ForeignKey('checklist_item.id'), index=True)
    submission_id: Mapped[str] = mapped_column(ForeignKey('checklist_submission.id'), unique=True)
    reviewer_id: Mapped[str] = mapped_column(ForeignKey('user_account.id'))
    decision: Mapped[str] = mapped_column(String(24))
    checks: Mapped[list[str]] = mapped_column(JSONB)
    reason: Mapped[str] = mapped_column(String(500))
    verification_method: Mapped[str | None] = mapped_column(String(100))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Gap(Entity, Base):
    __tablename__ = 'gap'
    item_id: Mapped[str] = mapped_column(ForeignKey('checklist_item.id'), index=True)
    facts: Mapped[str] = mapped_column(String(500))
    kind: Mapped[str] = mapped_column(String(40))
    author_id: Mapped[str] = mapped_column(ForeignKey('user_account.id'))
    provenance: Mapped[dict] = mapped_column(JSONB, default=dict)


class TemplateDecision(Entity, Base):
    __tablename__ = 'template_upgrade_decision'
    item_id: Mapped[str] = mapped_column(ForeignKey('checklist_item.id'), index=True)
    old_template_item_id: Mapped[str] = mapped_column(ForeignKey('template_item_version.id'))
    new_template_item_id: Mapped[str] = mapped_column(ForeignKey('template_item_version.id'))
    actor_id: Mapped[str] = mapped_column(ForeignKey('user_account.id'))
    decision: Mapped[str] = mapped_column(String(12))
    reason: Mapped[str] = mapped_column(String(500))


class Issue(Entity, Base):
    __tablename__ = 'issue'
    project_id: Mapped[str] = mapped_column(ForeignKey('project.id'), index=True)
    org_id: Mapped[str] = mapped_column(ForeignKey('organization.id'))
    title: Mapped[str] = mapped_column(String(160))
    facts: Mapped[str] = mapped_column(String(500))
    kind: Mapped[str] = mapped_column(String(40))
    severity: Mapped[str] = mapped_column(String(2))
    owner_id: Mapped[str] = mapped_column(ForeignKey('user_account.id'))
    verifier_id: Mapped[str] = mapped_column(ForeignKey('user_account.id'))
    original_due: Mapped[date] = mapped_column(Date)
    current_due: Mapped[date] = mapped_column(Date)
    extension_count: Mapped[int] = mapped_column(Integer, default=0)
    state: Mapped[str] = mapped_column(String(24), default='in_progress', index=True)
    submitted_by: Mapped[str | None] = mapped_column(ForeignKey('user_account.id'))
    reassessment_required: Mapped[bool] = mapped_column(Boolean, default=False)
    row_version: Mapped[int] = mapped_column(Integer, default=1)
    __table_args__ = (CheckConstraint('owner_id <> verifier_id'), CheckConstraint("severity IN ('P0','P1','P2')"))


class IssueGap(Entity, Base):
    __tablename__ = 'issue_gap'
    issue_id: Mapped[str] = mapped_column(ForeignKey('issue.id'))
    gap_id: Mapped[str] = mapped_column(ForeignKey('gap.id'))
    __table_args__ = (UniqueConstraint('issue_id', 'gap_id'),)


class IssueAction(Entity, Base):
    __tablename__ = 'issue_action'
    issue_id: Mapped[str] = mapped_column(ForeignKey('issue.id'), index=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey('user_account.id'))
    action: Mapped[str] = mapped_column(String(30))
    reason: Mapped[str] = mapped_column(String(500))


class IssueEvidence(Entity, Base):
    __tablename__ = 'issue_evidence_ref'
    issue_id: Mapped[str] = mapped_column(ForeignKey('issue.id'))
    version_id: Mapped[str] = mapped_column(ForeignKey('evidence_version.id'))
    __table_args__ = (UniqueConstraint('issue_id', 'version_id'),)


class Snapshot(Entity, Base):
    __tablename__ = 'snapshot'
    project_id: Mapped[str] = mapped_column(ForeignKey('project.id'), index=True)
    author_id: Mapped[str] = mapped_column(ForeignKey('user_account.id'))
    manifest: Mapped[dict] = mapped_column(JSONB)
    manifest_hash: Mapped[str] = mapped_column(String(64))


class Approval(Entity, Base):
    __tablename__ = 'approval_request'
    project_id: Mapped[str] = mapped_column(ForeignKey('project.id'), index=True)
    kind: Mapped[str] = mapped_column(String(24))
    item_id: Mapped[str | None] = mapped_column(ForeignKey('checklist_item.id'))
    issue_id: Mapped[str | None] = mapped_column(ForeignKey('issue.id'))
    snapshot_id: Mapped[str | None] = mapped_column(ForeignKey('snapshot.id'))
    author_id: Mapped[str] = mapped_column(ForeignKey('user_account.id'))
    decider_id: Mapped[str | None] = mapped_column(ForeignKey('user_account.id'))
    reason: Mapped[str] = mapped_column(String(500))
    decision_reason: Mapped[str | None] = mapped_column(String(500))
    payload: Mapped[dict] = mapped_column(JSONB)
    state: Mapped[str] = mapped_column(String(20), default='pending')
    __table_args__ = (CheckConstraint('num_nonnulls(item_id, issue_id, snapshot_id) = 1'),)


class Export(Entity, Base):
    __tablename__ = 'export_artifact'
    approval_id: Mapped[str] = mapped_column(ForeignKey('approval_request.id'), unique=True)
    snapshot_id: Mapped[str] = mapped_column(ForeignKey('snapshot.id'))
    path: Mapped[str] = mapped_column(Text)
    artifact_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Job(Entity, Base):
    __tablename__ = 'job'
    project_id: Mapped[str] = mapped_column(ForeignKey('project.id'), index=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey('user_account.id'))
    kind: Mapped[str] = mapped_column(String(24))
    payload: Mapped[dict] = mapped_column(JSONB)
    state: Mapped[str] = mapped_column(String(20), default='queued', index=True)
    result: Mapped[dict | None] = mapped_column(JSONB)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error_code: Mapped[str | None] = mapped_column(String(60))
    attempt_token: Mapped[str | None] = mapped_column(String(36))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Idempotency(Entity, Base):
    __tablename__ = 'idempotency_record'
    actor_id: Mapped[str] = mapped_column(ForeignKey('user_account.id'))
    path: Mapped[str] = mapped_column(String(250))
    key: Mapped[str] = mapped_column(String(100))
    request_hash: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSONB)
    __table_args__ = (UniqueConstraint('actor_id', 'path', 'key'),)


class PersonalView(Entity, Base):
    __tablename__ = 'personal_view'
    user_id: Mapped[str] = mapped_column(ForeignKey('user_account.id'))
    project_id: Mapped[str] = mapped_column(ForeignKey('project.id'))
    name: Mapped[str] = mapped_column(String(80))
    filters: Mapped[dict] = mapped_column(JSONB)


class MetricSample(Entity, Base):
    __tablename__ = 'metric_sample'
    project_id: Mapped[str] = mapped_column(ForeignKey('project.id'))
    actor_id: Mapped[str] = mapped_column(ForeignKey('user_account.id'))
    task_type: Mapped[str] = mapped_column(String(60))
    group: Mapped[str] = mapped_column(String(20))
    minutes: Mapped[int] = mapped_column(Integer)
    count: Mapped[int] = mapped_column(Integer, default=1)
    __table_args__ = (CheckConstraint('minutes >= 0 AND count > 0'),)


class AuditEvent(Entity, Base):
    __tablename__ = 'audit_event'
    project_id: Mapped[str | None] = mapped_column(ForeignKey('project.id'), index=True)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey('user_account.id'))
    object_id: Mapped[str] = mapped_column(String(100))
    action: Mapped[str] = mapped_column(String(80))
    result: Mapped[str] = mapped_column(String(24), default='success')
    trace_id: Mapped[str] = mapped_column(String(36))
    before_hash: Mapped[str | None] = mapped_column(String(64))
    after_hash: Mapped[str | None] = mapped_column(String(64))


Index('ix_item_scope_state', Checklist.project_id, Checklist.org_id, Checklist.state)
IMMUTABLE_TABLES = ['project_scope_version', 'evidence_version', 'checklist_submission',
                    'submission_evidence_ref', 'review', 'gap', 'issue_action', 'snapshot',
                    'audit_event', 'metric_sample', 'template_upgrade_decision']
