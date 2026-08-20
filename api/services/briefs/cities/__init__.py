"""Per-city Building Brief configuration.

The backend analog of `frontend/lib/cities.ts`, and deliberately the same shape:
a small frozen record of the values that genuinely differ between cities, read by
city-aware callers and passed down so the shared modules never branch on a city
string themselves.

**Data only.** Nothing here imports a sibling brief module. `rules.py`,
`taxonomy.py`, `confidence.py` and the per-city `signals.py` all import *this*,
so the dependency runs one way and adding a city cannot introduce a cycle.

**Why a config object rather than a city string.** Every shared entry point takes
`config: CityBriefConfig = NYC`. Passing the object means a caller cannot typo a
city into a silent fallback, and the default keeps the NYC call sites — most of
them tests written before any second city existed — working unchanged. New code
passes explicitly.

To add a city: create `cities/<key>/` with `rules.yaml`, a taxonomy JSON and a
`signals.py`, then add one entry to `CITIES`. Nothing else in the package should
need editing, which is the property this module exists to preserve.
"""

from dataclasses import dataclass
from pathlib import Path

_HERE = Path(__file__).resolve().parent

# `taxonomy.py` sits at api/services/briefs/, so parents[3] from THERE is the
# repo root. This module is one level deeper, hence parents[4]. Both are pinned
# by tests/test_dockerfile_taxonomy.py, which replays the arithmetic against the
# Dockerfile — it exists because this relationship already broke a deploy once.
_REPO_ROOT = _HERE.parents[3]


@dataclass(frozen=True)
class CityBriefConfig:
    """Everything the shared brief modules need to serve one city."""

    # Short key. Matches `CallRecord.city` and the `brief_texts.city` column.
    key: str

    # The rules table and the renter-facing taxonomy.
    rules_path: Path
    taxonomy_path: Path

    # The precomputed signals view, and the identifier column that keys it.
    signals_view: str
    id_column: str

    # Supplies the violations percentile. Not a rule signal — it gates whether
    # severity language was permitted in the prompt, so it is part of the corpus
    # key. Joined at request time rather than materialized.
    summary_view: str
    percentile_column: str

    # Noun the confidence note uses for this city's record set ("HPD records on
    # file", "DBI and 311 records on file").
    record_noun: str

    # Signal keys carrying the record volume and recency the confidence note is
    # computed from. Named per city because each view inherited its own column
    # names, and renaming NYC's would cost a full matview recompute for nothing.
    record_count_signal: str
    latest_activity_signal: str

    # What a row of the signals view describes. NYC is building-grained (one BIN
    # is one building); SF is parcel-grained (one mapblklot can hold several).
    # Copy must not promise more precision than the grain supports.
    subject_noun: str

    # Prefix that turns a rule's `source` into a followable URL. NYC's source is
    # a page reference into a PDF ("p.11-12") and stays None: there is nothing to
    # link to. SF's is a section anchor into the publisher's own HTML edition, so
    # the primary citation can be a real link — a citation nobody can follow is
    # decoration.
    source_url_base: str | None = None

    # The rule whose single condition spans several distinct hazard areas, and
    # is therefore allowed to name them in its sentence and to return more than
    # one generated sentence. None where no rule has that shape — see the
    # hazard-area note in `taxonomy.py`. When None, the whole hazard-area path
    # is inert for this city.
    hazard_area_rule_id: str | None = None
    multi_sentence_rule_id: str | None = None

    # Whether class-C-style suppression applies: a complaint-keyed rule dropped
    # because an inspector already confirmed the same condition. Requires a
    # violation taxonomy good enough to identify the condition, which not every
    # city has.
    suppression_enabled: bool = False


NYC = CityBriefConfig(
    key="nyc",
    rules_path=_HERE / "nyc" / "rules.yaml",
    # Stays in the frontend because the "Top violation categories" chart renders
    # from the same file, and two hand-authored descriptions of the same 48
    # categories would drift. The Dockerfile copies it explicitly.
    taxonomy_path=_REPO_ROOT / "frontend" / "lib" / "renter-facing-groups.json",
    signals_view="hpd_brief_signals",
    id_column="bin",
    summary_view="hpd_building_summary",
    percentile_column="violations_density_pct",
    record_noun="HPD",
    source_url_base=None,
    record_count_signal="hpd_record_count",
    latest_activity_signal="latest_hpd_activity",
    subject_noun="building",
    hazard_area_rule_id="open_class_c",
    multi_sentence_rule_id="open_class_c",
    suppression_enabled=True,
)

SF = CityBriefConfig(
    key="sf",
    rules_path=_HERE / "sf" / "rules.yaml",
    # Inside the package, unlike NYC's: no frontend chart reads it, and keeping
    # it here means `COPY api/ .` ships it with no second Dockerfile line.
    taxonomy_path=_HERE / "sf" / "taxonomy.json",
    signals_view="sf_brief_signals",
    id_column="mapblklot",
    summary_view="sf_violations_summary",
    percentile_column="violations_density_pct",
    record_noun="DBI and 311",
    source_url_base="https://www.dre.ca.gov/publications/ResourceGuidebook/",
    record_count_signal="sf_record_count",
    latest_activity_signal="latest_sf_activity",
    # A mapblklot is a parcel, which may carry more than one building. Saying
    # "this building" about it would overstate what the row knows.
    subject_noun="property",
    # No rule has the many-conditions-under-one-heading shape that the
    # hazard-area machinery exists to cure: every SF rule names its own
    # condition. And SF could not feed it anyway — `nov_category_description`
    # is 52.7% section labels rather than conditions.
    hazard_area_rule_id=None,
    multi_sentence_rule_id=None,
    # NYC suppresses a tenant report when an inspector confirmed the same
    # condition. In SF the better-structured signal is the tenant report, so the
    # premise inverts and the suppression is not ported.
    suppression_enabled=False,
)

CITIES: dict[str, CityBriefConfig] = {c.key: c for c in (NYC, SF)}


def get_city(key: str) -> CityBriefConfig:
    """Config by key. Raises rather than falling back to a default city.

    A wrong city silently serving NYC's rules is the failure mode worth being
    loud about: the output looks entirely plausible.
    """
    try:
        return CITIES[key]
    except KeyError:
        raise KeyError(
            f"unknown city {key!r}; known cities: {sorted(CITIES)}"
        ) from None


__all__ = ["CITIES", "NYC", "SF", "CityBriefConfig", "get_city"]
