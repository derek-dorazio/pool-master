"""Unit tests for shared domain models."""

import pytest

from poolmaster_shared.domain import (
    Contest,
    DraftConfiguration,
    League,
    Tenant,
    User,
)
from poolmaster_shared.domain.enums import (
    ContestStatus,
    ContestType,
    DraftMode,
    DraftType,
    LeagueVisibility,
    ScoringType,
    Sport,
)


@pytest.mark.unit
class TestTenant:
    def test_create_tenant_with_defaults(self):
        tenant = Tenant(name="Test Org", slug="test-org")
        assert tenant.name == "Test Org"
        assert tenant.slug == "test-org"
        assert tenant.plan_tier == "free"
        assert tenant.settings == {}
        assert tenant.id is not None

    def test_tenant_plan_tier(self):
        tenant = Tenant(name="Pro Org", slug="pro-org", plan_tier="pro")
        assert tenant.plan_tier == "pro"


@pytest.mark.unit
class TestUser:
    def test_create_user(self):
        user = User(email="alex@example.com", display_name="Alex")
        assert user.email == "alex@example.com"
        assert user.display_name == "Alex"
        assert user.auth_provider is None


@pytest.mark.unit
class TestLeague:
    def test_create_league_with_defaults(self, tenant_id):
        league = League(
            tenant_id=tenant_id,
            name="Tiger's Golf Crew",
            created_by=tenant_id,
        )
        assert league.name == "Tiger's Golf Crew"
        assert league.visibility == LeagueVisibility.PRIVATE
        assert league.max_members == 20

    def test_league_public_visibility(self, tenant_id):
        league = League(
            tenant_id=tenant_id,
            name="Open League",
            created_by=tenant_id,
            visibility=LeagueVisibility.PUBLIC,
        )
        assert league.visibility == LeagueVisibility.PUBLIC


@pytest.mark.unit
class TestContest:
    def test_create_contest(self, tenant_id):
        from uuid import uuid4

        league_id = uuid4()
        season_id = uuid4()
        contest = Contest(
            league_id=league_id,
            season_id=season_id,
            name="Masters Pool 2026",
            contest_type=ContestType.SINGLE_EVENT,
            scoring_type=ScoringType.CUMULATIVE,
        )
        assert contest.name == "Masters Pool 2026"
        assert contest.status == ContestStatus.DRAFT
        assert contest.contest_type == ContestType.SINGLE_EVENT

    def test_draft_configuration(self):
        config = DraftConfiguration(
            draft_type=DraftType.SNAKE,
            draft_mode=DraftMode.LIVE,
            rounds=5,
            time_per_pick_seconds=90,
        )
        assert config.draft_type == DraftType.SNAKE
        assert config.is_exclusive is True
        assert config.budget is None


@pytest.mark.unit
class TestEnums:
    def test_sport_values(self):
        assert Sport.GOLF == "GOLF"
        assert Sport.NFL == "NFL"
        assert Sport.F1 == "F1"

    def test_contest_status_values(self):
        assert ContestStatus.DRAFT == "DRAFT"
        assert ContestStatus.ACTIVE == "ACTIVE"
        assert ContestStatus.COMPLETED == "COMPLETED"
