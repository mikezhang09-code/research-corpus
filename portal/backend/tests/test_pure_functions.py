"""Phase 1 — pure-function unit tests (no I/O, minimal mocking)."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from portal.backend.ai import strip_reasoning
from portal.backend.routers.library_notebooks import _extract_json_object
from portal.backend.routers.notebooks import _FORMAT_MAP, _nlm_lang
from portal.backend.storage import (
    r2_key_for_artifact,
    r2_key_for_drive,
    r2_key_for_upload,
)
from portal.backend.tasks.downloader import _download_by_type, _mime_for_format
from portal.backend.tests.conftest import FakeArtifacts


# ---------------------------------------------------------------------------
# downloader._download_by_type  — regression guard for the artifact-id fix
# ---------------------------------------------------------------------------


class _Client:
    def __init__(self, artifacts):
        self.artifacts = artifacts


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "artifact_type, fmt, method, expect_format",
    [
        ("audio", "mp3", "download_audio", None),
        ("video", "mp4", "download_video", None),
        ("report", "md", "download_report", None),
        ("quiz", "json", "download_quiz", "json"),
        ("flashcards", "json", "download_flashcards", "json"),
        ("infographic", "png", "download_infographic", None),
        ("slide_deck", "pdf", "download_slide_deck", "pdf"),
        ("data_table", "csv", "download_data_table", None),
        ("mind_map", "json", "download_mind_map", None),
    ],
)
async def test_download_by_type_pins_artifact_id(
    tmp_path, artifact_type, fmt, method, expect_format
):
    """Every type must forward artifact_id (the bug fixed in #1) and the format."""
    artifacts = FakeArtifacts()
    client = _Client(artifacts)
    out = tmp_path / f"out.{fmt}"

    await _download_by_type(client, "nb-1", artifact_type, fmt, str(out), "nlm-xyz")

    assert len(artifacts.calls) == 1
    name, notebook_id, out_path, artifact_id, output_format = artifacts.calls[0]
    assert name == method
    assert notebook_id == "nb-1"
    assert out_path == str(out)
    assert artifact_id == "nlm-xyz"  # the pin
    assert output_format == expect_format


@pytest.mark.asyncio
async def test_download_by_type_unknown_raises(tmp_path):
    client = _Client(FakeArtifacts())
    with pytest.raises(ValueError, match="Unknown artifact type"):
        await _download_by_type(client, "nb", "bogus", "bin", str(tmp_path / "x"), "id")


# ---------------------------------------------------------------------------
# downloader._mime_for_format
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "fmt, mime",
    [
        ("mp4", "video/mp4"),
        ("mp3", "audio/mpeg"),
        ("md", "text/markdown"),
        ("pdf", "application/pdf"),
        ("json", "application/json"),
        ("png", "image/png"),
        ("csv", "text/csv"),
        ("html", "text/html"),
    ],
)
def test_mime_for_format_known(fmt, mime):
    assert _mime_for_format(fmt) == mime


def test_mime_for_format_fallback():
    assert _mime_for_format("xyz") == "application/octet-stream"


# ---------------------------------------------------------------------------
# storage R2 key builders — stable key shapes (changes orphan R2 objects)
# ---------------------------------------------------------------------------


def test_r2_key_for_artifact():
    assert r2_key_for_artifact("nb1", "audio", "a1", "mp3") == "notebooklm/nb1/audio/a1.mp3"


def test_r2_key_for_upload():
    assert r2_key_for_upload("item1", "my file.pdf") == "library/uploads/item1/my file.pdf"


def test_r2_key_for_drive():
    assert r2_key_for_drive("item1", "drive9", "docx") == "library/drive/item1/drive9.docx"


# ---------------------------------------------------------------------------
# ai.strip_reasoning — MiMo reasoning cleanup
# ---------------------------------------------------------------------------


def _text_block(text):
    return SimpleNamespace(type="text", text=text)


def _thinking_block(text):
    return SimpleNamespace(type="thinking", text=text)


def test_strip_reasoning_plain_text():
    assert strip_reasoning([_text_block("Hello world")]) == "Hello world"


def test_strip_reasoning_drops_thinking_blocks():
    blocks = [_thinking_block("secret chain of thought"), _text_block("Final answer")]
    assert strip_reasoning(blocks) == "Final answer"


def test_strip_reasoning_strips_inline_think_tags():
    blocks = [_text_block("<think>pondering...</think>The answer is 42")]
    assert strip_reasoning(blocks) == "The answer is 42"


def test_strip_reasoning_multiple_wrappers():
    blocks = [_text_block("<think>one</think>Middle.<thinking>two</thinking>End.")]
    assert strip_reasoning(blocks) == "Middle.End."


def test_strip_reasoning_unclosed_tag_truncated():
    # max_tokens cut off the response mid-thought: drop everything from the open tag.
    blocks = [_text_block("Visible.<think>unterminated reasoning that never closes")]
    assert strip_reasoning(blocks) == "Visible."


def test_strip_reasoning_orphan_closing_tag():
    blocks = [_text_block("Clean answer</thinking>")]
    assert strip_reasoning(blocks) == "Clean answer"


def test_strip_reasoning_redacted_thinking_block_skipped():
    blocks = [
        SimpleNamespace(type="redacted_thinking", text="xxx"),
        _text_block("Answer"),
    ]
    assert strip_reasoning(blocks) == "Answer"


# ---------------------------------------------------------------------------
# notebooks router pure helpers
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "code, expected",
    [
        (None, "en"),
        ("", "en"),
        ("en", "en"),
        ("zh", "zh_Hans"),
        ("zh-TW", "zh_Hant"),
        ("pt", "pt_BR"),
        ("ar", "ar_001"),
        ("ja", "ja"),  # unmapped passes through unchanged
        ("fr", "fr"),
    ],
)
def test_nlm_lang(code, expected):
    assert _nlm_lang(code) == expected


def test_format_map_covers_every_generate_type():
    # Guards against a new generate branch landing without a download format.
    expected = {
        "audio",
        "video",
        "report",
        "quiz",
        "flashcards",
        "infographic",
        "slide_deck",
        "data_table",
        "mind_map",
    }
    assert set(_FORMAT_MAP) == expected


# ---------------------------------------------------------------------------
# library_notebooks generate helpers
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        '{"title": "T", "name": "R"}',
        '```json\n{"title": "T", "name": "R"}\n```',
        # Trailing commentary containing a "}" — regression for the mindmap
        # 502 ("Extra data: line 1 column N") from first-{ .. last-} slicing.
        '{"title": "T", "name": "R"} Note: I kept it to {3} branches.',
        # Leading prose containing braces before the real object.
        'Here is the map {as requested}: {"title": "T", "name": "R"} done',
    ],
)
def test_extract_json_object_tolerates_surrounding_text(text):
    assert _extract_json_object(text) == {"title": "T", "name": "R"}


def test_extract_json_object_first_object_wins():
    assert _extract_json_object('{"a": 1} {"b": 2}') == {"a": 1}


@pytest.mark.parametrize("text", ["no json here }", "[1, 2, 3]", ""])
def test_extract_json_object_rejects_non_objects(text):
    with pytest.raises(ValueError, match="no JSON object"):
        _extract_json_object(text)
