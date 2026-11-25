import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema({
  id: { type: String, required: true },
  sender: { type: String, enum: ['user', 'for', 'against', 'questioner', 'judge'], required: true },
  senderLabel: { type: String, required: true },
  avatarText: { type: String, required: true },
  color: { type: String, default: 'gray' },
  text: { type: String, required: true },
  timestamp: { type: String, required: true },
  verdictData: {
    verdict: { type: String },
    confidence: { type: Number },
    reasoning: { type: String },
    nextAction: { type: String }
  }
}, { _id: false });

const RoundSchema = new mongoose.Schema({
  id: { type: String, required: true },
  roundNumber: { type: Number, required: true },
  title: { type: String, required: true },
  messages: [MessageSchema]
}, { _id: false });

const ChatSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  title: { type: String, required: true },
  question: { type: String, required: true },
  rounds: [RoundSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

export const ChatModel = mongoose.models.Chat || mongoose.model('Chat', ChatSchema);
