"""SQL literal helpers shared by every city's signals generator.

Its own module rather than a private function inside one city's generator: the
moment a second city needed it, importing it from the first would have made
`cities/sf/signals.py` depend on `cities/nyc/signals.py` for no reason, and the
next city would have inherited the same accident.
"""


def sql_array(values: list[str]) -> str:
    """A Postgres text[] literal.

    Values are category names from a taxonomy file — no quotes in any of them
    today, but escape anyway rather than generate broken SQL if one ever appears.
    """
    inner = ", ".join("'" + v.replace("'", "''") + "'" for v in values)
    return f"ARRAY[{inner}]"
