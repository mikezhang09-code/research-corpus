import pytest
from unittest.mock import AsyncMock


class RPCMethod:
    SUMMARIZE = "SUMMARIZE"


class SuggestedTopic:
    def __init__(self, question: str, prompt: str):
        self.question = question
        self.prompt = prompt


class NotebookDescription:
    def __init__(self, summary: str, suggested_topics: list[SuggestedTopic]):
        self.summary = summary
        self.suggested_topics = suggested_topics


class NotebookClient:
    def __init__(self, core):
        self._core = core

    async def get_summary(self, notebook_id: str) -> str:
        params = [notebook_id, [2]]
        result = await self._core.rpc_call(
            RPCMethod.SUMMARIZE,
            params,
            source_path=f"/notebook/{notebook_id}",
        )
        if result and isinstance(result, list) and len(result) > 0:
            try:
                # result[0][0][0] is the summary string
                return str(result[0][0][0])
            except (IndexError, TypeError):
                return str(result[0]) if result[0] else ""
        return ""

    async def get_description(self, notebook_id: str) -> NotebookDescription:
        params = [notebook_id, [2]]
        result = await self._core.rpc_call(
            RPCMethod.SUMMARIZE,
            params,
            source_path=f"/notebook/{notebook_id}",
        )

        summary = ""
        suggested_topics: list[SuggestedTopic] = []

        if result and isinstance(result, list):
            if len(result) > 0 and isinstance(result[0], list) and len(result[0]) > 0:
                try:
                    _block = result[0][0]
                    summary = (
                        _block[0]
                        if isinstance(_block, list) and _block and isinstance(_block[0], str)
                        else (result[0][0] if isinstance(result[0][0], str) else "")
                    )
                except (IndexError, TypeError):
                    summary = ""

            try:
                topics_list = result[0][1][0]
                if isinstance(topics_list, list):
                    for topic in topics_list:
                        if isinstance(topic, list) and len(topic) >= 2:
                            suggested_topics.append(
                                SuggestedTopic(
                                    question=str(topic[0]) if topic[0] else "",
                                    prompt=str(topic[1]) if topic[1] else "",
                                )
                            )
            except (IndexError, TypeError):
                pass

        return NotebookDescription(summary=summary, suggested_topics=suggested_topics)


@pytest.mark.asyncio
async def test_get_summary_returns_str_result_0_0_0():
    core = type("Core", (), {})()
    core.rpc_call = AsyncMock(return_value=[[["Notebook summary text"]]])
    client = NotebookClient(core)

    result = await client.get_summary("nb_123")

    assert result == "Notebook summary text"
    core.rpc_call.assert_awaited_once_with(
        RPCMethod.SUMMARIZE,
        ["nb_123", [2]],
        source_path="/notebook/nb_123",
    )


@pytest.mark.asyncio
async def test_get_description_returns_summary_from_result_0_0_0():
    core = type("Core", (), {})()
    core.rpc_call = AsyncMock(return_value=[[["Parsed summary"]]])
    client = NotebookClient(core)

    desc = await client.get_description("nb_456")

    assert desc.summary == "Parsed summary"
    assert desc.suggested_topics == []
    core.rpc_call.assert_awaited_once_with(
        RPCMethod.SUMMARIZE,
        ["nb_456", [2]],
        source_path="/notebook/nb_456",
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload, expected_summary, expected_desc_summary",
    [
        (None, "", ""),
        ([], "", ""),
        ([[]], "", ""),
        ([[None]], "None", ""),
    ],
)
async def test_edge_cases_empty_malformed_result(payload, expected_summary, expected_desc_summary):
    core = type("Core", (), {})()
    core.rpc_call = AsyncMock(return_value=payload)
    client = NotebookClient(core)

    summary = await client.get_summary("nb_edge")
    desc = await client.get_description("nb_edge")

    assert summary == expected_summary
    assert desc.summary == expected_desc_summary
    assert isinstance(desc.suggested_topics, list)
