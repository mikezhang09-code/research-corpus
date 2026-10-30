#!/usr/bin/env python3
"""folio — manage Research Portal folios and their files from the shell.

A thin client over the portal backend's REST API (stdlib only, so it also runs
on a laptop). Folios and files can be named by id, exact title, or any unique
case-insensitive fragment of the title.

    folio ls                              list folios
    folio files Xtep                      list a folio's files
    folio upload Xtep ~/Downloads/*.pdf   upload files / globs / folders
    folio upload Xtep                     pick files interactively (cwd)
    folio upload                          pick the folio too
    folio files                           pick a folio (any command: omit it or use -)
    folio files li                        several matches? pick among them
    folio --help / folio <cmd> --help     everything else

API base: $FOLIO_API (default http://127.0.0.1:8000/api). From another machine
on the tailnet use the frontend's proxy, e.g.
    export FOLIO_API=http://100.113.14.97:3001/api
"""

from __future__ import annotations

import argparse
import glob
import json
import mimetypes
import os
import shlex
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

API = os.environ.get("FOLIO_API", "http://127.0.0.1:8000/api").rstrip("/")
GEN_KINDS = ("note", "mindmap", "quiz", "flashcards", "diagram")
SKIP_DIRS = {".git", "node_modules", ".venv", "__pycache__", ".next", ".cache"}
PICKER_MAX_DEPTH = 4
PICKER_MAX_FILES = 5000


class CliError(Exception):
    pass


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


def _request(
    method: str,
    path: str,
    *,
    body: bytes | None = None,
    headers: dict | None = None,
    timeout: float = 120,
) -> bytes:
    req = urllib.request.Request(f"{API}{path}", data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        try:
            detail = json.loads(detail).get("detail", detail)
        except (ValueError, AttributeError):
            pass
        raise CliError(f"{method} {path} → {e.code}: {detail}") from None
    except urllib.error.URLError as e:
        raise CliError(
            f"cannot reach {API} ({e.reason}). Is the portal backend running? "
            "Set FOLIO_API to point elsewhere."
        ) from None


def api(method: str, path: str, payload: dict | None = None, timeout: float = 120):
    body = json.dumps(payload).encode() if payload is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    raw = _request(method, path, body=body, headers=headers, timeout=timeout)
    return json.loads(raw) if raw else None


def upload_multipart(path: str, file: Path, fields: dict[str, str]) -> dict:
    boundary = uuid.uuid4().hex
    mime = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
    parts = []
    for k, v in fields.items():
        if v:
            parts.append(
                f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
            )
    name = file.name.replace('"', "%22")
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
        f"Content-Type: {mime}\r\n\r\n".encode()
    )
    parts.append(file.read_bytes())
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    raw = _request(
        "POST",
        path,
        body=b"".join(parts),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        timeout=600,
    )
    return json.loads(raw)


# ---------------------------------------------------------------------------
# Name resolution
# ---------------------------------------------------------------------------


PICK = "-"  # stand-in for a folio/file argument meaning "let me pick"


def _match(items: list[dict], query: str | None, kind: str, label, keys=("title",)) -> dict:
    """Resolve by id, exact title, or unique fragment; fall back to a picker.

    The picker opens when the query is omitted or ``-`` (over every item), or
    when a fragment matches several items (over just those).
    """
    candidates = items
    if query is not None and query != PICK:
        q = query.strip().lower()
        for it in items:
            if str(it["id"]) == query or str(it["id"]).startswith(q) and len(q) >= 8:
                return it
        exact = [it for it in items if any((it.get(k) or "").lower() == q for k in keys)]
        if len(exact) == 1:
            return exact[0]
        candidates = exact or [
            it for it in items if any(q in (it.get(k) or "").lower() for k in keys)
        ]
        if len(candidates) == 1:
            return candidates[0]
        if not candidates:
            raise CliError(f"no {kind} matches {query!r}")
        if not sys.stdin.isatty():
            names = "\n".join(f"  {it['id']}  {it['title']}" for it in candidates[:15])
            raise CliError(
                f"{query!r} matches {len(candidates)} {kind}s — be more specific:\n{names}"
            )
    if not candidates:
        raise CliError(f"no {kind}s to pick from")
    picked = pick([label(it) for it in candidates], kind, multi=False)
    if not picked:
        raise CliError(f"no {kind} selected")
    return candidates[picked[0]]


