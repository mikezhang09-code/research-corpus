"""NotebookLM tool plugin.

Wraps NotebookLM's artifact generation capabilities.
"""

from typing import TYPE_CHECKING, Any

from ...registry import BaseToolPlugin, PluginType

if TYPE_CHECKING:
    from ....client import NotebookLMClient
    from ...context import PipelineContext


class NotebookLMToolPlugin(BaseToolPlugin):
    """Plugin for NotebookLM artifact generation.

    Generates various artifacts from notebook sources:
    - Audio overviews (podcasts)
    - Video overviews
    - Reports (study guides, briefing docs, blog posts)
    - Quizzes and flashcards
    - Mind maps
    - Infographics
    - Slide decks

    Config:
        artifacts: List of artifact configurations
        questions: Optional questions to ask
        wait_for_completion: Whether to wait for artifacts (default: false)

    Example:
        type: tool:notebooklm
        config:
          artifacts:
            - type: audio
              format: deep-dive
              length: medium
            - type: report
              format: study-guide
          questions:
            - "What are the key insights?"
    """

    name = "notebooklm"
    plugin_type = PluginType.TOOL

    def get_config_schema(self) -> dict[str, Any]:
        """Return JSON schema for plugin configuration."""
        return {
            "type": "object",
            "properties": {
                "artifacts": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "type": {
                                "type": "string",
                                "enum": [
                                    "audio",
                                    "video",
                                    "report",
                                    "quiz",
                                    "flashcards",
                                    "mind_map",
                                    "infographic",
                                    "slide_deck",
                                ],
                            },
                            "format": {"type": "string"},
                            "length": {"type": "string"},
                            "difficulty": {"type": "string"},
                            "quantity": {"type": "string"},
                        },
                        "required": ["type"],
                    },
                },
                "questions": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "wait_for_completion": {
                    "type": "boolean",
                    "default": False,
                },
            },
        }

    async def execute(
        self,
        ctx: "PipelineContext",
        client: "NotebookLMClient",
        config: dict[str, Any],
    ) -> dict[str, Any]:
        """Generate artifacts and optionally ask questions.

        Args:
            ctx: Pipeline context with notebook_id and source_ids
            client: NotebookLM client
            config: Plugin configuration

        Returns:
            Dictionary with generated artifact IDs and Q&A results
        """
        from ....types import (
            AudioFormat,
            AudioLength,
            QuizDifficulty,
            QuizQuantity,
            ReportFormat,
        )

        if not ctx.notebook_id:
            raise ValueError("No notebook ID in context")

        artifacts_config = config.get("artifacts", [])
        questions = config.get("questions", [])
        wait = config.get("wait_for_completion", False)

        generated = []
        qa_results = []
        source_ids = ctx.source_ids if ctx.source_ids else None

        # Generate each artifact
        for art_cfg in artifacts_config:
            art_type = art_cfg.get("type", "")

            if art_type == "audio":
                fmt = art_cfg.get("format", "deep-dive")
                # AudioFormat: DEEP_DIVE=1, BRIEF=2, CRITIQUE=3, DEBATE=4
                format_map = {
                    "deep-dive": AudioFormat.DEEP_DIVE,
                    "brief": AudioFormat.BRIEF,
                    "critique": AudioFormat.CRITIQUE,
                    "debate": AudioFormat.DEBATE,
                }
                audio_format = format_map.get(fmt, AudioFormat.DEEP_DIVE)
                length_map = {
                    "short": AudioLength.SHORT,
                    "medium": AudioLength.DEFAULT,
                    "long": AudioLength.LONG,
                }
                audio_length = length_map.get(art_cfg.get("length", "medium"), AudioLength.DEFAULT)

                status = await client.artifacts.generate_audio(
                    ctx.notebook_id,
                    source_ids=source_ids,
                    audio_format=audio_format,
                    audio_length=audio_length,
                )
                ctx.artifact_ids.append(status.task_id)
                generated.append({"type": "audio", "task_id": status.task_id})

            elif art_type == "video":
                status = await client.artifacts.generate_video(
                    ctx.notebook_id, source_ids=source_ids
                )
                ctx.artifact_ids.append(status.task_id)
                generated.append({"type": "video", "task_id": status.task_id})

            elif art_type == "report":
                fmt = art_cfg.get("format", "study-guide")
                report_format_map: dict[str, ReportFormat] = {
                    "study-guide": ReportFormat.STUDY_GUIDE,
                    "briefing-doc": ReportFormat.BRIEFING_DOC,
                    "blog-post": ReportFormat.BLOG_POST,
                }
                report_format = report_format_map.get(fmt, ReportFormat.STUDY_GUIDE)

                status = await client.artifacts.generate_report(
                    ctx.notebook_id,
                    report_format=report_format,
                    source_ids=source_ids,
                )
                ctx.artifact_ids.append(status.task_id)
                generated.append({"type": "report", "format": fmt, "task_id": status.task_id})

            elif art_type == "quiz":
                difficulty_map = {
                    "easy": QuizDifficulty.EASY,
                    "medium": QuizDifficulty.MEDIUM,
                    "hard": QuizDifficulty.HARD,
                }
                quantity_map = {
                    "fewer": QuizQuantity.FEWER,
                    "standard": QuizQuantity.STANDARD,
                }

                status = await client.artifacts.generate_quiz(
                    ctx.notebook_id,
                    source_ids=source_ids,
                    difficulty=difficulty_map.get(
                        art_cfg.get("difficulty", "medium"), QuizDifficulty.MEDIUM
                    ),
                    quantity=quantity_map.get(
                        art_cfg.get("quantity", "standard"), QuizQuantity.STANDARD
                    ),
                )
                ctx.artifact_ids.append(status.task_id)
                generated.append({"type": "quiz", "task_id": status.task_id})

            elif art_type == "flashcards":
                difficulty_map = {
                    "easy": QuizDifficulty.EASY,
                    "medium": QuizDifficulty.MEDIUM,
                    "hard": QuizDifficulty.HARD,
                }
                quantity_map = {
                    "fewer": QuizQuantity.FEWER,
                    "standard": QuizQuantity.STANDARD,
                }

                status = await client.artifacts.generate_flashcards(
                    ctx.notebook_id,
                    source_ids=source_ids,
                    difficulty=difficulty_map.get(
                        art_cfg.get("difficulty", "medium"), QuizDifficulty.MEDIUM
                    ),
                    quantity=quantity_map.get(
                        art_cfg.get("quantity", "standard"), QuizQuantity.STANDARD
                    ),
                )
                ctx.artifact_ids.append(status.task_id)
                generated.append({"type": "flashcards", "task_id": status.task_id})

            elif art_type == "mind_map":
                # generate_mind_map returns dict, not GenerationStatus
                mind_map_result = await client.artifacts.generate_mind_map(
                    ctx.notebook_id, source_ids=source_ids
                )
                if isinstance(mind_map_result, dict) and mind_map_result.get("mind_map_id"):
                    ctx.artifact_ids.append(mind_map_result["mind_map_id"])
                    generated.append({"type": "mind_map", "id": mind_map_result["mind_map_id"]})

            elif art_type == "infographic":
                status = await client.artifacts.generate_infographic(
                    ctx.notebook_id, source_ids=source_ids
                )
                ctx.artifact_ids.append(status.task_id)
                generated.append({"type": "infographic", "task_id": status.task_id})

            elif art_type == "slide_deck":
                status = await client.artifacts.generate_slide_deck(
                    ctx.notebook_id, source_ids=source_ids
                )
                ctx.artifact_ids.append(status.task_id)
                generated.append({"type": "slide_deck", "task_id": status.task_id})

        # Wait for completion if requested
        if wait and ctx.artifact_ids:
            for artifact_id in ctx.artifact_ids:
                await client.artifacts.wait_for_completion(
                    ctx.notebook_id, artifact_id, timeout=600.0
                )

        # Ask questions
        for question in questions:
            result = await client.chat.ask(ctx.notebook_id, question)
            qa_results.append({"question": question, "answer": result.answer})
            ctx.qa_results.append({"question": question, "answer": result.answer})

        return {
            "artifacts_generated": len(generated),
            "artifacts": generated,
            "questions_answered": len(qa_results),
            "qa_results": qa_results,
        }
