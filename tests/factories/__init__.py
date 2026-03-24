"""Test data factories — factory-boy factories for all domain models.

Usage:
    from tests.factories import TenantFactory, LeagueFactory

    tenant = TenantFactory()
    league = LeagueFactory(tenant_id=tenant.id)
"""
