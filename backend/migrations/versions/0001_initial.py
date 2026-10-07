"""Initial directory workflow with immutable evidence, review, snapshot and audit history."""
from alembic import op
from pathlib import Path

IMMUTABLE_TABLES = ['project_scope_version', 'evidence_version', 'checklist_submission',
                   'submission_evidence_ref', 'review', 'gap', 'issue_action', 'snapshot',
                   'audit_event', 'metric_sample']

revision = '0001'
down_revision = None


def upgrade():
    # Frozen DDL: future model changes cannot alter an already released migration.
    for statement in Path(__file__).with_name('0001_schema.sql').read_text().split('-- statement --'):
        op.execute(statement.strip())
    op.execute('''CREATE FUNCTION reject_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Immutable history'; END $$''')
    for name in IMMUTABLE_TABLES:
        op.execute(f'CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON {name} '
                   'FOR EACH ROW EXECUTE FUNCTION reject_history_change()')
    op.execute('GRANT USAGE ON SCHEMA public TO finance_app')
    op.execute('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO finance_app')
    for name in IMMUTABLE_TABLES:
        op.execute(f'REVOKE UPDATE ON {name} FROM finance_app')
    op.execute('REVOKE ALL ON alembic_version FROM finance_app')
    op.execute('GRANT SELECT ON alembic_version TO finance_app')


def downgrade():
    raise RuntimeError('Destructive downgrade is disabled. Restore a reviewed backup instead.')
