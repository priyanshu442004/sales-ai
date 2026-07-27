import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Jobs } from '../Jobs';

const api = vi.hoisted(() => ({
  listJobs: vi.fn(),
  getJob: vi.fn(),
  cancelJob: vi.fn(),
  getLeadsForJob: vi.fn(),
  rerunJob: vi.fn(),
}));

vi.mock('../../services/sourcingApi', () => api);

const baseJob = {
  id: 'job-abcdef1234567890',
  name: 'VP of Sales in SaaS',
  status: 'Completed',
  startedAt: '2026-07-16T10:00:00Z',
  completedAt: '2026-07-16T10:05:00Z',
  duration: '5m 0s',
  triggeredBy: 'Admin User',
  logs: [
    '[10:00:01] Getting your search ready...',
    '[10:00:05] Looking for VP of Sales in SaaS (United States)',
    '[10:00:30] Done — saved 3 leads to your workspace.',
  ],
  leadsFound: 3,
  parameters: {
    countries: ['United States'],
    states: [],
    cities: [],
    industries: ['SaaS'],
    titles: ['VP of Sales'],
    limit: 5,
    sizeRange: [10, 500],
  },
  progress: { scraped: 3, target: 5 },
};

const jobMissingDuration = {
  ...baseJob,
  id: 'job-no-duration-000',
  name: 'Founders in Fintech',
  status: 'Queued',
  duration: null,
  leadsFound: 0,
  parameters: { countries: [], states: [], cities: [], industries: [], titles: [], limit: 10, sizeRange: [10, 500] },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listJobs.mockResolvedValue({ data: [baseJob, jobMissingDuration] });
  api.getLeadsForJob.mockResolvedValue({ data: [] });
});

describe('Jobs (Job Queue) page', () => {
  it('never renders raw blank values — falls back to a dash', async () => {
    render(<Jobs />);
    await screen.findByText('VP of Sales in SaaS');

    // The Queued job has no duration and no filters — must show fallback text,
    // never "undefined", "null", or an empty cell.
    expect(screen.queryByText('undefined')).not.toBeInTheDocument();
    expect(screen.queryByText('null')).not.toBeInTheDocument();
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThan(0);
  });

  it('opens the job detail in the larger modal size on row click', async () => {
    const { container } = render(<Jobs />);
    const row = await screen.findByText('VP of Sales in SaaS');
    fireEvent.click(row.closest('tr')!);

    await waitFor(() => expect(screen.getByText('Activity log')).toBeInTheDocument());
    const modalDialog = container.querySelector('.max-w-6xl');
    expect(modalDialog).not.toBeNull();
  });

  it('renders human-readable log lines with no raw array/bracket syntax', async () => {
    render(<Jobs />);
    const row = await screen.findByText('VP of Sales in SaaS');
    fireEvent.click(row.closest('tr')!);

    await waitFor(() => {
      expect(screen.getByText(/Looking for VP of Sales in SaaS \(United States\)/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/\[.*'.*'.*\]/)).not.toBeInTheDocument();
  });

  it('shows a friendly failure message, not raw technical text', async () => {
    const failedJob = {
      ...baseJob,
      id: 'job-failed-1',
      name: 'CTO in HealthTech',
      status: 'Failed',
      errors: "This search couldn't be completed. Please try again — if it keeps happening, contact support.",
      logs: ["[10:00:01] This search couldn't be completed. Please try again."],
    };
    api.listJobs.mockResolvedValue({ data: [failedJob] });

    render(<Jobs />);
    const row = await screen.findByText('CTO in HealthTech');
    fireEvent.click(row.closest('tr')!);

    expect(await screen.findByText("This Search Didn't Finish")).toBeInTheDocument();
    expect(screen.queryByText(/traceback/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no module named/i)).not.toBeInTheDocument();
  });

  it('shows an honest empty-criteria message instead of a blank box', async () => {
    render(<Jobs />);
    const row = await screen.findByText('Founders in Fintech');
    fireEvent.click(row.closest('tr')!);

    expect(await screen.findByText(/any title.*any industry.*any location/i, { selector: 'p' })).toBeInTheDocument();
  });
});
