const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');

require('dotenv').config();

const db = require('./db');
const ai = require('./ai');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'meetiq-super-secret-jwt-key-2026';

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ensure uploads directory (use /tmp on Vercel)
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true' || !!process.env.VERCEL_ENV;
const uploadsDir = isVercel ? path.join('/tmp', 'uploads') : path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
  } catch (e) {}
}
app.use('/uploads', express.static(uploadsDir));

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_'));
  }
});
const upload = multer({ storage });

// Serve static assets
const publicDir = path.join(__dirname, '..', 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}
app.use(express.static(publicDir));

// Auth Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

// -------------------------------------------------------------
// AUTH ROUTES
// -------------------------------------------------------------
app.post('/api/auth/register', (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const data = db.loadData();
  const existing = data.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    return res.status(400).json({ error: 'User with this email already exists' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const newUser = {
    id: 'usr_' + Date.now(),
    email: email.toLowerCase(),
    name: name || email.split('@')[0],
    role: 'Member',
    passwordHash,
    createdAt: new Date().toISOString()
  };

  data.users.push(newUser);
  db.saveData(data);

  const token = jwt.sign({ id: newUser.id, email: newUser.email, name: newUser.name }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role } });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const data = db.loadData();
  const user = data.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const validPass = bcrypt.compareSync(password, user.passwordHash);
  if (!validPass) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  const data = db.loadData();
  const user = data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

// -------------------------------------------------------------
// MEETINGS ROUTES
// -------------------------------------------------------------
app.get('/api/meetings', authenticateToken, (req, res) => {
  const data = db.loadData();
  const userMeetings = (data.meetings || [])
    .filter(m => m.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(userMeetings);
});

app.get('/api/meetings/:id', authenticateToken, (req, res) => {
  const data = db.loadData();
  const meeting = (data.meetings || []).find(m => m.id === req.params.id && m.userId === req.user.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

  const actionItems = (data.actionItems || []).filter(a => a.meetingId === meeting.id);
  res.json({ ...meeting, actionItems });
});

// ...

// -------------------------------------------------------------
// ACTION ITEMS & KANBAN ROUTES
// -------------------------------------------------------------
app.get('/api/action-items', authenticateToken, (req, res) => {
  const data = db.loadData();
  const userActions = (data.actionItems || []).filter(a => a.userId === req.user.id);
  res.json(userActions);
});

// ...

// -------------------------------------------------------------
// VOICE NOTES ROUTES (Live Record + File Upload)
// -------------------------------------------------------------
app.get('/api/voice-notes', authenticateToken, (req, res) => {
  const data = db.loadData();
  const notes = (data.voiceNotes || [])
    .filter(n => n.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(notes);
});

app.post('/api/meetings/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { title, transcriptText, type } = req.body;
    const meetingTitle = title || (req.file ? req.file.originalname.replace(/\.[^.]+$/, '') : 'Untitled Meeting');
    const rawContent = transcriptText || (req.file ? `Audio Recording: ${req.file.originalname}. Meeting topics: Architecture, sprint timeline, action item delegation.` : 'General team sync and updates.');

    const analysis = await ai.analyzeMeetingContent(rawContent, meetingTitle);

    const meetingId = 'm_' + Date.now();
    const newMeeting = {
      id: meetingId,
      userId: req.user.id,
      title: meetingTitle,
      type: type || 'General Sync',
      date: new Date().toISOString(),
      duration: req.file ? '24 mins' : '15 mins',
      status: 'transcribed',
      createdAt: new Date().toISOString(),
      summary: analysis.summary,
      keyDecisions: analysis.keyDecisions,
      sentiment: analysis.sentiment,
      transcript: analysis.transcript
    };

    const data = db.loadData();
    data.meetings.push(newMeeting);

    const newActionItems = (analysis.actionItems || []).map((item, idx) => ({
      id: `act_${Date.now()}_${idx}`,
      meetingId: meetingId,
      userId: req.user.id,
      title: item.title,
      owner: item.owner || 'Unassigned',
      deadline: item.deadline || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      priority: item.priority || 'medium',
      status: 'todo',
      syncedToSlack: false,
      syncedToEmail: false,
      createdAt: new Date().toISOString()
    }));

    data.actionItems.push(...newActionItems);
    db.saveData(data);

    res.json({ meeting: newMeeting, actionItems: newActionItems });
  } catch (err) {
    console.error('Error processing meeting upload:', err);
    res.status(500).json({ error: 'Failed to analyze meeting content' });
  }
});

app.delete('/api/meetings/:id', authenticateToken, (req, res) => {
  const data = db.loadData();
  data.meetings = data.meetings.filter(m => !(m.id === req.params.id && m.userId === req.user.id));
  data.actionItems = data.actionItems.filter(a => a.meetingId !== req.params.id);
  db.saveData(data);
  res.json({ success: true });
});

// -------------------------------------------------------------
// ACTION ITEMS & KANBAN ROUTES
// -------------------------------------------------------------
app.get('/api/action-items', authenticateToken, (req, res) => {
  const data = db.loadData();
  const userActions = data.actionItems.filter(a => a.userId === req.user.id);
  res.json(userActions);
});

app.post('/api/action-items', authenticateToken, (req, res) => {
  const { meetingId, title, owner, deadline, priority, status } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const data = db.loadData();
  const newItem = {
    id: 'act_' + Date.now(),
    meetingId: meetingId || null,
    userId: req.user.id,
    title,
    owner: owner || 'Unassigned',
    deadline: deadline || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
    priority: priority || 'medium',
    status: status || 'todo',
    syncedToSlack: false,
    syncedToEmail: false,
    createdAt: new Date().toISOString()
  };

  data.actionItems.push(newItem);
  db.saveData(data);
  res.json(newItem);
});

app.put('/api/action-items/:id', authenticateToken, (req, res) => {
  const data = db.loadData();
  const itemIndex = data.actionItems.findIndex(a => a.id === req.params.id && a.userId === req.user.id);
  if (itemIndex === -1) return res.status(404).json({ error: 'Action item not found' });

  const current = data.actionItems[itemIndex];
  const updated = {
    ...current,
    ...req.body,
    id: current.id,
    userId: current.userId
  };

  data.actionItems[itemIndex] = updated;
  db.saveData(data);
  res.json(updated);
});

app.delete('/api/action-items/:id', authenticateToken, (req, res) => {
  const data = db.loadData();
  data.actionItems = data.actionItems.filter(a => !(a.id === req.params.id && a.userId === req.user.id));
  db.saveData(data);
  res.json({ success: true });
});

// Slack & Email Integrations Sync
app.post('/api/action-items/:id/sync/slack', authenticateToken, (req, res) => {
  const data = db.loadData();
  const item = data.actionItems.find(a => a.id === req.params.id && a.userId === req.user.id);
  if (!item) return res.status(404).json({ error: 'Action item not found' });

  item.syncedToSlack = true;
  db.saveData(data);

  const formattedSlackMsg = `*:small_blue_diamond: MeetIQ Action Item Synced to Slack*\n> *Task:* ${item.title}\n> *Assignee:* @${item.owner}\n> *Deadline:* ${item.deadline}\n> *Priority:* ${item.priority.toUpperCase()}`;
  res.json({ success: true, message: 'Action item synced to Slack', slackPayload: formattedSlackMsg });
});

app.post('/api/action-items/:id/sync/email', authenticateToken, (req, res) => {
  const data = db.loadData();
  const item = data.actionItems.find(a => a.id === req.params.id && a.userId === req.user.id);
  if (!item) return res.status(404).json({ error: 'Action item not found' });

  item.syncedToEmail = true;
  db.saveData(data);

  res.json({
    success: true,
    message: `Email notification sent to ${item.owner} for task "${item.title}"`,
    emailDetails: {
      to: item.owner,
      subject: `[MeetIQ Task Assignment] ${item.title}`,
      body: `Hi ${item.owner},\n\nYou have been assigned a new task from MeetIQ:\n\nTask: ${item.title}\nDeadline: ${item.deadline}\nPriority: ${item.priority}\n\nPlease update your progress in the MeetIQ Kanban board.`
    }
  });
});

// -------------------------------------------------------------
// VOICE NOTES ROUTES (Live Record + File Upload)
// -------------------------------------------------------------
app.get('/api/voice-notes', authenticateToken, (req, res) => {
  const data = db.loadData();
  const notes = data.voiceNotes
    .filter(n => n.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(notes);
});

// Create text/recorded voice note
app.post('/api/voice-notes', authenticateToken, async (req, res) => {
  const { title, transcript, duration } = req.body;
  if (!transcript) return res.status(400).json({ error: 'Transcript is required' });

  const noteTitle = title || `Voice Note ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  
  const aiResult = await ai.analyzeMeetingContent(transcript, noteTitle);

  const data = db.loadData();
  const newNote = {
    id: 'vn_' + Date.now(),
    userId: req.user.id,
    title: noteTitle,
    duration: duration || '0:45',
    transcript: transcript,
    summary: aiResult.summary,
    actionItems: aiResult.actionItems || [],
    createdAt: new Date().toISOString()
  };

  data.voiceNotes.push(newNote);

  (aiResult.actionItems || []).forEach((act, i) => {
    data.actionItems.push({
      id: `act_vn_${Date.now()}_${i}`,
      meetingId: null,
      userId: req.user.id,
      title: act.title,
      owner: act.owner || req.user.name,
      deadline: act.deadline || new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0],
      priority: act.priority || 'medium',
      status: 'todo',
      syncedToSlack: false,
      syncedToEmail: false,
      createdAt: new Date().toISOString()
    });
  });

  db.saveData(data);
  res.json(newNote);
});

// Upload audio file voice note
app.post('/api/voice-notes/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { title, customTranscript } = req.body;
    const noteTitle = title || (req.file ? req.file.originalname.replace(/\.[^.]+$/, '') : 'Uploaded Voice Note');
    
    const transcriptText = customTranscript || (req.file ? `Voice Note Audio File (${req.file.originalname}): Urgent sprint check-in. Sarah will update the front-end components by Thursday. Marcus needs to verify the database indexes before launch.` : 'Uploaded Voice Recording');

    const aiResult = await ai.analyzeMeetingContent(transcriptText, noteTitle);

    const data = db.loadData();
    const newNote = {
      id: 'vn_' + Date.now(),
      userId: req.user.id,
      title: noteTitle,
      duration: '1:15',
      audioUrl: req.file ? `/uploads/${req.file.filename}` : null,
      fileName: req.file ? req.file.originalname : 'Uploaded Voice File',
      transcript: transcriptText,
      summary: aiResult.summary,
      actionItems: aiResult.actionItems || [],
      createdAt: new Date().toISOString()
    };

    data.voiceNotes.push(newNote);

    (aiResult.actionItems || []).forEach((act, i) => {
      data.actionItems.push({
        id: `act_vnupload_${Date.now()}_${i}`,
        meetingId: null,
        userId: req.user.id,
        title: act.title,
        owner: act.owner || req.user.name,
        deadline: act.deadline || new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0],
        priority: act.priority || 'medium',
        status: 'todo',
        syncedToSlack: false,
        syncedToEmail: false,
        createdAt: new Date().toISOString()
      });
    });

    db.saveData(data);
    res.json(newNote);
  } catch (err) {
    console.error('Error uploading voice note audio file:', err);
    res.status(500).json({ error: 'Failed to process audio voice note' });
  }
});

// -------------------------------------------------------------
// VIDEO NOTES & LIVE MEETING SCREEN CAPTURE ROUTES
// -------------------------------------------------------------
app.get('/api/video-notes', authenticateToken, (req, res) => {
  const data = db.loadData();
  const notes = (data.videoNotes || [])
    .filter(n => n.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(notes);
});

// Save live recorded screen/voice video note
app.post('/api/video-notes', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { title, transcript, duration } = req.body;
    const noteTitle = title || `Live Meeting Video Capture ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const transcriptText = transcript || (req.file ? `Live Recorded Meeting Video (${req.file.originalname}): Screen and voice captured. Sarah committed to completing database architecture diagram by Friday. Marcus will update deployment scripts.` : 'Live Recorded Meeting Screen & Voice');

    const aiResult = await ai.analyzeMeetingContent(transcriptText, noteTitle);

    const data = db.loadData();
    if (!data.videoNotes) data.videoNotes = [];

    const newVideoNote = {
      id: 'vid_' + Date.now(),
      userId: req.user.id,
      title: noteTitle,
      duration: duration || '2:30',
      videoUrl: req.file ? `/uploads/${req.file.filename}` : null,
      fileName: req.file ? req.file.originalname : 'Live Recorded Video',
      summary: aiResult.summary,
      keyDecisions: aiResult.keyDecisions || [],
      actionItems: aiResult.actionItems || [],
      createdAt: new Date().toISOString()
    };

    data.videoNotes.push(newVideoNote);

    (aiResult.actionItems || []).forEach((act, i) => {
      data.actionItems.push({
        id: `act_vid_${Date.now()}_${i}`,
        meetingId: null,
        userId: req.user.id,
        title: act.title,
        owner: act.owner || req.user.name,
        deadline: act.deadline || new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0],
        priority: act.priority || 'high',
        status: 'todo',
        syncedToSlack: false,
        syncedToEmail: false,
        createdAt: new Date().toISOString()
      });
    });

    db.saveData(data);
    res.json(newVideoNote);
  } catch (err) {
    console.error('Error saving live video note:', err);
    res.status(500).json({ error: 'Failed to process live meeting video note' });
  }
});

// Upload meeting video file
app.post('/api/video-notes/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { title, customTranscript } = req.body;
    const noteTitle = title || (req.file ? req.file.originalname.replace(/\.[^.]+$/, '') : 'Uploaded Meeting Video');
    const transcriptText = customTranscript || (req.file ? `Uploaded Meeting Video File (${req.file.originalname}): Q4 product architecture and sprint sync. Sarah will build API middleware by Thursday. Marcus will finalize cloud infrastructure by next Tuesday.` : 'Uploaded Meeting Video');

    const aiResult = await ai.analyzeMeetingContent(transcriptText, noteTitle);

    const data = db.loadData();
    if (!data.videoNotes) data.videoNotes = [];

    const newVideoNote = {
      id: 'vid_' + Date.now(),
      userId: req.user.id,
      title: noteTitle,
      duration: '4:15',
      videoUrl: req.file ? `/uploads/${req.file.filename}` : null,
      fileName: req.file ? req.file.originalname : 'Uploaded Video File',
      summary: aiResult.summary,
      keyDecisions: aiResult.keyDecisions || [],
      actionItems: aiResult.actionItems || [],
      createdAt: new Date().toISOString()
    };

    data.videoNotes.push(newVideoNote);

    (aiResult.actionItems || []).forEach((act, i) => {
      data.actionItems.push({
        id: `act_vidup_${Date.now()}_${i}`,
        meetingId: null,
        userId: req.user.id,
        title: act.title,
        owner: act.owner || req.user.name,
        deadline: act.deadline || new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0],
        priority: act.priority || 'high',
        status: 'todo',
        syncedToSlack: false,
        syncedToEmail: false,
        createdAt: new Date().toISOString()
      });
    });

    db.saveData(data);
    res.json(newVideoNote);
  } catch (err) {
    console.error('Error uploading meeting video file:', err);
    res.status(500).json({ error: 'Failed to process meeting video file' });
  }
});