def list_folios(include_hidden: bool = False, tags: list[str] | None = None) -> list[dict]:
    qs = [("include_hidden", "true")] if include_hidden else []
    qs += [("tag", t) for t in tags or []]
    q = f"?{urllib.parse.urlencode(qs)}" if qs else ""
    return api("GET", f"/library-notebooks{q}")["items"]


def _folio_label(f: dict) -> str:
    return f"{f.get('cover_emoji') or '  '} {f['title']}  ({f['file_count']} files)"


def _file_label(f: dict) -> str:
    return f"{f['file_category']:<11} {human_size(f.get('file_size_bytes') or 0):>9}\t{f['title']}"


def resolve_folio(query: str | None) -> dict:
    return _match(list_folios(include_hidden=True), query, "folio", _folio_label)


def list_files(folio: dict) -> list[dict]:
    return api("GET", f"/library-notebooks/{folio['id']}/files")


def resolve_files(folio: dict, queries: list[str | None]) -> list[dict]:
    files = list_files(folio)
    return [_match(files, q, "file", _file_label, keys=("title", "original_name")) for q in queries]


def select_files(folio: dict, queries: list[str], what: str, default_all: bool) -> list[dict]:
    """Files for a multi-file command: named ones, a multi-pick for ``-``
    (or when nothing is named and ``default_all`` is off), else all of them."""
    if queries and queries != [PICK]:
        return resolve_files(folio, queries)
    files = list_files(folio)
    if not queries and default_all:
        return files
    return [files[i] for i in pick([_file_label(f) for f in files], what)]


# ---------------------------------------------------------------------------
# Interactive pickers
# ---------------------------------------------------------------------------


def pick(labels: list[str], what: str, multi: bool = True, preview: str | None = None) -> list[int]:
    """Return indexes of the chosen labels. Uses fzf when available.

    A label may hold one tab: text before it is display-only metadata, and
    filtering matches only the part after it.
    """
    if not labels:
        return []
    if not sys.stdin.isatty():
        raise CliError(f"no {what} given and stdin is not a terminal — pass it explicitly")
    if shutil.which("fzf"):
        cmd = [
            "fzf",
            "--height=80%",
            "--reverse",
            "--with-nth=2..",
            "--nth=-1",
            "--delimiter=\t",
            f"--prompt={what}> ",
        ]
        if multi:
            cmd += [
                "--multi",
                "--bind=ctrl-a:select-all",
                "--header=TAB mark · ctrl-a all · type to filter · ENTER confirm",
            ]
        if preview:
            cmd += [f"--preview={preview}", "--preview-window=right:40%:wrap"]
        lines = "\n".join(f"{i}\t{label}" for i, label in enumerate(labels))
        res = subprocess.run(cmd, input=lines, text=True, stdout=subprocess.PIPE)
        return [int(line.split("\t", 1)[0]) for line in res.stdout.splitlines() if line]
    return _menu_pick(labels, what, multi)


def _menu_pick(labels: list[str], what: str, multi: bool) -> list[int]:
    shown = list(range(len(labels)))
    while True:
        for n, i in enumerate(shown[:60], 1):
            print(f"  {n:>3}  {labels[i].replace(chr(9), '  ')}")
        if len(shown) > 60:
            print(f"  … {len(shown) - 60} more — type text to filter")
        hint = "numbers like 1 3 5-8, 'a' for all" if multi else "a number"
        ans = input(f"{what}: {hint}, text to filter, empty to cancel > ").strip()
        if not ans:
            return []
        try:
            chosen: list[int] = []
            if multi and ans.lower() == "a":
                return shown
            for tok in ans.replace(",", " ").split():
                lo, _, hi = tok.partition("-")
                for n in range(int(lo), int(hi or lo) + 1):
                    chosen.append(shown[n - 1])
            if not multi and len(chosen) != 1:
                print("pick exactly one")
                continue
            return chosen
        except (ValueError, IndexError):
            shown = [
                i
                for i in range(len(labels))
                if ans.lower() in labels[i].rsplit("\t", 1)[-1].lower()
            ]
            if not shown:
                print("nothing matches; showing all")
                shown = list(range(len(labels)))


