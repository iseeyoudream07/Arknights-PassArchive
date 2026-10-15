from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from api.models import AuthRateBucket


class Command(BaseCommand):
    help = 'Remove authentication rate-limit buckets older than one day.'

    def handle(self, *args, **options):
        count, _ = AuthRateBucket.objects.filter(started_at__lt=timezone.now() - timedelta(days=1)).delete()
        self.stdout.write(f'Removed {count} expired authentication attempt buckets.')
