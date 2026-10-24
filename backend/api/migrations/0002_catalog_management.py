from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def initialize_state(apps, schema_editor):
    apps.get_model('api', 'CatalogState').objects.using(schema_editor.connection.alias).get_or_create(pk=1)


class Migration(migrations.Migration):
    dependencies = [('api', '0001_initial'), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(name='CatalogState', fields=[
            ('id', models.PositiveSmallIntegerField(default=1, editable=False, primary_key=True, serialize=False)),
            ('revision', models.PositiveBigIntegerField(default=0)),
            ('document', models.JSONField(default=dict)),
            ('updated_at', models.DateTimeField(auto_now=True)),
        ]),
        migrations.CreateModel(name='CatalogChange', fields=[
            ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
            ('revision', models.PositiveBigIntegerField(unique=True)),
            ('source', models.CharField(default='web', max_length=100)),
            ('operations', models.JSONField(default=list)),
            ('created_at', models.DateTimeField(auto_now_add=True)),
            ('actor', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
        ]),
        migrations.RunPython(initialize_state, migrations.RunPython.noop),
    ]