def _walk(root: Path, exts: set[str] | None) -> list[Path]:
    found: list[Path] = []
    base_depth = len(root.parts)
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [
            d
            for d in dirnames
            if not d.startswith(".")
            and d not in SKIP_DIRS
            and len(Path(dirpath).parts) - base_depth < PICKER_MAX_DEPTH
        ]
        for f in filenames:
            if f.startswith(".") or (exts and Path(f).suffix.lower() not in exts):
                continue
            found.append(Path(dirpath) / f)
            if len(found) >= PICKER_MAX_FILES:
                return found
    return found


def human_size(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n} B"


def pick_local_files(root: Path, exts: set[str] | None) -> list[Path]:
    files = sorted(_walk(root, exts), key=lambda p: p.stat().st_mtime, reverse=True)
    if not files:
        raise CliError(f"no files under {root}")
    labels = [
        f"{time.strftime('%Y-%m-%d %H:%M', time.localtime(p.stat().st_mtime))}  "
        f"{human_size(p.stat().st_size):>9}\t{p.relative_to(root)}"
        for p in files
    ]
    print(f"Picking from {root} (newest first)", file=sys.stderr)
    target = f"{shlex.quote(str(root))}/{{-1}}"
    preview = f"ls -lh {target}; echo; head -c 4000 {target} | strings | head -40"
    return [files[i] for i in pick(labels, "files", multi=True, preview=preview)]


def expand_paths(args: list[str], exts: set[str] | None) -> list[Path]:
    out: list[Path] = []
    for a in args:
        matches = glob.glob(os.path.expanduser(a)) or [os.path.expanduser(a)]
        for m in matches:
            p = Path(m)
            if p.is_dir():
                out += sorted(_walk(p, exts))
            elif p.is_file():
                if not exts or p.suffix.lower() in exts:
                    out.append(p)
            else:
                raise CliError(f"no such file or folder: {a}")
    seen: set[Path] = set()
    return [p for p in out if not (p.resolve() in seen or seen.add(p.resolve()))]


def confirm(prompt: str, assume_yes: bool) -> bool:
    if assume_yes:
        return True
    if not sys.stdin.isatty():
        raise CliError("refusing without confirmation in a non-interactive shell — pass -y")
    return input(f"{prompt} [y/N] ").strip().lower() in ("y", "yes")


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------


def emit_json(data) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2, default=str))


def table(rows: list[list[str]], headers: list[str]) -> None:
    if not rows:
        print("(none)")
        return
    widths = [max(len(str(r[i])) for r in [headers, *rows]) for i in range(len(headers))]
    widths[-1] = 0  # last column unpadded
    for r in [headers, *rows]:
        print("  ".join(str(c).ljust(w) for c, w in zip(r, widths, strict=True)).rstrip())


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def cmd_ls(a):
    folios = list_folios(a.hidden, a.tag)
    if a.json:
        return emit_json(folios)
    table(
        [
            [
                f["id"][:8],
                str(f["file_count"]),
                ",".join(f.get("tags") or []),
                f"{f.get('cover_emoji') or '  '} {f['title']}"
                + ("  [hidden]" if f.get("hidden") else ""),
            ]
            for f in folios
        ],
        ["ID", "FILES", "TAGS", "TITLE"],
    )


def cmd_files(a):
    folio = resolve_folio(a.folio)
    files = list_files(folio)
    if a.category:
        files = [f for f in files if f["file_category"] == a.category]
    if a.json:
        return emit_json(files)
    print(f"{folio.get('cover_emoji') or ''} {folio['title']}  ({len(files)} files)")
    table(
        [
            [
                f["id"][:8],
                f["file_category"],
                human_size(f.get("file_size_bytes") or 0),
                (f.get("added_at") or "")[:10],
                f["title"],
            ]
            for f in files
        ],
        ["ID", "CATEGORY", "SIZE", "ADDED", "TITLE"],
    )


def cmd_new(a):
    folio = api(
        "POST",
        "/library-notebooks",
        {"title": a.title, "cover_emoji": a.emoji, "tags": a.tag or []},
    )
    print(f"created {folio['id']}  {folio['title']}") if not a.json else emit_json(folio)


def cmd_edit(a):
    folio = resolve_folio(a.folio)
    patch = {
        k: v
        for k, v in {
            "title": a.title,
            "description": a.description,
            "cover_emoji": a.emoji,
            "tags": a.tags,
        }.items()
        if v is not None
    }
    if not patch:
        raise CliError("nothing to change — pass --title/--description/--emoji/--tags")
    folio = api("PATCH", f"/library-notebooks/{folio['id']}", patch)
    print(f"updated {folio['id']}  {folio['title']}")


