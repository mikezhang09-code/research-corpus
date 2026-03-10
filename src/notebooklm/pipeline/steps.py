"""Built-in pipeline steps.

These steps handle common operations in research pipelines:
- create_notebook: Create a new NotebookLM notebook
- ingest: Add sources to a notebook
- wait_sources: Wait for sources to finish processing
- synthesize: Generate artifacts (audio, reports, etc.)
- wait_artifacts: Wait for artifacts to complete
- ask: Ask questions to the notebook
- export: Export artifacts to files
"""

from abc import ABC, abstractmethod
from datetime import datetime
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

from .context import PipelineContext, StepResult

if TYPE_CHECKING:
    from ..client import NotebookLMClient


@runtime_checkable
class PipelineStep(Protocol):
    """Protocol for pipeline steps.

    Steps are the building blocks of pipelines. Each step:
    - Has a unique name
    - Receives context and client
    - Returns a StepResult
    """

    name: str

    async def execute(
        self,
        ctx: PipelineContext,
        client: "NotebookLMClient",
        config: dict[str, Any],
    ) -> StepResult:
        """Execute the step.

        Args:
            ctx: Pipeline context with shared state
            client: NotebookLM client for API calls
            config: Step-specific configuration

        Returns:
            StepResult with success/failure and output
        """
        ...


class BaseStep(ABC):
    """Base class for built-in steps."""

    name: str = "base"

    @abstractmethod
    async def execute(
        self,
        ctx: PipelineContext,
        client: "NotebookLMClient",
        config: dict[str, Any],
    ) -> StepResult:
        """Execute the step."""
        pass

    def _start_result(self, step_name: str) -> StepResult:
        """Create a StepResult with start time."""
        return StepResult(
            step_name=step_name,
            success=False,
            started_at=datetime.now(),
        )

    def _complete_result(
        self,
        result: StepResult,
        success: bool,
        output: Any = None,
        error: str | None = None,
    ) -> StepResult:
        """Complete a StepResult."""
        result.success = success
        result.output = output
        result.error = error
        result.completed_at = datetime.now()
        return result


class CreateNotebookStep(BaseStep):
    """Create a new NotebookLM notebook.

    Config:
        title: Notebook title (supports variable substitution)
    """

    name = "create_notebook"

    async def execute(
        self,
        ctx: PipelineContext,
        client: "NotebookLMClient",
        config: dict[str, Any],
    ) -> StepResult:
        result = self._start_result(self.name)

        title = config.get("title", ctx.pipeline_name or "Pipeline Notebook")

        try:
            notebook = await client.notebooks.create(title)
            ctx.notebook_id = notebook.id
            ctx.notebook_title = notebook.title
            ctx.notebook_url = f"https://notebooklm.google.com/notebook/{notebook.id}"

            return self._complete_result(
                result,
                success=True,
                output={
                    "notebook_id": notebook.id,
                    "title": notebook.title,
                    "url": ctx.notebook_url,
                },
            )
        except Exception as e:
            ctx.add_error(self.name, str(e), e)
            return self._complete_result(result, success=False, error=str(e))


