import asyncio
import os
import json
from datetime import datetime
from sqlalchemy import select
from app.db import SessionLocal
from app.models import Company, Contact, Lead, ScrapeJob, SavedSearch, LeadScore

def format_json(obj):
    if not obj:
        return "N/A"
    if isinstance(obj, (dict, list)):
        return json.dumps(obj, ensure_ascii=False)
    return str(obj)

async def generate_export():
    async with SessionLocal() as session:
        # Fetch all records
        companies = (await session.execute(select(Company))).scalars().all()
        contacts = (await session.execute(select(Contact))).scalars().all()
        leads = (await session.execute(select(Lead))).scalars().all()
        jobs = (await session.execute(select(ScrapeJob))).scalars().all()
        searches = (await session.execute(select(SavedSearch))).scalars().all()
        scores = (await session.execute(select(LeadScore))).scalars().all()

        # Map lookups
        comp_dict = {c.id: c for c in companies}
        cont_dict = {c.id: c for c in contacts}
        score_dict = {s.lead_id: s for s in scores}
        search_dict = {s.id: s for s in searches}

        output_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "scraped_data_export.txt"))
        
        with open(output_path, "w", encoding="utf-8") as f:
            f.write("================================================================================\n")
            f.write("                         DATABASE SCRAPED DATA EXPORT                           \n")
            f.write(f"Generated at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write("================================================================================\n\n")

            f.write("=== SUMMARY OVERVIEW ===\n")
            f.write(f"• Total Scraped Companies : {len(companies)}\n")
            f.write(f"• Total Scraped Contacts  : {len(contacts)}\n")
            f.write(f"• Total Leads Generated   : {len(leads)}\n")
            f.write(f"• Total Scrape Jobs       : {len(jobs)}\n")
            f.write(f"• Total Saved Searches    : {len(searches)}\n")
            f.write("========================\n\n")

            # SECTION 1: LEADS DETAILED
            f.write("================================================================================\n")
            f.write("SECTION 1: DETAILED LEADS (COMBINED CONTACT & COMPANY INFORMATION)\n")
            f.write("================================================================================\n\n")
            
            for idx, lead in enumerate(leads, 1):
                company = comp_dict.get(lead.company_id)
                contact = cont_dict.get(lead.contact_id)
                score = score_dict.get(lead.id)

                f.write(f"--- [LEAD #{idx}] (ID: {lead.id}) ---\n")
                f.write(f"Status           : {lead.status}\n")
                f.write(f"Search Mode      : {lead.search_mode}\n")
                f.write(f"Dedupe Hash      : {lead.dedupe_hash or 'N/A'}\n")
                if lead.notes:
                    f.write(f"Notes            : {lead.notes}\n")
                if score:
                    f.write(f"Lead Score       : {score.total_score}/100 (Tier: {score.tier})\n")
                    f.write(f"Score Factors    : {format_json(score.factor_breakdown)}\n")

                f.write("\n  [CONTACT DETAILS]\n")
                if contact:
                    f.write(f"  • Name         : {contact.full_name}\n")
                    f.write(f"  • Designation  : {contact.designation}\n")
                    f.write(f"  • Email        : {contact.email or 'N/A'}\n")
                    f.write(f"  • Phone        : {contact.phone or 'N/A'}\n")
                    f.write(f"  • Seniority    : {contact.seniority_level or 'N/A'}\n")
                    f.write(f"  • LinkedIn     : {contact.linkedin_url or 'N/A'}\n")
                    f.write(f"  • Data Source  : {contact.source_provider or 'N/A'}\n")
                else:
                    f.write("  • Contact Info : N/A\n")

                f.write("\n  [COMPANY DETAILS]\n")
                if company:
                    f.write(f"  • Company Name : {company.name}\n")
                    f.write(f"  • Website      : {company.website or 'N/A'}\n")
                    f.write(f"  • Industry     : {company.industry or 'N/A'}\n")
                    f.write(f"  • Size Range   : {company.size_range or 'N/A'} (Count: {company.employee_count or 'N/A'})\n")
                    f.write(f"  • Revenue      : {company.revenue_range or company.revenue_band or 'N/A'}\n")
                    f.write(f"  • Funding Stage: {company.funding_stage or 'N/A'}\n")
                    f.write(f"  • LinkedIn     : {company.linkedin_url or 'N/A'}\n")
                    f.write(f"  • Tech Stack   : {format_json(company.tech_stack)}\n")
                    if company.summary_text:
                        f.write(f"  • Summary      : {company.summary_text.strip()}\n")
                    if company.activity_signals:
                        f.write(f"  • Activity     : {format_json(company.activity_signals)}\n")
                else:
                    f.write("  • Company Info : N/A\n")

                f.write("-" * 80 + "\n\n")

            # SECTION 2: ALL COMPANIES
            f.write("\n================================================================================\n")
            f.write("SECTION 2: ALL SCRAPED COMPANIES\n")
            f.write("================================================================================\n\n")
            for idx, comp in enumerate(companies, 1):
                f.write(f"[{idx}] {comp.name}\n")
                f.write(f"    ID           : {comp.id}\n")
                f.write(f"    Website      : {comp.website or 'N/A'}\n")
                f.write(f"    Industry     : {comp.industry or 'N/A'}\n")
                f.write(f"    Size Range   : {comp.size_range or 'N/A'}\n")
                f.write(f"    Employee Cnt : {comp.employee_count or 'N/A'}\n")
                f.write(f"    Revenue      : {comp.revenue_range or comp.revenue_band or 'N/A'}\n")
                f.write(f"    Funding      : {comp.funding_stage or 'N/A'}\n")
                f.write(f"    LinkedIn     : {comp.linkedin_url or 'N/A'}\n")
                f.write(f"    Source       : {comp.source_provider or 'N/A'}\n")
                f.write(f"    Tech Stack   : {format_json(comp.tech_stack)}\n")
                if comp.summary_text:
                    f.write(f"    Summary      : {comp.summary_text.strip()}\n")
                if comp.activity_signals:
                    f.write(f"    Activity     : {format_json(comp.activity_signals)}\n")
                f.write("\n")

            # SECTION 3: ALL CONTACTS
            f.write("\n================================================================================\n")
            f.write("SECTION 3: ALL SCRAPED CONTACTS\n")
            f.write("================================================================================\n\n")
            for idx, cont in enumerate(contacts, 1):
                comp = comp_dict.get(cont.company_id)
                comp_name = comp.name if comp else cont.company_id
                f.write(f"[{idx}] {cont.full_name} ({cont.designation})\n")
                f.write(f"    ID           : {cont.id}\n")
                f.write(f"    Company      : {comp_name}\n")
                f.write(f"    Email        : {cont.email or 'N/A'}\n")
                f.write(f"    Phone        : {cont.phone or 'N/A'}\n")
                f.write(f"    Seniority    : {cont.seniority_level or 'N/A'}\n")
                f.write(f"    LinkedIn     : {cont.linkedin_url or 'N/A'}\n")
                f.write(f"    Source       : {cont.source_provider or 'N/A'}\n")
                f.write("\n")

            # SECTION 4: SCRAPE JOBS & SAVED SEARCHES
            f.write("\n================================================================================\n")
            f.write("SECTION 4: SCRAPE JOBS & SAVED SEARCHES\n")
            f.write("================================================================================\n\n")
            f.write("--- SCRAPE JOBS ---\n")
            for idx, job in enumerate(jobs, 1):
                search = search_dict.get(job.search_id)
                search_name = search.name if search else job.search_id
                f.write(f"Job [{idx}] ID: {job.id}\n")
                f.write(f"  Saved Search   : {search_name or 'N/A'}\n")
                f.write(f"  Status         : {job.status}\n")
                f.write(f"  Search Mode    : {job.search_mode}\n")
                f.write(f"  Leads Found    : {job.leads_found}\n")
                f.write(f"  Triggered By   : {job.triggered_by or 'N/A'}\n")
                f.write(f"  Started At     : {job.started_at}\n")
                f.write(f"  Completed At   : {job.completed_at or 'N/A'}\n")
                if job.per_source_breakdown:
                    f.write(f"  Breakdown      : {format_json(job.per_source_breakdown)}\n")
                if job.error_detail:
                    f.write(f"  Error          : {job.error_detail}\n")
                f.write("\n")

            f.write("--- SAVED SEARCHES ---\n")
            for idx, search in enumerate(searches, 1):
                f.write(f"Search [{idx}] ID: {search.id} - Name: {search.name}\n")
                f.write(f"  Mode           : {search.search_mode}\n")
                f.write(f"  Target Count   : {search.lead_count_target}\n")
                f.write(f"  Industries     : {format_json(search.industries)}\n")
                f.write(f"  Designations   : {format_json(search.designations)}\n")
                f.write(f"  Countries      : {format_json(search.countries)}\n")
                f.write(f"  States         : {format_json(search.states)}\n")
                f.write(f"  Cities         : {format_json(search.cities)}\n")
                if search.company_size_min or search.company_size_max:
                    f.write(f"  Company Size   : {search.company_size_min} - {search.company_size_max}\n")
                if search.revenue_bands:
                    f.write(f"  Revenue Bands  : {format_json(search.revenue_bands)}\n")
                f.write("\n")

        print(f"Export successfully generated at: {output_path}")

if __name__ == "__main__":
    asyncio.run(generate_export())
