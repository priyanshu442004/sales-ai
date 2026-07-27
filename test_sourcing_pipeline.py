import asyncio
import time
import json
import logging
import sys
import os

# Add backend directory to sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from app.scraper_real import scrape_companies, scrape_public_leads

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

async def run_test():
    print("=" * 70)
    print("STARTING SOURCING PIPELINE TEST")
    print("Filters: Countries=['Australia', 'United States'], Industries=['Artificial Intelligence'], Count=5")
    print("Requirement: Multi-source, country consistency, mandatory email/phone contact info.")
    print("=" * 70)

    start_time = time.time()

    # Run company scraping with strict filters
    results = await scrape_companies(
        countries=["Australia", "United States"],
        industries=["Artificial Intelligence"],
        count_target=5,
        enrich=True,
    )

    end_time = time.time()
    total_latency = end_time - start_time

    print("\n" + "=" * 70)
    print(f"PIPELINE COMPLETED IN {total_latency:.2f} SECONDS")
    print(f"RETRIEVED {len(results)} VERIFIED ENTRIES")
    print("=" * 70 + "\n")

    for i, company in enumerate(results, 1):
        dm = company.get('decision_maker') or {}
        name_str = company.get('name', '').encode('ascii', 'ignore').decode('ascii')
        dm_name = str(dm.get('name', '')).encode('ascii', 'ignore').decode('ascii')
        dm_desig = str(dm.get('designation', '')).encode('ascii', 'ignore').decode('ascii')
        print(f"--- Company #{i} ---")
        print(f"Name: {name_str}")
        print(f"Website: {company.get('website')}")
        print(f"Contact Email: {company.get('contact_email')}")
        print(f"Contact Phone: {company.get('contact_phone')}")
        print(f"Address/Location: {company.get('address')}")
        print(f"LinkedIn URL: {company.get('linkedin_url')}")
        print(f"Sources: {company.get('sources')}")
        print(f"Decision Maker: {dm_name} ({dm_desig})")
        print("-" * 50)

    with open("test_results.json", "w") as f:
        json.dump({
            "latency_seconds": round(total_latency, 2),
            "count": len(results),
            "results": results
        }, f, indent=2)

    print("\nSaved output to test_results.json")

if __name__ == "__main__":
    asyncio.run(run_test())
