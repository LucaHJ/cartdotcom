import pytest

from app.policy import PolicyViolation, validate_decision_shape


def crypto_decision() -> dict:
    return {
        "symbol": "BTC",
        "asset_type": "CRYPTO",
        "action": "BUY",
        "target_weight_pct": "5",
        "confidence": 0.8,
        "thesis": "test",
        "citations": ["https://www.sec.gov/"],
    }


def test_crypto_is_prohibited() -> None:
    with pytest.raises(PolicyViolation, match="Crypto"):
        validate_decision_shape(crypto_decision())
