"""Fixed verification provenance and immutable template adoption history."""
from alembic import op

revision = '0005'
down_revision = '0004'


def upgrade():
    op.execute('ALTER TABLE review ADD COLUMN verification_method varchar(100), ADD COLUMN verified_at timestamptz')
    op.execute("ALTER TABLE gap ADD COLUMN provenance jsonb NOT NULL DEFAULT '{}'::jsonb")
    op.execute('''CREATE TABLE template_upgrade_decision (
        id varchar(36) PRIMARY KEY, created_at timestamptz NOT NULL,
        item_id varchar(36) NOT NULL REFERENCES checklist_item(id),
        old_template_item_id varchar(36) NOT NULL REFERENCES template_item_version(id),
        new_template_item_id varchar(36) NOT NULL REFERENCES template_item_version(id),
        actor_id varchar(36) NOT NULL REFERENCES user_account(id),
        decision varchar(12) NOT NULL CHECK (decision IN ('adopt', 'retain')),
        reason varchar(500) NOT NULL)''')
    op.execute('CREATE INDEX ix_template_upgrade_decision_item_id ON template_upgrade_decision(item_id)')
    op.execute('GRANT SELECT, INSERT ON template_upgrade_decision TO finance_app')
    op.execute('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON template_upgrade_decision FOR EACH ROW EXECUTE FUNCTION reject_history_change()')


def downgrade():
    raise RuntimeError('Immutable provenance requires a reviewed forward migration.')
