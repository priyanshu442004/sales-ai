// Shared CSV export for any "scraped lead" shaped record — used by the Job
// Queue detail view and the All Leads workspace page, which both render the
// same company/decisionMaker/activitySignals/score data. Column set depends
// on search mode since companies and individuals carry different required
// fields.
export interface CsvLead {
  score: number | null;
  company: { name: string; industry: string; website?: string; linkedinUrl?: string; overview?: string };
  decisionMaker: { full_name: string; designation: string; email?: string; phone?: string; linkedin_url?: string };
  activitySignals: string[];
}

export function buildCSVRows(leads: CsvLead[], mode: 'individuals' | 'companies'): string[][] {
  if (mode === 'companies') {
    return [
      ['Company Name', 'Website', 'Summary', 'Activity', 'Decision Maker', 'Designation', 'Phone', 'Email', 'Company LinkedIn', 'Decision Maker LinkedIn', 'Score'],
      ...leads.map((l) => [
        l.company.name || '',
        l.company.website || '',
        l.company.overview || '',
        l.activitySignals.join('; '),
        l.decisionMaker.full_name || '',
        l.decisionMaker.designation || '',
        l.decisionMaker.phone || '',
        l.decisionMaker.email || '',
        l.company.linkedinUrl || '',
        l.decisionMaker.linkedin_url || '',
        String(l.score ?? ''),
      ]),
    ];
  }
  return [
    ['Name', 'Title', 'Company', 'Industry', 'Website', 'Email', 'Phone', 'LinkedIn', 'Score'],
    ...leads.map((l) => [
      l.decisionMaker.full_name || '',
      l.decisionMaker.designation || '',
      l.company.name || '',
      l.company.industry || '',
      l.company.website || '',
      l.decisionMaker.email || '',
      l.decisionMaker.phone || '',
      l.decisionMaker.linkedin_url || '',
      String(l.score ?? ''),
    ]),
  ];
}

export function downloadCSVRows(rows: string[][], filename: string): void {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
