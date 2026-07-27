import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { LeadSearch } from '../LeadSearch';

const api = vi.hoisted(() => ({
  listSearches: vi.fn(),
  createSearch: vi.fn(),
  deleteSearch: vi.fn(),
  estimateSearch: vi.fn(),
  runSearch: vi.fn(),
}));

vi.mock('../../services/sourcingApi', () => api);

beforeEach(() => {
  vi.clearAllMocks();
  api.listSearches.mockResolvedValue([]);
  api.estimateSearch.mockResolvedValue({ match_count: 2, preview_companies: [] });
  api.createSearch.mockResolvedValue({ id: 'search-1' });
  api.runSearch.mockResolvedValue({ id: 'job-1' });
});

describe('LeadSearch page', () => {
  it('blocks running a search when no country is selected', async () => {
    render(<LeadSearch />);

    // Default state ships with two country chips pre-selected — remove both.
    const removeButtons = await screen.findAllByRole('button', { name: '' });
    // Fall back to querying chip remove buttons via their container text.
    const usChip = screen.getByText('United States').closest('span')!;
    const caChip = screen.getByText('Canada').closest('span')!;
    fireEvent.click(within(usChip).getByRole('button'));
    fireEvent.click(within(caChip).getByRole('button'));

    fireEvent.click(screen.getByRole('button', { name: /scrape now/i }));

    await waitFor(() => {
      expect(screen.getByText(/please select at least one country/i)).toBeInTheDocument();
    });
    expect(api.createSearch).not.toHaveBeenCalled();
    void removeButtons;
  });

  it('sends advanced filter values through to the create-search payload', async () => {
    render(<LeadSearch />);

    fireEvent.click(screen.getByRole('button', { name: /show advanced filters/i }));

    // 'Series A' and 'Series B' are selected by default — add 'Seed' too.
    fireEvent.click(screen.getByRole('button', { name: 'Seed' }));

    const keywordInput = screen.getByPlaceholderText(/e\.g\. b2b, remote, security, ai/i);
    fireEvent.change(keywordInput, { target: { value: 'Fintech' } });

    fireEvent.click(screen.getByRole('button', { name: /scrape now/i }));

    await waitFor(() => expect(api.createSearch).toHaveBeenCalled());
    const payload = api.createSearch.mock.calls[0][0];
    expect(payload.advancedFilters.fundingStages).toEqual(expect.arrayContaining(['Series A', 'Series B', 'Seed']));
    expect(payload.advancedFilters.requiredKeyword).toBe('Fintech');
    expect(payload.advancedFilters.hiringSignal).toBe(true);
    await waitFor(() => expect(api.runSearch).toHaveBeenCalledWith('search-1'));
  });

  it('renders saved searches from the real API response, not placeholder data', async () => {
    api.listSearches.mockResolvedValue([
      {
        id: 'preset-1',
        name: 'My Preset',
        countries: ['United States'],
        industries: ['SaaS'],
        designations: ['VP of Sales'],
        lead_count_target: 25,
        schedule: {},
        advanced_filters: {},
      },
    ]);

    render(<LeadSearch />);

    expect(await screen.findByText('My Preset')).toBeInTheDocument();
    expect(screen.getByText(/run manually/i)).toBeInTheDocument();
  });
});
