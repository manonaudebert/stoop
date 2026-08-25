import pytest


MAP_ROUTES = [
    "/map/clusters",
    "/map/unified/clusters",
    "/hpd/map/clusters",
    "/hpd-complaints/map/clusters",
    "/sf/map/clusters",
]

VALID_BBOX = {
    "west": -74.02,
    "south": 40.70,
    "east": -73.98,
    "north": 40.73,
    "zoom": 15,
}


@pytest.mark.parametrize("route", MAP_ROUTES)
@pytest.mark.parametrize(
    ("coordinates", "detail"),
    [
        ({"west": -73.98, "east": -74.02}, "west must be less than east"),
        ({"south": 40.73, "north": 40.70}, "south must be less than north"),
        ({"west": -74.02, "east": -74.02}, "west must be less than east"),
        ({"south": 40.70, "north": 40.70}, "south must be less than north"),
    ],
)
async def test_map_routes_reject_unordered_bbox(client, route, coordinates, detail):
    response = await client.get(route, params={**VALID_BBOX, **coordinates})

    assert response.status_code == 422
    assert response.json() == {"detail": detail}


@pytest.mark.parametrize("route", MAP_ROUTES)
@pytest.mark.parametrize(
    ("coordinate", "value"),
    [
        ("west", -181),
        ("east", 181),
        ("south", -91),
        ("north", 91),
        ("west", "NaN"),
    ],
)
async def test_map_routes_reject_invalid_coordinate(client, route, coordinate, value):
    response = await client.get(route, params={**VALID_BBOX, coordinate: value})

    assert response.status_code == 422
