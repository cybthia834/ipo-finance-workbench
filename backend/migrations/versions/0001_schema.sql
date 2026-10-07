CREATE TABLE user_account (
	username VARCHAR(80) NOT NULL, 
	display_name VARCHAR(80) NOT NULL, 
	person_id VARCHAR(36) NOT NULL, 
	password_hash TEXT NOT NULL, 
	active BOOLEAN NOT NULL, 
	identity_admin BOOLEAN NOT NULL, 
	must_change_password BOOLEAN NOT NULL, 
	failed_logins INTEGER NOT NULL, 
	locked_until TIMESTAMP WITH TIME ZONE, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (username), 
	UNIQUE (person_id)
)
-- statement --
CREATE TABLE project (
	name VARCHAR(120) NOT NULL, 
	exchange VARCHAR(20) NOT NULL, 
	scope_version INTEGER NOT NULL, 
	permission_revision INTEGER NOT NULL, 
	template_version_id VARCHAR(36), 
	demo BOOLEAN NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
)
-- statement --
CREATE TABLE login_session (
	user_id VARCHAR(36) NOT NULL, 
	token_hash VARCHAR(64) NOT NULL, 
	csrf_hash VARCHAR(64) NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	revoked BOOLEAN NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES user_account (id), 
	UNIQUE (token_hash)
)
-- statement --
CREATE INDEX ix_login_session_user_id ON login_session (user_id)
-- statement --
CREATE TABLE organization (
	project_id VARCHAR(36) NOT NULL, 
	code VARCHAR(80) NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	current BOOLEAN NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (project_id, code), 
	FOREIGN KEY(project_id) REFERENCES project (id)
)
-- statement --
CREATE INDEX ix_organization_project_id ON organization (project_id)
-- statement --
CREATE TABLE period (
	project_id VARCHAR(36) NOT NULL, 
	label VARCHAR(60) NOT NULL, 
	start DATE NOT NULL, 
	"end" DATE NOT NULL, 
	current BOOLEAN NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (project_id, start, "end"), 
	CHECK ("start" <= "end"), 
	FOREIGN KEY(project_id) REFERENCES project (id)
)
-- statement --
CREATE TABLE project_scope_version (
	project_id VARCHAR(36) NOT NULL, 
	version INTEGER NOT NULL, 
	content JSONB NOT NULL, 
	author_id VARCHAR(36) NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (project_id, version), 
	FOREIGN KEY(project_id) REFERENCES project (id), 
	FOREIGN KEY(author_id) REFERENCES user_account (id)
)
-- statement --
CREATE TABLE membership (
	project_id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	roles VARCHAR(20)[] NOT NULL, 
	org_ids VARCHAR(36)[] NOT NULL, 
	active BOOLEAN NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (project_id, user_id), 
	FOREIGN KEY(project_id) REFERENCES project (id), 
	FOREIGN KEY(user_id) REFERENCES user_account (id)
)
-- statement --
CREATE TABLE template_version (
	project_id VARCHAR(36) NOT NULL, 
	number INTEGER NOT NULL, 
	author_id VARCHAR(36) NOT NULL, 
	publisher_id VARCHAR(36), 
	state VARCHAR(20) NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (project_id, number), 
	FOREIGN KEY(project_id) REFERENCES project (id), 
	FOREIGN KEY(author_id) REFERENCES user_account (id), 
	FOREIGN KEY(publisher_id) REFERENCES user_account (id)
)
-- statement --
CREATE TABLE snapshot (
	project_id VARCHAR(36) NOT NULL, 
	author_id VARCHAR(36) NOT NULL, 
	manifest JSONB NOT NULL, 
	manifest_hash VARCHAR(64) NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(project_id) REFERENCES project (id), 
	FOREIGN KEY(author_id) REFERENCES user_account (id)
)
-- statement --
CREATE INDEX ix_snapshot_project_id ON snapshot (project_id)
-- statement --
CREATE TABLE job (
	project_id VARCHAR(36) NOT NULL, 
	actor_id VARCHAR(36) NOT NULL, 
	kind VARCHAR(24) NOT NULL, 
	payload JSONB NOT NULL, 
	state VARCHAR(20) NOT NULL, 
	result JSONB, 
	attempts INTEGER NOT NULL, 
	error_code VARCHAR(60), 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(project_id) REFERENCES project (id), 
	FOREIGN KEY(actor_id) REFERENCES user_account (id)
)
-- statement --
CREATE INDEX ix_job_project_id ON job (project_id)
-- statement --
CREATE INDEX ix_job_state ON job (state)
-- statement --
CREATE TABLE idempotency_record (
	actor_id VARCHAR(36) NOT NULL, 
	path VARCHAR(250) NOT NULL, 
	key VARCHAR(100) NOT NULL, 
	request_hash VARCHAR(64) NOT NULL, 
	result JSONB NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (actor_id, path, key), 
	FOREIGN KEY(actor_id) REFERENCES user_account (id)
)
-- statement --
CREATE TABLE personal_view (
	user_id VARCHAR(36) NOT NULL, 
	project_id VARCHAR(36) NOT NULL, 
	name VARCHAR(80) NOT NULL, 
	filters JSONB NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES user_account (id), 
	FOREIGN KEY(project_id) REFERENCES project (id)
)
-- statement --
CREATE TABLE metric_sample (
	project_id VARCHAR(36) NOT NULL, 
	actor_id VARCHAR(36) NOT NULL, 
	task_type VARCHAR(60) NOT NULL, 
	"group" VARCHAR(20) NOT NULL, 
	minutes INTEGER NOT NULL, 
	count INTEGER NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CHECK (minutes >= 0 AND count > 0), 
	FOREIGN KEY(project_id) REFERENCES project (id), 
	FOREIGN KEY(actor_id) REFERENCES user_account (id)
)
-- statement --
CREATE TABLE audit_event (
	project_id VARCHAR(36), 
	actor_id VARCHAR(36), 
	object_id VARCHAR(100) NOT NULL, 
	action VARCHAR(80) NOT NULL, 
	result VARCHAR(24) NOT NULL, 
	trace_id VARCHAR(36) NOT NULL, 
	before_hash VARCHAR(64), 
	after_hash VARCHAR(64), 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(project_id) REFERENCES project (id), 
	FOREIGN KEY(actor_id) REFERENCES user_account (id)
)
-- statement --
CREATE INDEX ix_audit_event_project_id ON audit_event (project_id)
-- statement --
CREATE TABLE template_item_version (
	version_id VARCHAR(36) NOT NULL, 
	code VARCHAR(40) NOT NULL, 
	title VARCHAR(160) NOT NULL, 
	domain VARCHAR(20) NOT NULL, 
	source TEXT NOT NULL, 
	standard TEXT NOT NULL, 
	checks JSONB NOT NULL, 
	condition VARCHAR(40) NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (version_id, code), 
	FOREIGN KEY(version_id) REFERENCES template_version (id)
)
-- statement --
CREATE TABLE admission_policy (
	project_id VARCHAR(36) NOT NULL, 
	org_id VARCHAR(36) NOT NULL, 
	reference VARCHAR(100) NOT NULL, 
	allowed_fields VARCHAR(40)[] NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	state VARCHAR(20) NOT NULL, 
	author_id VARCHAR(36) NOT NULL, 
	verifier_id VARCHAR(36), 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(project_id) REFERENCES project (id), 
	FOREIGN KEY(org_id) REFERENCES organization (id), 
	FOREIGN KEY(author_id) REFERENCES user_account (id), 
	FOREIGN KEY(verifier_id) REFERENCES user_account (id)
)
-- statement --
CREATE INDEX ix_admission_policy_project_id ON admission_policy (project_id)
-- statement --
CREATE TABLE issue (
	project_id VARCHAR(36) NOT NULL, 
	org_id VARCHAR(36) NOT NULL, 
	title VARCHAR(160) NOT NULL, 
	facts VARCHAR(500) NOT NULL, 
	kind VARCHAR(40) NOT NULL, 
	severity VARCHAR(2) NOT NULL, 
	owner_id VARCHAR(36) NOT NULL, 
	verifier_id VARCHAR(36) NOT NULL, 
	original_due DATE NOT NULL, 
	current_due DATE NOT NULL, 
	extension_count INTEGER NOT NULL, 
	state VARCHAR(24) NOT NULL, 
	submitted_by VARCHAR(36), 
	reassessment_required BOOLEAN NOT NULL, 
	row_version INTEGER NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CHECK (owner_id <> verifier_id), 
	CHECK (severity IN ('P0','P1','P2')), 
	FOREIGN KEY(project_id) REFERENCES project (id), 
	FOREIGN KEY(org_id) REFERENCES organization (id), 
	FOREIGN KEY(owner_id) REFERENCES user_account (id), 
	FOREIGN KEY(verifier_id) REFERENCES user_account (id), 
	FOREIGN KEY(submitted_by) REFERENCES user_account (id)
)
-- statement --
CREATE INDEX ix_issue_project_id ON issue (project_id)
-- statement --
CREATE INDEX ix_issue_state ON issue (state)
-- statement --
CREATE TABLE checklist_item (
	project_id VARCHAR(36) NOT NULL, 
	org_id VARCHAR(36) NOT NULL, 
	period_id VARCHAR(36) NOT NULL, 
	template_item_id VARCHAR(36) NOT NULL, 
	topic_code VARCHAR(40) NOT NULL, 
	basis VARCHAR(40) NOT NULL, 
	applicability VARCHAR(24) NOT NULL, 
	state VARCHAR(24) NOT NULL, 
	owner_id VARCHAR(36), 
	reviewer_id VARCHAR(36), 
	due DATE, 
	current BOOLEAN NOT NULL, 
	row_version INTEGER NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (project_id, topic_code, org_id, period_id, basis), 
	CHECK (owner_id IS NULL OR reviewer_id IS NULL OR owner_id <> reviewer_id), 
	CHECK (applicability IN ('pending','applicable','not_applicable')), 
	FOREIGN KEY(project_id) REFERENCES project (id), 
	FOREIGN KEY(org_id) REFERENCES organization (id), 
	FOREIGN KEY(period_id) REFERENCES period (id), 
	FOREIGN KEY(template_item_id) REFERENCES template_item_version (id), 
	FOREIGN KEY(owner_id) REFERENCES user_account (id), 
	FOREIGN KEY(reviewer_id) REFERENCES user_account (id)
)
-- statement --
CREATE INDEX ix_checklist_item_project_id ON checklist_item (project_id)
-- statement --
CREATE INDEX ix_item_scope_state ON checklist_item (project_id, org_id, state)
-- statement --
CREATE INDEX ix_checklist_item_state ON checklist_item (state)
-- statement --
CREATE INDEX ix_checklist_item_org_id ON checklist_item (org_id)
-- statement --
CREATE TABLE evidence (
	project_id VARCHAR(36) NOT NULL, 
	org_id VARCHAR(36) NOT NULL, 
	period_id VARCHAR(36) NOT NULL, 
	policy_id VARCHAR(36) NOT NULL, 
	owner_id VARCHAR(36) NOT NULL, 
	code VARCHAR(80) NOT NULL, 
	mode VARCHAR(1) NOT NULL, 
	current_version_id VARCHAR(36), 
	row_version INTEGER NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CHECK (mode = 'A'), 
	UNIQUE (project_id, code), 
	FOREIGN KEY(project_id) REFERENCES project (id), 
	FOREIGN KEY(org_id) REFERENCES organization (id), 
	FOREIGN KEY(period_id) REFERENCES period (id), 
	FOREIGN KEY(policy_id) REFERENCES admission_policy (id), 
	FOREIGN KEY(owner_id) REFERENCES user_account (id)
)
-- statement --
CREATE INDEX ix_evidence_project_id ON evidence (project_id)
-- statement --
CREATE TABLE issue_action (
	issue_id VARCHAR(36) NOT NULL, 
	actor_id VARCHAR(36) NOT NULL, 
	action VARCHAR(30) NOT NULL, 
	reason VARCHAR(500) NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(issue_id) REFERENCES issue (id), 
	FOREIGN KEY(actor_id) REFERENCES user_account (id)
)
-- statement --
CREATE INDEX ix_issue_action_issue_id ON issue_action (issue_id)
-- statement --
CREATE TABLE evidence_version (
	evidence_id VARCHAR(36) NOT NULL, 
	number INTEGER NOT NULL, 
	content JSONB NOT NULL, 
	metadata_hash VARCHAR(64) NOT NULL, 
	reason VARCHAR(300) NOT NULL, 
	submitted_by VARCHAR(36) NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (evidence_id, number), 
	FOREIGN KEY(evidence_id) REFERENCES evidence (id), 
	FOREIGN KEY(submitted_by) REFERENCES user_account (id)
)
-- statement --
CREATE TABLE checklist_evidence_link (
	item_id VARCHAR(36) NOT NULL, 
	evidence_id VARCHAR(36) NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (item_id, evidence_id), 
	FOREIGN KEY(item_id) REFERENCES checklist_item (id), 
	FOREIGN KEY(evidence_id) REFERENCES evidence (id)
)
-- statement --
CREATE INDEX ix_checklist_evidence_link_item_id ON checklist_evidence_link (item_id)
-- statement --
CREATE TABLE checklist_submission (
	item_id VARCHAR(36) NOT NULL, 
	submitted_by VARCHAR(36) NOT NULL, 
	template_item_id VARCHAR(36) NOT NULL, 
	item_version INTEGER NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(item_id) REFERENCES checklist_item (id), 
	FOREIGN KEY(submitted_by) REFERENCES user_account (id), 
	FOREIGN KEY(template_item_id) REFERENCES template_item_version (id)
)
-- statement --
CREATE INDEX ix_checklist_submission_item_id ON checklist_submission (item_id)
-- statement --
CREATE TABLE gap (
	item_id VARCHAR(36) NOT NULL, 
	facts VARCHAR(500) NOT NULL, 
	kind VARCHAR(40) NOT NULL, 
	author_id VARCHAR(36) NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(item_id) REFERENCES checklist_item (id), 
	FOREIGN KEY(author_id) REFERENCES user_account (id)
)
-- statement --
CREATE INDEX ix_gap_item_id ON gap (item_id)
-- statement --
CREATE TABLE approval_request (
	project_id VARCHAR(36) NOT NULL, 
	kind VARCHAR(24) NOT NULL, 
	item_id VARCHAR(36), 
	issue_id VARCHAR(36), 
	snapshot_id VARCHAR(36), 
	author_id VARCHAR(36) NOT NULL, 
	decider_id VARCHAR(36), 
	reason VARCHAR(500) NOT NULL, 
	decision_reason VARCHAR(500), 
	payload JSONB NOT NULL, 
	state VARCHAR(20) NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CHECK (num_nonnulls(item_id, issue_id, snapshot_id) = 1), 
	FOREIGN KEY(project_id) REFERENCES project (id), 
	FOREIGN KEY(item_id) REFERENCES checklist_item (id), 
	FOREIGN KEY(issue_id) REFERENCES issue (id), 
	FOREIGN KEY(snapshot_id) REFERENCES snapshot (id), 
	FOREIGN KEY(author_id) REFERENCES user_account (id), 
	FOREIGN KEY(decider_id) REFERENCES user_account (id)
)
-- statement --
CREATE INDEX ix_approval_request_project_id ON approval_request (project_id)
-- statement --
CREATE TABLE submission_evidence_ref (
	submission_id VARCHAR(36) NOT NULL, 
	version_id VARCHAR(36) NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (submission_id, version_id), 
	FOREIGN KEY(submission_id) REFERENCES checklist_submission (id), 
	FOREIGN KEY(version_id) REFERENCES evidence_version (id)
)
-- statement --
CREATE TABLE review (
	item_id VARCHAR(36) NOT NULL, 
	submission_id VARCHAR(36) NOT NULL, 
	reviewer_id VARCHAR(36) NOT NULL, 
	decision VARCHAR(24) NOT NULL, 
	checks JSONB NOT NULL, 
	reason VARCHAR(500) NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(item_id) REFERENCES checklist_item (id), 
	UNIQUE (submission_id), 
	FOREIGN KEY(submission_id) REFERENCES checklist_submission (id), 
	FOREIGN KEY(reviewer_id) REFERENCES user_account (id)
)
-- statement --
CREATE INDEX ix_review_item_id ON review (item_id)
-- statement --
CREATE TABLE issue_gap (
	issue_id VARCHAR(36) NOT NULL, 
	gap_id VARCHAR(36) NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (issue_id, gap_id), 
	FOREIGN KEY(issue_id) REFERENCES issue (id), 
	FOREIGN KEY(gap_id) REFERENCES gap (id)
)
-- statement --
CREATE TABLE issue_evidence_ref (
	issue_id VARCHAR(36) NOT NULL, 
	version_id VARCHAR(36) NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (issue_id, version_id), 
	FOREIGN KEY(issue_id) REFERENCES issue (id), 
	FOREIGN KEY(version_id) REFERENCES evidence_version (id)
)
-- statement --
CREATE TABLE export_artifact (
	approval_id VARCHAR(36) NOT NULL, 
	snapshot_id VARCHAR(36) NOT NULL, 
	path TEXT NOT NULL, 
	artifact_hash VARCHAR(64) NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (approval_id), 
	FOREIGN KEY(approval_id) REFERENCES approval_request (id), 
	FOREIGN KEY(snapshot_id) REFERENCES snapshot (id)
)
-- statement --
ALTER TABLE evidence ADD FOREIGN KEY(current_version_id) REFERENCES evidence_version (id)
-- statement --
ALTER TABLE project ADD FOREIGN KEY(template_version_id) REFERENCES template_version (id)
