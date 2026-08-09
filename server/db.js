const fs = require('fs');
const path = require('path');

// Support Vercel serverless environment (/tmp directory)
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true' || !!process.env.VERCEL_ENV;
const DB_FILE = isVercel ? path.join('/tmp', 'data_store.json') : path.join(__dirname, 'data_store.json');

// In-memory fallback cache
let memoryData = null;

// Initial schema structure
const defaultData = {
  users: [],
  meetings: [],
  actionItems: [],
  voiceNotes: [],
  videoNotes: [],
  qaHistory: []
};

// Ensure data directory exists
function loadData() {
  try {
    if (memoryData) return memoryData;
    if (!fs.existsSync(DB_FILE)) {
      try {
        fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2));
      } catch (e) {}
      memoryData = JSON.parse(JSON.stringify(defaultData));
      return memoryData;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    memoryData = JSON.parse(raw);
    return memoryData;
  } catch (err) {
    console.error('Error reading DB file, creating fresh:', err);
    if (!memoryData) memoryData = JSON.parse(JSON.stringify(defaultData));
    return memoryData;
  }
}

function saveData(data) {
  memoryData = data;
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error saving DB file (using in-memory cache):', err.message);
  }
}

// Seed default demo user and sample meeting if empty
function seedIfEmpty() {
  const data = loadData();
  let changed = false;

  if (data.users.length === 0) {
    const bcrypt = require('bcryptjs');
    const demoPasswordHash = bcrypt.hashSync('password123', 10);
    const demoUser = {
      id: 'usr_demo_101',
      email: 'alex@company.com',
      name: 'Alex Rivera',
      role: 'Product Lead',
      passwordHash: demoPasswordHash,
      createdAt: new Date().toISOString()
    };
    data.users.push(demoUser);
    changed = true;

    // Seed Sample Meeting 1
    const m1Id = 'm_q4_planning_2026';
    const sampleMeeting1 = {
      id: m1Id,
      userId: demoUser.id,
      title: 'Q4 Product Roadmap & Sprint Alignment',
      type: 'Strategy',
      date: '2026-08-05T14:00:00.000Z',
      duration: '34 mins',
      status: 'transcribed',
      createdAt: '2026-08-05T14:00:00.000Z',
      summary: 'The product team reviewed Q4 commitments, focusing on backend performance optimization, client dashboard redesign, and enterprise Slack/Teams integrations. Sarah committed to finalizing the database migration plan by next Tuesday, while Marcus will complete API security audits.',
      keyDecisions: [
        'Migrate legacy auth to OAuth2 + JWT with 15-minute token refresh.',
        'Target Q4 launch for enterprise Slack notification webhooks.',
        'Allocate 2 weeks of sprint time to backend query performance tuning.'
      ],
      sentiment: {
        score: 92,
        label: 'Highly Positive & Productive',
        breakdown: { positive: 80, neutral: 15, constructive: 5 },
        highlights: [
          'High alignment on sprint priorities and team ownership.',
          'Constructive debate on caching strategy resolved quickly.'
        ]
      },
      transcript: [
        { speaker: 'Alex Rivera (Host)', time: '00:00', text: 'Welcome everyone! Today we are aligning on our Q4 roadmap priorities and assign clear deliverables.' },
        { speaker: 'Sarah Chen (Lead Architect)', time: '02:15', text: 'On the architecture side, I commit to finishing the database migration blueprint by next Tuesday so engineering can review it.' },
        { speaker: 'Marcus Vance (DevOps)', time: '06:40', text: 'Great. I will handle the API security audit and rate-limiting updates by Thursday next week.' },
        { speaker: 'Sarah Chen (Lead Architect)', time: '12:10', text: 'We also agreed that OAuth2 JWT session refreshes should be enforced for all enterprise customers.' },
        { speaker: 'Alex Rivera (Host)', time: '28:30', text: 'Awesome. Let us document these action items and sync with design tomorrow. Thanks team!' }
      ]
    };

    data.meetings.push(sampleMeeting1);

    // Seed Action Items
    data.actionItems.push(
      {
        id: 'act_101',
        meetingId: m1Id,
        userId: demoUser.id,
        title: 'Finalize database migration blueprint',
        owner: 'Sarah Chen',
        deadline: '2026-08-11',
        priority: 'high',
        status: 'in_progress',
        syncedToSlack: true,
        syncedToEmail: false,
        createdAt: '2026-08-05T14:35:00.000Z'
      },
      {
        id: 'act_102',
        meetingId: m1Id,
        userId: demoUser.id,
        title: 'Complete API security audit & rate-limiting',
        owner: 'Marcus Vance',
        deadline: '2026-08-13',
        priority: 'high',
        status: 'todo',
        syncedToSlack: false,
        syncedToEmail: true,
        createdAt: '2026-08-05T14:35:00.000Z'
      },
      {
        id: 'act_103',
        meetingId: m1Id,
        userId: demoUser.id,
        title: 'Draft UX mockups for Slack webhook integration',
        owner: 'Alex Rivera',
        deadline: '2026-08-14',
        priority: 'medium',
        status: 'done',
        syncedToSlack: true,
        syncedToEmail: true,
        createdAt: '2026-08-05T14:35:00.000Z'
      }
    );

    // Seed Sample Voice Note
    data.voiceNotes.push({
      id: 'vn_101',
      userId: demoUser.id,
      title: 'Quick Voice Memo: Enterprise Pricing Discussion',
      duration: '45s',
      transcript: 'Reminder to update the enterprise billing tier docs before Friday. Need Sarah to check compliance clause for SOC2.',
      summary: 'Quick reminder regarding enterprise billing documentation updates and SOC2 compliance check.',
      actionItems: [
        { title: 'Update enterprise billing tier documentation', owner: 'Alex Rivera', deadline: '2026-08-14' },
        { title: 'Review SOC2 compliance clause', owner: 'Sarah Chen', deadline: '2026-08-14' }
      ],
      createdAt: '2026-08-08T09:15:00.000Z'
    });

    changed = true;
  }

  if (changed) {
    saveData(data);
  }
}

seedIfEmpty();

module.exports = {
  loadData,
  saveData
};
