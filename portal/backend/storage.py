from functools import lru_cache
from pathlib import Path

import boto3
from botocore.config import Config

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
