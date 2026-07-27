import type { 
  Company, DecisionMaker, ScrapeJob, Lead, MessageDraft, 
  Sequence, Campaign, InboxThread, Template, Integration, 
  AuditLogEntry, User, ApiResponse 
} from '../types/api';

// Seeded/Hardcoded rich data to ensure high fidelity, no lorem-ipsum, and absolute professional realism.
const seedCompanies: Omit<Company, 'id'>[] = [
  { name: 'Nimbus Robotics', domain: 'nimbusrobotics.ai', logo: 'https://logo.clearbit.com/nimbusrobotics.ai', industry: 'AI & Robotics', location: 'Boston, MA', employeeCount: 180, fundingStage: 'Series B', techStack: ['React', 'Python', 'ROS', 'Kubernetes'], hiringSignals: ['Senior Robotics Engineer', 'VP of Growth'], overview: 'Nimbus Robotics specializes in building autonomous warehouse logistics bots powered by custom computer vision models.' },
  { name: 'Acme Healthtech', domain: 'acmehealth.co', logo: 'https://logo.clearbit.com/acmehealth.co', industry: 'HealthTech', location: 'San Francisco, CA', employeeCount: 45, fundingStage: 'Seed', techStack: ['Next.js', 'PostgreSQL', 'Django'], hiringSignals: ['Healthcare Sales Lead'], overview: 'Acme Healthtech provides automated billing and coding assistance for clinic operations using generative AI.' },
  { name: 'Centura Financial', domain: 'centurafinance.com', logo: 'https://logo.clearbit.com/centurafinance.com', industry: 'Fintech', location: 'New York, NY', employeeCount: 520, fundingStage: 'Public', techStack: ['Java', 'Angular', 'AWS', 'Oracle'], hiringSignals: ['Security Analyst', 'Sales Executive'], overview: 'Centura Financial offers enterprise cash-flow management and forecasting tools for multi-national corporations.' },
  { name: 'GreenGrid Solutions', domain: 'greengrid.io', logo: 'https://logo.clearbit.com/greengrid.io', industry: 'Clean Energy', location: 'Austin, TX', employeeCount: 85, fundingStage: 'Series A', techStack: ['Svelte', 'Go', 'Docker'], hiringSignals: ['Grid Integration Engineer'], overview: 'GreenGrid develops IoT hardware and software solutions to balance commercial solar panel feeds into public power grids.' },
  { name: 'Vapor Security', domain: 'vaporsec.com', logo: 'https://logo.clearbit.com/vaporsec.com', industry: 'Cybersecurity', location: 'Seattle, WA', employeeCount: 110, fundingStage: 'Series C', techStack: ['React', 'Rust', 'WebAssembly'], hiringSignals: ['B2B Sales Rep', 'Sales Engineer'], overview: 'Vapor Security provides agentless microsegmentation and identity verification for serverless cloud applications.' },
  { name: 'Starlight Retail', domain: 'starlightretail.com', logo: 'https://logo.clearbit.com/starlightretail.com', industry: 'E-commerce', location: 'Chicago, IL', employeeCount: 310, fundingStage: 'Private', techStack: ['Shopify Plus', 'Vue', 'Laravel'], hiringSignals: ['Digital Marketing Manager'], overview: 'Starlight Retail manages a portfolio of direct-to-consumer sustainable apparel brands.' },
  { name: 'Aether Logistics', domain: 'aetherlogistics.com', logo: 'https://logo.clearbit.com/aetherlogistics.com', industry: 'Logistics', location: 'Houston, TX', employeeCount: 140, fundingStage: 'Series A', techStack: ['React', 'Node.js', 'GraphQL'], hiringSignals: ['Logistics Operations Coordinator'], overview: 'Aether Logistics operates autonomous freight brokerage software to optimize empty backhauls for regional carriers.' },
  { name: 'Apex Learning', domain: 'apexlearning.com', logo: 'https://logo.clearbit.com/apexlearning.com', industry: 'EdTech', location: 'Denver, CO', employeeCount: 95, fundingStage: 'Grant', techStack: ['React', 'Ruby on Rails', 'Postgres'], hiringSignals: ['Curriculum Designer'], overview: 'Apex Learning produces corporate training software for automated cybersecurity compliance certifications.' },
  { name: 'Vortex Media', domain: 'vortexmedia.co', logo: 'https://logo.clearbit.com/vortexmedia.co', industry: 'AdTech', location: 'Los Angeles, CA', employeeCount: 75, fundingStage: 'Seed', techStack: ['React', 'Python', 'Cassandra'], hiringSignals: ['Account Executive'], overview: 'Vortex Media provides real-time programmatic ad bidding platforms tailored for connected TV applications.' },
  { name: 'Helix Genomics', domain: 'helixgenomics.com', logo: 'https://logo.clearbit.com/helixgenomics.com', industry: 'Biotech', location: 'San Diego, CA', employeeCount: 160, fundingStage: 'Series B', techStack: ['Python', 'Django', 'C++', 'AWS'], hiringSignals: ['Bioinformatics Scientist'], overview: 'Helix Genomics builds cloud databases for high-throughput gene sequencing analysis.' }
];

const firstNames = ['John', 'Priya', 'Sarah', 'David', 'Elena', 'Michael', 'Chloe', 'James', 'Aarav', 'Sophia', 'Marcus', 'Emily'];
const lastNames = ['Chen', 'Patel', 'Smith', 'O\'Connor', 'Rodriguez', 'Taylor', 'Kim', 'Johnson', 'Sharma', 'Müller', 'Davies', 'Brown'];
const designations = ['Founder & CEO', 'VP of Sales', 'Head of Growth', 'Chief Technology Officer', 'Sales Operations Manager', 'Director of Operations'];

// Generate deterministic mock data
export let dbCompanies: Company[] = [];
export let dbDecisionMakers: DecisionMaker[] = [];
export let dbLeads: Lead[] = [];
export let dbScrapeJobs: ScrapeJob[] = [];
export let dbMessageDrafts: MessageDraft[] = [];
export let dbSequences: Sequence[] = [];
export let dbCampaigns: Campaign[] = [];
export let dbInboxThreads: InboxThread[] = [];
export let dbTemplates: Template[] = [];
export let dbIntegrations: Integration[] = [];
export let dbAuditLogs: AuditLogEntry[] = [];
export let dbTeam: User[] = [];

