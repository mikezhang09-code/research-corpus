"""Tests for the --prompt-file option across prompt-based CLI commands."""

from unittest.mock import AsyncMock

import click
import pytest

from notebooklm.cli.helpers import resolve_prompt
from notebooklm.notebooklm_cli import cli
from notebooklm.rpc.types import ReportFormat
from notebooklm.types import AskResult

from .conftest import create_mock_client, patch_client_for_module


def make_ask_result(answer: str = "The answer is 42.") -> AskResult:
    return AskResult(
        answer=answer,
        conversation_id="a1b2c3d4-0000-0000-0000-000000000001",
        turn_number=1,
        is_follow_up=False,
        references=[],
        raw_response="",
    )


class TestResolvePrompt:
    def test_uses_argument_when_prompt_file_missing(self):
        assert resolve_prompt("hello", None, "question") == "hello"

    def test_reads_prompt_file_and_strips_trailing_whitespace(self, tmp_path):
        prompt_file = tmp_path / "prompt.txt"
        prompt_file.write_text("hello from file\n\n", encoding="utf-8")

        assert resolve_prompt("", str(prompt_file), "question") == "hello from file"

    def test_rejects_argument_and_prompt_file_together(self, tmp_path):
        prompt_file = tmp_path / "prompt.txt"
        prompt_file.write_text("hello from file", encoding="utf-8")

        with pytest.raises(click.UsageError, match="question argument and --prompt-file"):
            resolve_prompt("hello", str(prompt_file), "question")


class TestAskPromptFile:
    def test_ask_accepts_prompt_file(self, runner, mock_auth, mock_fetch_tokens, tmp_path):
        prompt_file = tmp_path / "question.txt"
        prompt_file.write_text("What is 42?", encoding="utf-8")

        with patch_client_for_module("chat") as mock_client_cls:
            mock_client = create_mock_client()
            mock_client.chat.ask = AsyncMock(return_value=make_ask_result())
            mock_client.chat.get_conversation_id = AsyncMock(return_value=None)
            mock_client_cls.return_value = mock_client

            result = runner.invoke(cli, ["ask", "--prompt-file", str(prompt_file), "-n", "nb_123"])

        assert result.exit_code == 0, result.output
        call_args = mock_client.chat.ask.await_args
        assert call_args.args[1] == "What is 42?"

    def test_ask_requires_argument_or_prompt_file(self, runner, mock_auth, mock_fetch_tokens):
        result = runner.invoke(cli, ["ask", "-n", "nb_123"])

        assert result.exit_code != 0
        assert "Provide a question argument or --prompt-file." in result.output


class TestGeneratePromptFile:
    def test_generate_report_prompt_file_infers_custom(
        self, runner, mock_auth, mock_fetch_tokens, tmp_path
    ):
        prompt_file = tmp_path / "report.txt"
        prompt_file.write_text("Create a white paper about AI trends", encoding="utf-8")

        with patch_client_for_module("generate") as mock_client_cls:
            mock_client = create_mock_client()
            mock_client.artifacts.generate_report = AsyncMock(
                return_value={"artifact_id": "report_123", "status": "processing"}
            )
            mock_client_cls.return_value = mock_client

            result = runner.invoke(
                cli, ["generate", "report", "--prompt-file", str(prompt_file), "-n", "nb_123"]
            )

        assert result.exit_code == 0, result.output
        call_kwargs = mock_client.artifacts.generate_report.call_args.kwargs
        assert call_kwargs["report_format"] == ReportFormat.CUSTOM
        assert call_kwargs["custom_prompt"] == "Create a white paper about AI trends"

    def test_generate_data_table_accepts_prompt_file(
        self, runner, mock_auth, mock_fetch_tokens, tmp_path
    ):
        prompt_file = tmp_path / "table.txt"
        prompt_file.write_text("Compare key concepts", encoding="utf-8")

        with patch_client_for_module("generate") as mock_client_cls:
            mock_client = create_mock_client()
            mock_client.artifacts.generate_data_table = AsyncMock(
                return_value={"artifact_id": "table_123", "status": "processing"}
            )
            mock_client_cls.return_value = mock_client

            result = runner.invoke(
                cli,
                ["generate", "data-table", "--prompt-file", str(prompt_file), "-n", "nb_123"],
            )

        assert result.exit_code == 0, result.output
        call_kwargs = mock_client.artifacts.generate_data_table.call_args.kwargs
        assert call_kwargs["instructions"] == "Compare key concepts"


class TestSourceAddResearchPromptFile:
    def test_add_research_accepts_prompt_file(self, runner, mock_auth, mock_fetch_tokens, tmp_path):
        prompt_file = tmp_path / "research.txt"
        prompt_file.write_text("AI papers", encoding="utf-8")

        with patch_client_for_module("source") as mock_client_cls:
            mock_client = create_mock_client()
            mock_client.research.start = AsyncMock(return_value={"task_id": "task_123"})
            mock_client_cls.return_value = mock_client

            result = runner.invoke(
                cli,
                [
                    "source",
                    "add-research",
                    "--prompt-file",
                    str(prompt_file),
                    "--no-wait",
                    "-n",
                    "nb_123",
                ],
            )

        assert result.exit_code == 0, result.output
        mock_client.research.start.assert_awaited_once_with("nb_123", "AI papers", "web", "fast")
