from unittest.mock import AsyncMock, patch

import pytest
from portal.backend.ai import ai_chat, strip_reasoning
from portal.backend.config import Settings


def test_strip_reasoning():
    # Test stripping thinking tags
    text = "<think>some thinking</think>final answer"

    class Block:
        def __init__(self, type_str, text_str):
            self.type = type_str
            self.text = text_str

    assert strip_reasoning([Block("text", text)]) == "final answer"


@pytest.mark.asyncio
async def test_ai_chat_mimo_success():
    settings = Settings(
        supabase_url="https://test.supabase.co",
        supabase_anon_key="test-anon-key",
        supabase_service_role_key="test-service-key",
        r2_account_id="test-account-id",
        r2_access_key_id="test-access-key",
        r2_secret_access_key="test-secret-key",
        r2_endpoint_url="https://test.r2.cloudflare.com",
        anthropic_api_key="mimo_key",
        gemini_api_key="gemini_key",
    )

    with (
        patch("portal.backend.ai._call_mimo", new_callable=AsyncMock) as mock_mimo,
        patch("portal.backend.ai._call_gemini", new_callable=AsyncMock) as mock_gemini,
    ):
        mock_mimo.return_value = "mimo response"

        res = await ai_chat("system", [{"role": "user", "content": "hi"}], settings)

        assert res == "mimo response"
        mock_mimo.assert_called_once()
        mock_gemini.assert_not_called()


@pytest.mark.asyncio
async def test_ai_chat_mimo_fails_gemini_success():
    settings = Settings(
        supabase_url="https://test.supabase.co",
        supabase_anon_key="test-anon-key",
        supabase_service_role_key="test-service-key",
        r2_account_id="test-account-id",
        r2_access_key_id="test-access-key",
        r2_secret_access_key="test-secret-key",
        r2_endpoint_url="https://test.r2.cloudflare.com",
        anthropic_api_key="mimo_key",
        gemini_api_key="gemini_key",
    )

    with (
        patch("portal.backend.ai._call_mimo", new_callable=AsyncMock) as mock_mimo,
        patch("portal.backend.ai._call_gemini", new_callable=AsyncMock) as mock_gemini,
    ):
        mock_mimo.side_effect = Exception("MiMo is down")
        mock_gemini.return_value = "gemini response"

        res = await ai_chat("system", [{"role": "user", "content": "hi"}], settings)

        assert res == "gemini response"
        mock_mimo.assert_called_once()
        mock_gemini.assert_called_once()


@pytest.mark.asyncio
async def test_ai_chat_both_fail():
    settings = Settings(
        supabase_url="https://test.supabase.co",
        supabase_anon_key="test-anon-key",
        supabase_service_role_key="test-service-key",
        r2_account_id="test-account-id",
        r2_access_key_id="test-access-key",
        r2_secret_access_key="test-secret-key",
        r2_endpoint_url="https://test.r2.cloudflare.com",
        anthropic_api_key="mimo_key",
        gemini_api_key="gemini_key",
    )

    with (
        patch("portal.backend.ai._call_mimo", new_callable=AsyncMock) as mock_mimo,
        patch("portal.backend.ai._call_gemini", new_callable=AsyncMock) as mock_gemini,
    ):
        mock_mimo.side_effect = Exception("MiMo is down")
        mock_gemini.side_effect = Exception("Gemini is down")

        with pytest.raises(RuntimeError, match="All AI providers failed"):
            await ai_chat("system", [{"role": "user", "content": "hi"}], settings)
