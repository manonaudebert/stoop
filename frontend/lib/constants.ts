// The renter-facing complaint taxonomy is defined once, in
// ./renter-facing-groups.json, and consumed by both this file and the Python
// brief generator (api/services/briefs/taxonomy.py), which reads it by path.
//
// It lives inside the frontend root deliberately: Turbopack resolves modules
// relative to the project root and cannot import across it, so a shared file
// elsewhere in the repo would need turbopack.root AND outputFileTracingRoot —
// two deploy-affecting config changes to share a category list. Python reading
// a file by path costs nothing.
//
// Everything below is derived from that file. The exported shapes are unchanged
// from when they were literals here, so consumers need no edits.
import taxonomy from './renter-facing-groups.json'

export type RenterFacingGroup = keyof typeof taxonomy.groups

const GROUP_ENTRIES = Object.entries(taxonomy.groups) as [
  RenterFacingGroup,
  { label: string; description: string; minor_categories: string[] },
][]

export const RENTER_FACING_FILTER_GROUPS = Object.fromEntries(
  GROUP_ENTRIES.map(([group, def]) => [group, def.minor_categories]),
) as Record<RenterFacingGroup, string[]>

export const FILTER_GROUP_DESCRIPTIONS = Object.fromEntries(
  GROUP_ENTRIES.map(([group, def]) => [group, def.description]),
) as Record<RenterFacingGroup, string>

export const FILTER_GROUP_LABELS = Object.fromEntries(
  GROUP_ENTRIES.map(([group, def]) => [group, def.label]),
) as Record<RenterFacingGroup, string>

// Display order + labels, previously duplicated inline in two page files.
export const FILTER_GROUP_ORDER: { key: RenterFacingGroup; label: string }[] =
  GROUP_ENTRIES.map(([key, def]) => ({ key, label: def.label }))

// Plain-English tooltip per HPD violation category, for the "Top violation
// categories" chart. Moved out of this file and into the shared taxonomy JSON
// so the Python brief generator can read the same sentences: the brief needs a
// concrete description of a hazardous condition ("insufficient or missing
// required lighting in apartments, hallways, or common areas") rather than only
// a group label ("Electrical"), and re-authoring 48 sentences in a second place
// would guarantee the two drift.
//
// Keyed by category rather than nested under a group, because it covers
// categories that belong to no renter-facing group.
export const VIOLATION_CATEGORY_TOOLTIPS: Record<string, string> =
  taxonomy.violation_category_tooltips

// minor_category string → group key (upper-cased lookup)
export const MINOR_TO_GROUP: Record<string, RenterFacingGroup> = Object.fromEntries(
  (Object.entries(RENTER_FACING_FILTER_GROUPS) as [RenterFacingGroup, readonly string[]][])
    .flatMap(([group, minors]) => minors.map(m => [m, group]))
)
