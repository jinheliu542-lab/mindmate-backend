import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import bcryptjs from 'bcryptjs';
import axios from 'axios';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'mindmate_secret_key_2024';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

app.use(cors());
app.use(express.json());

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/mindmate';
    await mongoose.connect(mongoUri);
    console.log('✓ MongoDB connected');
  } catch (error) {
    console.error('✗ MongoDB connection failed:', error.message);
    process.exit(1);
  }
};

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model('User', userSchema);

const conversationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, default: 'New Conversation' },
  messages: [
    {
      role: { type: String, enum: ['user', 'assistant'] },
      content: String,
      timestamp: { type: Date, default: Date.now },
    },
  ],
  createdAt: { type: Date, default: Date.now },
});

const Conversation = mongoose.model('Conversation', conversationSchema);

const emotionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  emotion: { type: String, enum: ['very_sad', 'sad', 'neutral', 'happy', 'very_happy'] },
  intensity: { type: Number, min: 1, max: 10 },
  notes: String,
  createdAt: { type: Date, default: Date.now },
});

const EmotionEntry = mongoose.model('EmotionEntry', emotionSchema);

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
};

const generateAIResponse = async (userMessage, conversationHistory = []) => {
  try {
    if (!DEEPSEEK_API_KEY) {
      return '抱歉，AI 服务未配置。请检查 DEEPSEEK_API_KEY 环境变量。';
    }

    const messages = [
      {
        role: 'system',
        content: `You are MindMate, a compassionate AI psychology counselor. Your role is to:
1. Listen actively and empathetically to users' concerns
2. Provide supportive, non-judgmental responses
3. Offer practical coping strategies and insights
4. Encourage self-reflection and personal growth
5. Suggest professional help when appropriate

Always respond in a warm, understanding tone. Keep responses concise but meaningful. Respond in the same language as the user.`,
      },
      ...conversationHistory,
      {
        role: 'user',
        content: userMessage,
      },
    ];

    const response = await axios.post(
      'https://api.deepseek.com/chat/completions',
      {
        model: 'deepseek-chat',
        messages,
        temperature: 0.7,
        max_tokens: 500,
      },
      {
        headers: {
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('AI Service Error:', error.message);
    return '抱歉，我现在无法回应。请稍后再试。';
  }
};

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/auth/register', async (req, res) => {
  try {
    const { email, username, password } = req.body;

    if (!email || !username || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcryptjs.hash(password, 10);

    const user = new User({
      email,
      username,
      password: hashedPassword,
    });

    await user.save();

    const token = generateToken(user._id);

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isPasswordValid = await bcryptjs.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user._id);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/chat/conversations', authenticateToken, async (req, res) => {
  try {
    const { title } = req.body;
    const conversation = new Conversation({
      userId: req.user.userId,
      title: title || 'New Conversation',
    });
    await conversation.save();
    res.status(201).json(conversation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/chat/conversations', authenticateToken, async (req, res) => {
  try {
    const conversations = await Conversation.find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .select('_id title createdAt');
    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/chat/conversations/:id', authenticateToken, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      userId: req.user.userId,
    });
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/chat/messages', authenticateToken, async (req, res) => {
  try {
    const { conversationId, content } = req.body;

    if (!conversationId || !content) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const conversation = await Conversation.findOne({
      _id: conversationId,
      userId: req.user.userId,
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    conversation.messages.push({
      role: 'user',
      content,
    });

    const aiResponse = await generateAIResponse(content, conversation.messages.slice(0, -1));

    conversation.messages.push({
      role: 'assistant',
      content: aiResponse,
    });

    await conversation.save();

    res.json({
      userMessage: { role: 'user', content },
      assistantMessage: { role: 'assistant', content: aiResponse },
      conversationId,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/emotion/entries', authenticateToken, async (req, res) => {
  try {
    const { emotion, intensity, notes } = req.body;

    if (!emotion || !intensity) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const entry = new EmotionEntry({
      userId: req.user.userId,
      emotion,
      intensity,
      notes,
    });

    await entry.save();
    res.status(201).json(entry);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/emotion/entries', authenticateToken, async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const entries = await EmotionEntry.find({
      userId: req.user.userId,
      createdAt: { $gte: thirtyDaysAgo },
    }).sort({ createdAt: -1 });
    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/emotion/statistics', authenticateToken, async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const entries = await EmotionEntry.find({
      userId: req.user.userId,
      createdAt: { $gte: thirtyDaysAgo },
    });

    const stats = {
      total: entries.length,
      average_intensity: entries.length > 0 
        ? (entries.reduce((sum, e) => sum + e.intensity, 0) / entries.length).toFixed(2)
        : 0,
      emotions: {},
    };

    entries.forEach(entry => {
      stats.emotions[entry.emotion] = (stats.emotions[entry.emotion] || 0) + 1;
    });

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/user/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/user/statistics', authenticateToken, async (req, res) => {
  try {
    const conversationCount = await Conversation.countDocuments({ userId: req.user.userId });
    const emotionCount = await EmotionEntry.countDocuments({ userId: req.user.userId });
    const messageCount = await Conversation.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(req.user.userId) } },
      { $unwind: '$messages' },
      { $count: 'total' },
    ]);

    res.json({
      conversations: conversationCount,
      emotionEntries: emotionCount,
      totalMessages: messageCount[0]?.total || 0,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const startServer = async () => {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`🚀 MindMate Backend running on port ${PORT}`);
      console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🤖 AI Provider: ${process.env.AI_PROVIDER || 'deepseek'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

export default app;
