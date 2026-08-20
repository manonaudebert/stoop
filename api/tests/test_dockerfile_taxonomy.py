"""The image must ship the file taxonomy.py reads, at the depth it reads it from.

This exists because it already failed once. `services/briefs/taxonomy.py` finds
`renter-facing-groups.json` by walking up three directory levels, which holds in
a checkout and held in the container only until the Dockerfile stopped mirroring
the repo layout. Nothing in the suite noticed: every test runs from a checkout,
where the walk resolves fine. The failure surfaced as an import-time crash on
deploy, after a green test run.

So the assertion here is not "the Dockerfile mentions the JSON" — it is the
arithmetic itself, replayed against the paths the Dockerfile actually declares.
Change WORKDIR, change where `COPY api/` lands, or change TAXONOMY_PATH's
parent count, and this recomputes and fails.
"""

import re
from pathlib import Path, PurePosixPath

import pytest

from services.briefs import taxonomy

DOCKERFILE = Path(__file__).resolve().parents[1] / "Dockerfile"

# taxonomy.py sits at <repo>/api/services/briefs/, so parents[3] is the repo
# root in a checkout. The image has to reproduce that same relationship.
REPO_ROOT = Path(taxonomy.__file__).resolve().parents[3]


@pytest.fixture(scope="module")
def dockerfile() -> str:
    return DOCKERFILE.read_text()


def _workdir(dockerfile: str) -> PurePosixPath:
    matches = re.findall(r"^WORKDIR\s+(\S+)", dockerfile, re.MULTILINE)
    assert matches, "api/Dockerfile declares no WORKDIR"
    return PurePosixPath(matches[-1])


def _copy_destinations(dockerfile: str, source: str) -> list[PurePosixPath]:
    """Destinations of every `COPY <source> <dest>`, resolved against WORKDIR."""
    workdir = _workdir(dockerfile)
    out = []
    for src, dest in re.findall(r"^COPY\s+(\S+)\s+(\S+)", dockerfile, re.MULTILINE):
        if src == source:
            out.append(workdir / dest if not dest.startswith("/") else PurePosixPath(dest))
    return out


def test_taxonomy_path_is_inside_the_build_context():
    """A COPY cannot reach outside the context, so the JSON must be under the root."""
    assert taxonomy.TAXONOMY_PATH.is_relative_to(REPO_ROOT), (
        f"{taxonomy.TAXONOMY_PATH} is outside {REPO_ROOT}, so no Dockerfile built "
        "from the repo root can copy it into the image."
    )


def test_image_carries_the_taxonomy_where_taxonomy_py_looks_for_it():
    """Replay the parent-walk against the image's declared paths.

    In the image, taxonomy.py lives at <api_dest>/services/briefs/taxonomy.py, so
    its parents[3] is <api_dest>.parent. The JSON must land at that path joined
    with its repo-relative location — otherwise the module raises FileNotFoundError
    at import, and because routes/hpd.py imports it, the app never starts.
    """
    dockerfile = DOCKERFILE.read_text()

    api_dests = _copy_destinations(dockerfile, "api/")
    assert api_dests, "api/Dockerfile never copies api/ into the image"
    api_dest = api_dests[-1]

    # parents[3] of <api_dest>/services/briefs/taxonomy.py
    image_repo_root = api_dest.parent
    relative = PurePosixPath(taxonomy.TAXONOMY_PATH.relative_to(REPO_ROOT).as_posix())
    expected_dir = image_repo_root / relative.parent

    copied_to = _copy_destinations(dockerfile, str(relative))
    assert copied_to, (
        f"api/Dockerfile never copies {relative}. services.briefs.taxonomy reads it "
        "at import time and routes/hpd.py imports that module, so the container "
        "will crash on startup."
    )
    assert expected_dir in copied_to, (
        f"{relative} is copied to {copied_to}, but taxonomy.py will look for it in "
        f"{expected_dir} (WORKDIR {_workdir(dockerfile)}, api/ copied to {api_dest}). "
        "Either the COPY destination or the parent count in TAXONOMY_PATH is wrong."
    )


def test_dockerignore_does_not_exclude_the_taxonomy():
    """The exemption is a two-step negation; dropping either line re-excludes it.

    `frontend/*` followed by `!frontend/lib/renter-facing-groups.json` is not
    enough — Docker will not re-include a file whose parent directory is
    excluded, so `!frontend/lib/` has to come first. That is easy to "tidy" away.
    """
    dockerignore = (REPO_ROOT / ".dockerignore")
    assert dockerignore.exists(), (
        "the build context root has no .dockerignore; api/.dockerignore is not "
        "read when the context is the repo root"
    )

    relative = taxonomy.TAXONOMY_PATH.relative_to(REPO_ROOT).as_posix()
    lines = [
        line.strip() for line in dockerignore.read_text().splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]

    assert f"!{relative}" in lines, (
        f".dockerignore must re-include {relative} with a leading '!'"
    )

    # Only bare-directory rules are checked, not globs: `frontend/` excludes the
    # directory itself and blocks any negation beneath it, while `frontend/*`
    # excludes only its children and leaves `!frontend/lib/` free to work. This
    # deliberately does not reimplement Docker's matcher — it pins the one
    # mistake that silently drops the file.
    excluded = {line for line in lines if not line.startswith("!")}
    negated = {line[1:].rstrip("/") for line in lines if line.startswith("!")}

    for parent in PurePosixPath(relative).parents:
        if parent == PurePosixPath("."):
            continue
        blocked = {str(parent), f"{parent}/"} & excluded
        assert not blocked or str(parent) in negated, (
            f".dockerignore excludes {sorted(blocked)[0]}, so the negation for "
            f"{relative} has no effect. Either exclude its contents instead "
            f"({parent}/*) or re-include the directory: !{parent}/"
        )


def test_other_cities_keep_their_taxonomy_inside_api():
    """Only NYC's taxonomy needs an explicit COPY; the rest must not.

    NYC's lives in `frontend/lib/` because the violations chart renders from the
    same file, which is why the arithmetic above exists at all. Every other city
    keeps its taxonomy and rules inside `api/services/briefs/cities/`, where
    `COPY api/ .` ships them for free.

    This asserts that property rather than trusting it. A city whose taxonomy
    drifted outside api/ without a matching COPY would import fine in every test
    — they all run from a checkout — and crash the container on startup, which is
    exactly how this failed the first time.
    """
    from services.briefs.cities import CITIES

    api_dir = Path(taxonomy.__file__).resolve().parents[2]
    for key, config in CITIES.items():
        if key == "nyc":
            continue
        assert config.taxonomy_path.is_relative_to(api_dir), (
            f"{key}'s taxonomy is at {config.taxonomy_path}, outside {api_dir}. "
            "Either move it under api/ or add an explicit COPY to api/Dockerfile "
            "and extend the arithmetic above to cover it."
        )
        assert config.rules_path.is_relative_to(api_dir), (
            f"{key}'s rules.yaml is outside {api_dir} and will not ship."
        )
