"""Point queries use independent sources and return partial results explicitly."""

from fastapi import APIRouter

from app.schemas.points import PointQuery, PointResponse
from app.services import point_service

router = APIRouter(prefix="/api/points")


@router.post("/query", response_model=PointResponse)
def query(body: PointQuery) -> PointResponse:
    return point_service.run(body)
