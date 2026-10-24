# API 路由总表：URL → 视图函数 → 业务规则或数据库模型。
# 排查请求未命中断点时，先确认路径、末尾斜杠与 HTTP 方法是否匹配。

from django.urls import path
from api import views, accounts, catalog_admin

urlpatterns = [
    path('api/v1/admin/catalog/', catalog_admin.catalog_admin),
    path('api/v1/integrations/catalog/', catalog_admin.ingest_catalog),
    path('api/v1/auth/session/', accounts.session),
    path('api/v1/auth/register/', accounts.register),
    path('api/v1/auth/login/', accounts.sign_in),
    path('api/v1/auth/logout/', accounts.sign_out),
    path('api/v1/auth/password/', accounts.change_password),
    path('api/v1/me/archive/', accounts.archive),
    path('api/v1/health/', views.health),
    path('api/v1/catalog/', views.catalog),
    path('api/v1/passes/', views.passes),
    path('api/v1/stats/', views.stats),
    path('api/v1/backups/validate/', views.backup_validate),
    path('api/v1/schema/', views.schema),
]
