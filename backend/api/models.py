from django.conf import settings
from django.db import models


class CloudArchive(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    revision = models.PositiveBigIntegerField(default=0)
    document = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)


class AuthRateBucket(models.Model):
    # The keyed digest keeps IP addresses and usernames out of rate-limit rows.
    key = models.CharField(max_length=64, primary_key=True)
    started_at = models.DateTimeField()
    count = models.PositiveIntegerField(default=0)