// Initialize function
function initDatabase() {
  // 1. Team
  dbTeam = [
    { id: '1', name: 'John Doe', email: 'john@salesai.ai', role: 'Admin', status: 'Active', lastActive: '2m ago', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&h=100&q=80' },
    { id: '2', name: 'Priya Patel', email: 'priya@salesai.ai', role: 'Sales Manager', status: 'Active', lastActive: '5m ago', avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=100&h=100&q=80' },
    { id: '3', name: 'Marcus Taylor', email: 'marcus@salesai.ai', role: 'Sales Rep', status: 'Active', lastActive: '1h ago', avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=100&h=100&q=80' },
    { id: '4', name: 'Sarah O\'Connor', email: 'sarah@salesai.ai', role: 'Reviewer-only', status: 'Active', lastActive: 'Yesterday', avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=100&h=100&q=80' },
    { id: '5', name: 'Dave Kim', email: 'dave@salesai.ai', role: 'Sales Rep', status: 'Invited', lastActive: 'Never' },
  ];

  // 2. Companies & Decision-makers (Generate 45 items)
  let leadCounter = 1;
  for (let i = 0; i < 45; i++) {
    const companySeed = seedCompanies[i % seedCompanies.length];
    const companyId = `comp-${i + 1}`;
    
    // Add unique business indicators for realism
    const suffix = i >= seedCompanies.length ? ` (Branch ${Math.floor(i / seedCompanies.length) + 1})` : '';
    const companyName = companySeed.name + suffix;
    const domain = i >= seedCompanies.length 
      ? `branch${Math.floor(i / seedCompanies.length)}.${companySeed.domain}`
      : companySeed.domain;

    const company: Company = {
      id: companyId,
      name: companyName,
      domain: domain,
      logo: companySeed.logo,
      industry: companySeed.industry,
      location: companySeed.location,
      employeeCount: companySeed.employeeCount + (i * 7) % 50,
      fundingStage: companySeed.fundingStage,
      techStack: companySeed.techStack,
      hiringSignals: companySeed.hiringSignals,
      overview: companySeed.overview,
    };
    dbCompanies.push(company);

    // Decision maker
    const dmId = `dm-${i + 1}`;
    const dmFirstName = firstNames[i % firstNames.length];
    const dmLastName = lastNames[(i + 3) % lastNames.length];
    const dmDesignation = designations[i % designations.length];
    const dmName = `${dmFirstName} ${dmLastName}`;
    
    const decisionMaker: DecisionMaker = {
      id: dmId,
      name: dmName,
      designation: dmDesignation,
      companyId: companyId,
      email: `${dmFirstName.toLowerCase()}.${dmLastName.toLowerCase()}@${domain}`,
      phone: `+1 (555) ${100 + i}-${2000 + i * 17}`,
      linkedInUrl: `https://linkedin.com/in/${dmFirstName.toLowerCase()}-${dmLastName.toLowerCase()}-${i}`,
      avatarUrl: `https://images.unsplash.com/photo-${1500000000000 + i * 50000}?auto=format&fit=crop&w=100&h=100&q=80`,
      tenure: `${2 + (i % 5)} years`,
      scoreExplanation: `Lead matches ideal profile: company is in ${company.industry} and senior leader is a ${dmDesignation}. High web activity detected on target hiring posts for ${company.hiringSignals?.join(', ') || 'sales'}.`,
      notes: i % 4 === 0 ? 'Previously interacted at TechSummit 2025.' : '',
    };
    dbDecisionMakers.push(decisionMaker);

    // Lead Scoring Fit & Priority
    // Let's create varying scores
    let score = 50 + (i * 13) % 49;
    if (dmDesignation.includes('VP') || dmDesignation.includes('CEO') || dmDesignation.includes('Founder')) {
      score += 10;
    }
    if (company.fundingStage === 'Series B' || company.fundingStage === 'Series C') {
      score += 5;
    }
    score = Math.min(score, 100);

    let priority: 'High' | 'Medium' | 'Low' = 'Low';
    if (score >= 85) priority = 'High';
    else if (score >= 70) priority = 'Medium';

    // Status distribution
    let status: Lead['status'] = 'New';
    if (i % 5 === 0) status = 'Approved';
    else if (i % 7 === 0) status = 'Rejected';
    else if (i % 11 === 0) status = 'Needs Info';

    // Completeness
    const contactCompleteness = {
      email: i % 8 !== 0,
      phone: i % 4 !== 0,
      linkedIn: true
    };

    const lead: Lead = {
      id: `lead-${leadCounter++}`,
      company: company,
      decisionMaker: decisionMaker,
      score: score,
      priority: priority,
      status: status,
      activitySignals: company.hiringSignals || ['Hiring'],
      contactCompleteness: contactCompleteness,
      sourceJobId: `job-${1 + (i % 3)}`,
      sourceJobName: `Tech Sourcing - Job Q${1 + (i % 3)}`,
      dateScraped: new Date(Date.now() - (i * 4.5 * 3600000)).toISOString(),
      scoreFactors: {
        industryFit: 70 + (i * 3) % 30,
        companySize: 60 + (i * 7) % 40,
        activityStrength: 50 + (i * 9) % 50,
        seniorityMatch: dmDesignation.includes('VP') || dmDesignation.includes('CEO') ? 95 : 70,
        dataCompleteness: Object.values(contactCompleteness).filter(Boolean).length * 33,
      }
    };
    dbLeads.push(lead);
  }

  // 3. Jobs
  dbScrapeJobs = [
    {
      id: 'job-1',
      name: 'Mid-Sized AI & SaaS US Companies',
      parameters: { countries: ['United States'], industries: ['AI & Robotics', 'Cybersecurity'], titles: ['Founder & CEO', 'VP of Sales'], limit: 100, sizeRange: [50, 200] },
      status: 'Completed',
      progress: { scraped: 100, target: 100 },
      startedAt: new Date(Date.now() - 48 * 3600000).toISOString(),
      duration: '4m 12s',
      triggeredBy: 'John Doe',
      logs: [
        'Initializing API search on LinkedIn + Proxycurl...',
        'Found 124 potential matches, filter down by size (50-200)...',
        'Scraping detailed company info for 100 companies...',
        'Enriching decision-maker email addresses via Clearbit & Apollo...',
        'Validated 84 emails, 16 requires manual check.',
        'Job successfully finished. 100 leads saved.'
      ]
    },
    {
      id: 'job-2',
      name: 'Fintech Executives East Coast',
      parameters: { countries: ['United States'], industries: ['Fintech'], titles: ['Director of Operations', 'Head of Growth'], limit: 50, sizeRange: [100, 1000] },
      status: 'Running',
      progress: { scraped: 32, target: 50 },
      startedAt: new Date(Date.now() - 15 * 60000).toISOString(),
      triggeredBy: 'Priya Patel',
      logs: [
        'Fetching NAICS Fintech database filters...',
        'Proxycurl crawler initialized...',
        'Scraped company: Centura Financial. Decision maker: Elena Rodriguez.',
        'Scraped company: Helix Genomics. Decision maker: Michael Chen.',
        'Rate limit hit on People Data Labs, pausing for 2 minutes (Retry 1/3)...',
        'Resuming search. Found 32 profiles so far.'
      ]
    },
    {
      id: 'job-3',
      name: 'CleanTech EU & US Founders',
      parameters: { countries: ['Germany', 'United States'], industries: ['Clean Energy'], titles: ['Founder'], limit: 30, sizeRange: [10, 100] },
      status: 'Failed',
      progress: { scraped: 12, target: 30 },
      startedAt: new Date(Date.now() - 12 * 3600000).toISOString(),
      duration: '2m 5s',
      triggeredBy: 'Marcus Taylor',
      errors: 'Rate limited by Proxycurl — API Credit limit exceeded on active subscription plan.',
      logs: [
        'Initializing crawler...',
        'Proxycurl API key authentication succeeded.',
        'Sourcing Clean Energy founders in EU & US...',
        'Error: Rate limited by Proxycurl - credit balance is 0. Job aborted.'
      ]
    },
    {
      id: 'job-4',
      name: 'HealthTech Billing Software Sourcing',
      parameters: { countries: ['United States'], industries: ['HealthTech'], titles: ['VP of Sales', 'Chief Technology Officer'], limit: 50, sizeRange: [20, 500] },
      status: 'Queued',
      progress: { scraped: 0, target: 50 },
      startedAt: new Date(Date.now() - 5 * 60000).toISOString(),
      triggeredBy: 'Sarah O\'Connor',
      logs: ['Queued. Waiting for available crawler threads.']
    }
  ];

  // 4. Message Drafts (for Approval Queue / Studio)
  dbMessageDrafts = [
    {
      id: 'msg-1',
      leadId: 'lead-1',
      leadName: 'John Chen',
      leadCompany: 'Nimbus Robotics',
      recipient: 'john.chen@nimbusrobotics.ai',
      channel: 'email',
      type: 'Cold Email',
      subject: 'Optimizing warehouse logistics at {{company}}',
      body: `Hi John,

I noticed Nimbus Robotics is expanding its warehouse logistics fleet and currently hiring for a Senior Robotics Engineer. 

With your background at Nimbus Robotics, you know how crucial latency is in autonomous bot coordination. We help AI & Robotics firms scale their simulation pipelines and cut training cycles in half.

Would you be open to a quick 10-minute sync next Thursday?

Best,
Priya Patel`,
      generatedBy: 'AI',
      status: 'Pending Approval',
      createdAt: new Date(Date.now() - 2 * 3600000).toISOString(),
      spamScore: { score: 18, warnings: [] }
    },
    {
      id: 'msg-2',
      leadId: 'lead-2',
      leadName: 'Sarah Patel',
      leadCompany: 'Acme Healthtech',
      recipient: 'https://linkedin.com/in/sarah-patel-1',
      channel: 'linkedin',
      type: 'LinkedIn Connection Note',
      body: `Hi Sarah, congratulations on Acme Healthtech's recent seed round! Impressive traction with AI clinic billing. Love to connect and share some notes on healthcare integration bottlenecks we're seeing.`,
      generatedBy: 'AI',
      status: 'Pending Approval',
      createdAt: new Date(Date.now() - 3 * 3600000).toISOString(),
      spamScore: { score: 25, warnings: ['Looks a bit promotional for LinkedIn connect notes'] }
    },
    {
      id: 'msg-3',
      leadId: 'lead-3',
      leadName: 'Elena Rodriguez',
      leadCompany: 'Centura Financial',
      recipient: 'elena.rodriguez@centurafinance.com',
      channel: 'email',
      type: 'Cold Email',
      subject: 'Streamlining cash flow workflows for Centura Financial',
      body: `Hello Elena,

Managing enterprise cash flows at Centura Financial comes with complex audit trails. 

Our automated pipeline secures accounting synchronization, ensuring no compliance breaches occur. I would love to show you how we saved Acme Healthtech 15 hours a week.

Let me know if you have time for a short call.

Best,
Priya Patel`,
      generatedBy: 'AI',
      status: 'Pending Approval',
      createdAt: new Date(Date.now() - 4 * 3600000).toISOString(),
      spamScore: { score: 45, warnings: ['Contains trigger words: "saved", "cash flows"'] }
    },
    {
      id: 'msg-4',
      leadId: 'lead-4',
      leadName: 'David O\'Connor',
      leadCompany: 'GreenGrid Solutions',
      recipient: 'david.oconnor@greengrid.io',
      channel: 'email',
      type: 'Follow-up',
      subject: 'Re: Grid feed balance optimization',
      body: `Hi David,

Following up on my message earlier. GreenGrid Solutions is doing fantastic work balancing Commercial solar feeds. 

I'd love to drop some research on grid load forecasting we compiled. Let me know if you'd like to take a look.

Best,
Priya`,
      generatedBy: 'Manual',
      status: 'Approved',
      createdAt: new Date(Date.now() - 24 * 3600000).toISOString()
    },
    {
      id: 'msg-5',
      leadId: 'lead-5',
      leadName: 'Elena Chen',
      leadCompany: 'Vapor Security',
      recipient: 'elena.chen@vaporsec.com',
      channel: 'email',
      type: 'Proposal',
      subject: 'Security Sales AI trial — Vapor Security & Sales AI',
      body: `Hi Elena,

Attached is our customized Sales AI trial agreement, detailing the scope of integration with your serverless stack.

Looking forward to working together.`,
      generatedBy: 'Manual',
      status: 'Draft',
      createdAt: new Date(Date.now() - 36 * 3600000).toISOString()
    }
  ];

  // 5. Campaigns
  dbCampaigns = [
    {
      id: 'camp-1',
      name: 'US Robotics & AI Ops Outreach',
      status: 'Active',
      metrics: {
        sent: 142,
        delivered: 140,
        opened: 98,
        replied: 24,
        bounced: 2,
        linkedInAccepted: 45,
        meetingsBooked: 8
      },
      createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
      recipientStatus: [
        { leadId: 'lead-1', leadName: 'John Chen', companyName: 'Nimbus Robotics', status: 'Opened', lastUpdated: '2h ago' },
        { leadId: 'lead-11', leadName: 'Priya Rodriguez', companyName: 'Apex Learning', status: 'Replied', lastUpdated: '1d ago' },
        { leadId: 'lead-12', leadName: 'Sarah Davies', companyName: 'Vortex Media', status: 'Sent', lastUpdated: '4h ago' },
        { leadId: 'lead-13', leadName: 'Elena Davies', companyName: 'Helix Genomics', status: 'Bounced', lastUpdated: '2d ago' },
      ]
    },
    {
      id: 'camp-2',
      name: 'CleanTech Founders Expansion Q3',
      status: 'Active',
      metrics: {
        sent: 85,
        delivered: 84,
        opened: 61,
        replied: 12,
        bounced: 1,
        linkedInAccepted: 28,
        meetingsBooked: 3
      },
      createdAt: new Date(Date.now() - 15 * 86400000).toISOString(),
      recipientStatus: [
        { leadId: 'lead-4', leadName: 'David O\'Connor', companyName: 'GreenGrid Solutions', status: 'Replied', lastUpdated: '3h ago' },
        { leadId: 'lead-14', leadName: 'Michael Sharma', companyName: 'Starlight Retail', status: 'Delivered', lastUpdated: '5h ago' }
      ]
    },
    {
      id: 'camp-3',
      name: 'Mid-Market Cybersecurity Outreach',
      status: 'Paused',
      metrics: {
        sent: 210,
        delivered: 205,
        opened: 112,
        replied: 18,
        bounced: 5,
        linkedInAccepted: 62,
        meetingsBooked: 5
      },
      createdAt: new Date(Date.now() - 45 * 86400000).toISOString(),
      recipientStatus: []
    }
  ];

  // 6. Sequences
  dbSequences = [
    {
      id: 'seq-1',
      name: 'Default SaaS VP Sales Pitch',
      status: 'active',
      enrolledLeadsCount: 42,
      conversionMetrics: { sent: 120, replied: 18, meetings: 5 },
      exitConditions: { replyReceived: true, meetingBooked: true, unsubscribed: true },
      steps: [
        { id: 'step-1', stepNumber: 1, type: 'email', templateId: 'temp-1', subject: 'Speeding up outreach at {{company}}', body: 'Hi {{first_name}}, I noticed you manage growth at {{company}}...' },
        { id: 'step-2', stepNumber: 2, type: 'delay', delayDays: 3 },
        { id: 'step-3', stepNumber: 3, type: 'linkedin_connect', body: 'Hi {{first_name}}, loved your recent posts on Sales Ops. Let\'s connect.' },
        { id: 'step-4', stepNumber: 4, type: 'delay', delayDays: 4 },
        { id: 'step-5', stepNumber: 5, type: 'email', subject: 'Quick resources for {{company}} sales ops', body: 'Hi {{first_name}}, following up on my previous note. Thought you might find this study useful...' }
      ]
    },
    {
      id: 'seq-2',
      name: 'Founder Cold Outreach (Funding Signal)',
      status: 'active',
      enrolledLeadsCount: 15,
      conversionMetrics: { sent: 32, replied: 8, meetings: 2 },
      exitConditions: { replyReceived: true, meetingBooked: true, unsubscribed: true },
      steps: [
        { id: 'seq2-s1', stepNumber: 1, type: 'email', templateId: 'temp-2', subject: 'Congrats on the funding + expansion!', body: 'Hi {{first_name}}, saw the news about {{company}}\'s latest milestones...' },
        { id: 'seq2-s2', stepNumber: 2, type: 'delay', delayDays: 2 },
        { id: 'seq2-s3', stepNumber: 3, type: 'linkedin_message', body: 'Hey {{first_name}} - dropping in to say congrats! Hope the scaling is going smoothly.' }
      ]
    },
    {
      id: 'seq-3',
      name: 'Re-engagement Sequence',
      status: 'draft',
      enrolledLeadsCount: 0,
      conversionMetrics: { sent: 0, replied: 0, meetings: 0 },
      exitConditions: { replyReceived: true, meetingBooked: true, unsubscribed: false },
      steps: [
        { id: 'seq3-s1', stepNumber: 1, type: 'email', subject: 'New B2B features for Q3', body: 'Hi {{first_name}}, we recently launched some upgrades that might interest {{company}}...' }
      ]
    }
  ];

  // 7. Inbox Threads
  dbInboxThreads = [
    {
      id: 'th-1',
      leadId: 'lead-1',
      leadName: 'John Chen',
      companyName: 'Nimbus Robotics',
      subject: 'Optimizing warehouse logistics at Nimbus Robotics',
      channel: 'email',
      lastMessageSnippet: 'Thanks for reaching out. Thursday works. Is 2 PM EST fine?',
      lastMessageTime: '2h ago',
      unread: true,
      sentiment: 'Positive',
      messages: [
        { id: 'm1-1', direction: 'outbound', body: 'Hi John, I noticed Nimbus Robotics is expanding its warehouse logistics fleet...', timestamp: '1d ago', senderName: 'Priya Patel' },
        { id: 'm1-2', direction: 'inbound', body: 'Thanks for reaching out. Thursday works. Is 2 PM EST fine? Can you send an invite?', timestamp: '2h ago', senderName: 'John Chen' }
      ]
    },
    {
      id: 'th-2',
      leadId: 'lead-4',
      leadName: 'David O\'Connor',
      companyName: 'GreenGrid Solutions',
      subject: 'Re: Grid feed balance optimization',
      channel: 'email',
      lastMessageSnippet: 'Unsubscribe me from these emails.',
      lastMessageTime: '3h ago',
      unread: false,
      sentiment: 'Negative',
      messages: [
        { id: 'm2-1', direction: 'outbound', body: 'Hi David, GreenGrid Solutions is doing fantastic work balancing...', timestamp: '2d ago', senderName: 'Priya Patel' },
        { id: 'm2-2', direction: 'inbound', body: 'Unsubscribe me from these emails. Not interested.', timestamp: '3h ago', senderName: 'David O\'Connor' }
      ]
    },
    {
      id: 'th-3',
      leadId: 'lead-2',
      leadName: 'Sarah Patel',
      companyName: 'Acme Healthtech',
      channel: 'linkedin',
      lastMessageSnippet: 'Hey Priya, happy to connect. Let me know when you have time for a call.',
      lastMessageTime: '1d ago',
      unread: true,
      sentiment: 'Positive',
      messages: [
        { id: 'm3-1', direction: 'outbound', body: 'Hi Sarah, congratulations on Acme Healthtech\'s recent seed round! Let\'s connect.', timestamp: '2d ago', senderName: 'Priya Patel' },
        { id: 'm3-2', direction: 'inbound', body: 'Hey Priya, happy to connect. Let me know when you have time for a call next week.', timestamp: '1d ago', senderName: 'Sarah Patel' }
      ]
    },
    {
      id: 'th-4',
      leadId: 'lead-11',
      leadName: 'Priya Rodriguez',
      companyName: 'Apex Learning',
      subject: 'Congrats on the funding + expansion!',
      channel: 'email',
      lastMessageSnippet: 'Is this tool HIPAA compliant?',
      lastMessageTime: '2d ago',
      unread: false,
      sentiment: 'Neutral',
      messages: [
        { id: 'm4-1', direction: 'outbound', body: 'Hi Priya, saw the news about Apex Learning\'s latest milestones...', timestamp: '3d ago', senderName: 'Priya Patel' },
        { id: 'm4-2', direction: 'inbound', body: 'Thanks. We are scaling rapidly. Quick question: is your outreach tracking and storage HIPAA compliant? Our healthcare compliance is strict.', timestamp: '2d ago', senderName: 'Priya Rodriguez' }
      ]
    }
  ];

  // 8. Templates
  dbTemplates = [
    { id: 'temp-1', name: 'Cold Introduction (High Score)', type: 'Email', subject: 'Speeding up outreach at {{company}}', body: `Hi {{first_name}},

I noticed {{company}} has been expanding its operations and recently hired in {{industry}}.

With your team's size of {{employeeCount}}, coordination is key. We help growth leaders automate decision-maker enrichment.

Do you have 10 minutes to discuss?

Best,
{{sender_name}}`, lastUsed: '3h ago', replyRate: 24.5, tags: ['Cold Outreach', 'SaaS'] },
    { id: 'temp-2', name: 'LinkedIn Connect Request (Funding)', type: 'LinkedIn', body: `Hi {{first_name}}, congrats on {{company}}'s recent funding! Love what you're building in {{industry}}. Let's connect.`, lastUsed: '5h ago', replyRate: 42.1, tags: ['LinkedIn', 'Funding'] },
    { id: 'temp-3', name: 'Outreach Follow-up (3 Days)', type: 'Follow-up', subject: 'Re: Sourcing tools at {{company}}', body: `Hi {{first_name}}, following up on my previous note. I know you're busy scaling {{company}}. Just wanted to drop a quick link on how similar teams automate outbound checks. Let me know if that's interesting.`, lastUsed: '1d ago', replyRate: 12.8, tags: ['Follow-up'] },
    { id: 'temp-4', name: 'Enterprise Pilot Agreement Proposal', type: 'Proposal', subject: 'Pipeline B2B Pilot Trial — {{company}}', body: `Hi {{first_name}},\n\nAs discussed, here is the proposal outline for our enterprise pilot trial with {{company}}...`, lastUsed: '3d ago', replyRate: 85.0, tags: ['Closing', 'Proposal'] }
  ];

  // 9. Integrations
  dbIntegrations = [
    { id: 'int-1', name: 'Apollo.io', category: 'data_provider', connected: true, lastSyncedAt: '12m ago', icon: 'zap', description: 'B2B contact database and direct emails.', quota: { used: 840, limit: 2000, unit: 'credits' } },
    { id: 'int-2', name: 'Proxycurl (LinkedIn API)', category: 'data_provider', connected: true, lastSyncedAt: '1h ago', icon: 'link', description: 'Crawler for rich LinkedIn profile/company data.', quota: { used: 312, limit: 1000, unit: 'lookups' } },
    { id: 'int-3', name: 'SMTP / Google Workspace', category: 'outbound', connected: true, lastSyncedAt: '5m ago', icon: 'mail', description: 'Outbound email sending provider.', quota: { used: 142, limit: 500, unit: 'emails/day' } },
    { id: 'int-4', name: 'Unipile (LinkedIn API)', category: 'outbound', connected: true, lastSyncedAt: '20m ago', icon: 'linkedin', description: 'Send LinkedIn direct messages and connection notes.', quota: { used: 73, limit: 150, unit: 'notes/day' } },
    { id: 'int-5', name: 'HubSpot CRM Sync', category: 'crm', connected: false, icon: 'refresh-cw', description: 'Push enriched and approved contacts directly into your CRM.' },
    { id: 'int-6', name: 'Salesforce CRM Sync', category: 'crm', connected: false, icon: 'database', description: 'Enterprise bidirectional synchronization for leads.' }
  ];

  // 10. Audit Logs
  dbAuditLogs = [
    { id: 'log-1', timestamp: '2026-07-15T16:45:00Z', actorName: 'Priya Patel', actorEmail: 'priya@salesai.ai', action: 'Approved outreach message', category: 'OUTBOUND', targetEntityLink: '#', targetEntityName: 'Cold Email to John Chen (Nimbus Robotics)', ipAddress: '192.168.1.45', deviceMetadata: 'Chrome on macOS (14.5)' },
    { id: 'log-2', timestamp: '2026-07-15T15:30:00Z', actorName: 'Priya Patel', actorEmail: 'priya@salesai.ai', action: 'Approved Lead', category: 'WORKSPACE', targetEntityLink: '#', targetEntityName: 'Elena Rodriguez (Centura Financial)', ipAddress: '192.168.1.45', deviceMetadata: 'Chrome on macOS (14.5)' },
    { id: 'log-3', timestamp: '2026-07-15T14:15:00Z', actorName: 'John Doe', actorEmail: 'john@salesai.ai', action: 'Started scrape job', category: 'SCRAPE', targetEntityLink: '#', targetEntityName: 'Fintech Executives East Coast', ipAddress: '107.12.44.89', deviceMetadata: 'Firefox on Windows (11.0)' },
    { id: 'log-4', timestamp: '2026-07-15T11:00:00Z', actorName: 'Marcus Taylor', actorEmail: 'marcus@salesai.ai', action: 'Rejected Lead', category: 'WORKSPACE', targetEntityLink: '#', targetEntityName: 'GreenGrid Solutions (David O\'Connor)', ipAddress: '198.51.100.2', deviceMetadata: 'Safari on iPhone (iOS 17.5)' },
    { id: 'log-5', timestamp: '2026-07-15T09:20:00Z', actorName: 'John Doe', actorEmail: 'john@salesai.ai', action: 'Created new campaign', category: 'WORKSPACE', targetEntityLink: '#', targetEntityName: 'CleanTech Founders Expansion Q3', ipAddress: '107.12.44.89', deviceMetadata: 'Firefox on Windows (11.0)' },
    { id: 'log-6', timestamp: '2026-07-15T08:00:00Z', actorName: 'Priya Patel', actorEmail: 'priya@salesai.ai', action: 'Updated CRM settings', category: 'WORKSPACE', targetEntityLink: '#', targetEntityName: 'Hubspot Connection', ipAddress: '192.168.1.45', deviceMetadata: 'Chrome on macOS (14.5)' }
  ];
}

initDatabase();

// Simulates API network delay
const delay = (ms: number = 500) => new Promise(res => setTimeout(res, ms));

const BACKEND_URL = 'http://localhost:8000/api/v1';

async function fetchFromBackend(path: string, options: RequestInit = {}): Promise<any> {
  const token = localStorage.getItem('sales_ai_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };
  
  const response = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers
  });
  
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'API Error' }));
    throw new Error(err.detail || 'API Error');
  }
  
  return response.json();
}

