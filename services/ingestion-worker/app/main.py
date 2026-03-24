"""Entry point for the Ingestion Worker.

This worker polls sports data providers, normalises stat data to the internal
schema, and publishes StatEvent messages to the message bus for the Scoring Service.
"""