class IngestStep(BaseStep):
    """Add sources to a notebook.

    Config:
        sources: List of source configurations, each with:
            - plugin: Source plugin name (e.g., "source:youtube", "source:url")
            - Plus plugin-specific config (url, query, etc.)
    """

    name = "ingest"

    async def execute(
        self,
        ctx: PipelineContext,
        client: "NotebookLMClient",
        config: dict[str, Any],
    ) -> StepResult:
        result = self._start_result(self.name)

        if not ctx.notebook_id:
            return self._complete_result(result, success=False, error="No notebook ID in context")

        sources_config = config.get("sources", [])
        added_sources = []
        errors = []

        for source_cfg in sources_config:
            plugin_type = source_cfg.get("plugin", "")

            try:
                # Handle different source types
                if plugin_type in ("source:url", "source:web_url"):
                    url = source_cfg.get("url")
                    if url:
                        source = await client.sources.add_url(ctx.notebook_id, url)
                        ctx.source_ids.append(source.id)
                        added_sources.append({"id": source.id, "type": "url", "url": url})

                elif plugin_type == "source:youtube":
                    url = source_cfg.get("url")
                    if url:
                        source = await client.sources.add_url(ctx.notebook_id, url)
                        ctx.source_ids.append(source.id)
                        added_sources.append({"id": source.id, "type": "youtube", "url": url})

                elif plugin_type == "source:text":
                    text = source_cfg.get("text", "")
                    title = source_cfg.get("title", "Pasted Text")
                    if text:
                        # add_text signature: (notebook_id, title, content)
                        source = await client.sources.add_text(ctx.notebook_id, title, text)
                        ctx.source_ids.append(source.id)
                        added_sources.append({"id": source.id, "type": "text", "title": title})

                elif plugin_type == "source:research":
                    query = source_cfg.get("query")
                    if query:
                        # Use research API - requires notebook_id
                        research_result = await client.research.start(ctx.notebook_id, query)
                        # Poll for results and import sources
                        if research_result:
                            poll_result = await client.research.poll(ctx.notebook_id)
                            sources = poll_result.get("sources", [])
                            if sources:
                                task_id = research_result.get("task_id", "")
                                imported = await client.research.import_sources(
                                    ctx.notebook_id,
                                    task_id,
                                    sources,
                                )
                                # imported is list of dicts with 'id' and 'title'
                                imported_ids = [s.get("id", "") for s in imported if s.get("id")]
                                ctx.source_ids.extend(imported_ids)
                                added_sources.append(
                                    {
                                        "type": "research",
                                        "query": query,
                                        "imported_count": len(imported_ids),
                                    }
                                )

                elif plugin_type == "source:urls":
                    # Batch add multiple URLs
                    urls = source_cfg.get("urls", [])
                    for url in urls:
                        try:
                            source = await client.sources.add_url(ctx.notebook_id, url)
                            ctx.source_ids.append(source.id)
                            added_sources.append({"id": source.id, "type": "url", "url": url})
                        except Exception as e:
                            errors.append(f"Failed to add {url}: {e}")

                else:
                    errors.append(f"Unknown source plugin: {plugin_type}")

            except Exception as e:
                errors.append(f"Error with {plugin_type}: {e}")
                ctx.add_error(self.name, str(e), e)

        output = {
            "sources_added": len(added_sources),
            "sources": added_sources,
        }
        if errors:
            output["errors"] = errors

        return self._complete_result(
            result,
            success=len(added_sources) > 0,
            output=output,
            error="; ".join(errors) if errors and not added_sources else None,
        )


class WaitSourcesStep(BaseStep):
    """Wait for sources to finish processing.

    Config:
        timeout: Maximum wait time in seconds (default: 600)
        poll_interval: Time between status checks (default: 5)
    """

    name = "wait_sources"

    async def execute(
        self,
        ctx: PipelineContext,
        client: "NotebookLMClient",
        config: dict[str, Any],
    ) -> StepResult:
        result = self._start_result(self.name)

        if not ctx.notebook_id:
            return self._complete_result(result, success=False, error="No notebook ID in context")

        if not ctx.source_ids:
            return self._complete_result(
                result, success=True, output={"message": "No sources to wait for"}
            )

        timeout = config.get("timeout", 600)
        poll_interval = config.get("poll_interval", 5.0)

        try:
            await client.sources.wait_for_sources(
                ctx.notebook_id,
                ctx.source_ids,
                timeout=float(timeout),
                poll_interval=float(poll_interval),
            )
            return self._complete_result(
                result,
                success=True,
                output={"sources_ready": len(ctx.source_ids)},
            )
        except Exception as e:
            ctx.add_error(self.name, str(e), e)
            return self._complete_result(result, success=False, error=str(e))


