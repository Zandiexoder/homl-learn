"""Process-level configuration, read once from the environment."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Config:
    data_dir: Path
    secret_key: str
    app_password: str | None
    renderer_url: str
    static_dir: Path | None
    cookie_secure: bool

    @property
    def db_path(self) -> Path:
        return self.data_dir / "homl.sqlite3"

    @property
    def files_dir(self) -> Path:
        return self.data_dir / "files"


def _load_secret(data_dir: Path) -> str:
    """Use SECRET_KEY if given, otherwise create one under /data and keep it."""
    env = os.environ.get("SECRET_KEY")
    if env:
        return env
    path = data_dir / ".secret_key"
    if path.exists():
        return path.read_text().strip()
    key = os.urandom(32).hex()
    path.write_text(key)
    path.chmod(0o600)
    return key


def load_config() -> Config:
    data_dir = Path(os.environ.get("DATA_DIR", "./data")).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "files").mkdir(exist_ok=True)
    static = os.environ.get("STATIC_DIR")
    return Config(
        data_dir=data_dir,
        secret_key=_load_secret(data_dir),
        app_password=os.environ.get("APP_PASSWORD") or None,
        renderer_url=os.environ.get("RENDERER_URL", "http://renderer:3100"),
        static_dir=Path(static) if static else None,
        cookie_secure=os.environ.get("COOKIE_SECURE", "false").lower() == "true",
    )


_config: Config | None = None


def get_config() -> Config:
    global _config
    if _config is None:
        _config = load_config()
    return _config


def set_config(config: Config) -> None:
    """Used by tests to point the app at a temporary data directory."""
    global _config
    _config = config
