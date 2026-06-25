import io
import zipfile
from functools import lru_cache
from urllib.parse import quote

import boto3
from botocore.config import Config
from fastapi import Response

from .config import get_settings


@lru_cache
def get_r2():
    s = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=s.r2_endpoint_url,
        aws_access_key_id=s.r2_access_key_id,
        aws_secret_access_key=s.r2_secret_access_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def public_url(key: str) -> str:
    s = get_settings()
    if s.r2_public_url:
        return f"{s.r2_public_url.rstrip('/')}/{key}"
    # Fall back to presigned URL (24h)
    return get_r2().generate_presigned_url(
        "get_object",
        Params={"Bucket": s.r2_bucket_name, "Key": key},
        ExpiresIn=86400,
    )


def upload_file(key: str, data: bytes, content_type: str) -> str:
    s = get_settings()
    get_r2().put_object(
        Bucket=s.r2_bucket_name,
        Key=key,
        Body=data,
        ContentType=content_type,
    )
    return public_url(key)


def delete_file(key: str) -> None:
    s = get_settings()
    get_r2().delete_object(Bucket=s.r2_bucket_name, Key=key)


def r2_key_for_artifact(notebook_id: str, artifact_type: str, artifact_id: str, ext: str) -> str:
    return f"notebooklm/{notebook_id}/{artifact_type}/{artifact_id}.{ext}"


def r2_key_for_upload(item_id: str, filename: str) -> str:
    return f"library/uploads/{item_id}/{filename}"


def r2_key_for_drive(item_id: str, drive_file_id: str, ext: str) -> str:
    return f"library/drive/{item_id}/{drive_file_id}.{ext}"


def get_file_bytes(key: str) -> bytes:
    s = get_settings()
    return get_r2().get_object(Bucket=s.r2_bucket_name, Key=key)["Body"].read()


def _dedupe_name(name: str, seen: dict[str, int]) -> str:
    """Return a zip-safe, collision-free archive name for ``name``.

    Two files can share an ``original_name`` (e.g. duplicate "report.md"); the
    second gets a ``report (2).md`` suffix so neither is silently dropped.
    """
    candidate = name or "file"
    if candidate not in seen:
        seen[candidate] = 1
        return candidate
    seen[candidate] += 1
    n = seen[candidate]
    if "." in candidate:
        stem, ext = candidate.rsplit(".", 1)
        return f"{stem} ({n}).{ext}"
    return f"{candidate} ({n})"


def build_zip(entries: list[tuple[str, str]]) -> bytes:
    """Build an in-memory zip from ``(filename, r2_key)`` pairs.

    Each object's bytes are fetched from R2 via :func:`get_file_bytes`. Archive
    names are de-duplicated so colliding filenames don't overwrite each other.
    """
    buf = io.BytesIO()
    seen: dict[str, int] = {}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, key in entries:
            zf.writestr(_dedupe_name(name, seen), get_file_bytes(key))
    return buf.getvalue()


def zip_response(data: bytes, filename: str) -> Response:
    """Wrap zip ``data`` in an attachment Response with an RFC 5987 filename.

    HTTP headers are latin-1, so non-ASCII names (e.g. Chinese folio titles)
    need percent-encoding via ``filename*=``; an ASCII ``filename=`` fallback
    is provided for older clients. Mirrors ``file_content_response`` in the
    library-notebooks router.
    """
    ascii_fallback = filename.encode("ascii", "ignore").decode() or "download.zip"
    return Response(
        content=data,
        media_type="application/zip",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{ascii_fallback}"; '
                f"filename*=UTF-8''{quote(filename, safe='')}"
            )
        },
    )