class SynthesizeStep(BaseStep):
    """Generate artifacts from notebook sources.

    Config:
        artifacts: List of artifact configurations, each with:
            - type: audio, video, report, quiz, flashcards, mind_map, etc.
            - Plus type-specific config (format, length, etc.)
        questions: Optional list of questions to ask
    """

    name = "synthesize"

    async def execute(
        self,
        ctx: PipelineContext,
        client: "NotebookLMClient",
        config: dict[str, Any],
    ) -> StepResult:
        from ..types import (
            AudioFormat,
            AudioLength,
            QuizDifficulty,
            QuizQuantity,
            ReportFormat,
        )

        result = self._start_result(self.name)

        if not ctx.notebook_id:
            return self._complete_result(result, success=False, error="No notebook ID in context")

        artifacts_config = config.get("artifacts", [])
        questions = config.get("questions", [])
        generated = []
        errors = []

        # Generate each artifact
        for art_cfg in artifacts_config:
            art_type = art_cfg.get("type", "")
            source_ids = ctx.source_ids if ctx.source_ids else None

            try:
                if art_type == "audio":
                    fmt = art_cfg.get("format", "conversational")
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
                    audio_length = length_map.get(
                        art_cfg.get("length", "medium"), AudioLength.DEFAULT
                    )

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
                        "briefing_doc": ReportFormat.BRIEFING_DOC,
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

                    # generate_quiz uses 'quantity' not 'num_questions'
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

                    # generate_flashcards uses 'quantity' not 'num_cards'
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
                    # Mind map returns dict with 'mind_map_id'
                    if isinstance(mind_map_result, dict) and mind_map_result.get("mind_map_id"):
                        ctx.artifact_ids.append(mind_map_result["mind_map_id"])
                        generated.append({"type": "mind_map", "id": mind_map_result["mind_map_id"]})

                else:
                    errors.append(f"Unknown artifact type: {art_type}")

            except Exception as e:
                errors.append(f"Error generating {art_type}: {e}")
                ctx.add_error(self.name, str(e), e)

        # Ask questions if provided
        for question in questions:
            try:
                ask_result = await client.chat.ask(ctx.notebook_id, question)
                ctx.qa_results.append({"question": question, "answer": ask_result.answer})
            except Exception as e:
                errors.append(f"Error asking '{question[:30]}...': {e}")
                ctx.add_error(self.name, str(e), e)

        output = {
            "artifacts_generated": len(generated),
            "artifacts": generated,
            "questions_answered": len(ctx.qa_results),
        }
        if errors:
            output["errors"] = errors

        return self._complete_result(
            result,
            success=len(generated) > 0 or len(ctx.qa_results) > 0,
            output=output,
            error="; ".join(errors) if errors and not generated else None,
        )


class WaitArtifactsStep(BaseStep):
    """Wait for artifacts to finish generating.

    Config:
        timeout: Maximum wait time in seconds (default: 600)
        poll_interval: Time between status checks (default: 10)
    """

    name = "wait_artifacts"

    async def execute(
        self,
        ctx: PipelineContext,
        client: "NotebookLMClient",
        config: dict[str, Any],
    ) -> StepResult:
        result = self._start_result(self.name)

        if not ctx.notebook_id:
            return self._complete_result(result, success=False, error="No notebook ID in context")

        if not ctx.artifact_ids:
            return self._complete_result(
                result, success=True, output={"message": "No artifacts to wait for"}
            )

        timeout = config.get("timeout", 600)
        poll_interval = config.get("poll_interval", 10.0)

        completed = []
        failed = []

        for artifact_id in ctx.artifact_ids:
            try:
                status = await client.artifacts.wait_for_completion(
                    ctx.notebook_id,
                    artifact_id,
                    timeout=float(timeout),
                    poll_interval=float(poll_interval),
                )
                if status.is_complete:
                    completed.append(artifact_id)
                else:
                    failed.append({"id": artifact_id, "error": status.error})
            except Exception as e:
                failed.append({"id": artifact_id, "error": str(e)})
                ctx.add_error(self.name, str(e), e)

        return self._complete_result(
            result,
            success=len(completed) > 0,
            output={
                "completed": len(completed),
                "failed": len(failed),
                "completed_ids": completed,
                "failed_ids": failed,
            },
            error=f"{len(failed)} artifacts failed" if failed else None,
        )


