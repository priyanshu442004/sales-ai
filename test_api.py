#!/usr/bin/env python3
"""API testing script"""
import requests
import json
import time

BASE_URL = "http://127.0.0.1:8000/api/v1"

def test_auth():
    print("\n✓ Testing Auth Endpoint...")
    response = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": "admin@gmail.com", "password": "admin"}
    )
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Response: {json.dumps(data, indent=2)[:200]}")
    token = data.get("access_token")
    return token

def test_estimation(token):
    print("\n✓ Testing Search Estimation Endpoint...")
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.post(
        f"{BASE_URL}/searches/estimate",
        json={
            "countries": ["United States"],
            "industries": ["Technology"],
            "titles": ["VP of Sales"],
        },
        headers=headers
    )
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)[:300]}")

def test_create_search(token):
    print("\n✓ Testing Create Search Endpoint...")
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.post(
        f"{BASE_URL}/searches",
        json={
            "name": "Test VP of Sales Search",
            "countries": ["United States"],
            "states": ["California"],
            "cities": ["San Francisco"],
            "industries": ["Technology"],
            "designations": ["VP of Sales"],
            "lead_count_target": 10,
        },
        headers=headers
    )
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Response: {json.dumps(data, indent=2)[:300]}")
    return data.get("id") if isinstance(data, dict) else None

def test_run_search(token, search_id):
    if not search_id:
        print("\n! Skipping run search - no search ID")
        return
    
    print(f"\n✓ Testing Run Search Endpoint (ID: {search_id[:8]})...")
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.post(
        f"{BASE_URL}/searches/{search_id}/run",
        headers=headers
    )
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)[:300]}")

def test_list_jobs(token):
    print("\n✓ Testing List Jobs Endpoint...")
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(
        f"{BASE_URL}/jobs",
        headers=headers
    )
    print(f"Status: {response.status_code}")
    data = response.json()
    total = data.get("total", 0)
    jobs_count = len(data.get("data", []))
    print(f"Total jobs: {total}, Page jobs: {jobs_count}")
    if jobs_count > 0:
        print(f"First job structure:")
        print(json.dumps(data["data"][0], indent=2)[:500])

def test_list_leads(token):
    print("\n✓ Testing List Leads Endpoint...")
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(
        f"{BASE_URL}/leads",
        headers=headers
    )
    print(f"Status: {response.status_code}")
    data = response.json()
    leads_count = len(data.get("data", []))
    print(f"Leads returned: {leads_count}")
    if leads_count > 0:
        print(f"First lead structure:")
        print(json.dumps(data["data"][0], indent=2)[:600])

if __name__ == "__main__":
    print("=" * 60)
    print("API TESTING SCRIPT - Lead Sourcing Application")
    print("=" * 60)
    
    try:
        token = test_auth()
        if token:
            test_estimation(token)
            search_id = test_create_search(token)
            test_run_search(token, search_id)
            time.sleep(2)
            test_list_jobs(token)
            time.sleep(1)
            test_list_leads(token)
    except Exception as e:
        print(f"\n✗ Error: {e}")
        import traceback
        traceback.print_exc()
    
    print("\n" + "=" * 60)
