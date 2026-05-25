export const RENTER_FACING_FILTER_GROUPS = {
  heating_hot_water: [
    "APARTMENT ONLY",
    "ENTIRE BUILDING",
    "HEAT RELATED",
    "HEAT-PLANT",
    "RADIATOR",
    "SPACE HEATER",
    "BOILER",
  ],

  water_damage_plumbing: [
    "WATER-LEAKS",
    "DAMP SPOT",
    "HEAVY FLOW",
    "SLOW LEAK",
    "SEWER",
    "SEWAGE",
    "WATER SUPPLY",
    "STEAM PIPE/RISER",
    "BASIN/SINK",
    "BATHTUB/SHOWER",
    "TOILET",
    "SHOWER-STALL",
    "ROOF",
    "ROOFING",
    "RAIN LEADER",
    "GUTTER/LEADER",
    "SKYLIGHT",
  ],

  mold_pests_sanitation: [
    "MOLD",
    "PESTS",
    "VERMIN",
    "RUBBISH",
    "GARBAGE/RECYCLING STORAGE",
    "ODOR",
    "SMOKE-FUMES",
    "UNSANITARY CONDITION",
  ],

  electrical_power: [
    "POWER OUTAGE",
    "WIRING",
    "OUTLET/SWITCH",
    "OUTLET COVER",
    "LIGHTING",
    "NO LIGHTING",
    "ELECTRIC-SUPPLY",
  ],

  safety_fire: [
    "CARBON MONOXIDE",
    "CARBON MONOXIDE DETECTOR",
    "SMOKE DETECTOR",
    "FIRE ESCAPE",
    "SPRINKLER",
    "WINDOW GUARD BROKEN/MISSING",
    "WINDOW GUARDS",
    "COOKING GAS",
    "LINE OF TRAVEL",
    "COLLAPSING BUILDING",
  ],

  elevator_accessibility: [
    "ELEVATOR",
    "MAINTENANCE",
    "STAIRS",
    "LINE OF TRAVEL",
  ],

  building_maintenance_operations: [
    "JANITOR/SUPER",
    "MAILBOX",
    "LOCKS",
    "DOOR",
    "DOORS",
    "DOOR FRAME",
    "WINDOWS",
    "WINDOW FRAME",
    "WINDOW PANE",
    "FLOOR",
    "CERAMIC-TILE",
    "CABINET",
    "MAINTENANCE",
    "CLEANING",
    "BELL-BUZZER/INTERCOM",
    "BELL/BUZZER/INTERCOM",
  ],

  appliances: [
    "AIR-CONDITIONER",
    "DISHWASHER",
    "ELECTRIC/GAS RANGE",
    "MICROWAVE",
    "REFRIGERATOR",
  ],

  outdoor_structural: [
    "PAVEMENT",
    "PORCH/BALCONY",
    "FENCING",
    "ROOF DOOR/HATCH",
    "VACANT APARTMENT",
    "FIRE-ESCAPE",
    "SKYLIGHT",
  ],

  low_priority_admin: [
    "SIGNAGE",
    "SIGNAGE MISSING",
    "SPRINKER CERT",
    "BOILER ROOM KEY",
    "STORAGE",
    "ILLEGAL",
  ],
} as const

export type RenterFacingGroup = keyof typeof RENTER_FACING_FILTER_GROUPS

// minor_category string → group key (upper-cased lookup)
export const MINOR_TO_GROUP: Record<string, RenterFacingGroup> = Object.fromEntries(
  (Object.entries(RENTER_FACING_FILTER_GROUPS) as [RenterFacingGroup, readonly string[]][])
    .flatMap(([group, minors]) => minors.map(m => [m, group]))
)