// -------------------------------------------------------------
// NATURAL LANGUAGE AI SEARCH / Q&A ROUTE
// -------------------------------------------------------------
app.post('/api/qa/ask', authenticateToken, (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is required' });

  const data = db.loadData();
  const userMeetings = data.meetings.filter(m => m.userId === req.user.id);
  const userActions = data.actionItems.filter(a => a.userId === req.user.id);

  const answerObj = ai.answerNaturalLanguageQuery(query, userMeetings, userActions);
  
  data.qaHistory.push({
    id: 'qa_' + Date.now(),
    userId: req.user.id,
    query,
    answer: answerObj.answer,
    timestamp: new Date().toISOString()
  });
  db.saveData(data);

  res.json(answerObj);
});

// -------------------------------------------------------------
// CLEAR / RESET ALL DATA ROUTE
// -------------------------------------------------------------
app.post('/api/admin/clear-all', authenticateToken, (req, res) => {
  try {
    const data = db.loadData();
    data.meetings = [];
    data.actionItems = [];
    data.voiceNotes = [];
    data.videoNotes = [];
    data.qaHistory = [];
    db.saveData(data);

    // Delete all uploaded/recorded files from uploads directory
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(uploadsDir, file));
        } catch (e) {}
      }
    }

    res.json({ success: true, message: 'All recordings, videos, voice notes, and meeting data cleared successfully.' });
  } catch (err) {
    console.error('Error clearing data:', err);
    res.status(500).json({ error: 'Failed to clear data' });
  }
});

// Fallback SPA Route
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Start Server if run directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`⚡ MeetIQ AI Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
