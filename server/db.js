import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ChatModel } from './models/Chat.js';
import { UserModel } from './models/User.js';
import { hashPassword } from './utils/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

let isMongoConnected = false;

// Ensure local fallback data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err.message);
    return [];
  }
}

function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err.message);
  }
}

export async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/secondopinion';
  try {
    mongoose.set('strictQuery', false);
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 2000
    });
    isMongoConnected = true;
    console.log(`[MongoDB] Connected successfully to ${uri}`);
  } catch (error) {
    isMongoConnected = false;
    console.warn(`[MongoDB] Operating in persistent local storage mode (${error.message}).`);
  }
}

export const UserStore = {
  async findByEmail(email) {
    const cleanEmail = email.toLowerCase().trim();
    if (isMongoConnected) {
      return await UserModel.findOne({ email: cleanEmail }).lean();
    }
    const users = readJsonFile(USERS_FILE);
    return users.find(u => u.email.toLowerCase() === cleanEmail) || null;
  },

  async findById(id) {
    if (isMongoConnected) {
      return await UserModel.findOne({ id }).lean();
    }
    const users = readJsonFile(USERS_FILE);
    return users.find(u => u.id === id) || null;
  },

  async create(user) {
    user.createdAt = new Date().toISOString();
    if (isMongoConnected) {
      const doc = new UserModel(user);
      await doc.save();
      return doc.toObject();
    }
    const users = readJsonFile(USERS_FILE);
    users.push(user);
    writeJsonFile(USERS_FILE, users);
    return user;
  },

  async seedDefaultUser() {
    const existing = await this.findByEmail('demo@secondopinion.ai');
    if (!existing) {
      console.log('[Auth] Seeding default demo user (demo@secondopinion.ai)...');
      const { salt, hash } = hashPassword('password123');
      await this.create({
        id: 'user-demo-mayank',
        name: 'Mayank',
        email: 'demo@secondopinion.ai',
        passwordHash: hash,
        salt,
        avatarInitial: 'M'
      });
    }
  }
};

export const ChatStore = {
  // Strictly return only chats belonging to the specified userId
  async getAll(userId = null) {
    if (!userId) {
      return [];
    }

    if (isMongoConnected) {
      const chats = await ChatModel.find({ userId }).sort({ createdAt: -1 }).lean();
      return chats.map(c => ({
        id: c.id || c._id.toString(),
        userId: c.userId,
        title: c.title,
        question: c.question,
        createdAt: c.createdAt
      }));
    }

    const list = readJsonFile(CHATS_FILE);
    return list
      .filter(c => c.userId === userId)
      .map(c => ({
        id: c.id,
        userId: c.userId,
        title: c.title,
        question: c.question,
        createdAt: c.createdAt
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async getById(id, userId = null) {
    if (isMongoConnected) {
      const query = { id };
      if (userId) query.userId = userId;
      const doc = await ChatModel.findOne(query).lean();
      return doc || null;
    }
    const list = readJsonFile(CHATS_FILE);
    return list.find(c => c.id === id && (!userId || c.userId === userId)) || null;
  },

  async save(chat) {
    const { _id, __v, ...clean } = chat;
    clean.updatedAt = new Date().toISOString();
    if (!clean.createdAt) {
      clean.createdAt = clean.updatedAt;
    }

    if (isMongoConnected) {
      await ChatModel.findOneAndUpdate(
        { id: clean.id },
        clean,
        { upsert: true, new: true, runValidators: true }
      );
      return clean;
    }

    const list = readJsonFile(CHATS_FILE);
    const idx = list.findIndex(c => c.id === clean.id);
    if (idx >= 0) {
      list[idx] = clean;
    } else {
      list.push(clean);
    }
    writeJsonFile(CHATS_FILE, list);
    return clean;
  },

  async delete(id, userId = null) {
    if (isMongoConnected) {
      const query = { id };
      if (userId) query.userId = userId;
      await ChatModel.deleteOne(query);
      return true;
    }
    let list = readJsonFile(CHATS_FILE);
    list = list.filter(c => !(c.id === id && (!userId || c.userId === userId)));
    writeJsonFile(CHATS_FILE, list);
    return true;
  },

  async count() {
    if (isMongoConnected) {
      return await ChatModel.countDocuments();
    }
    return readJsonFile(CHATS_FILE).length;
  }
};
