# 밴픽 실시간 대결 모듈 (WebSocket, 서버 권위). 기존 분석기 API/집계/DB와 분리·격리.
from .rooms import router

__all__ = ["router"]
