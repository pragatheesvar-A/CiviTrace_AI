"""
Bayesian reporter-trust score.

Contribution: triage should weight a report by the historical reliability of the
person filing it, without punishing newcomers. We model each reporter's
"confirmed" rate as a Beta(alpha, beta) posterior:

    alpha = 1 + (# of their reports an authority marked Resolved/valid)
    beta  = 1 + (# an authority marked Rejected/duplicate/invalid)
    trust = alpha / (alpha + beta)            # posterior mean, in (0,1)

A brand-new reporter sits at 0.5 (uninformative prior), so they are neither
boosted nor suppressed. Trust feeds the priority model and is shown to
authorities as an explainable number, never used to auto-reject.
"""
from __future__ import annotations


def trust_score(valid: int, invalid: int) -> float:
    alpha = 1.0 + max(0, valid)
    beta = 1.0 + max(0, invalid)
    return round(alpha / (alpha + beta), 3)


def trust_band(score: float) -> str:
    if score >= 0.75:
        return "high"
    if score >= 0.45:
        return "neutral"
    return "low"
