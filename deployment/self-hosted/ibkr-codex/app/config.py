from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path


def _secret(name: str, default: str = "") -> str:
    file_name = os.getenv(f"{name}_FILE", "")
    if file_name:
        try:
            return Path(file_name).read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            return default
    return os.getenv(name, default).strip()


@dataclass(frozen=True)
class Settings:
    app_env: str = os.getenv("APP_ENV", "development")
    pg_host: str = os.getenv("PGHOST", "127.0.0.1")
    pg_port: int = int(os.getenv("PGPORT", "5432"))
    pg_database: str = os.getenv("PGDATABASE", "ibkr_codex")
    pg_user: str = os.getenv("PGUSER", "ibkr_codex")
    pg_password: str = _secret("PGPASSWORD")
    public_base_url: str = os.getenv("PUBLIC_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
    artifact_root: Path = Path(os.getenv("ARTIFACT_ROOT", "./artifacts"))
    ibkr_host: str = os.getenv("IBKR_HOST", "127.0.0.1")
    ibkr_port: int = int(os.getenv("IBKR_PORT", "4002"))
    ibkr_client_id: int = int(os.getenv("IBKR_CLIENT_ID", "41"))
    # Delayed data is opt-in. It is appropriate only when the account owner
    # explicitly accepts the 10-15 minute price delay for paper execution.
    allow_delayed_market_data: bool = os.getenv("ALLOW_DELAYED_MARKET_DATA", "false").lower() == "true"
    # Crypto is a separate, capability-gated paper allocation. It can never
    # trade unless IBKR accepts a dedicated non-executing probe for the DU account.
    allow_crypto_paper_trading: bool = os.getenv("ALLOW_CRYPTO_PAPER_TRADING", "false").lower() == "true"
    virtual_investable_capital: str = os.getenv("VIRTUAL_INVESTABLE_CAPITAL", "20000")
    fx_fallback_max_age_days: int = int(os.getenv("FX_FALLBACK_MAX_AGE_DAYS", "4"))
    fx_fallback_cache_hours: int = int(os.getenv("FX_FALLBACK_CACHE_HOURS", "6"))
    fx_fallback_haircut_pct: str = os.getenv("FX_FALLBACK_HAIRCUT_PCT", "2")
    ibkr_paper_account: str = _secret("IBKR_PAPER_ACCOUNT")
    internal_api_token: str = _secret("INTERNAL_API_TOKEN")
    codex_runner_url: str = os.getenv("CODEX_RUNNER_URL", "http://127.0.0.1:3010/research")
    codex_model: str = os.getenv("CODEX_MODEL", "gpt-5.6-sol")
    codex_reasoning_effort: str = os.getenv("CODEX_REASONING_EFFORT", "xhigh")
    codex_timeout_seconds: int = int(os.getenv("CODEX_TIMEOUT_SECONDS", "7200"))
    news_signal_origin: str = os.getenv("NEWS_SIGNAL_ORIGIN", "").rstrip("/")
    news_signal_token: str = _secret("NEWS_SIGNAL_TOKEN")
    email_to: str = os.getenv("EMAIL_TO", "lucajeannin@icloud.com")
    email_reminder_seconds: int = int(os.getenv("EMAIL_REMINDER_SECONDS", "3600"))
    notification_url: str = os.getenv("NOTIFICATION_URL", "")
    notification_token: str = _secret("NOTIFICATION_TOKEN")
    trading_time_et: str = os.getenv("TRADING_TIME_ET", "12:45")
    retention_annual_limit_bytes: int = int(os.getenv("RETENTION_ANNUAL_LIMIT_BYTES", str(10 * 1024**3)))

    @property
    def dsn(self) -> str:
        return (
            f"host={self.pg_host} port={self.pg_port} dbname={self.pg_database} "
            f"user={self.pg_user} password={self.pg_password}"
        )

    def validate_paper_boundary(self, account_id: str | None = None) -> None:
        if self.ibkr_port != 4002:
            raise RuntimeError("Paper-only safety lock requires IB Gateway port 4002.")
        candidate = self.ibkr_paper_account if account_id is None else account_id
        if not re.fullmatch(r"DU[A-Z0-9]+", candidate):
            raise RuntimeError("The allowlisted IBKR account must be a paper account identifier beginning with DU.")
        if self.ibkr_client_id <= 0:
            raise RuntimeError("A dedicated positive IBKR client id is required.")


settings = Settings()
