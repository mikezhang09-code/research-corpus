"""Shared Mermaid helpers for the diagram artifact surface.

Lives at the backend top level (not under ``routers/``) so both the diagrams
router and the library-notebooks generate route can import it without creating
a circular import.
"""

from __future__ import annotations

import re

# System prompt for the in-editor assistant: edits one Mermaid document.
ASSIST_SYSTEM = """You are a Mermaid diagram assistant embedded in a diagram editor.

The user gives an instruction and the current Mermaid source (which may be \
empty). Return the COMPLETE updated Mermaid document — never a partial diff.

Hard rules:
- Reply with exactly one fenced code block: ```mermaid ... ``` containing the \
full diagram, and nothing before it except an optional single short sentence \
of explanation.
- Output valid Mermaid 11 syntax. Quote node labels that contain spaces or \
punctuation, e.g. A["Sign in"].
- Preserve the user's existing structure and labels unless they ask to change \
them; apply only the requested edit.
- If the current source is empty, create a sensible new diagram for the \
request (default to `flowchart TD` unless another type fits better).
- Do not use emoji or exotic glyphs in labels.
- Never wrap the diagram in extra prose, markdown headings, or multiple code \
blocks."""

# Output instructions for one-click "Generate from folio" diagram creation.
GENERATE_INSTRUCTIONS = (
    "Produce a single Mermaid diagram that best captures the structure, "
    "process, or relationships described across ALL the files above — a "
    "flowchart, sequence, state, or class diagram, whichever fits the material "
    "best. Put a `%% title: <short specific title>` comment on the first line, "
    "then the diagram. Reply with ONLY one ```mermaid code block and valid "
    "Mermaid 11 syntax. Quote labels containing spaces, e.g. A[\"Sign in\"]. "
    "No emoji, no prose outside the code block."
)

_FENCE = re.compile(r"```(?:mermaid)?\s*\n(.*?)```", re.DOTALL | re.IGNORECASE)
_TITLE = re.compile(r"^%%\s*title:\s*(.+)$", re.MULTILINE)


def split_mermaid(answer: str) -> tuple[str, str]:
    """Extract (mermaid, explanation) from a model reply."""
    match = _FENCE.search(answer)
    if match:
        mermaid = match.group(1).strip()
        explanation = (answer[: match.start()] + answer[match.end() :]).strip()
        return mermaid, explanation
    # No fence — assume the whole reply is the diagram.
    return answer.strip(), ""


def diagram_title(mermaid: str, fallback: str = "Generated diagram") -> str:
    """Read a `%% title:` comment from the source, else fall back."""
    match = _TITLE.search(mermaid)
    return match.group(1).strip() if match else fallback
