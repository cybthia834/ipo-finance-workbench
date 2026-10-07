"""Published templates remain immutable, including attempts through the application DB role."""
from alembic import op

revision = '0002'
down_revision = '0001'


def upgrade():
    op.execute('''CREATE FUNCTION protect_published_template() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_TABLE_NAME = 'template_version' THEN
        IF OLD.state = 'published' THEN RAISE EXCEPTION 'Published template is immutable'; END IF;
      ELSE
        IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM template_version WHERE id=OLD.version_id AND state='published')
          THEN RAISE EXCEPTION 'Published template item is immutable'; END IF;
        IF TG_OP <> 'DELETE' AND EXISTS (SELECT 1 FROM template_version WHERE id=NEW.version_id AND state='published')
          THEN RAISE EXCEPTION 'Published template item is immutable'; END IF;
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$''')
    op.execute('CREATE TRIGGER template_immutable BEFORE UPDATE OR DELETE ON template_version FOR EACH ROW EXECUTE FUNCTION protect_published_template()')
    op.execute('CREATE TRIGGER template_item_immutable BEFORE INSERT OR UPDATE OR DELETE ON template_item_version FOR EACH ROW EXECUTE FUNCTION protect_published_template()')


def downgrade():
    raise RuntimeError('Restore a reviewed backup instead of removing history protections.')
