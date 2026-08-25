from typing import Annotated

from fastapi import HTTPException, Query


Longitude = Annotated[
    float,
    Query(ge=-180, le=180, allow_inf_nan=False),
]
Latitude = Annotated[
    float,
    Query(ge=-90, le=90, allow_inf_nan=False),
]


def validate_bbox_order(
    *,
    west: float,
    south: float,
    east: float,
    north: float,
) -> None:
    if west >= east:
        raise HTTPException(status_code=422, detail="west must be less than east")
    if south >= north:
        raise HTTPException(status_code=422, detail="south must be less than north")
