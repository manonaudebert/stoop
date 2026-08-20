"""Shared plumbing for the per-city Building Brief routes.

The corpus read lives here rather than in one city's route module because it is
a pure function of (rules selected, corpus key, prompt version) and the next city
that generates text needs exactly the same behaviour — including the degradation
this function exists for, which was paid for once already.

A city with no corpus never calls it: `rule.watch_for` is authored and served
directly. That is not a fallback, it is the whole design in SF.
"""

import logging

from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from services.briefs.cities import NYC, CityBriefConfig
from services.briefs.corpus import PROMPT_VERSION, keys_for_selection

logger = logging.getLogger(__name__)

# Postgres: relation does not exist.
UNDEFINED_TABLE = "42P01"


async def generated_watch_for(
    db: AsyncSession,
    selected_rules,
    *,
    categories,
    percentile,
    config: CityBriefConfig = NYC,
) -> dict[str, str]:
    """rule_id -> the generated sentence for it, for the rules that have one.

    A miss is the normal case and not an error — an absent rule id simply means
    the page renders that rule's authored `brief_line`. That is what makes a
    partial corpus a shippable state rather than a broken one, and it is the
    per-rule kill-switch: deleting a rule's rows turns its generated text off
    with no code change.

    Skipped entirely when nothing is flagged, which is roughly half of all
    buildings — there is no rule to look up a sentence for, and this is the
    hottest route on the site.

    Keyed on (rule_id, input_key, prompt_version), which is the primary key, so
    a stale corpus from an older prompt is invisible rather than served.

    A MISSING `brief_texts` table is treated as an empty one. This is not
    defensive padding — it is the difference between a degraded brief and no
    brief at all, and it has already cost the site once: the read path shipped
    in 429a06f while `migrate_brief_texts.sql` was deliberately left unapplied,
    on the reasoning that a missing table and an empty table both mean "no
    generated text". They do not. An empty table returns zero rows; a missing
    one raises, and `page.tsx` fetches the brief with `.catch(() => null)`, so
    the entire section silently disappeared from every building where a rule
    fired — the ~52% of pages that have something to say. The early return above
    is why the other 48% looked fine and hid the bug.

    Narrow on purpose: only undefined_table, and only for this optional read.
    Any other database error is a real fault and still propagates.
    """
    keys = keys_for_selection(
        selected_rules, categories=categories, percentile=percentile, config=config
    )
    if not keys:
        return {}

    try:
        rows = (await db.execute(
            text("""
                SELECT rule_id, watch_for
                FROM brief_texts
                WHERE prompt_version = :version
                  AND (rule_id, input_key) IN (
                      SELECT * FROM unnest(
                          CAST(:rule_ids AS text[]), CAST(:input_keys AS text[])
                      )
                  )
            """),
            {
                "version": PROMPT_VERSION,
                "rule_ids": [rule_id for rule_id, _ in keys],
                "input_keys": [key for _, key in keys],
            },
        )).all()
    except ProgrammingError as e:
        if getattr(e.orig, "sqlstate", None) != UNDEFINED_TABLE:
            raise
        # The failed statement aborted the transaction. Nothing downstream reads
        # the database, but roll back explicitly rather than leave a poisoned
        # session for the dependency teardown to discover.
        await db.rollback()
        logger.warning(
            "brief_texts is missing — serving authored brief_line only. "
            "Apply ingest/migration/migrate_brief_texts.sql."
        )
        return {}
    return {r.rule_id: r.watch_for for r in rows}