// Database CRUD Actions imitating REST endpoints
export const mockApi = {
  // Auth
  login: async (credentials: any) => {
    try {
      const res = await fetchFromBackend('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: credentials.email, password: credentials.password })
      });
      if (res.access_token) {
        localStorage.setItem('sales_ai_token', res.access_token);
        localStorage.setItem('sales_ai_user', JSON.stringify(res.user));
      }
      return res;
    } catch (e) {
      console.warn("Backend authentication offline, falling back to mock credentials.", e);
      await delay(400);
      if (credentials.email === 'admin@gmail.com' && credentials.password === 'admin') {
        const user = dbTeam.find(u => u.email === 'priya@salesai.ai') || dbTeam[1];
        const adminUser = { ...user, email: 'admin@gmail.com', name: 'Admin User', role: 'Admin' };
        return { token: 'mock-jwt-token-123', user: adminUser };
      }
      throw new Error("Invalid credentials or backend down.");
    }
  },

  changePassword: async (passwords: any) => {
    return await fetchFromBackend('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        current_password: passwords.currentPassword,
        new_password: passwords.newPassword
      })
    });
  },

  // Team
  getTeam: async (): Promise<ApiResponse<User>> => {
    try {
      return await fetchFromBackend('/team');
    } catch (e) {
      console.warn("Backend /team offline, fallback to mock DB", e);
      await delay(300);
      return { data: dbTeam, page: 1, pageSize: 20, total: dbTeam.length };
    }
  },
  
  inviteTeammate: async (teammate: Partial<User>) => {
    try {
      return await fetchFromBackend('/team', {
        method: 'POST',
        body: JSON.stringify(teammate)
      });
    } catch (e) {
      console.warn("Backend /team invite offline, fallback to mock DB", e);
      await delay(500);
      const newUser: User = {
        id: `user-${Date.now()}`,
        name: teammate.name || teammate.email?.split('@')[0] || 'New User',
        email: teammate.email || '',
        role: teammate.role || 'Sales Rep',
        status: 'Invited',
        lastActive: 'Never'
      };
      dbTeam.push(newUser);
      return newUser;
    }
  },

  // Leads Sourcing & Search
  createSearch: async (params: any) => {
    try {
      return await fetchFromBackend('/searches', {
        method: 'POST',
        body: JSON.stringify({
          name: params.name,
          countries: params.countries || [],
          states: params.states || [],
          cities: params.cities || [],
          industries: params.industries || [],
          designations: params.titles || [],
          lead_count_target: params.limit || 50,
          company_size_min: 10,
          company_size_max: 500,
          advanced_filters: {},
          schedule: params.schedule || {}
        })
      });
    } catch (e) {
      console.warn("Backend createSearch offline, fallback to mock DB", e);
      await delay(300);
      return { id: `search-${Date.now()}`, ...params };
    }
  },

  listSearches: async () => {
    try {
      return await fetchFromBackend('/searches');
    } catch (e) {
      console.warn("Backend listSearches offline, fallback to empty list", e);
      return [];
    }
  },

  deleteSearch: async (id: string) => {
    try {
      return await fetchFromBackend(`/searches/${id}`, {
        method: 'DELETE'
      });
    } catch (e) {
      console.warn("Backend deleteSearch offline, fallback to success", e);
      return { success: true };
    }
  },

  estimateSearch: async (params: { countries: string[], states: string[], cities: string[], industries: string[], titles: string[] }) => {
    try {
      return await fetchFromBackend('/searches/estimate', {
        method: 'POST',
        body: JSON.stringify({
          countries: params.countries,
          states: params.states,
          cities: params.cities,
          industries: params.industries,
          designations: params.titles
        })
      });
    } catch (e) {
      console.warn("Backend estimateSearch offline, fallback", e);
      let base = 5000;
      if (params.countries.length > 0) base = base * (params.countries.length * 0.8);
      base = base * (params.industries.length * 0.7);
      base = base * (params.titles.length * 0.6);
      return {
        match_count: Math.max(Math.floor(base), 12),
        preview_companies: [
          { name: 'Nimbus Robotics', size: '180 employees', domain: 'nimbusrobotics.ai', match: '95%' },
          { name: 'Aether Logistics', size: '140 employees', domain: 'aetherlogistics.com', match: '92%' },
          { name: 'GreenGrid Solutions', size: '85 employees', domain: 'greengrid.io', match: '88%' }
        ]
      };
    }
  },

  runSearch: async (params: any) => {
    try {
      const searchRes = await fetchFromBackend('/searches', {
        method: 'POST',
        body: JSON.stringify({
          name: params.name || `Sourcing in ${params.industries?.join('/') || 'All Industries'}`,
          countries: params.countries || [],
          states: params.states || [],
          cities: params.cities || [],
          industries: params.industries || [],
          designations: params.titles || [],
          lead_count_target: params.limit || 50,
          company_size_min: params.sizeRange?.[0] || 10,
          company_size_max: params.sizeRange?.[1] || 500,
          advanced_filters: {},
          schedule: {}
        })
      });
      return await fetchFromBackend(`/searches/${searchRes.id}/run`, {
        method: 'POST'
      });
    } catch (e) {
      console.warn("Backend search trigger offline, fallback to simulator", e);
      await delay(800);
      const newJob: ScrapeJob = {
        id: `job-${Date.now()}`,
        name: `Sourcing ${params.titles?.join('/') || 'Leads'} in ${params.industries?.join('/') || 'All Industries'}`,
        parameters: {
          countries: params.countries || ['United States'],
          industries: params.industries || ['SaaS'],
          titles: params.titles || ['VP of Sales'],
          limit: params.limit || 50,
          sizeRange: params.sizeRange || [10, 100],
        },
        status: 'Queued',
        progress: { scraped: 0, target: params.limit || 50 },
        startedAt: new Date().toISOString(),
        triggeredBy: 'Priya Patel',
        logs: ['Job scheduled.', 'Awaiting queue worker threads.']
      };
      dbScrapeJobs.unshift(newJob);

      setTimeout(() => {
        newJob.status = 'Running';
        newJob.logs.push('Vetted connections initialized.');
        newJob.progress.scraped = Math.floor(newJob.progress.target / 3);
        
        setTimeout(() => {
          newJob.status = 'Completed';
          newJob.progress.scraped = newJob.progress.target;
          newJob.duration = '1m 24s';
          newJob.logs.push('Sourcing profiles completed successfully.');
        }, 5000);
      }, 2000);

      return newJob;
    }
  },

  // Jobs Queue
  getJobs: async (): Promise<ApiResponse<ScrapeJob>> => {
    try {
      return await fetchFromBackend('/jobs');
    } catch (e) {
      console.warn("Backend /jobs offline, fallback to mock DB", e);
      await delay(300);
      return { data: [...dbScrapeJobs], page: 1, pageSize: 20, total: dbScrapeJobs.length };
    }
  },

  cancelJob: async (id: string) => {
    try {
      return await fetchFromBackend(`/jobs/${id}/cancel`, {
        method: 'POST'
      });
    } catch (e) {
      console.warn("Backend cancelJob offline, fallback to mock DB", e);
      await delay(200);
      const job = dbScrapeJobs.find(j => j.id === id);
      if (job) {
        job.status = 'Failed';
        job.errors = 'Cancelled by user command.';
        job.logs.push('Job terminated abruptly by administrator command.');
      }
      return { success: true };
    }
  },

  // Leads Validation
  getLeads: async (jobId?: string): Promise<ApiResponse<Lead>> => {
    try {
      const url = jobId ? `/leads?job_id=${jobId}` : '/leads';
      return await fetchFromBackend(url);
    } catch (e) {
      console.warn("Backend /leads offline, fallback to mock DB", e);
      await delay(400);
      let filtered = [...dbLeads];
      if (jobId) {
        filtered = filtered.filter(l => l.id.includes(jobId));
      }
      return { data: filtered, page: 1, pageSize: filtered.length, total: filtered.length };
    }
  },

  updateLeadStatus: async (leadId: string, status: Lead['status']) => {
    try {
      return await fetchFromBackend(`/leads/${leadId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
    } catch (e) {
      console.warn("Backend /leads patch status offline, fallback to mock DB", e);
      await delay(200);
      const lead = dbLeads.find(l => l.id === leadId);
      if (lead) {
        lead.status = status;
        if (status === 'Approved' && !dbMessageDrafts.some(m => m.leadId === leadId)) {
          const draft: MessageDraft = {
            id: `msg-${Date.now()}`,
            leadId: lead.id,
            leadName: lead.decisionMaker.name,
            leadCompany: lead.company.name,
            recipient: lead.decisionMaker.email || '',
            channel: 'email',
            type: 'Cold Email',
            subject: `Speeding up outreach at ${lead.company.name}`,
            body: `Hi ${lead.decisionMaker.name},\n\nI was reviewing ${lead.company.name} and noticed your team size of ${lead.company.employeeCount} is actively hiring. Under your leadership as ${lead.decisionMaker.designation}, I thought you might appreciate a custom data automation demo.\n\nLet me know if next week works for a call.\n\nBest,\nPriya Patel`,
            generatedBy: 'AI',
            status: 'Draft',
            createdAt: new Date().toISOString()
          };
          dbMessageDrafts.unshift(draft);
        }
      }
      return { success: true };
    }
  },

  updateLeadNotes: async (leadId: string, notes: string) => {
    try {
      return await fetchFromBackend(`/leads/${leadId}`, {
        method: 'PATCH',
        body: JSON.stringify({ notes })
      });
    } catch (e) {
      console.warn("Backend /leads patch notes offline, fallback to mock DB", e);
      await delay(100);
      const lead = dbLeads.find(l => l.id === leadId);
      if (lead && lead.decisionMaker) {
        lead.decisionMaker.notes = notes;
      }
      return lead;
    }
  },

  approveMessage: async (msgId: string) => {
    try {
      await fetchFromBackend(`/messages/${msgId}/approve`, { method: 'POST' });
      return await fetchFromBackend(`/messages/${msgId}/send`, { method: 'POST' });
    } catch (e) {
      console.warn("Backend approve message offline, fallback to simulator", e);
      await delay(350);
      const msg = dbMessageDrafts.find(m => m.id === msgId);
      if (msg) {
        msg.status = 'Approved';
        setTimeout(() => {
          msg.status = 'Sent';
        }, 3000);
      }
      return { success: true, msgId };
    }
  },

  rejectMessage: async (msgId: string) => {
    try {
      return await fetchFromBackend(`/messages/${msgId}/reject`, { method: 'POST' });
    } catch (e) {
      console.warn("Backend reject message offline, fallback to mock DB", e);
      await delay(200);
      const msg = dbMessageDrafts.find(m => m.id === msgId);
      if (msg) {
        msg.status = 'Rejected';
      }
      return { success: true, msgId };
    }
  },

  saveMessage: async (msgId: string, subject: string, body: string) => {
    try {
      return await fetchFromBackend(`/messages/${msgId}`, {
        method: 'PATCH',
        body: JSON.stringify({ subject, body })
      });
    } catch (e) {
      console.warn("Backend save message offline, fallback to mock DB", e);
      await delay(300);
      const msg = dbMessageDrafts.find(m => m.id === msgId);
      if (msg) {
        msg.subject = subject;
        msg.body = body;
      }
      return msg;
    }
  },

  generateAiMessage: async (leadId: string, tone: string, type: string) => {
    try {
      return await fetchFromBackend('/messages/generate', {
        method: 'POST',
        body: JSON.stringify({ leadId, type, tone })
      });
    } catch (e) {
      console.warn("Backend generate AI message offline, fallback to templates", e);
      await delay(800);
      const lead = dbLeads.find(l => l.id === leadId);
      if (!lead) throw new Error('Lead not found');

      const sub = type === 'LinkedIn Connection Note' ? undefined : `Scaling outreach at ${lead.company.name}`;
      const body = type === 'LinkedIn Connection Note'
        ? `Hi ${lead.decisionMaker.name}, saw you are leading growth at ${lead.company.name}. Let's connect!`
        : `Hi ${lead.decisionMaker.name},\n\nI was reviewing ${lead.company.name} and noticed your team size of ${lead.company.employeeCount} is actively hiring. Let's talk.\n\nBest,\nPriya Patel`;

      return { subject: sub, body };
    }
  },

  // Campaigns & Sequences
  getCampaigns: async (): Promise<ApiResponse<Campaign>> => {
    try {
      return await fetchFromBackend('/campaigns');
    } catch (e) {
      console.warn("Backend /campaigns offline, fallback to mock DB", e);
      await delay(300);
      return { data: dbCampaigns, page: 1, pageSize: 10, total: dbCampaigns.length };
    }
  },

  getSequences: async (): Promise<ApiResponse<Sequence>> => {
    try {
      return await fetchFromBackend('/sequences');
    } catch (e) {
      console.warn("Backend /sequences offline, fallback to mock DB", e);
      await delay(300);
      return { data: dbSequences, page: 1, pageSize: 10, total: dbSequences.length };
    }
  },

  updateSequence: async (seq: Sequence) => {
    try {
      return await fetchFromBackend('/sequences', {
        method: 'POST',
        body: JSON.stringify(seq)
      });
    } catch (e) {
      console.warn("Backend save sequence offline, fallback to mock DB", e);
      await delay(300);
      const idx = dbSequences.findIndex(s => s.id === seq.id);
      if (idx !== -1) {
        dbSequences[idx] = seq;
      }
      return seq;
    }
  },

  // Unified Inbox
  getInbox: async (): Promise<ApiResponse<InboxThread>> => {
    try {
      return await fetchFromBackend('/inbox/conversations');
    } catch (e) {
      console.warn("Backend inbox offline, fallback to mock DB", e);
      await delay(450);
      return { data: dbInboxThreads, page: 1, pageSize: 20, total: dbInboxThreads.length };
    }
  },

  sendInboxReply: async (threadId: string, body: string) => {
    try {
      return await fetchFromBackend(`/inbox/conversations/${threadId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ body })
      });
    } catch (e) {
      console.warn("Backend send inbox reply offline, fallback to mock DB", e);
      await delay(300);
      const thread = dbInboxThreads.find(t => t.id === threadId);
      if (thread) {
        thread.messages.push({
          id: `reply-${Date.now()}`,
          direction: 'outbound',
          body,
          timestamp: 'Just now',
          senderName: 'Priya Patel'
        });
        thread.lastMessageSnippet = body;
        thread.unread = false;
      }
      return thread;
    }
  },

  setThreadSentiment: async (threadId: string, sentiment: InboxThread['sentiment']) => {
    try {
      return await fetchFromBackend(`/inbox/conversations/${threadId}/sentiment`, {
        method: 'POST',
        body: JSON.stringify({ sentiment })
      });
    } catch (e) {
      console.warn("Backend sentiment update offline, fallback to mock DB", e);
      await delay(100);
      const thread = dbInboxThreads.find(t => t.id === threadId);
      if (thread) {
        thread.sentiment = sentiment;
      }
      return thread;
    }
  },

  // Templates
  getTemplates: async (): Promise<ApiResponse<Template>> => {
    try {
      return await fetchFromBackend('/templates');
    } catch (e) {
      console.warn("Backend /templates offline, fallback to mock DB", e);
      await delay(250);
      return { data: dbTemplates, page: 1, pageSize: 20, total: dbTemplates.length };
    }
  },

  saveTemplate: async (template: Partial<Template>) => {
    try {
      return await fetchFromBackend('/templates', {
        method: 'POST',
        body: JSON.stringify(template)
      });
    } catch (e) {
      console.warn("Backend save template offline, fallback to mock DB", e);
      await delay(300);
      if (template.id) {
        const idx = dbTemplates.findIndex(t => t.id === template.id);
        if (idx !== -1) {
          dbTemplates[idx] = { ...dbTemplates[idx], ...template } as Template;
          return dbTemplates[idx];
        }
      }
      const newTemp: Template = {
        id: `temp-${Date.now()}`,
        name: template.name || 'New Template',
        type: template.type || 'Email',
        subject: template.subject,
        body: template.body || '',
        lastUsed: 'Never',
        tags: template.tags || [],
        replyRate: 0
      };
      dbTemplates.push(newTemp);
      return newTemp;
    }
  },

  // Integrations
  getIntegrations: async (): Promise<ApiResponse<Integration>> => {
    try {
      return await fetchFromBackend('/integrations');
    } catch (e) {
      console.warn("Backend /integrations offline, fallback to mock DB", e);
      await delay(250);
      return { data: dbIntegrations, page: 1, pageSize: 20, total: dbIntegrations.length };
    }
  },

  toggleIntegration: async (id: string, connected: boolean) => {
    try {
      return await fetchFromBackend(`/integrations/${id}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ connected })
      });
    } catch (e) {
      console.warn("Backend integration toggle offline, fallback to mock DB", e);
      await delay(400);
      const integration = dbIntegrations.find(i => i.id === id);
      if (integration) {
        integration.connected = connected;
      }
      return integration;
    }
  },

  // Audit Logs
  getAuditLogs: async (): Promise<ApiResponse<AuditLogEntry>> => {
    try {
      return await fetchFromBackend('/audit-log');
    } catch (e) {
      console.warn("Backend /audit-log offline, fallback to mock DB", e);
      await delay(200);
      return { data: dbAuditLogs, page: 1, pageSize: 50, total: dbAuditLogs.length };
    }
  }
};