class AskStep(BaseStep):
    """Ask questions to the notebook.

    Config:
        questions: List of questions to ask
    """

    name = "ask"

    async def execute(
        self,
        ctx: PipelineContext,
        client: "NotebookLMClient",
        config: dict[str, Any],
    ) -> StepResult:
        result = self._start_result(self.name)

        if not ctx.notebook_id:
            return self._complete_result(result, success=False, error="No notebook ID in context")

        questions = config.get("questions", [])
        if not questions:
            return self._complete_result(
                result, success=True, output={"message": "No questions to ask"}
            )

        answers = []
        errors = []

        for question in questions:
            try:
                ask_result = await client.chat.ask(ctx.notebook_id, question)
                answers.append({"question": question, "answer": ask_result.answer})
                ctx.qa_results.append({"question": question, "answer": ask_result.answer})
            except Exception as e:
                errors.append(f"Error asking '{question[:30]}...': {e}")
                ctx.add_error(self.name, str(e), e)

        return self._complete_result(
            result,
            success=len(answers) > 0,
            output={
                "questions_answered": len(answers),
                "answers": answers,
            },
            error="; ".join(errors) if errors and not answers else None,
        )


class ExportStep(BaseStep):
    """Export artifacts to files.

    Config:
        formats: List of export configurations, each with:
            - plugin: Exporter plugin name (e.g., "exporter:markdown", "exporter:audio")
            - output: Output path (supports variable substitution)
            - Plus exporter-specific config
    """

    name = "export"

    async def execute(
        self,
        ctx: PipelineContext,
        client: "NotebookLMClient",
        config: dict[str, Any],
    ) -> StepResult:
        from pathlib import Path

        result = self._start_result(self.name)

        if not ctx.notebook_id:
            return self._complete_result(result, success=False, error="No notebook ID in context")

        formats_config = config.get("formats", [])
        exported = []
        errors = []

        for fmt_cfg in formats_config:
            plugin_type = fmt_cfg.get("plugin", "")
            output_path = fmt_cfg.get("output", "")

            try:
                if plugin_type == "exporter:audio":
                    # Download audio artifacts
                    artifacts = await client.artifacts.list(ctx.notebook_id)
                    audio_artifacts = [
                        a for a in artifacts if a.kind.value == "audio" and a.is_completed
                    ]

                    for artifact in audio_artifacts:
                        path = Path(output_path)
                        path.parent.mkdir(parents=True, exist_ok=True)
                        await client.artifacts.download_audio(
                            ctx.notebook_id, artifact.id, str(path)
                        )
                        exported.append({"type": "audio", "path": str(path)})
                        ctx.artifact_outputs[artifact.id] = str(path)

                elif plugin_type == "exporter:markdown":
                    # Export reports as markdown using download_report

                    artifacts = await client.artifacts.list(ctx.notebook_id)
                    report_artifacts = [
                        a for a in artifacts if a.kind.value == "report" and a.is_completed
                    ]

                    for artifact in report_artifacts:
                        path = Path(output_path)
                        path.parent.mkdir(parents=True, exist_ok=True)
                        # download_report writes to a file, returns the path
                        await client.artifacts.download_report(
                            ctx.notebook_id, str(path), artifact_id=artifact.id
                        )
                        exported.append({"type": "markdown", "path": str(path)})
                        ctx.artifact_outputs[artifact.id] = str(path)

                elif plugin_type == "exporter:json":
                    # Export pipeline results as JSON
                    import json

                    path = Path(output_path)
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text(
                        json.dumps(ctx.to_dict(), indent=2, default=str),
                        encoding="utf-8",
                    )
                    exported.append({"type": "json", "path": str(path)})

                else:
                    errors.append(f"Unknown exporter plugin: {plugin_type}")

            except Exception as e:
                errors.append(f"Error with {plugin_type}: {e}")
                ctx.add_error(self.name, str(e), e)

        return self._complete_result(
            result,
            success=len(exported) > 0,
            output={
                "exports": len(exported),
                "files": exported,
            },
            error="; ".join(errors) if errors and not exported else None,
        )


# Registry of built-in steps
BUILTIN_STEPS: dict[str, type[BaseStep]] = {
    "create_notebook": CreateNotebookStep,
    "ingest": IngestStep,
    "wait_sources": WaitSourcesStep,
    "synthesize": SynthesizeStep,
    "wait_artifacts": WaitArtifactsStep,
    "ask": AskStep,
    "export": ExportStep,
}


def get_builtin_step(name: str) -> BaseStep | None:
    """Get a built-in step by name.

    Args:
        name: Step name (e.g., "create_notebook", "ingest")

    Returns:
        Step instance or None if not found
    """
    step_class = BUILTIN_STEPS.get(name)
    if step_class:
        return step_class()
    return None
