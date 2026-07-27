from celery import Celery
import os

redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
celery_app = Celery("salesai", broker=redis_url, backend=redis_url)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)

@celery_app.task
def dummy_scrape_task(search_id: str):
    print(f"Executing scheduled scrape for search_id: {search_id}")
    return {"status": "success"}