def cmd_hide(a, action: str):
    folio = resolve_folio(a.folio)
    api("POST", f"/library-notebooks/{folio['id']}/{action}")
    print(f"{action} {folio['title']}")


def cmd_rm(a):
    folio = resolve_folio(a.folio)
    if confirm(f"Delete folio {folio['title']!r} and its {folio['file_count']} files?", a.yes):
        api("DELETE", f"/library-notebooks/{folio['id']}")
        print(f"deleted {folio['title']}")


def cmd_upload(a):
    exts = {("." + e.lstrip(".")).lower() for e in a.ext.split(",")} if a.ext else None
    args = list(a.args)
    # First positional is the folio unless it names something on disk.
    folio_q = a.folio
    if folio_q is None and args and not glob.glob(os.path.expanduser(args[0])):
        folio_q = args.pop(0)
    if a.new:
        folio = api("POST", "/library-notebooks", {"title": a.new, "cover_emoji": None, "tags": []})
        print(f"created folio {folio['title']}")
    else:
        folio = resolve_folio(folio_q)

    paths = (
        expand_paths(args, exts)
        if args
        else pick_local_files(Path(a.src).expanduser().resolve(), exts)
    )
    if not paths:
        raise CliError("no files selected")
    if a.title and len(paths) > 1:
        raise CliError("--title only makes sense with a single file")

    existing = {f["original_name"] for f in list_files(folio)} if not a.new else set()
    dupes = [p for p in paths if p.name in existing]
    if dupes and not a.force:
        paths = [p for p in paths if p.name not in existing]

    print(f"\nUpload to {folio.get('cover_emoji') or ''} {folio['title']}:")
    for p in paths:
        print(f"  + {human_size(p.stat().st_size):>9}  {p}")
    for p in dupes if not a.force else []:
        print(f"  = skip (already in folio): {p.name}")
    if not paths:
        return print("nothing new to upload (use --force to upload duplicates)")
    total = sum(p.stat().st_size for p in paths)
    if not confirm(f"Upload {len(paths)} file(s), {human_size(total)}?", a.yes):
        return print("cancelled")

    failed = 0
    for n, p in enumerate(paths, 1):
        print(f"[{n}/{len(paths)}] {p.name} … ", end="", flush=True)
        try:
            upload_multipart(
                f"/library-notebooks/{folio['id']}/files/upload",
                p,
                {"title": a.title or "", "category": a.category or ""},
            )
            print("ok")
        except CliError as e:
            failed += 1
            print(f"FAILED ({e})")
    print(f"done: {len(paths) - failed} uploaded" + (f", {failed} failed" if failed else ""))
    if failed:
        sys.exit(1)


def cmd_cat(a):
    folio = resolve_folio(a.folio)
    (f,) = resolve_files(folio, [a.file])
    data = _request("GET", f"/library-notebooks/{folio['id']}/files/{f['id']}/content")
    sys.stdout.buffer.write(data)


def cmd_get(a):
    folio = resolve_folio(a.folio)
    files = select_files(folio, a.files, "files to download", default_all=True)
    if not files:
        return print("nothing selected")
    if len(files) == 1 and not a.zip:
        f = files[0]
        out = Path(a.output or f["original_name"] or f["title"])
        out.write_bytes(
            _request(
                "GET", f"/library-notebooks/{folio['id']}/files/{f['id']}/content", timeout=600
            )
        )
    else:
        out = Path(a.output or f"{folio['title']}.zip")
        body = json.dumps({"ids": [f["id"] for f in files]}).encode()
        out.write_bytes(
            _request(
                "POST",
                f"/library-notebooks/{folio['id']}/files/download",
                body=body,
                headers={"Content-Type": "application/json"},
                timeout=600,
            )
        )
    print(f"saved {out} ({human_size(out.stat().st_size)})")


