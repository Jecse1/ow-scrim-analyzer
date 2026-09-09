from sqlalchemy import Column, String, Integer, Float, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from db.database import Base


class Session(Base):
    __tablename__ = "sessions"

    id = Column(String, primary_key=True)
    scrim_name = Column(String, nullable=False)
    date = Column(String, nullable=False)
    start_time = Column(String)
    end_time = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime, nullable=True, index=True)

    matches = relationship(
        "Match",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="Match.match_index",
    )


class Match(Base):
    __tablename__ = "matches"

    id = Column(String, primary_key=True)
    session_id = Column(String, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    match_index = Column(Integer, nullable=False)
    map_name = Column(String, nullable=False)
    team1_name = Column(String, nullable=False)
    team2_name = Column(String, nullable=False)
    winner = Column(String)
    score_t1 = Column(Integer, default=0)
    score_t2 = Column(Integer, default=0)
    result = Column(String)
    # 밀기 등 스코어 이벤트가 없는 매치의 수기 승패 보정(팀명 저장). NULL = 미보정.
    # 원본 winner 컬럼은 어떤 경로에서도 수정하지 않는다 — 원본/보정 구분 보존.
    winner_override = Column(String, nullable=True)
    video_url = Column(String)
    video_offset = Column(Integer, default=0)
    game_setup_sec = Column(Integer, nullable=True)
    duration_sec = Column(Float, default=0)
    total_final_blows_t1 = Column(Integer, default=0)
    total_final_blows_t2 = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())
    deleted_at = Column(DateTime, nullable=True, index=True)

    session = relationship("Session", back_populates="matches")
    pauses = relationship("Pause", back_populates="match", cascade="all, delete-orphan")
    rounds = relationship(
        "Round",
        back_populates="match",
        cascade="all, delete-orphan",
        order_by="Round.round_number",
    )
    player_stats = relationship(
        "PlayerStat",
        cascade="all, delete-orphan",
        foreign_keys="PlayerStat.match_id",
        viewonly=True,
    )


class Pause(Base):
    __tablename__ = "pauses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    match_id = Column(String, ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True)
    start_sec = Column(Integer, nullable=False)
    end_sec = Column(Integer, nullable=False)
    duration = Column(Integer)

    match = relationship("Match", back_populates="pauses")


class Round(Base):
    __tablename__ = "rounds"

    id = Column(Integer, primary_key=True, autoincrement=True)
    match_id = Column(String, ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True)
    round_number = Column(Integer, nullable=False)
    winner = Column(String)
    duration_sec = Column(Float, default=0)
    final_blows_t1 = Column(Integer, default=0)
    final_blows_t2 = Column(Integer, default=0)

    match = relationship("Match", back_populates="rounds")
    player_stats = relationship("PlayerStat", back_populates="round", cascade="all, delete-orphan")
    events = relationship(
        "Event",
        back_populates="round",
        cascade="all, delete-orphan",
        order_by="Event.timestamp",
    )


class PlayerStat(Base):
    __tablename__ = "player_stats"

    id = Column(Integer, primary_key=True, autoincrement=True)
    round_id = Column(Integer, ForeignKey("rounds.id", ondelete="CASCADE"), nullable=False, index=True)
    match_id = Column(String, ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True)

    team_name = Column(String, nullable=False, index=True)
    player_name = Column(String, nullable=False, index=True)
    hero_name = Column(String, nullable=False, index=True)
    hero_image = Column(String)
    slot_index = Column(Integer)

    eliminations = Column(Float, default=0)
    final_blows = Column(Float, default=0)
    deaths = Column(Float, default=0)
    all_damage_dealt = Column(Float, default=0)
    barrier_damage_dealt = Column(Float, default=0)
    hero_damage_dealt = Column(Float, default=0)
    healing_dealt = Column(Float, default=0)
    healing_received = Column(Float, default=0)
    self_healing = Column(Float, default=0)
    damage_taken = Column(Float, default=0)
    damage_blocked = Column(Float, default=0)
    defensive_assists = Column(Float, default=0)
    offensive_assists = Column(Float, default=0)
    ultimates_earned = Column(Float, default=0)
    ultimates_used = Column(Float, default=0)
    multikill_best = Column(Float, default=0)
    multikills = Column(Float, default=0)
    solo_kills = Column(Float, default=0)
    objective_kills = Column(Float, default=0)
    environmental_kills = Column(Float, default=0)
    environmental_deaths = Column(Float, default=0)
    hero_time_played = Column(Float, default=0)

    round = relationship("Round", back_populates="player_stats")


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    round_id = Column(Integer, ForeignKey("rounds.id", ondelete="CASCADE"), nullable=False, index=True)
    match_id = Column(String, ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True)

    event_type = Column(String, nullable=False, index=True)
    timestamp = Column(Float, nullable=False)
    game_timestamp = Column(Float)

    # kill, ultimate_start
    player_name = Column(String)
    player_team = Column(String)
    player_hero = Column(String)
    player_hero_img = Column(String)
    ability = Column(String)

    # kill only
    target_name = Column(String)
    target_team = Column(String)
    target_hero = Column(String)
    target_hero_img = Column(String)

    # round_start, round_end (and objective_updated/payload_progress — same as round_id's round_number)
    round_number = Column(Integer)

    # round_end, match_end
    winner = Column(String)

    # round_start
    attacker = Column(String)

    # match_start (renamed from "desc" which is a SQL reserved word)
    description = Column(String)

    # match_end
    score_t1 = Column(Integer)
    score_t2 = Column(Integer)

    # objective_captured
    capturing_team = Column(String)

    # objective_updated
    new_index = Column(Integer)
    old_index = Column(Integer)

    # payload_progress
    team = Column(String)

    # future-proofing: stores new event types or rare fields
    extra_data = Column(JSON)

    round = relationship("Round", back_populates="events")
