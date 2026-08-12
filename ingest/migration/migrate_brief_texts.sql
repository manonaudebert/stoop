-- brief_texts — the Building Brief's generated-sentence corpus.
--
-- One row per (rule, input shape, prompt version). NOT one row per building:
-- the prompt carries no counts, no percentile, no address and no neighborhood,
-- so the model's input is a pure function of which rule fired, which hazard
-- areas sit behind it, and whether severity language was permitted. That is
-- ~12,000 rows for all of NYC against 464,000 buildings.
--
-- The key is built by `api/services/briefs/corpus.py::input_key`, which is also
-- where the choice of a structured key over a hash of the rendered prompt is
-- argued. Read that before changing this shape.
--
-- Safely re-runnable: no unique index beyond the primary key, and every
-- statement is IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS brief_texts (
    -- Denormalized out of `input_key`, which already begins with it. Kept as
    -- its own column because the per-rule kill-switch is the point: if a rule's
    -- generated sentences are not clearly better than its authored `brief_line`,
    -- that rule's corpus is deleted and the page falls back with no code change.
    -- `DELETE FROM brief_texts WHERE rule_id = '...'` should not need a LIKE.
    rule_id         text        NOT NULL,
    input_key       text        NOT NULL,
    watch_for       text        NOT NULL,
    prompt_version  text        NOT NULL,
    model           text        NOT NULL,

    -- NOT NULL, and not defaulted to now() by accident of insertion: a row here
    -- means the sentence passed `validate.is_publishable`. Nothing writes an
    -- unvalidated row — the quarantine path drops the sentence entirely, and
    -- the rule falls back to its authored line. A nullable column would make
    -- "validated" a property of a later UPDATE that may never come.
    validated_at    timestamptz NOT NULL,

    PRIMARY KEY (rule_id, input_key, prompt_version)
);

-- Reads are always (rule_id, input_key, prompt_version) equality — the primary
-- key index serves them, so there is no second index here on purpose.
--
-- A missing key is a NORMAL state, not an error: the page renders the authored
-- `brief_line` for that rule. That is what makes a partial corpus shippable and
-- the per-rule kill-switch free.

COMMENT ON TABLE brief_texts IS
    'Generated Building Brief sentences, one row per (rule, input shape, prompt '
    'version). Written only after passing services/briefs/validate.py. A missing '
    'row falls back to the authored brief_line in rules.yaml.';