def cmd_rmf(a):
    folio = resolve_folio(a.folio)
    files = select_files(folio, a.files, "files to delete", default_all=False)
    if not files:
        return print("nothing selected")
    for f in files:
        print(f"  - {f['title']}")
    if confirm(f"Delete {len(files)} file(s) from {folio['title']!r}?", a.yes):
        api(
            "POST",
            f"/library-notebooks/{folio['id']}/files/bulk-delete",
            {"file_ids": [f["id"] for f in files]},
        )
        print(f"deleted {len(files)} file(s)")


def cmd_mv(a):
    folio = resolve_folio(a.folio)
    (f,) = resolve_files(folio, [a.file])
    patch = {
        k: v
        for k, v in {
            "title": a.title,
            "description": a.description,
            "file_category": a.category,
        }.items()
        if v is not None
    }
    if not patch:
        raise CliError("nothing to change — pass --title/--description/--category")
    f = api("PATCH", f"/library-notebooks/{folio['id']}/files/{f['id']}", patch)
    print(f"updated {f['title']}")


def cmd_generate(a):
    folio = resolve_folio(a.folio)
    print(f"generating {a.kind} for {folio['title']} (this can take a minute) …", file=sys.stderr)
    f = api(
        "POST",
        f"/library-notebooks/{folio['id']}/generate",
        {"kind": a.kind, "language": a.lang},
        timeout=600,
    )
    print(
        f"created {f['file_category']}: {f['title']}  ({f['id'][:8]})"
    ) if not a.json else emit_json(f)


def cmd_ask(a):
    folio = resolve_folio(a.folio)
    res = api(
        "POST",
        f"/library-notebooks/{folio['id']}/chat",
        {"message": " ".join(a.question), "language": a.lang},
        timeout=600,
    )
    emit_json(res) if a.json else print(res["answer"])


