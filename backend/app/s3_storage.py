"""
Real S3-backed attachment storage. Every attachment a user sends is
actually uploaded here and kept permanently — the URL stored on a Message
row is a genuine, retrievable file, not a placeholder.
"""
import asyncio
import logging
import uuid

import boto3
from botocore.exceptions import ClientError

from app.config import settings

logger = logging.getLogger("salesai.s3")


def is_s3_configured() -> bool:
    return bool(settings.AWS_ACCESS_KEY_ID and settings.AWS_SECRET_ACCESS_KEY and settings.AWS_BUCKET_NAME)


def _client():
    return boto3.client(
        "s3",
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_REGION,
    )


async def upload_attachment(org_id: str, filename: str, content: bytes, content_type: str) -> dict:
    """
    Uploads one real file to S3 under a per-org, collision-proof key and
    returns the metadata needed both to attach it to an outgoing email and
    to keep a permanent record of it in the send history. Raises on
    failure — an attachment that didn't genuinely upload must never be
    silently treated as sent.
    """
    if not is_s3_configured():
        raise RuntimeError("S3 is not configured — set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_BUCKET_NAME.")

    key = f"email-attachments/{org_id}/{uuid.uuid4()}-{filename}"
    loop = asyncio.get_event_loop()

    def _put():
        _client().put_object(
            Bucket=settings.AWS_BUCKET_NAME,
            Key=key,
            Body=content,
            ContentType=content_type or "application/octet-stream",
        )

    try:
        await loop.run_in_executor(None, _put)
    except ClientError as e:
        logger.error(f"S3 upload failed for {filename!r}: {e}")
        raise

    return {
        "filename": filename,
        "url": f"https://{settings.AWS_BUCKET_NAME}.s3.{settings.AWS_REGION}.amazonaws.com/{key}",
        "key": key,
        "size": len(content),
        "contentType": content_type or "application/octet-stream",
    }


async def download_attachment(key: str) -> bytes:
    """Fetch a previously uploaded attachment's raw bytes — used to attach
    the real file content to the outgoing SMTP message at send time."""
    loop = asyncio.get_event_loop()

    def _get():
        response = _client().get_object(Bucket=settings.AWS_BUCKET_NAME, Key=key)
        return response["Body"].read()

    return await loop.run_in_executor(None, _get)
