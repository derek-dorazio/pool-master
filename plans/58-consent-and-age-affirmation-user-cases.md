# Plan 58 Companion: Consent And Age Affirmation User Cases

## Purpose

Capture the minimal first-pass account/privacy behavior that remains after the
broader compliance subsystem is removed.

This companion intentionally stays narrow:

- consent capture
- consent history if needed
- age affirmation as part of consent

It should prevent agents from reintroducing a larger compliance subsystem when
only a small consent capability is required.

## Primary Actors

- User
- System

## Core Principle

Age affirmation should be captured as part of the user consent flow, not as a
separate compliance feature area in first pass.

## User Cases

### CA-001: User records consent during onboarding or account setup

Actor:
- User

Goal:
- affirm required product consents before using the system

Flow:
1. User reaches the consent step.
2. UI presents the required consent language.
3. User accepts or rejects each required consent.
4. Backend stores one or more `ConsentRecord` rows.

### CA-002: User affirms minimum age as part of consent

Actor:
- User

Goal:
- affirm that they meet the product’s minimum age expectation

Flow:
1. UI asks the user to affirm they are over the relevant minimum age threshold.
2. The age affirmation is included in the consent flow rather than a separate verification workflow.
3. Backend records the affirmation through `ConsentRecord`.

Notes:
- the exact wording can express:
  - over 13
  - over 18
  depending on product/legal choice later
- first pass does not require a separate age-verification subsystem

### CA-003: User reviews prior consent history if surfaced in account settings

Actor:
- User

Goal:
- see what consents have already been recorded

Flow:
1. User opens account/privacy settings.
2. System loads existing `ConsentRecord` rows for that user.
3. UI shows the recorded consent history if the product chooses to surface it.

## Implementation Guidance

- `ConsentRecord` is the only retained first-pass compliance/privacy persistence concept
- do not reintroduce separate export/delete/self-exclusion/enforcement flows through this consent feature