def cmd_push(a):
    folio = resolve_folio(a.folio)
    files = select_files(folio, a.files, "files to push", default_all=True)
    if not files:
        return print("nothing selected")
    if not a.to and not a.new_title:
        raise CliError("pass --to <NotebookLM notebook id> or --new-title <title>")
    print(f"pushing {len(files)} file(s) to NotebookLM …", file=sys.stderr)
    res = api(
        "POST",
        f"/library-notebooks/{folio['id']}/push-to-corpus",
        {
            "file_ids": [f["id"] for f in files],
            "target_notebook_id": a.to,
            "new_title": a.new_title,
        },
        timeout=1800,
    )
    if a.json:
        return emit_json(res)
    print(f"notebook: {res['notebook_title']} ({res['notebook_id']})")
    for r in res["results"]:
        print(
            f"  {r['status']:<8} {r['title']}" + (f"  — {r['reason']}" if r.get("reason") else "")
        )


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="folio", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = p.add_subparsers(dest="cmd", required=True, metavar="COMMAND")

    def add(name, fn, help_, aliases=()):
        s = sub.add_parser(name, help=help_, aliases=list(aliases), description=help_)
        s.set_defaults(fn=fn)
        return s

    s = add("ls", cmd_ls, "list folios")
    s.add_argument("--hidden", action="store_true", help="include hidden folios")
    s.add_argument("--tag", action="append", help="filter by tag (repeatable)")
    s.add_argument("--json", action="store_true")

    s = add("files", cmd_files, "list a folio's files", aliases=["show"])
    s.add_argument("folio", nargs="?", help="folio id/title/fragment (omit or - to pick)")
    s.add_argument("--category", help="only this category (report, slide, note, …)")
    s.add_argument("--json", action="store_true")

    s = add("new", cmd_new, "create a folio")
    s.add_argument("title")
    s.add_argument("--emoji")
    s.add_argument("--tag", action="append")
    s.add_argument("--json", action="store_true")

    s = add("edit", cmd_edit, "rename / retag a folio")
    s.add_argument("folio", nargs="?", help="folio id/title/fragment (omit or - to pick)")
    s.add_argument("--title")
    s.add_argument("--description")
    s.add_argument("--emoji")
    s.add_argument(
        "--tags",
        type=lambda v: [t.strip() for t in v.split(",") if t.strip()],
        help="comma-separated; replaces existing tags",
    )

    for action in ("hide", "restore"):
        s = add(action, lambda a, action=action: cmd_hide(a, action), f"{action} a folio")
        s.add_argument("folio", nargs="?", help="folio id/title/fragment (omit or - to pick)")

    s = add("rm", cmd_rm, "delete a folio and all its files")
    s.add_argument("folio", nargs="?", help="folio id/title/fragment (omit or - to pick)")
    s.add_argument("-y", "--yes", action="store_true")

    s = add(
        "upload",
        cmd_upload,
        "upload files (paths, globs, folders, or pick interactively)",
        aliases=["up"],
    )
    s.add_argument(
        "args",
        nargs="*",
        metavar="[FOLIO] [PATH ...]",
        help="folio then files/globs/folders; omit paths to pick, omit both to pick the folio too",
    )
    s.add_argument("--folio", help="folio explicitly (if its name collides with a local path)")
    s.add_argument("--new", metavar="TITLE", help="create a new folio and upload into it")
    s.add_argument(
        "--from",
        dest="src",
        default=".",
        metavar="DIR",
        help="where the picker starts (default: current folder)",
    )
    s.add_argument("--ext", help="only these extensions, e.g. pdf,md,docx")
    s.add_argument("--title", help="title for a single uploaded file")
    s.add_argument("--category", help="override detected category")
    s.add_argument(
        "--force", action="store_true", help="upload even if a file with the same name exists"
    )
    s.add_argument("-y", "--yes", action="store_true", help="don't ask for confirmation")

    s = add("cat", cmd_cat, "print a file's content")
    s.add_argument("folio", nargs="?", help="folio id/title/fragment (omit or - to pick)")
    s.add_argument("file", nargs="?", help="file id/title/fragment (omit or - to pick)")

    s = add(
        "get",
        cmd_get,
        "download files (one file as-is, several or all as a zip)",
        aliases=["download"],
    )
    s.add_argument("folio", nargs="?", help="folio id/title/fragment (omit or - to pick)")
    s.add_argument(
        "files", nargs="*", help="files to download, - to pick (default: whole folio as zip)"
    )
    s.add_argument("-o", "--output")
    s.add_argument("--zip", action="store_true", help="zip even a single file")

    s = add("rmf", cmd_rmf, "delete files from a folio (omit files to pick)")
    s.add_argument("folio", nargs="?", help="folio id/title/fragment (omit or - to pick)")
    s.add_argument("files", nargs="*", help="files to delete (omit or - to pick)")
    s.add_argument("-y", "--yes", action="store_true")

    s = add("mv", cmd_mv, "rename / recategorise a file")
    s.add_argument("folio", nargs="?", help="folio id/title/fragment (omit or - to pick)")
    s.add_argument("file", nargs="?", help="file id/title/fragment (omit or - to pick)")
    s.add_argument("--title")
    s.add_argument("--description")
    s.add_argument("--category")

    s = add(
        "generate", cmd_generate, "AI-generate an artifact from the folio's files", aliases=["gen"]
    )
    s.add_argument("folio", nargs="?", help="folio id/title/fragment (omit or - to pick)")
    s.add_argument("kind", choices=GEN_KINDS)
    s.add_argument("--lang", choices=("en", "zh"))
    s.add_argument("--json", action="store_true")

    s = add("ask", cmd_ask, "ask the folio a question")
    s.add_argument("folio", help="folio id/title/fragment, or - to pick")
    s.add_argument("question", nargs="+")
    s.add_argument("--lang", choices=("en", "zh"))
    s.add_argument("--json", action="store_true")

    s = add("push", cmd_push, "push folio files to a NotebookLM notebook")
    s.add_argument("folio", nargs="?", help="folio id/title/fragment (omit or - to pick)")
    s.add_argument("files", nargs="*", help="files to push, - to pick (default: all)")
    s.add_argument("--to", metavar="NOTEBOOK_ID", help="existing NotebookLM notebook")
    s.add_argument("--new-title", help="create a new NotebookLM notebook with this title")
    s.add_argument("--json", action="store_true")
    return p


def main(argv: list[str] | None = None) -> None:
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)  # quiet exit on `folio … | head`
    parser = build_parser()
    # parse_known_args + re-attach lets upload paths follow options
    # (`folio upload X --ext md .`), which plain nargs="*" rejects.
    args, extra = parser.parse_known_args(argv)
    if extra:
        if getattr(args, "fn", None) is not cmd_upload or any(e.startswith("-") for e in extra):
            parser.error(f"unrecognized arguments: {' '.join(extra)}")
        args.args += extra
    try:
        args.fn(args)
    except CliError as e:
        sys.exit(f"folio: {e}")
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    main()
